import type { DatabaseSync } from 'node:sqlite'

export function recordConfirmedSalesContact(db: DatabaseSync, atendimentoId: string, messageId: string, occurredAt: string) {
  // Older fixtures and revisions can load chat independently of the ERP migration.
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='erp_sales_contacts' AND type='table'").get()) return
  db.prepare(`INSERT INTO erp_sales_contacts(atendimento_id,message_id,occurred_at)
    VALUES(?,?,?) ON CONFLICT(atendimento_id,message_id) DO NOTHING`).run(atendimentoId, messageId, occurredAt)
}
