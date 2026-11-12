import assert from 'node:assert/strict'
import test from 'node:test'
import { filterLoadedConversations } from '../../src/chat/conversation-search.ts'

const row = (id, name, phone) => ({ conversationId: id, displayName: name, phoneNumber: phone,
  updatedAt: null, unreadCount: 0 })
const rows = [row('a', 'João Silva', '5531999990001'), row('b', 'MARIA   Costa', '5531988880002'),
  row('c', null, null), row('d', 'Joao Pereira', '5531977770003')]

test('search matches name with accent, case and repeated spaces without changing original rows', () => {
  assert.deepEqual(filterLoadedConversations(rows, '  joao  ').map(x => x.conversationId), ['a', 'd'])
  assert.deepEqual(filterLoadedConversations(rows, 'maria costa').map(x => x.conversationId), ['b'])
  assert.equal(rows.length, 4)
})

test('search matches phone digits but not display names as numeric identities', () => {
  assert.deepEqual(filterLoadedConversations(rows, '(31) 99999-0001').map(x => x.conversationId), ['a'])
  assert.deepEqual(filterLoadedConversations(rows, '8888').map(x => x.conversationId), ['b'])
  assert.deepEqual(filterLoadedConversations(rows, '999999999999').map(x => x.conversationId), [])
})

test('clearing search restores complete loaded list, including unidentified contacts', () => {
  assert.deepEqual(filterLoadedConversations(rows, '  '), rows)
  assert.deepEqual(filterLoadedConversations(rows, 'inexistente'), [])
})
