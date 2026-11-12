import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {Readable} from 'node:stream'
import {createServer} from 'node:http'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {openDatabase} from '../database.ts'
import {createGmailIntakeSchema} from '../gmail-intake-schema.ts'
import {createGmailIntakeQueueSchema} from '../gmail-intake-queue-schema.ts'
import {GmailIntakeRepository} from '../gmail-intake.ts'
import {GmailIntakeQueue} from '../gmail-intake-queue.ts'
import {createGmailQueueEndpoint} from '../gmail-intake-queue-endpoint.ts'

const secret='synthetic-queue-secret-at-least-32-characters'
const millis=1794355200000
const messageId='bd123456789abcde'

function setup(){
 const db=openDatabase(':memory:')
 createGmailIntakeSchema(db)
 createGmailIntakeQueueSchema(db)
 const queue=new GmailIntakeQueue(db,()=>millis)
 const service=createGmailQueueEndpoint(queue,secret,true,()=>millis)
 return {db,queue,service}
}
function input(body:unknown,signatureKey=secret,ts=String(millis)){
 const raw=JSON.stringify(body)
 const signature=createHmac('sha256',signatureKey).update(ts+'.'+raw).digest('hex')
 const req=Object.assign(Readable.from([raw]),{method:'POST',headers:{
   'content-type':'application/json',
   'x-funix-updates-timestamp':ts,
   'x-funix-updates-signature':signature
 }}) as unknown as IncomingMessage
 const res={setHeader:()=>{}} as unknown as ServerResponse
 return {req,res}
}
test('three signed queue operations enqueue, claim and ack; no downstream action',async()=>{
 const {db,queue,service}=setup()
 try{
  const enq=input({messageId})
  assert.equal((await service(enq.req,enq.res,'enqueue') as {state:string}).state,'queued')
  const repeated=input({messageId})
  assert.equal((await service(repeated.req,repeated.res,'enqueue') as {state:string}).state,'queued')
  const requestId=randomUUID()
  const first=input({limit:1,requestId})
  const claims=(await service(first.req,first.res,'claim') as {claims:Array<{leaseToken:string,attempt:number}>}).claims
  assert.equal(claims.length,1)
  assert.equal(claims[0]?.attempt,1)
  const again=input({limit:1,requestId})
  assert.deepEqual((await service(again.req,again.res,'claim') as {claims:unknown[]}).claims,claims)
  const another=input({limit:1,requestId:randomUUID()})
  assert.deepEqual((await service(another.req,another.res,'claim') as {claims:unknown[]}).claims,[])
  const confirmed=input({messageId,leaseToken:claims[0]!.leaseToken,result:'ignored',noticeId:null,errorCode:null})
  assert.equal((await service(confirmed.req,confirmed.res,'ack') as {state:string}).state,'ignored')
  const replay=input({messageId,leaseToken:claims[0]!.leaseToken,result:'ignored',noticeId:null,errorCode:null})
  assert.equal((await service(replay.req,replay.res,'ack') as {state:string}).state,'ignored')
  assert.equal(queue.status(messageId).attempts,1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_delivery_queue_claim_requests').get()!.n,2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_decisions').get()!.n,0)
 }finally{db.close()}
})
test('claim requestId cannot be reused with different limits',async()=>{
 const {db,service}=setup()
 try{
  const requestId=randomUUID()
  const one=input({limit:1,requestId})
  await service(one.req,one.res,'claim')
  const changed=input({limit:2,requestId})
  await assert.rejects(()=>service(changed.req,changed.res,'claim'),{code:'GMAIL_QUEUE_CLAIM_CONFLICT'})
 }finally{db.close()}
})
test('receipt must match actual existing notice and cannot authorize human decision',async()=>{
 const {db,service,queue}=setup()
 try{
  queue.enqueue(messageId)
  const claim=input({limit:1,requestId:randomUUID()})
  const {claims}=await service(claim.req,claim.res,'claim') as {claims:Array<{leaseToken:string}>}
  const mismatch=input({messageId,leaseToken:claims[0]!.leaseToken,result:'notified',noticeId:randomUUID(),errorCode:null})
  await assert.rejects(()=>service(mismatch.req,mismatch.res,'ack'),{code:'GMAIL_QUEUE_NOTICE_MISMATCH'})
  const notice=new GmailIntakeRepository(db).ingest({messageId,title:'Orçamento',summary:'Solicitação de serviço de veículo.',relevance:'relevant',reason:'REPAIR_SERVICE_CONTEXT',plateHint:null,xpHint:null})
  const good=input({messageId,leaseToken:claims[0]!.leaseToken,result:'notified',noticeId:notice.id,errorCode:null})
  assert.equal((await service(good.req,good.res,'ack') as {state:string}).state,'notified')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_decisions').get()!.n,0)
 }finally{db.close()}
})
test('n8n style Content-Type with UTF-8 charset retains signed body verification',async()=>{
 const {db,service}=setup()
 try{
  const signed=input({messageId})
  signed.req.headers['content-type']='application/json; charset=utf-8'
  assert.equal((await service(signed.req,signed.res,'enqueue') as {state:string}).state,'queued')
  const unknown=input({messageId})
  unknown.req.headers['content-type']='text/plain'
  await assert.rejects(()=>service(unknown.req,unknown.res,'enqueue'),{code:'JSON_REQUIRED'})
  const forged=input({messageId},'incorrect-but-long-synthetic-queue-secret')
  forged.req.headers['content-type']='application/json; charset=utf-8'
  await assert.rejects(()=>service(forged.req,forged.res,'enqueue'),{code:'GMAIL_INTAKE_UNAUTHORIZED'})
 }finally{db.close()}
})
test('bad HMAC, expired request and feature OFF are rejected before any queue write',async()=>{
 const {db,queue,service}=setup()
 try{
  const forged=input({messageId},'incorrect-but-long-synthetic-queue-secret')
  await assert.rejects(()=>service(forged.req,forged.res,'enqueue'),{code:'GMAIL_INTAKE_UNAUTHORIZED'})
  const expired=input({messageId},secret,String(millis-3600000))
  await assert.rejects(()=>service(expired.req,expired.res,'enqueue'),{code:'GMAIL_INTAKE_EXPIRED'})
  const disabled=createGmailQueueEndpoint(queue,secret,false,()=>millis)
  const valid=input({messageId})
  await assert.rejects(()=>disabled(valid.req,valid.res,'enqueue'),{code:'GMAIL_INTAKE_INGEST_DISABLED'})
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_delivery_queue').get()!.n,0)
 }finally{db.close()}
})
test('invalid payloads do not consume attempts or create records',async()=>{
 const {db,service}=setup()
 try{
  for(const [operation,body] of [
   ['enqueue',{messageId,extra:'surprise'}],
   ['claim',{limit:26,requestId:randomUUID()}],
   ['claim',{limit:1,requestId:'not-uuid'}],
   ['ack',{messageId,leaseToken:randomUUID(),result:'authorize',noticeId:null,errorCode:null}]
  ] as const){
   const item=input(body)
   await assert.rejects(()=>service(item.req,item.res,operation),{code:operation==='ack'?'GMAIL_QUEUE_INVALID':'GMAIL_QUEUE_PAYLOAD_INVALID'})
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_delivery_queue').get()!.n,0)
 }finally{db.close()}
})

test('signed status reconciles a lost response without claiming or modifying a message',async()=>{
 const {db,service,queue}=setup()
 try{
  queue.enqueue(messageId)
  const pending=input({messageId})
  assert.deepEqual(await service(pending.req,pending.res,'status'),{messageId,state:'queued',attempts:0,nextAttemptAt:new Date(millis).toISOString()})
  const claim=input({limit:1,requestId:randomUUID()})
  const {claims}=await service(claim.req,claim.res,'claim') as {claims:Array<{leaseToken:string}>}
  const inFlight=input({messageId})
  assert.equal((await service(inFlight.req,inFlight.res,'status') as {state:string}).state,'leased')
  const ack=input({messageId,leaseToken:claims[0]!.leaseToken,result:'ignored',noticeId:null,errorCode:null})
  await service(ack.req,ack.res,'ack')
  const completed=input({messageId})
  assert.equal((await service(completed.req,completed.res,'status') as {state:string}).state,'ignored')
  assert.equal(queue.status(messageId).attempts,1)
  const unknown=input({messageId:'aaaaaaaaaaaaaaaa'})
  await assert.rejects(()=>service(unknown.req,unknown.res,'status'),{code:'GMAIL_QUEUE_NOT_FOUND'})
  const forged=input({messageId},'incorrect-but-long-synthetic-queue-secret')
  await assert.rejects(()=>service(forged.req,forged.res,'status'),{code:'GMAIL_INTAKE_UNAUTHORIZED'})
  const invalid=input({messageId,extra:true})
  await assert.rejects(()=>service(invalid.req,invalid.res,'status'),{code:'GMAIL_QUEUE_PAYLOAD_INVALID'})
 }finally{db.close()}
})

test('HTTP localhost: status signed round-trip works and invalid signature is rejected',async()=>{
 const {db,service}=setup()
 const server=createServer(async(req,res)=>{
  try{
   const result=await service(req,res,'status')
   res.statusCode=200
   res.setHeader('Content-Type','application/json')
   res.end(JSON.stringify(result))
  }catch(error){
   const code=(error as {status?:number}).status??500
   res.statusCode=code
   res.end(JSON.stringify({code:(error as {code?:string}).code??'UNEXPECTED'}))
  }
 })
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const addr=server.address()
  assert.ok(addr&&typeof addr!=='string')
  const endpoint='http://127.0.0.1:'+addr.port+'/'
  const body=JSON.stringify({messageId})
  const ts=String(millis)
  const signature=createHmac('sha256',secret).update(ts+'.'+body).digest('hex')
  const send=(sig:string)=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-funix-updates-timestamp':ts,'x-funix-updates-signature':sig},body})
  const missing=await send(signature)
  assert.equal(missing.status,404)
  const missingBody=await missing.json() as {code:string}
  assert.equal(missingBody.code,'GMAIL_QUEUE_NOT_FOUND')
  const invalid=await send('0'.repeat(64))
  assert.equal(invalid.status,401)
  assert.equal((await invalid.json() as {code:string}).code,'GMAIL_INTAKE_UNAUTHORIZED')
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()))
  db.close()
 }
})
