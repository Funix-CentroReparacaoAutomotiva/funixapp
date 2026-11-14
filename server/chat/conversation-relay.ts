import { createHmac } from 'node:crypto'
import { parseConversationEvent } from './conversation-event.ts'

export type ConversationRelayRequest = { body: string; headers: Record<string, string> }
/** A retryable event delivery contract, NOT a WhatsApp send worker.
 * Caller retains the immutable event in its existing durable execution/outbox until receipt.
 * No timer, credential discovery, endpoint mutation or network on import.
 */
export async function deliverConversationEvent(
  raw: string,
  config: { keyId: string; secret: Buffer; now?: () => number },
  transport: (request: ConversationRelayRequest) => Promise<{ status: number; body?: unknown }>,
) {
  const event = parseConversationEvent(raw)
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(config.keyId) ||
    config.secret.length < 32 ||
    config.secret.length > 64
  )
    throw Error('CHAT_RELAY_CONFIG_INVALID')
  const timestamp = String(Math.floor((config.now ?? Date.now)() / 1000))
  const signature =
    'sha256=' +
    createHmac('sha256', config.secret)
      .update(`v1\n${config.keyId}\n${timestamp}\n`)
      .update(raw)
      .digest('hex')
  let response: { status: number; body?: unknown }
  try {
    response = await transport({
      body: raw,
      headers: {
        'content-type': 'application/json',
        'x-funix-key-id': config.keyId,
        'x-funix-timestamp': timestamp,
        'x-funix-signature': signature,
      },
    })
  } catch {
    return { state: 'retry' as const, eventId: event.eventId }
  }
  const receipt = response.body as {
    eventId?: unknown
    receiptId?: unknown
    state?: unknown
    disposition?: unknown
  } | null
  if (
    response.status === 202 &&
    receipt?.state === 'persisted' &&
    receipt.eventId === event.eventId &&
    typeof receipt.receiptId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      receipt.receiptId,
    ) &&
    ['projected', 'pending', 'quarantined'].includes(String(receipt.disposition)) &&
    typeof receipt.disposition === 'string'
  ) {
    return {
      state: receipt.disposition === 'quarantined' ? ('review' as const) : ('persisted' as const),
      eventId: event.eventId,
      receiptId: receipt.receiptId,
    }
  }
  if (response.status === 202 || response.status === 429 || response.status >= 500)
    return { state: 'retry' as const, eventId: event.eventId }
  return { state: 'review' as const, eventId: event.eventId }
}
