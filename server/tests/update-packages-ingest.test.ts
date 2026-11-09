import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDatabase } from '../database.ts'
import { createUpdatePackageSchema } from '../update-packages-schema.ts'
import { UpdatePackageRepository } from '../update-packages.ts'
import { createUpdatePackageIngest } from '../update-packages-ingest.ts'

const secret='synthetic-only-secret-for-signed-ingest-test-123456'
const instant=1794172800000
const proposed=()=>({
 eventKey:'gmail:message-synthetic-001',
 proposal:{
  source:'gmail' as const,sourceReference:'message-synthetic-001',experienceId:null,plate:'ABC1D23',
  title:'Informações do veículo ABC1D23',summary:'1 anexo com experiência indefinida',
  actions:[{id:'drive:1',type:'drive_archive' as const,title:'Arquivar documento',detail:'Somente após confirmação'}],
  missingFields:[{key:'experienceId',label:'Escolher experiência',hint:'Experiência do documento',
   options:[{value:'XP1001',label:'XP1001 · sintética'},{value:'XP1002',label:'XP1002 · sintética'}]}]
 }
})
const setup=()=>{const db=openDatabase(':memory:');createUpdatePackageSchema(db);return {db,repo:new UpdatePackageRepository(db)}}
async function signed(repo:UpdatePackageRepository,event:unknown,options?:{sig?:string,ts?:string,key?:string}){
 const raw=JSON.stringify(event),ts=options?.ts??String(instant)
 const sig=options?.sig??createHmac('sha256',secret).update(ts+'.'+raw).digest('hex')
 const req=Object.assign(Readable.from([raw]),{
  method:'POST',headers:{'content-type':'application/json','x-funix-updates-timestamp':ts,'x-funix-updates-signature':sig}
 }) as unknown as IncomingMessage
 const res={setHeader:()=>{}} as unknown as ServerResponse
 return createUpdatePackageIngest(repo,options?.key??secret,true,()=>instant)(req,res)
}
test('ingest HMAC armazena uma única proposta por evento, rejeita alteração do mesmo evento',async()=>{
 const {db,repo}=setup()
 try{
  const payload=proposed()
  const first=await signed(repo,payload)
  const again=await signed(repo,payload)
  assert.equal(first.packageId,again.packageId)
  assert.equal(repo.list('open','ABC1D23').total,1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM update_package_ingest_events').get()!.n,1)
  await assert.rejects(()=>signed(repo,{...payload,proposal:{...payload.proposal,title:'Conteúdo divergente'}}),{code:'PACKAGE_EVENT_CONFLICT'})
  assert.equal(repo.list('open','').total,1)
 }finally{db.close()}
})
test('ingest rejeita assinatura inválida e evento expirado',async()=>{
 const {db,repo}=setup()
 try{
  await assert.rejects(()=>signed(repo,proposed(),{sig:'0'.repeat(64)}),{code:'PACKAGE_UNAUTHORIZED'})
  await assert.rejects(()=>signed(repo,proposed(),{ts:String(instant-400000)}),{code:'PACKAGE_EXPIRED'})
  await assert.rejects(()=>signed(repo,proposed(),{key:'wrong-synthetic-key-000000000000000000'}),{code:'PACKAGE_UNAUTHORIZED'})
  assert.equal(repo.list('open','').total,0)
 }finally{db.close()}
})
test('resposta humana fica pendente e não libera aprovação; repetição é idempotente',()=>{
 const {db,repo}=setup()
 try{
  const x=repo.ingest(proposed())
  assert.equal(x.missingFields[0]!.options?.length,2)
  const input={revision:x.revision,snapshotHash:x.snapshotHash,requestId:randomUUID(),answers:{experienceId:'XP1002'}}
  assert.throws(()=>repo.submitClarification(x.id,{...input,answers:{experienceId:'XP9999'}},'funix_operator'),{code:'PACKAGE_CLARIFICATION_INVALID'})
  const first=repo.submitClarification(x.id,input,'funix_operator')
  assert.equal(first.clarificationPending,true)
  assert.equal(repo.submitClarification(x.id,input,'funix_operator').clarificationPending,true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM update_package_clarifications').get()!.n,1)
  assert.equal(first.revision,1)
  assert.equal(first.experienceId,null)
  assert.throws(()=>repo.decide(x.id,{decision:'approve',revision:1,snapshotHash:x.snapshotHash,requestId:randomUUID()},'funix_operator'),{code:'PACKAGE_INCOMPLETE'})
  assert.throws(()=>repo.submitClarification(x.id,{...input,requestId:randomUUID()},'funix_operator'),{code:'PACKAGE_CLARIFICATION_EXISTS'})
  assert.equal(repo.list('open','').items[0]!.clarificationPending,true)
 }finally{db.close()}
})
