import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {GmailAnalysis,GmailAnalysisResult,GmailExtraction} from '../shared/gmail-analysis.ts'
import type {GmailIntakeNotice,GmailIntakeDecisionInput} from '../shared/gmail-intake.ts'
import {GmailIntakeRepository} from './gmail-intake.ts'
import {UpdatePackageRepository} from './update-packages.ts'
import {hasGmailAnalysisSchema} from './gmail-analysis-schema.ts'
import {analysisError,analysisHash,buildAnalysisProposal,contextQuery,validateAnalysisMessage,validateContext,validateExtraction} from './gmail-analysis-contract.ts'
import type {GmailAnalysisProviders} from './gmail-analysis-contract.ts'

import {bindGmailPilot,eligibleGmailPilot,hasBoundGmailPilot,requireGmailPilot} from './gmail-analysis-pilot.ts'
import type {GmailPilotScope} from './gmail-analysis-pilot.ts'

type Job={notice_id:string,authorized_revision:number,authorized_hash:string,state:GmailAnalysis['state'],generation:number,attempts:number,lease_token:string|null,lease_expires_at:string|null,next_attempt_at:string|null,error_code:string|null,extraction_json:string|null,package_id:string|null,prior_package_id:string|null,updated_at:string}
export class GmailAnalysisService{
 private readonly db:DatabaseSync
 private readonly providers:GmailAnalysisProviders
 private readonly now:()=>number
 private readonly notices:GmailIntakeRepository
 private readonly packages:UpdatePackageRepository
 private readonly scope?:Readonly<GmailPilotScope>
 private stopping=false
 private running:Promise<void>|undefined
 private timer:ReturnType<typeof setInterval>|undefined
 private controller:AbortController|undefined
 constructor(db:DatabaseSync,providers:GmailAnalysisProviders,now:()=>number=Date.now,scope?:GmailPilotScope){
  if(!hasGmailAnalysisSchema(db))analysisError('GMAIL_ANALYSIS_DISABLED',503)
  if(!scope&&hasBoundGmailPilot(db))throw Error('GMAIL_ANALYSIS_PILOT_SCOPE_REQUIRED')
  this.scope=scope?bindGmailPilot(db,scope):undefined
  this.db=db;this.providers=providers;this.now=now
  this.notices=new GmailIntakeRepository(db);this.packages=new UpdatePackageRepository(db)
 }
 private stamp(){return new Date(this.now()).toISOString()}
 private transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result}catch(e){this.db.exec('ROLLBACK');throw e}}
 private job(id:string){return this.db.prepare('SELECT * FROM gmail_analysis_jobs WHERE notice_id=?').get(id) as Job|undefined}
 isEligible(id:string){return this.scope?eligibleGmailPilot(this.db,this.scope,this.notices.get(id)):!hasBoundGmailPilot(this.db)}
 scopeStatus(){return this.scope?{mode:'real-pilot' as const,noticeId:this.scope.noticeId,activatedAt:this.scope.activatedAt,configurationHash:this.scope.configurationHash,valid:this.isEligible(this.scope.noticeId),authorized:this.notices.get(this.scope.noticeId).status==='authorized'}:{mode:'synthetic' as const}}
 private authorized(id:string,job?:Job):GmailIntakeNotice{
  const notice=this.notices.get(id)
  if(this.scope)requireGmailPilot(this.db,this.scope,notice)
  else if(hasBoundGmailPilot(this.db))analysisError('GMAIL_ANALYSIS_NOT_ELIGIBLE',403)
  if(notice.status!=='authorized'||(job&&(job.authorized_revision!==notice.revision||job.authorized_hash!==notice.snapshotHash)))analysisError('GMAIL_ANALYSIS_NOT_AUTHORIZED',403)
  return notice
 }
 schedule(id:string){
  const notice=this.authorized(id),stamp=this.stamp()
  this.db.prepare("INSERT OR IGNORE INTO gmail_analysis_jobs(notice_id,authorized_revision,authorized_hash,state,created_at,updated_at) VALUES (?,?,?,'queued',?,?)").run(id,notice.revision,notice.snapshotHash,stamp,stamp)
  return this.get(id)
 }
 /** Repairs the decision→job boundary after a crash without revisiting denied notices. */
 recoverAuthorized(){
  if(this.scope?!this.isEligible(this.scope.noticeId):hasBoundGmailPilot(this.db))return
  this.db.prepare(`INSERT OR IGNORE INTO gmail_analysis_jobs(notice_id,authorized_revision,authorized_hash,state,created_at,updated_at)
   SELECT id,revision,snapshot_hash,'queued',?,? FROM gmail_intake_notices WHERE status='authorized'
   AND (? IS NULL OR (id=? AND created_at>=? AND decided_at>=?))`).run(this.stamp(),this.stamp(),this.scope?.noticeId??null,this.scope?.noticeId??null,this.scope?.activatedAt??null,this.scope?.activatedAt??null)
  this.db.prepare(`UPDATE gmail_analysis_jobs SET state='ready',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,error_code=NULL,
   generation=(SELECT a.generation FROM gmail_analysis_proposals a WHERE a.package_id=gmail_analysis_jobs.package_id),prior_package_id=NULL,updated_at=?
   WHERE (? IS NULL OR notice_id=?) AND prior_package_id IS NOT NULL AND EXISTS(SELECT 1 FROM update_packages p WHERE p.id=gmail_analysis_jobs.package_id AND p.status IN ('rejected','approved_pending_execution'))`).run(this.stamp(),this.scope?.noticeId??null,this.scope?.noticeId??null)
  const pending=this.db.prepare("SELECT j.package_id FROM gmail_analysis_jobs j JOIN update_package_clarifications c ON c.package_id=j.package_id JOIN update_packages p ON p.id=j.package_id AND p.status='awaiting_review' WHERE j.state IN ('ready','needs_information') AND (? IS NULL OR j.notice_id=?)").all(this.scope?.noticeId??null,this.scope?.noticeId??null) as {package_id:string}[]
  for(const row of pending)this.revise(row.package_id)
 }
 get(id:string):GmailAnalysis|null{
  const row=this.job(id);if(!row)return null
  let result:GmailAnalysisResult|null=null
  if(row.package_id){
   const stored=this.db.prepare('SELECT result_json,result_hash FROM gmail_analysis_proposals WHERE package_id=?').get(row.package_id) as {result_json:string,result_hash:string}|undefined
   if(stored){result=JSON.parse(stored.result_json) as GmailAnalysisResult;if(analysisHash(result)!==stored.result_hash)analysisError('GMAIL_ANALYSIS_SNAPSHOT_INVALID',503)}
  }
  return {noticeId:id,state:row.state,attempts:row.attempts,errorCode:row.error_code,nextAttemptAt:row.next_attempt_at,generation:row.generation,updatedAt:row.updated_at,result,proposal:row.package_id?this.packages.get(row.package_id):null}
 }
 list(ids?:string[]){return {enabled:true,items:(ids?ids.map(notice_id=>({notice_id})):(this.db.prepare('SELECT notice_id FROM gmail_analysis_jobs ORDER BY updated_at DESC LIMIT 100').all() as {notice_id:string}[])).map(r=>this.get(r.notice_id)).filter((a):a is GmailAnalysis=>a!==null)} }
 listNotices(view:'open'|'closed'|'all',query:string){
  const pending="(n.status='awaiting_authorization' OR (n.status='authorized' AND (j.state IN ('queued','processing','failed') OR p.status='awaiting_review')))"
  const rows=this.db.prepare(`SELECT n.id FROM gmail_intake_notices n LEFT JOIN gmail_analysis_jobs j ON j.notice_id=n.id
   LEFT JOIN update_packages p ON p.id=j.package_id LEFT JOIN gmail_analysis_proposals a ON a.package_id=p.id
   WHERE ${view==='all'?'1=1':view==='open'?pending:'NOT '+pending}
   AND instr(lower(n.title||' '||n.summary||' '||COALESCE(a.result_json,'')),lower(?))>0 ORDER BY n.created_at DESC,n.id DESC`).all(query.trim()) as {id:string}[]
  return {items:rows.slice(0,100).map(r=>this.notices.get(r.id)),total:rows.length,decisionsEnabled:false}
 }
 retry(id:string,input:Pick<GmailIntakeDecisionInput,'requestId'|'revision'|'snapshotHash'>,actor:string){
  const notice=this.authorized(id)
  if(!input||Object.keys(input).sort().join(',')!=='requestId,revision,snapshotHash'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId)||input.revision!==notice.revision||input.snapshotHash!==notice.snapshotHash)analysisError('GMAIL_ANALYSIS_STALE',409)
  this.schedule(id)
  this.transaction(()=>{
   const previous=this.db.prepare('SELECT payload_hash FROM gmail_analysis_commands WHERE notice_id=? AND request_id=?').get(id,input.requestId) as {payload_hash:string}|undefined
   const hash=analysisHash(input)
   if(previous){if(previous.payload_hash!==hash)analysisError('GMAIL_ANALYSIS_REQUEST_CONFLICT',409);return}
   this.db.prepare('INSERT INTO gmail_analysis_commands VALUES (?,?,?,?,?)').run(id,input.requestId,hash,actor,this.stamp())
   this.db.prepare("UPDATE gmail_analysis_jobs SET state='queued',next_attempt_at=NULL,error_code=NULL,updated_at=? WHERE notice_id=? AND state='failed'").run(this.stamp(),id)
  })
  return this.get(id)!
 }
 revise(packageId:string){
  const row=this.db.prepare('SELECT * FROM gmail_analysis_jobs WHERE package_id=?').get(packageId) as Job|undefined
  if(!row)return false
  this.authorized(row.notice_id,row)
  const p=this.packages.get(packageId)
  if(p.status!=='awaiting_review'||!p.clarificationPending)analysisError('GMAIL_ANALYSIS_STALE',409)
  this.db.prepare("UPDATE gmail_analysis_jobs SET prior_package_id=package_id,generation=generation+1,attempts=0,state='queued',next_attempt_at=NULL,error_code=NULL,updated_at=? WHERE notice_id=? AND state IN ('ready','needs_information')").run(this.stamp(),row.notice_id)
  return true
 }
 private claim():Job|undefined{
  if(!this.scope&&hasBoundGmailPilot(this.db))return undefined
  return this.transaction(()=>{
   const time=this.stamp()
   this.db.prepare("UPDATE gmail_analysis_jobs SET state='failed',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,error_code='INTERRUPTED',updated_at=? WHERE state='processing' AND lease_expires_at<=? AND attempts>=5 AND (? IS NULL OR notice_id=?)").run(time,time,this.scope?.noticeId??null,this.scope?.noticeId??null)
   const row=this.db.prepare(`SELECT * FROM gmail_analysis_jobs WHERE (? IS NULL OR notice_id=?) AND (state='queued' OR (state='failed' AND next_attempt_at<=? AND attempts<5)
    OR (state='processing' AND lease_expires_at<=? AND attempts<5)) ORDER BY created_at,notice_id LIMIT 1`).get(this.scope?.noticeId??null,this.scope?.noticeId??null,time,time) as Job|undefined
   if(!row)return undefined
   try{this.authorized(row.notice_id,row)}catch{
    this.db.prepare("UPDATE gmail_analysis_jobs SET state='failed',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,error_code='AUTHORIZATION_REQUIRED',updated_at=? WHERE notice_id=?").run(time,row.notice_id)
    return undefined
   }
   const token=randomUUID(),expires=new Date(this.now()+120000).toISOString()
   this.db.prepare("UPDATE gmail_analysis_jobs SET state='processing',attempts=attempts+1,lease_token=?,lease_expires_at=?,next_attempt_at=NULL,error_code=NULL,updated_at=? WHERE notice_id=?").run(token,expires,time,row.notice_id)
   return this.job(row.notice_id)!
  })
 }
 private owned(row:Job){
  this.authorized(row.notice_id,row)
  const current=this.job(row.notice_id)
  if(current?.state!=='processing'||current.lease_token!==row.lease_token||!current.lease_expires_at||current.lease_expires_at<=this.stamp())analysisError('GMAIL_ANALYSIS_LEASE_STALE',409)
 }
 private async one(){
  const row=this.claim();if(!row)return false
  const controller=new AbortController();this.controller=controller
  const timeout=setTimeout(()=>controller.abort(),45000)
  let stage='SOURCE_UNAVAILABLE'
  const bounded=async<T>(operation:()=>Promise<T>):Promise<T>=>{
   this.owned(row)
   const result=await Promise.race([operation(),new Promise<never>((_,reject)=>{
    if(controller.signal.aborted)reject(Error('ANALYSIS_TIMEOUT'))
    else controller.signal.addEventListener('abort',()=>reject(Error('ANALYSIS_TIMEOUT')),{once:true})})])
   this.owned(row);return result
  }
  try{
   let extraction:GmailExtraction
   if(row.extraction_json)extraction=JSON.parse(row.extraction_json) as GmailExtraction
   else{
    const notice=this.authorized(row.notice_id,row)
    const message=validateAnalysisMessage(await bounded(()=>this.providers.readMessage(notice.messageId,controller.signal)),notice.messageId)
    if(this.scope&&message.accountId!==this.scope.accountId)analysisError('GMAIL_ANALYSIS_ACCOUNT_MISMATCH',403)
    stage='MODEL_INVALID'
    extraction=validateExtraction(await bounded(()=>this.providers.interpret(message,controller.signal)),message)
    this.owned(row)
    this.db.prepare('UPDATE gmail_analysis_jobs SET extraction_json=?,updated_at=? WHERE notice_id=? AND lease_token=?').run(JSON.stringify(extraction),this.stamp(),row.notice_id,row.lease_token)
   }
   if(this.scope&&extraction.source.accountId!==this.scope.accountId)analysisError('GMAIL_ANALYSIS_ACCOUNT_MISMATCH',403)
   let answers:Record<string,string>={}
   if(row.prior_package_id){
    const previous=this.db.prepare('SELECT result_json FROM gmail_analysis_proposals WHERE package_id=?').get(row.prior_package_id) as {result_json:string}
    answers={...(JSON.parse(previous.result_json) as GmailAnalysisResult).clarifications}
    const clarification=this.db.prepare('SELECT answers_json FROM update_package_clarifications WHERE package_id=?').get(row.prior_package_id) as {answers_json:string}
    answers={...answers,...JSON.parse(clarification.answers_json) as Record<string,string>}
   }
   stage='CODA_UNAVAILABLE'
   const query=contextQuery(extraction,answers)
   const candidates=await bounded(()=>this.providers.lookup(query,controller.signal))
   const context=validateContext(candidates,extraction,answers,this.stamp())
   const result:GmailAnalysisResult={extraction,context,clarifications:answers,summary:
    'E-mail autorizado para análise. '+(context.status==='matched'?'Registro correspondente encontrado no ERP.':context.status==='conflict'?'Há divergências entre e-mail e ERP.':context.status==='ambiguous'?'Mais de um registro candidato exige conferência.':'Identificação do processo exige complementação.')+' Autorização declarada não confirma agendamento, capacidade, peças ou entrega.'}
   stage='PERSISTENCE_UNAVAILABLE'
   this.transaction(()=>{
    this.owned(row)
    if(row.prior_package_id){
     const changed=this.db.prepare("UPDATE update_packages SET status='superseded',revision=revision+1,updated_at=? WHERE id=? AND status='awaiting_review' AND EXISTS(SELECT 1 FROM gmail_analysis_proposals WHERE package_id=?)").run(this.stamp(),row.prior_package_id,row.prior_package_id)
     if(changed.changes!==1)analysisError('GMAIL_ANALYSIS_PROPOSAL_DECIDED',409)
    }
    const proposal=buildAnalysisProposal(result,row.generation)
    const created=this.packages.createProposal(proposal)
    this.db.prepare('INSERT INTO gmail_analysis_proposals VALUES (?,?,?,?,?)').run(created.id,row.notice_id,row.generation,JSON.stringify(result),analysisHash(result))
    this.db.prepare("UPDATE gmail_analysis_jobs SET state=?,package_id=?,prior_package_id=NULL,lease_token=NULL,lease_expires_at=NULL,error_code=NULL,next_attempt_at=NULL,updated_at=? WHERE notice_id=? AND lease_token=?")
     .run(proposal.missingFields.length?'needs_information':'ready',created.id,this.stamp(),row.notice_id,row.lease_token)
   })
  }catch(cause){
   if(!this.isEligible(row.notice_id))return true
   // Never persist provider messages, stacks, bodies, tokens or personal data in diagnostics.
   const category=(cause as {analysisCategory?:unknown})?.analysisCategory
   const blocked=typeof category==='string'&&['AUTH_REQUIRED','INVALID_INPUT','NOT_FOUND','CONFLICT'].includes(category)
   const code=blocked?stage.split('_')[0]+'_'+category:stage
   const authorized=this.notices.get(row.notice_id).status==='authorized'
   this.db.prepare("UPDATE gmail_analysis_jobs SET state='failed',lease_token=NULL,lease_expires_at=NULL,error_code=?,next_attempt_at=?,updated_at=? WHERE notice_id=? AND lease_token=?")
    .run(authorized?code:'AUTHORIZATION_REQUIRED',authorized&&!blocked&&row.attempts<5?new Date(this.now()+60000*2**Math.min(row.attempts-1,5)).toISOString():null,this.stamp(),row.notice_id,row.lease_token)
  }finally{clearTimeout(timeout);if(this.controller===controller)this.controller=undefined}
  return true
 }
 drain(limit=3):Promise<void>{
  if(this.stopping)return Promise.resolve()
  if(this.running)return this.running
  const run=async()=>{this.recoverAuthorized();for(let i=0;i<limit&&!this.stopping;i++)if(!await this.one())break}
  this.running=run().finally(()=>{this.running=undefined})
  return this.running
 }
 kick(){void this.drain().catch(()=>{/* Lease and durable state permit recovery; never log provider content. */})}
 start(){this.stopping=false;if(!this.timer){this.recoverAuthorized();this.timer=setInterval(()=>this.kick(),15000);this.timer.unref();this.kick()}}
 async stop(){this.stopping=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;this.controller?.abort();await this.running?.catch(()=>{})}
}
