import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {AtendimentoRepository} from '../atendimentos.ts'
import {openDatabase} from '../database.ts'
import {ServiceError} from '../errors.ts'
import {FinanceRepository} from '../finance.ts'

const code = (value: string) => (error: unknown) => error instanceof ServiceError && error.code === value
const now = '2026-11-24T15:02:00.000Z'

test('Financeiro preserva vínculo, centavos, baixas parciais e histórico após reabrir o SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'funix-finance-'))
  const path = join(dir, 'finance.sqlite')
  try {
    const db = openDatabase(path)
    let expected
    try {
      const atendimento = new AtendimentoRepository(db).create({phone: '+5511999991234', name: 'Cliente QA'})
      const experienceId = randomUUID()
      db.prepare(`
        INSERT INTO production_experiences (id, atendimento_id, customer_json, vehicle_json, payer_json,
          scheduled_entry, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(experienceId, atendimento.id, '{"text":"Cliente QA"}', '{"text":"Veículo QA","plate":"QAT1A23"}',
        '{"text":"Cliente QA"}', '2026-11-25T09:00', now, now)
      const finance = new FinanceRepository(db, () => Date.parse(now))
      const title = {
        id: randomUUID(), kind: 'receivable', counterparty: 'Cliente QA', description: 'Reparo de teste',
        amountCents: 19991, dueDate: '2026-12-01', experienceId,
      }
      for (const amountCents of [0, -1, 1.99, '19991', Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => finance.create({...title, amountCents}), code('FINANCE_INVALID_INPUT'))
      }
      assert.throws(() => finance.create({...title, dueDate: '2026-02-30'}), code('FINANCE_INVALID_INPUT'))
      assert.throws(() => finance.create({...title, experienceId: randomUUID()}), code('FINANCE_EXPERIENCE_NOT_FOUND'))
      const created = finance.create(title)
      assert.equal(created.balanceCents, 19991)
      assert.deepEqual(finance.create(title), created)
      assert.throws(() => finance.create({...title, amountCents: 100}), code('FINANCE_REQUEST_CONFLICT'))

      const partial = {id: randomUUID(), amountCents: 3999, date: '2026-11-24'}
      const partiallySettled = finance.settle(title.id, partial)
      assert.equal(partiallySettled.balanceCents, 15992)
      assert.deepEqual(finance.settle(title.id, partial), partiallySettled)
      assert.throws(() => finance.settle(title.id, {...partial, date: '2026-11-25'}), code('FINANCE_REQUEST_CONFLICT'))
      assert.throws(() => finance.settle(title.id, {...partial, id: randomUUID(), amountCents: 15993}), code('FINANCE_AMOUNT_OVER_BALANCE'))
      const full = {id: randomUUID(), amountCents: 15992, date: '2026-11-25'}
      assert.equal(finance.settle(title.id, full).balanceCents, 0)
      const reversed = finance.reverse(title.id, partial.id)
      assert.equal(reversed.balanceCents, 3999)
      assert.deepEqual(finance.settle(title.id, partial), reversed)
      assert.equal(reversed.settlements.find(item => item.id === partial.id)?.reversedAt, now)
      const corrected = finance.settle(title.id, {id: randomUUID(), amountCents: 3999, date: '2026-11-26'})
      assert.equal(corrected.balanceCents, 0)
      assert.deepEqual(new FinanceRepository(db).overview().experiences, [{
        id: experienceId, counterparty: 'Cliente QA', label: 'Cliente QA · Veículo QA · QAT1A23',
      }])
      expected = finance.overview()
    } finally {
      db.close()
    }
    const reopened = openDatabase(path)
    try {
      assert.deepEqual(new FinanceRepository(reopened).overview(), expected)
      assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), [])
    } finally { reopened.close() }
  } finally { rmSync(dir, {recursive: true, force: true}) }
})
