import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { validDeliveryDate } from '../../shared/delivery-date.ts'
import { FinanceRepository } from '../finance.ts'
import { ServiceError } from '../errors.ts'
import { inputObject, transaction } from '../scenarios.ts'
import type { ErpRequest } from './contracts.ts'

export function migrateFinance(db: DatabaseSync) {
  db.exec(`
    ALTER TABLE financial_titles ADD COLUMN competence_date TEXT;
    ALTER TABLE financial_titles ADD COLUMN managerial_category TEXT;
    ALTER TABLE financial_titles ADD COLUMN expected_payment_method TEXT;
    CREATE INDEX IF NOT EXISTS financial_titles_experience ON financial_titles(experience_id, kind);
    CREATE TABLE financial_transactions (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('receivable','payable','transfer')),
      cash_date TEXT NOT NULL,
      request_json TEXT NOT NULL,
      transfer_cents INTEGER,
      source_account TEXT,
      target_account TEXT,
      CHECK(kind <> 'transfer' OR (transfer_cents > 0 AND source_account <> target_account))
    ) STRICT;
    CREATE TABLE financial_transaction_allocations (
      transaction_id TEXT NOT NULL REFERENCES financial_transactions(id) ON DELETE RESTRICT,
      settlement_id TEXT PRIMARY KEY NOT NULL REFERENCES financial_settlements(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX financial_transaction_members ON financial_transaction_allocations(transaction_id);
  `)
}

function invalid(message: string): never {
  throw new ServiceError(400, 'FINANCE_INVALID_INPUT', message)
}

function checkedCents(amount: bigint) {
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) invalid('O total excede o limite financeiro.')
  return Number(amount)
}

const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
const today = (now: number) => dateFormat.format(new Date(now))

export function experienceReceivables(db: DatabaseSync, experienceId: string, asOfDay = today(Date.now())) {
  const rows = db.prepare(`
    SELECT t.*, s.id AS settlement_id, s.amount_cents AS settled, s.reversed_at
    FROM financial_titles t LEFT JOIN financial_settlements s ON s.title_id = t.id
    WHERE t.experience_id = ? AND t.kind = 'receivable'
  `).all(experienceId)
  if (!rows.length) return null
  const titles = new Map<string, { due: string; amount: bigint; settled: bigint; directReversed: boolean }>()
  for (const row of rows) {
    const id = String(row.id), amount = BigInt(Number(row.amount_cents))
    let title = titles.get(id)
    if (!title) {
      title = {due: String(row.due_date), amount, settled: 0n, directReversed: false}
      titles.set(id, title)
    }
    if (row.settlement_id === id && row.reversed_at !== null) title.directReversed = true
    if (row.settlement_id !== null && row.reversed_at === null) title.settled += BigInt(Number(row.settled))
  }
  let issued = 0n, settled = 0n, overdue = 0n
  for (const title of titles.values()) {
    if (title.directReversed) continue
    issued += title.amount
    settled += title.settled
    if (title.due < asOfDay) overdue += title.amount - title.settled
  }
  return { issuedCents: checkedCents(issued), settledCents: checkedCents(settled), outstandingCents: checkedCents(issued - settled), overdueCents: checkedCents(overdue) }
}

function transactionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) invalid('Identificador da transação inválido.')
  return value
}

function amountCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) invalid('Informe um valor maior que zero em centavos.')
  return value
}

function accountName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) invalid('Informe o nome da conta com até 120 caracteres.')
  return value.trim()
}

