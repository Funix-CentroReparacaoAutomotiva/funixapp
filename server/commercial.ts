import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import type { CatalogItem, CatalogKind, DiagnosisItem, DiagnosisService, CommercialSave } from '../shared/commercial.ts'
import { catalogItemUsable } from '../shared/commercial.ts'
import { AtendimentoRepository } from './atendimentos.ts'
import { ServiceError } from './errors.ts'
import { selectedScenario, touchComposition } from './scenarios.ts'
import { hierarchy } from './hierarchy.ts'

type Row = Record<string, SQLOutputValue>
function invalid(message: string): never { throw new ServiceError(400, 'INVALID_COMMERCIAL_DATA', message) }
function notFound(): never { throw new ServiceError(404, 'NOT_FOUND', 'Registro não encontrado neste Atendimento ou catálogo.') }
function conflict(): never { throw new ServiceError(409, 'VERSION_CONFLICT', 'Este registro mudou em outra edição. Reabra antes de salvar; seus campos não foram gravados.') }
function object(input: unknown, allowed: string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Envie um objeto JSON.')
  const data = input as Record<string, unknown>
  if (Object.keys(data).some(key => !allowed.includes(key))) invalid('Campo não permitido.')
  return data
}
function text(value: unknown, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) invalid('Texto ausente ou inválido.')
  return value.trim()
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') invalid('Confirmação inválida.'); return value }
function revision(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1) invalid('Informe a revisão atual.'); return Number(value) }
function catalog(row: Row): CatalogItem {
  return { id: String(row.id), kind: row.kind as CatalogKind, code: row.code === null ? null : String(row.code), name: String(row.name), status: row.status as CatalogItem['status'], source: row.source as CatalogItem['source'], suggestion: row.suggestion === 1, side: String(row.side), serviceId: row.service_id === null ? null : String(row.service_id), active: row.active === 1, revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

export class CommercialRepository {
  readonly db: DatabaseSync
  constructor(db: DatabaseSync) { this.db = db }
  catalogs() { return { items: this.db.prepare('SELECT * FROM catalog_items ORDER BY kind,name,id').all().map(catalog), hierarchy } }
  item(id: string) { const row = this.db.prepare('SELECT * FROM catalog_items WHERE id=?').get(id); if (!row) notFound(); return catalog(row) }
  usable(id: string, kind: CatalogKind) {
    const item = this.item(id)
    if (item.kind !== kind || !catalogItemUsable(item)) invalid('Selecione um item ativo e identificado do catálogo correspondente.')
    if (item.kind === 'dimensao') this.usable(item.serviceId!, 'servico')
    return item
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = operation(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private history(id: string) {
    const data = this.db.prepare('SELECT * FROM catalog_items WHERE id=?').get(id)!
    this.db.prepare('INSERT INTO catalog_history VALUES (?,?,?,?)').run(id, data.revision!, data.updated_at!, JSON.stringify(data))
  }
  saveCatalog(input: unknown, id?: string): CatalogItem {
    const data = object(input, id ? ['name','status','active','revision'] : ['kind','code','name','status','serviceId'])
    const old = id ? this.item(id) : null
    const kind = old?.kind ?? data.kind
    if (!['peca','servico','diagnostico','dimensao'].includes(String(kind))) invalid('Tipo de catálogo inválido.')
    const name = text(data.name ?? old?.name, 250, true)
    const status = data.status ?? old?.status ?? 'proposta'
    if (status !== 'proposta' && status !== 'validado') invalid('Situação de validação inválida.')
    const active = old ? (data.active === undefined ? old.active : bool(data.active)) : true
    const code = old ? old.code : kind === 'peca' ? text(data.code, 150, true) : null
    if (kind !== 'peca' && data.code !== undefined) invalid('Código físico pertence somente à peça.')
    const serviceId = old ? old.serviceId : kind === 'dimensao' ? text(data.serviceId, 100, true) : null
    if (!old && kind !== 'dimensao' && data.serviceId !== undefined) invalid('Somente dimensão pertence a um serviço.')
    const expected = old ? revision(data.revision) : 0
    return this.transaction(() => {
      if (serviceId && (!old || active)) this.usable(serviceId, 'servico')
      if (!old && code && this.db.prepare('SELECT id FROM catalog_items WHERE code=?').get(code)) throw new ServiceError(409, 'DUPLICATE_CODE', 'Este código de peça já existe; edite o cadastro existente.')
      const now = new Date().toISOString(), key = old?.id ?? randomUUID()
      if (old) {
        const result = this.db.prepare('UPDATE catalog_items SET name=?,status=?,active=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(name, status, active ? 1 : 0, now, key, expected)
        if (!result.changes) conflict()
      } else {
        this.db.prepare(`INSERT INTO catalog_items(id,kind,code,name,status,source,service_id,created_at,updated_at) VALUES (?,?,?,?,?,'operador',?,?,?)`).run(key, String(kind), code, name, status, serviceId, now, now)
      }
      this.history(key)
      return this.item(key)
    })
  }
  historyOf(id: string) { this.item(id); return this.db.prepare('SELECT revision,changed_at,data FROM catalog_history WHERE item_id=? ORDER BY revision').all(id).map(row => ({ revision: row.revision, changedAt: row.changed_at, data: JSON.parse(String(row.data)) })) }
  list(atendimentoId: string, scenarioId?: string) {
    new AtendimentoRepository(this.db).get(atendimentoId)
    const selected = selectedScenario(this.db,atendimentoId,scenarioId)
    const rows = this.db.prepare(`SELECT p.*,f.enabled AS scenario_enabled FROM diagnosis_items p LEFT JOIN scenario_piece_flags f ON f.piece_id=p.id AND f.scenario_id=? WHERE p.atendimento_id=? ORDER BY p.created_at,p.id`).all(selected,atendimentoId)
    const services = this.db.prepare(`SELECT l.*,f.enabled AS scenario_enabled FROM diagnosis_services l JOIN diagnosis_items p ON p.id=l.diagnosis_item_id LEFT JOIN scenario_service_flags f ON f.service_id=l.id AND f.scenario_id=? WHERE p.atendimento_id=? ORDER BY l.rowid`).all(selected,atendimentoId)
    const grouped = new Map<string,Row[]>()
    for(const line of services){const key=String(line.diagnosis_item_id),list=grouped.get(key)??[];list.push(line);grouped.set(key,list)}
    return rows.map(row=>this.diagnosis(row,grouped.get(String(row.id))??[]))
  }
  private diagnosis(row: Row, lines: Row[]): DiagnosisItem {
    const services = lines.map(s => ({ id: String(s.id), serviceId: String(s.service_id), dimensionId: s.dimension_id === null ? null : String(s.dimension_id), quantity: String(s.quantity), enabled:s.scenario_enabled===1, notes:String(s.notes), diagnosisId:s.diagnosis_id===null?null:String(s.diagnosis_id) }))
    return { id:String(row.id),atendimentoId:String(row.atendimento_id),pieceId:String(row.piece_id),diagnosisId:row.diagnosis_id===null?null:String(row.diagnosis_id),notes:String(row.notes),enabled:row.scenario_enabled===1,revision:Number(row.revision),createdAt:String(row.created_at),updatedAt:String(row.updated_at),services }
  }
  private getDiagnosis(atendimentoId: string, id: string, scenarioId?: string) {
    const selected=selectedScenario(this.db,atendimentoId,scenarioId)
    const row=this.db.prepare(`SELECT p.*,f.enabled AS scenario_enabled FROM diagnosis_items p LEFT JOIN scenario_piece_flags f ON f.piece_id=p.id AND f.scenario_id=? WHERE p.id=? AND p.atendimento_id=?`).get(selected,id,atendimentoId)
    if(!row)notFound()
    const lines=this.db.prepare(`SELECT l.*,f.enabled AS scenario_enabled FROM diagnosis_services l LEFT JOIN scenario_service_flags f ON f.service_id=l.id AND f.scenario_id=? WHERE l.diagnosis_item_id=? ORDER BY l.rowid`).all(selected,id)
    return this.diagnosis(row,lines)
  }
  add(atendimentoId: string, input: unknown) {
    new AtendimentoRepository(this.db).get(atendimentoId)
    const data = object(input, ['pieceCodes','scenarioId','scenarioRevision'])
    if (!Array.isArray(data.pieceCodes) || !data.pieceCodes.length || data.pieceCodes.length > 2 || data.pieceCodes.some(v => typeof v !== 'string' || v.length > 150)) invalid('Selecione uma peça ou os dois lados.')
    const codes = [...new Set(data.pieceCodes as string[])]
    return this.transaction(() => {
      const scenarioId = selectedScenario(this.db,atendimentoId,data.scenarioId,data.scenarioRevision)
      for (const code of codes) {
        const row = this.db.prepare("SELECT * FROM catalog_items WHERE code=? AND kind='peca'").get(code)
        if (!row) invalid('Peça sem código cadastrado. Identifique a peça no catálogo antes de compor o diagnóstico.')
        const piece = this.usable(String(row.id), 'peca')
        const now = new Date().toISOString()
        const id = randomUUID()
        const inserted = this.db.prepare('INSERT INTO diagnosis_items(id,atendimento_id,piece_id,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(atendimento_id,piece_id) DO NOTHING').run(id, atendimentoId, piece.id, now, now)
        if (inserted.changes) {
          this.db.prepare('UPDATE scenario_piece_flags SET enabled=1 WHERE scenario_id=? AND piece_id=?').run(scenarioId,id)
          touchComposition(this.db,atendimentoId)
        }
      }
      return this.list(atendimentoId,scenarioId)
    })
  }
  updateDiagnosis(atendimentoId:string,id:string,input:unknown):DiagnosisItem
  updateDiagnosis(atendimentoId:string,id:string,input:unknown,withRevision:true):CommercialSave<DiagnosisItem>
  updateDiagnosis(atendimentoId:string,id:string,input:unknown,withRevision=false):DiagnosisItem|CommercialSave<DiagnosisItem> {
    const data = object(input, ['revision','diagnosisId','notes','enabled','services','scenarioId','scenarioRevision'])
    const expected = revision(data.revision)
    return this.transaction(() => {
      const scenarioId = selectedScenario(this.db,atendimentoId,data.scenarioId,data.scenarioRevision)
      const old = this.getDiagnosis(atendimentoId, id,scenarioId)
      if (old.revision !== expected) conflict()
      const diagnosisId = data.diagnosisId === undefined ? old.diagnosisId : data.diagnosisId === null ? null : text(data.diagnosisId, 100, true)
      const notes = data.notes === undefined ? old.notes : text(data.notes, 8000)
      const enabled = data.enabled === undefined ? old.enabled : bool(data.enabled)
      if (diagnosisId && diagnosisId !== old.diagnosisId) this.usable(diagnosisId, 'diagnostico')
      let services = old.services
      if (data.services !== undefined) {
        if (!Array.isArray(data.services) || data.services.length > 50) invalid('Lista de serviços inválida (máximo 50).')
        const ids = new Set<string>()
        services = data.services.map(raw => {
          const service = object(raw, ['id','serviceId','dimensionId','quantity','enabled','notes','diagnosisId'])
          const serviceId = text(service.serviceId, 100, true)
          const dimensionId = service.dimensionId === null || service.dimensionId === undefined ? null : text(service.dimensionId, 100, true)
          const lineId = service.id === undefined ? randomUUID() : text(service.id, 100, true)
          const previous = old.services.find(s => s.id === lineId)
          if (service.id !== undefined && !previous) invalid('Linha de serviço não pertence a este diagnóstico.')
          if (ids.has(lineId)) invalid('Linha de serviço duplicada.'); ids.add(lineId)
          // Existing references remain editable/removable after a catalog deactivation.
          if (!previous || serviceId !== previous.serviceId) this.usable(serviceId, 'servico')
          if (dimensionId && (!previous || dimensionId !== previous.dimensionId || serviceId !== previous.serviceId)) {
            if (this.usable(dimensionId, 'dimensao').serviceId !== serviceId) invalid('A dimensão não pertence a este serviço.')
          }
          if (typeof service.quantity !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(service.quantity) || !/[1-9]/.test(service.quantity)) invalid('Informe uma quantidade positiva em texto decimal, com até 9 dígitos inteiros e 6 casas decimais.')
          const quantity = service.quantity.includes('.') ? service.quantity.replace(/0+$/, '').replace(/\.$/, '') : service.quantity
          const notes = service.notes === undefined ? previous?.notes ?? '' : text(service.notes,8000)
          const diagnosisId = service.diagnosisId === undefined ? previous?.diagnosisId ?? null : service.diagnosisId === null ? null : text(service.diagnosisId,100,true)
          if (diagnosisId && diagnosisId !== previous?.diagnosisId) this.usable(diagnosisId,'diagnostico')
          return { id: lineId, serviceId, dimensionId, quantity, notes, diagnosisId, enabled: bool(service.enabled ?? true) } satisfies DiagnosisService
        })
      }
      this.db.prepare('UPDATE diagnosis_items SET diagnosis_id=?,notes=?,enabled=?,revision=revision+1,updated_at=? WHERE id=?').run(diagnosisId, notes, enabled ? 1 : 0, new Date().toISOString(), id)
      this.db.prepare('UPDATE scenario_piece_flags SET enabled=? WHERE scenario_id=? AND piece_id=?').run(enabled ? 1 : 0,scenarioId,id)
      const retained = new Set(services.map(service => service.id))
      for (const previous of old.services) if (!retained.has(previous.id)) this.db.prepare('DELETE FROM diagnosis_services WHERE id=?').run(previous.id)
      const insert = this.db.prepare(`INSERT INTO diagnosis_services(id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET service_id=excluded.service_id,dimension_id=excluded.dimension_id,quantity=excluded.quantity,notes=excluded.notes,diagnosis_id=excluded.diagnosis_id`)
      for (const service of services) {
        insert.run(service.id,id,service.serviceId,service.dimensionId,service.quantity,service.enabled ? 1 : 0,service.notes ?? '',service.diagnosisId ?? null)
        this.db.prepare('UPDATE scenario_service_flags SET enabled=? WHERE scenario_id=? AND service_id=?').run(service.enabled ? 1 : 0,scenarioId,service.id)
      }
      touchComposition(this.db,atendimentoId)
      const item=this.getDiagnosis(atendimentoId,id,scenarioId)
      return withRevision?{item,scenarioRevision:Number(this.db.prepare('SELECT revision FROM scenarios WHERE id=?').get(scenarioId)!.revision)}:item
    })
  }
  remove(atendimentoId: string, id: string, input: unknown) {
    const data = object(input, ['revision']), expected = revision(data.revision)
    return this.transaction(() => {
      const old = this.getDiagnosis(atendimentoId, id)
      if (old.revision !== expected) conflict()
      this.db.prepare('DELETE FROM diagnosis_items WHERE id=?').run(id)
      touchComposition(this.db,atendimentoId)
      return { removed: true }
    })
  }
}
