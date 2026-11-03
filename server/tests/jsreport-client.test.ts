import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../database.ts'
import {BudgetRepository} from '../budgets.ts'
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
  const v=b.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:randomUUID()})
  const pdf=Buffer.from('%PDF-1.7\nsynthetic QA content')
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
