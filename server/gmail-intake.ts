import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  GmailIntakeDecisionInput, GmailIntakeNotice, GmailIntakeNoticeInput,
  GmailIntakeNoticeList, GmailIntakeStatus
} from '../shared/gmail-intake.ts'
import { ServiceError } from './errors.ts'
import { hasGmailIntakeSchema } from './gmail-intake-schema.ts'

const fail = (status: number, code: string, message: string): never => {
  throw new ServiceError(status,code,message)
}
const idPattern = /^[a-f0-9]{15,25}$/i
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hashPattern = /^[a-f0-9]{64}$/
const platePattern = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/
const xpPattern = /^XP[0-9]{3,8}$/
const text = (v: unknown,max: number): v is string => typeof v==='string' && v.trim().length>0 && v.length<=max
const isoNow = () => new Date().toISOString()

type Row = {
  id: string
  message_id: string
  revision: number
  snapshot_hash: string
  title: string
  summary: string
  relevance: 'relevant'|'uncertain'
  reason: string
  plate_hint: string|null
  xp_hint: string|null
  status: GmailIntakeStatus
  created_at: string
  decided_at: string|null
  decided_by: string|null
}
function mapped(r: Row): GmailIntakeNotice {
  return {
    id:r.id,messageId:r.message_id,revision:r.revision,snapshotHash:r.snapshot_hash,
    title:r.title,summary:r.summary,relevance:r.relevance,reason:r.reason,
    plateHint:r.plate_hint,xpHint:r.xp_hint,status:r.status,createdAt:r.created_at,
    decidedAt:r.decided_at,decidedBy:r.decided_by
  }
}
function validated(input: GmailIntakeNoticeInput): GmailIntakeNoticeInput {
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).sort().join(',')!=='messageId,plateHint,reason,relevance,summary,title,xpHint'||
    typeof input.messageId!=='string'||!idPattern.test(input.messageId)||
    !text(input.title,200)||!text(input.summary,1000)||!text(input.reason,100)||
    !['relevant','uncertain'].includes(input.relevance)||
    (input.plateHint!==null && (typeof input.plateHint!=='string'||!platePattern.test(input.plateHint)))||
    (input.xpHint!==null && (typeof input.xpHint!=='string'||!xpPattern.test(input.xpHint))))
    fail(400,'GMAIL_INTAKE_INVALID','Aviso de e-mail inválido.')
  return input
}
function signature(input: GmailIntakeNoticeInput): string {
  return createHash('sha256').update(JSON.stringify({
    messageId:input.messageId,title:input.title,summary:input.summary,
    relevance:input.relevance,reason:input.reason,plateHint:input.plateHint,xpHint:input.xpHint
  })).digest('hex')
}

