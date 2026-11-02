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

  { version: 3, apply: db => db.exec(`
    ALTER TABLE diagnosis_services ADD COLUMN notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE diagnosis_services ADD COLUMN diagnosis_id TEXT REFERENCES catalog_items(id) ON DELETE RESTRICT;
    CREATE TABLE commercial_state (
      atendimento_id TEXT PRIMARY KEY REFERENCES atendimentos(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      settings_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE scenarios (
      id TEXT PRIMARY KEY,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(trim(name)) > 0),
      position INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at TEXT NOT NULL,
      UNIQUE(atendimento_id,position)
    );
    CREATE TABLE scenario_piece_flags (
      scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      piece_id TEXT NOT NULL REFERENCES diagnosis_items(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      PRIMARY KEY(scenario_id,piece_id)
    );
    CREATE TABLE scenario_service_flags (
      scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL REFERENCES diagnosis_services(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      PRIMARY KEY(scenario_id,service_id)
    );
    INSERT INTO commercial_state(atendimento_id) SELECT id FROM atendimentos;
    INSERT INTO scenarios(id,atendimento_id,name,position,created_at)
      SELECT 'initial:'||id,id,'Principal',1,created_at FROM atendimentos;
    INSERT INTO scenario_piece_flags SELECT s.id,p.id,p.enabled FROM scenarios s JOIN diagnosis_items p ON p.atendimento_id=s.atendimento_id;
    INSERT INTO scenario_service_flags SELECT s.id,l.id,l.enabled FROM scenarios s JOIN diagnosis_items p ON p.atendimento_id=s.atendimento_id JOIN diagnosis_services l ON l.diagnosis_item_id=p.id;
    CREATE TRIGGER atendimento_commercial_state AFTER INSERT ON atendimentos BEGIN
      INSERT INTO commercial_state(atendimento_id) VALUES(NEW.id);
      INSERT INTO scenarios(id,atendimento_id,name,position,created_at) VALUES('initial:'||NEW.id,NEW.id,'Principal',1,NEW.created_at);
    END;
    CREATE TRIGGER piece_scenario_flags AFTER INSERT ON diagnosis_items BEGIN
      INSERT INTO scenario_piece_flags SELECT s.id,NEW.id,0 FROM scenarios s WHERE s.atendimento_id=NEW.atendimento_id;
    END;
    CREATE TRIGGER service_scenario_flags AFTER INSERT ON diagnosis_services BEGIN
      INSERT INTO scenario_service_flags SELECT s.id,NEW.id,0 FROM scenarios s JOIN diagnosis_items p ON p.atendimento_id=s.atendimento_id WHERE p.id=NEW.diagnosis_item_id;
    END;
  `) },


  {version:4,apply:db=>db.exec(`
    CREATE TABLE pricing_configuration (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL, data TEXT NOT NULL
    );
    INSERT INTO pricing_configuration(id,updated_at,data) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'{"tables":[],"colors":[],"risks":[],"capacity":null,"services":[],"specialPrices":[],"conditions":""}');
    CREATE TABLE component_items (
      id TEXT PRIMARY KEY, atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
      piece_id TEXT NOT NULL REFERENCES diagnosis_items(id) ON DELETE CASCADE,
      name TEXT NOT NULL, quantity TEXT NOT NULL, manual_price TEXT, fct TEXT, notes TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX component_at ON component_items(atendimento_id);
    CREATE TABLE scenario_component_flags (
      scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      component_id TEXT NOT NULL REFERENCES component_items(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), PRIMARY KEY(scenario_id,component_id)
    );
    CREATE TRIGGER component_scenario_flags AFTER INSERT ON component_items BEGIN
      INSERT INTO scenario_component_flags SELECT s.id,NEW.id,0 FROM scenarios s WHERE s.atendimento_id=NEW.atendimento_id;
    END;
  `)},


  {version:5,apply:db=>db.exec(`
    CREATE TABLE budget_versions (
      id TEXT PRIMARY KEY, atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK(sequence>0),label TEXT NOT NULL,created_at TEXT NOT NULL,
      snapshot TEXT NOT NULL,pdf BLOB NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,
      UNIQUE(atendimento_id,sequence),UNIQUE(atendimento_id,idempotency_key)
    );
    CREATE TRIGGER immutable_budget_update BEFORE UPDATE ON budget_versions BEGIN SELECT RAISE(ABORT,'Budget versions are immutable');END;
    CREATE TRIGGER immutable_budget_delete BEFORE DELETE ON budget_versions BEGIN SELECT RAISE(ABORT,'Budget versions are immutable');END;
  `)},

  {version:6,apply:db=>db.exec(`
    ALTER TABLE commercial_state ADD COLUMN next_scenario_position INTEGER NOT NULL DEFAULT 2 CHECK(next_scenario_position > 1);
    UPDATE commercial_state SET next_scenario_position=(SELECT COALESCE(MAX(position),1)+1 FROM scenarios WHERE atendimento_id=commercial_state.atendimento_id);
  `)},
  // V4–V6 SQL remains immutable upgrade history, not the active component contract.
  // Remove only the retired column; no Atendimento, catalog, flag or PDF is reset.
  {version:7,apply:db=>db.exec('ALTER TABLE component_items DROP COLUMN fct;')},
  {version:8,apply:db=>db.exec(`
    CREATE TABLE scenario_service_confirmations (
      scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      service_line_id TEXT NOT NULL REFERENCES diagnosis_services(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      PRIMARY KEY(scenario_id,service_line_id)
    );
  `)},
  {version:9,apply:db=>db.exec(`
    ALTER TABLE diagnosis_items ADD COLUMN intensity TEXT CHECK(intensity IS NULL OR intensity IN ('leve','moderado','severo'));
    CREATE TABLE diagnosis_recommendations (
      id TEXT PRIMARY KEY,
      source_table TEXT NOT NULL, source_row_id TEXT NOT NULL,
      diagnosis_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
      intensity TEXT NOT NULL CHECK(intensity IN ('leve','moderado','severo')),
      service_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
      dimension_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
      selected_by_default INTEGER NOT NULL CHECK(selected_by_default IN (0,1)),
      status TEXT NOT NULL CHECK(status IN ('valid','pending')),
      reason TEXT,
      UNIQUE(source_table,source_row_id),
      UNIQUE(diagnosis_id,intensity,service_id,dimension_id),
      CHECK((status='valid' AND reason IS NULL) OR (status='pending' AND reason IS NOT NULL))
    );
    CREATE INDEX recommendations_lookup ON diagnosis_recommendations(diagnosis_id,intensity,status);
  `)}
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
