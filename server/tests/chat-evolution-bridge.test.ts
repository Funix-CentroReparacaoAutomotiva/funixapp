import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createRequestHandler } from '../app.ts'
import { createEvolutionChatBridge } from '../chat/evolution-bridge.ts'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../chat/coda-sync.ts'

const origin = 'http://localhost:5173', password = 'synthetic-owner-password'
const jid = '000000000001@s.whatsapp.net'

function fixture(enabled = true, fail = false, canonical = false, sendEnabled = false) {
  const db = openDatabase(':memory:')
  if (canonical) createCodaEventSchema(db)
  const sync = canonical ? new CodaEventSyncRepository(db) : undefined
  let clock = Date.parse('2026-11-07T10:00:00Z')
  const calls: string[] = []
  const sendCalls: Array<{ jid: string; text: string }> = []
  const bridge = createEvolutionChatBridge({
    async findChatsPage() {
      calls.push('chats')
      if (fail) throw new Error('private provider error / apikey')
      return {
        items: [{ remoteJid: jid, displayName: 'Contato Sintético', phoneNumber: '000000000001', updatedAt: '2026-11-07T10:00:00.000Z', unreadCount: 0 }],
        sourceCount: 1,
      }
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
  }, () => clock, undefined, sync, sendEnabled ? async (requested, text) => {
    sendCalls.push({ jid: requested, text })
    return { messageId: 'SYNTHETIC-SEND' }
  } : undefined)
  const handler = createRequestHandler({
    atendimentos: new AtendimentoRepository(db), password, origin, voiceProvider: null,
    now: () => clock, evolutionChat: enabled ? bridge : undefined,
    ...(sync ? { codaSync: { repo: sync, secret: Buffer.alloc(32, 9) } } : {}),
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
  return { db, sync, calls, sendCalls, request, login, advance: (ms: number) => { clock += ms } }
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
    assert.equal(data.items[0].displayName, 'Contato Sintético')
    assert.equal(data.items[0].phoneNumber, '000000000001')
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

test('Chat bridge paginates by provider rows, not by visible individuals', async () => {
  const db = openDatabase(':memory:')
  try {
    const pages: number[] = []
    const bridge = createEvolutionChatBridge({
      async findChatsPage(options = {}) {
        const { take, skip } = options
        assert.equal(take, 50)
        assert.equal(typeof skip, 'number')
        pages.push(skip!)
        if (skip === 0) return { items: [], sourceCount: 50 } // all unsupported provider rows
        if (skip === 50) return { items: [{ remoteJid: jid, displayName: 'Pessoa Sintética', phoneNumber: '000000000001', updatedAt: null, unreadCount: 0 }], sourceCount: 2 }
        if (skip === 500000) return { items: [], sourceCount: 50 }
        return { items: [], sourceCount: 0 }
      },
      async findMessages() { throw Error('Not called') },
    })
    const first = await bridge.list(0)
    assert.deepEqual(first.items, [])
    assert.equal(first.nextSkip, 50)
    const second = await bridge.list(first.nextSkip)
    assert.equal(second.items.length, 1)
    assert.equal(second.nextSkip, null)
    assert.deepEqual(pages, [0, 50])
    // A complete page at the provider's permitted maximum has no further cursor.
    const atBound = await bridge.list(500000)
    assert.equal(atBound.nextSkip, null)
  } finally { db.close() }
})

test('canonical Coda Evolution route requires operator session and matching active Atendimento', async () => {
  const f = fixture(true, false, true)
  try {
    const signedEvent = {
      version: 1, source: 'coda', eventId: 'evo:synthetic:canonical',
      codaRowId: 'i-CANON_A', instance: 'funix_comercial',
      remoteJid: jid, phoneE164: null,
      displayName: 'Contato Sintético', occurredAt: 1794144000,
    }
    const id = f.sync!.sync(signedEvent).atendimentoId
    const cookie = await f.login()
    const list = await (await f.request('/api/chat/conversations', cookie)).json()
    const conversationId = list.items[0].conversationId
    assert.equal(list.items[0].atendimentoId, id)
    const path = `/api/atendimentos/${id}/evolution-conversations/${conversationId}/messages`
    assert.equal((await f.request(path)).status, 401)
    assert.equal((await f.request(path, cookie, 'POST')).status, 405)
    assert.equal((await f.request(path + '?page=0', cookie)).status, 400)
    assert.equal((await f.request(path + '?remoteJid=spoof', cookie)).status, 400)
    assert.equal((await f.request(path.replace(id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), cookie)).status, 404)
    assert.deepEqual(f.calls, ['chats'])
    const result = await f.request(path, cookie)
    assert.equal(result.status, 200)
    assert.equal((await result.json()).items[0].text, 'SYNTHETIC ONLY')
    assert.deepEqual(f.calls, ['chats', 'messages:1'])
    f.sync!.sync({ ...signedEvent, eventId: 'evo:synthetic:new-row',
      codaRowId: 'i-CANON_B', occurredAt: 1794144050 })
    assert.equal((await f.request(path, cookie)).status, 404)
    assert.deepEqual(f.calls, ['chats', 'messages:1'])
  } finally { f.db.close() }
})

test('direct Funil opens canonical Evolution context without a preceding conversation-list request', async () => {
  const f = fixture(true, false, true)
  try {
    const row = { version: 1, source: 'coda', eventId: 'evo:synthetic:direct',
      codaRowId: 'i-DIRECT_A', instance: 'funix_comercial',
      remoteJid: jid, phoneE164: null, displayName: 'Contato Sintético', occurredAt: 1794144000 }
    const id = f.sync!.sync(row).atendimentoId
    const path = `/api/atendimentos/${id}/evolution-conversation`
    const cookie = await f.login()
    assert.equal((await f.request(path)).status, 401)
    assert.equal((await f.request(path, cookie, 'POST')).status, 405)
    assert.equal((await f.request(path+'?phone=000000000001', cookie)).status, 400)
    assert.equal((await f.request('/api/atendimentos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/evolution-conversation', cookie)).status, 404)
    const result = await f.request(path, cookie)
    assert.equal(result.status, 200)
    const {conversationId} = await result.json()
    assert.match(conversationId,/^[0-9a-f-]{36}$/)
    const messages = await f.request(`/api/atendimentos/${id}/evolution-conversations/${conversationId}/messages`,cookie)
    assert.equal(messages.status, 200)
    assert.equal((await messages.json()).items[0].text,'SYNTHETIC ONLY')
    assert.deepEqual(f.calls, ['messages:1'])
    f.sync!.sync({...row,eventId:'evo:synthetic:direct-b',codaRowId:'i-DIRECT_B',occurredAt:1794144050})
    assert.equal((await f.request(path, cookie)).status,404)
    assert.equal((await f.request(`/api/atendimentos/${id}/evolution-conversations/${conversationId}/messages`,cookie)).status,404)
    assert.deepEqual(f.calls,['messages:1'])
  } finally { f.db.close() }
})

test('direct Funil resolver stays unavailable without both Evolution and canonical Coda opt-ins', async () => {
  for (const f of [fixture(true,false,false),fixture(false,false,true)]) {
    try {
      const cookie = await f.login()
      assert.equal((await f.request('/api/atendimentos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/evolution-conversation',cookie)).status,404)
      assert.deepEqual(f.calls,[])
    } finally {f.db.close()}
  }
})

test('text send is off by default; canonical send has exact Atendimento/JID binding and a single provider call', async () => {
  const previous = process.env.FUNIX_EVOLUTION_SEND_ENABLED
  process.env.FUNIX_EVOLUTION_SEND_ENABLED = 'true'
  const f = fixture(true, false, true, true)
  try {
    const event = { version: 1, source: 'coda', eventId: 'evo:synthetic:send',
      codaRowId: 'i-TEXT_SEND_A', instance: 'funix_comercial', remoteJid: jid,
      phoneE164: null, displayName: 'Contato Sintético', occurredAt: 1794144000 }
    const atendimentoId = f.sync!.sync(event).atendimentoId
    const cookie = await f.login()
    const listing = await (await f.request('/api/chat/conversations', cookie)).json()
    const conversationId = listing.items[0].conversationId
    const path = `/api/atendimentos/${atendimentoId}/evolution-conversations/${conversationId}/send-text`
    assert.equal((await f.request(path, '', 'POST', { text: 'oi' })).status, 401)
    assert.equal((await f.request(path, cookie, 'GET')).status, 405)
    assert.equal((await f.request(path + '?remoteJid=spoof', cookie, 'POST', { text: 'oi' })).status, 400)
    assert.equal((await f.request(path, cookie, 'POST', { text: '' })).status, 400)
    assert.equal((await f.request(path, cookie, 'POST', { text: 'oi', jid: 'spoof@s.whatsapp.net' })).status, 400)
    assert.equal((await f.request(path.replace(atendimentoId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), cookie, 'POST', { text: 'oi' })).status, 404)
    assert.deepEqual(f.sendCalls, [])
    const sent = await f.request(path, cookie, 'POST', { text: 'Olá pelo FunixApp' })
    assert.equal(sent.status, 200)
    assert.deepEqual(await sent.json(), { state: 'accepted', messageId: 'SYNTHETIC-SEND' })
    assert.deepEqual(f.sendCalls, [{ jid, text: 'Olá pelo FunixApp' }])
    f.sync!.sync({ ...event, eventId: 'evo:synthetic:send-switched',
      codaRowId: 'i-TEXT_SEND_B', occurredAt: 1794144050 })
    assert.equal((await f.request(path, cookie, 'POST', { text: 'não enviar' })).status, 404)
    assert.equal(f.sendCalls.length, 1)
  } finally {
    if (previous === undefined) delete process.env.FUNIX_EVOLUTION_SEND_ENABLED
    else process.env.FUNIX_EVOLUTION_SEND_ENABLED = previous
    f.db.close()
  }
})

test('sending stays disabled despite injected sender while runtime feature flag is off', async () => {
  const previous = process.env.FUNIX_EVOLUTION_SEND_ENABLED
  delete process.env.FUNIX_EVOLUTION_SEND_ENABLED
  const f = fixture(true, false, true, true)
  try {
    const cookie = await f.login()
    const res = await f.request('/api/atendimentos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/evolution-conversations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/send-text', cookie, 'POST', {text:'olá'})
    assert.equal(res.status, 503)
    assert.deepEqual(f.sendCalls, [])
  } finally {
    if (previous === undefined) delete process.env.FUNIX_EVOLUTION_SEND_ENABLED
    else process.env.FUNIX_EVOLUTION_SEND_ENABLED = previous
    f.db.close()
  }
})
