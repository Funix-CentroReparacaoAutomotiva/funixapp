import { CustomerRepository } from './customers.ts'
import{initializeFinancialSettings}from'./financial-initialization.ts'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { ATENDIMENTO_STAGES } from '../shared/contracts.ts'
import type { Atendimento, AtendimentoList, AtendimentoStage } from '../shared/contracts.ts'
import { ServiceError } from './errors.ts'

const textLimits = { phone: 100, name: 250, vehicle: 250, brand: 150, model: 250, plate: 100, reason: 8000, notes: 8000, rejectionReason: 2000 } as const
const writable = new Set([...Object.keys(textLimits), 'fabricationYear', 'modelYear', 'stage', 'explicitRefusal', 'references', 'closed'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(message: string): never { throw new ServiceError(400, 'INVALID_ATENDIMENTO', message) }

export function normalizePhone(phone: string): string | null {
  const clean = phone.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(clean) ? clean : null
}

function validate(input: unknown, patch: boolean) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Envie os campos do Atendimento em um objeto JSON.')
  const source = input as Record<string, unknown>
  for (const key of Object.keys(source)) if (!writable.has(key) && !(patch && key === 'revision')) invalid(`Campo não permitido: ${key}.`)
  if (patch && (!Number.isSafeInteger(source.revision) || Number(source.revision) < 1)) invalid('Informe a revisão do Atendimento que está editando.')
  const output: Record<string, string | boolean | number | null> = {}
  for (const [key, limit] of Object.entries(textLimits)) {
    if (source[key] === undefined) continue
    if (typeof source[key] !== 'string' || source[key].length > limit) invalid(`Campo ${key} inválido ou maior que ${limit} caracteres.`)
    output[key] = key === 'plate' ? source[key].trim().toUpperCase() : source[key].trim()
  }
  if(typeof output.phone==='string' && output.phone && !/\d/.test(output.phone))invalid('Telefone informado inválido.')
  for (const key of ['fabricationYear', 'modelYear'] as const) {
    if (source[key] === undefined) continue
    if (source[key] === null) { output[key] = null; continue }
    if (typeof source[key] !== 'string' || (source[key] !== '' && !/^(?:19|20)\d{2}$/.test(source[key] as string))) invalid(`Campo ${key} inválido. Informe um ano de quatro dígitos.`)
    output[key] = source[key] as string
  }
  if (source.stage !== undefined) {
    if (!ATENDIMENTO_STAGES.some(stage => stage.id === source.stage)) invalid('Fase comercial inválida.')
    output.stage = String(source.stage)
  }
  if (source.explicitRefusal !== undefined) {
    if (typeof source.explicitRefusal !== 'boolean') invalid('A confirmação de recusa deve ser verdadeira ou falsa.')
    output.explicitRefusal = source.explicitRefusal
  }
  if(source.closed!==undefined){if(typeof source.closed!=='boolean')invalid('Encerramento inválido.')}
  if (patch && source.closed===undefined && source.references===undefined && !Object.keys(output).length) invalid('Informe ao menos um campo para atualizar.')
  return { fields: output, revision: Number(source.revision), references: source.references, closed: source.closed as boolean|undefined }
}

function map(row: Record<string, SQLOutputValue>): Atendimento {
  return {
    ...(row.closed_at==null?{}:{closedAt:String(row.closed_at)}),
    id: String(row.id), phone: String(row.phone), phoneNormalized: row.phone_normalized === null ? null : String(row.phone_normalized),
    name: String(row.name), vehicle: String(row.vehicle), brand: String(row.brand), model: String(row.model),
    fabricationYear: row.fabrication_year == null ? null : String(row.fabrication_year),
    modelYear: row.model_year == null ? null : String(row.model_year), plate: String(row.plate),
    reason: String(row.reason), notes: String(row.notes), stage: String(row.stage) as AtendimentoStage,
    rejectionReason: String(row.rejection_reason), explicitRefusal: row.explicit_refusal === 1,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), revision: Number(row.revision),
  }
}

