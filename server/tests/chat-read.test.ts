import test from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createRequestHandler } from '../app.ts'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { ChatRepository } from '../chat/repository.ts'
import { api } from '../../src/api.ts'
import type { RequestFailure } from '../../src/api.ts'

const password = 'synthetic-chat-read-password', origin = 'http://localhost:5173'
function fixture() {
  const db = openDatabase(':memory:'), atendimentos = new AtendimentoRepository(db)
  const a = atendimentos.create({ phone: '000000000', name: 'QA A' }), b = atendimentos.create({ phone: '000000000', name: 'QA B' }), empty = atendimentos.create({ phone: '000000000' })
  let time = '2026-11-05T13:00:00.000Z', clock = Date.parse(time)
  const chat = new ChatRepository(db, () => time)
  chat.registerInstance('synthetic-read', '2026-11-05T12:00:00Z')
  const message = (id: string, text: string, jid = 'same-conversation@lid') => chat.ingest(JSON.stringify({ schemaVersion: 1, instance: 'synthetic-read', eventId: id,
    type: 'message.upsert', occurredAt: time, message: { remoteJid: jid, messageId: id, fromMe: false, origin: 'unknown', kind: 'text', text, media: null } }))
  message('a-one', 'SINTÉTICO A PRIMEIRO')
  const conversationId = chat.pending()[0]!.conversationId
  chat.link({ conversationId, atendimentoId: a.id, revision: 0, requestId: 'link-a', actor: 'qa', reason: 'Escolha sintética', pendingMessageIds: ['a-one'] })
  message('a-two', 'SINTÉTICO A SEGUNDO')
  time = '2026-11-05T14:00:00.000Z'
  chat.link({ conversationId, atendimentoId: b.id, revision: 1, requestId: 'link-b', actor: 'qa', reason: 'Novo período sintético', pendingMessageIds: [] })
  message('b-one', 'SINTÉTICO B PRIVADO')
  message('unlinked', 'SINTÉTICO PENDENTE PRIVADO', 'unlinked@lid')
  const handler = createRequestHandler({ atendimentos, password, origin, voiceProvider: null, now: () => clock })
  const request = async (path: string, cookie = '', method = 'GET', body?: unknown) => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {
      url: path, method, headers: { cookie, origin, 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage
    const headers = new Headers(); let status = 200, output = ''
    const res = { setHeader: (key: string, value: string) => headers.set(key, value), writeHead: (value: number) => { status = value }, end: (value: string) => { output = value } } as unknown as ServerResponse
    await handler(req, res)
    return new Response(output, { status, headers })
  }
  const login = async () => (await request('/api/session', '', 'POST', { password })).headers.get('set-cookie')!.split(';')[0]!
  return { db, a, b, empty, chat, request, login, expire: () => { clock += 8 * 60 * 60 * 1000 + 1 } }
}
const path = (id: string) => `/api/atendimentos/${id}/messages`

test('Chat GET requires active session before revealing identity, content or query errors; expiry/revocation preserve no-store', async () => {
  const f = fixture()
  try {
    for (const route of [path(f.a.id), path('invalid') + '?cursor=invalid']) {
      const response = await f.request(route)
      assert.equal(response.status, 401)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert(response.headers.get('x-request-id'))
      assert(!(await response.text()).includes('SINTÉTICO'))
    }
    let cookie = await f.login()
    assert.equal((await f.request(path(f.a.id), cookie)).status, 200)
    f.expire()
    assert.equal((await f.request(path(f.a.id), cookie)).status, 401)
    cookie = await f.login()
    assert.equal((await f.request('/api/session', cookie, 'DELETE')).status, 200)
    assert.equal((await f.request(path(f.a.id), cookie)).status, 401)
  } finally { f.db.close() }
})

test('Chat GET scopes same-phone and same-conversation historical periods by Atendimento, paginates, excludes pending and performs no writes', async () => {
  const f = fixture()
  try {
    const cookie = await f.login(), changes = f.db.prepare('SELECT total_changes() n').get()!.n
    const first = await f.request(path(f.a.id) + '?limit=1', cookie), one = await first.json()
    assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'no-store')
    assert.equal(one.items[0].text, 'SINTÉTICO A SEGUNDO'); assert(one.nextCursor)
    const two = await (await f.request(path(f.a.id) + '?limit=1&cursor=' + one.nextCursor, cookie)).json()
    assert.equal(two.items[0].text, 'SINTÉTICO A PRIMEIRO'); assert.equal(two.nextCursor, null)
    const b = await (await f.request(path(f.b.id), cookie)).json()
    assert.deepEqual(b.items.map((m: { text: string }) => m.text), ['SINTÉTICO B PRIVADO'])
    assert.deepEqual(await (await f.request(path(f.empty.id), cookie)).json(), { items: [], nextCursor: null })
    assert.equal((await f.request(path(f.b.id) + '?cursor=' + one.nextCursor, cookie)).status, 400)
    // A structurally valid cursor is not an authorization token: forged bounds
    // can navigate only A's own rows, never B or pending content.
    const forged = Buffer.from(JSON.stringify([2, f.a.id, '2026-11-05T15:00:00.000Z', 999999, 999999])).toString('base64url')
    const scoped = await (await f.request(path(f.a.id) + '?cursor=' + forged, cookie)).json()
    assert.deepEqual(scoped.items.map((m: { messageId: string }) => m.messageId), ['a-one', 'a-two'])
    assert(!JSON.stringify(scoped).includes('remoteJid')); assert(!JSON.stringify(scoped).includes('PRIVADO'))
    assert.equal(f.db.prepare('SELECT total_changes() n').get()!.n, changes)
    assert.equal((await (await f.request('/api/health')).json()).capabilities.messages, false)
  } finally { f.db.close() }
})

