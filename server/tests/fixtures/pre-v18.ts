import type {DatabaseSync} from 'node:sqlite'
/** Synthetic fixture downgrade only; never used by application or real databases. */
export function removeV18FixtureSchema(db:DatabaseSync) {
 db.exec(`DROP TABLE IF EXISTS conversation_message_reads; DROP TABLE IF EXISTS conversation_read_state;
 DROP TABLE IF EXISTS chat_local_context_holds;DROP TABLE IF EXISTS atendimento_contact_events;DROP TABLE IF EXISTS conversation_initialization;
 DROP TABLE IF EXISTS atendimento_references;DROP TABLE IF EXISTS customer_records;
 DROP TABLE IF EXISTS v20_association_receipts;DROP TABLE IF EXISTS v20_active_context;DROP TABLE IF EXISTS v20_associations;DROP TABLE IF EXISTS v20_conversations;
 DROP TABLE IF EXISTS chat_provider_alias_evidence;DROP TABLE IF EXISTS chat_provider_conversations;
 ALTER TABLE atendimentos DROP COLUMN closed_at;DELETE FROM schema_migrations WHERE version=18;`)
}
