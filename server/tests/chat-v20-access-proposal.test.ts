import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorizedReadRequest, canManageLink, canReadConversation, canSelectContext, type Conversation } from '../experimental/chat-access/policy.ts'

const instance = 'synthetic-test-instance'
const conversation: Conversation = { id: 'conv-A', instance, linkedAttendances: ['att-A', 'att-B'] }
const active = { authenticated: true }
const expired = { authenticated: false }

test('SINGLE-01/02: anonymous and expired sessions cannot read', () => {
  assert.deepEqual(authorizedReadRequest(expired, conversation, instance), { ok: false, reason: 'unauthenticated' })
  assert.equal(canReadConversation(expired, conversation, instance), 'unauthenticated')
})
test('SINGLE-03: sole authenticated operator can read internal instance', () => {
  assert.deepEqual(authorizedReadRequest(active, conversation, instance), { ok: true, conversationId: 'conv-A' })
})
test('SINGLE-04: cross-instance conversation is rejected', () => {
  assert.deepEqual(authorizedReadRequest(active, { ...conversation, instance: 'other' }, instance), { ok: false, reason: 'out_of_scope' })
})
test('SINGLE-06: selected Attendance A/B does not affect conversation read', () => {
  const request = authorizedReadRequest(active, conversation, instance)
  assert.equal(canSelectContext(active, conversation, instance, 'att-A'), 'allow')
  assert.equal(canSelectContext(active, conversation, instance, 'att-B'), 'allow')
  assert.deepEqual(authorizedReadRequest(active, conversation, instance), request)
})
test('SINGLE-07: no Attendance is allowed, with neutral context', () => {
  const unlinked = { ...conversation, linkedAttendances: [] }
  assert.equal(canReadConversation(active, unlinked, instance), 'allow')
  assert.equal(canSelectContext(active, unlinked, instance, 'att-A'), 'not_linked')
})
test('SINGLE-08: unlinked Atendimento cannot become context', () => {
  assert.equal(canSelectContext(active, conversation, instance, 'att-X'), 'not_linked')
  assert.deepEqual(conversation.linkedAttendances, ['att-A', 'att-B'])
})
test('SINGLE-09: link action is restricted to current session and configured instance', () => {
  assert.equal(canManageLink(active, conversation, instance), 'allow')
  assert.equal(canManageLink(expired, conversation, instance), 'unauthenticated')
  assert.equal(canManageLink(active, { ...conversation, instance: 'other' }, instance), 'out_of_scope')
})
test('SINGLE-13: multiple linked Attendances do not restrict sole operator to subset of history', () => {
  assert.equal(canReadConversation(active, conversation, instance), 'allow')
  assert.equal(canReadConversation(active, { ...conversation, linkedAttendances: ['att-B', 'att-A', 'att-C'] }, instance), 'allow')
})
test('Policy sketch returns opaque conversationId only, not message content or JID', () => {
  assert.deepEqual(authorizedReadRequest(active, conversation, instance), { ok: true, conversationId: 'conv-A' })
})
