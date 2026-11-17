import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Readable} from 'node:stream'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {createRequestHandler} from '../app.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {syntheticRenderer} from './fixtures/budget-renderer.ts'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from '../database.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {WorkOrderRepository,operationalScope} from '../work-orders.ts'
import {WorkOrderPdfCache} from '../os-pdf-cache.ts'
import {BudgetCancellationRepository} from '../budget-cancellations.ts'
import {cancelledPdf} from '../cancelled-pdf.ts'
import {operationalParagraphs,workOrderPdf} from '../work-order-pdf.ts'
import {ServiceError} from '../errors.ts'

const error=(status:number,code:string)=>(cause:unknown)=>cause instanceof ServiceError&&cause.status===status&&cause.code===code
async function emitted(db:ReturnType<typeof openDatabase>){
 const fixture=commercialFixture(db),budgets=new BudgetRepository(db)
 const input={scenarioId:fixture.scenario.id,negotiation:{mode:'none'} as const}
 const preview=budgets.preview(fixture.at.id,input)
 assert.equal(preview.canEmit,true)
 const version=await budgets.emit(fixture.at.id,{...input,previewToken:preview.token,idempotencyKey:randomUUID()})
 return{fixture,budgets,version}
}

test('V18 creates a frozen, operational-only OS, with no commercial fields or excluded services',async()=>{
 const db=openDatabase(':memory:')
 try{
  const{fixture,budgets,version}=await emitted(db)
  const orders=new WorkOrderRepository(db)
  assert.throws(()=>orders.get(fixture.at.id,version.id),error(404,'OS_NOT_FOUND'))
  assert.throws(()=>orders.create(fixture.at.id,version.id,{authorized:false}),error(422,'OS_AUTHORIZATION_REQUIRED'))
  assert.throws(()=>orders.create(fixture.at.id,version.id,{authorized:true,operator:'invented'}),error(400,'INVALID_COMMERCIAL_DATA'))
  const original=structuredClone(version),pdf=budgets.pdf(fixture.at.id,version.id)
  const os=orders.create(fixture.at.id,version.id,{authorized:true})
  assert.equal(os.number,'OS-000001')
  assert.equal(os.budgetVersionId,version.id)
  assert.equal(os.authorization.operatorId,null)
  assert.equal(os.authorization.source,'authenticated-session-confirmation')
  assert.deepEqual(os.scope,operationalScope(version))
  assert.deepEqual(os.scope.lines.map(l=>l.id),version.snapshot.calculation.lines.filter(l=>l.included).map(l=>l.id))
  const only=JSON.stringify(os)
  for(const privateKey of ['finalUnit','manualPrice','discount','subtotal','installments','factors','energy','conditions','residual','unit','total'])
   assert(!new RegExp('"'+privateKey+'"','i').test(only),privateKey+' leaked')
  assert(!only.includes('Condições de homologação sintética'))
  assert.deepEqual(budgets.get(fixture.at.id,version.id),original)
  assert.deepEqual(budgets.pdf(fixture.at.id,version.id),pdf)
  assert.equal(orders.create(fixture.at.id,version.id,{authorized:true}).id,os.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM work_orders').get()!.total,1)
  const paragraphs=operationalParagraphs(os).join('\n')
  assert.match(paragraphs,/Etapa técnica: Etapa sintética/)
  assert.doesNotMatch(paragraphs,/R\$|Desconto|Parcelamento|Preço manual|Condições de homologação/)
  assert.equal(workOrderPdf(os).subarray(0,8).toString(),'%PDF-1.7')
  assert.throws(()=>db.prepare("UPDATE work_orders SET scope_json='{}'").run(),/immutable/i)
  assert.throws(()=>db.prepare('DELETE FROM work_orders').run(),/immutable/i)
 }finally{db.close()}
})

test('OS V1 PDF cache does not overwrite or reuse historical V63 PDF',async()=>{
 const db=openDatabase(':memory:')
 try{
  const {fixture,version}=await emitted(db)
  const order=new WorkOrderRepository(db).create(fixture.at.id,version.id,{authorized:true})
  const cache=new WorkOrderPdfCache(db)
  const legacy=Buffer.from('%PDF-1.7\nV63 original synthetic\n%%EOF')
  const current=Buffer.from('%PDF-1.7\nV1 official synthetic\n%%EOF')
  db.prepare('INSERT INTO work_order_pdf_cache(work_order_id,template_version,pdf,created_at) VALUES(?,?,?,?)')
    .run(order.id,'v63-jsreport-8',legacy,'2026-11-16T12:00:00.000Z')
  assert.equal(cache.get(order.id),null,'V63 PDF cannot be returned as V1')
  assert.deepEqual(cache.save(order.id,current),current)
  assert.deepEqual(cache.get(order.id),current)
  assert.deepEqual(cache.save(order.id,Buffer.from('%PDF-1.7\nSecond V1 render\n%%EOF')),current,
    'a repeated V1 render cannot replace the first PDF')
  const rows=db.prepare('SELECT template_version,pdf FROM work_order_pdf_cache WHERE work_order_id=? ORDER BY template_version')
    .all(order.id) as Array<{template_version:string;pdf:Uint8Array}>
  assert.deepEqual(rows.map(r=>r.template_version),['v1-jsreport-1','v63-jsreport-8'])
  assert.deepEqual(Buffer.from(rows[1]!.pdf),legacy)
  assert.throws(()=>db.prepare('DELETE FROM work_order_pdf_cache WHERE work_order_id=?').run(order.id),/immutable/i)
 }finally{db.close()}
})

test('OS persists after restart, later changes to Atendimento and scenario cannot rewrite it',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'funix-os-')),path=join(folder,'synthetic.sqlite')
 let db=openDatabase(path)
 try{
  const{fixture,version}=await emitted(db),orders=new WorkOrderRepository(db)
  const os=orders.create(fixture.at.id,version.id,{authorized:true})
  const before=workOrderPdf(os)
  // Editing current Atendimento cannot alter the already frozen source or OS.
  db.prepare("UPDATE atendimentos SET name='Cliente alterado' WHERE id=?").run(fixture.at.id)
  const scenario=fixture.scenarios.list(fixture.at.id)[0]!
  fixture.scenarios.update(fixture.at.id,scenario.id,{revision:scenario.revision,serviceFlags:{[fixture.item.services[0]!.id]:false}})
  db.close();db=openDatabase(path)
  const again=new WorkOrderRepository(db).get(fixture.at.id,version.id)
  assert.deepEqual(again,os)
  assert.deepEqual(workOrderPdf(again),before)
  assert.equal(new BudgetRepository(db).get(fixture.at.id,version.id).snapshot.atendimento.name,version.snapshot.atendimento.name)
  assert.equal(new WorkOrderRepository(db).create(fixture.at.id,version.id,{authorized:true}).id,os.id)
 }finally{db.close();rmSync(folder,{recursive:true,force:true})}
})

