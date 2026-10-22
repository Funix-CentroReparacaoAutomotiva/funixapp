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
