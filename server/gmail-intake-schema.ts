import type { DatabaseSync } from 'node:sqlite'

/** Independent and opt-in: never part of legacy data migrations. */
export function createGmailIntakeSchema(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS gmail_intake_notices (" +
      "id TEXT PRIMARY KEY, " +
      "message_id TEXT NOT NULL UNIQUE, " +
      "revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), " +
      "snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash) = 64), " +
      "title TEXT NOT NULL, summary TEXT NOT NULL, relevance TEXT NOT NULL CHECK(relevance IN ('relevant','uncertain')), " +
      "reason TEXT NOT NULL, plate_hint TEXT, xp_hint TEXT, " +
      "status TEXT NOT NULL DEFAULT 'awaiting_authorization' CHECK(status IN ('awaiting_authorization','authorized','denied')), " +
      "created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT" +
      ");" +
      "CREATE INDEX IF NOT EXISTS gmail_intake_queue ON gmail_intake_notices(status,created_at DESC);" +
      "CREATE TABLE IF NOT EXISTS gmail_intake_decisions (" +
      "notice_id TEXT NOT NULL REFERENCES gmail_intake_notices(id) ON DELETE RESTRICT, " +
      "request_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('authorize','deny')), " +
      "revision INTEGER NOT NULL CHECK(revision>0), snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64), " +
      "actor TEXT NOT NULL, decided_at TEXT NOT NULL, PRIMARY KEY(notice_id,request_id)" +
      ");" +
      "CREATE TRIGGER IF NOT EXISTS gmail_intake_notice_snapshot_immutable " +
      "BEFORE UPDATE OF message_id,snapshot_hash,title,summary,relevance,reason,plate_hint,xp_hint " +
      "ON gmail_intake_notices BEGIN SELECT RAISE(ABORT,'Aviso imutavel apos recebimento'); END;"
    )
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export function hasGmailIntakeSchema(db: DatabaseSync): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gmail_intake_notices'").get()) &&
    Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gmail_intake_decisions'").get())
}
