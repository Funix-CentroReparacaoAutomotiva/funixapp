import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { UpdatePackage, UpdatePackageAction, UpdatePackageDecision, UpdatePackageList, UpdatePackageMissingField, UpdatePackageStatus } from '../shared/update-packages.ts'
import { ServiceError } from './errors.ts'

type Proposal = {
  source: 'gmail' | 'whatsapp' | 'other'
  sourceReference: string
  experienceId: string | null
  plate: string | null
  title: string
  summary: string
  actions: UpdatePackageAction[]
  missingFields: UpdatePackageMissingField[]
}

type PackageRow = {
  id: string; revision: number; snapshot_hash: string; source: Proposal['source']
  source_reference: string; experience_id: string | null; plate: string | null
  title: string; summary: string; status: UpdatePackageStatus
  actions_json: string; missing_fields_json: string
  created_at: string; updated_at: string; decided_at: string | null; decided_by: string | null
}

const fail = (status: number, code: string, detail: string): never => { throw new ServiceError(status, code, detail) }
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:\/-]{0,119}$/
const hashPattern = /^[0-9a-f]{64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function validateText(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max
}

function validateProposal(proposal: Proposal): void {
  if (!proposal || !['gmail','whatsapp','other'].includes(proposal.source)) fail(400, 'PACKAGE_INVALID', 'Origem inválida.')
  if (!validateText(proposal.sourceReference, 180) || !validateText(proposal.title, 200) || !validateText(proposal.summary, 1000)) fail(400, 'PACKAGE_INVALID', 'Dados do pacote inválidos.')
  if (proposal.experienceId !== null && (!validateText(proposal.experienceId, 30) || !/^XP[0-9]{3,8}$/.test(proposal.experienceId))) fail(400, 'PACKAGE_INVALID', 'Experiência inválida.')
  if (proposal.plate !== null && (!validateText(proposal.plate, 10) || !/^[A-Z0-9-]{7,9}$/.test(proposal.plate))) fail(400, 'PACKAGE_INVALID', 'Placa inválida.')
  if (!Array.isArray(proposal.actions) || !proposal.actions.length || proposal.actions.length > 40 || !Array.isArray(proposal.missingFields) || proposal.missingFields.length > 15) fail(400, 'PACKAGE_INVALID', 'Quantidade de alterações inválida.')
  const actionIds = new Set<string>(), missingKeys = new Set<string>()
  for (const action of proposal.actions) {
    if (!action || !validateText(action.id, 100) || !idPattern.test(action.id) || !['drive_archive','erp_update','other'].includes(action.type) || !validateText(action.title, 240) || typeof action.detail !== 'string' || action.detail.length > 1000 || actionIds.has(action.id)) fail(400, 'PACKAGE_INVALID', 'Ação inválida ou repetida.')
    actionIds.add(action.id)
  }
  for (const field of proposal.missingFields) {
    if (!field || !validateText(field.key, 100) || !idPattern.test(field.key) || !validateText(field.label, 160) || typeof field.hint !== 'string' || field.hint.length > 300 || missingKeys.has(field.key)) fail(400, 'PACKAGE_INVALID', 'Pendência inválida ou repetida.')
    missingKeys.add(field.key)
  }
}

const canonical = (p: Proposal): string => JSON.stringify({
  source:p.source,sourceReference:p.sourceReference,experienceId:p.experienceId,plate:p.plate,
  title:p.title,summary:p.summary,actions:p.actions,missingFields:p.missingFields
})
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

function map(row: PackageRow): UpdatePackage {
  return {
    id:row.id, revision:row.revision, snapshotHash:row.snapshot_hash, source:row.source,
    sourceReference:row.source_reference, experienceId:row.experience_id, plate:row.plate,
    title:row.title, summary:row.summary, status:row.status,
    actions:JSON.parse(row.actions_json) as UpdatePackageAction[],
    missingFields:JSON.parse(row.missing_fields_json) as UpdatePackageMissingField[],
    createdAt:row.created_at, updatedAt:row.updated_at, decidedAt:row.decided_at, decidedBy:row.decided_by
  }
}

export class UpdatePackageRepository {
  constructor(private readonly db: DatabaseSync, private readonly now: () => string = () => new Date().toISOString()) {}

  // Internal-only entrypoint: no HTTP route or n8n ingestion is exposed in this increment.
  createProposal(proposal: Proposal, id: string = randomUUID()): UpdatePackage {
    validateProposal(proposal)
    if (!uuidPattern.test(id)) fail(400,'PACKAGE_INVALID','Identificador inválido.')
    const snapshotHash = digest(canonical(proposal)), now = this.now()
    this.db.prepare(`INSERT INTO update_packages
      (id,revision,snapshot_hash,source,source_reference,experience_id,plate,title,summary,status,actions_json,missing_fields_json,created_at,updated_at)
      VALUES (?,1,?,?,?,?,?,?,?,'awaiting_review',?,?,?,?)`).run(
      id,snapshotHash,proposal.source,proposal.sourceReference,proposal.experienceId,proposal.plate,
      proposal.title,proposal.summary,JSON.stringify(proposal.actions),JSON.stringify(proposal.missingFields),now,now
    )
    return this.get(id)
  }

  get(id: string): UpdatePackage {
    if (!uuidPattern.test(id)) fail(404,'PACKAGE_NOT_FOUND','Pacote não localizado.')
    const row = this.db.prepare('SELECT * FROM update_packages WHERE id=?').get(id) as PackageRow | undefined
    if (!row) fail(404,'PACKAGE_NOT_FOUND','Pacote não localizado.')
    return map(row!)
  }

  list(view: 'open' | 'closed', query: string): UpdatePackageList {
    if (!['open','closed'].includes(view) || query.length > 160) fail(400,'PACKAGE_QUERY_INVALID','Filtro inválido.')
    const closed = view === 'closed'
    const rows = this.db.prepare(`SELECT * FROM update_packages WHERE
      ${closed ? "status IN ('executed','rejected')" : "status NOT IN ('executed','rejected')"}
      ORDER BY created_at DESC, id DESC LIMIT 501`).all() as PackageRow[]
    const needle = query.toLocaleLowerCase('pt-BR').trim()
    const filtered = rows.map(map).filter(pkg => !needle || [pkg.title,pkg.summary,pkg.experienceId??'',pkg.plate??'',pkg.source,pkg.sourceReference].some(s=>s.toLocaleLowerCase('pt-BR').includes(needle)))
    return {items:filtered.slice(0,100),total:filtered.length,decisionsEnabled:false}
  }

  decide(id: string, input: UpdatePackageDecision, actor: string): UpdatePackage {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'decision,requestId,revision,snapshotHash' ||
      !Number.isSafeInteger(input.revision) || input.revision < 1 ||
      !hashPattern.test(input.snapshotHash) || !uuidPattern.test(input.requestId) ||
      !['approve','reject'].includes(input.decision)) fail(400,'PACKAGE_DECISION_INVALID','Decisão inválida.')
    if (!validateText(actor,100)) fail(400,'PACKAGE_DECISION_INVALID','Responsável inválido.')
    const current = this.get(id)
    const receipt = this.db.prepare('SELECT decision,revision,snapshot_hash FROM update_package_decisions WHERE package_id=? AND request_id=?').get(id,input.requestId) as {decision:string,revision:number,snapshot_hash:string}|undefined
    if (receipt) {
      if (receipt.decision !== input.decision || receipt.revision !== input.revision || receipt.snapshot_hash !== input.snapshotHash)
        fail(409,'PACKAGE_REQUEST_CONFLICT','Essa chave de decisão já foi utilizada com outros dados.')
      return current
    }
    if (current.status !== 'awaiting_review' || current.revision !== input.revision || current.snapshotHash !== input.snapshotHash)
      fail(409,'PACKAGE_STALE','O pacote foi alterado. Atualize a tela antes de decidir.')
    if (input.decision === 'approve' && current.missingFields.length) fail(422,'PACKAGE_INCOMPLETE','Há informações obrigatórias pendentes.')
    const status: UpdatePackageStatus = input.decision === 'approve' ? 'approved_pending_execution' : 'rejected'
    const now=this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare(`UPDATE update_packages
        SET status=?,revision=revision+1,decided_at=?,decided_by=?,updated_at=?
        WHERE id=? AND status='awaiting_review' AND revision=? AND snapshot_hash=?`)
        .run(status,now,actor,now,id,input.revision,input.snapshotHash)
      if (result.changes !== 1) fail(409,'PACKAGE_STALE','Pacote já decidido.')
      this.db.prepare(`INSERT INTO update_package_decisions(package_id,request_id,decision,revision,snapshot_hash,actor,decided_at)
        VALUES (?,?,?,?,?,?,?)`).run(id,input.requestId,input.decision,input.revision,input.snapshotHash,actor,now)
      this.db.exec('COMMIT')
    } catch(e) {this.db.exec('ROLLBACK');throw e}
    return this.get(id)
  }
}
