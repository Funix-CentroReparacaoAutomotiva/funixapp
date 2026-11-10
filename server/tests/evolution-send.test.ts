import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEvolutionTextSender } from '../chat/evolution-send.ts'

const jid = '5531999990001@s.whatsapp.net'
const origin = 'http://evolution-api:8080'
const options = { origin, apiKey: 'synthetic-server-secret', instance: 'funix_comercial' }

test('Evolution text sender uses the known instance, JID PN and bounded text without leaking secrets', async () => {
  const calls: Array<{ url: string; body: unknown; method: string | undefined }> = []
  const sender = createEvolutionTextSender({ ...options, fetcher: async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), method: init?.method })
    const h = new Headers(init?.headers)
    assert.equal(h.get('apikey'), options.apiKey)
    return new Response(JSON.stringify({ key: { id: 'SYNTHETIC-MESSAGE-123', fromMe: true } }), { status: 201 })
  } })
  const receipt = await sender(jid, 'Olá, tudo bem?')
  assert.deepEqual(receipt, { messageId: 'SYNTHETIC-MESSAGE-123' })
  assert.deepEqual(calls, [{ url: origin + '/message/sendText/funix_comercial',
    body: { number: '5531999990001', text: 'Olá, tudo bem?', linkPreview: false }, method: 'POST' }])
})

test('Evolution text sender rejects invalid recipient, empty text, huge text and bad configuration before HTTP', async () => {
  let calls = 0
  const sender = createEvolutionTextSender({ ...options, fetcher: async () => {
    calls++
    throw new Error('SHOULD_NOT_FETCH')
  } })
  for (const [who, what] of [
    ['123456789@lid', 'Olá'], ['55110001111@g.us', 'Olá'], ['55110001111@s.whatsapp.net', ' '],
    [jid, 'a'.repeat(4097)], [jid, 'bad\u0000char'],
  ]) await assert.rejects(sender(who, what), /EVOLUTION_SEND_INPUT_INVALID/)
  assert.equal(calls, 0)
  assert.throws(() => createEvolutionTextSender({ ...options, origin: 'https://user:pass@example.com' }), /CONFIG_INVALID/)
})

test('Evolution text sender never retries failed/uncertain calls and strips provider contents', async () => {
  let calls = 0
  const sender = createEvolutionTextSender({ ...options, fetcher: async () => {
    calls++
    return new Response('provider-private-data', { status: 500 })
  } })
  await assert.rejects(sender(jid, 'Mensagem de teste'), error => {
    assert(!String(error).includes('private-data'))
    return true
  })
  assert.equal(calls, 1)
  const noReceipt = createEvolutionTextSender({ ...options, fetcher: async () =>
    new Response(JSON.stringify({ unexpected: 'private data' }), { status: 200 }) })
  await assert.rejects(noReceipt(jid, 'Mensagem de teste'), /EVOLUTION_SEND_INVALID_RECEIPT/)
})
