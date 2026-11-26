import type {DatabaseSync} from 'node:sqlite'
import {validDeliveryDate} from '../shared/delivery-date.ts'
import {paymentMethods, paymentCents, discountReasons, type DiscountReason, type PaymentMethod, type FinancialOverview, type FinancialSettlement, type FinancialTitle} from '../shared/finance.ts'
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

function paymentDetails(data: Record<string, unknown>) {
  const {paymentMethod, installments} = data
  if (paymentMethod === undefined && installments === undefined) return {method:null, installments:null}
  if (typeof paymentMethod !== 'string' || !Object.hasOwn(paymentMethods, paymentMethod))
    invalid('Selecione uma forma de pagamento válida.')
  if (paymentMethod === 'credit') {
    if (typeof installments !== 'number' || !Number.isInteger(installments) || installments < 1 || installments > 12)
      invalid('Informe de 1 a 12 parcelas no cartão de crédito.')
    return {method:paymentMethod as PaymentMethod, installments}
  }
  if (installments !== undefined) invalid('Informe parcelas apenas para cartão de crédito.')
  return {method:paymentMethod as PaymentMethod, installments:null}
}

const adjustmentFields = ['discountCents','withheldIssCents','discountReason','invoiceNumber']

function settlementBreakdown(data: Record<string, unknown>) {
  const optionalCents = (value: unknown) => value === undefined || value === 0 ? 0 : amount(value)
  const cash = optionalCents(data.amountCents)
  const discount = optionalCents(data.discountCents)
  const issuedTax = optionalCents(data.withheldIssCents)
  const reason = data.discountReason ?? null
  if (discount ? typeof reason !== 'string' || !Object.hasOwn(discountReasons, reason) : reason !== null)
    invalid('Selecione o motivo do desconto informado.')
  const invoiceNumber = data.invoiceNumber == null ? null : text(data.invoiceNumber,60,'o número da nota fiscal')
  const total = amount(cash + discount + issuedTax)
  const payment = paymentDetails(data)
  if (!cash && payment.method) invalid('Informe forma de pagamento apenas quando houver valor recebido.')
  return {total, discount, issuedTax, reason, payment, invoiceNumber}
}

