import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {createGmailIntakeSchema} from '../gmail-intake-schema.ts'
import {createGmailIntakeQueueSchema} from '../gmail-intake-queue-schema.ts'
import {GmailIntakeQueue} from '../gmail-intake-queue.ts'
import {GmailIntakeRepository} from '../gmail-intake.ts'

function setup(){
 const db=openDatabase(':memory:')
 createGmailIntakeSchema(db)
 createGmailIntakeQueueSchema(db)
 let clock=Date.UTC(2026,10,11,5,0)
 const now=()=>clock
 const queue=new GmailIntakeQueue(db,now)
 const next=(ms:number)=>{clock+=ms}
 return {db,queue,next,now}
}
const msg='a1b2c3d4e5f60708'
test('fila off-by-default e identificadores válidos',()=>{
 const db=openDatabase(':memory:')
 try{
  const q=new GmailIntakeQueue(db)
  assert.throws(()=>q.enqueue(msg),{code:'GMAIL_QUEUE_DISABLED'})
  createGmailIntakeSchema(db)
  assert.throws(()=>q.enqueue(msg),{code:'GMAIL_QUEUE_DISABLED'})
  createGmailIntakeQueueSchema(db)
  assert.throws(()=>q.enqueue('unexpected'),{code:'GMAIL_QUEUE_INVALID'})
 }finally{db.close()}
})
test('enqueue idempotente, claim único e recibo idempotente',()=>{
 const {db,queue}=setup()
 try{
  const inserted=queue.enqueue(msg)
  assert.equal(inserted.state,'queued')
  assert.equal(queue.enqueue(msg).state,'queued')
  const [lease]=queue.claim(1)
  assert.ok(lease)
  assert.equal(lease.attempt,1)
  assert.deepEqual(queue.claim(1),[])
  assert.equal(queue.status(msg).state,'leased')
  const notice=new GmailIntakeRepository(db).ingest({
   messageId:msg,title:'Orçamento',summary:'Cliente pede reparo de veículo.',
   relevance:'relevant',reason:'REPAIR_SERVICE_CONTEXT',plateHint:null,xpHint:null
  })
  const ack={messageId:msg,leaseToken:lease.leaseToken,result:'notified' as const,noticeId:notice.id,errorCode:null}
  assert.equal(queue.acknowledge(ack).state,'notified')
  assert.equal(queue.acknowledge(ack).state,'notified')
  assert.equal(queue.enqueue(msg).state,'notified')
  assert.deepEqual(queue.claim(1),[])
  assert.throws(()=>queue.acknowledge({...ack,result:'ignored',noticeId:null}),{code:'GMAIL_QUEUE_RECEIPT_CONFLICT'})
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_delivery_queue_attempts').get()!.n,1)
 }finally{db.close()}
})
test('um lease não confirma aviso de outra mensagem; conflito preserva estado',()=>{
 const {db,queue}=setup()
 try{
  queue.enqueue(msg); const [l]=queue.claim(1);assert.ok(l)
  const other=new GmailIntakeRepository(db).ingest({
   messageId:'b'.repeat(16),title:'Orçamento',summary:'Solicitação de reparo',
   relevance:'relevant',reason:'REPAIR_SERVICE_CONTEXT',plateHint:null,xpHint:null
  })
  assert.throws(()=>queue.acknowledge({messageId:msg,leaseToken:l.leaseToken,result:'notified',noticeId:other.id,errorCode:null}),{code:'GMAIL_QUEUE_NOTICE_MISMATCH'})
  assert.equal(queue.status(msg).state,'leased')
  assert.throws(()=>queue.acknowledge({messageId:msg,leaseToken:l.leaseToken,result:'notified',noticeId:'00000000-0000-4000-8000-000000000000',errorCode:null}),{code:'GMAIL_QUEUE_NOTICE_MISMATCH'})
 }finally{db.close()}
})
test('expiração do lease recupera, e token antigo não consegue concluir outra tentativa',()=>{
 const {db,queue,next}=setup()
 try{
  queue.enqueue(msg);const [first]=queue.claim(1);assert.ok(first)
  next(120001)
  const [second]=queue.claim(1);assert.ok(second)
  assert.equal(second.attempt,2)
  assert.notEqual(first.leaseToken,second.leaseToken)
  assert.throws(()=>queue.acknowledge({messageId:msg,leaseToken:first.leaseToken,result:'ignored',noticeId:null,errorCode:null}),{code:'GMAIL_QUEUE_STALE'})
  assert.equal(queue.acknowledge({messageId:msg,leaseToken:second.leaseToken,result:'ignored',noticeId:null,errorCode:null}).state,'ignored')
  assert.deepEqual(queue.claim(1),[])
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gmail_intake_delivery_queue_attempts WHERE outcome='expired'").get()!.n,1)
 }finally{db.close()}
})
test('retentativa 503 com backoff e limite de cinco tentativas',()=>{
 const {db,queue,next}=setup()
 try{
  queue.enqueue(msg)
  for(let n=1;n<=5;n++){
   const [l]=queue.claim(1);assert.ok(l);assert.equal(l.attempt,n)
   const state=queue.acknowledge({messageId:msg,leaseToken:l.leaseToken,result:'retry',noticeId:null,errorCode:'HTTP_503'})
   assert.equal(state.state,n===5?'blocked':'retry')
   assert.deepEqual(queue.claim(1),[])
   next(Math.min(3600000,60000*2**(n-1))+1)
  }
  assert.deepEqual(queue.claim(1),[])
  assert.equal(queue.status(msg).attempts,5)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_delivery_queue_attempts').get()!.n,5)
 }finally{db.close()}
})
test('falha permanente bloqueia e confirmação fora do prazo requer reconciliação',()=>{
 const {db,queue,next}=setup()
 try{
  queue.enqueue(msg)
  const [lease]=queue.claim(1);assert.ok(lease)
  next(120001)
  assert.throws(()=>queue.acknowledge({messageId:msg,leaseToken:lease.leaseToken,result:'ignored',noticeId:null,errorCode:null}),{code:'GMAIL_QUEUE_LEASE_EXPIRED'})
  assert.equal(queue.status(msg).state,'leased')
  const [newLease]=queue.claim(1);assert.ok(newLease)
  assert.equal(queue.acknowledge({messageId:msg,leaseToken:newLease.leaseToken,result:'blocked',noticeId:null,errorCode:'HTTP_409'}).state,'blocked')
  assert.deepEqual(queue.claim(1),[])
 }finally{db.close()}
})
test('duas instâncias no mesmo banco não reclamam o mesmo evento',()=>{
 const {db,queue,now}=setup()
 try{
  queue.enqueue(msg)
  const other=new GmailIntakeQueue(db,now)
  const claims=[...queue.claim(1),...other.claim(1)]
  assert.equal(claims.length,1)
  assert.equal(claims[0]?.messageId,msg)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gmail_intake_delivery_queue_attempts WHERE outcome='leased'").get()!.n,1)
 }finally{db.close()}
})
