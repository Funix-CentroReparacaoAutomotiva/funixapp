import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEvolutionHttpTransport } from '../experimental/evolution-read/http-transport.ts'
import type { ReadRequest } from '../experimental/evolution-read/client.ts'

const read: ReadRequest = {
  method: 'POST', path: '/chat/findMessages/funix_comercial',
  body: { where: { key: { remoteJid: '000000000001@s.whatsapp.net', remoteJidAlt: '000000000001@s.whatsapp.net' } }, page: 1, offset: 1 },
  signal: new AbortController().signal,
}

const stub = (handle: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (async (url: URL | RequestInfo, init?: RequestInit) => handle(String(url), init ?? {})) as typeof fetch

test('HTTP adapter: allowed path, server-only apikey, POST and synthetic response', async () => {
  let calls = 0
  const transport = createEvolutionHttpTransport({
    origin: 'http://evolution-internal:8080',
    apiKey: 'fake-test-secret',
    fetcher: stub((url, init) => {
      calls++
      assert.equal(url, 'http://evolution-internal:8080/chat/findMessages/funix_comercial')
      assert.equal(init.method, 'POST')
      assert.equal(init.redirect, 'error')
      assert.equal(init.cache, 'no-store')
      assert.equal((init.headers as Record<string, string>).apikey, 'fake-test-secret')
      assert.equal(init.signal, read.signal)
      assert.deepEqual(JSON.parse(String(init.body)), read.body)
      return Response.json({ messages: { records: [], total: 0, pages: 0, currentPage: 1 } })
    }),
  })
  assert.deepEqual(await transport(read), { status: 200, body: { messages: { records: [], total: 0, pages: 0, currentPage: 1 } } })
  assert.equal(calls, 1)
})

test('HTTP adapter: refusal for non-whitelisted paths without calling provider', async () => {
  let calls = 0
  const transport = createEvolutionHttpTransport({ origin: 'http://internal:8080', apiKey: 'fake', fetcher: stub(() => {
    calls++; return Response.json({})
  }) })
  await assert.rejects(transport({ ...read, path: '/message/sendText/funix_comercial' }), /configuration invalid/)
  await assert.rejects(transport({ ...read, path: '/chat/findMessages/../secret' }), /configuration invalid/)
  await assert.rejects(transport({ ...read, path: '/chat/findMessages/other?token=1' }), /configuration invalid/)
  assert.equal(calls, 0)
})

test('HTTP adapter: requires explicit origin, credentials and bounds, no default network', () => {
  for (const origin of [
    'https://some:secret@internal:443', 'http://internal:8080/path',
    'file:///etc/passwd', 'http://internal:8080/?token=x', 'http://internal:8080/#tag',
  ]) assert.throws(() => createEvolutionHttpTransport({ origin, apiKey: 'fake' }), /configuration invalid/)
  assert.throws(() => createEvolutionHttpTransport({ origin: 'http://internal:8080', apiKey: '' }), /configuration invalid/)
  assert.throws(() => createEvolutionHttpTransport({ origin: 'http://internal:8080', apiKey: 'a\nb' }), /configuration invalid/)
  assert.throws(() => createEvolutionHttpTransport({ origin: 'http://internal:8080', apiKey: 'fake', maxResponseBytes: 1_048_577 }), /configuration invalid/)
})

test('HTTP adapter: drops provider error body and preserves status', async () => {
  const transport = createEvolutionHttpTransport({
    origin: 'http://internal:8080', apiKey: 'fake',
    fetcher: stub(() => new Response('private provider body', { status: 403 })),
  })
  assert.deepEqual(await transport(read), { status: 403, body: null })
})

test('HTTP adapter: rejects oversized response before JSON parsing', async () => {
  const transport = createEvolutionHttpTransport({
    origin: 'http://internal:8080', apiKey: 'fake', maxResponseBytes: 12,
    fetcher: stub(() => new Response('{"private":"a long message"}', { status: 200 })),
  })
  await assert.rejects(transport(read), /response invalid/)
})

test('HTTP adapter: rejects malformed JSON without exposing body', async () => {
  const transport = createEvolutionHttpTransport({
    origin: 'http://internal:8080', apiKey: 'fake',
    fetcher: stub(() => new Response('{private', { status: 200 })),
  })
  await assert.rejects(transport(read), /response invalid/)
})

test('HTTP adapter: handles chat list operation and tiny bounded response', async () => {
  const transport = createEvolutionHttpTransport({
    origin: 'http://internal:8080', apiKey: 'fake',
    fetcher: stub((url) => {
      assert.ok(url.endsWith('/chat/findChats/funix_comercial'))
      return Response.json([])
    }),
  })
  assert.deepEqual(await transport({ ...read, path: '/chat/findChats/funix_comercial', body: { take: 1, skip: 0 } }), { status: 200, body: [] })
})
