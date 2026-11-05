import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {readVoiceContext} from '../voice-context.ts'
import {planVoiceCommands,voiceRevisions} from '../voice-planner.ts'
import {stageVoiceBatch,applyVoiceBatch} from '../voice-apply.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import type {VoiceCommandBatch,VoiceCommand} from '../../shared/voice-commands.ts'

const ref=(id:string)=>({state:'resolved' as const,id})
const session='synthetic-voice-session'
let sequence=0
function fixture(){
 const db=openDatabase(':memory:'),f=commercialFixture(db)
 const context=()=>readVoiceContext(db,f.at.id,f.scenario.id)
 const stage=(commands:VoiceCommand[])=>{
  const ctx=context(),batch:VoiceCommandBatch={format:'funix-voice-commands-v1',atendimentoId:f.at.id,scenarioId:f.scenario.id,
   expected:voiceRevisions(ctx),idempotencyKey:'synthetic-voice-apply-'+(++sequence),commands}
  const plan=planVoiceCommands(batch,ctx)
  stageVoiceBatch(db,batch,plan.stateDigest,session)
  const body={scenarioId:f.scenario.id,idempotencyKey:batch.idempotencyKey}
  return{batch,plan,body,apply:(extra:Record<string,unknown>={})=>applyVoiceBatch(db,f.at.id,{...body,...extra},session)}
 }
 const command=(id:string,op:VoiceCommand['op'],extra:Record<string,unknown>={})=>({id,op,intent:'instruction',piece:ref(f.item.pieceId),...extra}) as VoiceCommand
 return{db,f,context,stage,command,close:()=>db.close()}
}

test('voice applies diagnosis, intensity, notes, service dimensions and quantity in one SQLite transaction',()=>{
 const h=fixture()
 try{
  const line=h.f.item.services[0]!
  const s=h.stage([
   h.command('damage','set_diagnosis',{diagnosis:null,intensity:'leve'}),
   h.command('notes','set_notes',{value:'Anotação de voz'}),
   h.command('qty','set_quantity',{line:{kind:'id',id:line.id},mode:'increment',value:'0.5'})
  ])
  assert.equal(s.plan.changes.length,2)
  const result=s.apply();assert.equal(result.applied,true);assert.equal(result.changed,2)
  const item=h.f.commercial.list(h.f.at.id,h.f.scenario.id)[0]!
  assert.equal(item.intensity,'leve');assert.equal(item.notes,'Anotação de voz');assert.equal(item.services[0]!.quantity,'3.5')
  assert.equal(item.services[0]!.id,line.id)
  assert.equal(item.revision,h.f.item.revision+2)
  assert.equal(result.revision,h.f.pricing.settings(h.f.at.id).revision)
 }finally{h.close()}
})

test('idempotent replay never increments quantity twice and persists receipt',()=>{
 const h=fixture()
 try{
  const s=h.stage([h.command('qty','set_quantity',{line:{kind:'id',id:h.f.item.services[0]!.id},mode:'increment',value:'1'})])
  assert.equal(s.apply().replay,false)
  const receipt=h.db.prepare('SELECT request_digest FROM voice_apply_receipts WHERE atendimento_id=? AND idempotency_key=?').get(h.f.at.id,s.batch.idempotencyKey)
  assert.equal(receipt!.request_digest,s.plan.requestDigest)
  assert.equal(s.apply().replay,true)
  assert.equal(h.f.commercial.list(h.f.at.id)[0]!.services[0]!.quantity,'4')
 }finally{h.close()}
})

test('context mutation between dictation and confirmation rejects entire plan',()=>{
 const h=fixture()
 try{
  const s=h.stage([h.command('notes','set_notes',{value:'Ditado'})])
  const current=h.f.commercial.list(h.f.at.id)[0]!
  h.f.commercial.updateDiagnosis(h.f.at.id,current.id,{revision:current.revision,notes:'Edição externa'})
  assert.throws(()=>s.apply(),(e:unknown)=>typeof e==='object'&&e!==null&&'code'in e&&e.code==='VOICE_CONTEXT_STALE')
  assert.equal(h.f.commercial.list(h.f.at.id)[0]!.notes,'Edição externa')
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM voice_apply_receipts').get()!.n,0)
 }finally{h.close()}
})

test('foreign session, tampered request and mismatched scenario cannot apply staged commands',()=>{
 const h=fixture()
 try{
  const s=h.stage([h.command('notes','set_notes',{value:'Seguro'})])
  assert.throws(()=>applyVoiceBatch(h.db,h.f.at.id,s.body,'other-session'))
  assert.throws(()=>s.apply({commands:[]}))
  assert.throws(()=>s.apply({scenarioId:'foreign-scenario'}))
  assert.equal(h.f.commercial.list(h.f.at.id)[0]!.notes,'')
 }finally{h.close()}
})

