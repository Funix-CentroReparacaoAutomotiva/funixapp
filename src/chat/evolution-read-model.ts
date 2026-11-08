/**
 * Funix V20 read-only pilot — projection of the existing experimental Evolution
 * bridge contract. Contains no provider JID, URL, api key or Atendimento link.
 * Read pagination is offset-based, never a reliable snapshot.
 */
export type ConversationRow = {
  conversationId: string
  displayName: string | null
  phoneNumber: string | null
  updatedAt: string | null
  unreadCount: number | null
}
export type ConversationList = { items: ConversationRow[]; nextSkip: number | null; source: 'evolution'; linksEnabled?: true }
export type ReadUiMessage = {
  messageId: string
  timestamp: number
  fromMe: boolean
  kind: 'text' | 'image' | 'audio' | 'video' | 'document' | 'unsupported'
  text: string | null
}
export type ConversationMessages = {
  conversationId: string
  items: ReadUiMessage[]
  page: number
  nextPage: number | null
  reportedTotal: number
  consistency: 'offset-not-snapshot'
  historyComplete: 'unknown'
  source: 'evolution'
}

const invalid = (): never => { throw new Error('CHAT_READ_RESPONSE_INVALID') }
function record(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return invalid()
  return value as Record<string, unknown>
}
function count(value: unknown, max = 500_000): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) return invalid()
  return Number(value)
}
function opaqueId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) return invalid()
  return value
}
function label(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim() || [...value].length > 80 ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) ||
      /@(?:s\.whatsapp\.net|lid|g\.us)/i.test(value)) return invalid()
  return value
}
function phone(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^[0-9]{8,15}$/.test(value)) return invalid()
  return value
}
function nullableNonnegative(value: unknown): number | null {
  return value === null ? null : count(value, 10_000_000)
}
function dateOrNull(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return invalid()
  return value
}
function pageNumber(value: unknown): number {
  const n = count(value, 10_000)
  return n >= 1 ? n : invalid()
}

export function parseConversationList(raw: unknown): ConversationList {
  const data = record(raw)
  if (data.source !== 'evolution' || !Array.isArray(data.items) || data.items.length > 50) return invalid()
  const seen = new Set<string>()
  const items = data.items.map((value): ConversationRow => {
    const row = record(value)
    const conversationId = opaqueId(row.conversationId)
    if (seen.has(conversationId)) return invalid()
    seen.add(conversationId)
    return { conversationId, displayName: label(row.displayName), phoneNumber: phone(row.phoneNumber), updatedAt: dateOrNull(row.updatedAt), unreadCount: nullableNonnegative(row.unreadCount) }
  })
  const nextSkip = data.nextSkip === null ? null : count(data.nextSkip)
  return data.linksEnabled === true ? { items, nextSkip, source: 'evolution', linksEnabled: true } : { items, nextSkip, source: 'evolution' }
}

export function parseConversationMessages(raw: unknown, expectedId: string): ConversationMessages {
  const data = record(raw)
  if (data.source !== 'evolution' || data.consistency !== 'offset-not-snapshot' ||
      data.historyComplete !== 'unknown' || opaqueId(data.conversationId) !== expectedId ||
      !Array.isArray(data.items) || data.items.length > 50) return invalid()
  const page = pageNumber(data.page)
  const nextPage = data.nextPage === null ? null : pageNumber(data.nextPage)
  if (nextPage !== null && nextPage !== page + 1) return invalid()
  const items = data.items.map((value): ReadUiMessage => {
    const row = record(value)
    if (typeof row.messageId !== 'string' || row.messageId.length < 1 || row.messageId.length > 256 ||
        typeof row.fromMe !== 'boolean' ||
        !['text', 'image', 'audio', 'video', 'document', 'unsupported'].includes(String(row.kind))) return invalid()
    const timestamp = count(row.timestamp, 2_147_483_647)
    const text = row.text === null ? null : row.text
    if (text !== null && (typeof text !== 'string' || text.length > 16_384)) return invalid()
    return { messageId: row.messageId, timestamp, fromMe: row.fromMe, kind: row.kind as ReadUiMessage['kind'], text: text as string | null }
  })
  return {
    conversationId: expectedId, items, page, nextPage,
    reportedTotal: count(data.reportedTotal, 100_000_000),
    consistency: 'offset-not-snapshot', historyComplete: 'unknown', source: 'evolution',
  }
}

/** A display-only merge. Deduplication does not repair skipped offset records. */
export function mergeReadMessages(previous: ReadUiMessage[], incoming: ReadUiMessage[]): ReadUiMessage[] {
  const messages = new Map(previous.map(message => [message.messageId, message]))
  for (const message of incoming) messages.set(message.messageId, message)
  return [...messages.values()].sort((a, b) => a.timestamp - b.timestamp || a.messageId.localeCompare(b.messageId))
}