test('Different emitted versions can produce distinct OSs while each version has a unique OS',async()=>{
 const db=openDatabase(':memory:')
 try{
  const{fixture,budgets,version}=await emitted(db)
  const nextRequest={scenarioId:fixture.scenario.id,negotiation:{mode:'none'} as const}
  const preview=budgets.preview(fixture.at.id,nextRequest)
  const second=await budgets.emit(fixture.at.id,{...nextRequest,previewToken:preview.token,idempotencyKey:randomUUID()})
  const orders=new WorkOrderRepository(db)
  const first=orders.create(fixture.at.id,version.id,{authorized:true})
  const other=orders.create(fixture.at.id,second.id,{authorized:true})
  assert.notEqual(first.id,other.id)
  assert.equal(other.number,'OS-000002')
  assert.equal(orders.create(fixture.at.id,version.id,{authorized:true}).id,first.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM work_orders').get()!.count,2)
  assert.equal((budgets.list(fixture.at.id) as unknown as {id:string;workOrderNumber?:string}[]).find(v=>v.id===version.id)?.workOrderNumber,first.number)
 }finally{db.close()}
})


test('HTTP OS endpoints require login and Origin and return the persisted operational PDF',async()=>{
 const db=openDatabase(':memory:'),origin='http://localhost:5173'
 try{
  const{fixture,version}=await emitted(db)
  let stamped=0
  const handler=createRequestHandler({atendimentos:new AtendimentoRepository(db),password:'synthetic-password-123',origin,budgetRenderer:syntheticRenderer,cancelledPdfRenderer:async source=>{stamped++;return Buffer.concat([source,Buffer.from('CANCELADO-MOCK')])}})
  async function request(path:string,method='GET',body?:unknown,cookie?:string,otherOrigin=origin){
   const req=Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{
    url:path,method,headers:{...(cookie?{cookie}:{}),...(method!=='GET'?{origin:otherOrigin,'content-type':'application/json'}:{})},
    socket:{remoteAddress:'127.0.0.1'}
   }) as unknown as IncomingMessage
   let status=200;const headers=new Headers(),chunks:Buffer[]=[]
   const res={setHeader(name:string,value:string|number){headers.set(name,String(value))},
     writeHead(code:number){status=code},
     end(value?:string|Buffer){if(value!==undefined)chunks.push(Buffer.isBuffer(value)?value:Buffer.from(value))}
   } as unknown as ServerResponse
   await handler(req,res)
   return new Response(new Uint8Array(Buffer.concat(chunks)),{status,headers})
  }
  const url='/api/atendimentos/'+fixture.at.id+'/orcamentos/'+version.id+'/os'
  assert.equal((await request(url)).status,401)
  const login=await request('/api/session','POST',{password:'synthetic-password-123'})
  assert.equal(login.status,200)
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!
  assert.equal((await request(url,'POST',{authorized:true},cookie,'https://invalid.example')).status,403)
  const absent=await request(url,'GET',undefined,cookie)
  assert.equal(absent.status,404)
  assert.equal((await absent.json()).error.code,'OS_NOT_FOUND')
  assert.equal((await request(url,'POST',{authorized:false},cookie)).status,422)
  const created=await request(url,'POST',{authorized:true},cookie)
  assert.equal(created.status,201)
  const order=await created.json()
  assert.equal(order.number,'OS-000001')
  assert.equal((await (await request(url,'GET',undefined,cookie)).json()).id,order.id)
  assert.equal((await (await request(url,'POST',{authorized:true},cookie)).json()).id,order.id)
  const pdf=await request(url+'/pdf','GET',undefined,cookie)
  assert.equal(pdf.status,200)
  assert.equal(pdf.headers.get('content-type'),'application/pdf')
  assert.match(pdf.headers.get('content-disposition')??'',/inline/)
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,8).toString(),'%PDF-1.7')
  assert.equal((await request(url+'/pdf')).status,401)
  const cancelUrl=url.slice(0,-3).concat('/cancelamento')
  const rawBudget=await request(url.slice(0,-3).concat('/pdf'),'GET',undefined,cookie)
  const rawPdf=await rawBudget.arrayBuffer()
  assert.equal((await request(cancelUrl,'POST',{reason:'x'},cookie)).status,422)
  assert.equal((await request(cancelUrl,'POST',{reason:'Cliente mudou de ideia'},cookie,'https://invalid.example')).status,403)
  assert.equal((await request(cancelUrl,'POST',{reason:'Cliente mudou de ideia'})).status,401)
  const cancelled=await request(cancelUrl,'POST',{},cookie)
  assert.equal(cancelled.status,200)
  assert.equal((await cancelled.json()).reason,'Cancelamento sem motivo informado')
  const osAfter=await request(url,'GET',undefined,cookie)
  assert.equal((await osAfter.json()).cancellation.reason,'Cancelamento sem motivo informado')
  assert.equal((await request(url,'POST',{authorized:true},cookie)).status,409)
  const orAfter=await request(url.slice(0,-3).concat('/pdf'),'GET',undefined,cookie)
  assert.equal(orAfter.status,200)
  assert(Buffer.from(await orAfter.arrayBuffer()).includes(Buffer.from('CANCELADO-MOCK')))
  const osStamped=await request(url+'/pdf','GET',undefined,cookie)
  assert.equal(osStamped.status,200)
  assert(Buffer.from(await osStamped.arrayBuffer()).includes(Buffer.from('CANCELADO-MOCK')))
  assert.equal(stamped,2)
  assert.deepEqual(new BudgetRepository(db).pdf(fixture.at.id,version.id),Buffer.from(rawPdf))
 }finally{db.close()}
})



