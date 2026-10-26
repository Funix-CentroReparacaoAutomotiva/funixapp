import type { ComponentItem,Calculation,PricingSettings } from './pricing.ts'
export type CatalogKind = 'peca' | 'servico' | 'diagnostico' | 'dimensao'
export interface CatalogItem {
  id: string; kind: CatalogKind; code: string | null; name: string
  status: 'proposta' | 'validado'; source: 'hierarquia-v2' | 'operador'
  suggestion: boolean; side: string; serviceId: string | null; active: boolean
  revision: number; createdAt: string; updatedAt: string
}
// Legacy status/source metadata does not gate the single commercial catalog.
export function catalogItemUsable(item: CatalogItem): boolean {
  return item.active && Boolean(item.name.trim()) && (item.kind !== 'peca' || Boolean(item.code?.trim()))
}
export interface HierarchyNode {
  id: string; tipo: 'grupo' | 'grupo_lados' | 'peca' | 'acao_ambos'; nome: string
  codigo_peca?: string; lado?: string; situacao?: string
  gera_codigos_peca?: string[]; itens?: HierarchyNode[]
}
export interface CatalogResponse {
  items: CatalogItem[]
  hierarchy: { versao: string; regioes: Record<string, HierarchyNode>; acesso_geral: HierarchyNode }
}
export interface DiagnosisService {
  id: string; serviceId: string; dimensionId: string | null; quantity: string; enabled: boolean; notes?: string; diagnosisId?: string | null
}
export interface DiagnosisItem {
  id: string; atendimentoId: string; pieceId: string; diagnosisId: string | null
  notes: string; enabled: boolean; revision: number; createdAt: string; updatedAt: string
  services: DiagnosisService[]
}

export interface Scenario {
  id: string; atendimentoId: string; name: string; position: number; revision: number
  pieceFlags: Record<string, boolean>; serviceFlags: Record<string, boolean>
  componentFlags: Record<string, boolean>
}
export function scenarioLabel(scenario: Pick<Scenario, 'position'>): string {
  return `Cenário ${scenario.position}`
}
export interface CommercialWorkspace {
  scenarios: Scenario[]; selectedId: string; items: DiagnosisItem[]; revision: number
  components: ComponentItem[]; settings: PricingSettings; configurationRevision: number; calculations: Calculation[]
}
