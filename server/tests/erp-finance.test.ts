import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {AtendimentoRepository} from '../atendimentos.ts'
import {openDatabase} from '../database.ts'
import {experienceReceivables, handleFinance} from '../erp/finance.ts'
import {FinanceRepository} from '../finance.ts'
import type {ErpRequest} from '../erp/contracts.ts'

const now = () => Date.parse('2026-11-26T15:00:00Z')
const moment = new Date(now()).toISOString()
const makeCall = (db: ErpRequest['db']) => (path: string, body?: unknown, query = '') => handleFinance({
  db, method: body ? 'POST' : 'GET', path, body, query: new URLSearchParams(query), now,
})
const title = (extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), kind: 'receivable', counterparty: 'Pagador sintético', description: 'Serviço sintético',
  competenceDate: '2026-10-03', dueDate: '2026-11-25', expectedPaymentMethod: 'pix', amountCents: 1555, ...extra,
})

test('baixa em grupo preserva saldos, data, idempotência e estorno individual', () => {
  const db = openDatabase(':memory:')
  try {
    const call = makeCall(db)
    const finance = new FinanceRepository(db, now)
    const at = new AtendimentoRepository(db).create({name: 'Cliente sintético'})
    const experienceId = randomUUID()
    db.prepare(`
      INSERT INTO production_experiences (id,atendimento_id,customer_json,vehicle_json,payer_json,scheduled_entry,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(experienceId, at.id, '{"text":"Cliente sintético"}','{"text":"Veículo sintético","plate":"QAT1A23"}','{"text":"Pagador sintético"}',moment,moment,moment)
    assert.equal(experienceReceivables(db, experienceId), null)
    const first = title({experienceId})
    const second = title({experienceId, amountCents: 500, dueDate: '2026-11-30'})
    const payable = title({kind: 'payable', category: 'Manutenção', amountCents: 200})
    assert.throws(() => call('/titles', {...payable, category: null}), /classificação/)
    call('/titles', first)
    call('/titles', second)
    call('/titles', payable)
    assert.equal(finance.title(first.id).competenceDate, '2026-10-03')
    assert.equal(finance.title(payable.id).category, 'Manutenção')
    const data = {id: randomUUID(), kind: 'receivable', date: '2026-11-24', paymentMethod: 'pix',
      allocations: [{titleId: first.id, amountCents: 1000},{titleId: second.id, amountCents: 501}]}
    assert.throws(() => call('/transactions', data), /excede o saldo/)
    assert.equal(finance.title(first.id).balanceCents, 1555)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM financial_transactions').get()?.n, 0)
    const valid = {...data, allocations: [data.allocations[0], {titleId: second.id, amountCents: 300}]}
    call('/transactions', valid)
    call('/transactions', {...valid, allocations: [...valid.allocations].reverse()})
    assert.equal(finance.title(first.id).balanceCents, 555)
    assert.equal(finance.title(second.id).balanceCents, 200)
    assert.equal(finance.title(first.id).settlements[0].transactionId, valid.id)
    assert.equal(finance.title(second.id).settlements[0].transactionId, valid.id)
    assert.throws(() => call('/transactions', {...valid, date: '2026-11-22'}), /outros dados/)
    assert.deepEqual(experienceReceivables(db, experienceId, '2026-11-26'), {
      issuedCents: 2055, settledCents: 1300, outstandingCents: 755, overdueCents: 555,
    })
    const cash = call('/cash', undefined, 'month=2026-11') as {movements: {id:string;effectCents:string}[]; realized:string; projected:string}
    assert.equal(cash.movements.length, 1)
    assert.equal(cash.movements[0].effectCents, '1300')
    assert.equal(cash.realized, '1300')
    assert.equal(cash.projected, '1855')
    finance.reverse(first.id, finance.title(first.id).settlements[0].id)
    const reversed = call('/cash', undefined, 'month=2026-11') as typeof cash
    assert.equal(reversed.realized, '300')
    assert.equal(reversed.movements.length, 2)
    assert.equal(reversed.projected, '1855')
    assert.equal(finance.title(second.id).balanceCents, 200)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    db.close()
  }
})

test('caixa separa vencidos, competência, lançamentos futuros e transferências internas', () => {
  const db = openDatabase(':memory:')
  try {
    const call = makeCall(db)
    const finance = new FinanceRepository(db, now)
    const future = title({amountCents: 4000, dueDate: '2026-11-30'})
    const expense = title({kind: 'payable', category: 'Fornecedores', amountCents: 555, dueDate: '2026-11-23'})
    call('/titles', future)
    call('/titles', expense)
    finance.settle(future.id, {id: randomUUID(), amountCents: 4000, date: '2026-11-27'})
    const transfer = {id: randomUUID(), kind: 'transfer', date: '2026-11-22', amountCents: 6500, sourceAccount: 'Caixa', targetAccount: 'Banco'}
    call('/transactions', transfer)
    call('/transactions', transfer)
    assert.throws(() => call('/transactions', {...transfer, id: randomUUID(), targetAccount: 'caixa'}), /distintas/)
    const cash = call('/cash', undefined, 'month=2026-11') as {
      opening:string; realized:string; projected:string; movements: {cents:string;effectCents:string;kind:string}[]
      scheduled: {kind:string;cents:string}[]; forecast: {date:string;dueDate:string}[]
    }
    assert.equal(cash.opening, '0')
    assert.equal(cash.realized, '0')
    assert.equal(cash.projected, '3445')
    assert.equal(cash.movements.length, 1)
    assert.deepEqual(cash.movements.map(({cents,effectCents,kind}) => ({cents,effectCents,kind})), [{cents:'6500',effectCents:'0',kind:'transfer'}])
    assert.equal(cash.scheduled[0].cents, '4000')
    const nextMonth = call('/cash', undefined, 'month=2026-12') as typeof cash
    assert.equal(nextMonth.realized, '0')
    assert.equal(nextMonth.projected, '3445')
    assert.deepEqual(cash.forecast.map(({date,dueDate}) => ({date,dueDate})), [{date:'2026-11-26',dueDate:'2026-11-23'}])
  } finally {
    db.close()
  }
})