test('Cancelamento preserva os originais, impede OS nova e permanece após reiniciar',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'funix-cancel-')),path=join(folder,'synthetic.sqlite')
 let db=openDatabase(path)
 try{
  const {fixture,budgets,version}=await emitted(db)
  const original=budgets.pdf(fixture.at.id,version.id)
  const cancel=new BudgetCancellationRepository(db,()=>Date.parse('2026-11-14T12:00:00Z'))
  assert.throws(()=>cancel.cancel(fixture.at.id,version.id,{reason:'x'}),error(422,'CANCELLATION_REASON_REQUIRED'))
  assert.throws(()=>cancel.cancel(fixture.at.id,version.id,{reason:99}),error(422,'CANCELLATION_REASON_REQUIRED'))
  assert.throws(()=>cancel.cancel(fixture.at.id,'outro',{reason:'Teste válido'}),error(404,'NOT_FOUND'))
  const event=cancel.cancel(fixture.at.id,version.id,{reason:'Cliente desistiu'})
  assert.equal(event.reason,'Cliente desistiu')
  assert.equal(cancel.cancel(fixture.at.id,version.id,{reason:'Motivo repetido'}).cancelledAt,event.cancelledAt)
  assert.equal((budgets.list(fixture.at.id) as unknown as {id:string;cancelledAt?:string|null}[]).find(v=>v.id===version.id)?.cancelledAt,event.cancelledAt)
  assert.equal(budgets.get(fixture.at.id,version.id).cancellation?.reason,'Cliente desistiu')
  assert.deepEqual(budgets.pdf(fixture.at.id,version.id),original)
  assert.throws(()=>new WorkOrderRepository(db).create(fixture.at.id,version.id,{authorized:true}),error(409,'BUDGET_CANCELLED'))
  assert.throws(()=>db.prepare('DELETE FROM budget_cancellations').run(),/immutable/i)
  assert.throws(()=>db.prepare("UPDATE budget_cancellations SET reason='mudança'").run(),/immutable/i)
  db.close();db=openDatabase(path)
  assert.equal(new BudgetRepository(db).get(fixture.at.id,version.id).cancellation?.reason,'Cliente desistiu')
 }finally{db.close();rmSync(folder,{recursive:true,force:true})}
})

