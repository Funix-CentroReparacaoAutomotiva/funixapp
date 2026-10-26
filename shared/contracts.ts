export interface WorkRecord {
  rowId: string
  id: string
  kind: 'atendimento' | 'experiencia'
  name: string
  contact: string
  vehicle: string
  plate: string
  stage: string
  stageId: string | null
  detail: string
  sourceUrl: string
  atendimentoRowId: string | null
  enteredAt: string | null
  exitedAt: string | null
  finished: boolean
  departed: boolean
}

export interface WorkspaceResponse {
  items: WorkRecord[]
  stages: { id: string; name: string }[]
  nextCursor: string | null
  source: { system: 'coda'; mode: 'live'; fetchedAt: string }
  capabilities: { write: false; messages: false }
}

export interface WorkspaceQuery {
  area: 'funil' | 'veiculos'
  scope: 'acompanhamento' | 'historico'
  q: string
  cursor: string | null
  limit: number
}

export interface ApiError {
  error: { code: string; message: string; requestId: string }
}

export const ATENDIMENTO_STAGES = [
  { id: 'novo-lead', name: 'Novo lead' },
  { id: 'aguardando-dados', name: 'Aguardando dados' },
  { id: 'em-negociacao', name: 'Em negociação (24h)' },
  { id: 'morno', name: 'Morno (3 dias)' },
  { id: 'frio', name: 'Frio (5 dias)' },
  { id: 'rejeitados', name: 'Rejeitados' },
] as const

export type AtendimentoStage = typeof ATENDIMENTO_STAGES[number]['id']

export interface Atendimento {
  id: string
  phone: string
  phoneNormalized: string | null
  name: string
  vehicle: string
  brand: string
  model: string
  plate: string
  reason: string
  notes: string
  stage: AtendimentoStage
  rejectionReason: string
  explicitRefusal: boolean
  createdAt: string
  updatedAt: string
  revision: number
}

export interface AtendimentoList {
  items: Atendimento[]
  total: number
  nextOffset: number | null
  stages: typeof ATENDIMENTO_STAGES
}

export type AtendimentoInput = Pick<Atendimento, 'phone'> & Partial<Pick<Atendimento,
  'name' | 'vehicle' | 'brand' | 'model' | 'plate' | 'reason' | 'notes' | 'stage' | 'rejectionReason' | 'explicitRefusal'>>

export type AtendimentoPatch = Partial<AtendimentoInput> & { revision: number }
