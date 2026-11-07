import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeReadMessages, parseConversationList, parseConversationMessages } from '../../src/chat/evolution-read-model.ts'

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const rows = { source: 'evolution', nextSkip: null, items: [{ conversationId: a, updatedAt: null, unreadCount: 0 }] }
const message = (messageId: string, timestamp: number) => ({ messageId, timestamp, fromMe: false, kind: 'text', text: 'EXEMPLO SINTÉTICO' })
const messages = { source: 'evolution', conversationId: a, page: 1, nextPage: null,
  reportedTotal: 1, consistency: 'offset-not-snapshot', historyComplete: 'unknown',
  items: [message('synthetic-1', 1794045600)] }

test('list projection accepts only opaque backend IDs; never accepts JID or arbitrary data', () => {
  assert.deepEqual(parseConversationList(rows), rows)
  assert.throws(() => parseConversationList({ ...rows, items: [{ conversationId: '00000000001@s.whatsapp.net', updatedAt: null, unreadCount: 0 }] }), /CHAT_READ_RESPONSE_INVALID/)
  assert.throws(() => parseConversationList({ ...rows, items: [rows.items[0], rows.items[0]] }), /CHAT_READ_RESPONSE_INVALID/)
  assert.throws(() => parseConversationList({ ...rows, nextSkip: -1 }), /CHAT_READ_RESPONSE_INVALID/)
  assert.throws(() => parseConversationList({ ...rows, source: 'unknown' }), /CHAT_READ_RESPONSE_INVALID/)
})

test('message projection requires selected conversation; does not include backend-only fields', () => {
  const raw = { ...messages, items: [{ ...message('synthetic-1', 1794045600), remoteJid: 'PRIVATE', recordId: 'PRIVATE', origin: 'unknown', statuses: [], media: null }] }
  const result = parseConversationMessages(raw, a)
  assert.deepEqual(result.items, [message('synthetic-1', 1794045600)])
  assert.equal(result.historyComplete, 'unknown')
  assert.throws(() => parseConversationMessages(raw, b), /CHAT_READ_RESPONSE_INVALID/)
})

test('message projection rejects false completeness, invalid page, unsupported shape and oversized text', () => {
  assert.throws(() => parseConversationMessages({ ...messages, historyComplete: 'complete' }, a), /CHAT_READ_RESPONSE_INVALID/)
  assert.throws(() => parseConversationMessages({ ...messages, nextPage: 7 }, a), /CHAT_READ_RESPONSE_INVALID/)
  assert.throws(() => parseConversationMessages({ ...messages, items: [message('bad', -1)] }, a), /CHAT_READ_RESPONSE_INVALID/)
  assert.throws(() => parseConversationMessages({ ...messages, items: [message('bad', 1), { ...message('x', 1), text: 'x'.repeat(16385) }] }, a), /CHAT_READ_RESPONSE_INVALID/)
})

test('dedup handles overlap and stable order, not claiming completeness of offset pages', () => {
  const newest = [message('b', 200), message('c', 300)]
  const older = [message('a', 100), message('b', 200)]
  assert.deepEqual(mergeReadMessages(newest, older).map(row => row.messageId), ['a', 'b', 'c'])
  assert.deepEqual(mergeReadMessages(newest, [{ ...message('b', 200), text: 'NOVA VERSÃO' }])[0]?.text, 'NOVA VERSÃO')
})
