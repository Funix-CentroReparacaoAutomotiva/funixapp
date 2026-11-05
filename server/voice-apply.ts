import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {VoiceCommandBatch,VoiceChange} from '../shared/voice-commands.ts'
import {ServiceError} from './errors.ts'
import {readVoiceContext} from './voice-context.ts'
import {planVoiceCommands} from './voice-planner.ts'
import {touchComposition} from './scenarios.ts'

type Staged={batch:VoiceCommandBatch;expires:number}
const staged=new WeakMap<DatabaseSync,Map<string,Staged>>()
const expired=()=>new ServiceError(409,'VOICE_PLAN_EXPIRED','Plano expirado. Grave novamente antes de confirmar.')
const stale=()=>new ServiceError(409,'VOICE_CONTEXT_STALE','O Atendimento, cenário ou catálogo mudou. Refaça o ditado.')
const invalid=()=>new ServiceError(400,'VOICE_APPLY_INVALID','Confirmação de voz inválida.')
const keyFor=(at:string,key:string)=>at+':'+key

export function stageVoiceBatch(db:DatabaseSync,batch:VoiceCommandBatch){
 let map=staged.get(db)
 if(!map){map=new Map();staged.set(db,map)}
 const now=Date.now()
 for(const[key,value]of map)if(value.expires<=now)map.delete(key)
 if(map.size>=100)map.delete(map.keys().next().value!)
 map.set(keyFor(batch.atendimentoId,batch.idempotencyKey),{batch:structuredClone(batch),expires:now+15*60_000})
}

export interface VoiceApplyResult{applied:true;replay:boolean;idempotencyKey:string;changed:number;handledCommandIds:string[];revision:number}

