import type {DatabaseSync} from 'node:sqlite'

export function createProductionSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE production_experiences (
      id TEXT PRIMARY KEY,
      atendimento_id TEXT NOT NULL UNIQUE REFERENCES atendimentos(id) ON DELETE RESTRICT,
      customer_json TEXT NOT NULL CHECK(json_valid(customer_json)),
      vehicle_json TEXT NOT NULL CHECK(json_valid(vehicle_json)),
      payer_json TEXT NOT NULL CHECK(json_valid(payer_json)),
      customer_id TEXT GENERATED ALWAYS AS (json_extract(customer_json, '$.id')) VIRTUAL REFERENCES customer_records(id),
      vehicle_id TEXT GENERATED ALWAYS AS (json_extract(vehicle_json, '$.id')) VIRTUAL REFERENCES customer_records(id),
      payer_id TEXT GENERATED ALWAYS AS (json_extract(payer_json, '$.id')) VIRTUAL REFERENCES customer_records(id),
      scheduled_entry TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TRIGGER immutable_experience_parties
      BEFORE UPDATE OF id, atendimento_id, customer_json, vehicle_json, payer_json, created_at ON production_experiences
      BEGIN SELECT RAISE(ABORT,'Experience parties are immutable'); END;
    CREATE TRIGGER immutable_experience_delete BEFORE DELETE ON production_experiences
      BEGIN SELECT RAISE(ABORT,'Experiences are immutable'); END;

    CREATE UNIQUE INDEX production_budget_owner ON budget_versions(atendimento_id, id);
    CREATE TABLE production_budget_transitions (
      id INTEGER PRIMARY KEY,
      atendimento_id TEXT NOT NULL,
      budget_version_id TEXT NOT NULL,
      previous_state TEXT CHECK(previous_state IN ('negotiating','consented','authorized','rejected','executed')),
      state TEXT NOT NULL CHECK(state IN ('consented','authorized','rejected','executed','cancelled')),
      origin TEXT NOT NULL CHECK(origin IN ('commercial','technical')),
      occurred_at TEXT NOT NULL,
      reason TEXT,
      actor_source TEXT NOT NULL DEFAULT 'authenticated-session-confirmation'
        CHECK(actor_source='authenticated-session-confirmation'),
      operator_id TEXT,
      FOREIGN KEY(atendimento_id,budget_version_id) REFERENCES budget_versions(atendimento_id,id) ON DELETE RESTRICT,
      CHECK(state<>'rejected' OR (reason IS NOT NULL AND length(trim(reason)) BETWEEN 5 AND 500))
    );
    CREATE INDEX production_transition_budget ON production_budget_transitions(atendimento_id,budget_version_id,id);
    CREATE TRIGGER immutable_production_transition_update BEFORE UPDATE ON production_budget_transitions
      BEGIN SELECT RAISE(ABORT,'Budget transitions are immutable'); END;
    CREATE TRIGGER immutable_production_transition_delete BEFORE DELETE ON production_budget_transitions
      BEGIN SELECT RAISE(ABORT,'Budget transitions are immutable'); END;

    ALTER TABLE work_orders ADD COLUMN experience_id TEXT REFERENCES production_experiences(id) ON DELETE RESTRICT;
    CREATE INDEX production_work_orders_experience ON work_orders(experience_id);
    CREATE TRIGGER production_work_order_guard BEFORE INSERT ON work_orders
      WHEN NOT EXISTS (
        SELECT 1 FROM production_experiences e JOIN budget_versions b ON b.atendimento_id=e.atendimento_id
        WHERE e.id=NEW.experience_id AND e.atendimento_id=NEW.atendimento_id AND b.id=NEW.budget_version_id
          AND (SELECT t.state FROM production_budget_transitions t
               WHERE t.atendimento_id=b.atendimento_id AND t.budget_version_id=b.id
               ORDER BY t.id DESC LIMIT 1)='authorized'
          AND NOT EXISTS (SELECT 1 FROM budget_cancellations c WHERE c.budget_version_id=b.id)
      )
      BEGIN SELECT RAISE(ABORT,'Work order requires technical authorization for this Experience'); END;

    CREATE TRIGGER production_transition_guard BEFORE INSERT ON production_budget_transitions
      WHEN NEW.previous_state IS NOT COALESCE(
        (SELECT t.state FROM production_budget_transitions t
         WHERE t.atendimento_id=NEW.atendimento_id AND t.budget_version_id=NEW.budget_version_id
         ORDER BY t.id DESC LIMIT 1),
        (SELECT 'negotiating' WHERE NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.budget_version_id=NEW.budget_version_id))
      ) OR CASE NEW.state
        WHEN 'consented' THEN NOT (NEW.previous_state IS 'negotiating' AND NEW.origin='commercial'
          AND EXISTS (SELECT 1 FROM production_experiences WHERE atendimento_id=NEW.atendimento_id))
        WHEN 'authorized' THEN NOT (NEW.previous_state IS 'consented' AND NEW.origin='technical')
        WHEN 'rejected' THEN NOT ((NEW.previous_state IS 'negotiating' AND NEW.origin='commercial')
          OR (NEW.previous_state IS 'consented' AND NEW.origin='technical'))
        WHEN 'executed' THEN NOT (NEW.previous_state IS 'authorized' AND NEW.origin='technical'
          AND EXISTS (SELECT 1 FROM work_orders w WHERE w.budget_version_id=NEW.budget_version_id AND w.experience_id IS NOT NULL))
        WHEN 'cancelled' THEN NOT (NEW.origin='commercial' AND EXISTS (
          SELECT 1 FROM budget_cancellations c WHERE c.budget_version_id=NEW.budget_version_id
            AND c.atendimento_id=NEW.atendimento_id AND c.cancelled_at=NEW.occurred_at AND c.reason=NEW.reason))
      END OR (NEW.state<>'cancelled' AND EXISTS (
        SELECT 1 FROM budget_cancellations c WHERE c.budget_version_id=NEW.budget_version_id))
      BEGIN SELECT RAISE(ABORT,'Invalid budget lifecycle transition'); END;

    CREATE TRIGGER production_budget_cancellation AFTER INSERT ON budget_cancellations
      BEGIN
        INSERT INTO production_budget_transitions(atendimento_id,budget_version_id,previous_state,state,origin,occurred_at,reason)
        VALUES(NEW.atendimento_id,NEW.budget_version_id,
          COALESCE((SELECT state FROM production_budget_transitions
                    WHERE atendimento_id=NEW.atendimento_id AND budget_version_id=NEW.budget_version_id
                    ORDER BY id DESC LIMIT 1),
                   (SELECT 'negotiating' WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE budget_version_id=NEW.budget_version_id))),
          'cancelled','commercial',NEW.cancelled_at,NEW.reason);
      END;
  `)
}
