import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { UpdatePackage, UpdatePackageAction, UpdatePackageMissingField, UpdatePackageDecision, UpdatePackageList, UpdatePackageStatus, UpdatePackageIngest, UpdatePackageClarification, UpdatePackageProposal } from '../shared/update-packages.ts'
import { ServiceError } from './errors.ts'
import { hasUpdatePackageSchema } from './update-packages-schema.ts'

type Proposal = UpdatePackageProposal

type PackageRow = {
  id: string; revision: number; snapshot_hash: string; source: Proposal['source']
  source_reference: string; experience_id: string | null; plate: string | null
  title: string; summary: string; status: UpdatePackageStatus
  actions_json: string; missing_fields_json: string
  created_at: string; updated_at: string; decided_at: string | null; decided_by: string | null
  clarification_pending?: number
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
    if (!action || typeof action!=='object' || Array.isArray(action) || Object.keys(action).sort().join(',')!=='detail,id,title,type' || !validateText(action.id, 100) || !idPattern.test(action.id) || !['drive_archive','erp_update','other'].includes(action.type) || !validateText(action.title, 240) || typeof action.detail !== 'string' || action.detail.length > 1000 || actionIds.has(action.id)) fail(400, 'PACKAGE_INVALID', 'Ação inválida ou repetida.')
    actionIds.add(action.id)
  }
  for (const field of proposal.missingFields) {
    if (!field || typeof field!=='object' || Array.isArray(field) || Object.keys(field).sort().join(',')!==(field.options===undefined?'hint,key,label':'hint,key,label,options') || !validateText(field.key, 100) || !idPattern.test(field.key) || !validateText(field.label, 160) || typeof field.hint !== 'string' || field.hint.length > 300 || missingKeys.has(field.key)) fail(400, 'PACKAGE_INVALID', 'Pendência inválida ou repetida.')
    if (field.options !== undefined && (!Array.isArray(field.options) || field.options.length<1 || field.options.length>20 ||
      new Set(field.options.map(x=>x?.value)).size!==field.options.length ||
      field.options.some(x=>!x || typeof x!=='object' || Array.isArray(x) || Object.keys(x).sort().join(',')!=='label,value' || !validateText(x.value,100) || !validateText(x.label,180)))) fail(400,'PACKAGE_INVALID','Opções de pendência inválidas.')
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
    createdAt:row.created_at, updatedAt:row.updated_at, decidedAt:row.decided_at, decidedBy:row.decided_by,
    clarificationPending:Boolean(row.clarification_pending)
  }
}

export class UpdatePackageRepository {
  private readonly db: DatabaseSync
  private readonly now: () => string
  constructor(db: DatabaseSync, now: () => string = () => new Date().toISOString()) { this.db=db; this.now=now }

  // Internal-only entrypoint: no HTTP route or n8n ingestion is exposed in this increment.
  createProposal(proposal: Proposal, id: string = randomUUID()): UpdatePackage {
    if (!hasUpdatePackageSchema(this.db)) fail(503,'PACKAGE_STORAGE_DISABLED','Armazenamento de pacotes desativado.')
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
    if (!hasUpdatePackageSchema(this.db)) fail(503,'PACKAGE_STORAGE_DISABLED','Armazenamento de pacotes desativado.')
    if (!uuidPattern.test(id)) fail(404,'PACKAGE_NOT_FOUND','Pacote não localizado.')
    const row = this.db.prepare(`SELECT p.*, EXISTS(SELECT 1 FROM update_package_clarifications c WHERE c.package_id=p.id) AS clarification_pending
      FROM update_packages p WHERE p.id=?`).get(id) as PackageRow | undefined
    if (!row) fail(404,'PACKAGE_NOT_FOUND','Pacote não localizado.')
    return map(row!)
  }

