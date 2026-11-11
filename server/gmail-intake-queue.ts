import {createHash, randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {GmailQueueAck,GmailQueueClaim,GmailQueueReceipt,GmailQueueState} from '../shared/gmail-intake-queue.ts'
import {ServiceError} from './errors.ts'
import {hasGmailIntakeQueueSchema} from './gmail-intake-queue-schema.ts'

const messagePattern=/^[a-f0-9]{15,25}$/i
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const errorPattern=/^[A-Z][A-Z0-9_]{0,79}$/
const fail=(status:number,code:string,message:string):never=>{throw new ServiceError(status,code,message)}
type QueueRow={message_id:string,state:GmailQueueState,attempts:number,next_attempt_at:string|null,lease_token:string|null,lease_expires_at:string|null,last_receipt_token:string|null,last_receipt_hash:string|null,notice_id:string|null,error_code:string|null}
const map=(r:QueueRow):GmailQueueReceipt=>({messageId:r.message_id,state:r.state,attempts:r.attempts,nextAttemptAt:r.next_attempt_at})
const digest=(v:GmailQueueAck)=>createHash('sha256').update(JSON.stringify({messageId:v.messageId,leaseToken:v.leaseToken,result:v.result,noticeId:v.noticeId,errorCode:v.errorCode})).digest('hex')
export class GmailIntakeQueue {
  private readonly database:DatabaseSync
  private readonly now:()=>number
  constructor(database:DatabaseSync,now:()=>number=Date.now){this.database=database;this.now=now}
  private enabled(){if(!hasGmailIntakeQueueSchema(this.database))fail(503,'GMAIL_QUEUE_DISABLED','Fila de e-mails indisponível.')}
  private one(messageId:string):QueueRow|undefined {return this.database.prepare('SELECT * FROM gmail_intake_queue WHERE message_id=?').get(messageId) as QueueRow|undefined}
  enqueue(messageId:string):GmailQueueReceipt{
    this.enabled()
    if(!messagePattern.test(messageId))fail(400,'GMAIL_QUEUE_INVALID','Identificador inválido.')
    const id=messageId.toLowerCase(),timestamp=new Date(this.now()).toISOString()
    this.database.prepare("INSERT OR IGNORE INTO gmail_intake_queue(message_id,state,attempts,next_attempt_at,created_at,updated_at) VALUES (?,'queued',0,?,?,?)").run(id,timestamp,timestamp,timestamp)
    return map(this.one(id)!)
  }
  claim(limit:number):GmailQueueClaim[]{
    this.enabled()
    if(!Number.isSafeInteger(limit)||limit<1||limit>25)fail(400,'GMAIL_QUEUE_INVALID','Lote inválido.')
    const now=new Date(this.now()).toISOString(),until=new Date(this.now()+120000).toISOString()
    const results:GmailQueueClaim[]=[]
    this.database.exec('BEGIN IMMEDIATE')
    try{
      // A lost worker cannot keep the lease forever. Do not retry after five attempts.
      // SQLite queue has no id; order by stable message key.
      const expiredRows=this.database.prepare("SELECT * FROM gmail_intake_queue WHERE state='leased' AND lease_expires_at<=? ORDER BY lease_expires_at,message_id LIMIT 100").all(now) as QueueRow[]
      for(const x of expiredRows){
        this.database.prepare("UPDATE gmail_intake_queue_attempts SET outcome='expired',finished_at=?,error_code='LEASE_EXPIRED' WHERE message_id=? AND lease_token=? AND outcome='leased'").run(now,x.message_id,x.lease_token)
        const blocked=x.attempts>=5
        this.database.prepare("UPDATE gmail_intake_queue SET state=?,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=?,error_code='LEASE_EXPIRED',updated_at=? WHERE message_id=? AND lease_token=?")
          .run(blocked?'blocked':'retry',blocked?null:now,now,x.message_id,x.lease_token)
      }
      const due=this.database.prepare("SELECT * FROM gmail_intake_queue WHERE state IN ('queued','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,message_id LIMIT ?").all(now,limit) as QueueRow[]
      for(const row of due){
        if(row.attempts>=5)continue
        const token=randomUUID(),attempt=row.attempts+1
        const updated=this.database.prepare("UPDATE gmail_intake_queue SET state='leased',attempts=?,lease_token=?,lease_expires_at=?,next_attempt_at=NULL,updated_at=?,error_code=NULL WHERE message_id=? AND state IN ('queued','retry') AND attempts=?")
          .run(attempt,token,until,now,row.message_id,row.attempts)
        if(updated.changes!==1)continue
        this.database.prepare("INSERT INTO gmail_intake_queue_attempts(message_id,attempt,lease_token,started_at,outcome) VALUES (?,?,?,?,'leased')")
          .run(row.message_id,attempt,token,now)
        results.push({messageId:row.message_id,leaseToken:token,attempt,leaseExpiresAt:until})
      }
      this.database.exec('COMMIT')
      return results
    }catch(e){this.database.exec('ROLLBACK');throw e}
  }
  acknowledge(input:GmailQueueAck):GmailQueueReceipt{
    this.enabled()
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='errorCode,leaseToken,messageId,noticeId,result'||
      typeof input.messageId!=='string'||!messagePattern.test(input.messageId)||
      typeof input.leaseToken!=='string'||!uuidPattern.test(input.leaseToken)||
      !['notified','ignored','retry','blocked'].includes(input.result)||
      (input.result==='notified'&&(typeof input.noticeId!=='string'||!uuidPattern.test(input.noticeId)||input.errorCode!==null))||
      (input.result==='ignored'&&(input.noticeId!==null||input.errorCode!==null))||
      (['retry','blocked'].includes(input.result)&&(input.noticeId!==null||typeof input.errorCode!=='string'||!errorPattern.test(input.errorCode))))
      fail(400,'GMAIL_QUEUE_INVALID','Recibo inválido.')
    const id=input.messageId.toLowerCase(),hash=digest({...input,messageId:id}),now=new Date(this.now()).toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try{
      const row=this.one(id)
      if(!row)fail(404,'GMAIL_QUEUE_NOT_FOUND','Mensagem não encontrada.')
      if(row.last_receipt_token===input.leaseToken){
        if(row.last_receipt_hash!==hash)fail(409,'GMAIL_QUEUE_RECEIPT_CONFLICT','Recibo divergente.')
        this.database.exec('COMMIT');return map(row)
      }
      if(row.state!=='leased'||row.lease_token!==input.leaseToken)fail(409,'GMAIL_QUEUE_STALE','Lease não corresponde à tentativa ativa.')
      if(!row.lease_expires_at||row.lease_expires_at<=now)fail(409,'GMAIL_QUEUE_LEASE_EXPIRED','Lease expirado, requer reconciliação.')
      if(input.result==='notified'){
        const notice=this.database.prepare('SELECT message_id FROM gmail_intake_notices WHERE id=?').get(input.noticeId) as {message_id:string}|undefined
        if(!notice||notice.message_id!==id)fail(409,'GMAIL_QUEUE_NOTICE_MISMATCH','Aviso não corresponde ao e-mail.')
      }
      const terminal=input.result==='notified'||input.result==='ignored'||input.result==='blocked'||row.attempts>=5
      const state:GmailQueueState=!terminal?'retry':(row.attempts>=5&&input.result==='retry'?'blocked':input.result)
      const delay=Math.min(3600000,60000*2**(row.attempts-1))
      const next=terminal?null:new Date(this.now()+delay).toISOString()
      const err=state==='blocked'&&input.result==='retry'?'RETRY_EXHAUSTED':input.errorCode
      this.database.prepare("UPDATE gmail_intake_queue SET state=?,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=?,last_receipt_token=?,last_receipt_hash=?,notice_id=?,error_code=?,updated_at=? WHERE message_id=? AND lease_token=?")
        .run(state,next,input.leaseToken,hash,input.noticeId,err,now,id,input.leaseToken)
      this.database.prepare("UPDATE gmail_intake_queue_attempts SET outcome=?,finished_at=?,error_code=? WHERE message_id=? AND lease_token=? AND outcome='leased'")
        .run(state,now,err,id,input.leaseToken)
      this.database.exec('COMMIT')
      return map(this.one(id)!)
    }catch(e){this.database.exec('ROLLBACK');throw e}
  }
  status(messageId:string):GmailQueueReceipt{
    this.enabled()
    if(!messagePattern.test(messageId))fail(400,'GMAIL_QUEUE_INVALID','Identificador inválido.')
    const row=this.one(messageId.toLowerCase())
    if(!row)fail(404,'GMAIL_QUEUE_NOT_FOUND','Mensagem não encontrada.')
    return map(row)
  }
}
