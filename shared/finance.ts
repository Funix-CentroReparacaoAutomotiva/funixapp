export const paymentMethods = {
  pix: 'Pix', cash: 'Dinheiro', boleto: 'Boleto', debit: 'Cartão de débito',
  credit: 'Cartão de crédito', transfer: 'Transferência bancária', other: 'Outra',
} as const
export type PaymentMethod = keyof typeof paymentMethods

export type FinancialKind = 'receivable' | 'payable'

export interface FinancialSettlement {
  id: string
  amountCents: number
  date: string
  reversedAt: string | null
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
  balanceCents: number
  titledCents: number
  untitledCents: number
  openTitles: Pick<FinancialTitle, 'id' | 'dueDate' | 'balanceCents'>[]
  receipts: (FinancialSettlement & {titleId: string})[]
}
