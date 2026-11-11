import type { DatabaseSync } from 'node:sqlite'
import { hasGmailIntakeSchema } from './gmail-intake-schema.ts'

/** Optional and isolated: no legacy migrations; only message IDs/technical metadata. */
export function createGmailIntakeQueueSchema(db: DatabaseSync): void {
  if (!hasGmailIntakeSchema(db)) throw new Error('GMAIL_INTAKE_SCHEMA_REQUIRED')
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS gmail_intake_delivery_queue (
        message_id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'queued'
          CHECK(state IN ('queued','leased','retry','notified','ignored','blocked')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
        next_attempt_at TEXT,
        lease_token TEXT,
        lease_expires_at TEXT,
        last_receipt_token TEXT,
        last_receipt_hash TEXT,
        notice_id TEXT REFERENCES gmail_intake_notices(id) ON DELETE RESTRICT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(
          (state='leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
          OR (state!='leased' AND lease_token IS NULL AND lease_expires_at IS NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS gmail_intake_delivery_queue_due
        ON gmail_intake_delivery_queue(state,next_attempt_at,lease_expires_at,created_at);
      CREATE TABLE IF NOT EXISTS gmail_intake_delivery_queue_attempts (
        message_id TEXT NOT NULL REFERENCES gmail_intake_delivery_queue(message_id) ON DELETE RESTRICT,
        attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 5),
        lease_token TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT NOT NULL CHECK(outcome IN ('leased','notified','ignored','retry','blocked','expired')),
        error_code TEXT,
        PRIMARY KEY(message_id,attempt)
      );
    `)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export function hasGmailIntakeQueueSchema(db: DatabaseSync): boolean {
  return hasGmailIntakeSchema(db) &&
    Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gmail_intake_delivery_queue'").get()) &&
    Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gmail_intake_delivery_queue_attempts'").get())
}
