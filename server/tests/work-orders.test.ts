import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from '../database.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {WorkOrderRepository,operationalScope} from '../work-orders.ts'
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
  assert.throws(()=>orders.create(fixture.at.id,version.id,{authorized:true,operator:'invented'}),error(400,'INVALID_INPUT'))
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
  assert.equal(budgets.list(fixture.at.id).find(v=>v.id===version.id)?.workOrderNumber,first.number)
 }finally{db.close()}
})