test('Chat GET validates UUID/query/cursor, rejects writes and never exposes ingest/link commands', async () => {
  const f = fixture()
  try {
    const cookie = await f.login()
    for (const suffix of ['?limit=0', '?limit=101', '?limit=01', '?limit=1&limit=2', '?cursor=', '?cursor=invalid', '?cursor=a&cursor=b', '?remoteJid=private', '?atendimentoId=' + f.b.id]) {
      const response = await f.request(path(f.a.id) + suffix, cookie)
      assert.equal(response.status, 400, suffix)
      const error = (await response.json()).error
      assert.equal(error.code, 'CHAT_INVALID_QUERY'); assert(error.requestId)
      assert(!JSON.stringify(error).includes(f.a.id))
    }
    for (const id of ['invalid', '%27OR1=1', f.a.id + '%2f' + f.b.id]) assert.equal((await f.request(path(id), cookie)).status, 400)
    assert.equal((await f.request(path('00000000-0000-4000-8000-000000000000'), cookie)).status, 404)
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await f.request(path(f.a.id), cookie, method, { synthetic: true })).status, 405)
    for (const route of ['/api/integrations/whatsapp/events', '/api/chat/conversations', '/api/chat/conversations/synthetic/link']) {
      assert.equal((await f.request(route, cookie)).status, 404)
      assert.equal((await f.request(route, cookie, 'POST', {})).status, route === '/api/integrations/whatsapp/events' ? 404 : 405)
    }
    assert.equal(f.db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v, 16)
  } finally { f.db.close() }
})

test('Chat client diagnostics redact Atendimento and cursor', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => { throw new Error('synthetic network failure') }
    await assert.rejects(api('/api/atendimentos/private-id/messages?cursor=private-cursor'), cause => {
      const error = cause as RequestFailure
      assert.equal(error.endpoint, '/api/atendimentos/:id/messages')
      assert(!JSON.stringify(error).includes('private')); return true
    })
  } finally { globalThis.fetch = original }
})
