import { observedEvolutionUpsert } from './fixtures/evolution-webhook.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHmac, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createRequestHandler } from '../app.ts'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { CodaEventSyncRepository, createCodaEventSchema } from '../chat/coda-sync.ts'
import { loadConversationRuntime } from '../chat/conversation-runtime.ts'
import { createEvolutionChatBridge } from '../chat/evolution-bridge.ts'
import { normalizeEvolutionUpsert } from '../chat/evolution-normalize.ts'
import { syntheticMessage, INSTANCE } from './fixtures/evolution-read.ts'

const PN = '000000000001@s.whatsapp.net',
  LID = 'http-synthetic@lid',
  origin = 'http://localhost:5173',
  secret = Buffer.alloc(32, 8),
  password = 'synthetic-operator-password'
async function fixture() {
  const db = openDatabase(':memory:')
  createCodaEventSchema(db)
  const repo = new CodaEventSyncRepository(db),
    local = loadConversationRuntime(
      {
        FUNIX_CHAT_LOCAL_ENABLED: 'true',
        FUNIX_CHAT_LOCAL_READ_ENABLED: 'true',
        FUNIX_EVOLUTION_READ_ENABLED: 'true',
      },
      db,
      repo,
    )!
  local.providerIdentity = { instance: 'funix_comercial', instanceId: INSTANCE }
  let reads = 0,
    sends = 0
  const bridge = createEvolutionChatBridge(
    {
      findChatsPage: async () => ({ items: [], sourceCount: 0 }),
      findMessages: async () => {
        reads++
        throw Error('provider intentionally offline')
      },
    },
    Date.now,
    undefined,
    repo,
    async () => {
      sends++
      return { messageId: 'receipt-1' }
    },
    undefined,
    local,
  )
  const handler = createRequestHandler({
    atendimentos: new AtendimentoRepository(db),
    password,
    origin,
    conversationRuntime: local,
    evolutionChat: bridge,
    whatsappIngest: {
      enabled: true,
      config: {
        version: 1,
        keys: [
          {
            keyId: 'test-key',
            secretBase64: secret.toString('base64'),
            instances: ['funix_comercial'],
          },
        ],
      },
    },
    codaSync: { repo, secret },
    voiceProvider: null,
  })
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    const req = Object.assign(Readable.from(raw ? [raw] : []), {
      url: path,
      method,
      headers: { 'content-type': 'application/json', ...headers },
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage
    let status = 200,
      output = ''
    const outHeaders = new Headers()
    const res = {
      setHeader: (key: string, value: string) => outHeaders.set(key, value),
      writeHead: (value: number) => {
        status = value
      },
      end: (value: string) => {
        output = value
      },
    } as unknown as ServerResponse
    await handler(req, res)
    return new Response(output, { status, headers: outHeaders })
  }
  const login = await request('/api/session', 'POST', { password }, { origin })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!
  const browser = { origin, cookie }
  const sendEvent = async (body: unknown, invalidSignature = false) => {
    const raw = JSON.stringify(body),
      time = String(Math.floor(Date.now() / 1000)),
      sig = createHmac('sha256', secret).update(`v1\ntest-key\n${time}\n`).update(raw).digest('hex')
    return request('/api/integrations/whatsapp/events', 'POST', raw, {
      'x-funix-key-id': 'test-key',
      'x-funix-timestamp': time,
      'x-funix-signature': 'sha256=' + (invalidSignature ? '0'.repeat(64) : sig),
    })
  }
  const event = await normalizeEvolutionUpsert(
    {
      event: 'messages.upsert',
      instance: 'funix_comercial',
      data: syntheticMessage(1, {
        key: { id: 'message-1', remoteJid: LID, remoteJidAlt: PN, fromMe: false },
      }),
    },
    { instance: 'funix_comercial', instanceId: INSTANCE },
  )
  return {
    db,
    repo,
    local,
    bridge,
    request,
    browser,
    sendEvent,
    event,
    get reads() {
      return reads
    },
    get sends() {
      return sends
    },
  }
}

test('v2 signed HTTP chain: ACK after durable pending message, ERP later, local history offline, strict/replayed sends and generic quarantine', async () => {
  const old = process.env.FUNIX_EVOLUTION_SEND_ENABLED
  process.env.FUNIX_EVOLUTION_SEND_ENABLED = 'true'
  const f = await fixture()
  try {
    assert.equal((await f.sendEvent(f.event, true)).status, 401)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_events').get()!.n), 0)
    const delivered = await f.sendEvent(f.event)
    assert.equal(delivered.status, 202)
    const receipt = await delivered.json()
    assert.equal(receipt.state, 'persisted')
    assert.equal(receipt.disposition, 'pending')
    assert.deepEqual(await (await f.sendEvent(f.event)).json(), receipt)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 0)
    const id = f.repo.sync({
      version: 1,
      source: 'coda',
      eventId: 'coda:confirmed',
      codaRowId: 'i-HTTP_A',
      instance: 'funix_comercial',
      remoteJid: PN,
      phoneE164: null,
      displayName: 'Sintético',
      occurredAt: 100,
    }).atendimentoId
    const handle = f.repo.rememberProviderConversation(LID),
      base = `/api/atendimentos/${id}/evolution-conversations/${handle}`
    assert.equal((await f.request(base + '/messages')).status, 401)
    const page = await (await f.request(base + '/messages', 'GET', undefined, f.browser)).json()
    assert.equal(page.source, 'local')
    assert.equal(page.items[0].text, 'Synthetic 1')
    assert.equal(f.reads, 0)
    assert.equal(
      (await f.request(base + '/send-text', 'POST', { text: 'synthetic' }, f.browser)).status,
      400,
    )
    const command = { text: 'synthetic', requestId: randomUUID(), contextToken: page.contextToken }
    assert.equal((await f.request(base + '/send-text', 'POST', command, f.browser)).status, 200)
    assert.equal((await f.request(base + '/send-text', 'POST', command, f.browser)).status, 200)
    assert.equal(f.sends, 1)
    assert.equal(
      (await f.request(base + '/send-text', 'POST', { ...command, text: 'modified' }, f.browser))
        .status,
      409,
    )
    assert.equal(
      (await f.request(base + '/sync-history', 'POST', { page: 1 }, { cookie: f.browser.cookie }))
        .status,
      403,
    )
    assert.equal(
      (await f.request(base + '/sync-history', 'POST', { page: 1 }, f.browser)).status,
      503,
    )
    assert.equal((await f.request(base + '/messages', 'GET', undefined, f.browser)).status, 200)
    f.repo.rememberProviderAliases([{ remoteJid: 'collision@lid', remoteJidAlt: PN }])
    assert.equal(
      (
        await f.request(
          '/api/chat/conversations/' + handle + '/messages',
          'GET',
          undefined,
          f.browser,
        )
      ).status,
      404,
    )
    assert.equal((await f.request(base + '/messages', 'GET', undefined, f.browser)).status, 404)
    assert.equal(
      (
        await f.request(
          base + '/send-text',
          'POST',
          { ...command, requestId: randomUUID() },
          f.browser,
        )
      ).status,
      404,
    )
    assert.equal(f.sends, 1)
  } finally {
    f.db.close()
    if (old === undefined) delete process.env.FUNIX_EVOLUTION_SEND_ENABLED
    else process.env.FUNIX_EVOLUTION_SEND_ENABLED = old
  }
})