  list(view: 'open' | 'closed', query: string): UpdatePackageList {
    if (!['open','closed'].includes(view) || query.length > 160) fail(400,'PACKAGE_QUERY_INVALID','Filtro inválido.')
    if (!hasUpdatePackageSchema(this.db)) return {items:[],total:0,decisionsEnabled:false,clarificationsEnabled:false}
    const closed = view === 'closed'
    const rows = this.db.prepare(`SELECT p.*, EXISTS(SELECT 1 FROM update_package_clarifications c WHERE c.package_id=p.id) AS clarification_pending FROM update_packages p WHERE
      ${closed ? "status IN ('executed','rejected','superseded')" : "status NOT IN ('executed','rejected','superseded')"}
      ORDER BY created_at DESC, id DESC LIMIT 501`).all() as PackageRow[]
    const needle = query.toLocaleLowerCase('pt-BR').trim()
    const filtered = rows.map(map).filter(pkg => !needle || [pkg.title,pkg.summary,pkg.experienceId??'',pkg.plate??'',pkg.source,pkg.sourceReference].some(s=>s.toLocaleLowerCase('pt-BR').includes(needle)))
    return {items:filtered.slice(0,100),total:filtered.length,decisionsEnabled:false,clarificationsEnabled:false}
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
    if (input.decision === 'approve' && (current.missingFields.length || current.clarificationPending)) fail(422,'PACKAGE_INCOMPLETE','Há informações obrigatórias pendentes.')
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
  ingest(input: UpdatePackageIngest): UpdatePackage {
    if (!hasUpdatePackageSchema(this.db)) fail(503,'PACKAGE_STORAGE_DISABLED','Armazenamento desabilitado.')
    if (!input || typeof input!=='object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',')!=='eventKey,proposal' ||
      !validateText(input.eventKey,120) || !idPattern.test(input.eventKey) ||
      !input.proposal || typeof input.proposal!=='object' || Array.isArray(input.proposal) ||
      Object.keys(input.proposal).sort().join(',')!=='actions,experienceId,missingFields,plate,source,sourceReference,summary,title')
      fail(400,'PACKAGE_EVENT_INVALID','Evento de proposta inválido.')
    validateProposal(input.proposal)
    const verification=input.replaces
    if(verification!==undefined){
      if(!verification || typeof verification!=='object' || Array.isArray(verification) ||
        Object.keys(verification).sort().join(',')!=='clarificationRequestId,codaRowId,parentPackageId,verifiedExperienceId,verifiedPlate' ||
        !uuidPattern.test(verification.parentPackageId) || !uuidPattern.test(verification.clarificationRequestId) ||
        !validateText(verification.codaRowId,80) || !/^i-[a-zA-Z0-9_-]{5,60}$/.test(verification.codaRowId) ||
        !/^XP[0-9]{3,8}$/.test(verification.verifiedExperienceId) ||
        !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(verification.verifiedPlate))
        fail(400,'PACKAGE_REVERIFICATION_INVALID','Vínculo revalidado inválido.')
      if(input.proposal.experienceId!==verification.verifiedExperienceId || input.proposal.plate!==verification.verifiedPlate ||
        input.proposal.missingFields.length!==0)
        fail(409,'PACKAGE_REVERIFICATION_MISMATCH','Proposta revalidada não corresponde à identificação.')
    }
    const payloadHash=digest(canonical(input.proposal)+JSON.stringify(verification??null))
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing=this.db.prepare('SELECT package_id,payload_hash FROM update_package_ingest_events WHERE event_key=?').get(input.eventKey) as {package_id:string,payload_hash:string}|undefined
      if(existing){
        if(existing.payload_hash!==payloadHash) fail(409,'PACKAGE_EVENT_CONFLICT','Evento já usado para outra proposta.')
        const result=this.get(existing.package_id)
        this.db.exec('COMMIT')
        return result
      }
      let parent:UpdatePackage|undefined
      if(verification){
        parent=this.get(verification.parentPackageId)
        if(parent.status!=='awaiting_review' || !parent.clarificationPending ||
          parent.source!==input.proposal.source || parent.sourceReference!==input.proposal.sourceReference ||
          parent.missingFields.length!==1 || parent.missingFields[0]?.key!=='experienceId' ||
          parent.plate!==input.proposal.plate ||
          parent.actions.length!==input.proposal.actions.length ||
          parent.actions.some((a,i)=>JSON.stringify(a)!==JSON.stringify(input.proposal.actions[i])))
          fail(409,'PACKAGE_REVERIFICATION_MISMATCH','A proposta não corresponde ao pacote pendente.')
        const clarification=this.db.prepare('SELECT request_id,revision,snapshot_hash,answers_json FROM update_package_clarifications WHERE package_id=?')
          .get(parent.id) as {request_id:string,revision:number,snapshot_hash:string,answers_json:string}|undefined
        if(!clarification || clarification.request_id!==verification.clarificationRequestId ||
          clarification.revision!==parent.revision || clarification.snapshot_hash!==parent.snapshotHash ||
          (JSON.parse(clarification.answers_json) as {experienceId?:string}).experienceId!==verification.verifiedExperienceId)
          fail(409,'PACKAGE_REVERIFICATION_MISMATCH','A resposta humana não corresponde à experiência conferida.')
      }
      const created=this.createProposal(input.proposal)
      this.db.prepare('INSERT INTO update_package_ingest_events(event_key,package_id,payload_hash,created_at) VALUES (?,?,?,?)').run(input.eventKey,created.id,payloadHash,this.now())
      if(parent && verification){
        const changed=this.db.prepare("UPDATE update_packages SET status='superseded',updated_at=?,revision=revision+1 WHERE id=? AND status='awaiting_review' AND revision=? AND snapshot_hash=?")
          .run(this.now(),parent.id,parent.revision,parent.snapshotHash)
        if(changed.changes!==1)fail(409,'PACKAGE_STALE','Pacote original foi alterado.')
        this.db.prepare(`INSERT INTO update_package_revisions
          (previous_package_id,new_package_id,event_key,clarification_request_id,coda_row_id,verified_experience_id,verified_plate,revised_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(parent.id,created.id,input.eventKey,verification.clarificationRequestId,
          verification.codaRowId,verification.verifiedExperienceId,verification.verifiedPlate,this.now())
      }
      this.db.exec('COMMIT')
      return created
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }

  submitClarification(id:string, input:UpdatePackageClarification, actor:string):UpdatePackage {
    if(!input || typeof input!=='object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',')!=='answers,requestId,revision,snapshotHash' ||
      !Number.isSafeInteger(input.revision) || input.revision<1 ||
      !hashPattern.test(input.snapshotHash) || !uuidPattern.test(input.requestId) ||
      !input.answers || typeof input.answers!=='object' || Array.isArray(input.answers) ||
      !validateText(actor,100)) fail(400,'PACKAGE_CLARIFICATION_INVALID','Resposta inválida.')
    const current=this.get(id)
    const answers=input.answers
    const keys=Object.keys(answers).sort()
    const required=current.missingFields.map(f=>f.key).sort()
    if(keys.length!==required.length || !required.every((k,i)=>k===keys[i])) fail(400,'PACKAGE_CLARIFICATION_INVALID','Responda todos os campos obrigatórios.')
    for(const f of current.missingFields){
      const answer=answers[f.key]
      if(!validateText(answer,250) || (f.options && !f.options.some(option=>option.value===answer)))
        fail(400,'PACKAGE_CLARIFICATION_INVALID','Informação não reconhecida.')
    }
    const previous=this.db.prepare('SELECT request_id,revision,snapshot_hash,answers_json FROM update_package_clarifications WHERE package_id=?').get(id) as
      {request_id:string,revision:number,snapshot_hash:string,answers_json:string}|undefined
    if(previous){
      if(previous.request_id===input.requestId && previous.revision===input.revision &&
        previous.snapshot_hash===input.snapshotHash && previous.answers_json===JSON.stringify(answers))return current
      fail(409,'PACKAGE_CLARIFICATION_EXISTS','Já existe uma resposta aguardando revalidação.')
    }
    if(current.status!=='awaiting_review' || current.revision!==input.revision ||
      current.snapshotHash!==input.snapshotHash || !current.missingFields.length)
      fail(409,'PACKAGE_STALE','A proposta mudou. Atualize antes de responder.')
    const now=this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const saved=this.db.prepare(`INSERT INTO update_package_clarifications
        (package_id,request_id,revision,snapshot_hash,answers_json,actor,submitted_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS
        (SELECT 1 FROM update_packages WHERE id=? AND revision=? AND snapshot_hash=? AND status='awaiting_review')`)
        .run(id,input.requestId,input.revision,input.snapshotHash,JSON.stringify(answers),actor,now,id,input.revision,input.snapshotHash)
      if(saved.changes!==1)fail(409,'PACKAGE_STALE','A proposta mudou.')
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
    return this.get(id)
  }

}