test('Cancelar orçamento com OS preserva a consulta da OS e o escopo congelado',async()=>{
 const db=openDatabase(':memory:')
 try{
  const {fixture,budgets,version}=await emitted(db)
  const orders=new WorkOrderRepository(db),before=orders.create(fixture.at.id,version.id,{authorized:true})
  const cancellation=new BudgetCancellationRepository(db).cancel(fixture.at.id,version.id,{reason:'Escopo cancelado pelo cliente'})
  const after=orders.get(fixture.at.id,version.id)
  assert.deepEqual(after.scope,before.scope)
  assert.equal(after.number,before.number)
  assert.equal(after.cancellation?.cancelledAt,cancellation.cancelledAt)
  assert.equal((budgets.list(fixture.at.id) as unknown as {id:string;workOrderNumber?:string}[]).find(v=>v.id===version.id)?.workOrderNumber,before.number)
  assert.throws(()=>orders.create(fixture.at.id,version.id,{authorized:true}),error(409,'BUDGET_CANCELLED'))
 }finally{db.close()}
})

test('Cancelar sem OS e sem motivo não cria documento retrospectivamente',async()=>{
 const db=openDatabase(':memory:')
 try{
  const {fixture,budgets,version}=await emitted(db)
  const event=new BudgetCancellationRepository(db).cancel(fixture.at.id,version.id,{})
  assert.equal(event.reason,'Cancelamento sem motivo informado')
  const listed=(budgets.list(fixture.at.id) as unknown as {id:string;cancelledAt?:string|null;workOrderNumber?:string|null}[]).find(v=>v.id===version.id)
  assert.equal(listed?.cancelledAt,event.cancelledAt)
  assert.equal(listed?.workOrderNumber,undefined)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM work_orders').get()!.n,0)
  assert.throws(()=>new WorkOrderRepository(db).create(fixture.at.id,version.id,{authorized:true}),error(409,'BUDGET_CANCELLED'))
 }finally{db.close()}
})

