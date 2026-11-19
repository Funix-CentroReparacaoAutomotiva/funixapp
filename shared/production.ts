import type {CustomerReference, CustomerReferences} from './customer.ts'

export type BudgetLifecycleState = 'negotiating' | 'consented' | 'authorized' | 'rejected' | 'executed' | 'cancelled'

export const budgetLifecycleLabels: Record<BudgetLifecycleState, string> = {
  negotiating: 'Negociando', consented: 'Consentido', authorized: 'Autorizado',
  rejected: 'Rejeitado', executed: 'Executado', cancelled: 'Cancelado',
}

export type BudgetTransition = {
  from: BudgetLifecycleState | null
  to: BudgetLifecycleState
  origin: 'commercial' | 'technical'
  occurredAt: string
  reason: string | null
  actorSource: 'authenticated-session-confirmation'
  operatorId: null
}

export type ExperienceParties = {customer: CustomerReference; vehicle: CustomerReference; payer: CustomerReference}
export type Experience = ExperienceParties & {
  id: string
  revision: number
  scheduledEntry: string
  deliveryDate: string | null
}

export type ProductionBudget = {
  id: string
  label: string
  documentNumber?: string
  total: string
  state: BudgetLifecycleState | null
  legacyOrder: boolean
  workOrderNumber?: string
  history: BudgetTransition[]
}

export type ProductionOverview = {
  experience: Experience | null
  atendimentoRevision: number
  deliveryDate: string | null
  references: Pick<CustomerReferences, 'person' | 'vehicle' | 'payer'>
  budgets: ProductionBudget[]
}
