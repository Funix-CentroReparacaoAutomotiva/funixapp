import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorizedReadRequest, canManageLink, canReadConversation, canSelectContext, type Conversation, type Principal } from '../experimental/chat-access/policy.ts'

const conversation: Conversation = { id: 'conv-A', instance: 'synthetic', linkedAttendances: ['att-A', 'att-B'] }
const base: Principal = { authenticated: true, individualId: 'user-A', instances: ['synthetic'], permissions: ['chat.inbox.read', 'chat.history.read_full'], visibleAttendances: ['att-A', 'att-B'] }
const principal = (patch: Partial<Principal> = {}): Principal => ({ ...base, ...patch })

test('AUTH-01: expired or absent session denied', () => {
  assert.deepEqual(authorizedReadRequest(principal({ authenticated: false }), conversation), { ok: false, reason: 'unauthenticated' })
})
test('AUTH-02: shared password without individual identity cannot read', () => {
  assert.equal(canReadConversation(principal({ individualId: null }), conversation), 'denied')
})
test('AUTH-03/16: Attendance A access alone cannot reveal A+B conversation', () => {
  assert.equal(canReadConversation(principal({ permissions: ['chat.inbox.read'], visibleAttendances: ['att-A'] }), conversation), 'denied')
})
test('AUTH-04: switching context A to B preserves conversation request', () => {
  const before = authorizedReadRequest(base, conversation)
  assert.equal(canSelectContext(base, conversation, 'att-A'), 'allow')
  assert.equal(canSelectContext(base, conversation, 'att-B'), 'allow')
  assert.deepEqual(authorizedReadRequest(base, conversation), before)
})
test('AUTH-05: authorized unlinked Chat gets neutral context', () => {
  const unlinked = { ...conversation, linkedAttendances: [] }
  assert.equal(canReadConversation(base, unlinked), 'allow')
  assert.equal(canSelectContext(base, unlinked, 'att-A'), 'denied')
})
test('AUTH-06: technical support lacking read-full cannot read content', () => {
  assert.equal(canReadConversation(principal({ permissions: ['chat.inbox.read'] }), conversation), 'denied')
})
test('AUTH-07: cross-instance access denied', () => {
  assert.equal(canReadConversation(principal({ instances: ['other'] }), conversation), 'denied')
})
test('AUTH-09/11: link management requires grant plus target Attendance scope', () => {
  assert.equal(canManageLink(base, conversation, 'att-A'), 'denied')
  assert.equal(canManageLink(principal({ permissions: ['chat.links.manage'], visibleAttendances: ['att-A'] }), conversation, 'att-B'), 'denied')
  assert.equal(canManageLink(principal({ permissions: ['chat.links.manage'] }), conversation, 'att-B'), 'allow')
})
test('AUTH-12: unlinked Attendance cannot be selected or inserted implicitly', () => {
  assert.equal(canSelectContext(base, conversation, 'att-C'), 'denied')
  assert.deepEqual(conversation.linkedAttendances, ['att-A', 'att-B'])
})
test('AUTH-14: revoked permission is applied on next decision', () => {
  assert.equal(canReadConversation(base, conversation), 'allow')
  assert.equal(canReadConversation(principal({ permissions: [] }), conversation), 'denied')
})
test('Policy output excludes provider JID, message content and secrets', () => {
  assert.deepEqual(authorizedReadRequest(base, conversation), { ok: true, conversationId: 'conv-A' })
})