test('PDF cancelado usa receita static-pdf com a marca em todas as páginas',async()=>{
 const pdf=workOrderPdf({
  id:'id',number:'OS-000001',atendimentoId:'a',budgetVersionId:'b',budgetNumber:'OR-000001',budgetLabel:'A',
  createdAt:new Date().toISOString(),authorization:{confirmedAt:new Date().toISOString(),source:'authenticated-session-confirmation',operatorId:null},
  scope:{customer:{name:'Cliente'},vehicle:{description:'Carro',plate:'ABC1D23'},diagnostics:[],lines:[],deadlineDays:null}
 })
 let calls=0
 const send:typeof fetch=async(_url,init)=>{
  calls++
  const payload=JSON.parse(String(init?.body))
  assert.equal(payload.template.recipe,'static-pdf')
  assert.deepEqual(Buffer.from(payload.template.staticPdf.pdfAsset.content,'base64'),pdf)
  assert.equal(payload.template.pdfOperations.length,1)
  assert.equal(payload.template.pdfOperations[0].mergeToFront,true)
  assert.equal(payload.template.pdfOperations[0].mergeWholeDocument,false)
  assert.match(payload.template.pdfOperations[0].template.content,/CANCELADO/)
  return new Response(new Uint8Array(pdf),{status:200,headers:{'content-type':'application/pdf'}})
 }
 const stamped=await cancelledPdf(pdf,{endpoint:'https://jsreport.example/api/report',username:'user',password:'pass',template:'FUNIX - Orcamento'},send)
 assert.equal(calls,1)
 assert.deepEqual(stamped,pdf)
 await assert.rejects(cancelledPdf(pdf,{endpoint:'https://jsreport.example/api/report',username:'user',password:'pass',template:'FUNIX - Orcamento'},async()=>new Response('erro',{status:500})),error(502,'CANCELLED_PDF_RENDER_FAILED'))
})

test('Excluded version line never enters the operational projection',async()=>{
 const db=openDatabase(':memory:')
 try{
  const{version}=await emitted(db)
  const removed={...version.snapshot.calculation.lines[0]!,id:'synthetic-excluded-service',included:false,name:'NÃO EXECUTAR'}
  const frozen=structuredClone(version)
  frozen.snapshot.calculation.lines.push(removed)
  const scope=operationalScope(frozen)
  assert(!scope.lines.some(line=>line.id===removed.id||line.name==='NÃO EXECUTAR'))
  assert(scope.lines.length>0)
 }finally{db.close()}
})

test('Separate SQLite connections cannot create two OS records for the same issued version',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'funix-os-two-connections-')),path=join(directory,'synthetic.sqlite')
 const firstDb=openDatabase(path),secondDb=openDatabase(path)
 try{
  const{fixture,version}=await emitted(firstDb)
  const a=new WorkOrderRepository(firstDb),b=new WorkOrderRepository(secondDb)
  const results=await Promise.all([Promise.resolve().then(()=>a.create(fixture.at.id,version.id,{authorized:true})),
    Promise.resolve().then(()=>b.create(fixture.at.id,version.id,{authorized:true}))])
  assert.equal(results[0]!.id,results[1]!.id)
  assert.equal(firstDb.prepare('SELECT COUNT(*) AS n FROM work_orders').get()!.n,1)
 }finally{firstDb.close();secondDb.close();rmSync(directory,{recursive:true,force:true})}
})

