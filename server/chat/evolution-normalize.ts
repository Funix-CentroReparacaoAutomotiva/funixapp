import { EvolutionReadPoc, displayName } from '../experimental/evolution-read/client.ts'
import { parseConversationEvent, type ConversationEvent } from './conversation-event.ts'
import { ServiceError } from '../errors.ts'

function invalid(): never {
  throw new ServiceError(
    422,
    'CHAT_UNSUPPORTED_PROVIDER_EVENT',
    'Evento Evolution não compatível com o contrato validado.',
  )
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
/** Decode protobuf Long/string only when lossless. Never substitute reception time for a missing edit version. */
function milliseconds(value: unknown): number {
  let n: unknown = value
  if (value && typeof value === 'object') {
    const x = value as { low?: unknown; high?: unknown }
    if (
      !Number.isInteger(x.low) ||
      !Number.isInteger(x.high) ||
      Number(x.low) < -2147483648 ||
      Number(x.low) > 4294967295 ||
      Number(x.high) < 0 ||
      Number(x.high) > 2147483647
    )
      return invalid()
    n = Number((BigInt(Number(x.high)) << 32n) + BigInt(Number(x.low) >>> 0))
  } else if (typeof value === 'string' && /^[0-9]{1,16}$/.test(value)) n = Number(value)
  if (!Number.isSafeInteger(n) || Number(n) < 0 || Number(n) > 2147483647999) return invalid()
  return Number(n)
}

/** Pure adapter for the documented 2.3.7 webhook shapes, sharing the history scope/content parser.
 * No network, raw payload persistence, commercial decision or client identity inference.
 */
export async function normalizeEvolutionEvent(
  body: unknown,
  expected: { instance: string; instanceId: string },
): Promise<ConversationEvent> {
  const x = object(body)
  if (x.instance !== expected.instance) return invalid()
  const row = object(x.data)
  if (row.instanceId !== undefined && row.instanceId !== expected.instanceId) return invalid()
  const allowed = new Set([
    'ERROR',
    'PENDING',
    'SERVER_ACK',
    'DELIVERY_ACK',
    'READ',
    'PLAYED',
    'EDITED',
  ])
  if (x.event === 'messages.update' || x.event === 'messages.delete') {
    const key = x.event === 'messages.delete' ? object(row.key ?? row) : row
    const messageId = x.event === 'messages.update' ? row.keyId : key.id
    const time =
      typeof x.date_time === 'string' && Number.isFinite(Date.parse(x.date_time))
        ? new Date(x.date_time).toISOString()
        : null
    if (!time) return invalid()
    const deleted = x.event === 'messages.delete'
    if (!deleted && (!allowed.has(String(row.status)) || row.instanceId !== expected.instanceId))
      return invalid()
    return parseConversationEvent(
      JSON.stringify({
        schemaVersion: 2,
        instance: expected.instance,
        eventId: `evo:${expected.instance}:${messageId}:${deleted ? 'delete' : row.status}:${Date.parse(time)}`,
        occurredAt: time,
        type: deleted ? 'message.delete' : 'message.status',
        message: {
          remoteJid: deleted ? key.remoteJid : row.remoteJid,
          remoteJidAlt: deleted ? (key.remoteJidAlt ?? null) : null,
          messageId,
          ...(!deleted ? { statuses: [row.status] } : {}),
        },
      }),
    )
  }
  const edited = x.event === 'messages.edited' || x.event === 'send.message.update'
  if (x.event !== 'messages.upsert' && !edited) return invalid()
  const key = object(row.key)
  if (typeof key.remoteJid !== 'string' || typeof key.id !== 'string') return invalid()
  let record: Record<string, unknown>, at: number | undefined
  if (edited) {
    at = milliseconds(row.timestampMs)
    const message = object(row.editedMessage)
    const messageType =
      [
        'conversation',
        'extendedTextMessage',
        'imageMessage',
        'audioMessage',
        'videoMessage',
        'documentMessage',
      ].find((kind) => message[kind] !== undefined) ?? 'unsupportedMessage'
    record = {
      id: 'edit:' + key.id,
      instanceId: expected.instanceId,
      key,
      message,
      messageType,
      messageTimestamp: Math.floor(at / 1000),
      MessageUpdate: [{ status: 'EDITED' }],
    }
  } else {
    if (row.instanceId !== expected.instanceId) return invalid()
    record = {
      ...row,
      // Webhooks omit the database row ID. This parser-only reference is dropped
      // by the normalized contract and never used as the WhatsApp message identity.
      id: row.id ?? 'webhook:' + key.id,
      MessageUpdate:
        row.MessageUpdate ?? (allowed.has(String(row.status)) ? [{ status: row.status }] : []),
    }
  }
  const provider = new EvolutionReadPoc({
    instance: expected.instance,
    instanceId: expected.instanceId,
    transport: async () => ({
      status: 200,
      body: { messages: { records: [record], currentPage: 1, total: 1, pages: 1 } },
    }),
  })
  const message = (await provider.findMessages(key.remoteJid)).items[0]!
  return parseConversationEvent(
    JSON.stringify({
      schemaVersion: 2,
      ...(!message.fromMe && displayName(row.pushName)
        ? { displayName: displayName(row.pushName)! }
        : {}),
      instance: expected.instance,
      eventId: `evo:${expected.instance}:${message.messageId}:${edited ? 'edit:' + at : 'upsert'}`,
      occurredAt: new Date(at ?? message.timestamp * 1000).toISOString(),
      type: edited ? 'message.edit' : 'message.upsert',
      message: {
        remoteJid: message.remoteJid,
        remoteJidAlt: message.remoteJidAlt,
        messageId: message.messageId,
        timestamp: message.timestamp,
        fromMe: message.fromMe,
        kind: message.kind,
        text: message.text,
        media: message.media
          ? { mimeType: message.media.mimeType, bytes: message.media.bytes }
          : null,
        statuses: message.statuses,
      },
    }),
  )
}
export const normalizeEvolutionUpsert = normalizeEvolutionEvent
