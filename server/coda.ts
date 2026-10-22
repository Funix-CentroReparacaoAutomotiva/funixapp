import type { WorkRecord, WorkspaceQuery, WorkspaceResponse } from '../shared/contracts.ts'
import type { ReadRepository } from './repository.ts'
import { ServiceError } from './errors.ts'

const API = 'https://coda.io/apis/v1'
const DOC = '2zsjI-nqWr'
const TABLES = {
  atendimento: 'grid-eGvJhrlDTH',
  experiencia: 'grid-oejkc9WuBX',
  statuses: 'grid-DXriGyd94a',
  phases: 'grid-_MprvxGTiK',
} as const

// Stable IDs read through Superhuman Docs on 2026-10-21. Names are semantic aliases,
// so a display rename does not silently change the adapter's field ownership.
export const AUDITED_COLUMNS: Record<string, Record<string, string>> = {
  [TABLES.atendimento]: {
    at_IdAtendimento: 'c-Zorfa5ARUf', at_StatusComercial: 'c-xUxJ99lkfc',
    funil_Nome: 'c-hV24W_ZrDh', funil_Contato: 'c-5Jgezs2B3o',
    funil_Modelo: 'c-mUY2z4X3t_', funil_Placa: 'c-AOqEMrG5UU',
  },
  [TABLES.experiencia]: {
    'xp_ID Experiencia': 'c-Zorfa5ARUf', Atendimento: 'c-xBWpl9SSPA',
    cliente_Entidade: 'c-UbQW2h1LoE', cliente_Veiculo: 'c-W65XoagteP',
    cliente_Contato: 'c-6wvAsDuQxj', cliente_EspecificaoVeiculo: 'c-Pf58Ailfmc',
    fase_Comercial: 'c-xUxJ99lkfc', fase_Operacional: 'c-GOOyT3Nw7q',
    xp_dataEntrada: 'c-bhWYZ1DCmq', xp_DataSaida: 'c-BsZwSsRrht',
    flag_Finalizada: 'c-ra-eGqcGTD', flag_Saiu: 'c-2-8aXpdO1O',
  },
}

const ACTIVE_STAGE_IDS = {
  atendimento: ['i-WVc9SdOAzf', 'i-y-QXpAVKUp', 'i-JinLqTCLcw', 'i-v6QUAa-L50', 'i-9kGcgfN3eV', 'i-FtvoC1lZFj'],
  experiencia: ['i-QtLL6zMKUy', 'i-mVpTb2Twal', 'i-_Lp79oOQ9K', 'i-NFSuIlx6_u', 'i-F_sWptRaQV'],
} as const

interface RichCell { name?: unknown; value?: unknown; rowId?: string; id?: string; '@id'?: string }
type Cell = string | number | boolean | null | RichCell | Cell[]
interface CodaRow { id: string; name?: string; browserLink?: string; values: Record<string, Cell> }
interface CodaColumn { id: string; name: string; display?: boolean }
interface CodaList<T> { items: T[]; nextPageToken?: string }
type ColumnMap = Record<string, string>

export function cellText(cell: Cell | undefined): string {
  if (cell == null) return ''
  if (Array.isArray(cell)) return cell.map(cellText).filter(Boolean).join(', ')
  if (typeof cell === 'object') return cellText((cell.name ?? cell.value ?? '') as Cell)
  return String(cell)
}

export function cellRowId(cell: Cell | undefined): string | null {
  if (Array.isArray(cell)) return cell.length === 1 ? cellRowId(cell[0]) : null
  if (cell && typeof cell === 'object') {
    const id = cell.rowId ?? cell.id ?? cell['@id']?.split('/').at(-1)
    return typeof id === 'string' && /^i-[\w-]+$/.test(id) ? id : null
  }
  return null
}

function bool(cell: Cell | undefined): boolean { return cell === true || cell === 1 || cell === 'true' }
function date(cell: Cell | undefined): string | null {
  const value = cellText(cell)
  return value && !Number.isNaN(Date.parse(value)) ? value : null
}
function safeSource(value: string | undefined): string {
  if (!value) return ''
  try { const url = new URL(value); return url.protocol === 'https:' && ['coda.io', 'docs.superhuman.com'].includes(url.hostname) ? url.href : '' } catch { return '' }
}

