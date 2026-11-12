import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {openDatabase} from '../database.ts'
import {createGmailIntakeSchema} from '../gmail-intake-schema.ts'
import {createGmailIntakeQueueSchema} from '../gmail-intake-queue-schema.ts'
import {GmailIntakeRepository} from '../gmail-intake.ts'
import {GmailIntakeQueue} from '../gmail-intake-queue.ts'
import {createGmailQueueEndpoint} from '../gmail-intake-queue-endpoint.ts'
import {createGmailCandidateIngest} from '../gmail-intake-ingest.ts'

const queueSecret='synthetic-queue-secret-at-least-32-characters'
const intakeSecret='synthetic-intake-secret-at-least-32-characters'
const now=()=>Date.UTC(2026,10,11,5,0)
const relevant='c123456789abcdef'
const irrelevant='d123456789abcdef'

test('integração HTTP local: enqueue, claim, classificador, ack e replays sem decisões humanas',async()=>{
  const db=openDatabase(':memory:')
  createGmailIntakeSchema(db)
  createGmailIntakeQueueSchema(db)
  const queue=new GmailIntakeQueue(db,now)
  const repository=new GmailIntakeRepository(db)
  const queueApi=createGmailQueueEndpoint(queue,queueSecret,true,now)
  const classifyApi=createGmailCandidateIngest(repository,intakeSecret,true,now)
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url??'/', 'http://localhost').pathname
    try{
      let result:unknown
      let status=200
      if(pathname==='/api/integrations/gmail/intake-candidates'){
        result=await classifyApi(req,res)
        status=202
      }else{
        const match=/^\/api\/integrations\/gmail\/queue\/(enqueue|claim|ack|status)$/.exec(pathname)
        if(!match){res.writeHead(404).end();return}
        result=await queueApi(req,res,match[1] as 'enqueue'|'claim'|'ack'|'status')
      }
      res.writeHead(status,{'content-type':'application/json'})
      res.end(JSON.stringify(result))
    }catch(error){
      const e=error as {status?:number,code?:string}
      res.writeHead(e.status??500,{'content-type':'application/json'})
      res.end(JSON.stringify({code:e.code??'UNEXPECTED'}))
    }
  })
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const address=server.address()
    assert.ok(address && typeof address!=='string')
    const base='http://127.0.0.1:'+address.port
    const post=async(path:string,value:unknown,secret=queueSecret)=>{
      const raw=JSON.stringify(value),ts=String(now())
      const signature=createHmac('sha256',secret).update(ts+'.'+raw).digest('hex')
      const res=await fetch(base+path,{method:'POST',headers:{
        'content-type':'application/json',
        'x-funix-updates-timestamp':ts,
        'x-funix-updates-signature':signature
      },body:raw})
      return {status:res.status,body:await res.json() as Record<string,unknown>}
    }
    const queuePath='/api/integrations/gmail/queue/'
    assert.equal((await post(queuePath+'enqueue',{messageId:relevant})).body.state,'queued')
    assert.equal((await post(queuePath+'enqueue',{messageId:irrelevant})).body.state,'queued')
    const requestId=randomUUID()
    const first=await post(queuePath+'claim',{limit:2,requestId})
    assert.equal(first.status,200)
    const leases=first.body.claims as Array<{messageId:string,leaseToken:string}>
    assert.equal(leases.length,2)
    const replay=await post(queuePath+'claim',{limit:2,requestId})
    assert.deepEqual(replay.body,first.body)
    assert.deepEqual((await post(queuePath+'claim',{limit:2,requestId:randomUUID()})).body.claims,[])
    for(const lease of leases){
      const candidate=lease.messageId===relevant
        ? {messageId:lease.messageId,subject:'Solicitação de orçamento',snippet:'Preciso reparar o para-choque do carro'}
        : {messageId:lease.messageId,subject:'Newsletter semanal',snippet:'Promoção de marketing digital'}
      const classified=await post('/api/integrations/gmail/intake-candidates',candidate,intakeSecret)
      assert.equal(classified.status,202)
      const classifiedAgain=await post('/api/integrations/gmail/intake-candidates',candidate,intakeSecret)
      assert.deepEqual(classifiedAgain.body,classified.body)
      const ignored=lease.messageId===irrelevant
      assert.equal(ignored?classified.body.status:typeof classified.body.noticeId==='string',ignored?'ignored':true)
      const receipt={messageId:lease.messageId,leaseToken:lease.leaseToken,
        result:ignored?'ignored':'notified',noticeId:ignored?null:classified.body.noticeId,errorCode:null}
      const ack=await post(queuePath+'ack',receipt)
      assert.equal(ack.status,200)
      assert.equal(ack.body.state,ignored?'ignored':'notified')
      assert.deepEqual((await post(queuePath+'ack',receipt)).body,ack.body)
      assert.equal((await post(queuePath+'status',{messageId:lease.messageId})).body.state,ack.body.state)
    }
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_notices').get() as {n:number}).n,1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_decisions').get() as {n:number}).n,0)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_delivery_queue_attempts').get() as {n:number}).n,2)
    const wrongSecret=await post(queuePath+'status',{messageId:relevant},intakeSecret)
    assert.equal(wrongSecret.status,401)
    assert.equal((await post(queuePath+'enqueue',{messageId:relevant})).body.state,'notified')
  }finally{
    await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()))
    db.close()
  }
})

