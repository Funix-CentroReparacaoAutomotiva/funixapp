import {createCustomerIdentitySchema,createShortNumberReviewSchema,registerCustomerPhoneFunction,rekeyCanonicalBrazilPhones} from './customer-identity-schema.ts'
import {createProductionSchema} from './production-schema.ts'
import {createContactChannelSchema} from './contact-channel-schema.ts'
import { createCustomerSchema } from './customer-schema.ts'
import type { DatabaseSync } from 'node:sqlite'
import { hierarchyPieces } from './hierarchy.ts'
import { createChatSchema } from './chat/schema.ts'

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
  `)},
  {version:10,apply:db=>db.exec(`
    ALTER TABLE diagnosis_services ADD COLUMN recommendation_rule_id TEXT REFERENCES diagnosis_recommendations(id) ON DELETE RESTRICT;
    CREATE TABLE recommendation_applications (
      piece_id TEXT NOT NULL REFERENCES diagnosis_items(id) ON DELETE CASCADE,
      scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY(piece_id,scenario_id,request_key)
    );
  `)},
  // Commercial numbers are independent of the immutable budget snapshot and PDF.
  // Historical versions retain their original letters/PDFs and are not renumbered.
  {version:11,apply:db=>db.exec(`
    CREATE TABLE budget_document_identity (
      serial INTEGER PRIMARY KEY CHECK(serial > 0),
      budget_version_id TEXT NOT NULL UNIQUE REFERENCES budget_versions(id) ON DELETE RESTRICT,
      filename TEXT NOT NULL
    );
    CREATE TRIGGER immutable_budget_identity_update BEFORE UPDATE ON budget_document_identity BEGIN SELECT RAISE(ABORT,'Budget identities are immutable');END;
    CREATE TRIGGER immutable_budget_identity_delete BEFORE DELETE ON budget_document_identity BEGIN SELECT RAISE(ABORT,'Budget identities are immutable');END;
  `)},
  {version:12,apply:db=>db.exec(`
    ALTER TABLE scenarios ADD COLUMN deadline_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(deadline_mode IN ('automatic','manual'));
    ALTER TABLE scenarios ADD COLUMN deadline_days INTEGER CHECK(deadline_days IS NULL OR (typeof(deadline_days)='integer' AND deadline_days>0));
    CREATE TABLE installment_configuration(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL CHECK(revision>0),rates TEXT NOT NULL,updated_at TEXT NOT NULL);
    INSERT INTO installment_configuration VALUES(1,1,'{"tres":"6","seis":"8","nove":"10","doze":"12"}',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    CREATE TABLE budget_emission_attempts(
      serial INTEGER PRIMARY KEY AUTOINCREMENT,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,
      version_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,snapshot TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('rendering','failed','issued')),
      lease_token TEXT NOT NULL,lease_expires INTEGER NOT NULL,
      UNIQUE(atendimento_id,idempotency_key)
    );
    INSERT INTO sqlite_sequence(name,seq) VALUES('budget_emission_attempts',(SELECT COALESCE(MAX(serial),0) FROM budget_document_identity));
  `)},
  {version:13,apply:db=>db.exec(`
    CREATE TABLE voice_apply_receipts (
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,scenario_id TEXT NOT NULL,
      request_digest TEXT NOT NULL,result_json TEXT NOT NULL,
      PRIMARY KEY(atendimento_id,idempotency_key)
    );
  `)},
  {version:14,apply:createChatSchema},
  // Scenario-local drafts are separate from immutable emitted budget snapshots.
  {version:15,apply:db=>db.exec(`ALTER TABLE scenarios ADD COLUMN negotiation_draft_json TEXT NOT NULL DEFAULT '{"mode":"none","value":""}';`)},
  // NULL means the historic single vehicle description was not independently verified.
  // Do not backfill a single year into either field by guessing.
  {version:16,apply:db=>db.exec(`
    ALTER TABLE atendimentos ADD COLUMN fabrication_year TEXT;
    ALTER TABLE atendimentos ADD COLUMN model_year TEXT;
  `)},
  // #168: technical review remains attached to the diagnosis across scenarios.
  {version:17,apply:db=>db.exec('ALTER TABLE diagnosis_items ADD COLUMN piece_review_pending INTEGER NOT NULL DEFAULT 0 CHECK(piece_review_pending IN (0,1));')},
  // One immutable operational order per emitted version. Other versions can
  // produce complementary orders; no uniqueness constraint on an Experience.
  {version:18,apply:db=>db.exec(`
    CREATE TABLE work_orders (
      serial INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      budget_version_id TEXT NOT NULL UNIQUE REFERENCES budget_versions(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      authorized_at TEXT NOT NULL,
      authorization_source TEXT NOT NULL CHECK(authorization_source='authenticated-session-confirmation'),
      authorized_by TEXT,
      budget_number TEXT NOT NULL,
      budget_label TEXT NOT NULL,
      scope_json TEXT NOT NULL
    );
    CREATE INDEX work_orders_atendimento ON work_orders(atendimento_id,created_at);
    CREATE TRIGGER immutable_work_order_update BEFORE UPDATE ON work_orders
      BEGIN SELECT RAISE(ABORT,'Work orders are immutable'); END;
    CREATE TRIGGER immutable_work_order_delete BEFORE DELETE ON work_orders
      BEGIN SELECT RAISE(ABORT,'Work orders are immutable'); END;
  `)},
  // #219: customer/chat schema follows the already deployed work-order V18.
  {version:19,apply:createCustomerSchema},
  // Cancellation is immutable metadata, separate from the issued PDF and OS.
  {version:20,apply:db=>db.exec(`
    CREATE TABLE budget_cancellations (
      budget_version_id TEXT PRIMARY KEY REFERENCES budget_versions(id) ON DELETE RESTRICT,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      cancelled_at TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500)
    );
    CREATE INDEX budget_cancellations_at ON budget_cancellations(atendimento_id,cancelled_at);
    CREATE TRIGGER immutable_budget_cancellation_update BEFORE UPDATE ON budget_cancellations
      BEGIN SELECT RAISE(ABORT,'Budget cancellations are immutable'); END;
    CREATE TRIGGER immutable_budget_cancellation_delete BEFORE DELETE ON budget_cancellations
      BEGIN SELECT RAISE(ABORT,'Budget cancellations are immutable'); END;
  `)},
  // Expected delivery is owned by the Atendimento; changes must be auditable.
  // OS V18 records remain byte-for-byte intact, and later issues are append-only.
  {version:21,apply:db=>db.exec(`
    ALTER TABLE atendimentos ADD COLUMN delivery_date TEXT
      CHECK(delivery_date IS NULL OR (length(delivery_date)=10 AND
        delivery_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
        date(delivery_date) IS NOT NULL AND date(delivery_date)=delivery_date));
    CREATE TABLE atendimento_delivery_date_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      previous_date TEXT,
      new_date TEXT,
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500),
      changed_at TEXT NOT NULL,
      operator_id TEXT
    );
    CREATE INDEX atendimento_delivery_date_history_at ON atendimento_delivery_date_history(atendimento_id,id);
    CREATE TRIGGER immutable_delivery_history_update BEFORE UPDATE ON atendimento_delivery_date_history
      BEGIN SELECT RAISE(ABORT,'Delivery date history is immutable'); END;
    CREATE TRIGGER immutable_delivery_history_delete BEFORE DELETE ON atendimento_delivery_date_history
      BEGIN SELECT RAISE(ABORT,'Delivery date history is immutable'); END;
    CREATE TABLE work_order_revisions (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
      revision INTEGER NOT NULL CHECK(revision>=2),
      created_at TEXT NOT NULL,
      authorized_at TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500),
      scope_json TEXT NOT NULL,
      UNIQUE(work_order_id,revision)
    );
    CREATE INDEX work_order_revisions_by_order ON work_order_revisions(work_order_id,revision DESC);
    CREATE TRIGGER immutable_work_order_revision_update BEFORE UPDATE ON work_order_revisions
      BEGIN SELECT RAISE(ABORT,'Work order revisions are immutable'); END;
    CREATE TRIGGER immutable_work_order_revision_delete BEFORE DELETE ON work_order_revisions
      BEGIN SELECT RAISE(ABORT,'Work order revisions are immutable'); END;
    CREATE TABLE work_order_revision_pdf_cache (
      revision_id TEXT NOT NULL REFERENCES work_order_revisions(id) ON DELETE RESTRICT,
      template_version TEXT NOT NULL,
      pdf BLOB NOT NULL CHECK(length(pdf)>16),
      created_at TEXT NOT NULL,
      PRIMARY KEY(revision_id,template_version)
    );
    CREATE TRIGGER immutable_work_order_revision_pdf_update BEFORE UPDATE ON work_order_revision_pdf_cache
      BEGIN SELECT RAISE(ABORT,'Work order revision PDF is immutable'); END;
    CREATE TRIGGER immutable_work_order_revision_pdf_delete BEFORE DELETE ON work_order_revision_pdf_cache
      BEGIN SELECT RAISE(ABORT,'Work order revision PDF is immutable'); END;
  `)},
  {version:22,apply:createContactChannelSchema},
  {version:23,apply:db=>db.exec(`ALTER TABLE atendimentos ADD COLUMN purpose TEXT
    CHECK(purpose IN ('commercial','non_commercial','unclassified'))`)},
  {version:24,apply:createProductionSchema},
  {version:25,apply:createCustomerIdentitySchema},
  {version:26,apply:rekeyCanonicalBrazilPhones}
]

export function migrate(db: DatabaseSync) {
  registerCustomerPhoneFunction(db)
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
      if(applied.includes(25)&&!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='customer_contact_owner_transfer'").get())
        throw Error('Cópia V25 de uma revisão preliminar. Refaça o ensaio a partir da cópia V23/V24 preservada.')
    }
    for (const migration of migrations.slice(applied.length)) {
      migration.apply(db)
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)').run(migration.version, new Date().toISOString())
    }
    createShortNumberReviewSchema(db)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
