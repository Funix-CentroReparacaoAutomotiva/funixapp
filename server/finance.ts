import type {DatabaseSync} from 'node:sqlite'
import {validDeliveryDate} from '../shared/delivery-date.ts'
import type {FinancialOverview, FinancialTitle} from '../shared/finance.ts'
import {ProductionRepository} from './production.ts'
import {ServiceError} from './errors.ts'
import {inputObject, transaction} from './scenarios.ts'

function invalid(message: string): never {
  throw new ServiceError(400, 'FINANCE_INVALID_INPUT', message)
}

function idempotencyConflict(): never {
  throw new ServiceError(409, 'FINANCE_REQUEST_CONFLICT', 'Este lançamento já foi registrado com outros dados. Atualize a tela.')
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) {
    invalid('Identificador financeiro inválido.')
  }
  return value
}

function amount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    invalid('Informe um valor positivo em centavos.')
  }
  return value
}

function text(value: unknown, max: number, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed || trimmed.length > max || trimmed.includes('\u0000')) invalid(`Informe ${field} com até ${max} caracteres.`)
  return trimmed
}

export class FinanceRepository {
  private readonly db: DatabaseSync
  private readonly now: () => number

  constructor(db: DatabaseSync, now = Date.now) {
    this.db = db
    this.now = now
  }

  overview(): FinancialOverview {
    this.db.exec('BEGIN')
    try {
      const experiences = this.db.prepare(`
        SELECT id, json_extract(customer_json, '$.text') AS customer,
          json_extract(vehicle_json, '$.text') AS vehicle, json_extract(vehicle_json, '$.plate') AS plate
        FROM production_experiences ORDER BY scheduled_entry DESC, id
      `).all().map(row => ({
        id: String(row.id),
        counterparty: String(row.customer ?? ''),
        label: [row.customer, row.vehicle, row.plate].filter(Boolean).join(' · ') || String(row.id),
      }))
      return {titles: this.titles(), experiences}
    } finally {
      this.db.exec('ROLLBACK')
    }
  }