export function mapRow(kind: WorkRecord['kind'], row: CodaRow, columns: ColumnMap): WorkRecord {
  const get = (...names: string[]): Cell | undefined => {
    for (const name of names) { const id = columns[name]; if (id && row.values[id] != null) return row.values[id] }
    return undefined
  }
  const experience = kind === 'experiencia'
  const stage = get(experience ? 'fase_Comercial' : 'at_StatusComercial')
  const origin = experience ? get('Atendimento') : undefined
  const atendimentoRowId = experience ? cellRowId(origin) : row.id
  if (experience && !atendimentoRowId) throw new ServiceError(503, 'CODA_RELATION_CONFLICT', 'A Experiência não possui um único Atendimento de origem verificável. O vínculo precisa ser revisado no ERP.')
  return {
    rowId: row.id,
    id: cellText(get(experience ? 'xp_ID Experiencia' : 'at_IdAtendimento')) || row.name || row.id,
    kind,
    name: cellText(get(experience ? 'cliente_Entidade' : 'funil_Nome')),
    contact: cellText(get(experience ? 'cliente_Contato' : 'funil_Contato')),
    vehicle: cellText(get(experience ? 'cliente_EspecificaoVeiculo' : 'funil_Modelo')),
    // The verified display column of db_Veiculos is Placa. Preserve that lookup text.
    plate: cellText(get(experience ? 'cliente_Veiculo' : 'funil_Placa')),
    stage: cellText(stage), stageId: cellRowId(stage),
    detail: experience ? cellText(get('fase_Operacional')) : '',
    sourceUrl: safeSource(row.browserLink),
    atendimentoRowId,
    enteredAt: date(get('xp_dataEntrada')),
    exitedAt: date(get('xp_DataSaida')),
    finished: bool(get('flag_Finalizada')),
    departed: bool(get('flag_Saiu')),
  }
}

export interface CodaOptions {
  token?: string
  fetch?: typeof globalThis.fetch
  // View IDs must be verified in the ERP. No inferred business filters.
  views?: { funil: string; acompanhamento: string; historico: string }
}

export class CodaReadRepository implements ReadRepository {
  configured: boolean
  #token: string
  #fetch: typeof globalThis.fetch
  #views: CodaOptions['views']
  #columns = new Map<string, { expires: number; value: ColumnMap }>()
  #verifiedViews = new Set<string>()
  #stageCache = new Map<string, { expires: number; value: { id: string; name: string }[] }>()
  #recordCache = new Map<string, { expires: number; value: WorkRecord }>()
  constructor(options: CodaOptions = {}) {
    this.#token = options.token ?? ''
    this.configured = Boolean(this.#token)
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#views = options.views
  }

  async #get<T>(path: string, params?: Record<string, string>): Promise<T> {
    if (!this.#token) throw new ServiceError(503, 'CODA_NOT_CONFIGURED', 'A conexão contínua com o Coda ainda não foi configurada no servidor.')
    const url = new URL(`${API}/docs/${DOC}/${path}`)
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
    let response: Response
    try {
      response = await this.#fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${this.#token}` }, redirect: 'error', signal: AbortSignal.timeout(12000) })
    } catch { throw new ServiceError(502, 'CODA_UNAVAILABLE', 'Não foi possível consultar o Coda. Tente novamente.') }
    if (!response.ok) {
      if (response.status === 404) throw new ServiceError(404, 'NOT_FOUND', 'Registro não encontrado no Coda.')
      if (response.status === 429) throw new ServiceError(503, 'CODA_RATE_LIMIT', 'O Coda atingiu o limite de consultas. Aguarde e tente novamente.')
      throw new ServiceError(502, 'CODA_READ_FAILED', 'O Coda recusou a consulta. Verifique a conexão no servidor.')
    }
    try { return await response.json() as T } catch { throw new ServiceError(502, 'CODA_INVALID_RESPONSE', 'O Coda retornou uma resposta inválida.') }
  }

  async #schema(table: string): Promise<ColumnMap> {
    const cached = this.#columns.get(table)
    if (cached && cached.expires > Date.now()) return cached.value
    const value: ColumnMap = {}
    const observedIds = new Set<string>()
    let cursor = ''
    do {
      const page = await this.#get<CodaList<CodaColumn>>(`tables/${encodeURIComponent(table)}/columns`, { limit: '100', ...(cursor ? { pageToken: cursor } : {}) })
      for (const column of page.items) { observedIds.add(column.id); value[column.name] = column.id }
      cursor = page.nextPageToken ?? ''
    } while (cursor)
    const audited = AUDITED_COLUMNS[table] ?? {}
    if (Object.values(audited).some(id => !observedIds.has(id))) throw new ServiceError(503, 'CODA_SCHEMA_CHANGED', 'O esquema do Coda mudou em relação ao contrato auditado. A consulta precisa ser revisada.')
    Object.assign(value, audited)
    this.#columns.set(table, { value, expires: Date.now() + 300000 })
    return value
  }

