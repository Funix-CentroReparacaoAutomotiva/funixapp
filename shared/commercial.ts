export type CatalogKind = 'peca' | 'servico' | 'diagnostico' | 'dimensao'
export interface CatalogItem {
  id: string; kind: CatalogKind; code: string | null; name: string
  status: 'proposta' | 'validado'; source: 'hierarquia-v2' | 'operador'
  suggestion: boolean; side: string; serviceId: string | null; active: boolean
  revision: number; createdAt: string; updatedAt: string
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
  id: string; serviceId: string; dimensionId: string | null; quantity: string; enabled: boolean
}
export interface DiagnosisItem {
  id: string; atendimentoId: string; pieceId: string; diagnosisId: string | null
  notes: string; enabled: boolean; revision: number; createdAt: string; updatedAt: string
  services: DiagnosisService[]
}
