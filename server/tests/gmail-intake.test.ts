import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDatabase } from '../database.ts'
import { createGmailIntakeSchema } from '../gmail-intake-schema.ts'
import { GmailIntakeRepository } from '../gmail-intake.ts'
import { createGmailIntakeIngest, createGmailCandidateIngest } from '../gmail-intake-ingest.ts'

const message=()=>({
  messageId:'a'.repeat(16),title:'Solicitação de orçamento automotivo',
  summary:'Cliente solicita avaliação de um veículo ainda sem XP.',
  relevance:'relevant' as const,reason:'LEAD_SERVICE',
  plateHint:null,xpHint:null
})
function setup(){
  const db=openDatabase(':memory:')
  createGmailIntakeSchema(db)
  return {db,repo:new GmailIntakeRepository(db,()=> '2026-11-11T00:00:00.000Z')}
}

test('lead sem XP é notificado sem gerar proposta de execução',()=>{
  const {db,repo}=setup()
  try{
    const created=repo.ingest(message())
    assert.equal(created.status,'awaiting_authorization')
    assert.equal(created.plateHint,null)
    assert.equal(created.xpHint,null)
    assert.equal(created.revision,1)
    assert.equal(created.snapshotHash.length,64)
    assert.equal(repo.list('open').total,1)
    assert.equal(repo.list('closed').total,0)
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='update_packages'").get(),undefined)
  }finally{db.close()}
})

test('ingest idempotente: mesmo e-mail não duplica, conteúdo conflitante é rejeitado',()=>{
  const {db,repo}=setup()
  try{
    const a=repo.ingest(message())
    const again=repo.ingest(message())
    assert.equal(again.id,a.id)
    assert.equal(repo.list('open').total,1)
    assert.throws(()=>repo.ingest({...message(),title:'Versão diferente'}),{code:'GMAIL_INTAKE_CONFLICT'})
    assert.equal(repo.list('open').total,1)
    assert.throws(()=>db.prepare("UPDATE gmail_intake_notices SET title='alterado'").run(),/imutavel/)
  }finally{db.close()}
})

