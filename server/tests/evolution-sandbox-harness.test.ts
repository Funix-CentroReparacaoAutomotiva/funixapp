import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('Evolution sandbox: offline lifecycle gates fail closed without invoking Docker/HTTP', () => {
  const cwd = fileURLToPath(new URL('../../', import.meta.url))
  execFileSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests/evolution-sandbox', '-v'], { cwd, timeout: 10000 })
  execFileSync(process.execPath, ['--check', 'tests/evolution-sandbox/contract.mjs'], { cwd, timeout: 10000 })
})
