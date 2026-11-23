import { ServiceError } from '../errors.ts'
import { record, identifier, timestamp } from './events.ts'
import { displayName } from '../experimental/evolution-read/client.ts'
import type { ReadMessage } from '../experimental/evolution-read/client.ts'

export const individualJid = /^(?:[0-9]{8,15}@s\.whatsapp\.net|[A-Za-z0-9_-]{1,100}@lid)$/
const states = new Set([
  'ERROR',
  'PENDING',
  'SERVER_ACK',
  'DELIVERY_ACK',
  'READ',
  'PLAYED',
  'EDITED',
])
export type ConversationEvent = {
  displayName?: string
  schemaVersion: 2
  instance: string
  eventId: string
  occurredAt: string
  type: 'message.upsert' | 'message.edit' | 'message.delete' | 'message.status'
  message: {
    remoteJid: string
    remoteJidAlt: string | null
    messageId: string
    timestamp?: number
    fromMe?: boolean
    kind?: ReadMessage['kind']
    text?: string | null
    media?: { mimeType: string | null; bytes: number | null } | null
    statuses?: string[]
  }
}
function invalid(): never {
  throw new ServiceError(422, 'CHAT_INVALID_EVENT', 'Evento de conversa inválido.')
}
/** Normalized relay contract; never accepts provider URLs, secrets or arbitrary raw payloads. */
export function parseConversationEvent(raw: string): ConversationEvent {
  if (Buffer.byteLength(raw) > 256 * 1024) return invalid()
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return invalid()
  }
  const e = record(
    value,
    ['schemaVersion', 'instance', 'eventId', 'occurredAt', 'type', 'message'],
    ['displayName'],
  )
  if (
    e.schemaVersion !== 2 ||
    !identifier(e.instance, 80) ||
    !identifier(e.eventId, 160) ||
    !timestamp(e.occurredAt) ||
    typeof e.type !== 'string' ||
    !['message.upsert', 'message.edit', 'message.delete', 'message.status'].includes(e.type)
  )
    return invalid()
  if (e.displayName !== undefined && displayName(e.displayName) !== e.displayName) return invalid()
  const content = e.type === 'message.upsert' || e.type === 'message.edit'
  const m = record(
    e.message,
    [
      'remoteJid',
      'remoteJidAlt',
      'messageId',
      ...(content ? ['timestamp', 'fromMe', 'kind', 'text', 'media'] : []),
    ],
    ['statuses'],
  )
  if (
    typeof m.remoteJid !== 'string' ||
    !individualJid.test(m.remoteJid) ||
    (m.remoteJidAlt !== null &&
      (typeof m.remoteJidAlt !== 'string' ||
        !individualJid.test(m.remoteJidAlt) ||
        m.remoteJidAlt.endsWith('@lid') === m.remoteJid.endsWith('@lid'))) ||
    !identifier(m.messageId, 200) ||
    !Number.isFinite(Date.parse(e.occurredAt))
  )
    return invalid()
  if (
    m.statuses !== undefined &&
    (!Array.isArray(m.statuses) ||
      m.statuses.length > 20 ||
      m.statuses.some((s) => typeof s !== 'string' || !states.has(s)))
  )
    return invalid()
  if (e.type === 'message.status' && (!Array.isArray(m.statuses) || m.statuses.length === 0))
    return invalid()
  if (content) {
    if (
      !Number.isSafeInteger(m.timestamp) ||
      Number(m.timestamp) < 0 ||
      Number(m.timestamp) > 2147483647 ||
      typeof m.fromMe !== 'boolean' ||
      typeof m.kind !== 'string' ||
      !['text', 'image', 'video', 'audio', 'document', 'unsupported'].includes(m.kind) ||
      (m.text !== null && (typeof m.text !== 'string' || m.text.length > 16384)) ||
      (m.kind === 'text' && typeof m.text !== 'string')
    )
      return invalid()
    if (m.media !== null) {
      const media = record(m.media, ['mimeType', 'bytes'])
      if (
        (media.mimeType !== null &&
          (typeof media.mimeType !== 'string' ||
            !/^[-\w.+]+\/[-\w.+]+$/.test(media.mimeType) ||
            media.mimeType.length > 100)) ||
        (media.bytes !== null && (!Number.isSafeInteger(media.bytes) || Number(media.bytes) < 0)) ||
        ['text', 'unsupported'].includes(String(m.kind))
      )
        return invalid()
    }
  }
  return { ...e, occurredAt: new Date(e.occurredAt as string).toISOString() } as ConversationEvent
}
