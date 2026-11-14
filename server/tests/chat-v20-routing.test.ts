import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createRequestHandler } from '../app.ts'
import { createEvolutionChatBridge } from '../chat/evolution-bridge.ts'
import { createV20AssociationSchema, V20AssociationRepository } from '../chat/v20-associations.ts'

const origin = 'http://localhost:5173'
const jid = '5531999990001@s.whatsapp.net'
function harness(enabled = true) {
  const db = openDatabase(':memory:')
  const atendimentos = new AtendimentoRepository(db)
  const one = atendimentos.create({ phone: '1', name: 'Sintético A' })
  const two = atendimentos.create({ phone: '2', name: 'Sintético B' })
  if (enabled) createV20AssociationSchema(db)
  const associations = enabled ? new V20AssociationRepository(db) : undefined
  const provider = {
    async findChatsPage() { return { items: [{ remoteJid: jid, displayName: 'Cliente fictício', phoneNumber: '5531999990001', updatedAt: null, unreadCount: 0 }], sourceCount: 1 } },
    async findMessages(remoteJid: string, { page }: { page?: number } = {}) {
      assert.equal(remoteJid, jid)
      return { items: [], currentPage: page ?? 1, reportedTotal: 0, reportedPages: 0, nextPage: null, consistency: 'offset-not-snapshot' as const }
    },
  }
  const bridge = createEvolutionChatBridge(provider, Date.now, associations)
  const handler = createRequestHandler({ atendimentos, evolutionChat: bridge, v20Associations: associations, password: 'synthetic-owner-password', origin, voiceProvider: null })
  async function request(path: string, method = 'GET', body?: unknown, cookie = '', requestOrigin = origin) {
    const req = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {
      url: path, method, headers: { cookie, origin: requestOrigin, 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage
    const headers = new Headers()
    let status = 200, output = ''
    const res = {
      setHeader(key: string, value: string) { headers.set(key, value) },
      writeHead(value: number) { status = value },
      end(value: string) { output = value },
    } as unknown as ServerResponse
    await handler(req, res)
    return new Response(output, { status, headers })
  }
  async function login() {
    const response = await request('/api/session', 'POST', { password: 'synthetic-owner-password' })
    assert.equal(response.status, 200)
    return response.headers.get('set-cookie')!.split(';')[0]!
  }
  return { db, one, two, request, login, bridge }
}

test('V20 routes disabled by default; read-only Evolution pilot unchanged', async () => {
  const f = harness(false)
  try {
    const cookie = await f.login()
    const list = await (await f.request('/api/chat/conversations', 'GET', undefined, cookie)).json()
    assert.equal(list.linksEnabled, undefined)
    const id = list.items[0].conversationId
    assert.equal((await f.request('/api/chat/conversations/' + id + '/atendimentos', 'GET', undefined, cookie)).status, 404)
    assert.equal((await f.request('/api/chat/conversations/' + id + '/messages', 'GET', undefined, cookie)).status, 200)
  } finally { f.db.close() }
})

test('Gated manual N:N routes require auth/Origin, reject arbitrary UUID, preserve same history', async () => {
  const f = harness()
  try {
    const cookie = await f.login()
    const list = await (await f.request('/api/chat/conversations', 'GET', undefined, cookie)).json()
    assert.equal(list.linksEnabled, true)
    const id = list.items[0].conversationId
    const base = '/api/chat/conversations/' + id
    assert.equal((await f.request(base + '/atendimentos')).status, 401)
    assert.equal((await f.request('/api/chat/conversations/' + randomUUID() + '/atendimentos', 'GET', undefined, cookie)).status, 404)
    assert.equal((await f.request(base + '/atendimentos', 'POST', {}, cookie, 'https://other.invalid')).status, 403)
    const historyBefore = await (await f.request(base + '/messages', 'GET', undefined, cookie)).json()
    const first = { atendimentoId: f.one.id, expectedRevision: 0, requestId: randomUUID(), reason: 'test manual' }
    const added = await f.request(base + '/atendimentos', 'POST', first, cookie)
    assert.equal(added.status, 201)
    const result = await added.json()
    assert.equal((await f.request(base + '/atendimentos', 'POST', first, cookie)).status, 201)
    assert.equal((await f.request(base + '/atendimentos', 'POST', { ...first, atendimentoId: f.two.id }, cookie)).status, 409)
    const second = await f.request(base + '/atendimentos', 'POST', { atendimentoId: f.two.id, expectedRevision: 1, requestId: randomUUID(), reason: 'another' }, cookie)
    assert.equal(second.status, 201)
    let linked = await (await f.request(base + '/atendimentos', 'GET', undefined, cookie)).json()
    assert.equal(linked.items.length, 2)
    // Linked records may share the same millisecond; order is not a contract.
    assert.deepEqual(
      new Set(linked.items.map((item: { atendimentoId: string; name: string }) => JSON.stringify([item.atendimentoId, item.name]))),
      new Set([JSON.stringify([f.one.id, 'Sintético A']), JSON.stringify([f.two.id, 'Sintético B'])]),
    )
    assert.equal(linked.revision, 2)
    assert.equal((await f.request(base + '/context', 'POST', { linkId: result.linkId }, cookie)).status, 200)
    linked = await (await f.request(base + '/atendimentos', 'GET', undefined, cookie)).json()
    assert.equal(linked.activeAtendimentoId, f.one.id)
    const historyAfter = await (await f.request(base + '/messages', 'GET', undefined, cookie)).json()
    assert.deepEqual(historyBefore, historyAfter)
    const removed = await f.request(base + '/atendimentos/' + result.linkId, 'DELETE', { expectedRevision: 2, requestId: randomUUID(), reason: 'close' }, cookie)
    assert.equal(removed.status, 200)
    linked = await (await f.request(base + '/atendimentos', 'GET', undefined, cookie)).json()
    assert.equal(linked.activeAtendimentoId, null)
    assert.deepEqual(linked.items.map((x: { atendimentoId: string }) => x.atendimentoId), [f.two.id])
    assert.equal(f.db.prepare('SELECT max(version) AS v FROM schema_migrations').get()!.v, 16)
    assert.equal((await (await f.request('/api/health')).json()).capabilities.messages, false)
  } finally { f.db.close() }
})