/** Intake authorization is a different domain from approving a package of changes. */
export class GmailIntakeRepository {
  private readonly db: DatabaseSync
  private readonly now: () => string
  constructor(db: DatabaseSync,now: () => string = isoNow) {this.db=db;this.now=now}
  ingest(input:GmailIntakeNoticeInput):GmailIntakeNotice {
    if(!hasGmailIntakeSchema(this.db))fail(503,'GMAIL_INTAKE_DISABLED','Fila de e-mails desabilitada.')
    const payload=validated(input),hash=signature(payload)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing=this.db.prepare('SELECT * FROM gmail_intake_notices WHERE message_id=?').get(payload.messageId) as Row|undefined
      if(existing){
        if(existing.snapshot_hash!==hash)fail(409,'GMAIL_INTAKE_CONFLICT','E-mail já registrado com outro conteúdo.')
        this.db.exec('COMMIT')
        return mapped(existing)
      }
      const id=randomUUID(),timestamp=this.now()
      this.db.prepare(
        "INSERT INTO gmail_intake_notices " +
        "(id,message_id,revision,snapshot_hash,title,summary,relevance,reason,plate_hint,xp_hint,status,created_at) " +
        "VALUES (?,?,1,?,?,?,?,?,?,?,'awaiting_authorization',?)"
      ).run(id,payload.messageId,hash,payload.title,payload.summary,payload.relevance,
        payload.reason,payload.plateHint,payload.xpHint,timestamp)
      const created=this.get(id)
      this.db.exec('COMMIT')
      return created
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  get(id:string):GmailIntakeNotice {
    if(!hasGmailIntakeSchema(this.db))fail(503,'GMAIL_INTAKE_DISABLED','Fila de e-mails desabilitada.')
    if(!uuidPattern.test(id))fail(404,'GMAIL_INTAKE_NOT_FOUND','Aviso não encontrado.')
    const row=this.db.prepare('SELECT * FROM gmail_intake_notices WHERE id=?').get(id) as Row|undefined
    if(!row)fail(404,'GMAIL_INTAKE_NOT_FOUND','Aviso não encontrado.')
    return mapped(row!)
  }
  list(view:'open'|'closed'):GmailIntakeNoticeList {
    if(!['open','closed'].includes(view))fail(400,'GMAIL_INTAKE_QUERY_INVALID','Filtro inválido.')
    if(!hasGmailIntakeSchema(this.db))return {items:[],total:0,decisionsEnabled:false}
    const state=view==='open'?'awaiting_authorization':undefined
    const where=state?'WHERE status=?':'WHERE status != ?'
    const status=state??'awaiting_authorization'
    const total=(this.db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_notices '+where).get(status) as {n:number}).n
    const rows=this.db.prepare('SELECT * FROM gmail_intake_notices '+where+
      ' ORDER BY created_at DESC,id DESC LIMIT 100').all(status) as Row[]
    return {items:rows.map(mapped),total,decisionsEnabled:false}
  }
  decide(id:string,input:GmailIntakeDecisionInput,actor:string):GmailIntakeNotice {
    if(!hasGmailIntakeSchema(this.db))fail(503,'GMAIL_INTAKE_DISABLED','Fila de e-mails desabilitada.')
    if(!uuidPattern.test(id) || !input || typeof input!=='object'||Array.isArray(input)||
      Object.keys(input).sort().join(',')!=='decision,requestId,revision,snapshotHash'||
      !['authorize','deny'].includes(input.decision) ||
      !Number.isSafeInteger(input.revision)||input.revision<1||
      typeof input.snapshotHash!=='string'||!hashPattern.test(input.snapshotHash)||
      typeof input.requestId!=='string'||!uuidPattern.test(input.requestId)||
      !text(actor,100))
      fail(400,'GMAIL_INTAKE_DECISION_INVALID','Decisão inválida.')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const current=this.get(id)
      const receipt=this.db.prepare('SELECT decision,revision,snapshot_hash FROM gmail_intake_decisions WHERE notice_id=? AND request_id=?')
        .get(id,input.requestId) as {decision:string,revision:number,snapshot_hash:string}|undefined
      if(receipt){
        if(receipt.decision!==input.decision||receipt.revision!==input.revision||receipt.snapshot_hash!==input.snapshotHash)
          fail(409,'GMAIL_INTAKE_REQUEST_CONFLICT','Chave de decisão utilizada com outros dados.')
        this.db.exec('COMMIT')
        return current
      }
      if(current.status!=='awaiting_authorization'||current.revision!==input.revision||current.snapshotHash!==input.snapshotHash)
        fail(409,'GMAIL_INTAKE_STALE','Aviso alterado; atualize a tela antes de decidir.')
      const timestamp=this.now()
      const status: GmailIntakeStatus=input.decision==='authorize'?'authorized':'denied'
      const result=this.db.prepare(
        "UPDATE gmail_intake_notices SET status=?,revision=revision+1,decided_at=?,decided_by=? " +
        "WHERE id=? AND status='awaiting_authorization' AND revision=? AND snapshot_hash=?"
      ).run(status,timestamp,actor,id,input.revision,input.snapshotHash)
      if(result.changes!==1)fail(409,'GMAIL_INTAKE_STALE','Aviso já decidido.')
      this.db.prepare(
        'INSERT INTO gmail_intake_decisions(notice_id,request_id,decision,revision,snapshot_hash,actor,decided_at) VALUES (?,?,?,?,?,?,?)'
      ).run(id,input.requestId,input.decision,input.revision,input.snapshotHash,actor,timestamp)
      const decided=this.get(id)
      this.db.exec('COMMIT')
      return decided
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
}
