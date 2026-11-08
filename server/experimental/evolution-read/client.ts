// Issue #71: offline spike. No default transport, environment, bootstrap or route.
export type ReadRequest = {
  method: 'POST'
  path: string
  body: Record<string, unknown>
  signal: AbortSignal
}
export type ReadTransport = (request: ReadRequest) => Promise<{ status: number; body: unknown }>
export type ReadFailure = 'INPUT' | 'HTTP' | 'TRANSPORT' | 'TIMEOUT' | 'CANCELLED' | 'RESPONSE' | 'SCOPE' | 'CONFLICT'
export class EvolutionReadError extends Error {
  readonly code: ReadFailure
  readonly httpStatus?: number
  constructor(code: ReadFailure, httpStatus?: number) {
    super(`Evolution read POC: ${code}`)
    this.name = 'EvolutionReadError'; this.code = code; this.httpStatus = httpStatus
  }
}
const fail = (code: ReadFailure = 'RESPONSE'): never => { throw new EvolutionReadError(code) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}
function string(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.length || value.length > max ||
    [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return fail()
  return value
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return fail()
  return Number(value)
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return fail(); return value }
function jid(value: unknown): string {
  const text = string(value, 150)
  // Individual PN/LID only. Opaque LID is never converted to a phone or merged.
  if (!/^(?:[0-9]{8,15}@s\.whatsapp\.net|[A-Za-z0-9_-]{1,100}@lid)$/.test(text)) return fail()
  return text
}
function input<T>(parse: () => T): T { try { return parse() } catch { return fail('INPUT') } }
/**
 * A provider pushName is a presentation hint, not verified person identity.
 * Ignore invalid/malformed names instead of leaking JIDs or failing all chats.
 */
function displayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || [...trimmed].length > 80 ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(trimmed) ||
      /@(?:s\.whatsapp\.net|lid|g\.us)/i.test(trimmed)) return null
  return trimmed
}

export type ReadMessage = {
  recordId: string
  instanceId: string
  messageId: string
  remoteJid: string
  remoteJidAlt: string | null
  timestamp: number
  fromMe: boolean
  origin: 'unknown'
  kind: 'text' | 'image' | 'audio' | 'video' | 'document' | 'unsupported'
  text: string | null
  // No provider URL, directPath, mediaKey, binary, caption or file name escapes.
  media: { reference: string; mimeType: string | null; bytes: number | null; available: false } | null
  statuses: string[]
}
export type ReadChat = { remoteJid: string; displayName: string | null; phoneNumber: string | null; updatedAt: string | null; unreadCount: number | null }
export type MessagePage = {
  items: ReadMessage[]
  currentPage: number
  reportedTotal: number
  reportedPages: number
  nextPage: number | null
  consistency: 'offset-not-snapshot'
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const identity = (m: ReadMessage) => JSON.stringify([m.instanceId, m.remoteJid, m.messageId])
/** Pure, bounded-to-caller batches. Dedup cannot repair unseen gaps or alias changes. */
export function reconcileReadBatches(...batches: ReadMessage[][]): ReadMessage[] {
  const byId = new Map<string, ReadMessage>()
  for (const m of batches.flat()) {
    const key = identity(m), previous = byId.get(key)
    if (previous && JSON.stringify(previous) !== JSON.stringify(m)) return fail('CONFLICT')
    byId.set(key, m)
  }
  // Presentation tie-break only, never a provider cursor or causal ordering.
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp || compare(identity(a), identity(b)))
}

