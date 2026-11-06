import { createHmac, randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createApp } from '../../app.ts'
import { openDatabase } from '../../database.ts'
import { AtendimentoRepository } from '../../atendimentos.ts'
import { ChatRepository } from '../../chat/repository.ts'
import type { IngestOptions } from '../../chat/ingest-config.ts'

export const ingestPath = '/api/integrations/whatsapp/events'
export function syntheticKey(keyId = 'synthetic-current', instances = ['synthetic-ingest']) {
  return { keyId, secretBase64: randomBytes(32).toString('base64'), instances }
}
export function syntheticEvent(id = 'synthetic-event') {
  return { schemaVersion: 1, instance: 'synthetic-ingest', eventId: id, occurredAt: '2026-11-05T13:00:00.000Z', type: 'message.upsert',
    message: { remoteJid: 'synthetic@lid', messageId: id, fromMe: false, origin: 'unknown', kind: 'text', text: 'CONTEÚDO SINTÉTICO PRIVADO', media: null } }
}
export function signedHeaders(bytes: Buffer, key: ReturnType<typeof syntheticKey>, seconds = Math.floor(Date.now() / 1000)) {
  const timestamp = String(seconds)
  return { 'Content-Type': 'application/json', 'X-Funix-Key-Id': key.keyId, 'X-Funix-Timestamp': timestamp,
    'X-Funix-Signature': 'sha256=' + createHmac('sha256', Buffer.from(key.secretBase64, 'base64')).update(`v1\n${key.keyId}\n${timestamp}\n`).update(bytes).digest('hex') }
}

export async function ingestFixture(options: { enabled?: boolean; register?: boolean; filename?: string; keys?: ReturnType<typeof syntheticKey>[]; config?: unknown; telemetry?: IngestOptions['telemetry'] } = {}) {
  const db = openDatabase(options.filename ?? ':memory:')
  const chat = new ChatRepository(db)
  if (options.register !== false) chat.registerInstance('synthetic-ingest', '2026-11-05T12:00:00.000Z')
  const keys = options.keys ?? [syntheticKey()]
  const operatorPassword = randomBytes(24).toString('hex')
  let clock = Date.now()
  const server = createApp({ atendimentos: new AtendimentoRepository(db), voiceProvider: null, password: operatorPassword, origin: 'http://127.0.0.1', now: () => clock,
    whatsappIngest: { enabled: options.enabled !== false, config: options.config === undefined ? { version: 1, keys } : options.config, telemetry: options.telemetry } })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { db, chat, keys, base, server, operatorPassword,
    advance: (milliseconds: number) => { clock += milliseconds },
    headers: (bytes: Buffer, key = keys[0]!, seconds = Math.floor(clock / 1000)) => signedHeaders(bytes, key, seconds),
    post: (bytes = Buffer.from(JSON.stringify(syntheticEvent())), headers?: Record<string, string>) => fetch(base + ingestPath, { method: 'POST', headers: headers ?? signedHeaders(bytes, keys[0]!, Math.floor(clock / 1000)), body: new Uint8Array(bytes) }),
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close() },
  }
}