test('v2 signed HTTP storage failure never ACKs; exact retry commits once after recovery', async () => {
  const f = await fixture()
  try {
    f.db.exec(
      "CREATE TRIGGER fail_projection BEFORE INSERT ON chat_events BEGIN SELECT RAISE(ABORT,'SYNTHETIC'); END",
    )
    assert.equal((await f.sendEvent(f.event)).status, 503)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n), 0)
    assert.equal(
      Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_provider_alias_evidence').get()!.n),
      0,
    )
    f.db.exec('DROP TRIGGER fail_projection')
    assert.equal((await f.sendEvent(f.event)).status, 202)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n), 1)
  } finally {
    f.db.close()
  }
})

test('normalizer validates provider instance, sender, unknown event type and edited-null upserts without leaking provider metadata', async () => {
  const expected = { instance: 'funix_comercial', instanceId: INSTANCE }
  const raw = {
    event: 'messages.upsert',
    instance: 'funix_comercial',
    data: syntheticMessage(1, {
      message: null,
      status: 'EDITED',
      MessageUpdate: undefined,
      key: { id: 'message-1', fromMe: true, remoteJid: LID, remoteJidAlt: PN },
      profilePicUrl: 'https://private.invalid',
    }),
  }
  const result = await normalizeEvolutionUpsert(raw, expected)
  assert.equal(result.message.kind, 'unsupported')
  assert.equal(result.message.text, null)
  assert.equal(result.message.fromMe, true)
  assert(!JSON.stringify(result).includes('private.invalid'))
  assert(!JSON.stringify(result).includes('recordId'))
  await assert.rejects(normalizeEvolutionUpsert({ ...raw, instance: 'another' }, expected))
  await assert.rejects(normalizeEvolutionUpsert({ ...raw, event: 'messages.update' }, expected))
  await assert.rejects(
    normalizeEvolutionUpsert({ ...raw, data: { ...raw.data, instanceId: 'wrong' } }, expected),
  )
})

