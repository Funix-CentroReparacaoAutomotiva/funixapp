import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {deliverStagingGmailDraft} from '../update-packages-staging-transport.ts'
import type {StagingSender} from '../update-packages-staging-transport.ts'

const draft=JSON.parse(readFileSync(fileURLToPath(
 new URL('./fixtures/n8n-synthetic-execution-37901.json',import.meta.url)),'utf8'))
const secret='synthetic-staging-secret-01234567890123456789'
const endpoint='https://homolog.funix.example/api/integrations/updates/packages'
const origin='https://homolog.funix.example'
const validReceipt={packageId:'11111111-1111-4111-8111-111111111111',revision:1,
 snapshotHash:'a'.repeat(64),status:'awaiting_review'}
const settings=(sender:StagingSender)=>({
 enabled:true,isolatedEnvironment:true,endpoint,expectedOrigin:origin,
 secret,sender,now:1794172800000
})
test('transporte desligado não chama emissor nem validação de rede',async()=>{
 let calls=0
 await assert.rejects(()=>deliverStagingGmailDraft(draft,{
  ...settings(async()=>{calls++;return {status:202,body:validReceipt}}),
  enabled:false
 }),/STAGING_TRANSPORT_DISABLED/)
 assert.equal(calls,0)
})
test('isolamento ambiental é uma trava independente',async()=>{
 let calls=0
 await assert.rejects(()=>deliverStagingGmailDraft(draft,{
  ...settings(async()=>{calls++;return {status:202,body:validReceipt}}),
  isolatedEnvironment:false
 }),/STAGING_TRANSPORT_DISABLED/)
 assert.equal(calls,0)
})
test('bloqueia host diferente, domínio sem marca de homologação, HTTP e caminho inesperado',async()=>{
 let calls=0
 for(const target of [
  'http://homolog.funix.example/api/integrations/updates/packages',
  'https://funix.example/api/integrations/updates/packages',
  'https://homolog.funix.example.evil.test/api/integrations/updates/packages',
  'https://homolog.funix.example/api/other',
  'https://homolog.funix.example/api/integrations/updates/packages?bypass=1',
  'https://user:password@homolog.funix.example/api/integrations/updates/packages',
  'https://127.0.0.1/api/integrations/updates/packages'
 ]) {
  await assert.rejects(()=>deliverStagingGmailDraft(draft,{
   ...settings(async()=>{calls++;return {status:202,body:validReceipt}}),
   endpoint:target
  }),/STAGING_ENDPOINT_INVALID/)
 }
 assert.equal(calls,0)
})
test('payload sintético tem assinatura e só pode produzir recibo de pacote aberto',async()=>{
 let called=0
 const result=await deliverStagingGmailDraft(draft,settings(async request=>{
  called++
  assert.equal(request.url,endpoint)
  assert.equal(request.redirect,'error')
  assert.equal(request.headers['X-Funix-Updates-Timestamp'],'1794172800000')
  assert.match(request.headers['X-Funix-Updates-Signature']!,/^[a-f0-9]{64}$/)
  const envelope=JSON.parse(request.body)
  assert.equal(envelope.eventKey,'gmail:abcdef0123456789:v1')
  assert.ok(envelope.proposal.missingFields.some((x:{key:string})=>x.key==='commercialReview'))
  assert.ok(!envelope.proposal.actions.some((x:{type:string})=>x.type==='erp_update'))
  return {status:202,body:validReceipt}
 }))
 assert.equal(called,1)
 assert.equal(result.status,'awaiting_review')
 assert.equal(result.packageId,validReceipt.packageId)
})
test('resposta aprovada, malformada ou fora do protocolo falha sem sucesso aparente',async()=>{
 for(const response of [
  {status:200,body:validReceipt},
  {status:202,body:{...validReceipt,status:'executed'}},
  {status:202,body:{...validReceipt,snapshotHash:'invalid'}},
  {status:409,body:validReceipt}
 ]) {
  await assert.rejects(()=>deliverStagingGmailDraft(draft,settings(async()=>response)),
   /STAGING_(DELIVERY_REJECTED|RECEIPT_INVALID)/)
 }
})
test('não assina pacote que omite a conferência comercial',async()=>{
 const modified=structuredClone(draft)
 modified.proposal.missingFields=[]
 let sent=false
 await assert.rejects(()=>deliverStagingGmailDraft(modified,settings(async()=>{
  sent=true;return {status:202,body:validReceipt}
 })),/N8N_DRAFT_PROPOSAL_MISMATCH/)
 assert.equal(sent,false)
})

test('ambiente atual designado admite somente host FUNIX explícito e bloqueia operação por padrão',async()=>{
 let calls=0
 const exact='https://app.funix.com.br/api/integrations/updates/packages'
 const sender:StagingSender=async request=>{
  calls++
  assert.equal(request.url,exact)
  assert.equal(request.redirect,'error')
  assert.ok(JSON.parse(request.body).proposal.missingFields.some((f:{key:string})=>f.key==='commercialReview'))
  return {status:202,body:validReceipt}
 }
 const config={...settings(sender),endpoint:exact,expectedOrigin:'https://app.funix.com.br',
  isolatedEnvironment:false,currentFunixHomologation:true}
 assert.equal((await deliverStagingGmailDraft(draft,config)).status,'awaiting_review')
 assert.equal(calls,1)
 for(const invalid of [
  {...config,enabled:false},
  {...config,currentFunixHomologation:false},
  {...config,isolatedEnvironment:true},
  {...config,endpoint:'https://app.funix.com.br.evil.example/api/integrations/updates/packages'},
  {...config,endpoint:'https://api.funix.com.br/api/integrations/updates/packages'},
  {...config,endpoint:'http://app.funix.com.br/api/integrations/updates/packages'},
  {...config,endpoint:'https://app.funix.com.br/api/integrations/updates/packages?preview=1'}
 ])await assert.rejects(()=>deliverStagingGmailDraft(draft,invalid),/STAGING_(ENDPOINT_INVALID|TRANSPORT_DISABLED)/)
 assert.equal(calls,1)
})
