import assert from 'node:assert/strict'
import test from 'node:test'
import { filterLoadedConversations } from '../../src/chat/conversation-search'
import type { ConversationRow } from '../../src/chat/evolution-read-model'

const row = (id: string, name: string | null, phone: string | null): ConversationRow => ({
  conversationId: id, displayName: name, phoneNumber: phone, updatedAt: null, unreadCount: 0,
})
const rows = [row('a', 'João Silva', '5531999990001'), row('b', 'MARIA   Costa', '5531988880002'),
  row('c', null, null), row('d', 'Joao Pereira', '5531977770003')]

test('loaded-page search handles accents, casing and repeated spaces', () => {
  assert.deepEqual(filterLoadedConversations(rows, '  joao  ').map(x => x.conversationId), ['a', 'd'])
  assert.deepEqual(filterLoadedConversations(rows, 'maria costa').map(x => x.conversationId), ['b'])
  assert.equal(rows.length, 4)
})

test('searches phone digits without changing any identity or link', () => {
  assert.deepEqual(filterLoadedConversations(rows, '(31) 99999-0001').map(x => x.conversationId), ['a'])
  assert.deepEqual(filterLoadedConversations(rows, '8888').map(x => x.conversationId), ['b'])
  assert.deepEqual(filterLoadedConversations(rows, '999999999999'), [])
})

test('clearing a search restores all loaded conversations including unidentified contacts', () => {
  assert.deepEqual(filterLoadedConversations(rows, '  '), rows)
  assert.deepEqual(filterLoadedConversations(rows, 'inexistente'), [])
})