function postTransaction(db: DatabaseSync, now: number, input: unknown) {
  const data = inputObject(input, ['id','kind','date','allocations','paymentMethod','installments','amountCents','sourceAccount','targetAccount'])
  const id = transactionId(data.id)
  const { kind, date } = data
  if (kind !== 'receivable' && kind !== 'payable' && kind !== 'transfer') invalid('Selecione o tipo da transação.')
  if (!validDeliveryDate(date) || date > today(now)) invalid('Informe uma data de caixa válida, até hoje.')
  const transfer = kind === 'transfer'
  const source = transfer ? accountName(data.sourceAccount) : null
  const target = transfer ? accountName(data.targetAccount) : null
  const value = transfer ? amountCents(data.amountCents) : null
  if (source && target && source.localeCompare(target, 'pt-BR', {sensitivity: 'base'}) === 0) invalid('Escolha contas distintas.')
  if (transfer && (data.allocations != null || data.paymentMethod != null || data.installments != null)) invalid('Uma transferência interna não baixa títulos.')
  if (!transfer && typeof data.paymentMethod !== 'string') invalid('Selecione a forma de pagamento da transação.')
  if (!transfer && (data.sourceAccount != null || data.targetAccount != null || data.amountCents != null)) invalid('Informe o valor em cada título.')
  if (!transfer && (!Array.isArray(data.allocations) || !data.allocations.length || data.allocations.length > 100)) invalid('Selecione de 1 a 100 títulos.')
  const allocations = (Array.isArray(data.allocations) ? data.allocations : []).map(raw => {
    const line = inputObject(raw, ['titleId','amountCents'])
    return {titleId: transactionId(line.titleId), amountCents: amountCents(line.amountCents)}
  }).sort((a, b) => a.titleId.localeCompare(b.titleId))
  if (new Set(allocations.map(line => line.titleId)).size !== allocations.length) invalid('Informe um único valor por título.')
  checkedCents(allocations.reduce((sum, row) => sum + BigInt(row.amountCents), 0n))
  const request = JSON.stringify({kind,date,source,target,value,allocations,paymentMethod:data.paymentMethod,installments:data.installments})
  const finance = new FinanceRepository(db, () => now)
  return transaction(db, () => {
    const existing = db.prepare('SELECT request_json FROM financial_transactions WHERE id = ?').get(id)
    if (existing) {
      if (existing.request_json !== request) throw new ServiceError(409, 'FINANCE_REQUEST_CONFLICT', 'Esta transação já foi registrada com outros dados.')
      return {id}
    }
    db.prepare(`
      INSERT INTO financial_transactions(id,kind,cash_date,request_json,transfer_cents,source_account,target_account)
      VALUES (?,?,?,?,?,?,?)
    `).run(id,kind,date,request,value,source,target)
    const link = db.prepare('INSERT INTO financial_transaction_allocations (transaction_id, settlement_id) VALUES (?,?)')
    for (const row of allocations) {
      if (finance.title(row.titleId).kind !== kind) invalid('Os títulos da transação devem ter a mesma direção.')
      const settlementId = randomUUID()
      finance.settle(row.titleId, {
        id:settlementId, amountCents:row.amountCents, date, paymentMethod:data.paymentMethod, installments:data.installments,
      }, true)
      link.run(id, settlementId)
    }
    return {id}
  })
}

type CashItem = { id: string; date: string; label: string; kind: 'receivable' | 'payable' | 'transfer' | 'reversal'; cents: string; effectCents: string }

function cashFlow(db: DatabaseSync, now: number, period: string) {
  db.exec('BEGIN')
  try {
    return projectCashFlow(db, now, period)
  } finally {
    db.exec('ROLLBACK')
  }
}

