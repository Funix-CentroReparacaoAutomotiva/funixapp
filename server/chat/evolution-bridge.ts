import { randomUUID } from 'node:crypto'
import type { V20AssociationRepository } from './v20-associations.ts'
import type { CodaEventSyncRepository } from './coda-sync.ts'
import type { EvolutionReadPoc, ReadMessage } from '../experimental/evolution-read/client.ts'
import type { EvolutionTextSender } from './evolution-send.ts'
import type { MediaGateway, MediaInput } from './evolution-media.ts'

/**
 * Single-operator V20 read-only bridge.
 * Ephemeral opaque conversation IDs prevent browser-controlled remoteJid queries.
 * Entries expire/restart with this backend; a list refresh re-registers the chat.
 * This is NOT the eventual persisted N:N conversation model.
 */
export function createEvolutionChatBridge(
  provider: Pick<EvolutionReadPoc, 'findChatsPage' | 'findMessages'> & Partial<Pick<EvolutionReadPoc, 'findMediaEnvelope'>>,
  now: () => number = Date.now,
  associations?: V20AssociationRepository,
  codaSync?: CodaEventSyncRepository,
  sendText?: EvolutionTextSender,
  media?: MediaGateway,
) {
  const maxEntries = 2048
  const ttlMs = 30 * 60 * 1000
  const byId = new Map<string, { jid: string; at: number }>()
  const byJid = new Map<string, string>()
  const pendingSends = new Set<string>()
  // Aliases are evidence from findChats.lastMessage.key, never inferred from labels.
  // Keep the original JID for Evolution history; use the PN alias only for Coda identity.
  const alternateByPrimary = new Map<string, string>()
  const primariesByAlternate = new Map<string, Set<string>>()
  const rememberAlias = (primary: string, alternate?: string | null) => {
    const previous = alternateByPrimary.get(primary)
    if (previous) {
      const owners = primariesByAlternate.get(previous)
      owners?.delete(primary)
      if (!owners?.size) primariesByAlternate.delete(previous)
    }
    alternateByPrimary.delete(primary)
    if (!alternate || alternate === primary) return
    alternateByPrimary.set(primary, alternate)
    const owners = primariesByAlternate.get(alternate) ?? new Set<string>()
    owners.add(primary)
    primariesByAlternate.set(alternate, owners)
  }
  const canonicalFor = (primary: string): string | null => {
    if (!codaSync) return null
    const direct = codaSync.resolveActive(primary)
    const alternate = alternateByPrimary.get(primary)
    if (!alternate) return direct
    // A conflicting alias must never select a potentially different customer.
    if (primariesByAlternate.get(alternate)?.size !== 1) return null
    const linked = codaSync.resolveActive(alternate)
    if (direct && linked && direct !== linked) return null
    return direct ?? linked
  }

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
      // Scan the entire provider page before resolving any links to detect collisions.
      for (const row of rows) rememberAlias(row.remoteJid, row.remoteJidAlt)
      return {
        items: rows.map(row => ({
          conversationId: register(row.remoteJid),
          displayName: row.displayName,
          phoneNumber: row.phoneNumber,
          updatedAt: row.updatedAt,
          unreadCount: row.unreadCount,
          ...(codaSync ? { atendimentoId: canonicalFor(row.remoteJid) } : {}),
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
    /** Refreshes the authoritative active context for an opaque conversation ID.
     * A list may be stale when the signed Coda event arrives after its response.
     * This check never guesses by phone and never creates or changes links.
     */
    activeAtendimentoForConversation(conversationId: string): string | null {
      if (!codaSync) return null
      purge()
      const entry = byId.get(conversationId)
      const jid = associations?.resolveRemoteJid(conversationId, 'funix_comercial') ?? entry?.jid
      if (!jid) return null
      if (entry) entry.at = now()
      return canonicalFor(jid)
    },
    /** Never disclose a conversation under a different Atendimento's context.
     * The conversationId stays opaque; the canonical Coda mapping is checked
     * server-side at the exact time of the read, not merely in the browser list.
     */
    /** Send only to the same active canonical Coda JID used for reading.
     * If sending is disabled, never expose a browser-controlled WhatsApp recipient.
     */
    async sendTextForAtendimento(atendimentoId: string, conversationId: string, text: string) {
      if (!sendText || !codaSync || typeof text !== 'string' ||
          text.trim().length === 0 || [...text].length > 4096 ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return { state: 'invalid' as const }
      purge()
      const entry = byId.get(conversationId)
      const remoteJid = associations?.resolveRemoteJid(conversationId, 'funix_comercial') ?? entry?.jid
      if (!remoteJid || !/^[0-9]{8,15}@s\.whatsapp\.net$/.test(remoteJid) ||
          canonicalFor(remoteJid) !== atendimentoId) return { state: 'unlinked' as const }
      if (pendingSends.has(conversationId)) return { state: 'busy' as const }
      pendingSends.add(conversationId)
      try {
        // Revalidate before any network side effect, including an active-context switch.
        if (canonicalFor(remoteJid) !== atendimentoId) return { state: 'unlinked' as const }
        const receipt = await sendText(remoteJid, text)
        return { state: 'accepted' as const, receipt }
      } finally { pendingSends.delete(conversationId) }
    },
    /** Media actions always require canonical active mapping, never a browser-supplied JID. */
    async sendMediaForAtendimento(atendimentoId:string,conversationId:string,item:MediaInput){
      if(!media||!codaSync)return {state:'invalid' as const}
      const entry=byId.get(conversationId)
      const jid=associations?.resolveRemoteJid(conversationId,'funix_comercial')??entry?.jid
      if(!jid||!/^[0-9]{8,15}@s\.whatsapp\.net$/.test(jid)||
        canonicalFor(jid)!==atendimentoId)return {state:'unlinked' as const}
      if(pendingSends.has(conversationId))return {state:'busy' as const}
      pendingSends.add(conversationId)
      try{
        if(canonicalFor(jid)!==atendimentoId)return {state:'unlinked' as const}
        const receipt=await media.send(jid,item)
        return {state:'accepted' as const,receipt}
      }finally{pendingSends.delete(conversationId)}
    },
    async mediaForAtendimento(atendimentoId:string,conversationId:string,messageId:string,page:number){
      if(!media||!codaSync)return null
      const entry=byId.get(conversationId)
      const jid=associations?.resolveRemoteJid(conversationId,'funix_comercial')??entry?.jid
      if(!jid||canonicalFor(jid)!==atendimentoId)return null
      // Fetch the full envelope on the server only. Never return raw provider data.
      const item=await provider.findMediaEnvelope?.(jid,messageId,page)
      if(!item)return null
      if(item.bytes!==null&&item.bytes>12*1024*1024)return {state:'too_large' as const}
      if(canonicalFor(jid)!==atendimentoId)return null
      const result=await media.get(item.envelope,item.kind)
      if(canonicalFor(jid)!==atendimentoId)return null
      return {state:'ready' as const,...result}
    },
    async messagesForAtendimento(atendimentoId: string, conversationId: string, page: number) {
      purge()
      const entry = byId.get(conversationId)
      const jid = associations?.resolveRemoteJid(conversationId, 'funix_comercial') ?? entry?.jid
      if (!jid || !codaSync || canonicalFor(jid) !== atendimentoId) return null
      const result = await this.messages(conversationId, page)
      // The canonical active Atendimento may change while Evolution responds.
      // Never return a stale conversation under a different Atendimento.
      return canonicalFor(jid) === atendimentoId && result
        ? { ...result, sendTextAvailable: Boolean(sendText), mediaSendAvailable: Boolean(media), mediaReadAvailable: Boolean(media) } : null
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
