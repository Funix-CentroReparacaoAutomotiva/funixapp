import type {DatabaseSync} from 'node:sqlite'
import type {GmailIntakeNotice} from '../shared/gmail-intake.ts'
import {analysisError,analysisHash} from './gmail-analysis-contract.ts'
export type GmailPilotScope={noticeId:string,activatedAt:string,accountId:string,configurationHash:string}
/** One deliberately selected pilot per database. Rotation is not an implicit config operation. */
export function bindGmailPilot(db:DatabaseSync,scope:GmailPilotScope){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.noticeId)||!Number.isFinite(Date.parse(scope.activatedAt))||new Date(scope.activatedAt).toISOString()!==scope.activatedAt||!scope.accountId||!/^[a-f0-9]{64}$/.test(scope.configurationHash))throw Error('GMAIL_ANALYSIS_PILOT_CONFIG_INVALID')
 const hash=analysisHash(scope)
 db.exec('BEGIN IMMEDIATE')
 try{
  const previous=db.prepare('SELECT scope_hash FROM gmail_analysis_pilot_scope WHERE singleton=1').get() as {scope_hash:string}|undefined
  if(previous){if(previous.scope_hash!==hash)throw Error('GMAIL_ANALYSIS_PILOT_SCOPE_MISMATCH')}
  else{
   const notice=db.prepare('SELECT created_at,status FROM gmail_intake_notices WHERE id=?').get(scope.noticeId) as {created_at:string,status:string}|undefined
   if(!notice||notice.created_at<scope.activatedAt)throw Error('GMAIL_ANALYSIS_PILOT_NOTICE_INVALID')
   if(notice.status==='denied')throw Error('GMAIL_ANALYSIS_PILOT_NOTICE_DENIED')
   if(db.prepare('SELECT 1 FROM gmail_analysis_jobs WHERE notice_id=?').get(scope.noticeId))throw Error('GMAIL_ANALYSIS_PILOT_NOTICE_ALREADY_STARTED')
   db.prepare('INSERT INTO gmail_analysis_pilot_scope VALUES (1,?,?,?,?,?)').run(scope.noticeId,scope.activatedAt,scope.accountId,scope.configurationHash,hash)
  }
  db.exec('COMMIT')
 }catch(error){db.exec('ROLLBACK');throw error}
 return Object.freeze({...scope})
}
export function hasBoundGmailPilot(db:DatabaseSync){
 return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE name='gmail_analysis_pilot_scope'").get()&&db.prepare('SELECT 1 FROM gmail_analysis_pilot_scope WHERE singleton=1').get())
}
export function eligibleGmailPilot(db:DatabaseSync,scope:GmailPilotScope,notice:GmailIntakeNotice){
 const row=db.prepare('SELECT scope_hash FROM gmail_analysis_pilot_scope WHERE singleton=1').get() as {scope_hash:string}|undefined
 return row?.scope_hash===analysisHash(scope)&&notice.id===scope.noticeId&&notice.createdAt>=scope.activatedAt&&(!notice.decidedAt||notice.decidedAt>=scope.activatedAt)
}
export function requireGmailPilot(db:DatabaseSync,scope:GmailPilotScope,notice:GmailIntakeNotice){
 if(!eligibleGmailPilot(db,scope,notice))analysisError('GMAIL_ANALYSIS_NOT_ELIGIBLE',403)
}
