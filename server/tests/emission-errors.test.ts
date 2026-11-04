import test from'node:test'
import assert from'node:assert/strict'
import{randomUUID}from'node:crypto'
import{emissionWasNotIssued}from'../../src/emission-error.ts'
import{api}from'../../src/api.ts'
import{openDatabase}from'../database.ts'
import{BudgetRepository}from'../budgets.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{syntheticRenderer}from'./fixtures/budget-renderer.ts'
import{renderJsreportPdf}from'../jsreport-client.ts'
import{frozenTerms}from'../jsreport-adapter.ts'

test('recognized backend renderer/validation failures mean no emitted document, not an unreserved number',()=>{
 for(const[status,codes]of [
  [502,['PDF_RENDER_FAILURE','PDF_INVALID_RESPONSE','PDF_INCOMPLETE','PDF_TOO_LARGE']],
  [503,['PDF_NOT_CONFIGURED','PDF_CONFIGURATION_INVALID','PDF_RENDER_UNAVAILABLE','DOCUMENT_NUMBER_LIMIT']],
  [422,['BUDGET_INCOMPLETE']],[409,['VERSION_CONFLICT']],
  [400,['INVALID_COMMERCIAL_DATA','INVALID_JSON']],[401,['AUTH_REQUIRED']],
  [403,['ORIGIN_REJECTED']],[404,['NOT_FOUND']],[405,['METHOD_NOT_ALLOWED']],
  [413,['BODY_TOO_LARGE']],[415,['JSON_REQUIRED']],
 ]as const)for(const code of codes)assert.equal(emissionWasNotIssued({kind:'http',status,code}),true,code)
})

test('unknown outcomes stay guarded: transport, unreadable success, generic 5xx/4xx, conflicting key and lease ownership',()=>{
 for(const failure of[
  new TypeError('Failed to fetch'),new DOMException('Aborted','AbortError'),null,{},
  {kind:'network',status:503,code:'PDF_RENDER_UNAVAILABLE'},
  {kind:'response',status:200},{kind:'http',status:502},{kind:'http',status:503},
  {kind:'http',status:500,code:'INTERNAL_ERROR'},{kind:'http',status:503,code:'UNKNOWN'},
  {kind:'http',status:400},{kind:'http',status:422,code:'UNKNOWN'},
  {kind:'http',status:409,code:'PDF_RENDER_IN_PROGRESS'},
  {kind:'http',status:409,code:'PDF_LEASE_EXPIRED'},
  {kind:'http',status:409,code:'IDEMPOTENCY_CONFLICT'},
  {kind:'http',status:503,code:'PDF_RENDER_FAILURE'}, // code/status mismatch
  {kind:'http',code:'constructor'},
 ])assert.equal(emissionWasNotIssued(failure),false,JSON.stringify(failure))
})

test('API preserves specific backend error semantics; proxy text and lost response never acquire a definitive code',async()=>{
 const original=globalThis.fetch
 try{
  for(const[response,known]of[
   [()=>new Response(JSON.stringify({error:{code:'PDF_RENDER_UNAVAILABLE',message:'Não emitido.'}}),{status:503}),true],
   [()=>new Response('Bad gateway',{status:502}),false],
   [()=>new Response(JSON.stringify({error:{code:'INTERNAL_ERROR'}}),{status:500}),false],
   [()=>new Response('truncated',{status:201}),false],
   [()=>{throw Error('lost')},false],
  ]as const){
   globalThis.fetch=async()=>response()
   await assert.rejects(api('/api/atendimentos/synthetic/orcamentos',{method:'POST'}),e=>{assert.equal(emissionWasNotIssued(e),known);return true})
  }
 }finally{globalThis.fetch=original}
})

for(const mode of['refused','invalid']as const)test('definitive '+mode+' renderer failure keeps its reservation, then retries/replays the same official document',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db);let fail=true,calls=0
  const repo=new BudgetRepository(db,{render:async version=>{
   calls++
   if(!fail)return syntheticRenderer(version)
   return renderJsreportPdf(version,frozenTerms(version.snapshot),{endpoint:'https://synthetic.invalid/api/report',username:'synthetic',password:'synthetic-only',template:'FUNIX - Orcamento'},async()=>mode==='refused'?new Response('synthetic refusal',{status:500}):new Response('not a PDF',{headers:{'Content-Type':'application/pdf'}}))
  }})
  const input={scenarioId:f.scenario.id,negotiation:{mode:'none'}},preview=repo.preview(f.at.id,input),request={...input,previewToken:preview.token,idempotencyKey:randomUUID()}
  await assert.rejects(repo.emit(f.at.id,request),error=>{
   const e=error as Error&{code:string;status:number}
   assert.equal(e.code,mode==='refused'?'PDF_RENDER_FAILURE':'PDF_INVALID_RESPONSE')
   assert(emissionWasNotIssued({...e,kind:'http'}));return true
  })
  assert.equal(repo.list(f.at.id).length,0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM budget_document_identity').get()!.n,0)
  assert.deepEqual({...db.prepare('SELECT serial,state,idempotency_key FROM budget_emission_attempts').get()!},{serial:1,state:'failed',idempotency_key:request.idempotencyKey})
  fail=false
  const issued=await repo.emit(f.at.id,request),pdf=repo.pdf(f.at.id,issued.id)
  assert.equal(issued.documentNumber,'OR-000001');assert.equal(calls,2)
  assert.deepEqual(await repo.emit(f.at.id,request),issued);assert.equal(calls,2)
  assert.equal(repo.list(f.at.id).length,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM budget_emission_attempts').get()!.n,1)
  assert.deepEqual(repo.pdf(f.at.id,issued.id),pdf)
 }finally{db.close()}
})