test('Manual delivery choice is independent from the estimated duration and atomic with OS issuance',async()=>{
 const db=openDatabase(':memory:')
 try{
  const {fixture,budgets,version}=await emitted(db)
  const at=fixture.at.id,repo=new AtendimentoRepository(db),orders=new WorkOrderRepository(db)
  const before=repo.get(at),sourcePdf=budgets.pdf(at,version.id),source=budgets.get(at,version.id)
  const choose={authorized:true,expectedAtendimentoRevision:before.revision}
  assert.throws(()=>orders.create(at,version.id,{...choose,deliveryChoice:'without',deliveryDate:'2026-11-27'}),error(409,'DELIVERY_CHOICE_CONFLICT'))
  assert.throws(()=>orders.create(at,version.id,{...choose,deliveryChoice:'with',deliveryDate:'2026-02-30'}),error(422,'INVALID_DELIVERY_DATE'))
  assert.throws(()=>orders.create(at,version.id,{...choose,deliveryChoice:'with'}),error(422,'INVALID_DELIVERY_DATE'))
  assert.throws(()=>orders.create(at,version.id,{...choose,deliveryChoice:'with',deliveryDate:'2026-11-27',expectedAtendimentoRevision:before.revision-1}),error(409,'VERSION_CONFLICT'))
  assert.equal(db.prepare('SELECT COUNT(*) n FROM work_orders').get()!.n,0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM atendimento_delivery_date_history').get()!.n,0)
  assert.deepEqual(repo.get(at),before)
  const input={...choose,deliveryChoice:'with',deliveryDate:'2026-11-27'}
  const first=orders.create(at,version.id,input)
  assert.equal(first.scope.deliveryDate,'2026-11-27')
  assert.equal(first.scope.deadlineDays,operationalScope(version).deadlineDays)
  assert.equal(repo.get(at).deliveryDate,'2026-11-27')
  assert.equal(repo.get(at).revision,before.revision+1)
  assert.deepEqual(orders.create(at,version.id,input),first)
  assert.throws(()=>orders.create(at,version.id,{...choose,deliveryChoice:'without'}),error(409,'OS_ALREADY_ISSUED'))
  assert.equal(db.prepare('SELECT COUNT(*) n FROM atendimento_delivery_date_history').get()!.n,1)
  assert.deepEqual(budgets.get(at,version.id),source)
  assert.deepEqual(budgets.pdf(at,version.id),sourcePdf)
 }finally{db.close()}
})

test('Optional empty delivery, explicit reissue, historical PDFs and cancellation remain independent',async()=>{
 const db=openDatabase(':memory:')
 try{
  const {fixture,budgets,version}=await emitted(db)
  const at=fixture.at.id,repo=new AtendimentoRepository(db),orders=new WorkOrderRepository(db)
  const first=orders.create(at,version.id,{authorized:true,deliveryChoice:'without',expectedAtendimentoRevision:repo.get(at).revision})
  assert.equal(first.scope.deliveryDate,null)
  assert.equal(repo.get(at).deliveryDate??null,null)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM atendimento_delivery_date_history').get()!.n,0)
  const original=Buffer.from('%PDF-1.7\noriginal synthetic\n%%EOF')
  const next=Buffer.from('%PDF-1.7\nrevision synthetic\n%%EOF')
  const cache=new WorkOrderPdfCache(db)
  cache.save(first.id,original)
  const updated=repo.update(at,{revision:repo.get(at).revision,deliveryDate:'2026-12-02'})
  const meta=()=>budgets.list(at).find(v=>v.id===version.id) as unknown as {workOrderNeedsReissue:boolean;workOrderRevision:number}
  assert.equal(meta().workOrderNeedsReissue,true)
  assert.deepEqual(orders.get(at,version.id),first)
  const request={authorized:true,deliveryChoice:'with',deliveryDate:'2026-12-02',expectedAtendimentoRevision:updated.revision,expectedRevision:1}
  const revision=orders.reissue(at,version.id,request)
  assert.equal(revision.id,first.id)
  assert.equal(revision.revision,2)
  assert.equal(revision.scope.deliveryDate,'2026-12-02')
  assert.deepEqual({...revision.scope,deliveryDate:null},first.scope)
  assert.equal(meta().workOrderNeedsReissue,false)
  assert.equal(meta().workOrderRevision,2)
  assert.throws(()=>orders.reissue(at,version.id,request),error(409,'OS_REVISION_CONFLICT'))
  assert.equal(cache.get(first.id,revision.revisionId!),null)
  cache.save(first.id,next,revision.revisionId!)
  assert.deepEqual(cache.get(first.id),original)
  assert.deepEqual(cache.get(first.id,revision.revisionId!),next)
  assert.deepEqual(cache.save(first.id,original,revision.revisionId!),next)
  assert.throws(()=>db.prepare("UPDATE work_order_revisions SET scope_json='{}'").run(),/immutable/i)
  assert.throws(()=>db.prepare('DELETE FROM work_order_revision_pdf_cache').run(),/immutable/i)
  const cleared=repo.update(at,{revision:updated.revision,deliveryDate:null})
  assert.equal(meta().workOrderNeedsReissue,true)
  const third=orders.reissue(at,version.id,{authorized:true,deliveryChoice:'without',expectedAtendimentoRevision:cleared.revision,expectedRevision:2})
  assert.equal(third.revision,3)
  assert.equal(third.scope.deliveryDate,null)
  assert.deepEqual(orders.listRevisions(at,version.id).map(o=>o.revision??1),[3,2,1])
  assert.equal(orders.get(at,version.id,2).scope.deliveryDate,'2026-12-02')
  assert.deepEqual(orders.get(at,version.id),first)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM work_orders').get()!.n,1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM atendimento_delivery_date_history').get()!.n,2)
  assert.throws(()=>db.prepare('DELETE FROM atendimento_delivery_date_history').run(),/immutable/i)
  new BudgetCancellationRepository(db).cancel(at,version.id,{})
  assert(orders.get(at,version.id,2).cancellation)
  assert.throws(()=>orders.reissue(at,version.id,{...request,expectedRevision:3}),error(409,'BUDGET_CANCELLED'))
 }finally{db.close()}
})

