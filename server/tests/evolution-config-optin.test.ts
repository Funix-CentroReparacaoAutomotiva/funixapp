import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadEvolutionChat } from '../chat/evolution-config.ts'

test('Evolution is not created by default; absent and malformed flags fail closed', () => {
  {
    assert.equal(loadEvolutionChat({}), undefined)
    assert.equal(loadEvolutionChat({ FUNIX_EVOLUTION_READ_ENABLED: 'false' }), undefined)
    assert.equal(loadEvolutionChat({ FUNIX_EVOLUTION_READ_ENABLED: 'TRUE' }), undefined)
    assert.throws(() => loadEvolutionChat({ FUNIX_EVOLUTION_READ_ENABLED: 'true' }), /configuration|credentials/)
  }
})

test('Explicit enabled flag requires both secret and technical instance ID', () => {
  const db = openDatabase(':memory:')
  try {
    const enabled = { FUNIX_EVOLUTION_READ_ENABLED: 'true' }
    for (const env of [
      enabled,
      { ...enabled, FUNIX_EVOLUTION_READ_API_KEY: 'dummy' },
      { ...enabled, FUNIX_EVOLUTION_INSTANCE_ID: 'dummy' },
      { ...enabled, FUNIX_EVOLUTION_READ_API_KEY: 'dummy', FUNIX_EVOLUTION_INSTANCE_ID: 'invalid/id' },
    ]) assert.throws(() => loadEvolutionChat(env), /credentials\/instance ID are unavailable/)
    const bridge = loadEvolutionChat({
      ...enabled, FUNIX_EVOLUTION_READ_API_KEY: 'synthetic-secret', FUNIX_EVOLUTION_INSTANCE_ID: 'synthetic_instance_id',
    })
    assert.ok(bridge)
    assert.equal(typeof bridge.list, 'function')
    assert.equal(typeof bridge.messages, 'function')
    // Never invoke: production URL is fixed, and this test performs zero network calls.
  } finally { db.close() }
})
