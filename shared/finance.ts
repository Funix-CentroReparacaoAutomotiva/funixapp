export type FinancialKind = 'receivable' | 'payable'

export interface FinancialSettlement {
  id: string
  amountCents: number
  date: string
  reversedAt: string | null
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