test('independent valid operation applies while unresolved command remains pending',()=>{
 const h=fixture()
 try{
  const s=h.stage([
   {id:'unknown',op:'add_piece',intent:'instruction',piece:{state:'unresolved',text:'peça ambígua'}},
   h.command('notes','set_notes',{value:'Válido'})
  ])
  assert.equal(s.plan.results[0]!.status,'pending')
  assert.equal(s.plan.results[1]!.status,'valid')
  assert.deepEqual(s.apply().handledCommandIds,['notes'])
  assert.equal(h.f.commercial.list(h.f.at.id)[0]!.notes,'Válido')
 }finally{h.close()}
})

test('shared removal requires separate explicit confirmation and cascades scenario flags',()=>{
 const h=fixture()
 try{
  const another=h.f.scenarios.create(h.f.at.id,{name:'Alternativo'})
  const s=h.stage([h.command('remove','remove_piece')])
  assert(s.plan.changes.some(c=>c.op==='remove_piece'))
  assert.throws(()=>s.apply(),(e:unknown)=>typeof e==='object'&&e!==null&&'code'in e&&e.code==='VOICE_REMOVAL_CONFIRMATION_REQUIRED')
  assert.equal(h.f.commercial.list(h.f.at.id).length,1)
  s.apply({confirmGlobalRemoval:true})
  assert.equal(h.f.commercial.list(h.f.at.id).length,0)
  assert.deepEqual(h.f.scenarios.list(h.f.at.id).find(v=>v.id===another.id)?.pieceFlags,{})
 }finally{h.close()}
})

test('new piece and service preserve other scenarios disabled flags and use real FK-backed catalog',()=>{
 const h=fixture()
 try{
  const second=h.f.scenarios.create(h.f.at.id,{name:'Segundo cenário'})
  const catalog=h.f.commercial.catalogs().items.find(i=>i.kind==='peca'&&i.code&&i.id!==h.f.item.pieceId)!
  h.f.commercial.saveCatalog({revision:catalog.revision,status:'validado'},catalog.id)
  const s=h.stage([
   {id:'new-piece',op:'add_piece',intent:'instruction',piece:ref(catalog.id)},
   {id:'new-service',op:'add_service',intent:'instruction',piece:ref(catalog.id),service:ref(h.f.service.id),dimension:ref(h.f.dimension.id),quantity:'2'}
  ])
  assert.equal(s.plan.changes.filter(c=>c.op==='add_service').length,1)
  s.apply()
  const items=h.f.commercial.list(h.f.at.id,h.f.scenario.id),added=items.find(i=>i.pieceId===catalog.id)!
  assert(added);assert.equal(added.enabled,true);assert.equal(added.services[0]!.quantity,'2')
  const other=h.f.commercial.list(h.f.at.id,second.id).find(i=>i.id===added.id)!
  assert.equal(other.enabled,false);assert.equal(other.services[0]!.enabled,false)
 }finally{h.close()}
})

test('SQLite rollback undoes earlier writes and receipt after a later trigger fails',()=>{
 const h=fixture()
 try{
  const line=h.f.item.services[0]!
  const s=h.stage([
   h.command('notes','set_notes',{value:'Não persistir'}),
   h.command('quantity','set_quantity',{line:{kind:'id',id:line.id},mode:'absolute',value:'5'})
  ])
  h.db.exec(`CREATE TRIGGER synthetic_voice_failure BEFORE UPDATE ON diagnosis_services
   WHEN NEW.quantity='5' BEGIN SELECT RAISE(ABORT,'synthetic test rollback'); END;`)
  assert.throws(()=>s.apply())
  const item=h.f.commercial.list(h.f.at.id)[0]!
  assert.equal(item.notes,'');assert.equal(item.services[0]!.quantity,'3')
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM voice_apply_receipts').get()!.n,0)
 }finally{h.close()}
})

test('voice application does not mutate an immutable already-issued budget/PDF',async()=>{
 const h=fixture()
 try{
  const repo=new BudgetRepository(h.db),request={scenarioId:h.f.scenario.id,negotiation:{mode:'none' as const}}
  const preview=repo.preview(h.f.at.id,request)
  const version=await repo.emit(h.f.at.id,{...request,previewToken:preview.token,idempotencyKey:'synthetic-budget-before-voice'})
  const snapshot=repo.get(h.f.at.id,version.id),pdf=repo.pdf(h.f.at.id,version.id)
  h.stage([h.command('notes','set_notes',{value:'Depois da emissão'})]).apply()
  assert.deepEqual(repo.get(h.f.at.id,version.id),snapshot)
  assert.deepEqual(repo.pdf(h.f.at.id,version.id),pdf)
 }finally{h.close()}
})