function checkRefusal(record: Atendimento) {
  if (record.stage === 'rejeitados' && (!record.explicitRefusal || !record.rejectionReason.trim())) invalid('Para marcar Rejeitados, confirme a recusa explícita e registre o motivo.')
}

export class AtendimentoRepository {
  readonly db: DatabaseSync
  constructor(db: DatabaseSync) { this.db = db }
  // Only used for historical V1 test fixtures. A missing column is a
  // schema mismatch; other SQLite failures must surface unchanged.
  private oldSchema(error: unknown): boolean {
    return error instanceof Error && /no column named fabrication_year|no such column: fabrication_year/.test(error.message)
  }

  ready() { this.db.prepare('SELECT 1 FROM atendimentos LIMIT 1').get() }

  list({ q = '', limit = 50, offset = 0 }: { q?: string; limit?: number; offset?: number } = {}): AtendimentoList {
    if (q.length > 150 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) invalid('Parâmetros de busca inválidos.')
    const escaped = fold(q.trim()).replace(/[\\%_]/g, '\\$&')
    const search = `%${escaped}%`
    const digits = /^[+\d\s().-]+$/.test(q) ? q.replace(/[^\d+]/g, '') : ''
    const where = `(search_text LIKE ? ESCAPE '\\' OR (? != '' AND replace(replace(replace(replace(phone,' ',''),'(',''),')',''),'-','') LIKE ?))`
    const values = [search, digits, `%${digits}%`]
    const total = Number(this.db.prepare(`SELECT count(*) AS total FROM atendimentos WHERE ${where}`).get(...values)!.total)
    const items = this.db.prepare(`SELECT * FROM atendimentos WHERE ${where} ORDER BY updated_at DESC,id ASC LIMIT ? OFFSET ?`).all(...values, limit, offset).map(map)
    return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null, stages: ATENDIMENTO_STAGES }
  }

  get(id: string, includeReferences = false): Atendimento {
    if (!uuid.test(id)) throw new ServiceError(404, 'NOT_FOUND', 'Atendimento não encontrado.')
    const row = this.db.prepare('SELECT * FROM atendimentos WHERE id=?').get(id)
    if (!row) throw new ServiceError(404, 'NOT_FOUND', 'Atendimento não encontrado.')
    const record=map(row)
    const customers=new CustomerRepository(this.db)
    if(includeReferences && customers.available())record.references=customers.references(id)
    return includeReferences ? customers.present([record])[0]! : record
  }

  create(input: unknown, inTransaction = false): Atendimento {
    const { fields, references, closed } = validate(input, false)
    const customers=new CustomerRepository(this.db),refs=references===undefined?undefined:customers.validate(references)
    if(refs)Object.assign(fields,customers.primaryFields(refs))
    const now = new Date().toISOString()
    const record: Atendimento = { id: randomUUID(), phone: '', phoneNormalized: null, name: '', vehicle: '', brand: '', model: '', fabricationYear: null, modelYear: null, plate: '', reason: '', notes: '', stage: 'novo-lead', rejectionReason: '', explicitRefusal: false, createdAt: now, updatedAt: now, revision: 1, ...fields }
    record.phoneNormalized = normalizePhone(record.phone)
    checkRefusal(record)
    if (!inTransaction) this.db.exec('BEGIN IMMEDIATE')
    try{
    try {
      this.db.prepare(`INSERT INTO atendimentos(id,phone,phone_normalized,name,vehicle,brand,model,fabrication_year,model_year,plate,reason,notes,search_text,stage,rejection_reason,explicit_refusal,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.id, record.phone, record.phoneNormalized, record.name, record.vehicle, record.brand, record.model, record.fabricationYear, record.modelYear, record.plate, record.reason, record.notes, searchText(record), record.stage, record.rejectionReason, record.explicitRefusal ? 1 : 0, now, now, 1)
    } catch(error) {
      if(!this.oldSchema(error)) throw error
      if(record.fabricationYear!==null && record.fabricationYear!=='' || record.modelYear!==null && record.modelYear!=='') invalid('Banco antigo não aceita anos independentes; migração necessária.')
      this.db.prepare(`INSERT INTO atendimentos(id,phone,phone_normalized,name,vehicle,brand,model,plate,reason,notes,search_text,stage,rejection_reason,explicit_refusal,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.id, record.phone, record.phoneNormalized, record.name, record.vehicle, record.brand, record.model, record.plate, record.reason, record.notes, searchText(record), record.stage, record.rejectionReason, record.explicitRefusal ? 1 : 0, now, now, 1)
    }
      if(this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='pricing_configuration'").get())initializeFinancialSettings(this.db,record.id,true)
      if(closed!==undefined)this.db.prepare('UPDATE atendimentos SET closed_at=? WHERE id=?').run(closed?now:null,record.id)
      if(refs)customers.saveReferences(record.id,refs)
      if (!inTransaction) this.db.exec('COMMIT')
    }catch(error){if (!inTransaction) this.db.exec('ROLLBACK');throw error}
    return this.get(record.id)
  }

  update(id: string, input: unknown): Atendimento {
    this.db.exec('BEGIN IMMEDIATE')
    try {const result=this.updateRecord(id,input);this.db.exec('COMMIT');return result}
    catch(error){this.db.exec('ROLLBACK');throw error}
  }
  private updateRecord(id: string, input: unknown): Atendimento {
    const { fields, revision, references, closed } = validate(input, true)
    const customers=new CustomerRepository(this.db),refs=references===undefined?undefined:customers.validate(references)
    const old = this.get(id)
    if(refs)Object.assign(fields,customers.primaryFields(refs,old))
    const record: Atendimento = { ...old, ...fields, revision: revision + 1, updatedAt: new Date().toISOString() }
    record.phoneNormalized = normalizePhone(record.phone)
    checkRefusal(record)
    let result
    try {
      result = this.db.prepare(`UPDATE atendimentos SET phone=?,phone_normalized=?,name=?,vehicle=?,brand=?,model=?,fabrication_year=?,model_year=?,plate=?,reason=?,notes=?,search_text=?,stage=?,rejection_reason=?,explicit_refusal=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?`).run(record.phone, record.phoneNormalized, record.name, record.vehicle, record.brand, record.model, record.fabricationYear, record.modelYear, record.plate, record.reason, record.notes, searchText(record), record.stage, record.rejectionReason, record.explicitRefusal ? 1 : 0, record.updatedAt, id, revision)
    } catch(error) {
      if(!this.oldSchema(error)) throw error
      if(fields.fabricationYear!==undefined || fields.modelYear!==undefined) invalid('Banco antigo não aceita anos independentes; migração necessária.')
      result = this.db.prepare(`UPDATE atendimentos SET phone=?,phone_normalized=?,name=?,vehicle=?,brand=?,model=?,plate=?,reason=?,notes=?,search_text=?,stage=?,rejection_reason=?,explicit_refusal=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?`).run(record.phone, record.phoneNormalized, record.name, record.vehicle, record.brand, record.model, record.plate, record.reason, record.notes, searchText(record), record.stage, record.rejectionReason, record.explicitRefusal ? 1 : 0, record.updatedAt, id, revision)
    }
    if (!result.changes) throw new ServiceError(409, 'VERSION_CONFLICT', 'Este Atendimento mudou em outra edição. Reabra o registro antes de salvar novamente; seus campos não foram gravados.')
    if(closed!==undefined)this.db.prepare('UPDATE atendimentos SET closed_at=? WHERE id=?').run(closed?record.updatedAt:null,id)
    if(refs)customers.saveReferences(id,refs)
    else if(customers.available())customers.applyLegacyFields(id,fields)
    return this.get(id)
  }
}

function fold(text: string) { return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR') }
function searchText(record: Atendimento) { return fold([record.id, record.phone, record.name, record.vehicle, record.brand, record.model, record.plate].join('\n')) }