function projectCashFlow(db: DatabaseSync, now: number, period: string) {
  const start = `${period}-01`
  if (!validDeliveryDate(start)) invalid('Informe um mês válido.')
  const currentDay = today(now)
  const payments = db.prepare(`
    SELECT s.*, t.kind, t.description, a.transaction_id
    FROM financial_settlements s JOIN financial_titles t ON t.id = s.title_id
    LEFT JOIN financial_transaction_allocations a ON a.settlement_id = s.id
    ORDER BY s.date, s.id
  `).all()
  const recorded = new Map<string, CashItem>()
  function add(item: CashItem) {
    const existing = recorded.get(item.id)
    if (!existing) { recorded.set(item.id, item); return }
    existing.cents = String(BigInt(existing.cents) + BigInt(item.cents))
    existing.effectCents = String(BigInt(existing.effectCents) + BigInt(item.effectCents))
  }
  for (const row of payments) {
    const paid = BigInt(Number(row.amount_cents) - Number(row.discount_cents) - Number(row.withheld_iss_cents))
    if (!paid) continue
    const kind = row.kind as 'receivable' | 'payable'
    const effect = kind === 'payable' ? -paid : paid
    const group = row.transaction_id
    const date = String(row.date)
    const reversedDay = row.reversed_at ? today(Date.parse(String(row.reversed_at))) : null
    if (reversedDay && reversedDay < date) continue
    add({ id: group ? `transaction-${group}` : `settlement-${row.id}`, date, label: group ? 'Baixa de títulos' : String(row.description), kind, cents: String(paid), effectCents: String(effect) })
    if (reversedDay)
      add({ id: `reversal-${row.id}`, date: reversedDay, label: String(row.description), kind: 'reversal', cents: String(paid), effectCents: String(-effect) })
  }
  for (const row of db.prepare("SELECT * FROM financial_transactions WHERE kind = 'transfer' AND cash_date <= ?").all(currentDay)) {
    add({ id: `transaction-${row.id}`, date: String(row.cash_date), label: `${row.source_account} → ${row.target_account}`, kind: 'transfer', cents: String(row.transfer_cents), effectCents: '0' })
  }
  const chronological = [...recorded.values()].sort((left, right) =>
    left.date.localeCompare(right.date)
    || Number(left.kind === 'reversal') - Number(right.kind === 'reversal')
    || left.id.localeCompare(right.id))
  const actual = chronological.filter(row => row.date <= currentDay)
  const scheduled = chronological.filter(row => row.date > currentDay && row.date.startsWith(period))
  const scheduledBeforePeriod = chronological.filter(row => row.date > currentDay && row.date < start)
    .reduce((total, row) => total + BigInt(row.effectCents), 0n)
  const opening = actual.filter(row => row.date < start).reduce((total, row) => total + BigInt(row.effectCents), 0n)
  const movements = actual.filter(row => row.date.startsWith(period))
  const realized = movements.reduce((total, row) => total + BigInt(row.effectCents), opening)
  const openTitles = new FinanceRepository(db).openTitles().map(title => ({
    id: title.id, date: title.dueDate < currentDay ? currentDay : title.dueDate, dueDate: title.dueDate,
    label: title.description, kind: title.kind, cents: title.balanceCents, counterparty: title.counterparty,
  }))
  const forecast = openTitles.filter(row => row.date.startsWith(period))
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
  const scheduledTotal = scheduled.reduce((total, row) => total + BigInt(row.effectCents), realized + scheduledBeforePeriod)
  const projected = openTitles.filter(row => row.date < start || row.date.startsWith(period))
    .reduce((total, row) => total + BigInt(row.cents) * (row.kind === 'payable' ? -1n : 1n), scheduledTotal)
  return { opening: String(opening), realized: String(realized), projected: String(projected), movements, forecast, scheduled, today: currentDay, period }
}

export function handleFinance({ db, method, path, query, body, now }: ErpRequest) {
  const timestamp = now()
  if (path === '/titles' && method === 'POST') {
    const data = inputObject(body, ['id','kind','counterparty','description','amountCents','dueDate','experienceId','competenceDate','category','expectedPaymentMethod'])
    if (!validDeliveryDate(data.competenceDate) || typeof data.expectedPaymentMethod !== 'string')
      invalid('Informe competência e forma de quitação.')
    if (data.kind === 'payable' && (typeof data.category !== 'string' || !data.category.trim()))
      invalid('Informe a classificação gerencial.')
    return new FinanceRepository(db, now).create(data)
  }
  if (path === '/transactions' && method === 'POST') return postTransaction(db, timestamp, body)
  if (path === '/cash' && method === 'GET') return cashFlow(db, timestamp, query.get('month') ?? today(timestamp).slice(0, 7))
  throw new ServiceError(404, 'FINANCE_ROUTE_NOT_FOUND', 'Operação financeira não encontrada.')
}
