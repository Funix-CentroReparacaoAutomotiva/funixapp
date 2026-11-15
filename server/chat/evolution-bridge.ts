import type {ProfilePhotoGateway} from './profile-photo.ts'
import { ServiceError } from '../errors.ts'
import { EvolutionReadError } from '../experimental/evolution-read/client.ts'
import type { ConversationStore } from './conversation-store.ts'
import type { SendOperations, SendCommand } from './send-operations.ts'
import { randomUUID } from 'node:crypto'
import type { V20AssociationRepository } from './v20-associations.ts'
import type { CodaEventSyncRepository } from './coda-sync.ts'
import type { LocalConversationAssociations } from './local-associations.ts'
import type { CommercialConversation } from '../../shared/customer.ts'
export type ChatIdentityAuthority = Pick<CodaEventSyncRepository, 'resolveIdentityActive'|'identityJids'|'rememberProviderConversation'|'rememberProviderAliases'|'providerJid'|'resolveIdentityJid'|'identityState'|'contextToken'|'resolveActive'> & Partial<Pick<LocalConversationAssociations,'projection'|'projections'|'markRead'|'recordAccepted'>>
import type { EvolutionReadPoc } from '../experimental/evolution-read/client.ts'
import type { EvolutionTextSender } from './evolution-send.ts'
import type { MediaGateway, MediaInput } from './evolution-media.ts'

/** Single-operator channel bridge. Identity and commercial authorization are separate
 * from provider transport; local authority uses the existing PN/LID protections.
 * Legacy injected authorities remain supported without becoming a prerequisite.
 */