  async #stages(kind: WorkRecord['kind']): Promise<{ id: string; name: string }[]> {
    const cached = this.#stageCache.get(kind)
    if (cached && cached.expires > Date.now()) return cached.value
    const table = kind === 'atendimento' ? TABLES.statuses : TABLES.phases
    const rows: CodaRow[] = []
    let cursor = ''
    do {
      const page = await this.#get<CodaList<CodaRow>>(`tables/${table}/rows`, { limit: '100', valueFormat: 'simple', ...(cursor ? { pageToken: cursor } : {}) })
      rows.push(...page.items)
      cursor = page.nextPageToken ?? ''
    } while (cursor)
    const allowed = new Set<string>(ACTIVE_STAGE_IDS[kind])
    const orderColumn = kind === 'atendimento' ? 'c-oFRnyLOfCl' : 'c-woffbh7ikM'
    const value = rows.filter(row => allowed.has(row.id)).sort((a, b) => Number(a.values[orderColumn] ?? 0) - Number(b.values[orderColumn] ?? 0)).map(row => ({ id: row.id, name: row.name ?? row.id }))
    if (value.length !== allowed.size) throw new ServiceError(503, 'CODA_STAGES_CHANGED', 'Os estágios do ERP mudaram em relação à vista auditada. A consulta precisa ser revisada.')
    this.#stageCache.set(kind, { expires: Date.now() + 300000, value })
    return value
  }

  async #verifyView(id: string, name: string, baseTable: string): Promise<void> {
    if (this.#verifiedViews.has(id)) return
    const metadata = await this.#get<{ name?: string; tableType?: string; parent?: { tableId?: string }; baseTableId?: string }>(`tables/${encodeURIComponent(id)}`)
    const reportedBase = metadata.baseTableId ?? metadata.parent?.tableId
    if (metadata.name !== name || metadata.tableType !== 'view' || (reportedBase && reportedBase !== baseTable)) throw new ServiceError(503, 'CODA_VIEW_MISMATCH', 'A vista configurada não corresponde ao contrato de leitura auditado.')
    this.#verifiedViews.add(id)
  }

  async workspace(query: WorkspaceQuery): Promise<WorkspaceResponse> {
    if (!this.#token) throw new ServiceError(503, 'CODA_NOT_CONFIGURED', 'A conexão contínua com o Coda ainda não foi configurada no servidor.')
    const kind = query.area === 'funil' ? 'atendimento' : 'experiencia'
    const table = TABLES[kind]
    const view = query.area === 'funil' ? this.#views?.funil : this.#views?.[query.scope]
    if (!view) throw new ServiceError(503, 'CODA_VIEW_NOT_VERIFIED', 'A consulta desta área aguarda o contrato de filtro verificado do ERP.')
    await this.#verifyView(view, query.area === 'funil' ? 'Viz. Atendimentos (PC)' : 'ViewExperiencia_Comercial', table)
    await this.#schema(table)
    const [page, stages] = await Promise.all([
      this.#get<CodaList<CodaRow>>(`tables/${encodeURIComponent(view)}/rows`, { limit: String(query.limit), valueFormat: 'rich', visibleOnly: 'true', ...(query.cursor ? { pageToken: query.cursor } : {}) }),
      this.#stages(kind),
    ])
    const q = query.q.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '')
    // visibleOnly keeps the audited row filter but can omit hidden DTO columns.
    // Hydrate only that page's row IDs through the base table; at most four reads
    // run concurrently. The short cache contains the minimal DTO, not raw rows.
    const mapped: WorkRecord[] = Array.from({ length: page.items.length })
    let index = 0
    await Promise.all(Array.from({ length: Math.min(4, page.items.length) }, async () => {
      for (;;) {
        const position = index++
        const row = page.items[position]
        if (!row) return
        if (!/^i-[\w-]{1,100}$/.test(row.id)) throw new ServiceError(502, 'CODA_INVALID_RESPONSE', 'O Coda retornou um identificador de registro inválido.')
        mapped[position] = await this.record(kind, row.id)
      }
    }))
    const allowed = new Set(stages.map(stage => stage.id))
    if (mapped.some(row => !row.stageId || !allowed.has(row.stageId))) throw new ServiceError(503, 'CODA_VIEW_CHANGED', 'A vista retornou registros fora do contrato de estágios auditado. Nenhuma transição foi executada.')
    const items = mapped.filter(row => !q || [row.id, row.rowId, row.name, row.contact, row.vehicle, row.plate, row.stage].join(' ').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q))
    return { items, stages, nextCursor: page.nextPageToken ?? null, source: { system: 'coda', mode: 'live', fetchedAt: new Date().toISOString() }, capabilities: { write: false, messages: false } }
  }

  async record(kind: WorkRecord['kind'], rowId: string): Promise<WorkRecord> {
    const table = TABLES[kind]
    const key = `${table}/${rowId}`
    const cached = this.#recordCache.get(key)
    if (cached && cached.expires > Date.now()) return cached.value
    const columns = await this.#schema(table)
    const row = await this.#get<CodaRow>(`tables/${table}/rows/${encodeURIComponent(rowId)}`, { valueFormat: 'rich' })
    if (row.id !== rowId) throw new ServiceError(502, 'CODA_INVALID_RESPONSE', 'O Coda retornou um registro diferente do solicitado.')
    const value = mapRow(kind, row, columns)
    if (this.#recordCache.size >= 500) { const first = this.#recordCache.keys().next().value; if (first) this.#recordCache.delete(first) }
    this.#recordCache.set(key, { expires: Date.now() + 30000, value })
    return value
  }
}
