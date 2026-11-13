import test from 'node:test'
import assert from 'node:assert/strict'
import { formatPhoneDraft, phoneCursorPosition } from '../../src/phone-mask.ts'

test('Issue #160 máscara DDD fixo e celular, inclusive parcial e colagem', () => {
  assert.equal(formatPhoneDraft(''), '')
  assert.equal(formatPhoneDraft('31'), '(31')
  assert.equal(formatPhoneDraft('3112'), '(31) 12')
  assert.equal(formatPhoneDraft('3112345678'), '(31) 1234-5678')
  assert.equal(formatPhoneDraft('31912345678'), '(31) 91234-5678')
  assert.equal(formatPhoneDraft('(31) 91234-5678'), '(31) 91234-5678')
  assert.equal(formatPhoneDraft('(31) 1234-5678'), '(31) 1234-5678')
})

test('Issue #160 não modifica DDI, informações legadas ou números incompletos ao normalizar identidade', () => {
  assert.equal(formatPhoneDraft('+55 (31) 91234-5678'), '+55 (31) 91234-5678')
  assert.equal(formatPhoneDraft('5531912345678'), '5531912345678')
  assert.equal(formatPhoneDraft('ramal 123'), 'ramal 123')
  assert.equal(formatPhoneDraft('319'), '(31) 9')
})

test('Issue #160 posição lógica mantém número editado no meio', () => {
  assert.equal(phoneCursorPosition('(31) 91234-5678', 2), 3)
  assert.equal(phoneCursorPosition('(31) 91234-5678', 5), 8)
})
