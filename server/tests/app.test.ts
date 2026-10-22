import test from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createRequestHandler } from '../app.ts'
import { CodaReadRepository } from '../coda.ts'
import type { ReadRepository } from '../repository.ts'

const origin = 'http://localhost:5173'
const password = 'test-only-password-123'
const repository: ReadRepository = {
  configured: true,
  async workspace() { return { items: [], stages: [], nextCursor: null, source: { system: 'coda', mode: 'live', fetchedAt: new Date().toISOString() }, capabilities: { write: false, messages: false } } },
  async record() { throw new Error('No record fixture') },
}

async function start(repo = repository, secret: string | undefined = password, now?: () => number) {
  const handler = createRequestHandler({ repository: repo, password: secret, origin, now })
  // Exercise HTTP semantics in process: no network permission, sockets, or upstream calls.
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
  const login = () => request('/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
  const close = async () => {}
  return { request, login, close }
}

test('health has no business records and protected reads require authentication', async () => {
  const app = await start()
  try {
    const health = await app.request('/api/health')
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok', source: { system: 'coda', configured: true }, readOnly: true })
    const response = await app.request('/api/workspace')
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error.code, 'AUTH_REQUIRED')
    assert.equal(response.headers.get('cache-control'), 'no-store')
  } finally { await app.close() }
})

test('session is HttpOnly, expires, and deletion revokes it', async () => {
  let current = 1000
  const app = await start(repository, password, () => current)
  try {
    const login = await app.login()
    assert.equal(login.status, 200)
    const cookieHeader = login.headers.get('set-cookie')!
    assert.match(cookieHeader, /HttpOnly; SameSite=Strict; Path=\/api/)
    const cookie = cookieHeader.split(';')[0]!
    const session = await app.request('/api/session', { headers: { Cookie: cookie } })
    assert.equal((await session.json()).authenticated, true)
    const data = await app.request('/api/workspace', { headers: { Cookie: cookie } })
    assert.equal(data.status, 200)
    current += 8 * 60 * 60 * 1000 + 1
    assert.equal((await app.request('/api/workspace', { headers: { Cookie: cookie } })).status, 401)
    const second = await app.login()
    const secondCookie = second.headers.get('set-cookie')!.split(';')[0]!
    assert.equal((await app.request('/api/session', { method: 'DELETE', headers: { Cookie: secondCookie, Origin: origin } })).status, 200)
    assert.equal((await app.request('/api/workspace', { headers: { Cookie: secondCookie } })).status, 401)
  } finally { await app.close() }
})

test('rejects cross-origin login and locks excessive login failures', async () => {
  const app = await start()
  try {
    assert.equal((await app.request('/api/session', { method: 'POST', headers: { Origin: 'https://invalid.example' } })).status, 403)
    for (let index = 0; index < 8; index++) {
      const response = await app.request('/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })
      assert.equal(response.status, 401)
    }
    assert.equal((await app.login()).status, 429)
  } finally { await app.close() }
})

test('never accepts operational mutation and keeps history policy explicit', async () => {
  const app = await start()
  try {
    const login = await app.login()
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await app.request('/api/experiencias/i-test', { method, headers: { Cookie: cookie } })).status, 405)
    const history = await app.request('/api/workspace?area=veiculos&scope=historico', { headers: { Cookie: cookie } })
    assert.equal(history.status, 409)
    assert.equal((await history.json()).error.code, 'HISTORY_POLICY_PENDING')
    assert.equal((await app.request('/api/workspace?limit=999', { headers: { Cookie: cookie } })).status, 400)
    assert.equal((await app.request('/api/atendimentos/not-a-coda-row', { headers: { Cookie: cookie } })).status, 404)
  } finally { await app.close() }
})

test('without integration returns 503 rather than successful empty data', async () => {
  const app = await start(new CodaReadRepository())
  try {
    const login = await app.login()
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const result = await app.request('/api/workspace', { headers: { Cookie: cookie } })
    assert.equal(result.status, 503)
    const body = await result.json()
    assert.equal(body.error.code, 'CODA_NOT_CONFIGURED')
    assert.ok(body.error.requestId)
    assert.equal('items' in body, false)
  } finally { await app.close() }
})

test('short/unconfigured password leaves access closed', async () => {
  const app = await start(repository, 'short')
  try {
    assert.deepEqual(await (await app.request('/api/session')).json(), { authenticated: false, configured: false })
    assert.equal((await app.login()).status, 503)
  } finally { await app.close() }
})
