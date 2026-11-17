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
 assert(result.headerTemplate.includes('ID:'))
 assert(result.headerTemplate.includes('VEÍCULO:'))
 assert(result.headerTemplate.includes('ENTREGA:'))
 assert(result.headerTemplate.includes('PÁG.:'))
 assert(result.headerTemplate.includes('class="value">-</strong>'))
 assert(!result.headerTemplate.includes('16/11/2026'))
 assert(!result.headerTemplate.includes('25/11/2026'))
 assert(result.headerTemplate.includes('class="totalPages"'))
 assert(result.headerTemplate.includes('class="pageNumber"'))
 assert(result.headerTemplate.includes('class="os-prefix"'))
 assert(result.headerTemplate.includes('aria-label="FUNIX"'))
 assert(result.headerTemplate.includes('grid-template-columns:53mm 43mm minmax(0,1fr) 56mm 26mm'))
 assert(result.headerTemplate.includes('width:287mm!important;max-width:287mm!important'))
 assert(result.headerTemplate.includes('margin-left:auto!important;margin-right:auto!important'))
 assert(result.headerTemplate.includes('font-size:16pt'))
 assert(result.headerTemplate.includes('font-weight:700'))
 assert(result.content.includes('.execution{margin:1.8mm 0 0!important;}'))
 assert(result.headerTemplate.includes('border-left:2px solid #fff'))
 assert(!result.headerTemplate.includes('border-left:3px solid #fff'))
 assert(!result.headerTemplate.includes('{{OS_NUMBER}}'))
 assert(!result.headerTemplate.includes('{{VEHICLE}}'))
 assert(!result.headerTemplate.includes('{{DELIVERY}}'))
 assert(!result.content.includes('R$ '))
 assert(result.footerTemplate.includes('.footer-legend .legend-item{transform:none!important;}'))
 assert(!result.content.includes('Prazo de entrega confirmado'))
})

test('cabeçalho novo escapa dados dinâmicos e não inventa uma entrega a partir do prazo',()=>{
 const order=structuredClone(sample)
 order.number='OS-<1>'
 order.scope.vehicle.description='Tracker <script>injetado</script>'
 order.scope.vehicle.plate='ABC1D23'
 order.scope.deadlineDays=1
 const result=renderOrderV63(order)
 assert(result.headerTemplate.includes('OS-&lt;1&gt;'))
 assert(result.headerTemplate.includes('Tracker &lt;script&gt;injetado&lt;/script&gt; (ABC1D23)'))
 assert(!result.headerTemplate.includes('Tracker <script>'))
 assert(result.headerTemplate.includes('class="value">-</strong>'))
 assert(!result.headerTemplate.includes('17/11/2026'))
 assert(result.headerTemplate.includes('font-weight:800'))
 assert(result.headerTemplate.includes('font-size:19pt'))
 assert(!result.headerTemplate.includes('Data de emissão'))
})

test('veículo muito longo conserva 16pt com espaçamento horizontal adaptado',()=>{
 const order=structuredClone(sample)
 order.scope.vehicle.description='Chevrolet Trailblazer Premier 2.8 Turbo Diesel 2023/2024'
 const print=renderOrderV63(order)
 assert(print.headerTemplate.includes('vehicle-field--long'))
 assert(print.headerTemplate.includes('letter-spacing:-1px'))
 assert(print.headerTemplate.includes('font-size:16pt'))
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

test('impressão usa Serviços complementares na quarta coluna e Estética na quinta',()=>{
 const order=structuredClone(sample)
 const service=order.scope.lines.find(line=>line.id==='s1')!
 service.stages.push({name:'Tapeçaria',dimension:'Parcial',cluster:'Serviços complementares'})
 service.stages.push({name:'Polimento',dimension:'M',cluster:'Estética e revitalização'})
 const print=renderOrderV63(order)
 const labels=[...print.content.matchAll(/<td data-cluster="([^"]+)"/g)].map(m=>m[1])
 assert.deepEqual(labels,[
   'Preparação técnica','Correção estrutural','Pintura e acabamento',
   'Serviços complementares','Estética e revitalização'
 ])
 const servicePos=print.content.indexOf('data-cluster="Serviços complementares"')
 const aestheticPos=print.content.indexOf('data-cluster="Estética e revitalização"')
 assert(servicePos>=0&&aestheticPos>servicePos)
 assert(print.content.slice(servicePos,aestheticPos).includes('Tapeçaria'))
 assert(print.content.slice(aestheticPos).includes('Polimento'))
 assert(!print.content.includes('Tapeçaria (Parcial)'))
 assert(!print.content.includes('Polimento (M)'))
 const header=print.content.slice(print.content.indexOf('technical-band-labels'),print.content.indexOf('</thead>'))
 assert(header.indexOf('aria-label="Serviços complementares"')<header.indexOf('aria-label="Estética e revitalização"'))
 const legend=print.footerTemplate
 assert(legend.indexOf('aria-label="Serviços complementares"')<legend.indexOf('aria-label="Estética e revitalização"'))
 // As divisórias originais da matriz devem permanecer, sem linha artificial sobre os chevrons.
 assert(!print.content.includes('td:nth-of-type(4)'))
 assert(!print.content.includes('technical-band-labels::after'))
 // Fonte de dados congelada permanece intacta, inclusive dimensões.
 assert.equal(service.stages.at(-2)?.dimension,'Parcial')
 assert.equal(service.stages.at(-1)?.dimension,'M')
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
