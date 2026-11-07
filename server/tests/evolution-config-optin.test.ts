import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { loadEvolutionChat } from '../chat/evolution-config.ts'

test('Evolution is not created by default; absent and malformed flags fail closed', () => {
  const db = openDatabase(':memory:')
  try {
    assert.equal(loadEvolutionChat({}, db), undefined)
    assert.equal(loadEvolutionChat({ FUNIX_EVOLUTION_READ_ENABLED: 'false' }, db), undefined)
    assert.equal(loadEvolutionChat({ FUNIX_EVOLUTION_READ_ENABLED: 'TRUE' }, db), undefined)
    assert.throws(() => loadEvolutionChat({ FUNIX_EVOLUTION_READ_ENABLED: 'true' }, db), /configuration|credentials/)
  } finally { db.close() }
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
    ]) assert.throws(() => loadEvolutionChat(env, db), /credentials\/instance ID are unavailable/)
    const bridge = loadEvolutionChat({
      ...enabled, FUNIX_EVOLUTION_READ_API_KEY: 'synthetic-secret', FUNIX_EVOLUTION_INSTANCE_ID: 'synthetic_instance_id',
    }, db)
    assert.ok(bridge)
    assert.equal(typeof bridge.list, 'function')
    assert.equal(typeof bridge.messages, 'function')
    // Never invoke: production URL is fixed, and this test performs zero network calls.
  } finally { db.close() }
})
