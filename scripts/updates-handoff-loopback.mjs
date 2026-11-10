// Real HTTP loopback, synthetic source, in-memory DB, no production services.
// This script is run only by isolated CI; it never contacts Gmail, Coda or Drive.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import { openDatabase } from '../server/database.ts'
import { AtendimentoRepository } from '../server/atendimentos.ts'
import { createUpdatePackageSchema } from '../server/update-packages-schema.ts'
import { UpdatePackageRepository } from '../server/update-packages.ts'
import { createApp } from '../server/app.ts'
import { prepareSignedPendingGmailRequest } from '../server/update-packages-n8n-handoff.ts'

const secret='synthetic-loopback-not-for-production-0123456789'
const password='synthetic-loopback-password-only'
const previous=Object.fromEntries([
 'FUNIX_UPDATES_STORAGE_ENABLED','FUNIX_UPDATES_INGEST_ENABLED',
 'FUNIX_UPDATES_INGEST_SECRET','FUNIX_UPDATES_DECISIONS_ENABLED'
].map(key=>[key,process.env[key]]))
Object.assign(process.env,{
 FUNIX_UPDATES_STORAGE_ENABLED:'true',FUNIX_UPDATES_INGEST_ENABLED:'true',
 FUNIX_UPDATES_INGEST_SECRET:secret,FUNIX_UPDATES_DECISIONS_ENABLED:'false'
})
// Payload exported from the isolated n8n execution 37901, never from live Gmail.
const draft=JSON.parse(readFileSync(new URL('../server/tests/fixtures/n8n-synthetic-execution-37901.json',import.meta.url),'utf8'))
const db=openDatabase(':memory:')
createUpdatePackageSchema(db)
const repo=new UpdatePackageRepository(db)
const app=createApp({atendimentos:new AtendimentoRepository(db),
 origin:'http://127.0.0.1:5173',password,voiceProvider:null})
try{
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve))
 const addr=app.address()
 if(!addr||typeof addr==='string')throw Error('Loopback listener unavailable')
 const host='http://127.0.0.1:'+addr.port
 const signed=prepareSignedPendingGmailRequest(draft,secret)
 const post=async(body,headers)=>fetch(host+'/api/integrations/updates/packages',{
  method:'POST',headers,body
 })
 const response=await post(signed.body,signed.headers)
 assert.equal(response.status,202)
 const receipt=await response.json()
 assert.equal(receipt.status,'awaiting_review')
 const repeat=await post(signed.body,signed.headers)
 assert.equal(repeat.status,202)
 assert.equal((await repeat.json()).packageId,receipt.packageId)
 const tampered=await post(signed.body.replace('XP1234','XP9999'),signed.headers)
 assert.equal(tampered.status,401)
 assert.equal(repo.list('open','XP1234').total,1)
 const p=repo.get(receipt.packageId)
 assert.ok(p.missingFields.some(x=>x.key==='commercialReview'))
 assert.equal(p.status,'awaiting_review')
 const anonymous=await fetch(host+'/api/atualizacoes')
 assert.equal(anonymous.status,401)
 const login=await fetch(host+'/api/session',{method:'POST',
  headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},
  body:JSON.stringify({password})})
 assert.equal(login.status,200)
 const cookie=login.headers.get('set-cookie')?.split(';')[0]
 assert.ok(cookie)
 const open=await fetch(host+'/api/atualizacoes?visao=open&q=XP1234',{headers:{Cookie:cookie}})
 assert.equal(open.status,200)
 const list=await open.json()
 assert.equal(list.total,1)
 assert.equal(list.items[0].id,p.id)
 assert.equal(list.decisionsEnabled,false)
 const denied=await fetch(host+'/api/atualizacoes/'+p.id+'/decisao',{method:'POST',
  headers:{Cookie:cookie,Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},
  body:JSON.stringify({decision:'approve',revision:p.revision,snapshotHash:p.snapshotHash,
   requestId:'11111111-1111-4111-8111-111111111111'})})
 assert.equal(denied.status,503)
 assert.equal(repo.get(p.id).status,'awaiting_review')
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM update_packages WHERE status='executed'").get().n,0)
 console.log('PASS loopback n8n draft → HMAC → HTTP API → blocked card; no external execution')
}finally{
 app.closeAllConnections()
 if(app.listening)await new Promise(resolve=>app.close(resolve))
 db.close()
 for(const [key,value] of Object.entries(previous)){
  if(value===undefined)delete process.env[key]
  else process.env[key]=value
 }
}
