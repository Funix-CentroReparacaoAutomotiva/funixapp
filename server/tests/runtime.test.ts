import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('production refuses missing credentials, oversized passwords and a non-HTTPS origin before listening', () => {
  const cases = [
    { password: '', origin: 'https://app.funix.com.br', message: /senha de operador/ },
    { password: 'x'.repeat(257), origin: 'https://app.funix.com.br', message: /senha de operador/ },
    { password: 'synthetic-test-only-password', origin: 'http://app.funix.com.br', message: /origem HTTPS/ },
  ]
  for (const item of cases) {
    const result = spawnSync(process.execPath, ['server/index.ts'], {
      cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 5000,
      env: { NODE_ENV: 'production', FUNIX_OPERATOR_PASSWORD: item.password, FUNIX_APP_ORIGIN: item.origin },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, item.message)
    if (item.password) assert.equal(result.stderr.includes(item.password), false)
    assert.equal(result.stdout, '')
  }
})

test('production requires an explicit file path and refuses an in-memory commercial database', () => {
  for (const path of ['', ':memory:']) {
    const result = spawnSync(process.execPath, ['server/index.ts'], {
      cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 5000,
      env: { NODE_ENV: 'production', FUNIX_OPERATOR_PASSWORD: 'synthetic-test-only-password', FUNIX_APP_ORIGIN: 'https://app.funix.com.br', FUNIX_DATABASE_PATH: path },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /armazenamento persistente autorizado/)
    assert.equal(result.stdout, '')
  }
})