test('autorizar triagem registra decisão humana sem executar alterações',()=>{
  const {db,repo}=setup()
  try{
    const notice=repo.ingest(message()),requestId=randomUUID()
    const result=repo.decide(notice.id,{decision:'authorize',revision:1,snapshotHash:notice.snapshotHash,requestId},'funix_operator')
    assert.equal(result.status,'authorized')
    assert.equal(result.revision,2)
    assert.equal(repo.list('open').total,0)
    assert.equal(repo.list('closed').total,1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_decisions').get()!.n,1)
    assert.equal(repo.decide(notice.id,{decision:'authorize',revision:1,snapshotHash:notice.snapshotHash,requestId},'funix_operator').revision,2)
    assert.throws(()=>repo.decide(notice.id,{decision:'deny',revision:1,snapshotHash:notice.snapshotHash,requestId},'funix_operator'),{code:'GMAIL_INTAKE_REQUEST_CONFLICT'})
    assert.throws(()=>repo.decide(notice.id,{decision:'deny',revision:1,snapshotHash:notice.snapshotHash,requestId:randomUUID()},'funix_operator'),{code:'GMAIL_INTAKE_STALE'})
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='update_packages'").get(),undefined)
  }finally{db.close()}
})

test('não autorizar bloqueia decisão posterior e mensagem incerta pode gerar aviso',()=>{
  const {db,repo}=setup()
  try{
    const notice=repo.ingest({...message(),relevance:'uncertain',reason:'WEAK_VEHICLE_CONTEXT'})
    assert.equal(notice.relevance,'uncertain')
    const denied=repo.decide(notice.id,{decision:'deny',revision:1,snapshotHash:notice.snapshotHash,requestId:randomUUID()},'funix_operator')
    assert.equal(denied.status,'denied')
    assert.throws(()=>repo.decide(notice.id,{decision:'authorize',revision:2,snapshotHash:notice.snapshotHash,requestId:randomUUID()},'funix_operator'),{code:'GMAIL_INTAKE_STALE'})
    assert.equal(repo.list('closed').total,1)
  }finally{db.close()}
})

test('schema rígido bloqueia payload inesperado e pistas não verificadas malformadas',()=>{
  const {db,repo}=setup()
  try{
    assert.throws(()=>repo.ingest({...message(),unexpected:true} as never),{code:'GMAIL_INTAKE_INVALID'})
    assert.throws(()=>repo.ingest({...message(),messageId:'not-real-message-id'}),{code:'GMAIL_INTAKE_INVALID'})
    assert.throws(()=>repo.ingest({...message(),xpHint:'XP1'}),{code:'GMAIL_INTAKE_INVALID'})
    assert.throws(()=>repo.ingest({...message(),plateHint:'TEST123'}),{code:'GMAIL_INTAKE_INVALID'})
    assert.equal(repo.list('open').total,0)
  }finally{db.close()}
})

const secret='synthetic-gmail-intake-secret-at-least-32-bytes'
const instant=1794355200000
function request(raw:string,ts=String(instant),sig?:string) {
  const signature=sig??createHmac('sha256',secret).update(ts+'.'+raw).digest('hex')
  const req=Object.assign(Readable.from([raw]),{
    method:'POST',headers:{'content-type':'application/json',
      'x-funix-updates-timestamp':ts,'x-funix-updates-signature':signature}
  }) as unknown as IncomingMessage
  const res={setHeader:()=>{}} as unknown as ServerResponse
  return {req,res}
}
test('receptor assinado permanece independente e recusa replay alterado',async()=>{
  const {db,repo}=setup()
  try{
    const raw=JSON.stringify(message())
    const first=request(raw)
    const accepted=await createGmailIntakeIngest(repo,secret,true,()=>instant)(first.req,first.res)
    assert.equal(accepted.status,'awaiting_authorization')
    const again=request(raw)
    assert.equal((await createGmailIntakeIngest(repo,secret,true,()=>instant)(again.req,again.res)).noticeId,accepted.noticeId)
    const changed=request(JSON.stringify({...message(),title:'Mudança'}))
    await assert.rejects(()=>createGmailIntakeIngest(repo,secret,true,()=>instant)(changed.req,changed.res),{code:'GMAIL_INTAKE_CONFLICT'})
    const bad=request(raw,String(instant),'0'.repeat(64))
    await assert.rejects(()=>createGmailIntakeIngest(repo,secret,true,()=>instant)(bad.req,bad.res),{code:'GMAIL_INTAKE_UNAUTHORIZED'})
    const disabled=request(raw)
    await assert.rejects(()=>createGmailIntakeIngest(repo,secret,false,()=>instant)(disabled.req,disabled.res),{code:'GMAIL_INTAKE_INGEST_DISABLED'})
    assert.equal(repo.list('open').total,1)
  }finally{db.close()}
})


test('receptor de candidatos ignora propaganda e gera aviso de veículo, sem tomar decisões',async()=>{
  const {db,repo}=setup()
  try{
    const ordinary=request(JSON.stringify({
      messageId:'b'.repeat(16),subject:'Promoção de Natal da Riachuelo',
      snippet:'Aproveite os descontos de fim de ano'}))
    const ignored=await createGmailCandidateIngest(repo,secret,true,()=>instant)(ordinary.req,ordinary.res)
    assert.equal(ignored.status,'ignored')
    assert.equal(repo.list('open').total,0)

    const candidate={messageId:'c'.repeat(16),subject:'Cotação para veículo ABC1D23',
      snippet:'Preciso de orçamento para funilaria e pintura no meu carro'}
    const first=request(JSON.stringify(candidate))
    const created=await createGmailCandidateIngest(repo,secret,true,()=>instant)(first.req,first.res)
    assert.equal(created.status,'awaiting_authorization')
    assert.equal(repo.list('open').total,1)
    assert.equal(repo.list('open').items[0]?.plateHint,'ABC1D23')
    const duplicate=request(JSON.stringify(candidate))
    const again=await createGmailCandidateIngest(repo,secret,true,()=>instant)(duplicate.req,duplicate.res)
    assert.equal(again.status,'awaiting_authorization')
    assert.equal(repo.list('open').total,1)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gmail_intake_decisions").get()!.n,0)
  }finally{db.close()}
})