test('Date registered before OS issuance is reused; invalid date or concurrent changes do not overwrite it',async()=>{
 const db=openDatabase(':memory:')
 try{
  const {fixture,version}=await emitted(db),at=fixture.at.id
  const repo=new AtendimentoRepository(db),orders=new WorkOrderRepository(db)
  const before=repo.get(at)
  assert.throws(()=>repo.update(at,{revision:before.revision,deliveryDate:'2026-02-29'}),error(422,'INVALID_DELIVERY_DATE'))
  const saved=repo.update(at,{revision:before.revision,deliveryDate:'2028-02-29'})
  assert.throws(()=>orders.create(at,version.id,{authorized:true,deliveryChoice:'without',expectedAtendimentoRevision:saved.revision}),error(409,'DELIVERY_CHOICE_CONFLICT'))
  assert.throws(()=>orders.create(at,version.id,{authorized:true,deliveryChoice:'with',deliveryDate:'2028-03-01',expectedAtendimentoRevision:saved.revision}),error(409,'DELIVERY_CHOICE_CONFLICT'))
  const order=orders.create(at,version.id,{authorized:true,deliveryChoice:'with',deliveryDate:saved.deliveryDate,expectedAtendimentoRevision:saved.revision})
  assert.equal(order.scope.deliveryDate,'2028-02-29')
  assert.equal(repo.get(at).revision,saved.revision)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM atendimento_delivery_date_history').get()!.n,1)
 }finally{db.close()}
})