test('raw observed Evolution upsert can be relayed with existing HMAC envelope; normalization precedes persistence', async () => {
  const f = await fixture()
  try {
    const raw = {
      event: 'messages.upsert',
      instance: 'funix_comercial',
      data: syntheticMessage(2, {
        key: { id: 'raw-2', remoteJid: LID, remoteJidAlt: PN, fromMe: true },
        profilePicUrl: 'https://private.invalid',
      }),
    }
    const res = await f.sendEvent(raw)
    assert.equal(res.status, 202)
    const receipt = await res.json()
    assert.equal(receipt.eventId, 'evo:funix_comercial:raw-2:upsert')
    const stored = String(
      f.db.prepare('SELECT payload FROM chat_events WHERE event_id=?').get(receipt.eventId)!
        .payload,
    )
    assert(!stored.includes('private.invalid'))
    assert(!stored.includes('MessageUpdate'))
    assert.equal(f.local.store.page(LID, 1).items[0]?.fromMe, true)
    assert.equal((await f.sendEvent({ ...raw, event: 'unverified.provider.event' })).status, 422)
  } finally {
    f.db.close()
  }
})

test('documented Evolution edit/status/delete shapes update one local message and keep original timeline', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.sendEvent(f.event)).status, 202)
    const mutationMs = 1793491205000
    const edit = {
      event: 'messages.edited',
      instance: 'funix_comercial',
      data: {
        key: { id: 'message-1', remoteJid: LID, fromMe: false },
        editedMessage: { conversation: 'Edited via protocol' },
        timestampMs: String(mutationMs),
      },
    }
    assert.equal((await f.sendEvent(edit)).status, 202)
    let message = f.local.store.page(LID, 1).items[0]!
    assert.equal(message.text, 'Edited via protocol')
    assert.equal(message.timestamp, 1700000001)
    // A late original is idempotent and cannot undo the edit.
    assert.equal((await f.sendEvent(f.event)).status, 202)
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, 'Edited via protocol')
    const status = {
      event: 'messages.update',
      instance: 'funix_comercial',
      date_time: '2026-11-01T00:00:10.000Z',
      data: {
        keyId: 'message-1',
        remoteJid: LID,
        fromMe: false,
        status: 'READ',
        instanceId: INSTANCE,
      },
    }
    assert.equal((await f.sendEvent(status)).status, 202)
    assert(f.local.store.page(LID, 1).items[0]!.statuses.includes('READ'))
    const removed = {
      event: 'messages.delete',
      instance: 'funix_comercial',
      date_time: '2026-11-01T00:00:15.000Z',
      data: { id: 'message-1', remoteJid: LID, fromMe: false, status: 'DELETED' },
    }
    assert.equal((await f.sendEvent(removed)).status, 202)
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, null)
    assert.equal(
      (
        await f.sendEvent({
          ...edit,
          data: { ...edit.data, timestampMs: String(mutationMs + 60000) },
        })
      ).status,
      202,
    )
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, null)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n), 1)
  } finally {
    f.db.close()
  }
})

test('observed webhook without provider database row ID passes normalization and signed HTTP persistence', async () => {
  const f = await fixture()
  try {
    assert.equal('id' in observedEvolutionUpsert.data, false)
    const normalized = await normalizeEvolutionUpsert(observedEvolutionUpsert, {
      instance: 'funix_comercial',
      instanceId: INSTANCE,
    })
    assert.equal(normalized.message.messageId, 'observed-synthetic-id')
    assert.equal(normalized.message.text, 'Mensagem sintética recebida')
    assert(!JSON.stringify(normalized).includes('webhook:'))
    const res = await f.sendEvent(observedEvolutionUpsert)
    assert.equal(res.status, 202)
    assert.equal((await res.json()).disposition, 'pending')
    assert.equal(
      f.local.store.page('observed-synthetic@lid', 1).items[0]?.text,
      'Mensagem sintética recebida',
    )
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 0)
  } finally {
    f.db.close()
  }
})