export function applyVoiceBatch(db:DatabaseSync,at:string,input:unknown):VoiceApplyResult{
 if(!input||typeof input!=='object'||Array.isArray(input))throw invalid()
 const body=input as Record<string,unknown>
 if(Object.keys(body).some(k=>!['idempotencyKey','scenarioId','confirmGlobalRemoval'].includes(k))||
  typeof body.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(body.idempotencyKey)||
  typeof body.scenarioId!=='string'||!body.scenarioId||body.scenarioId.length>100||
  (body.confirmGlobalRemoval!==undefined&&typeof body.confirmGlobalRemoval!=='boolean'))throw invalid()
 // This ledger is durable across server restarts, unlike the short-lived staged plan.
 db.exec(`CREATE TABLE IF NOT EXISTS voice_apply_receipts (
   atendimento_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
   scenario_id TEXT NOT NULL, request_digest TEXT NOT NULL, result_json TEXT NOT NULL,
   PRIMARY KEY(atendimento_id,idempotency_key))`)
 const key=body.idempotencyKey,scene=body.scenarioId
 const getReceipt=()=>db.prepare('SELECT scenario_id,result_json FROM voice_apply_receipts WHERE atendimento_id=? AND idempotency_key=?').get(at,key)
 const previous=getReceipt()
 if(previous){
  if(previous.scenario_id!==scene)throw new ServiceError(409,'VOICE_IDEMPOTENCY_CONFLICT','Esta confirmação pertence a outro cenário.')
  return {...JSON.parse(String(previous.result_json)) as VoiceApplyResult,replay:true}
 }
 const map=staged.get(db),pending=map?.get(keyFor(at,key))
 if(!pending||pending.expires<=Date.now()||pending.batch.scenarioId!==scene)throw expired()
 let output:VoiceApplyResult
 db.exec('BEGIN IMMEDIATE')
 try{
  // Re-read inside the writer transaction: no concurrent writer can change these guards.
  const fresh=readVoiceContext(db,at,scene)
  const plan=planVoiceCommands(pending.batch,fresh)
  if(plan.issues.some(i=>i.code==='REVISION_CONFLICT'||i.code==='CONTEXT_CONFLICT')||plan.stateDigest!==planVoiceCommands(pending.batch,fresh).stateDigest)throw stale()
  // Changes are generated exclusively by the trusted server-side planner, never from the request body.
  if(plan.replay||plan.issues.some(i=>['INVALID_BATCH','INVALID_CONTEXT','IDEMPOTENCY_CONFLICT'].includes(i.code)))throw stale()
  const removals=plan.changes.some(c=>c.impact.requiresGlobalRemovalConfirmation)
  if(removals&&body.confirmGlobalRemoval!==true)throw new ServiceError(409,'VOICE_REMOVAL_CONFIRMATION_REQUIRED','Confirme explicitamente a exclusão compartilhada entre cenários.')
  const ids=new Map<string,string>()
  const resolve=(ref:{kind:string;id:string})=>ref.kind==='existing'?ref.id:(()=>{const id=ids.get(ref.id);if(!id)throw new Error('Missing planned voice entity');return id})()
  const now=new Date().toISOString()
  const setFlag=(table:string,column:string,scenarioId:string,id:string,enabled:boolean)=>{
   db.prepare(`INSERT INTO ${table}(scenario_id,${column},enabled) VALUES (?,?,?) ON CONFLICT(scenario_id,${column}) DO UPDATE SET enabled=excluded.enabled`).run(scenarioId,id,enabled?1:0)
  }
  for(const change of plan.changes){
   switch(change.op){
    case 'add_piece':{
     const id=randomUUID();ids.set(change.target.id,id)
     db.prepare('INSERT INTO diagnosis_items(id,atendimento_id,piece_id,diagnosis_id,intensity,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,at,change.pieceId,change.values.diagnosisId,change.values.intensity,change.values.notes,now,now)
     for(const [scenarioId,enabled]of Object.entries(change.flags))setFlag('scenario_piece_flags','piece_id',scenarioId,id,enabled)
     break
    }
    case 'update_piece':{
     const id=resolve(change.target)
     const patch=change.patch
     const fields=Object.keys(patch)
     if(fields.length)db.prepare(`UPDATE diagnosis_items SET ${fields.map(k=>({diagnosisId:'diagnosis_id',intensity:'intensity',notes:'notes'} as Record<string,string>)[k]+'=?').join(',')},revision=revision+1,updated_at=? WHERE id=? AND atendimento_id=?`).run(...fields.map(k=>patch[k as keyof typeof patch]??null),now,id,at)
     break
    }
    case 'remove_piece':db.prepare('DELETE FROM diagnosis_items WHERE id=? AND atendimento_id=?').run(resolve(change.target),at);break
    case 'add_service':{
     const id=randomUUID();ids.set(change.target.id,id)
     const values=change.values
     db.prepare('INSERT INTO diagnosis_services(id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id,recommendation_rule_id) VALUES (?,?,?,?,?,?,?,?,?)').run(id,resolve(change.piece),values.serviceId,values.dimensionId,values.quantity,1,values.notes,values.diagnosisId,values.recommendationRuleId??null)
     for(const [scenarioId,enabled]of Object.entries(change.flags))setFlag('scenario_service_flags','service_id',scenarioId,id,enabled)
     break
    }
    case 'update_service':{
     const id=resolve(change.target),patch=change.patch
     const names:Record<string,string>={serviceId:'service_id',dimensionId:'dimension_id',quantity:'quantity',notes:'notes',diagnosisId:'diagnosis_id',recommendationRuleId:'recommendation_rule_id'}
     const fields=Object.keys(patch)
     if(fields.length)db.prepare(`UPDATE diagnosis_services SET ${fields.map(k=>names[k]+'=?').join(',')} WHERE id=? AND diagnosis_item_id=?`).run(...fields.map(k=>patch[k as keyof typeof patch]??null),id,resolve(change.piece))
     if(change.impact.invalidatesExecutionConfirmations)db.prepare('DELETE FROM scenario_service_confirmations WHERE service_line_id=?').run(id)
     // Service changes also invalidate the owning diagnosis revision.
     db.prepare('UPDATE diagnosis_items SET revision=revision+1,updated_at=? WHERE id=?').run(now,resolve(change.piece))
     break
    }
    case 'remove_service':db.prepare('DELETE FROM diagnosis_services WHERE id=? AND diagnosis_item_id=?').run(resolve(change.target),resolve(change.piece));break
    case 'set_piece_enabled':{
     const id=resolve(change.target)
     setFlag('scenario_piece_flags','piece_id',change.scenarioId,id,change.enabled)
     if(!change.enabled)db.prepare('DELETE FROM scenario_service_confirmations WHERE scenario_id=? AND service_line_id IN (SELECT id FROM diagnosis_services WHERE diagnosis_item_id=?)').run(change.scenarioId,id)
     break
    }
    case 'set_service_enabled':{
     const id=resolve(change.target)
     setFlag('scenario_service_flags','service_id',change.scenarioId,id,change.enabled)
     if(!change.enabled)db.prepare('DELETE FROM scenario_service_confirmations WHERE scenario_id=? AND service_line_id=?').run(change.scenarioId,id)
     break
    }
   }
  }
  if(plan.changes.length)touchComposition(db,at)
  const revision=Number(db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(at)!.revision)
  const handledCommandIds=[...new Set(plan.results.filter(r=>r.status==='valid'||r.status==='noop').map(r=>r.commandId))]
  output={applied:true,replay:false,idempotencyKey:key,changed:plan.changes.length,handledCommandIds,revision}
  db.prepare('INSERT INTO voice_apply_receipts(atendimento_id,idempotency_key,scenario_id,request_digest,result_json) VALUES (?,?,?,?,?)').run(at,key,scene,plan.requestDigest,JSON.stringify(output))
  db.exec('COMMIT')
 }catch(error){db.exec('ROLLBACK');throw error}
 map?.delete(keyFor(at,key))
 return output!
}
