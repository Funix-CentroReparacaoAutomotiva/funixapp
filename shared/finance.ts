export const paymentMethods = {
  pix: 'Pix', cash: 'Dinheiro', boleto: 'Boleto', debit: 'Cartão de débito',
  credit: 'Cartão de crédito', transfer: 'Transferência bancária', other: 'Outra',
} as const
export type PaymentMethod = keyof typeof paymentMethods

export type FinancialKind = 'receivable' | 'payable'

export const discountReasons = {commercial: 'Negociação comercial', service_issue: 'Falha no serviço', other: 'Outro motivo'} as const
export type DiscountReason = keyof typeof discountReasons

// V1: each component is recorded in cents. Settlement is the sum of all three.
// Receipt records a payment, not recognition of revenue or bank reconciliation.
export const settlementRulesV1 = {
  payment: {paymentRecorded: 1, resultReduction: 0, settlement: 1},
  discount: {paymentRecorded: 0, resultReduction: 1, settlement: 1},
  withheldIss: {paymentRecorded: 0, resultReduction: 1, settlement: 1},
} as const

export function paymentCents(settlement: FinancialSettlement) {
  const discount = settlement.discountCents ?? 0
  const iss = settlement.withheldIssCents ?? 0
  return (settlement.amountCents - discount - iss) * settlementRulesV1.payment.paymentRecorded +
    discount * settlementRulesV1.discount.paymentRecorded + iss * settlementRulesV1.withheldIss.paymentRecorded
}

export interface FinancialSettlement {
  id: string
  amountCents: number
  date: string
  reversedAt: string | null
  invoiceNumber?: string
  discountCents?: number
  withheldIssCents?: number
  discountReason?: DiscountReason
  paymentMethod?: PaymentMethod
  installments?: number
}

export interface FinancialTitle {
  id: string
  kind: FinancialKind
  counterparty: string
  description: string
  amountCents: number
  dueDate: string
  experienceId: string | null
  balanceCents: number
  directReceipt?: boolean
  settlements: FinancialSettlement[]
}

export interface FinancialExperienceOption {
  id: string
  label: string
  counterparty: string
}

export interface FinancialOverview {
  titles: FinancialTitle[]
  experiences: FinancialExperienceOption[]
}

export interface ExperienceFinance {
  totalCents: number
  paidCents: number
  discountCents: number
  withheldIssCents: number
  balanceCents: number
  titledCents: number
  untitledCents: number
  openTitles: Pick<FinancialTitle, 'id' | 'dueDate' | 'balanceCents'>[]
  receipts: (FinancialSettlement & {titleId: string})[]
}
