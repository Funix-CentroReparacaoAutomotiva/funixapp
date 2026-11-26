import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import type {WorkOrder} from '../../shared/work-order.ts'
import {renderOrderV1} from '../os-template.ts'
import {operationalParagraphs} from '../work-order-pdf.ts'
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

test('V1 prints frozen OS scope safely, with dynamic header and no invented delivery',()=>{
 const result=renderOrderV1(sample)
 assert.match(result.content,/Para-choque &lt;dianteiro&gt;/)
 assert.match(result.content,/Presilha &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
 assert(!result.content.includes('<script>alert(1)</script>'))
 assert(result.content.includes('Preparação &amp; teste'))
 assert(result.content.includes('Etapa sem categoria'))
 assert(result.headerTemplate.includes('OS-000142'))
 assert(result.headerTemplate.includes('Honda City EXL 21/22 (FXN2A26)'))
 for(const marker of ['class="os-id-icon"','class="delivery-icon"','class="v50-vehicle"','class="v57-pagecount"'])assert(result.headerTemplate.includes(marker))
 assert(result.headerTemplate.includes('style="font-size:10pt !important;">—</span>'))
 assert(result.headerTemplate.includes('class="pageNumber"'))
 assert(result.headerTemplate.includes('class="totalPages"'))
 assert(result.headerTemplate.includes('aria-label="FUNIX"'))
 assert(result.headerTemplate.includes('class="running-header plan-header"'))
 assert(result.headerTemplate.includes('width:287mm!important'))
 assert(result.content.includes('.plan-page{position:static!important'))
 assert(result.content.includes('@page plan{size:A4 landscape;margin:23mm 5mm 15mm 5mm}'))
 assert(result.footerTemplate.includes('Legenda:'))
 assert(!result.headerTemplate.includes('@page'))
 assert(!result.footerTemplate.includes('@page'))
 assert(!result.content.includes('R$ '))
 assert(!result.content.includes('25/11/2026'))
})
test('OS omite diagnóstico e intensidade, preserva notas operacionais e não altera o escopo',()=>{
 const order=structuredClone(sample)
 order.scope.diagnostics[0]!.diagnosis='Perda de brilho'
 order.scope.diagnostics[0]!.intensity='severo'
 const service=order.scope.lines[0]!
 service.diagnosis='Diagnóstico da linha QA'
 service.quantity='2'
 service.notes='Proteger a guarnição.'
 order.scope.lines[1]!.notes='Conferir presilhas.'
 order.scope.lines.push({...service,id:'s3',name:'Serviço sem etapas QA',notes:'',quantity:'1',stages:[]})
 const before=JSON.stringify(order)
 const print=renderOrderV1(order)
 const legacy=operationalParagraphs(order).join('\n')
 for(const output of [print.content,legacy]){
   assert(!output.includes('Perda de brilho'))
   assert(!output.includes('Diagnóstico da linha QA'))
   assert(!output.includes('severo'))
   assert(output.includes('Verificar após desmontagem.'))
   assert(output.includes('Proteger a guarnição.'))
   assert(output.includes('Conferir presilhas.'))
 }
 assert(print.content.includes('Reparação: quantidade 2'))
 assert(print.content.includes('Serviço sem etapas cadastradas: Serviço sem etapas QA'))
 assert(print.content.includes('Etapa sem categoria'))
 assert(print.content.includes('class="piece-ladder-comment-marker"'))
 assert.equal(JSON.stringify(order),before)
})
test('OS não mostra campo nem ícone de observação quando há apenas diagnóstico',()=>{
 const order=structuredClone(sample)
 order.scope.diagnostics[0]!.notes=''
 order.scope.lines=order.scope.lines.filter(line=>line.id==='s1')
 const print=renderOrderV1(order)
 assert(!print.content.includes('Avaria externa'))
 assert(!print.content.includes('class="piece-ladder-comment-marker"'))
 assert(!print.content.includes('class="piece-ladder-comment-content"'))
 assert(!operationalParagraphs(order).includes('OBSERVAÇÕES DAS PEÇAS'))
})
test('V1 escapes header inputs and preserves explicitly unknown delivery',()=>{
 const order=structuredClone(sample)
 order.number='OS-<1>'
 order.scope.vehicle.description='Tracker <script>injetado</script>'
 order.scope.vehicle.plate='ABC1D23'
 order.scope.deadlineDays=1
 const result=renderOrderV1(order)
 assert(result.headerTemplate.includes('OS-&lt;1&gt;'))
 assert(result.headerTemplate.includes('Tracker &lt;script&gt;injetado&lt;/script&gt; (ABC1D23)'))
 assert(!result.headerTemplate.includes('Tracker <script>'))
 assert(result.headerTemplate.includes('style="font-size:10pt !important;">—</span>'))
 assert(!result.headerTemplate.includes('17/11/2026'))
})
test('V1 long vehicle label leaves print grid and page-number fields intact',()=>{
 const order=structuredClone(sample)
 order.scope.vehicle.description='Chevrolet Trailblazer Premier 2.8 Turbo Diesel 2023/2024'
 const print=renderOrderV1(order)
 assert(print.headerTemplate.includes('vehicle-field--long'))
 assert(print.headerTemplate.includes('class="v50-vehicle vehicle-field--long"'))
 assert(print.headerTemplate.includes('pageNumber'))
})

test('etapas da matriz não apresentam dimensões, mas WorkOrder original permanece íntegra',()=>{
 const order=structuredClone(sample)
 const service=order.scope.lines.find(line=>line.id==='s1')!
 service.stages[0]!.dimension='Parcial'
 service.stages[1]!.dimension='M'
 const uncategorized=order.scope.lines.find(line=>line.id==='s2')!
 uncategorized.stages[0]!.dimension='Total'
 const before=JSON.stringify(order)
 const print=renderOrderV1(order)
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
 const print=renderOrderV1(order)
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
 // Fonte de dados congelada permanece intacta, inclusive dimensões.
 assert.equal(service.stages.at(-2)?.dimension,'Parcial')
 assert.equal(service.stages.at(-1)?.dimension,'M')
})

test('jsreport receives print-ready V1 html directly and validates PDF',async()=>{
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
   // Cache is created only when explicitly instantiated; the migration version stays current.
   const cache=new WorkOrderPdfCache(db)
   assert.equal(cache.get('missing-order'),null)
   assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version,28)
   // No synthetic production objects are needed to inspect the schema.
   const schema=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_order_pdf_cache'").get()
   assert(schema)
   const info=db.prepare("PRAGMA table_info(work_order_pdf_cache)").all()
   assert(info.some(row=>row.name==='template_version'))
 }finally{db.close()}
})

test('V1 prints the explicit calendar date and revision, not calendar arithmetic based on deadline',()=>{
 const order=structuredClone(sample)
 order.scope.deliveryDate='2026-12-02'
 order.scope.deadlineDays=99
 order.revision=2
 const result=renderOrderV1(order)
 assert(result.headerTemplate.includes('02/12/2026'))
 assert(result.headerTemplate.includes('OS-000142 R02'))
 assert(!result.headerTemplate.includes('99 dias'))
 order.scope.deliveryDate=null
 assert(renderOrderV1(order).headerTemplate.includes('style="font-size:10pt !important;">—</span>'))
})
