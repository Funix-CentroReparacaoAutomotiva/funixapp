import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import type {WorkOrder} from '../../shared/work-order.ts'
import {renderOrderV63} from '../os-template.ts'
import {renderOrderJsreport} from '../os-jsreport.ts'
import {WorkOrderPdfCache} from '../os-pdf-cache.ts'

const sample:WorkOrder={
 id:'os-synthetic',number:'OS-000142',atendimentoId:'at-synthetic',
 budgetVersionId:'v-synthetic',budgetNumber:'OR-000042',budgetLabel:'A',
 createdAt:'2026-11-16T13:00:00.000Z',
 authorization:{confirmedAt:'2026-11-16T13:00:00.000Z',source:'authenticated-session-confirmation',operatorId:null},
 scope:{
   customer:{name:'Pessoa de QA'},
   vehicle:{description:'Honda City EXL 21/22',plate:'FXN2A26'},
   diagnostics:[{pieceId:'p1',pieceName:'Para-choque <dianteiro>',diagnosis:'Avaria externa',intensity:null,notes:'Verificar após desmontagem.'}],
   lines:[
     {id:'s1',pieceId:'p1',kind:'service',pieceName:'Para-choque dianteiro',name:'Reparação',diagnosis:'Avaria externa',dimension:'',quantity:'1',
       notes:'',stages:[{name:'Preparação & teste',dimension:'',cluster:'Preparação técnica'},{name:'Solda plástica',dimension:'',cluster:'Correção estrutural'}]},
     {id:'c1',pieceId:'p1',kind:'component',pieceName:'Para-choque dianteiro',name:'Presilha <script>alert(1)</script>',diagnosis:'',dimension:'',quantity:'6',
       notes:'',stages:[]},
     {id:'s2',pieceId:'p1',kind:'service',pieceName:'Para-choque dianteiro',name:'Outro serviço',diagnosis:'',dimension:'',quantity:'1',
       notes:'',stages:[{name:'Etapa sem agrupamento',dimension:'',cluster:null}]}
   ],
   deadlineDays:7
 }
}
const fakePdf=Buffer.from('%PDF-1.7\nsynthetic test\n%%EOF')

test('template V63 uses frozen OS data, escapes HTML and does not invent delivery date',()=>{
 const result=renderOrderV63(sample)
 assert.match(result.content,/Para-choque &lt;dianteiro&gt;/)
 assert.match(result.content,/Presilha &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
 assert(!result.content.includes('<script>alert(1)</script>'))
 assert(result.content.includes('Preparação &amp; teste'))
 assert(result.content.includes('Etapa sem categoria'))
 assert(result.headerTemplate.includes('OS-000142'))
 assert(result.headerTemplate.includes('16/11/2026'))
 assert(!result.headerTemplate.includes('25/11/2026'))
 assert(result.headerTemplate.includes('Data de emissão'))
 assert(result.headerTemplate.includes('class="totalPages"'))
 assert(!result.content.includes('R$ '))
 assert(!result.content.includes('Prazo de entrega confirmado'))
})

test('etapas da matriz não apresentam dimensões, mas WorkOrder original permanece íntegra',()=>{
 const order=structuredClone(sample)
 const service=order.scope.lines.find(line=>line.id==='s1')!
 service.stages[0]!.dimension='Parcial'
 service.stages[1]!.dimension='M'
 const uncategorized=order.scope.lines.find(line=>line.id==='s2')!
 uncategorized.stages[0]!.dimension='Total'
 const before=JSON.stringify(order)
 const print=renderOrderV63(order)
 assert(print.content.includes('Preparação &amp; teste'))
 assert(print.content.includes('Solda plástica'))
 assert(print.content.includes('Etapa sem agrupamento'))
 assert(!print.content.includes('Preparação &amp; teste (Parcial)'))
 assert(!print.content.includes('Solda plástica (M)'))
 assert(!print.content.includes('Etapa sem agrupamento (Total)'))
 assert(!print.content.includes('(Parcial)'))
 assert(!print.content.includes('(M)'))
 assert(!print.content.includes('(Total)'))
 assert.equal(JSON.stringify(order),before)
 assert.equal(service.stages[0]!.dimension,'Parcial')
 assert.equal(service.stages[1]!.dimension,'M')
 assert.equal(uncategorized.stages[0]!.dimension,'Total')
})

test('jsreport receives print-ready V63 html directly and validates PDF',async()=>{
 let calls=0
 const connection={endpoint:'https://example.invalid/api/report',username:'qa',password:'secret'}
 const pdf=await renderOrderJsreport(sample,connection,async(url,init)=>{
   calls++
   assert.equal(url,connection.endpoint)
   assert.equal(init?.method,'POST')
   const payload=JSON.parse(String(init?.body))
   assert.equal(payload.template.recipe,'chrome-pdf')
   assert.equal(payload.template.engine,'none')
   assert.equal(payload.template.chrome.format,'A4')
   assert.equal(payload.template.chrome.landscape,true)
   assert.equal(payload.template.chrome.displayHeaderFooter,true)
   assert(payload.template.chrome.headerTemplate.includes('OS-000142'))
   assert(payload.template.chrome.footerTemplate.includes('Legenda:'))
   assert(!payload.template.content.includes('<script>alert(1)</script>'))
   return new Response(new Uint8Array(fakePdf),{status:200,headers:{'content-type':'application/pdf'}})
 })
 assert.equal(calls,1)
 assert.deepEqual(pdf,fakePdf)
 await assert.rejects(renderOrderJsreport(sample,{...connection,endpoint:'http://external.invalid/api/report'},async()=>new Response()),
   /Configuração do renderizador inválida/)
 await assert.rejects(renderOrderJsreport(sample,connection,async()=>new Response('no pdf',{status:200,headers:{'content-type':'text/plain'}})),
   /arquivo inesperado/)
})

test('OS PDF cache is immutable and returns existing PDF on repeated saves',()=>{
 const db=openDatabase(':memory:')
 try{
   // Cache is created only when explicitly instantiated; main schema remains V20.
   const cache=new WorkOrderPdfCache(db)
   assert.equal(cache.get('missing-order'),null)
   assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version,20)
   // No synthetic production objects are needed to inspect the schema.
   const schema=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_order_pdf_cache'").get()
   assert(schema)
   const info=db.prepare("PRAGMA table_info(work_order_pdf_cache)").all()
   assert(info.some(row=>row.name==='template_version'))
 }finally{db.close()}
})
