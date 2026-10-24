import test from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createRequestHandler } from '../app.ts'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'

const origin = 'http://localhost:5173'
const password = 'test-only-password-123'

function start(secret: string | undefined = password, now?: () => number, appOrigin = origin, revision?: string) {
  const db = openDatabase(':memory:')
  const repository = new AtendimentoRepository(db)
  const handler = createRequestHandler({ atendimentos: repository, password: secret, origin: appOrigin, now, revision })
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const req = Object.assign(Readable.from(init?.body ? [String(init.body)] : []), {
      url: path, method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers)), socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage
    const headers = new Headers()
    let status = 200
    let body = ''
    const res = {
      setHeader(name: string, value: string) { headers.set(name, value) },
      writeHead(value: number) { status = value },
      end(value: string) { body = value },
    } as unknown as ServerResponse
    await handler(req, res)
    return new Response(body, { status, headers })
  }
  const login = () => request('/api/session', { method: 'POST', headers: { Origin: appOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
  const write = async (path: string, method: string, body: unknown, cookie: string, writeOrigin = appOrigin) => request(path, { method, headers: { Origin: writeOrigin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { db, repository, request, login, write, close: () => db.close() }
}

async function authenticate(app: ReturnType<typeof start>) {
  const login = await app.login()
  assert.equal(login.status, 200)
  return login.headers.get('set-cookie')!.split(';')[0]!
}

test('health reflects local SQLite and protected reads/writes require authentication', async () => {
  const app = start()
  try {
    const health = await app.request('/api/health')
    assert.equal(health.status, 200)
    const body = await health.json()
    assert.equal(body.source.system, 'app')
    assert.equal(body.source.storage, 'sqlite')
    assert.equal(body.capabilities.erp, false)
    for (const method of ['GET', 'POST', 'PATCH']) {
      const response = await app.request('/api/atendimentos', { method })
      assert.equal(response.status, 401)
      assert.equal((await response.json()).error.code, 'AUTH_REQUIRED')
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
  } finally { app.close() }
})

test('session is HttpOnly, expires, and deletion revokes it', async () => {
  let current = 1000
  const app = start(password, () => current)
  try {
    const login = await app.login()
    const cookieHeader = login.headers.get('set-cookie')!
    assert.match(cookieHeader, /HttpOnly; SameSite=Strict; Path=\/api/)
    const cookie = cookieHeader.split(';')[0]!
    assert.equal((await (await app.request('/api/session', { headers: { Cookie: cookie } })).json()).authenticated, true)
    assert.equal((await app.request('/api/atendimentos', { headers: { Cookie: cookie } })).status, 200)
    current += 8 * 60 * 60 * 1000 + 1
    assert.equal((await app.request('/api/atendimentos', { headers: { Cookie: cookie } })).status, 401)
    const secondCookie = await authenticate(app)
    assert.equal((await app.request('/api/session', { method: 'DELETE', headers: { Cookie: secondCookie, Origin: origin } })).status, 200)
    assert.equal((await app.request('/api/atendimentos', { headers: { Cookie: secondCookie } })).status, 401)
  } finally { app.close() }
})

test('rejects cross-origin login and locks excessive login failures', async () => {
  const app = start()
  try {
    assert.equal((await app.request('/api/session', { method: 'POST', headers: { Origin: 'https://invalid.example' } })).status, 403)
    for (let index = 0; index < 8; index++) {
      const response = await app.request('/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })
      assert.equal(response.status, 401)
    }
    assert.equal((await app.login()).status, 429)
  } finally { app.close() }
})

test('creates, searches, edits and reopens local Atendimento without any Coda or network call', async () => {
  const app = start()
  const oldFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = async () => { networkCalls += 1; throw new Error('No network permitted in local commercial') }
  try {
    const cookie = await authenticate(app)
    const created = await app.write('/api/atendimentos', 'POST', { phone: '+55 (11) 99999-1000' }, cookie)
    assert.equal(created.status, 201)
    const record = await created.json()
    assert.match(record.id, /^[\da-f-]{36}$/)
    assert.equal(record.phoneNormalized, '+5511999991000')
    assert.equal(record.name, '')
    const update = await app.write(`/api/atendimentos/${record.id}`, 'PATCH', { revision: record.revision, name: 'Contato de teste', plate: 'TESTE01', notes: 'Primeira revisão' }, cookie)
    assert.equal(update.status, 200)
    const updated = await update.json()
    assert.equal(updated.revision, 2)
    const headers = { Cookie: cookie }
    const list = await (await app.request('/api/atendimentos?q=TESTE01', { headers })).json()
    assert.equal(list.total, 1)
    assert.equal(list.items[0].id, record.id)
    const opened = await (await app.request(`/api/atendimentos/${record.id}`, { headers })).json()
    assert.equal(opened.phone, record.phone)
    assert.equal(opened.notes, 'Primeira revisão')
    assert.equal((await app.request('/api/workspace', { headers })).status, 410)
    assert.equal((await app.request('/api/experiencias/i-test', { headers })).status, 410)
    assert.equal(networkCalls, 0)
  } finally { globalThis.fetch = oldFetch; app.close() }
})

test('writes require origin and JSON; reject malformed payloads, readonly fields and oversized bodies', async () => {
  const app = start()
  try {
    const cookie = await authenticate(app)
    assert.equal((await app.write('/api/atendimentos', 'POST', { phone: '1' }, cookie, 'https://invalid.example')).status, 403)
    assert.equal((await app.request('/api/atendimentos', { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: '{}' })).status, 415)
    assert.equal((await app.request('/api/atendimentos', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{' })).status, 400)
    for (const body of [{}, { phone: '   ' }, { phone: 12 }, { phone: 'abc' }, { phone: '1', id: 'chosen' }, { phone: '1', stage: 'Agendado' }, { phone: '1', notes: 10 }]) {
      assert.equal((await app.write('/api/atendimentos', 'POST', body, cookie)).status, 400)
    }
    assert.equal((await app.write('/api/atendimentos', 'POST', { phone: '1', notes: 'x'.repeat(70_000) }, cookie)).status, 413)
    assert.equal((await app.request('/api/atendimentos?limit=999', { headers: { Cookie: cookie } })).status, 400)
    assert.equal((await app.request('/api/atendimentos/not-an-id', { headers: { Cookie: cookie } })).status, 404)
    assert.equal((await app.write('/api/atendimentos', 'DELETE', {}, cookie)).status, 405)
    assert.equal(app.repository.list().total, 0)
  } finally { app.close() }
})

test('stale editing and rejected stage need explicit review; neither silently changes data', async () => {
  const app = start()
  try {
    const cookie = await authenticate(app)
    const original = await (await app.write('/api/atendimentos', 'POST', { phone: '1', name: 'Original' }, cookie)).json()
    const path = `/api/atendimentos/${original.id}`
    assert.equal((await app.write(path, 'PATCH', { revision: 1, stage: 'rejeitados' }, cookie)).status, 400)
    assert.equal((await app.write(path, 'PATCH', { revision: 1, stage: 'aguardando-dados' }, cookie)).status, 200)
    const stale = await app.write(path, 'PATCH', { revision: 1, name: 'Stale' }, cookie)
    assert.equal(stale.status, 409)
    assert.equal((await stale.json()).error.code, 'VERSION_CONFLICT')
    assert.equal(app.repository.get(original.id).name, 'Original')
    assert.equal((await app.write(path, 'PATCH', { revision: 2, stage: 'rejeitados', explicitRefusal: true, rejectionReason: 'Recusa explícita de teste' }, cookie)).status, 200)
  } finally { app.close() }
})

test('short/unconfigured password leaves access closed and readiness reflects database failures', async () => {
  const app = start('short')
  try {
    assert.deepEqual(await (await app.request('/api/session')).json(), { authenticated: false, configured: false })
    assert.equal((await app.login()).status, 503)
    assert.equal((await app.request('/api/ready')).status, 503)
  } finally { app.close() }
  const unavailable = start()
  unavailable.close()
  const ready = await unavailable.request('/api/ready')
  assert.equal(ready.status, 503)
  assert.equal((await ready.json()).error.code, 'DATABASE_UNAVAILABLE')
})

test('HTTPS production origin keeps secure cookies and reports readiness without exposing credentials', async () => {
  const revision = 'a'.repeat(40)
  const app = start(password, undefined, 'https://app.funix.com.br', revision)
  try {
    const ready = await app.request('/api/ready')
    assert.equal(ready.status, 200)
    assert.deepEqual(await ready.json(), { status: 'ready', revision, source: 'app', storage: 'sqlite' })
    const login = await app.login()
    assert.equal(login.status, 200)
    assert.match(login.headers.get('set-cookie')!, /; Secure$/)
    assert.equal((await app.request('/api/session', { method: 'DELETE', headers: { Origin: 'http://app.funix.com.br' } })).status, 403)
  } finally { app.close() }
})
