import { randomUUID } from 'node:crypto'
import type { V20AssociationRepository } from './v20-associations.ts'
import type { CodaEventSyncRepository } from './coda-sync.ts'
import type { EvolutionReadPoc, ReadMessage } from '../experimental/evolution-read/client.ts'

/**
 * Single-operator V20 read-only bridge.
 * Ephemeral opaque conversation IDs prevent browser-controlled remoteJid queries.
 * Entries expire/restart with this backend; a list refresh re-registers the chat.
 * This is NOT the eventual persisted N:N conversation model.
 */
export function createEvolutionChatBridge(
  provider: Pick<EvolutionReadPoc, 'findChatsPage' | 'findMessages'>,
  now: () => number = Date.now,
  associations?: V20AssociationRepository,
  codaSync?: CodaEventSyncRepository,
) {
  const maxEntries = 2048
  const ttlMs = 30 * 60 * 1000
  const byId = new Map<string, { jid: string; at: number }>()
  const byJid = new Map<string, string>()

  const purge = () => {
    for (const [id, entry] of byId) {
      if (now() - entry.at >= ttlMs) {
        byId.delete(id)
        byJid.delete(entry.jid)
      }
    }
  }
  const register = (jid: string): string => {
    if (associations) return associations.rememberConversation('funix_comercial', jid).conversationId
    const known = byJid.get(jid)
    if (known && byId.has(known)) {
      byId.get(known)!.at = now()
      return known
    }
    while (byId.size >= maxEntries) {
      const oldest = byId.keys().next().value
      if (oldest === undefined) break
      const entry = byId.get(oldest)!
      byId.delete(oldest)
      byJid.delete(entry.jid)
    }
    const id = randomUUID()
    byId.set(id, { jid, at: now() })
    byJid.set(jid, id)
    return id
  }

  return {
    async list(skip: number): Promise<{
      items: Array<{ conversationId: string; displayName: string | null; phoneNumber: string | null; updatedAt: string | null; unreadCount: number | null; atendimentoId?: string | null }>
      nextSkip: number | null
      source: 'evolution'
    }> {
      purge()
      const take = 50
      const { items: rows, sourceCount } = await provider.findChatsPage({ take, skip })
      return {
        items: rows.map(row => ({
          conversationId: register(row.remoteJid),
          displayName: row.displayName,
          phoneNumber: row.phoneNumber,
          updatedAt: row.updatedAt,
          unreadCount: row.unreadCount,
          ...(codaSync ? { atendimentoId: codaSync.resolveActive(row.remoteJid) } : {}),
        })),
        nextSkip: sourceCount === take && skip + take <= 500000 ? skip + take : null,
        source: 'evolution',
      }
    },
    /** Resolve from the canonical active mapping, never from a phone or UI hint. */
    conversationForAtendimento(atendimentoId: string): { conversationId: string } | null {
      if (!codaSync) return null
      const jid = codaSync.resolveUniqueActiveJid(atendimentoId)
      if (!jid) return null
      return { conversationId: register(jid) }
    },
    /** Never disclose a conversation under a different Atendimento's context.
     * The conversationId stays opaque; the canonical Coda mapping is checked
     * server-side at the exact time of the read, not merely in the browser list.
     */
    async messagesForAtendimento(atendimentoId: string, conversationId: string, page: number) {
      purge()
      const entry = byId.get(conversationId)
      const jid = associations?.resolveRemoteJid(conversationId, 'funix_comercial') ?? entry?.jid
      if (!jid || !codaSync || codaSync.resolveActive(jid) !== atendimentoId) return null
      return this.messages(conversationId, page)
    },
    async messages(conversationId: string, page: number): Promise<{
      conversationId: string
      items: Array<Pick<ReadMessage, 'messageId' | 'timestamp' | 'fromMe' | 'origin' | 'kind' | 'text' | 'media' | 'statuses'>>
      page: number
      reportedTotal: number
      reportedPages: number
      nextPage: number | null
      consistency: 'offset-not-snapshot'
      historyComplete: 'unknown'
      source: 'evolution'
    } | null> {
      purge()
      const entry = byId.get(conversationId)
      const jid = associations?.resolveRemoteJid(conversationId, 'funix_comercial') ?? entry?.jid
      if (!jid) return null
      if (entry) entry.at = now()
      const result = await provider.findMessages(jid, { page })
      return {
        conversationId,
        items: result.items.map(({ messageId, timestamp, fromMe, origin, kind, text, media, statuses }) =>
          ({ messageId, timestamp, fromMe, origin, kind, text, media, statuses })),
        page: result.currentPage,
        reportedTotal: result.reportedTotal,
        reportedPages: result.reportedPages,
        nextPage: result.nextPage,
        consistency: 'offset-not-snapshot',
        historyComplete: 'unknown',
        source: 'evolution',
      }
    },
  }
}
export type EvolutionChatBridge = ReturnType<typeof createEvolutionChatBridge>
