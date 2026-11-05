import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {readVoiceContext} from '../voice-context.ts'
import {planVoiceCommands,voiceRevisions} from '../voice-planner.ts'
import {voiceReview} from '../voice-review.ts'
import type {VoiceCommandBatch} from '../../shared/voice-commands.ts'

const ref=(id:string)=>({state:'resolved' as const,id})
test('review uses authoritative catalog names and spells out global removal impact',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),ctx=readVoiceContext(db,f.at.id,f.scenario.id)
  const payload:VoiceCommandBatch={format:'funix-voice-commands-v1',idempotencyKey:'synthetic-review-check',atendimentoId:f.at.id,scenarioId:f.scenario.id,expected:voiceRevisions(ctx),commands:[
   {id:'delete',op:'remove_piece',intent:'instruction',piece:ref(f.item.pieceId)}
  ]}
  const plan=planVoiceCommands(payload,ctx),review=voiceReview(plan,ctx)
  assert.equal(review.length,1)
  assert.match(review[0]!,/EXCLUIR peça:/)
  assert.match(review[0]!,/todos os cenários/)
  assert.match(review[0]!,/serviços e componentes vinculados/)
  assert(!JSON.stringify(review).includes(f.at.phone))
 }finally{db.close()}
})

test('review distinguishes scenario-only flags and shared quantity changes',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),ctx=readVoiceContext(db,f.at.id,f.scenario.id)
  const payload:VoiceCommandBatch={format:'funix-voice-commands-v1',idempotencyKey:'synthetic-review-flags',atendimentoId:f.at.id,scenarioId:f.scenario.id,expected:voiceRevisions(ctx),commands:[
   {id:'quantity',op:'set_quantity',intent:'instruction',piece:ref(f.item.pieceId),line:{kind:'id',id:f.item.services[0]!.id},mode:'absolute',value:'4'},
   {id:'disable',op:'set_piece_enabled',intent:'instruction',piece:ref(f.item.pieceId),enabled:false}
  ]}
  const review=voiceReview(planVoiceCommands(payload,ctx),ctx)
  assert.equal(review.length,2)
  assert(review.some(line=>line.includes('quantidade: 4')&&line.includes('compartilhados')))
  assert(review.some(line=>line.includes('desabilitar')&&line.includes('cenário atual')))
 }finally{db.close()}
})

test('review describes final consolidated piece values and flags exactly as persisted',async()=>{
 const {stageVoiceBatch,applyVoiceBatch}=await import('../voice-apply.ts')
 for(const enabled of [true,false]){
  const db=openDatabase(':memory:')
  try{
   const f=commercialFixture(db),diagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'Dano auditado QA'})
   const piece=f.commercial.catalogs().items.find(p=>p.kind==='peca'&&p.code&&p.id!==f.item.pieceId)!
   const ctx=readVoiceContext(db,f.at.id,f.scenario.id)
   const batch:VoiceCommandBatch={format:'funix-voice-commands-v1',idempotencyKey:'review-consolidated-'+enabled,atendimentoId:f.at.id,scenarioId:f.scenario.id,expected:voiceRevisions(ctx),commands:[
    {id:'piece',op:'add_piece',intent:'instruction',piece:ref(piece.id)},
    {id:'damage',op:'set_diagnosis',intent:'instruction',piece:ref(piece.id),diagnosis:ref(diagnosis.id),intensity:'severo'},
    {id:'notes',op:'set_notes',intent:'instruction',piece:ref(piece.id),value:'Texto novo da peça QA'},
    {id:'flag',op:'set_piece_enabled',intent:'instruction',piece:ref(piece.id),enabled},
    {id:'service',op:'add_service',intent:'instruction',piece:ref(piece.id),service:ref(f.service.id),dimension:ref(f.dimension.id),quantity:'2.5'},
    {id:'line-notes',op:'set_notes',intent:'instruction',piece:ref(piece.id),line:{kind:'command',commandId:'service'},value:'Texto novo da linha QA'}
   ]}
   const plan=planVoiceCommands(batch,ctx),review=voiceReview(plan,ctx)
   stageVoiceBatch(db,batch,plan.stateDigest,plan.requestDigest,'review-session')
   applyVoiceBatch(db,f.at.id,{idempotencyKey:batch.idempotencyKey,scenarioId:f.scenario.id},'review-session')
   const saved=f.commercial.list(f.at.id,f.scenario.id).find(p=>p.pieceId===piece.id)!
   const pieceText=review[plan.changes.findIndex(c=>c.op==='add_piece')]!
   assert(pieceText.includes(diagnosis.name));assert(pieceText.includes(saved.intensity!));assert(pieceText.includes(saved.notes))
   assert(pieceText.includes(enabled?'habilitada':'desabilitada'));assert(pieceText.includes('compartilhados'));assert.equal(saved.enabled,enabled)
   const line=saved.services[0]!,lineText=review[plan.changes.findIndex(c=>c.op==='add_service')]!
   assert(lineText.includes(line.quantity));assert(lineText.includes(f.dimension.name));assert(lineText.includes(line.notes!))
   assert(lineText.includes('compartilhados'));assert(lineText.includes('cenário atual'))
  }finally{db.close()}
 }
})

