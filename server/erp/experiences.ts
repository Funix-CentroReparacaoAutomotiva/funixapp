import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { AtendimentoRepository } from '../atendimentos.ts'
import { ServiceError } from '../errors.ts'
import { ATENDIMENTO_STAGES } from '../../shared/contracts.ts'
import { budgetLifecycleLabels } from '../../shared/production.ts'
import type { BudgetLifecycleState } from '../../shared/production.ts'
import type { ErpRequest } from './contracts.ts'
import { experienceReceivables } from './finance.ts'
import { listWorkshopVehicles, workshopDay } from './workshop.ts'
import { workshopPhases } from '../../shared/erp.ts'

export function migrateExperiences(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE erp_experience_diary (
      id TEXT PRIMARY KEY,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      origin_type TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('comment','note','event')),
      body TEXT NOT NULL,
      author TEXT,
      occurred_at TEXT NOT NULL,
      attachments TEXT NOT NULL CHECK(json_valid(attachments)),
      UNIQUE(atendimento_id,source,source_id)
    );
    CREATE INDEX erp_experience_diary_at ON erp_experience_diary(atendimento_id,occurred_at,id);
    CREATE TRIGGER erp_experience_diary_immutable BEFORE UPDATE ON erp_experience_diary
      BEGIN SELECT RAISE(ABORT,'Entrada do Diário é imutável'); END;
    CREATE TRIGGER erp_experience_diary_no_delete BEFORE DELETE ON erp_experience_diary
      BEGIN SELECT RAISE(ABORT,'Entrada do Diário é imutável'); END;

    CREATE TABLE erp_experience_origin (
      atendimento_id TEXT PRIMARY KEY REFERENCES atendimentos(id) ON DELETE RESTRICT,
      origin TEXT NOT NULL CHECK(origin IN ('initial','recurrence','rework')),
      previous_experience_id TEXT REFERENCES production_experiences(id) ON DELETE RESTRICT,
      channel TEXT,
      request_id TEXT UNIQUE,
      request_hash TEXT,
      CHECK((origin='initial')=(previous_experience_id IS NULL))
    );
    CREATE INDEX erp_experience_origin_previous ON erp_experience_origin(previous_experience_id);

    CREATE TABLE erp_experience_sac (
      id TEXT PRIMARY KEY,
      experience_id TEXT NOT NULL REFERENCES production_experiences(id) ON DELETE RESTRICT,
      followup_atendimento_id TEXT UNIQUE REFERENCES atendimentos(id) ON DELETE RESTRICT,
      description TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      cause TEXT,
      resolution TEXT,
      resolved_by TEXT,
      resolved_at TEXT
    );
    CREATE INDEX erp_experience_sac_experience ON erp_experience_sac(experience_id,created_at);
  `)
}

const contexts = ['atendimento','diagnostico','orcamento','os','experiencia','commercial'] as const
type Context = typeof contexts[number]
type Attachment = { name: string; type: string; data: string }
type DiaryInput = {
  atendimentoId: string
  source: Context
  sourceId: string
  originType?: string
  kind: 'comment' | 'note' | 'event'
  body: string
  author: string | null
  occurredAt: string
  attachments?: Attachment[]
}
type Entry = Omit<DiaryInput,'atendimentoId'|'source'|'originType'|'attachments'> & {
  id: string
  source: string
  relatedId: string
  attachments: Attachment[]
}

const invalid = (message: string): never => { throw new ServiceError(422,'ERP_EXPERIENCE_INVALID',message) }
const missing = (): never => { throw new ServiceError(404,'ERP_EXPERIENCE_NOT_FOUND','Experiência, Atendimento ou registro relacionado não encontrado.') }
const table = (db: DatabaseSync, name: string) => !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR')
function pickText(value: unknown,max: number,label: string,required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) return invalid(`Confira ${label}.`)
  return value.trim()
}
const optional = (value: unknown,max: number,label: string) => value == null ? '' : pickText(value,max,label)

function attachmentList(value: unknown): Attachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 3) return invalid('Selecione até três anexos.')
  let total = 0
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') return invalid('Anexo inválido.')
    const name = pickText(raw.name,120,'o nome do anexo',true).replace(/[\\/\u0000-\u001f]/g,'_')
    const type = pickText(raw.type,60,'o tipo do anexo',true)
    if (!['application/pdf','image/jpeg','image/png','text/plain'].includes(type)) return invalid('Formato de anexo indisponível.')
    const data = pickText(raw.data,65536,'o tamanho do anexo',true)
    const bytes = Buffer.from(data,'base64')
    if (!bytes.length || bytes.toString('base64') !== data) return invalid('Conteúdo de anexo inválido.')
    total += bytes.length
    if (total > 40 * 1024) return invalid('Os anexos devem somar até 40 KB.')
    return {name,type,data}
  })
}

export function appendExperienceDiary(db: DatabaseSync,input: DiaryInput): Entry {
  const relatedId = input.originType ?? input.atendimentoId
  const attachments = attachmentList(input.attachments)
  const normalized = JSON.stringify(attachments)
  db.prepare(`INSERT INTO erp_experience_diary
    (id,atendimento_id,source,source_id,origin_type,kind,body,author,occurred_at,attachments)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(atendimento_id,source,source_id) DO NOTHING`).run(
    randomUUID(),input.atendimentoId,input.source,input.sourceId,relatedId,input.kind,input.body,input.author,input.occurredAt,normalized)
  const row = db.prepare('SELECT * FROM erp_experience_diary WHERE atendimento_id=? AND source=? AND source_id=?')
    .get(input.atendimentoId,input.source,input.sourceId)!
  if (row.origin_type !== relatedId || row.kind !== input.kind || row.body !== input.body || row.author !== input.author || row.attachments !== normalized)
    throw new ServiceError(409,'ERP_DIARY_CONFLICT','O identificador já foi usado em outra entrada.')
  return {id:String(row.id),source:input.source,sourceId:input.sourceId,relatedId,kind:input.kind,
    body:input.body,author:input.author,occurredAt:String(row.occurred_at),attachments}
}

function verifyContext(db: DatabaseSync,at: string,source: Context,related: string) {
  if (!db.prepare('SELECT 1 FROM atendimentos WHERE id=?').get(at)) return missing()
  if (source === 'atendimento' || source === 'commercial') { if (at !== related) missing(); return }
  const tables = {diagnostico:'diagnosis_items',orcamento:'budget_versions',os:'work_orders',experiencia:'production_experiences'} as const
  if (!db.prepare(`SELECT 1 FROM ${tables[source]} WHERE id=? AND atendimento_id=?`).get(related,at)) missing()
}

function event(source: string,key: string,relatedId: string,body: string,occurredAt: string,author: string|null = null): Entry {
  return {id:`${source}:${key}`,source,sourceId:key,relatedId,kind:'event',body,occurredAt,author,attachments:[]}
}

const workshopActions: Record<string,string> = {
  entry:'Entrada registrada',phase:'Fase da oficina atualizada',block:'Impedimento registrado',
  unblock:'Impedimento removido',quality:'Qualidade registrada',departure:'Saída registrada','commercial-close':'Fechamento registrado',
}

function diary(db: DatabaseSync,at: string,source: string,related: string) {
  new AtendimentoRepository(db).get(at)
  const entries: Entry[] = db.prepare('SELECT * FROM erp_experience_diary WHERE atendimento_id=?')
    .all(at).map(row => ({
      id:String(row.id),source:String(row.source),sourceId:String(row.source_id),relatedId:String(row.origin_type),
      kind:row.kind as Entry['kind'],body:String(row.body),author:row.author == null ? null : String(row.author),
      occurredAt:String(row.occurred_at),attachments:JSON.parse(String(row.attachments)) as Attachment[],
    }))
  const budgets = db.prepare('SELECT id,label,created_at FROM budget_versions WHERE atendimento_id=?').all(at)
  const orders = db.prepare('SELECT id,budget_label,created_at,authorized_by FROM work_orders WHERE atendimento_id=?').all(at)
  for (const row of budgets) entries.push(event('orcamento',`issued-${row.id}`,String(row.id),`Orçamento ${row.label} emitido`,String(row.created_at)))
  for (const row of orders) entries.push(event('os',`issued-${row.id}`,String(row.id),`OS do orçamento ${row.budget_label} emitida`,String(row.created_at),row.authorized_by == null ? null : String(row.authorized_by)))
  for (const row of db.prepare('SELECT * FROM production_budget_transitions WHERE atendimento_id=?').all(at)) {
    const state = budgetLifecycleLabels[row.state as BudgetLifecycleState]
    entries.push(event('orcamento',`transition-${row.id}`,String(row.budget_version_id),row.reason ? `${state} — ${row.reason}` : state,String(row.occurred_at),row.operator_id == null ? null : String(row.operator_id)))
  }
  for (const row of db.prepare('SELECT * FROM atendimento_delivery_date_history WHERE atendimento_id=?').all(at)) {
    const body = row.new_date ? `Previsão de entrega: ${row.new_date} — ${row.reason}` : `Previsão removida — ${row.reason}`
    entries.push(event('atendimento',`delivery-${row.id}`,at,body,String(row.changed_at),row.operator_id == null ? null : String(row.operator_id)))
  }
  if (table(db,'erp_workshop_events')) {
    const rows = db.prepare(`SELECT w.* FROM erp_workshop_events w JOIN production_experiences e ON e.id=w.experience_id WHERE e.atendimento_id=?`).all(at)
    for (const row of rows) {
      const phase = workshopPhases.find(item => item.id === row.phase)
      const label = row.action === 'phase' && phase ? `Fase da oficina: ${phase.label}` : workshopActions[String(row.action)] ?? String(row.action)
      entries.push(event('oficina',String(row.id),String(row.experience_id),row.note ? `${label} — ${row.note}` : label,String(row.happened_at),row.operator == null ? null : String(row.operator)))
    }
  }
  if (table(db,'erp_sales_stage_events')) {
    const rows = db.prepare('SELECT id,occurred_at,stage FROM erp_sales_stage_events WHERE atendimento_id=?').all(at)
    for (const row of rows) {
      const stage = ATENDIMENTO_STAGES.find(x => x.id === row.stage)?.name ?? String(row.stage)
      entries.push(event('commercial',`stage-${row.id}`,at,`Etapa comercial: ${stage}`,String(row.occurred_at)))
    }
  }
  if (table(db,'erp_sales_contacts')) {
    const rows = db.prepare('SELECT message_id,occurred_at FROM erp_sales_contacts WHERE atendimento_id=?').all(at)
    for (const row of rows) entries.push(event('commercial',`whatsapp-${row.message_id}`,at,'Envio comercial pelo WhatsApp confirmado',String(row.occurred_at)))
  }
  const rows = db.prepare(`SELECT s.* FROM erp_experience_sac s JOIN production_experiences e ON e.id=s.experience_id WHERE e.atendimento_id=?`).all(at)
  for (const row of rows) {
    entries.push(event('sac',`opened-${row.id}`,String(row.id),String(row.description),String(row.created_at),String(row.author)))
    if (row.resolved_at) entries.push(event('sac',`resolved-${row.id}`,String(row.id),`Causa: ${row.cause}. Resolução: ${row.resolution}`,String(row.resolved_at),String(row.resolved_by)))
  }
  return entries.filter(entry => (!source || entry.source === source) && (!related || entry.relatedId === related))
    .sort((a,b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))
}

function legacyNotes(db: DatabaseSync,at: string,source: string,related: string) {
  return db.prepare(`SELECT 'atendimento' AS source,id AS relatedId,notes AS body FROM atendimentos WHERE id=?
    UNION ALL SELECT 'diagnostico',d.id,d.notes FROM diagnosis_items d WHERE d.atendimento_id=?
    UNION ALL SELECT 'diagnostico',d.id,s.notes FROM diagnosis_services s JOIN diagnosis_items d ON d.id=s.diagnosis_item_id
    WHERE d.atendimento_id=?`).all(at,at,at).filter(row => String(row.body ?? '').trim() &&
    (!source || row.source === source) && (!related || row.relatedId === related))
}

function experienceRows(db: DatabaseSync) {
  return db.prepare(`
    SELECT e.id,e.atendimento_id,e.scheduled_entry,e.created_at,a.delivery_date,a.name,a.plate,a.model,a.vehicle,
      json_extract(e.customer_json,'$.text') AS customer,
      json_extract(e.vehicle_json,'$.text') AS vehicle_name,
      json_extract(e.vehicle_json,'$.plate') AS vehicle_plate,
      json_extract(e.payer_json,'$.text') AS payer,
      o.origin,o.channel,o.previous_experience_id
    FROM production_experiences e JOIN atendimentos a ON a.id=e.atendimento_id
    LEFT JOIN erp_experience_origin o ON o.atendimento_id=a.id
    ORDER BY e.created_at DESC,e.id
  `).all()
}

function library(db: DatabaseSync,query: URLSearchParams) {
  const search = fold(pickText(query.get('q') ?? '',150,'a busca')).replace(/[-\s]/g,'')
  const since = dateFilter(query.get('from')), until = dateFilter(query.get('to'))
  if (since && until && since > until) return invalid('Confira o período de busca.')
  const origin = query.get('origin')
  if (origin && !['initial','recurrence','rework','unknown'].includes(origin)) return invalid('Confira a origem.')
  const status = query.get('status')
  if (status && !['scheduled','present','departed','closed','unknown'].includes(status)) return invalid('Confira a situação.')
  const offset = Number(query.get('offset') ?? 0)
  if (!Number.isSafeInteger(offset) || offset < 0) return invalid('Confira a página de resultados.')
  const vehicles = table(db,'erp_workshop_events') ? listWorkshopVehicles(db) : []
  const statusById = new Map(vehicles.map(vehicle => [
    vehicle.experienceId,vehicle.requiresClassification ? 'unknown' : vehicle.commercialClosedAt ? 'closed' : vehicle.departedAt ? 'departed' : vehicle.present ? 'present' : 'scheduled',
  ]))
  const rows = experienceRows(db).map(row => ({
    id:String(row.id),atendimentoId:String(row.atendimento_id),createdAt:String(row.created_at),
    scheduledEntry:String(row.scheduled_entry),deliveryDate:row.delivery_date == null ? null : String(row.delivery_date),
    customer:String(row.customer || row.name || ''),vehicle:String(row.vehicle_name || row.model || row.vehicle || ''),
    plate:String(row.vehicle_plate || row.plate || ''),payer:String(row.payer || ''),
    origin:String(row.origin ?? 'unknown'),channel:row.channel == null ? null : String(row.channel),
    previousExperienceId:row.previous_experience_id == null ? null : String(row.previous_experience_id),
    status:statusById.get(String(row.id)) ?? 'unknown',
  })).filter(row => {
    const day = workshopDay(Date.parse(row.createdAt))
    return (!search || [row.id,row.atendimentoId,row.customer,row.vehicle,row.plate].some(value => fold(value).replace(/[-\s]/g,'').includes(search)))
      && (!origin || row.origin === origin) && (!status || row.status === status)
      && (!since || day >= since) && (!until || day <= until)
  })
  return {items:rows.slice(offset,offset+50),total:rows.length,nextOffset:offset+50 < rows.length ? offset+50 : null}
}

function dateFilter(value: string|null) {
  if (!value) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid('Informe uma data válida.')
  const date = new Date(value+'T00:00:00Z')
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== value) return invalid('Informe uma data válida.')
  return value
}

function detail(db: DatabaseSync,id: string) {
  const row = db.prepare('SELECT id,atendimento_id FROM production_experiences WHERE id=?').get(id)
  if (!row) return missing()
  const at = String(row.atendimento_id)
  const origin = db.prepare('SELECT origin,channel,previous_experience_id FROM erp_experience_origin WHERE atendimento_id=?').get(at)
  const previous = origin?.previous_experience_id == null ? null : db.prepare('SELECT id,atendimento_id FROM production_experiences WHERE id=?').get(origin.previous_experience_id)
  const budgets = db.prepare('SELECT id,label,created_at FROM budget_versions WHERE atendimento_id=? ORDER BY sequence DESC').all(at)
  const orders = db.prepare('SELECT id,budget_version_id,budget_label,created_at,experience_id FROM work_orders WHERE atendimento_id=? ORDER BY serial DESC').all(at)
  const complaints = db.prepare('SELECT id,description,followup_atendimento_id,created_at,resolved_at FROM erp_experience_sac WHERE experience_id=? ORDER BY created_at DESC').all(id)
  const sequences = db.prepare(`SELECT o.atendimento_id,o.origin,a.reason,e.id AS experience_id
    FROM erp_experience_origin o JOIN atendimentos a ON a.id=o.atendimento_id
    LEFT JOIN production_experiences e ON e.atendimento_id=a.id
    WHERE o.previous_experience_id=? ORDER BY a.created_at DESC,o.atendimento_id`).all(id)
  return {id,atendimentoId:at,origin:origin ?? null,previous,budgets,orders,complaints,sequences,financialSummary:table(db,'financial_titles') ? experienceReceivables(db,id) : null,warranty:null}
}

function originMetadata(db: DatabaseSync,at: string) {
  new AtendimentoRepository(db).get(at)
  return db.prepare('SELECT origin,channel,previous_experience_id FROM erp_experience_origin WHERE atendimento_id=?').get(at) ?? null
}

export function recordOrigin(db: DatabaseSync,input: Record<string,unknown>) {
  const at = pickText(input.atendimentoId,100,'o Atendimento',true)
  new AtendimentoRepository(db).get(at)
  const channel = optional(input.channel,100,'o canal de aquisição')
  db.prepare(`INSERT INTO erp_experience_origin(atendimento_id,origin,previous_experience_id,channel) VALUES(?,'initial',NULL,?)
    ON CONFLICT(atendimento_id) DO UPDATE SET channel=excluded.channel`).run(at,channel || null)
  return originMetadata(db,at)
}

function listSac(db: DatabaseSync,id: string) {
  const all = 's.id,s.experience_id,s.followup_atendimento_id,s.description,s.author,s.created_at,s.cause,s.resolution,s.resolved_at,s.resolved_by,e.atendimento_id'
  return db.prepare(`SELECT ${all} FROM erp_experience_sac s JOIN production_experiences e ON e.id=s.experience_id
    WHERE (?='' OR s.experience_id=?) ORDER BY s.created_at DESC,s.id LIMIT 100`).all(id,id)
}

function createFollowup(db: DatabaseSync,experienceId: string,at: string,origin: string,channel: string,reason: string,requestId?: string,hash?: string) {
  const repo = new AtendimentoRepository(db)
  const record = repo.get(at,true)
  const next = repo.create({phone:record.phone,name:record.name,vehicle:record.vehicle,model:record.model,brand:record.brand,
    plate:record.plate,reason,purpose:'commercial',...(record.references ? {references:record.references} : {})},true)
  db.prepare(`INSERT INTO erp_experience_origin(atendimento_id,origin,previous_experience_id,channel,request_id,request_hash)
    VALUES(?,?,?,?,?,?)`).run(next.id,origin,experienceId,channel||null,requestId??null,hash??null)
  return next.id
}

function openFollowup(db: DatabaseSync,input: Record<string,unknown>) {
  const key = pickText(input.requestId,100,'o identificador da solicitação',true)
  const id = pickText(input.experienceId,100,'a Experiência anterior',true)
  const reason = pickText(input.reason,8000,'o motivo',true)
  const channel = optional(input.channel,100,'o canal de aquisição')
  const origin = input.origin
  if (origin !== 'rework' && origin !== 'recurrence') return invalid('Classifique a sequência como Recorrência ou Retrabalho.')
  const hash = createHash('sha256').update(JSON.stringify([id,reason,channel,origin])).digest('hex')
  db.exec('BEGIN IMMEDIATE')
  try {
    const previous = db.prepare('SELECT atendimento_id FROM production_experiences WHERE id=?').get(id)
    if (!previous) return missing()
    const existing = db.prepare('SELECT atendimento_id,request_hash FROM erp_experience_origin WHERE request_id=?').get(key)
    if (existing && existing.request_hash !== hash) throw new ServiceError(409,'ERP_FOLLOWUP_CONFLICT','O identificador já foi usado em outra sequência.')
    const atendimentoId = existing ? String(existing.atendimento_id) :
      createFollowup(db,id,String(previous.atendimento_id),origin,channel,reason,key,hash)
    db.exec('COMMIT')
    return {atendimentoId}
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

function openSac(db: DatabaseSync,input: Record<string,unknown>,occurredAt: string) {
  const key = pickText(input.requestId,100,'o identificador da solicitação',true)
  const id = pickText(input.experienceId,100,'a Experiência anterior',true)
  const description = pickText(input.description,8000,'a descrição da reclamação',true)
  const author = pickText(input.author,100,'o responsável',true)
  const origin = optional(input.origin,20,'a origem da sequência')
  if (origin && !['recurrence','rework'].includes(origin)) return invalid('Classifique a sequência como Recorrência ou Retrabalho.')
  const channel = optional(input.channel,100,'o canal de aquisição')
  const hash = createHash('sha256').update(JSON.stringify([id,description,author,origin,channel])).digest('hex')
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = db.prepare('SELECT * FROM erp_experience_sac WHERE id=?').get(key)
    if (existing && existing.request_hash !== hash) throw new ServiceError(409,'ERP_SAC_CONFLICT','O identificador já foi usado em outro registro de SAC.')
    if (!existing) {
      const prior = db.prepare('SELECT atendimento_id FROM production_experiences WHERE id=?').get(id)
      if (!prior) return missing()
      const followup = origin ? createFollowup(db,id,String(prior.atendimento_id),origin,channel,description) : null
      db.prepare(`INSERT INTO erp_experience_sac(id,experience_id,followup_atendimento_id,description,author,created_at,request_hash)
        VALUES(?,?,?,?,?,?,?)`).run(key,id,followup,description,author,occurredAt,hash)
    }
    const result = db.prepare('SELECT id,experience_id,followup_atendimento_id FROM erp_experience_sac WHERE id=?').get(key)
    db.exec('COMMIT')
    return result
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

function resolveSac(db: DatabaseSync,input: Record<string,unknown>,occurredAt: string) {
  const id = pickText(input.id,100,'a reclamação',true)
  const cause = pickText(input.cause,4000,'a causa',true)
  const resolution = pickText(input.resolution,4000,'a resolução',true)
  const author = pickText(input.author,100,'o responsável',true)
  const saved = db.prepare(`UPDATE erp_experience_sac SET cause=?,resolution=?,resolved_by=?,resolved_at=? WHERE id=? AND resolved_at IS NULL
    RETURNING id,experience_id,followup_atendimento_id,cause,resolution,resolved_by,resolved_at`).get(cause,resolution,author,occurredAt,id)
  if (saved) return saved
  const existing = db.prepare('SELECT id,experience_id,followup_atendimento_id,cause,resolution,resolved_by,resolved_at FROM erp_experience_sac WHERE id=?').get(id)
  if (!existing) return missing()
  if (existing.cause !== cause || existing.resolution !== resolution || existing.resolved_by !== author)
    throw new ServiceError(409,'ERP_SAC_RESOLVED','A reclamação já foi resolvida por outra atualização.')
  return existing
}

export function handleExperiences({db,method,path,query,body,now}: ErpRequest): unknown {
  if (method === 'GET') {
    if (path === '/historico') return library(db,query)
    if (path === '/detalhe') return detail(db,pickText(query.get('id'),100,'a Experiência',true))
    if (path === '/sac') return {items:listSac(db,optional(query.get('experienceId'),100,'a Experiência'))}
    if (path === '/origem') return {record:originMetadata(db,pickText(query.get('atendimentoId'),100,'o Atendimento',true))}
    if (path === '/diario') {
      const at = pickText(query.get('atendimentoId'),100,'o Atendimento',true)
      const source = optional(query.get('source'),30,'a origem')
      const related = optional(query.get('relatedId'),100,'o registro relacionado')
      return {items:diary(db,at,source,related),legacyNotes:legacyNotes(db,at,source,related)}
    }
  }
  if (method === 'POST') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Confira os dados da solicitação.')
    const input = body as Record<string,unknown>
    const occurredAt = new Date(now()).toISOString()
    if (path === '/origem') return {record:recordOrigin(db,input)}
    if (path === '/sequencia') return {record:openFollowup(db,input)}
    if (path === '/sac') return {record:openSac(db,input,occurredAt)}
    if (path === '/sac/resolver') return {record:resolveSac(db,input,occurredAt)}
    if (path === '/diario') {
      const at = pickText(input.atendimentoId,100,'o Atendimento',true)
      const source = pickText(input.source,30,'a origem',true) as Context
      if (!contexts.includes(source)) return invalid('Origem da entrada inválida.')
      const experience = source === 'experiencia' ? db.prepare('SELECT id FROM production_experiences WHERE atendimento_id=?').get(at) : null
      const related = optional(input.relatedId,100,'o registro relacionado') || String(experience?.id ?? at)
      verifyContext(db,at,source,related)
      const kind = input.kind === 'note' || input.kind === 'comment' ? input.kind : invalid('Tipo da entrada inválido.')
      const entry = appendExperienceDiary(db,{
        atendimentoId:at,source,sourceId:pickText(input.requestId,100,'o identificador da solicitação',true),
        originType:related,kind,body:pickText(input.body,2000,'o texto',true),author:pickText(input.author,100,'o responsável',true),occurredAt,
        attachments:attachmentList(input.attachments),
      })
      return {record:entry}
    }
  }
  return missing()
}