export class EvolutionReadPoc {
  private readonly transport: ReadTransport
  private readonly instance: string
  private readonly instanceId: string
  private readonly timeoutMs: number
  constructor(options: { transport: ReadTransport; instance: string; instanceId: string; timeoutMs?: number }) {
    this.transport = options.transport
    this.instance = input(() => {
      const alias = string(options.instance, 80)
      if (!/^[A-Za-z0-9_-]+$/.test(alias)) return fail()
      return alias
    })
    this.instanceId = input(() => string(options.instanceId))
    this.timeoutMs = input(() => integer(options.timeoutMs ?? 5000, 1, 60000))
  }
  private async request(operation: 'findChats' | 'findMessages', body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return fail('CANCELLED')
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel = () => {}
    const interrupted = new Promise<never>((_, reject) => {
      cancel = () => { reject(new EvolutionReadError('CANCELLED')); controller.abort() }
      signal?.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => { reject(new EvolutionReadError('TIMEOUT')); controller.abort() }, this.timeoutMs)
    })
    try {
      // Promise.race also bounds an injected transport which ignores cancellation.
      const response = await Promise.race([
        Promise.resolve().then(() => this.transport({ method: 'POST', path: `/chat/${operation}/${this.instance}`, body, signal: controller.signal })),
        interrupted,
      ])
      const status = integer(response.status, 100, 599)
      if (status !== 200) throw new EvolutionReadError('HTTP', status)
      return response.body
    } catch (error) {
      if (error instanceof EvolutionReadError) throw error
      // Never propagate provider body, exception message, credentials or URL.
      return fail('TRANSPORT')
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel)
    }
  }
  /**
   * One bounded Evolution source page, not a page of *visible* contacts.
   * sourceCount deliberately includes unsupported group/broadcast/newsletter chats,
   * so the caller advances the original skip/take cursor without losing rows.
   */
  async findChatsPage(options: { take?: number; skip?: number; signal?: AbortSignal } = {}): Promise<{ items: ReadChat[]; sourceCount: number }> {
    const take = input(() => integer(options.take ?? 50, 1, 100))
    const skip = input(() => integer(options.skip ?? 0, 0, 500000))
    // fetchChats consumes take/skip, NOT Query.page/offset. Never loop over an unknown source.
    const raw = await this.request('findChats', { take, skip }, options.signal)
    if (!Array.isArray(raw) || raw.length > take) return fail()
    const seen = new Set<string>()
    const items: ReadChat[] = []
    for (const value of raw) {
      const row = object(value)
      const identifier = string(row.remoteJid, 150)
      // Only these explicitly recognized non-individual types are excluded.
      // Unknown suffixes and malformed PN/LID still fail closed for this page.
      if (/^[A-Za-z0-9_-]{1,100}@(g\.us|broadcast|newsletter)$/.test(identifier)) continue
      const remoteJid = jid(identifier)
      if (seen.has(remoteJid)) return fail('CONFLICT')
      seen.add(remoteJid)
      let updatedAt: string | null = null
      if (row.updatedAt != null) {
        updatedAt = string(row.updatedAt, 40)
        if (!Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt) return fail()
      }
      // Project only safe identification hints; never lastMessage/profile/avatar URLs, provider JID is server-only.
      items.push({ remoteJid,
        displayName: displayName(row.pushName),
        phoneNumber: remoteJid.endsWith('@s.whatsapp.net') ? remoteJid.slice(0, -'@s.whatsapp.net'.length) : null,
        updatedAt, unreadCount: row.unreadCount == null ? null : integer(row.unreadCount) })
    }
    return { items, sourceCount: raw.length }
  }
  /** Compatibility for offline POC consumers that need only individual rows. */
  async findChats(options: { take?: number; skip?: number; signal?: AbortSignal } = {}): Promise<ReadChat[]> {
    return (await this.findChatsPage(options)).items
  }
  async findMessages(remoteJid: string, options: { page?: number; signal?: AbortSignal } = {}): Promise<MessagePage> {
    const requested = input(() => jid(remoteJid)), page = input(() => integer(options.page ?? 1, 1, 10000))
    // Both OR operands supplied to avoid an empty JSON predicate widening scope.
    // No fromMe filter: public code tests truthiness and ignores false.
    const raw = object(await this.request('findMessages', { where: { key: { remoteJid: requested, remoteJidAlt: requested } }, page, offset: 50 }, options.signal))
    const messages = object(raw.messages)
    const currentPage = integer(messages.currentPage, 1)
    const reportedTotal = integer(messages.total), reportedPages = integer(messages.pages)
    if (currentPage !== page || !Array.isArray(messages.records) || messages.records.length > 50) return fail()
    const items = messages.records.map(value => this.message(value, requested))
    // count and findMany are separate queries: totals are advisory, never snapshot proof.
    return { items: reconcileReadBatches(items), currentPage, reportedTotal, reportedPages,
      nextPage: items.length === 50 && page < 10000 ? page + 1 : null, consistency: 'offset-not-snapshot' }
  }
  private message(value: unknown, requested: string): ReadMessage {
    const row = object(value), key = object(row.key), payload = object(row.message)
    const instanceId = string(row.instanceId), remoteJid = jid(key.remoteJid)
    const remoteJidAlt = key.remoteJidAlt == null ? null : jid(key.remoteJidAlt)
    if (instanceId !== this.instanceId || (remoteJid !== requested && remoteJidAlt !== requested)) return fail('SCOPE')
    const recordId = string(row.id), messageId = string(key.id), fromMe = boolean(key.fromMe)
    const timestamp = integer(row.messageTimestamp, 0, 2147483647)
    const messageType = string(row.messageType, 100)
    let kind: ReadMessage['kind'] = 'unsupported', text: string | null = null, media: ReadMessage['media'] = null
    if (messageType === 'conversation') {
      if (typeof payload.conversation !== 'string' || payload.conversation.length > 16384) return fail()
      kind = 'text'; text = payload.conversation
    } else if (messageType === 'extendedTextMessage') {
      const extended = object(payload.extendedTextMessage)
      if (typeof extended.text !== 'string' || extended.text.length > 16384) return fail()
      kind = 'text'; text = extended.text
    } else {
      const mediaTypes = { imageMessage: 'image', audioMessage: 'audio', videoMessage: 'video', documentMessage: 'document' } as const
      if (Object.hasOwn(mediaTypes, messageType)) {
        kind = mediaTypes[messageType as keyof typeof mediaTypes]
        const data = object(payload[messageType])
        const mimeType = data.mimetype == null ? null : string(data.mimetype, 100)
        if (mimeType && !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) return fail()
        const bytes = data.fileLength == null ? null : integer(data.fileLength)
        media = { reference: JSON.stringify([instanceId, recordId, messageType]), mimeType, bytes, available: false }
      }
    }
    if (!Array.isArray(row.MessageUpdate) || row.MessageUpdate.length > 100) return fail()
    const allowed = new Set(['ERROR', 'PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED'])
    const statuses = row.MessageUpdate.map(value => {
      const status = string(object(value).status, 30)
      if (!allowed.has(status)) return fail()
      return status
    })
    return { recordId, instanceId, messageId, remoteJid, remoteJidAlt, timestamp, fromMe, origin: 'unknown', kind, text, media,
      statuses: [...new Set(statuses)].sort() }
  }
}
