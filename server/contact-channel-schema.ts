import type {DatabaseSync} from 'node:sqlite'
import {normalizePhone} from './phone.ts'
import {createSendOperationSchema} from './chat/send-operations.ts'

/** V22: derived lookup only; no merge, association, message or historical document rewrite. */
export function createContactChannelSchema(db:DatabaseSync) {
  db.exec(`ALTER TABLE customer_records ADD COLUMN phone_normalized TEXT;
    CREATE INDEX customer_contact_phone ON customer_records(phone_normalized) WHERE kind='contact';
    CREATE INDEX customer_entity_contacts ON customer_records(entity_id) WHERE kind='contact';
    CREATE TABLE contact_channel_checks (
      contact_id TEXT PRIMARY KEY REFERENCES customer_records(id) ON DELETE RESTRICT,
      phone TEXT NOT NULL, provider_instance TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','available','unavailable','conflict')),
      checked_at INTEGER, next_check_at INTEGER NOT NULL, lease TEXT,
      conversation_id TEXT REFERENCES chat_provider_conversations(id) ON DELETE RESTRICT
    );`)
  for(const r of db.prepare("SELECT id,data FROM customer_records WHERE kind='contact'").all()) {
    const data=JSON.parse(String(r.data))
    db.prepare('UPDATE customer_records SET phone_normalized=? WHERE id=?').run(typeof data.text==='string'?normalizePhone(data.text):null,r.id!)
  }
  createSendOperationSchema(db)
}
