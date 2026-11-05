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
