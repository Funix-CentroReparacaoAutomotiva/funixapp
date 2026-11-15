import {randomUUID} from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { createV20AssociationSchema } from './chat/v20-associations.ts'
import {ConversationIdentities} from './chat/conversation-identities.ts'
import { createConversationIdentitySchema } from './chat/conversation-identities.ts'

/** V18, invoked inside the versioned migration transaction. No historical merges/backfill by phone. */
export function createCustomerSchema(db: DatabaseSync) {
  createConversationIdentitySchema(db)
  createV20AssociationSchema(db, true)
  db.exec(`
    ALTER TABLE atendimentos ADD COLUMN closed_at TEXT;
    ALTER TABLE v20_conversations ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE customer_records (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('entity','contact','vehicle')),
      data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      conversation_id TEXT UNIQUE REFERENCES chat_provider_conversations(id) ON DELETE RESTRICT,
      entity_id TEXT REFERENCES customer_records(id) ON DELETE RESTRICT
    );
    CREATE TABLE atendimento_references (
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK(kind IN ('person','contact','vehicle','payer')),
      position INTEGER NOT NULL CHECK(position>=0), record_id TEXT REFERENCES customer_records(id) ON DELETE RESTRICT,
      data TEXT NOT NULL, PRIMARY KEY(atendimento_id,kind,position)
    );
    CREATE TABLE chat_local_context_holds (
      conversation_id TEXT PRIMARY KEY REFERENCES v20_conversations(id) ON DELETE RESTRICT,
      reason TEXT NOT NULL
    );
    CREATE TABLE conversation_initialization (
      conversation_id TEXT PRIMARY KEY REFERENCES chat_provider_conversations(id) ON DELETE RESTRICT,
      atendimento_id TEXT REFERENCES atendimentos(id) ON DELETE RESTRICT,
      event_id TEXT NOT NULL, initialized_at TEXT NOT NULL,
      snapshot TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('created','reused','ambiguous','closed'))
    );
    CREATE TABLE atendimento_contact_events (
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      conversation_id TEXT NOT NULL REFERENCES chat_provider_conversations(id) ON DELETE RESTRICT,
      message_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
      PRIMARY KEY(atendimento_id,conversation_id,message_id)
    );
    CREATE TABLE conversation_message_reads (
      conversation_id TEXT NOT NULL REFERENCES chat_provider_conversations(id) ON DELETE RESTRICT,
      message_id TEXT NOT NULL, PRIMARY KEY(conversation_id,message_id)
    );
    CREATE TABLE conversation_read_state (
      conversation_id TEXT PRIMARY KEY REFERENCES chat_provider_conversations(id) ON DELETE RESTRICT,
      through_sequence INTEGER NOT NULL DEFAULT 0 CHECK(through_sequence>=0)
    );
    CREATE INDEX atendimento_contact_clock ON atendimento_contact_events(atendimento_id,occurred_at DESC);
    CREATE INDEX atendimento_reference_record ON atendimento_references(record_id,atendimento_id);
  `)
  // Promote only previously explicit technical links. No match on name/phone or message reassignment.
  db.exec(`INSERT OR IGNORE INTO v20_conversations(id,instance,remote_jid,created_at)
    SELECT id,instance,remote_jid,'1970-01-01T00:00:00.000Z' FROM chat_conversations;
    INSERT OR IGNORE INTO chat_provider_conversations(id,instance,remote_jid)
    SELECT v.id,v.instance,v.remote_jid FROM v20_conversations v JOIN chat_conversations c ON c.instance=v.instance AND c.remote_jid=v.remote_jid;`)
  for(const row of db.prepare(`SELECT l.*,v.id AS commercial_conversation FROM chat_links l JOIN chat_conversations c ON c.id=l.conversation_id JOIN v20_conversations v ON v.instance=c.instance AND v.remote_jid=c.remote_jid WHERE l.ended_at IS NULL`).all()){
    if(!db.prepare('SELECT 1 FROM v20_associations WHERE conversation_id=? AND atendimento_id=? AND unlinked_at IS NULL').get(row.commercial_conversation!,row.atendimento_id!)){
      db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)').run(randomUUID(),row.commercial_conversation!,row.atendimento_id!,row.started_at!,row.actor!,'V18: explicit legacy link')
      db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(row.commercial_conversation!)
    }
  }
  // Compatibility reads only local, previously confirmed links. No Coda API or external migration.
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='coda_sync_conversation_links'").get()){
    const identities=new ConversationIdentities(db)
    const ensure=(jid:string)=>{
      const id=identities.rememberProviderConversation(jid)
      db.prepare('INSERT OR IGNORE INTO v20_conversations(id,instance,remote_jid,created_at) VALUES(?,?,?,?)').run(id,'funix_comercial',identities.providerJid(id)!,new Date().toISOString())
      if(!db.prepare('SELECT 1 FROM v20_conversations WHERE id=?').get(id))throw Error('LOCAL_CONVERSATION_HANDLE_CONFLICT')
      return id
    }
    for(const row of db.prepare(`SELECT l.remote_jid,l.first_seen_at,a.atendimento_id FROM coda_sync_conversation_links l JOIN coda_sync_atendimentos a ON a.coda_row_id=l.coda_row_id WHERE l.instance='funix_comercial'`).all()){
      const id=ensure(String(row.remote_jid))
      if(!db.prepare('SELECT 1 FROM v20_associations WHERE conversation_id=? AND atendimento_id=? AND unlinked_at IS NULL').get(id,row.atendimento_id!)){
        db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,row.atendimento_id!,row.first_seen_at!,'system','V18: confirmed local binding snapshot')
        db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(id)
      }
    }
    for(const row of db.prepare(`SELECT x.remote_jid FROM coda_sync_context_conflicts x JOIN coda_sync_active_conversations a ON a.instance=x.instance AND a.remote_jid=x.remote_jid WHERE x.instance='funix_comercial' AND x.occurred_at>=a.occurred_at`).all())db.prepare('INSERT OR IGNORE INTO chat_local_context_holds VALUES(?,?)').run(ensure(String(row.remote_jid)),'confirmed_local_context_conflict')
  }

}