export function createEvolutionChatBridge(
  provider: Pick<EvolutionReadPoc, 'findChatsPage' | 'findMessages'> &
    Partial<Pick<EvolutionReadPoc, 'findMediaEnvelope'>>,
  now: () => number = Date.now,
  associations?: V20AssociationRepository,
  codaSync?: ChatIdentityAuthority,
  sendText?: EvolutionTextSender,
  media?: MediaGateway,
  local?: { store: ConversationStore; sends: SendOperations; read: boolean },
  profilePhoto?:ProfilePhotoGateway,
) {
  const maxEntries = 2048
  const ttlMs = 30 * 60 * 1000
  const byId = new Map<string, { jid: string; at: number }>()
  const byJid = new Map<string, string>()
  const pendingSends = new Set<string>()
  // Durable provider evidence and canonical Coda association have distinct owners.
  const canonicalFor = (primary: string): string | null =>
    codaSync?.resolveIdentityActive(primary) ?? null

  const purge = () => {
    for (const [id, entry] of byId) {
      if (now() - entry.at >= ttlMs) {
        byId.delete(id)
        byJid.delete(entry.jid)
      }
    }
  }
  // Resolve a provider-compatible PN only from an exact, unique alias.
  // Never ask the Evolution sender to infer the destination from a LID.
  const sendTarget = (primary: string): string | null => {
    const members = codaSync?.identityJids(primary)
    return members?.find((value) => /^[0-9]{8,15}@s\.whatsapp\.net$/.test(value)) ?? null
  }

  const register = (jid: string): string => {
    if (codaSync) return codaSync.rememberProviderConversation(jid)
    if (associations)
      return associations.rememberConversation('funix_comercial', jid).conversationId
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

  const historyJid = (remoteJid: string) => codaSync?.identityJids(remoteJid)?.[0] ?? remoteJid

  return {
    async profilePhoto(conversationId:string){
      const jid=codaSync?.providerJid(conversationId)
      const pn=jid?sendTarget(jid):null
      if(!pn||!profilePhoto)return null
      const value=await profilePhoto(pn.split('@')[0]!)
      return jid&&sendTarget(jid)===pn?value:null
    },
    async list(skip: number): Promise<{
      items: Array<{
        conversationId: string
        displayName: string | null
        phoneNumber: string | null
        updatedAt: string | null
        unreadCount: number | null
        atendimentoId?: string | null
        commercial?: CommercialConversation
      }>
      nextSkip: number | null
      source: 'evolution' | 'local'
      providerUnavailable?: boolean
    }> {
      purge()
      const take = 50
      let rows,
        sourceCount,
        source: 'evolution' | 'local' = 'evolution',
        providerUnavailable = false
      try {
        const result = await provider.findChatsPage({ take, skip })
        rows = result.items
        sourceCount = result.sourceCount
      } catch (error) {
        if (!local?.read) throw error
        rows = local.store.list(skip)
        sourceCount = rows.length
        source = 'local'
        providerUnavailable = true
        if (!rows.length && skip === 0) throw error
      }

      if (source === 'evolution') local?.store.observeChats(rows)
      // Scan the entire provider page before resolving any links to detect collisions.
      codaSync?.rememberProviderAliases(rows, false, 'findChats')
      if (local?.read) {
        rows = local.store.list(skip)
        sourceCount = rows.length
        source = 'local'
      }
      const projections=codaSync?.projections?.(rows.map(r=>r.remoteJid))
      return {
        items: [
          ...new Map(
            rows.map((row) => {
              const conversationId = register(
                codaSync?.identityJids(row.remoteJid)?.[0] ?? row.remoteJid,
              )
              return [
                conversationId,
                {
                  conversationId,
                  displayName: row.displayName,
                  phoneNumber: row.phoneNumber,
                  updatedAt: row.updatedAt,
                  unreadCount: row.unreadCount,
                  ...(projections?.get(row.remoteJid) ? {commercial: {...projections.get(row.remoteJid)!,profilePhoto:profilePhoto&&sendTarget(row.remoteJid)?'/api/chat/conversations/'+conversationId+'/profile-photo':null},unreadCount:projections.get(row.remoteJid)!.unreadCount,phoneNumber:projections.get(row.remoteJid)!.phoneNumber,updatedAt:projections.get(row.remoteJid)!.lastMessageAt??row.updatedAt}:{}),
                  ...(codaSync ? { atendimentoId: canonicalFor(row.remoteJid) } : {}),
                },
              ] as const
            }),
          ).values(),
        ],
        nextSkip: sourceCount === take && skip + take <= 500000 ? skip + take : null,
        source,
        ...(local?.read ? { providerUnavailable } : {}),
      }
    },
    /** Resolve from the canonical active mapping, never from a phone or UI hint. */
    conversationForAtendimento(atendimentoId: string): { conversationId: string } | null {
      if (!codaSync) return null
      const jid = codaSync.resolveIdentityJid(atendimentoId)
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
      const jid =
        codaSync?.providerJid(conversationId) ??
        associations?.resolveRemoteJid(conversationId, 'funix_comercial') ??
        entry?.jid
      if (!jid) return null
      if (entry) entry.at = now()
      return canonicalFor(jid)
    },
    conversationState(conversationId: string) {
      const jid =
        codaSync?.providerJid(conversationId) ??
        associations?.resolveRemoteJid(conversationId, 'funix_comercial')
      return jid && codaSync ? codaSync.identityState(jid) : 'missing_confirmation'
    },
    /** Never disclose a conversation under a different Atendimento's context.
     * The conversationId stays opaque; the canonical Coda mapping is checked
     * server-side at the exact time of the read, not merely in the browser list.
     */
    /** Send only to the same active canonical Coda JID used for reading.
     * If sending is disabled, never expose a browser-controlled WhatsApp recipient.
     */
    async sendTextForAtendimento(
      atendimentoId: string,
      conversationId: string,
      text: string,
      command?: SendCommand,
    ) {
      if (
        !sendText ||
        !codaSync ||
        typeof text !== 'string' ||
        text.trim().length === 0 ||
        [...text].length > 4096 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
      )
        return { state: 'invalid' as const }
      purge()
      const entry = byId.get(conversationId)
      const remoteJid =
        codaSync?.providerJid(conversationId) ??
        associations?.resolveRemoteJid(conversationId, 'funix_comercial') ??
        entry?.jid
      const recipient = remoteJid ? sendTarget(remoteJid) : null
      if (
        !remoteJid ||
        !recipient ||
        canonicalFor(remoteJid) !== atendimentoId ||
        codaSync.resolveActive(recipient) !== atendimentoId
      )
        return { state: 'unlinked' as const }
      if (local && (!command || command.contextToken !== codaSync.contextToken(remoteJid)))
        return { state: 'unlinked' as const }
      if (pendingSends.has(conversationId)) return { state: 'busy' as const }
      pendingSends.add(conversationId)
      try {
        // Revalidate before any network side effect, including an active-context switch.
        if (
          canonicalFor(remoteJid) !== atendimentoId ||
          codaSync.resolveActive(recipient) !== atendimentoId
        )
          return { state: 'unlinked' as const }
        const receipt =
          local && command
            ? await local.sends.run(command, recipient, ['text', text], () =>
                sendText(recipient, text),
              )
            : await sendText(recipient, text)
        codaSync.recordAccepted?.(atendimentoId,remoteJid,receipt.messageId)
        return { state: 'accepted' as const, receipt }
      } finally {
        pendingSends.delete(conversationId)
      }
    },
    /** Media actions always require canonical active mapping, never a browser-supplied JID. */
    async sendMediaForAtendimento(
      atendimentoId: string,
      conversationId: string,
      item: MediaInput,
      command?: SendCommand,
    ) {
      if (!media || !codaSync) return { state: 'invalid' as const }
      const entry = byId.get(conversationId)
      const jid =
        codaSync?.providerJid(conversationId) ??
        associations?.resolveRemoteJid(conversationId, 'funix_comercial') ??
        entry?.jid
      const recipient = jid ? sendTarget(jid) : null
      if (
        !jid ||
        !recipient ||
        canonicalFor(jid) !== atendimentoId ||
        codaSync.resolveActive(recipient) !== atendimentoId
      )
        return { state: 'unlinked' as const }
      if (local && (!command || command.contextToken !== codaSync.contextToken(jid)))
        return { state: 'unlinked' as const }
      if (pendingSends.has(conversationId)) return { state: 'busy' as const }
      pendingSends.add(conversationId)
      try {
        if (
          canonicalFor(jid) !== atendimentoId ||
          codaSync.resolveActive(recipient) !== atendimentoId
        )
          return { state: 'unlinked' as const }
        const receipt =
          local && command
            ? await local.sends.run(command, recipient, ['media', item], () =>
                media.send(recipient, item),
              )
            : await media.send(recipient, item)
        codaSync.recordAccepted?.(atendimentoId,jid,receipt.messageId)
        return { state: 'accepted' as const, receipt }
      } finally {
        pendingSends.delete(conversationId)
      }
    },
    async mediaForAtendimento(
      atendimentoId: string,
      conversationId: string,
      messageId: string,
      page: number,
    ) {
      if (!media || !codaSync) return null
      const entry = byId.get(conversationId)
      const jid =
        codaSync?.providerJid(conversationId) ??
        associations?.resolveRemoteJid(conversationId, 'funix_comercial') ??
        entry?.jid
      if (!jid || canonicalFor(jid) !== atendimentoId) return null
      const localMediaState = () => {
        if (!local?.read) return 'legacy'
        const message = local.store.states(jid, [{ messageId }])[0]
        return message && ['image', 'video', 'audio'].includes(message.kind)
          ? JSON.stringify([message.kind, message.fromMe, message.media])
          : null
      }
      const expectedMedia = localMediaState()
      if (expectedMedia === null) return null
      // Fetch the full envelope on the server only. Never return raw provider data.
      const item = await provider.findMediaEnvelope?.(historyJid(jid), messageId, page)
      if (!item) return null
      const key = item.envelope.key as { remoteJid?: unknown; remoteJidAlt?: unknown } | undefined
      if (typeof key?.remoteJid === 'string')
        codaSync.rememberProviderAliases([
          {
            remoteJid: key.remoteJid,
            remoteJidAlt: typeof key.remoteJidAlt === 'string' ? key.remoteJidAlt : null,
          },
        ])
      if (canonicalFor(jid) !== atendimentoId || localMediaState() !== expectedMedia) return null
      if (item.bytes !== null && item.bytes > 12 * 1024 * 1024)
        return { state: 'too_large' as const }
      if (canonicalFor(jid) !== atendimentoId || localMediaState() !== expectedMedia) return null
      const result = await media.get(item.envelope, item.kind)
      if (canonicalFor(jid) !== atendimentoId || localMediaState() !== expectedMedia) return null
      return { state: 'ready' as const, ...result }
    },
    async messageStates(
      atendimentoId: string,
      conversationId: string,
      messages: Array<{ messageId: string; version?: string }>,
    ) {
      if (
        !local?.read ||
        !codaSync ||
        this.activeAtendimentoForConversation(conversationId) !== atendimentoId
      )
        return null
      const jid =
        codaSync.providerJid(conversationId) ??
        associations?.resolveRemoteJid(conversationId, 'funix_comercial')
      if (!jid) return null
      const items = local.store.states(jid, messages)
      if (canonicalFor(jid) !== atendimentoId) return null
      return {
        conversationId,
        items,
        page: 1,
        nextPage: null,
        nextCursor: null,
        reportedTotal: items.length,
        reportedPages: items.length ? 1 : 0,
        source: 'local' as const,
        consistency: 'local-keyset' as const,
        historyComplete: 'unknown' as const,
      }
    },
    async recoverHistory(atendimentoId: string, conversationId: string, page: number) {
      if (
        !local ||
        !codaSync ||
        this.activeAtendimentoForConversation(conversationId) !== atendimentoId
      )
        return null
      const jid =
        codaSync.providerJid(conversationId) ??
        associations?.resolveRemoteJid(conversationId, 'funix_comercial')
      if (!jid) return null
      const before = codaSync.contextToken(jid)
      const members = codaSync.identityJids(jid)
      if (!members) return null
      let imported = 0,
        more = false
      for (const member of members) {
        const part = await provider.findMessages(member, { page })
        local.store.observePage(member, part.items, page)
        imported += part.items.length
        more ||= part.nextPage !== null
        if (before !== codaSync.contextToken(jid) || canonicalFor(jid) !== atendimentoId)
          return null
      }
      if (before !== codaSync.contextToken(jid) || canonicalFor(jid) !== atendimentoId) return null
      return {
        imported,
        nextPage: more && page < 1000 ? page + 1 : null,
        historyComplete: 'unknown' as const,
      }
    },
    async messagesForAtendimento(
      atendimentoId: string,
      conversationId: string,
      page: number,
      cursor?: string,
    ) {
      purge()
      const entry = byId.get(conversationId)
      const jid =
        codaSync?.providerJid(conversationId) ??
        associations?.resolveRemoteJid(conversationId, 'funix_comercial') ??
        entry?.jid
      if (!jid || !codaSync || canonicalFor(jid) !== atendimentoId) return null
      const result = await this.messages(conversationId, page, cursor)
      // The canonical active Atendimento may change while Evolution responds.
      // Never return a stale conversation under a different Atendimento.
      return canonicalFor(jid) === atendimentoId && result
        ? {
            ...result,
            contextToken: local ? codaSync.contextToken(jid) : undefined,
            sendTextAvailable: Boolean(
              sendText &&
                sendTarget(jid) &&
                codaSync.resolveActive(sendTarget(jid)!) === atendimentoId,
            ),
            mediaSendAvailable: Boolean(
              media &&
                sendTarget(jid) &&
                codaSync.resolveActive(sendTarget(jid)!) === atendimentoId,
            ),
            mediaReadAvailable: Boolean(media),
          }
        : null
    },
    async messages(conversationId: string, page: number, cursor?: string) {
      purge()
      const entry = byId.get(conversationId)
      const jid =
        codaSync?.providerJid(conversationId) ??
        associations?.resolveRemoteJid(conversationId, 'funix_comercial') ??
        entry?.jid
      if (!jid) return null
      if (entry) entry.at = now()
      const active = codaSync ? canonicalFor(jid) : null
      if (codaSync && !active) return null
      if (local?.read) {
        // Local is the authoritative read source. Refresh page 1 only; provider failure
        // cannot be misreported as an empty result if no local message is available.
        let providerUnavailable = false
        if (
          page === 1 &&
          local.store.page(jid, 1).reportedTotal === 0 &&
          !local.store.health(jid).lastProviderSync
        ) {
          try {
            const update = await provider.findMessages(historyJid(jid), { page: 1 })
            local.store.observePage(jid, update.items, 1)
          } catch (error) {
            if (
              error instanceof ServiceError ||
              (error instanceof EvolutionReadError &&
                (error.code === 'SCOPE' || error.code === 'CONFLICT'))
            )
              throw error
            local.store.providerFailure(jid)
            providerUnavailable = true
          }
        }
        if (codaSync && canonicalFor(jid) !== active) return null
        const result = local.store.page(jid, page, cursor)
        codaSync?.markRead?.(jid,result.items.map(m=>m.messageId))
        if (providerUnavailable && result.reportedTotal === 0)
          throw new EvolutionReadError('TRANSPORT')
        return {
          conversationId,
          ...result,
          ...local.store.health(jid),
          providerUnavailable: providerUnavailable || local.store.health(jid).providerUnavailable,
        }
      }
      if (cursor) return null
      const result = await provider.findMessages(historyJid(jid), { page })
      local?.store.observePage(jid, result.items, page)
      codaSync?.rememberProviderAliases(result.items, false, 'findMessages')
      if (codaSync && canonicalFor(jid) !== active) return null
      return {
        conversationId,
        items: result.items.map(
          ({ messageId, timestamp, fromMe, origin, kind, text, media, statuses }) => ({
            messageId,
            timestamp,
            fromMe,
            origin,
            kind,
            text,
            media,
            statuses,
          }),
        ),
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