test('review exposes replacement and clearing of existing piece and service notes',async()=>{
 const {stageVoiceBatch,applyVoiceBatch}=await import('../voice-apply.ts')
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db)
  for(const value of ['Observação substituída QA','']){
   const ctx=readVoiceContext(db,f.at.id,f.scenario.id)
   const batch:VoiceCommandBatch={format:'funix-voice-commands-v1',idempotencyKey:'review-existing-notes-'+(value?'set':'clear'),atendimentoId:f.at.id,scenarioId:f.scenario.id,expected:voiceRevisions(ctx),commands:[
    {id:'piece-notes',op:'set_notes',intent:'instruction',piece:ref(f.item.pieceId),value},
    {id:'line-notes',op:'set_notes',intent:'instruction',piece:ref(f.item.pieceId),line:{kind:'id',id:f.item.services[0]!.id},value}
   ]}
   const plan=planVoiceCommands(batch,ctx),review=voiceReview(plan,ctx)
   assert.equal(review.length,2)
   assert(review.every(text=>text.includes(value||'vazias')))
   stageVoiceBatch(db,batch,plan.stateDigest,plan.requestDigest,'review-session')
   applyVoiceBatch(db,f.at.id,{idempotencyKey:batch.idempotencyKey,scenarioId:f.scenario.id},'review-session')
   const saved=f.commercial.list(f.at.id)[0]!
   assert.equal(saved.notes,value);assert.equal(saved.services[0]!.notes,value)
  }
 }finally{db.close()}
})

test('review identifies the exact repeated service removed and discloses confirmation invalidation',async()=>{
 const {stageVoiceBatch,applyVoiceBatch}=await import('../voice-apply.ts')
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db)
  const item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[
   {serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'3'},
   {serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'7'}
  ]})
  const ctx=readVoiceContext(db,f.at.id,f.scenario.id)
  const batch:VoiceCommandBatch={format:'funix-voice-commands-v1',idempotencyKey:'review-exact-removal-line',atendimentoId:f.at.id,scenarioId:f.scenario.id,expected:voiceRevisions(ctx),commands:[
   {id:'remove-line',op:'remove_service',intent:'instruction',piece:ref(item.pieceId),line:{kind:'id',id:item.services[1]!.id}}
  ]}
  const plan=planVoiceCommands(batch,ctx),text=voiceReview(plan,ctx)[0]!
  assert(text.includes('linha 2'));assert(text.includes('quantidade 7'));assert(text.includes(f.dimension.name));assert(text.includes('todos os cenários'));assert(text.includes('confirmações de execução'))
  stageVoiceBatch(db,batch,plan.stateDigest,plan.requestDigest,'review-session')
  const body={idempotencyKey:batch.idempotencyKey,scenarioId:f.scenario.id}
  assert.throws(()=>applyVoiceBatch(db,f.at.id,body,'review-session'))
  applyVoiceBatch(db,f.at.id,{...body,confirmGlobalRemoval:true},'review-session')
  assert.deepEqual(f.commercial.list(f.at.id)[0]!.services.map(s=>s.id),[item.services[0]!.id])
 }finally{db.close()}
})
