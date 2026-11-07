import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createRequestHandler } from '../app.ts'
import { createEvolutionChatBridge } from '../chat/evolution-bridge.ts'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'

const origin = 'http://localhost:5173', password = 'synthetic-owner-password'
const jid = '000000000001@s.whatsapp.net'

function fixture(enabled = true, fail = false) {
  const db = openDatabase(':memory:')
  let clock = Date.parse('2026-11-07T10:00:00Z')
  const calls: string[] = []
  const bridge = createEvolutionChatBridge({
    async findChats() {
      calls.push('chats')
      if (fail) throw new Error('private provider error / apikey')
      return [{ remoteJid: jid, updatedAt: '2026-11-07T10:00:00.000Z', unreadCount: 0 }]
    },
    async findMessages(requested, { page } = {}) {
      calls.push('messages:' + page)
      assert.equal(requested, jid)
      if (fail) throw new Error('private provider message body')
      return {
        items: [{
          recordId: 'db-secret-id', instanceId: 'private-instance-id', messageId: 'synthetic-id',
          remoteJid: jid, remoteJidAlt: null, timestamp: 1794045600, fromMe: false as const,
          origin: 'unknown' as const, kind: 'text' as const, text: 'SYNTHETIC ONLY',
          media: null, statuses: [],
        }],
        currentPage: page ?? 1, reportedTotal: 1, reportedPages: 1,
        nextPage: null, consistency: 'offset-not-snapshot' as const,
      }
    },
  }, () => clock)
  const handler = createRequestHandler({
    atendimentos: new AtendimentoRepository(db), password, origin, voiceProvider: null,
    now: () => clock, evolutionChat: enabled ? bridge : undefined,
  })
  const request = async (path: string, cookie = '', method = 'GET', body?: unknown) => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {
      url: path, method, headers: { cookie, origin, 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' },
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
  const login = async () => {
    const res = await request('/api/session', '', 'POST', { password })
    assert.equal(res.status, 200)
    return res.headers.get('set-cookie')!.split(';')[0]!
  }
  return { db, calls, request, login, advance: (ms: number) => { clock += ms } }
}

test('Chat bridge disabled: existing routes and capabilities are unchanged', async () => {
  const f = fixture(false)
  try {
    const cookie = await f.login()
    assert.equal((await f.request('/api/chat/conversations', cookie)).status, 404)
    assert.equal((await f.request('/api/chat/conversations', cookie, 'POST')).status, 405)
    assert.equal((await (await f.request('/api/health')).json()).capabilities.messages, false)
    assert.deepEqual(f.calls, [])
  } finally { f.db.close() }
})

test('Chat bridge requires valid session, returns opaque IDs, no JID/provider IDs', async () => {
  const f = fixture()
  try {
    const anon = await f.request('/api/chat/conversations')
    assert.equal(anon.status, 401)
    assert.deepEqual(f.calls, [])
    const cookie = await f.login()
    const res = await f.request('/api/chat/conversations', cookie)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const data = await res.json()
    assert.equal(data.items.length, 1)
    const id = data.items[0].conversationId
    assert.match(id, /^[a-f0-9-]{36}$/)
    assert(!JSON.stringify(data).includes(jid))
    const page = await f.request('/api/chat/conversations/' + id + '/messages', cookie)
    assert.equal(page.status, 200)
    const messages = await page.json()
    assert.equal(messages.items[0].text, 'SYNTHETIC ONLY')
    assert.equal(messages.historyComplete, 'unknown')
    assert.equal(messages.consistency, 'offset-not-snapshot')
    assert(!JSON.stringify(messages).includes('private-instance-id'))
    assert(!JSON.stringify(messages).includes('db-secret-id'))
    assert(!JSON.stringify(messages).includes(jid))
    assert.deepEqual(f.calls, ['chats', 'messages:1'])
    assert.equal((await (await f.request('/api/health')).json()).capabilities.messages, false)
  } finally { f.db.close() }
})

test('Chat bridge rejects arbitrary provider JID, malformed paths and query before provider calls', async () => {
  const f = fixture()
  try {
    const cookie = await f.login()
    for (const path of [
      '/api/chat/conversations?skip=-1',
      '/api/chat/conversations?skip=0&skip=1',
      '/api/chat/conversations?take=500',
      '/api/chat/conversations/000000000001@s.whatsapp.net/messages',
      '/api/chat/conversations/not-a-uuid/messages',
      '/api/chat/conversations/' + 'a'.repeat(36) + '/messages?page=0',
      '/api/chat/conversations/' + 'a'.repeat(36) + '/messages?remoteJid=123',
    ]) {
      const status = (await f.request(path, cookie)).status
      assert([400, 404].includes(status), path + ' returned ' + status)
    }
    assert.deepEqual(f.calls, [])
  } finally { f.db.close() }
})

test('Chat bridge rejects writes and expired sessions with no provider access', async () => {
  const f = fixture()
  try {
    const cookie = await f.login()
    assert.equal((await f.request('/api/chat/conversations', cookie, 'POST')).status, 405)
    assert.equal((await f.request('/api/chat/conversations', cookie, 'DELETE')).status, 405)
    f.advance(8 * 60 * 60 * 1000 + 1)
    assert.equal((await f.request('/api/chat/conversations', cookie)).status, 401)
    assert.deepEqual(f.calls, [])
  } finally { f.db.close() }
})

test('Chat bridge propagates provider outage as sanitized 503, never empty history', async () => {
  const f = fixture(true, true)
  try {
    const cookie = await f.login()
    const res = await f.request('/api/chat/conversations', cookie)
    assert.equal(res.status, 503)
    const data = await res.json()
    assert.equal(data.error.code, 'CHAT_PROVIDER_UNAVAILABLE')
    assert(!JSON.stringify(data).includes('apikey'))
    assert(!JSON.stringify(data).includes('private provider'))
  } finally { f.db.close() }
})

test('Chat bridge opaque IDs expire and never trigger fallback to arbitrary JID', async () => {
  const f = fixture()
  try {
    const cookie = await f.login()
    const first = await (await f.request('/api/chat/conversations', cookie)).json()
    const id = first.items[0].conversationId
    f.advance(30 * 60 * 1000 + 1)
    assert.equal((await f.request('/api/chat/conversations/' + id + '/messages', cookie)).status, 404)
    assert.deepEqual(f.calls, ['chats'])
  } finally { f.db.close() }
})
