import type { DatabaseSync } from 'node:sqlite'

// Explicit opt-in, separate from historical SQLite schema_migrations V14.
// No automatic invocation by openDatabase or existing importers.
export function createUpdatePackageSchema(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS update_packages (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
        snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
        source TEXT NOT NULL CHECK(source IN ('gmail','whatsapp','other')),
        source_reference TEXT NOT NULL,
        experience_id TEXT,
        plate TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'awaiting_review'
          CHECK(status IN ('awaiting_review','approved_pending_execution','execution_failed','executed','rejected')),
        actions_json TEXT NOT NULL CHECK(json_valid(actions_json)),
        missing_fields_json TEXT NOT NULL CHECK(json_valid(missing_fields_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT
      );
      CREATE INDEX IF NOT EXISTS update_packages_queue ON update_packages(status,created_at DESC);
      CREATE TABLE IF NOT EXISTS update_package_decisions (
        package_id TEXT NOT NULL REFERENCES update_packages(id) ON DELETE RESTRICT,
        request_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
        revision INTEGER NOT NULL CHECK(revision>0),
        snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
        actor TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        PRIMARY KEY(package_id,request_id)
      );
      CREATE TABLE IF NOT EXISTS update_package_ingest_events (
        event_key TEXT PRIMARY KEY,
        package_id TEXT NOT NULL UNIQUE REFERENCES update_packages(id) ON DELETE RESTRICT,
        payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS update_package_clarifications (
        package_id TEXT PRIMARY KEY REFERENCES update_packages(id) ON DELETE RESTRICT,
        request_id TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL CHECK(revision>0),
        snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
        answers_json TEXT NOT NULL CHECK(json_valid(answers_json)),
        actor TEXT NOT NULL,
        submitted_at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS update_packages_freeze_snapshot BEFORE UPDATE OF
        snapshot_hash,source,source_reference,experience_id,plate,title,summary,actions_json,missing_fields_json
        ON update_packages
      BEGIN SELECT RAISE(ABORT,'Pacote imutável após preparação'); END;
    `)
    db.exec('COMMIT')
  } catch(error) {db.exec('ROLLBACK');throw error}
}

export function hasUpdatePackageSchema(db: DatabaseSync): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='update_packages'").get()) &&
    Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='update_package_decisions'").get()) &&
    Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='update_package_ingest_events'").get()) &&
    Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='update_package_clarifications'").get())
}
