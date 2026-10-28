import type { CatalogItem,DiagnosisItem } from './commercial.ts'
import type { Atendimento } from './contracts.ts'
export interface FactorOption { id: string; name: string; factor: string | null }
export interface TechnicalStage { id: string; name: string; dimension: string; baseEnergy: string | null; dimensionEnergy: string | null }
export interface ServicePricing {
 serviceId: string; base: string | null
 dimensions: {dimensionId: string; fd: string | null; stages: TechnicalStage[]}[]
}
export interface PricingConfig {
 tables: FactorOption[]; colors: FactorOption[]; risks: FactorOption[]; resaleMultipliers?: FactorOption[]
 capacity: string | null; services: ServicePricing[]
 specialPrices: {tableId: string; serviceId: string; dimensionId: string; unit: string}[]
 conditions: string
}
export interface PricingSettings {tableId: string | null; colorId: string | null; riskId: string | null; mrId?: string | null}
export interface PricingConfiguration {revision: number; updatedAt: string; config: PricingConfig}
export interface ComponentItem {
 id: string; atendimentoId: string; pieceId: string; name: string; quantity: string
 manualPrice: string | null; notes: string; revision: number
}
export interface PricedLine {
 id: string; pieceId: string; kind: 'service' | 'component'; name: string; pieceName: string
 dimension: string; diagnosis: string; notes: string; quantity: string; included: boolean
 unit: string | null; finalUnit: string | null; total: string | null
 path: 'normal' | 'special' | 'manual' | null
 factors: Record<string,string>; stages: TechnicalStage[]; energy: string | null
}
export interface Calculation {
 scenarioId: string; scenarioName: string; lines: PricedLine[]; errors: string[]
 serviceNet?:string|null; adjustment?:string|null
 pieceTotals?: {pieceId: string; total: string | null}[]
 originalServiceSubtotal: string | null; serviceSubtotal: string | null; componentSubtotal: string | null
 discount: string; total: string | null; energy: string | null; days: string | null
 negotiation: Negotiation; residual: string; target: string | null
}
export type Negotiation = {mode:'none'} | {mode:'discount'|'adjust'; value:string; acknowledgeResidual:boolean}
// Optional input scope translates a requested whole-budget total into the existing service adjustment.
export type NegotiationInput = Negotiation | {mode:'adjust'; value:string; acknowledgeResidual:boolean; valueIncludesComponents:true}
export interface BudgetSnapshot {
 schema: 1; issuedAt?: string; requestedTotal?: string; composition: {items:DiagnosisItem[];components:ComponentItem[];catalog:CatalogItem[]}; atendimento: Atendimento; scenarioId: string; scenarioName: string
 compositionRevision: number; scenarioRevision: number; configuration: PricingConfiguration
 settings: PricingSettings; calculation: Calculation; conditions: string
}
export interface BudgetPreview { snapshot: BudgetSnapshot; token: string; canEmit: boolean }
export interface BudgetVersion {id:string; atendimentoId:string; sequence:number; label:string; createdAt:string; snapshot:BudgetSnapshot}
