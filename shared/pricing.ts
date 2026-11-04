import type{StagePresentation}from'./stage-clusters.ts'
import type { CatalogItem,DiagnosisItem } from './commercial.ts'
import type { Atendimento } from './contracts.ts'
export interface FactorOption { id: string; name: string; factor: string | null }
export interface TechnicalStage { presentation?:StagePresentation; id: string; name: string; dimension: string; baseEnergy: string | null; dimensionEnergy: string | null }
export interface ServicePricing {
 serviceId: string; base: string | null
 // Missing FC keeps legacy V7 behavior (on); null is an explicit unresolved decision.
 colorFactorEnabled?: boolean | null; discountable?: boolean; billable?: boolean | null
 dimensions: {dimensionId: string; fd: string | null; stages: TechnicalStage[]}[]
}
export interface PricingConfig {
 defaults?:FinancialDefaults
 commercialCuration?: {version:string;digest:string}
 tables: FactorOption[]; colors: FactorOption[]; risks: FactorOption[]; resaleMultipliers?: FactorOption[]
 capacity: string | null; services: ServicePricing[]
 specialPrices: {tableId: string; serviceId: string; dimensionId: string; unit: string}[]
 conditions: string
}
export interface FinancialDefaults {tableId:string|null;colorId:string|null;riskId:string|null;mrPercent:string|null}
export interface PricingSettings {tableId: string | null; colorId: string | null; riskId: string | null; mrId?: string | null;mrPercent?:string|null;defaultsInitialized?:boolean}
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
 discountable?: boolean
 billing?: 'billable'|'not_billed'; execution?: 'internal'|'external_confirmation'; executionConfirmed?:boolean
 factors: Record<string,string>; stages: TechnicalStage[]; energy: string | null
}
export interface Calculation {
 nonBillableOnly?:boolean
 scenarioId: string; scenarioName: string; lines: PricedLine[]; errors: string[]
 serviceNet?:string|null; adjustment?:string|null
 discountEligibleSubtotal?: string | null
 pieceTotals?: {pieceId: string; total: string | null; nonBillableOnly?:boolean}[]
 originalServiceSubtotal: string | null; serviceSubtotal: string | null; componentSubtotal: string | null
 discount: string; total: string | null; energy: string | null; days: string | null
 negotiation: Negotiation; residual: string; target: string | null
}
export type Negotiation = {mode:'none'} | {mode:'discount'|'adjust'; value:string; acknowledgeResidual:boolean}
// Optional input scope translates a requested whole-budget total into the existing service adjustment.
export type NegotiationInput = Negotiation | {mode:'adjust'; value:string; acknowledgeResidual:boolean; valueIncludesComponents:true}
export interface BudgetSnapshot {
 pdfPresentation?:{version:"technical-stage-v1";errors:string[]}
 installments?:import('./budget-terms.ts').InstallmentSnapshot;executionDeadline?:import('./budget-terms.ts').ExecutionDeadline;document?:{template:string;data:import('./budget-terms.ts').JsreportDocument}
 schema: 1; serviceConfirmations?:Record<string,string>; commercialCuration?:{version:string;digest:string}; issuedAt?: string; requestedTotal?: string; composition: {items:DiagnosisItem[];components:ComponentItem[];catalog:CatalogItem[]}; atendimento: Atendimento; scenarioId: string; scenarioName: string
 compositionRevision: number; scenarioRevision: number; configuration: PricingConfiguration
 settings: PricingSettings; calculation: Calculation; conditions: string
}
export interface BudgetPreview { snapshot: BudgetSnapshot; token: string; canEmit: boolean }
export interface BudgetVersion {id:string; atendimentoId:string; sequence:number; label:string; createdAt:string; documentNumber?:string; filename?:string; snapshot:BudgetSnapshot}
