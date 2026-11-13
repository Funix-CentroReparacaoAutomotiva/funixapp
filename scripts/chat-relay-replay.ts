import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parseConversationEvent } from '../server/chat/conversation-event.ts'
import { normalizeEvolutionEvent } from '../server/chat/evolution-normalize.ts'
import { deliverConversationEvent } from '../server/chat/conversation-relay.ts'
import { ingestKeys, loadIngestOptions } from '../server/chat/ingest-config.ts'

/** Explicit event-only replay. Default dry-run; never invokes commercial n8n or WhatsApp send. */
async function main() {
  const args = process.argv.slice(2)
  if (
    args.some((arg) => arg !== '--apply' && !arg.startsWith('--input=')) ||
    args.filter((arg) => arg.startsWith('--input=')).length !== 1
  )
    throw Error('CHAT_REPLAY_USAGE')
  const input = args.find((arg) => arg.startsWith('--input='))!.slice('--input='.length)
  const file = await open(input, 'r')
  let bytes: Buffer
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 256 * 1024) throw Error('CHAT_REPLAY_INPUT_TOO_LARGE')
    const buffer = Buffer.alloc(256 * 1024 + 1)
    const result = await file.read(buffer, 0, buffer.length, 0)
    if (result.bytesRead > 256 * 1024) throw Error('CHAT_REPLAY_INPUT_TOO_LARGE')
    bytes = buffer.subarray(0, result.bytesRead)
  } finally {
    await file.close()
  }
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const event =
    parsed?.schemaVersion === 2
      ? parseConversationEvent(JSON.stringify(parsed))
      : await normalizeEvolutionEvent(parsed, {
          instance: 'funix_comercial',
          instanceId: process.env.FUNIX_EVOLUTION_INSTANCE_ID ?? '',
        })
  const body = JSON.stringify(event)
  if (!args.includes('--apply')) {
    process.stdout.write(
      JSON.stringify({
        mode: 'dry-run',
        eventId: event.eventId,
        type: event.type,
        digest: createHash('sha256').update(body).digest('hex'),
      }) + '\n',
    )
    return
  }
  const base = new URL(process.env.FUNIX_APP_ORIGIN ?? '')
  if (
    base.origin !== process.env.FUNIX_APP_ORIGIN ||
    base.username ||
    base.password ||
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname)))
  )
    throw Error('CHAT_REPLAY_ORIGIN_INVALID')
  const keyId = process.env.FUNIX_CHAT_RELAY_KEY_ID ?? ''
  const key = ingestKeys(loadIngestOptions(process.env))?.get(keyId)
  if (!key || !key.instances.has(event.instance)) throw Error('CHAT_REPLAY_KEY_UNAVAILABLE')
  const result = await deliverConversationEvent(
    body,
    { keyId, secret: key.secret },
    async (request) => {
      const response = await fetch(new URL('/api/integrations/whatsapp/events', base), {
        method: 'POST',
        body: request.body,
        headers: request.headers,
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      })
      const text = await response.text()
      let receipt: unknown
      if (text.length <= 16384) {
        try {
          receipt = JSON.parse(text)
        } catch {}
      }
      return { status: response.status, body: receipt }
    },
  )
  process.stdout.write(JSON.stringify({ mode: 'apply', ...result }) + '\n')
  if (result.state !== 'persisted') process.exitCode = 2
}
main().catch(() => {
  process.stderr.write(
    'CHAT_REPLAY_FAILED: confira contrato, arquivo e configuração; nenhum conteúdo foi registrado no log.\n',
  )
  process.exitCode = 1
})
