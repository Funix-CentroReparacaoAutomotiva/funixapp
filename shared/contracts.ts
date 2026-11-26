import type { CustomerReferences } from './customer.ts'
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
  { id: 'em-negociacao', name: 'Em negociação' },
  { id: 'morno', name: 'Morno' },
  { id: 'frio', name: 'Frio' },
  { id: 'rejeitados', name: 'Encerrados' },
] as const

export type AtendimentoStage = typeof ATENDIMENTO_STAGES[number]['id']

export const ATENDIMENTO_PURPOSES = {
  unclassified: 'A classificar',
  non_commercial: 'Não comercial',
  commercial: 'Comercial',
} as const
export type AtendimentoPurpose = keyof typeof ATENDIMENTO_PURPOSES

export interface Atendimento {
  purpose?: AtendimentoPurpose
  chatIdentity?: {name:string;phone:string;conversationId:string;observedPhone?:string}
  closedAt?: string | null
  references?: CustomerReferences
  lastContactAt?: string | null
  commercialValue?: {min: string; max: string} | null
  id: string
  phone: string
  phoneNormalized: string | null
  name: string
  vehicle: string
  brand: string
  model: string
  fabricationYear: string | null
  modelYear: string | null
  /** Current operational forecast, YYYY-MM-DD in local calendar; not the actual handover. */
  deliveryDate?: string | null
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

/** Open manual-creation candidate; a match requests review, never a forced merge. */
export interface DuplicateAtendimento {
  id:string
  name:string
  vehicle:string
  plate:string
  stage:string
  revision:number
}

export interface AtendimentoList {
  items: Atendimento[]
  total: number
  nextOffset: number | null
  stages: typeof ATENDIMENTO_STAGES
}

export type AtendimentoInput = {closed?:boolean;deliveryDateReason?:string} & Partial<Pick<Atendimento, 'phone' | 'references' |
  'name' | 'vehicle' | 'brand' | 'model' | 'fabricationYear' | 'modelYear' | 'deliveryDate' | 'plate' | 'reason' | 'notes' | 'purpose' | 'stage' | 'rejectionReason' | 'explicitRefusal'>>

export type AtendimentoPatch = Partial<AtendimentoInput> & { revision: number }
