import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Durable, opaque provider-to-conversation identities for the owner-only inbox.
 * This table is intentionally independent of legacy chat_links and messages.
 * All writes are bounded to observed provider chat identities (never arbitrary URLs).
 */
export class EvolutionConversationStore {
  private readonly db: DatabaseSync
  private readonly instance: string
  constructor(db: DatabaseSync, instance: string) {
    this.db = db
    this.instance = instance
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(instance)) throw new Error('Invalid Evolution instance')
  }

  register(remoteJid: string): string {
    if (!/^(?:[0-9]{8,15}@s\.whatsapp\.net|[A-Za-z0-9_-]{1,100}@lid)$/.test(remoteJid)) {
      throw new Error('Invalid provider conversation')
    }
    const current = this.db.prepare('SELECT id FROM evolution_conversations WHERE instance=? AND remote_jid=?')
      .get(this.instance, remoteJid)
    if (current) return String(current.id)

    // Unique(instance,remote_jid) avoids duplicate identities on concurrent requests.
    this.db.prepare('INSERT OR IGNORE INTO evolution_conversations(id,instance,remote_jid,created_at) VALUES(?,?,?,?)')
      .run(randomUUID(), this.instance, remoteJid, new Date().toISOString())
    const row = this.db.prepare('SELECT id FROM evolution_conversations WHERE instance=? AND remote_jid=?')
      .get(this.instance, remoteJid)
    if (!row) throw new Error('Unable to register provider conversation')
    return String(row.id)
  }

  findRemoteJid(conversationId: string): string | null {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(conversationId)) return null
    const row = this.db.prepare('SELECT remote_jid FROM evolution_conversations WHERE instance=? AND id=?')
      .get(this.instance, conversationId)
    return row ? String(row.remote_jid) : null
  }
}
