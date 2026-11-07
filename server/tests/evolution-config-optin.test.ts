import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadEvolutionChat } from '../chat/evolution-config.ts'

test('Evolution Chat is off by default, and only exact opt-in is accepted', () => {
  assert.equal(loadEvolutionChat({}), undefined)
  assert.equal(loadEvolutionChat({ FUNIX_EVOLUTION_READ_ENABLED: 'false' }), undefined)
  assert.equal(loadEvolutionChat({ FUNIX_EVOLUTION_READ_ENABLED: 'TRUE' }), undefined)
  assert.throws(() => loadEvolutionChat({ FUNIX_EVOLUTION_READ_ENABLED: 'true' }), /credentials/)
})

test('Enabled opt-in fails closed without key and valid technical instance ID', () => {
  const enabled = { FUNIX_EVOLUTION_READ_ENABLED: 'true' }
  for (const env of [
    enabled,
    { ...enabled, FUNIX_EVOLUTION_READ_API_KEY: 'dummy' },
    { ...enabled, FUNIX_EVOLUTION_INSTANCE_ID: 'dummy' },
    { ...enabled, FUNIX_EVOLUTION_READ_API_KEY: 'dummy', FUNIX_EVOLUTION_INSTANCE_ID: 'invalid/id' },
  ]) assert.throws(() => loadEvolutionChat(env), /credentials/)
  const bridge = loadEvolutionChat({
    ...enabled, FUNIX_EVOLUTION_READ_API_KEY: 'synthetic-secret', FUNIX_EVOLUTION_INSTANCE_ID: 'synthetic_instance_id',
  })
  assert.ok(bridge)
  assert.equal(typeof bridge.list, 'function')
  assert.equal(typeof bridge.messages, 'function')
  // No API request, secret exposure or network access.
})
