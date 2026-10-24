import type { DatabaseSync } from 'node:sqlite'
import { hierarchyPieces } from './hierarchy.ts'

const migrations: { version: number; apply: (db: DatabaseSync) => void }[] = [
  { version: 1, apply: db => db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE atendimentos (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        phone_normalized TEXT,
        name TEXT NOT NULL DEFAULT '',
        vehicle TEXT NOT NULL DEFAULT '',
        brand TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        plate TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        search_text TEXT NOT NULL DEFAULT '',
        stage TEXT NOT NULL DEFAULT 'novo-lead'
          CHECK (stage IN ('novo-lead','aguardando-dados','em-negociacao','morno','frio','rejeitados')),
        rejection_reason TEXT NOT NULL DEFAULT '',
        explicit_refusal INTEGER NOT NULL DEFAULT 0 CHECK (explicit_refusal IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        CHECK (stage != 'rejeitados' OR (explicit_refusal = 1 AND length(trim(rejection_reason)) > 0))
      );
      CREATE INDEX atendimentos_updated ON atendimentos(updated_at DESC, id);
      CREATE INDEX atendimentos_phone_normalized ON atendimentos(phone_normalized);
    `) },
  { version: 2, apply: db => {
    db.exec(`
      CREATE TABLE catalog_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('peca','servico','diagnostico','dimensao')),
        code TEXT UNIQUE,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        status TEXT NOT NULL CHECK (status IN ('proposta','validado')),
        source TEXT NOT NULL CHECK (source IN ('hierarquia-v2','operador')),
        suggestion INTEGER NOT NULL DEFAULT 0 CHECK (suggestion IN (0,1)),
        side TEXT NOT NULL DEFAULT '',
        service_id TEXT REFERENCES catalog_items(id) ON DELETE RESTRICT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK (kind != 'peca' OR status != 'validado' OR (code IS NOT NULL AND length(trim(code)) > 0)),
        CHECK (kind = 'peca' OR code IS NULL),
        CHECK ((kind = 'dimensao' AND service_id IS NOT NULL) OR (kind != 'dimensao' AND service_id IS NULL))
      );
      CREATE TABLE catalog_history (
        item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL, changed_at TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (item_id, revision)
      );
      CREATE TABLE diagnosis_items (
        id TEXT PRIMARY KEY,
        atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
        piece_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
        diagnosis_id TEXT REFERENCES catalog_items(id) ON DELETE RESTRICT,
        notes TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (atendimento_id, piece_id)
      );
      CREATE TABLE diagnosis_services (
        id TEXT PRIMARY KEY,
        diagnosis_item_id TEXT NOT NULL REFERENCES diagnosis_items(id) ON DELETE CASCADE,
        service_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
        dimension_id TEXT REFERENCES catalog_items(id) ON DELETE RESTRICT,
        quantity TEXT NOT NULL CHECK (length(quantity) BETWEEN 1 AND 16 AND quantity NOT GLOB '*[^0-9.]*' AND quantity GLOB '*[1-9]*'),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
      );
      CREATE INDEX diagnosis_atendimento ON diagnosis_items(atendimento_id);
      CREATE INDEX diagnosis_service_parent ON diagnosis_services(diagnosis_item_id);
    `)
    const now = new Date().toISOString()
    const insert = db.prepare(`INSERT INTO catalog_items(id,kind,code,name,status,source,suggestion,side,created_at,updated_at) VALUES (?,'peca',?,?,'proposta','hierarquia-v2',?,?,?,?)`)
    for (const piece of hierarchyPieces()) {
      // Technical IDs only; codes below are copied verbatim, never generated.
      const id = 'v2:' + piece.code
      insert.run(id, piece.code, piece.name, piece.suggestion ? 1 : 0, piece.side, now, now)
      const data = db.prepare('SELECT * FROM catalog_items WHERE id=?').get(id)
      db.prepare('INSERT INTO catalog_history VALUES (?,?,?,?)').run(id, 1, now, JSON.stringify(data))
    }
  } },
]

export function migrate(db: DatabaseSync) {
  // Serialize discovery and upgrades too: concurrent startups must not both apply V2.
  db.exec('BEGIN IMMEDIATE')
  try {
    const hasMigrations = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
    let applied: number[] = []
    if (!hasMigrations) {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length) throw new Error('O arquivo SQLite não pertence a este aplicativo.')
    } else {
      applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => Number(row.version))
      if (applied.some(version => version > migrations.length)) throw new Error('Banco de versão mais recente; restaure o aplicativo compatível.')
      if (!applied.length || applied.some((version, index) => version !== index + 1)) throw new Error('Histórico de migrações inconsistente; banco preservado.')
    }
    for (const migration of migrations.slice(applied.length)) {
      migration.apply(db)
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)').run(migration.version, new Date().toISOString())
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
