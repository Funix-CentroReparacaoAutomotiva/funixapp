import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../database.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {renderJsreportPdf} from '../jsreport-client.ts'
import type {JsreportTerms} from '../jsreport-adapter.ts'

const terms:JsreportTerms={prazoDiasUteis:'7',parcelamento:{
 tres:{valorParcela:'R$ 110,00',total:'R$ 330,00'},
 seis:{valorParcela:'R$ 56,00',total:'R$ 336,00'},
 nove:{valorParcela:'R$ 38,00',total:'R$ 342,00'},
 doze:{valorParcela:'R$ 29,00',total:'R$ 348,00'}
}}
const connection={endpoint:'https://example.invalid/api/report',username:'qa-user',password:'qa-password',template:'FUNIX - Orcamento'}

test('jsreport POST uses exact template and structured JSON; PDF validation prevents false success',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),b=new BudgetRepository(db),request={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const preview=b.preview(f.at.id,request)
  const v=(await b.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:randomUUID()}))
  const pdf=Buffer.from('%PDF-1.7\nsynthetic QA content\n%%EOF')
  let sent=0
  const mock:typeof fetch=async(url,init)=>{
   sent++
   assert.equal(url,connection.endpoint)
   assert.equal(init?.method,'POST')
   const headers=new Headers(init?.headers)
   assert.equal(headers.get('accept'),'application/pdf')
   assert(headers.get('authorization')?.startsWith('Basic '))
   const body=JSON.parse(String(init?.body))
   assert.equal(body.template.name,'FUNIX - Orcamento')
   assert.equal(body.data.meta.id,'OR-000001')
   assert.deepEqual(Object.keys(body.data).sort(),['cliente','condicoes','diagnosticos','financeiro','meta','parcelamento','veiculo'])
   return new Response(pdf,{status:200,headers:{'Content-Type':'application/pdf'}})
  }
  assert.deepEqual(await renderJsreportPdf(v,terms,connection,mock),pdf)
  assert.equal(sent,1)
  await assert.rejects(renderJsreportPdf(v,terms,connection,async()=>new Response('unauthorized',{status:401})),/recusou/)
  await assert.rejects(renderJsreportPdf(v,terms,connection,async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})),/não retornou um PDF/)
  await assert.rejects(renderJsreportPdf(v,terms,connection,async()=>new Response('not-pdf',{status:200,headers:{'Content-Type':'application/pdf'}})),/arquivo inválido/)
  await assert.rejects(renderJsreportPdf(v,terms,connection,async()=>{throw Error('private network') }),/não respondeu/)
  await assert.rejects(renderJsreportPdf(v,terms,{...connection,endpoint:'http://external.example/api/report'},mock),/HTTPS/)
 }finally{db.close()}
})

test('jsreport rejects truncated, oversized and interrupted streams; timeout and backend-only credentials never leak in errors',async()=>{
 const db=openDatabase(':memory:');try{
  const f=commercialFixture(db),b=new BudgetRepository(db),req={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,req),v=await b.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:randomUUID()})
  await assert.rejects(renderJsreportPdf(v,terms,connection,async()=>new Response('%PDF-1.7\nTRUNCATED',{headers:{'Content-Type':'application/pdf'}})),/inválido ou incompleto/)
  await assert.rejects(renderJsreportPdf(v,terms,{...connection,maxPdfBytes:100},async()=>new Response('%PDF-1.7\n'+'.'.repeat(200)+'\n%%EOF',{headers:{'Content-Type':'application/pdf'}})),e=>(e as{code:string}).code==='PDF_TOO_LARGE')
  let cancelled=false
  const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(64))},cancel(){cancelled=true}})
  await assert.rejects(renderJsreportPdf(v,terms,{...connection,maxPdfBytes:100},async()=>new Response(stream,{headers:{'Content-Type':'application/pdf'}})),e=>(e as{code:string}).code==='PDF_TOO_LARGE');assert(cancelled)
  const mock:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(Error('mock must abort')),1000);init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('private credentials and endpoint must not appear'))},{once:true})})
  await assert.rejects(renderJsreportPdf(v,terms,{...connection,timeoutMs:10},mock),e=>{assert(!(e as Error).message.includes('credentials'));return(e as{code:string}).code==='PDF_RENDER_UNAVAILABLE'})
 }finally{db.close()}
})