  experience(at: string) {
    const state = new ProductionRepository(this.db).overview(at)
    if (!state.experience) throw new ServiceError(404, 'FINANCE_EXPERIENCE_NOT_FOUND', 'Experiência não encontrada.')
    const experience = state.experience
    const total = state.budgets.filter(budget => budget.state === 'authorized' || budget.state === 'executed')
      .reduce((sum, budget) => {
        const [whole, fraction = ''] = budget.total.split('.')
        const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))
        return sum + cents + (Number(fraction[2] ?? 0) >= 5 ? 1n : 0n)
      }, 0n)
    const titles = this.titles(undefined, experience.id).filter(title => title.kind === 'receivable')
    const receipts = titles.flatMap(title => title.settlements.map(item => ({...item, titleId: title.id})))
    const paidCents = receipts.reduce((sum, item) => sum + (item.reversedAt ? 0 : item.amountCents), 0)
    const titledCents = titles.reduce((sum, title) => sum + title.balanceCents, 0)
    const totalCents = Number(total)
    if (![totalCents,paidCents,titledCents].every(Number.isSafeInteger)) invalid('O total excede o limite financeiro.')
    const balanceCents = Math.max(0, totalCents - paidCents)
    const openTitles = titles.filter(title => title.balanceCents > 0).map(({id,dueDate,balanceCents}) => ({id,dueDate,balanceCents}))
    return {totalCents, paidCents, balanceCents, titledCents, untitledCents: Math.max(0, balanceCents - titledCents), openTitles, receipts}
  }

  experienceEntry(at: string, input: unknown) {
    const data = inputObject(input, ['id','date','amountCents','action'])
    const id = identifier(data.id)
    const {date, action} = data
    if (!validDeliveryDate(date) || (action !== 'receive' && action !== 'title')) invalid('Confira a operação e a data.')
    return transaction(this.db, () => {
      const experience = new ProductionRepository(this.db).overview(at).experience
      if (!experience) throw new ServiceError(404, 'FINANCE_EXPERIENCE_NOT_FOUND', 'Experiência não encontrada.')
      const [existing] = this.titles(id)
      const summary = this.experience(at)
      const amountCents = amount(data.amountCents)
      if (existing) {
        if (existing.experienceId !== experience.id || existing.kind !== 'receivable' || existing.amountCents !== amountCents ||
            existing.dueDate !== date || Boolean(existing.directReceipt) !== (action === 'receive')) idempotencyConflict()
        return summary
      }
      if (amountCents > summary.untitledCents || (action === 'title' && amountCents !== summary.untitledCents))
        throw new ServiceError(409, 'FINANCE_EXPERIENCE_BALANCE', 'Confira o saldo sem título. Valores já lançados podem ser baixados pelo Financeiro.')
      this.db.prepare(`INSERT INTO financial_titles (id,kind,counterparty,description,amount_cents,due_date,experience_id)
        VALUES (?,'receivable',?,?,?,?,?)`).run(id,experience.payer.text.slice(0,150),action === 'receive' ? 'Recebimento da Experiência' : 'Saldo da Experiência',amountCents,date,experience.id)
      // A direct receipt uses the same identifier for its document and settlement.
      // This keeps it in the existing cash history without creating an open balance on reversal.
      if (action === 'receive') this.db.prepare('INSERT INTO financial_settlements (id,title_id,amount_cents,date) VALUES (?,?,?,?)')
        .run(id,id,amountCents,date)
      return this.experience(at)
    })
  }

  private titles(id?: string, experienceId?: string): FinancialTitle[] {
    const query = this.db.prepare(`
      SELECT t.*, s.id AS settlement_id, s.amount_cents AS settled_cents, s.date, s.reversed_at
      FROM financial_titles t LEFT JOIN financial_settlements s ON s.title_id = t.id
      ${id !== undefined ? 'WHERE t.id = ?' : experienceId !== undefined ? 'WHERE t.experience_id = ?' : ''}
      ORDER BY t.due_date, t.id, s.date DESC, s.rowid DESC
    `)
    const titles = new Map<string, FinancialTitle>()
    for (const row of (id === undefined && experienceId === undefined ? query.all() : query.all(id ?? experienceId!))) {
      const titleId = String(row.id)
      let title = titles.get(titleId)
      if (!title) {
        title = {
          id: titleId, kind: row.kind as FinancialTitle['kind'],
          counterparty: String(row.counterparty), description: String(row.description),
          amountCents: Number(row.amount_cents), dueDate: String(row.due_date),
          experienceId: row.experience_id as string | null, balanceCents: Number(row.amount_cents), settlements: [],
        }
        titles.set(titleId, title)
      }
      if (row.settlement_id !== null) {
        const settlement = {
          id: String(row.settlement_id), amountCents: Number(row.settled_cents),
          date: String(row.date), reversedAt: row.reversed_at as string | null,
        }
        title.settlements.push(settlement)
        if (settlement.id === titleId) { title.directReceipt = true; title.balanceCents = 0 }
        else if (settlement.reversedAt === null) title.balanceCents -= settlement.amountCents
      }
    }
    return [...titles.values()]
  }

  private title(id: string): FinancialTitle {
    const [title] = this.titles(id)
    if (!title) throw new ServiceError(404, 'FINANCE_TITLE_NOT_FOUND', 'Título não encontrado.')
    return title
  }

  create(input: unknown): FinancialTitle {
    const data = inputObject(input, ['id', 'kind', 'counterparty', 'description', 'amountCents', 'dueDate', 'experienceId'])
    const id = identifier(data.id)
    const {kind, dueDate} = data
    if (kind !== 'receivable' && kind !== 'payable') invalid('Selecione receber ou pagar.')
    if (!validDeliveryDate(dueDate)) invalid('Informe uma data de vencimento válida.')
    const counterparty = text(data.counterparty, 150, 'a contraparte')
    const description = text(data.description, 500, 'a descrição')
    const amountCents = amount(data.amountCents)
    const experienceId = data.experienceId == null ? null : identifier(data.experienceId)

    return transaction(this.db, () => {
      const [existing] = this.titles(id)
      if (existing) {
        if (existing.kind !== kind || existing.dueDate !== dueDate || existing.counterparty !== counterparty ||
            existing.description !== description || existing.amountCents !== amountCents || existing.experienceId !== experienceId) {
          idempotencyConflict()
        }
        return existing
      }
      if (experienceId && !this.db.prepare('SELECT 1 FROM production_experiences WHERE id = ?').get(experienceId)) {
        throw new ServiceError(404, 'FINANCE_EXPERIENCE_NOT_FOUND', 'Experiência não encontrada.')
      }
      this.db.prepare(`
        INSERT INTO financial_titles (id, kind, counterparty, description, amount_cents, due_date, experience_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, kind, counterparty, description, amountCents, dueDate, experienceId)
      return this.title(id)
    })
  }

  settle(titleId: string, input: unknown): FinancialTitle {
    const data = inputObject(input, ['id', 'amountCents', 'date'])
    const id = identifier(data.id)
    const amountCents = amount(data.amountCents)
    const {date} = data
    if (!validDeliveryDate(date)) invalid('Informe uma data de baixa válida.')

    return transaction(this.db, () => {
      const title = this.title(identifier(titleId))
      const existing = this.db.prepare('SELECT title_id, amount_cents, date FROM financial_settlements WHERE id = ?').get(id)
      if (existing) {
        if (existing.title_id !== titleId || existing.amount_cents !== amountCents || existing.date !== date) idempotencyConflict()
        return title
      }
      if (id === titleId) idempotencyConflict()
      if (amountCents > title.balanceCents) {
        throw new ServiceError(409, 'FINANCE_AMOUNT_OVER_BALANCE', 'O valor da baixa excede o saldo pendente. Confira o saldo atualizado.')
      }
      this.db.prepare('INSERT INTO financial_settlements (id, title_id, amount_cents, date) VALUES (?, ?, ?, ?)')
        .run(id, titleId, amountCents, date)
      return this.title(titleId)
    })
  }

  reverse(titleId: string, settlementId: string): FinancialTitle {
    identifier(settlementId)
    return transaction(this.db, () => {
      const title = this.title(identifier(titleId))
      const settlement = title.settlements.find(item => item.id === settlementId)
      if (!settlement) throw new ServiceError(404, 'FINANCE_SETTLEMENT_NOT_FOUND', 'Baixa não encontrada neste título.')
      if (settlement.reversedAt !== null) return title
      this.db.prepare('UPDATE financial_settlements SET reversed_at = ? WHERE id = ?')
        .run(new Date(this.now()).toISOString(), settlement.id)
      return this.title(titleId)
    })
  }
}
