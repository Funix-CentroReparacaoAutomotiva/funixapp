import { createHash } from 'node:crypto'
import type { ChatEvent } from '../../shared/chat.ts'
import { ServiceError } from '../errors.ts'

export const MAX_CHAT_EVENT_BYTES = 256 * 1024
export function invalid(): never {
  throw new ServiceError(422, 'CHAT_INVALID_EVENT', 'Evento de Chat inválido.')
}
export function record(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const object = value as Record<string, unknown>
  if (Object.keys(object).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !Object.hasOwn(object, key))) return invalid()
  return object
}
export function identifier(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/\s/.test(value) &&
    Array.from(value).every(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127)
}
export function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?Z$/.exec(value)
  return Boolean(parts && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === `${parts[1]}.${(parts[2] ?? '').padEnd(3, '0')}Z`)
}
export function reliableIdentity(remoteJid: unknown, messageId: unknown): boolean {
  return identifier(messageId) && typeof remoteJid === 'string' &&
    (/^[1-9]\d{7,14}@s\.whatsapp\.net$/.test(remoteJid) || /^[A-Za-z0-9_-]{1,128}@lid$/.test(remoteJid))
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
export function digest(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex') }

/** Accept serialized input so byte limits apply before parsing; never logs its contents. */
export function parseEvent(raw: string): ChatEvent {
  if (Buffer.byteLength(raw) > MAX_CHAT_EVENT_BYTES) throw new ServiceError(413, 'CHAT_EVENT_TOO_LARGE', 'Evento de Chat excede o limite.')
  let input: unknown
  try { input = JSON.parse(raw) } catch { return invalid() }
  const event = record(input, ['schemaVersion', 'instance', 'eventId', 'occurredAt', 'type', 'message'], ['correlation'])
  if (event.schemaVersion !== 1 || !identifier(event.instance, 80) || !identifier(event.eventId) || !timestamp(event.occurredAt)) return invalid()
  if (event.type !== 'message.upsert' && event.type !== 'message.status') return invalid()
  if (event.correlation !== undefined) {
    const correlation = record(event.correlation, ['commandId', 'erpEventRef'])
    for (const value of Object.values(correlation)) if (value !== null && !identifier(value)) return invalid()
  }
  event.occurredAt = new Date(event.occurredAt as string).toISOString()
  const message = record(event.message, event.type === 'message.upsert'
    ? ['remoteJid', 'messageId', 'fromMe', 'origin', 'kind', 'text', 'media'] : ['remoteJid', 'messageId', 'status'])
  for (const key of ['remoteJid', 'messageId']) {
    if (message[key] !== null && (typeof message[key] !== 'string' || (message[key] as string).length > 200)) return invalid()
  }
  if (event.type === 'message.status') {
    if (!['accepted', 'failed', 'delivered', 'read'].includes(String(message.status))) return invalid()
  } else {
    if (typeof message.fromMe !== 'boolean' || !['external', 'unknown'].includes(String(message.origin)) ||
      !['text', 'image', 'audio', 'video', 'document', 'unsupported'].includes(String(message.kind))) return invalid()
    if (message.text !== null && (typeof message.text !== 'string' || Buffer.byteLength(message.text) > 16 * 1024)) return invalid()
    if (message.kind === 'text' && (typeof message.text !== 'string' || !message.text.length || message.media !== null)) return invalid()
    if (message.media !== null) {
      const media = record(message.media, ['ref', 'mime', 'bytes'])
      // Opaque references only, never URLs/paths or binary data.
      if (typeof media.ref !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(media.ref) ||
        typeof media.mime !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]{1,100}$/.test(media.mime) ||
        (media.bytes !== null && (typeof media.bytes !== 'number' || !Number.isSafeInteger(media.bytes) || media.bytes < 0))) return invalid()
      if (['text', 'unsupported'].includes(String(message.kind))) return invalid()
    }
  }
  return input as ChatEvent
}
