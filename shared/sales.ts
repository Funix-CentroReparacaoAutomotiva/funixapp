import type { Atendimento, AtendimentoStage } from './contracts.ts'
import type { WorkshopVehicle } from './erp.ts'
import type { ProductionBudget } from './production.ts'

export const salesChannels = ['WhatsApp', 'Balcão', 'Seguradora', 'Recorrência'] as const

export type SalesStage = { id: AtendimentoStage; label: string; minutes: number | null }
export type SalesContext = {
  owner: string
  channel: string
  origin: string
  nextContactAt: string | null
  nextAction: string
  additionalService: string
  revision: number
}
export type SalesActivity = {
  id: string
  kind: 'comment' | 'stage' | 'message'
  occurredAt: string
  author: string | null
  content: string
}
export type FunnelCard = {
  record: Atendimento
  context: SalesContext
  lane: string
  lastActivityAt: string
  nextContactAt: string | null
  overdue: boolean
}
export type SalesReceivables = { issuedCents: number; settledCents: number; outstandingCents: number; overdueCents: number }
export type TrackingCard = {
  vehicle: WorkshopVehicle & { revision: number; requiresClassification: boolean }
  commercialPhase: string
  tone: string
  context: SalesContext
  budgets: ProductionBudget[]
  approvedValue: string | null
  lastContactAt: string | null
  receivables: SalesReceivables | null
}
export type SalesMetric = { label: string; value: string; definition: string; records: string[]; href?: string }