test('resposta perdida do classificador e do ACK não duplica avisos ou decisões',async()=>{
  const db=openDatabase(':memory:')
  createGmailIntakeSchema(db)
  createGmailIntakeQueueSchema(db)
  const queue=new GmailIntakeQueue(db,now)
  const repository=new GmailIntakeRepository(db)
  const queueApi=createGmailQueueEndpoint(queue,queueSecret,true,now)
  const classifyApi=createGmailCandidateIngest(repository,intakeSecret,true,now)
  const server=createServer(async(req,res)=>{
    try{
      const path=new URL(req.url??'/', 'http://localhost').pathname
      const result=path.endsWith('/intake-candidates')
        ? await classifyApi(req,res)
        : await queueApi(req,res,path.endsWith('/enqueue')?'enqueue':path.endsWith('/claim')?'claim':path.endsWith('/ack')?'ack':'status')
      res.writeHead(path.endsWith('/intake-candidates')?202:200,{'content-type':'application/json'})
      res.end(JSON.stringify(result))
    }catch(error){
      const e=error as {status?:number,code?:string}
      res.writeHead(e.status??500,{'content-type':'application/json'})
      res.end(JSON.stringify({code:e.code??'UNEXPECTED'}))
    }
  })
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const address=server.address()
    assert.ok(address&&typeof address!=='string')
    const base='http://127.0.0.1:'+address.port
    async function post(path:string,data:unknown,secret=queueSecret){
      const raw=JSON.stringify(data),ts=String(now())
      const signature=createHmac('sha256',secret).update(ts+'.'+raw).digest('hex')
      const res=await fetch(base+path,{method:'POST',headers:{
        'content-type':'application/json','x-funix-updates-timestamp':ts,'x-funix-updates-signature':signature
      },body:raw})
      return {status:res.status,body:await res.json() as Record<string,unknown>}
    }
    const root='/api/integrations/gmail/'
    await post(root+'queue/enqueue',{messageId:relevant})
    const requestId=randomUUID()
    const first=await post(root+'queue/claim',{limit:1,requestId})
    const lostClaimResponse=await post(root+'queue/claim',{limit:1,requestId})
    assert.deepEqual(lostClaimResponse.body,first.body)
    const claims=first.body.claims as Array<{messageId:string,leaseToken:string}>
    assert.equal(claims.length,1)
    const candidate={messageId:relevant,subject:'Autorização do orçamento',snippet:'Reparo de veículo aguardando análise'}
    const acceptedButResponseLost=await post(root+'intake-candidates',candidate,intakeSecret)
    assert.equal(acceptedButResponseLost.status,202)
    const replayed=await post(root+'intake-candidates',candidate,intakeSecret)
    assert.equal(replayed.status,202)
    assert.deepEqual(replayed.body,acceptedButResponseLost.body)
    const receipt={
      messageId:relevant,leaseToken:claims[0]!.leaseToken,
      result:'notified',noticeId:replayed.body.noticeId,errorCode:null
    }
    const committedButResponseLost=await post(root+'queue/ack',receipt)
    assert.equal(committedButResponseLost.status,200)
    const status=await post(root+'queue/status',{messageId:relevant})
    assert.equal(status.body.state,'notified')
    const repeatedReceipt=await post(root+'queue/ack',receipt)
    assert.deepEqual(repeatedReceipt.body,committedButResponseLost.body)
    const conflictingAck=await post(root+'queue/ack',{...receipt,result:'ignored',noticeId:null})
    assert.equal(conflictingAck.status,409)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_notices').get() as {n:number}).n,1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_delivery_queue_attempts').get() as {n:number}).n,1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_decisions').get() as {n:number}).n,0)
  }finally{
    await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()))
    db.close()
  }
})