function sameBreakdown(existing: FinancialSettlement, breakdown: ReturnType<typeof settlementBreakdown>) {
  return (existing.invoiceNumber ?? null) === breakdown.invoiceNumber && existing.amountCents === breakdown.total && (existing.discountCents ?? 0) === breakdown.discount &&
    (existing.withheldIssCents ?? 0) === breakdown.issuedTax && (existing.discountReason ?? null) === breakdown.reason &&
    (existing.paymentMethod ?? null) === breakdown.payment.method && (existing.installments ?? null) === breakdown.payment.installments
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
          json_extract(vehicle_json, '$.text') AS vehicle, json_extract(vehicle_json, '$.plate') AS plate,
          json_extract(payer_json, '$.text') AS payer
        FROM production_experiences ORDER BY scheduled_entry DESC, id
      `).all().map(row => ({
        id: String(row.id),
        counterparty: String(row.payer ?? row.customer ?? ''),
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
    const active = receipts.filter(item => !item.reversedAt)
    const paidCents = active.reduce((sum, item) => sum + paymentCents(item), 0)
    const discountCents = active.reduce((sum, item) => sum + (item.discountCents ?? 0), 0)
    const withheldIssCents = active.reduce((sum, item) => sum + (item.withheldIssCents ?? 0), 0)
    const settledCents = paidCents + discountCents + withheldIssCents
    const titledCents = titles.reduce((sum, title) => sum + title.balanceCents, 0)
    const totalCents = Number(total)
    if (![totalCents,settledCents,titledCents].every(Number.isSafeInteger)) invalid('O total excede o limite financeiro.')
    const balanceCents = Math.max(0, totalCents - settledCents)
    const openTitles = titles.filter(title => title.balanceCents > 0).map(({id,dueDate,balanceCents}) => ({id,dueDate,balanceCents}))
    return {totalCents, paidCents, discountCents, withheldIssCents, balanceCents, titledCents, untitledCents: Math.max(0, balanceCents - titledCents), openTitles, receipts}
  }

  experienceEntry(at: string, input: unknown) {
    const data = inputObject(input, ['id','date','amountCents','action','paymentMethod','installments',...adjustmentFields])
    const id = identifier(data.id)
    const {date, action} = data
    const breakdown = settlementBreakdown(data)
    if (action === 'title' && (breakdown.payment.method || breakdown.discount || breakdown.issuedTax || breakdown.invoiceNumber))
      invalid('Informe pagamentos e ajustes ao registrar o recebimento.')
    if (!validDeliveryDate(date) || (action !== 'receive' && action !== 'title')) invalid('Confira a operação e a data.')
    return transaction(this.db, () => {
      const experience = new ProductionRepository(this.db).overview(at).experience
      if (!experience) throw new ServiceError(404, 'FINANCE_EXPERIENCE_NOT_FOUND', 'Experiência não encontrada.')
      const [existing] = this.titles(id)
      const summary = this.experience(at)
      const amountCents = breakdown.total
      if (existing) {
        if (existing.experienceId !== experience.id || existing.kind !== 'receivable' || existing.amountCents !== amountCents ||
            existing.dueDate !== date || Boolean(existing.directReceipt) !== (action === 'receive') || (action === 'receive' &&
              !sameBreakdown(existing.settlements[0]!,breakdown))) idempotencyConflict()
        return summary
      }
      if (amountCents > summary.untitledCents || (action === 'title' && amountCents !== summary.untitledCents))
        throw new ServiceError(409, 'FINANCE_EXPERIENCE_BALANCE', 'Confira o saldo sem título. Valores já lançados podem ser baixados pelo Financeiro.')
      this.db.prepare(`INSERT INTO financial_titles (id,kind,counterparty,description,amount_cents,due_date,experience_id)
        VALUES (?,'receivable',?,?,?,?,?)`).run(id,experience.payer.text.slice(0,150),action === 'receive' ? 'Recebimento da Experiência' : 'Saldo da Experiência',amountCents,date,experience.id)
      // A direct receipt uses the same identifier for its document and settlement.
      // This keeps it in the existing cash history without creating an open balance on reversal.
      if (action === 'receive') this.recordSettlement(id,id,date,breakdown)
      return this.experience(at)
    })
  }

  private titles(id?: string, experienceId?: string): FinancialTitle[] {
    const query = this.db.prepare(`
      SELECT t.*, s.id AS settlement_id, s.amount_cents AS settled_cents, s.date, s.reversed_at, s.payment_method, s.installments, s.discount_cents, s.withheld_iss_cents, s.discount_reason, s.invoice_number, a.transaction_id
      FROM financial_titles t LEFT JOIN financial_settlements s ON s.title_id = t.id
      LEFT JOIN financial_transaction_allocations a ON a.settlement_id = s.id
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
          experienceId: row.experience_id as string | null,
          ...(row.competence_date ? {competenceDate: String(row.competence_date)} : {}),
          ...(row.managerial_category ? {category: String(row.managerial_category)} : {}),
          ...(row.expected_payment_method ? {expectedPaymentMethod: row.expected_payment_method as PaymentMethod} : {}),
          balanceCents: Number(row.amount_cents), settlements: [],
        }
        titles.set(titleId, title)
      }
      if (row.settlement_id !== null) {
        const settlement = {
          id: String(row.settlement_id), amountCents: Number(row.settled_cents),
          date: String(row.date),
          ...(row.payment_method ? {paymentMethod: row.payment_method as PaymentMethod} : {}),
          ...(row.installments !== null ? {installments: Number(row.installments)} : {}),
          ...(row.invoice_number ? {invoiceNumber:String(row.invoice_number)} : {}),
          ...(row.discount_cents ? {discountCents:Number(row.discount_cents),discountReason:row.discount_reason as DiscountReason} : {}),
          ...(row.withheld_iss_cents ? {withheldIssCents:Number(row.withheld_iss_cents)} : {}),
          ...(row.transaction_id ? {transactionId: String(row.transaction_id)} : {}),
          reversedAt: row.reversed_at as string | null,
        }
        title.settlements.push(settlement)
        if (settlement.id === titleId) { title.directReceipt = true; title.balanceCents = 0 }
        else if (settlement.reversedAt === null) title.balanceCents -= settlement.amountCents
      }
    }
    return [...titles.values()]
  }

  openTitles(): FinancialTitle[] {
    return this.titles().filter(title => title.balanceCents > 0)
  }

  title(id: string): FinancialTitle {
    const [title] = this.titles(id)
    if (!title) throw new ServiceError(404, 'FINANCE_TITLE_NOT_FOUND', 'Título não encontrado.')
    return title
  }

  create(input: unknown, inTransaction = false): FinancialTitle {
    const data = inputObject(input, ['id', 'kind', 'counterparty', 'description', 'amountCents', 'dueDate', 'experienceId', 'competenceDate', 'category', 'expectedPaymentMethod'])
    const id = identifier(data.id)
    const {kind, dueDate} = data
    if (kind !== 'receivable' && kind !== 'payable') invalid('Selecione receber ou pagar.')
    if (!validDeliveryDate(dueDate)) invalid('Informe uma data de vencimento válida.')
    const counterparty = text(data.counterparty, 150, 'a contraparte')
    const description = text(data.description, 500, 'a descrição')
    const amountCents = amount(data.amountCents)
    const experienceId = data.experienceId == null ? null : identifier(data.experienceId)
    const {competenceDate, expectedPaymentMethod} = data
    if (competenceDate != null && !validDeliveryDate(competenceDate)) invalid('Informe uma data de competência válida.')
    if (expectedPaymentMethod != null && (typeof expectedPaymentMethod !== 'string' || !Object.hasOwn(paymentMethods, expectedPaymentMethod)))
      invalid('Selecione uma forma de quitação válida.')
    const category = data.category == null ? undefined : text(data.category, 100, 'a classificação gerencial')

    const write = () => {
      const [existing] = this.titles(id)
      if (existing) {
        if (existing.kind !== kind || existing.dueDate !== dueDate || existing.counterparty !== counterparty ||
            existing.description !== description || existing.amountCents !== amountCents || existing.experienceId !== experienceId ||
            existing.competenceDate !== (competenceDate ?? undefined) || existing.category !== category ||
            existing.expectedPaymentMethod !== (expectedPaymentMethod ?? undefined)) {
          idempotencyConflict()
        }
        return existing
      }
      if (experienceId && !this.db.prepare('SELECT 1 FROM production_experiences WHERE id = ?').get(experienceId)) {
        throw new ServiceError(404, 'FINANCE_EXPERIENCE_NOT_FOUND', 'Experiência não encontrada.')
      }
      this.db.prepare(`
        INSERT INTO financial_titles (id, kind, counterparty, description, amount_cents, due_date, experience_id,
          competence_date, managerial_category, expected_payment_method)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, kind, counterparty, description, amountCents, dueDate, experienceId,
        competenceDate as string | null ?? null, category ?? null, expectedPaymentMethod as string | null ?? null)
      return this.title(id)
    }
    return inTransaction ? write() : transaction(this.db, write)
  }

  private recordSettlement(id: string, titleId: string, date: string, breakdown: ReturnType<typeof settlementBreakdown>) {
    this.db.prepare(`INSERT INTO financial_settlements
      (id,title_id,date,amount_cents,payment_method,installments,discount_cents,withheld_iss_cents,discount_reason,invoice_number)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id,titleId,date,breakdown.total,breakdown.payment.method,
        breakdown.payment.installments,breakdown.discount,breakdown.issuedTax,breakdown.reason as string|null,breakdown.invoiceNumber)
  }

  settle(titleId: string, input: unknown, inTransaction = false): FinancialTitle {
    const data = inputObject(input, ['id','amountCents','date','paymentMethod','installments',...adjustmentFields])
    const id = identifier(data.id)
    const breakdown = settlementBreakdown(data)
    const {date} = data
    if (!validDeliveryDate(date)) invalid('Informe uma data de baixa válida.')
    const write = () => {
      const title = this.title(identifier(titleId))
      const existing = this.db.prepare('SELECT title_id FROM financial_settlements WHERE id = ?').get(id)
      if (existing) {
        const settlement = title.settlements.find(item=>item.id===id)
        if (existing.title_id !== titleId || !settlement || settlement.date !== date || !sameBreakdown(settlement,breakdown)) idempotencyConflict()
        return title
      }
      if (id === titleId) idempotencyConflict()
      if ((breakdown.discount || breakdown.issuedTax) && (title.kind !== 'receivable' || !title.experienceId))
        invalid('Desconto e ISS retido estão disponíveis para recebimentos da Experiência.')
      if (breakdown.total > title.balanceCents)
        throw new ServiceError(409, 'FINANCE_AMOUNT_OVER_BALANCE', 'O valor da baixa excede o saldo pendente. Confira o saldo atualizado.')
      this.recordSettlement(id,titleId,date,breakdown)
      return this.title(titleId)
    }
    return inTransaction ? write() : transaction(this.db, write)
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
