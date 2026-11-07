import { randomUUID } from 'node:crypto'
import type { EvolutionReadPoc, ReadChat, ReadMessage } from '../experimental/evolution-read/client.ts'

/**
 * Single-operator V20 read-only bridge.
 * Ephemeral IDs prevent browser-controlled remoteJid queries.
 * Stable IDs belong in the future N:N schema migration, not a standalone upgrade.
 */
export function createEvolutionChatBridge(
  provider: Pick<EvolutionReadPoc, 'findChats' | 'findMessages'>,
  now: () => number = Date.now,
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
      items: Array<{ conversationId: string; updatedAt: string | null; unreadCount: number | null }>
      nextSkip: number | null
      source: 'evolution'
    }> {
      purge()
      const take = 50
      const rows: ReadChat[] = await provider.findChats({ take, skip })
      return {
        items: rows.map(row => ({ conversationId: register(row.remoteJid), updatedAt: row.updatedAt, unreadCount: row.unreadCount })),
        nextSkip: rows.length === take ? skip + take : null,
        source: 'evolution',
      }
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
      if (!entry) return null
      entry.at = now()
      const result = await provider.findMessages(entry.jid, { page })
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
