import type { DatabaseSync } from 'node:sqlite'

/** Invoked only by the central versioned migration, in its transaction. */
export function createChatSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE chat_instances (
      instance TEXT PRIMARY KEY, activated_at TEXT NOT NULL
    );
    CREATE TABLE chat_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      instance TEXT NOT NULL REFERENCES chat_instances(instance) ON DELETE RESTRICT,
      event_id TEXT NOT NULL, digest TEXT NOT NULL, receipt_id TEXT NOT NULL UNIQUE,
      occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
      disposition TEXT NOT NULL CHECK(disposition IN ('projected','pending','quarantined','before_activation')),
      reason TEXT, payload TEXT,
      UNIQUE(instance,event_id)
    );
    CREATE TABLE chat_conversations (
      id TEXT PRIMARY KEY,
      instance TEXT NOT NULL REFERENCES chat_instances(instance) ON DELETE RESTRICT,
      remote_jid TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
      UNIQUE(instance,remote_jid)
    );
    CREATE TABLE chat_links (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE RESTRICT,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      revision INTEGER NOT NULL CHECK(revision>0),
      started_at TEXT NOT NULL, ended_at TEXT,
      actor TEXT NOT NULL, reason TEXT NOT NULL,
      UNIQUE(conversation_id,revision), UNIQUE(id,conversation_id)
    );
    CREATE UNIQUE INDEX chat_active_link ON chat_links(conversation_id) WHERE ended_at IS NULL;
    CREATE TABLE chat_messages (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE RESTRICT,
      message_id TEXT NOT NULL, content_digest TEXT NOT NULL,
      occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
      from_me INTEGER NOT NULL CHECK(from_me IN (0,1)),
      origin TEXT NOT NULL CHECK(origin IN ('external','unknown')),
      kind TEXT NOT NULL CHECK(kind IN ('text','image','audio','video','document','unsupported')),
      text TEXT, media TEXT,
      link_id TEXT,
      FOREIGN KEY(link_id,conversation_id) REFERENCES chat_links(id,conversation_id) ON DELETE RESTRICT,
      UNIQUE(conversation_id,message_id)
    );
    CREATE INDEX chat_messages_link_order ON chat_messages(link_id,occurred_at,sequence);
    CREATE TABLE chat_statuses (
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE RESTRICT,
      message_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('accepted','failed','delivered','read')),
      rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 4),
      PRIMARY KEY(conversation_id,message_id)
    );
    CREATE TABLE chat_link_receipts (
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE RESTRICT,
      request_id TEXT NOT NULL, digest TEXT NOT NULL,
      link_id TEXT NOT NULL REFERENCES chat_links(id) ON DELETE RESTRICT,
      revision INTEGER NOT NULL,
      PRIMARY KEY(conversation_id,request_id)
    );
  `)
}
