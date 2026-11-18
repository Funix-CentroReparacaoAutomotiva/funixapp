import type {DatabaseSync} from 'node:sqlite'
/** Synthetic fixture downgrade only; never used by application or real databases. */
export function removeV19FixtureSchema(db:DatabaseSync) {
 if(db.prepare('PRAGMA table_info(atendimentos)').all().some(r=>r.name==='purpose'))db.exec('ALTER TABLE atendimentos DROP COLUMN purpose; DELETE FROM schema_migrations WHERE version=23;')
 db.exec('DROP TABLE IF EXISTS contact_channel_checks; DELETE FROM schema_migrations WHERE version=22;')
 if(db.prepare('PRAGMA table_info(atendimentos)').all().some(row=>row.name==='delivery_date'))db.exec(`DROP TABLE work_order_revision_pdf_cache;DROP TABLE work_order_revisions;DROP TABLE atendimento_delivery_date_history;ALTER TABLE atendimentos DROP COLUMN delivery_date;DELETE FROM schema_migrations WHERE version=21;`)
 db.exec(`DROP TABLE IF EXISTS budget_cancellations; DELETE FROM schema_migrations WHERE version=20;
 DROP TABLE IF EXISTS conversation_message_reads; DROP TABLE IF EXISTS conversation_read_state;
 DROP TABLE IF EXISTS chat_local_context_holds;DROP TABLE IF EXISTS atendimento_contact_events;DROP TABLE IF EXISTS conversation_initialization;
 DROP TABLE IF EXISTS atendimento_references;DROP TABLE IF EXISTS customer_records;
 DROP TABLE IF EXISTS v20_association_receipts;DROP TABLE IF EXISTS v20_active_context;DROP TABLE IF EXISTS v20_associations;DROP TABLE IF EXISTS v20_conversations;
 DROP TABLE IF EXISTS chat_provider_alias_evidence;DROP TABLE IF EXISTS chat_provider_conversations;
 ALTER TABLE atendimentos DROP COLUMN closed_at;DELETE FROM schema_migrations WHERE version=19;`)
}
