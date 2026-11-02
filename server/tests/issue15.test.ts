import{commercialFixture as legacyFixture}from'./fixtures/pre-curation/fixture.ts'
import{BudgetRepository as LegacyBudgetRepository}from'./fixtures/pre-curation/budgets.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {openDatabase} from '../database.ts'
import {migrate as baselineV5} from './fixtures/m1_5_migrations.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {ScenarioRepository} from '../scenarios.ts'
import {CommercialRepository} from '../commercial.ts'
import {BudgetRepository} from '../budgets.ts'
import {ComponentRepository} from '../components.ts'
import {Q} from '../exact.ts'
import type {ComponentItem} from '../../shared/pricing.ts'

function component(f:{at:{id:string};item:{id:string}},db:DatabaseSync,values:Record<string,unknown>={}){
 return new ComponentRepository(db).save(f.at.id,{pieceId:f.item.id,name:'Componente QA',quantity:'0.25',manualPrice:'40',notes:'Sintético',...values})
}
function fields(p:ComponentItem){return {revision:p.revision,pieceId:p.pieceId,name:p.name,quantity:p.quantity,manualPrice:p.manualPrice,notes:p.notes}}
const totalDeal=(value:string,acknowledgeResidual=false)=>({mode:'adjust',value,acknowledgeResidual,valueIncludesComponents:true})

test('V5 additive upgrade and scenario deletion preserve composition, snapshot/PDF, flags, fractional quantities and never reuse scenario numbers',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-issue15-')),file=join(dir,'test.sqlite')
 let db=new DatabaseSync(file)
 try{
  db.exec('PRAGMA foreign_keys=ON');baselineV5(db)
  const f=legacyFixture(db),part=component(f,db),s=f.scenarios
  const one=s.list(f.at.id)[0]!
  function v5Copy(position:number){
   const id=randomUUID();db.prepare('INSERT INTO scenarios(id,atendimento_id,name,position,created_at) VALUES(?,?,?,?,?)').run(id,f.at.id,'Cópia V5',position,new Date().toISOString())
   for(const table of ['scenario_piece_flags','scenario_service_flags','scenario_component_flags'])db.prepare(`INSERT INTO ${table} SELECT ?,${table==='scenario_piece_flags'?'piece_id':table==='scenario_service_flags'?'service_id':'component_id'},enabled FROM ${table} WHERE scenario_id=?`).run(id,one.id)
   return s.list(f.at.id).find(v=>v.id===id)!
  }
  const two=v5Copy(2),three=v5Copy(3)
  const repo=new LegacyBudgetRepository(db),input={scenarioId:two.id,negotiation:{mode:'none'}},preview=repo.preview(f.at.id,input)
  const payload={...input,previewToken:preview.token,idempotencyKey:randomUUID()},version=repo.emit(f.at.id,payload),pdf=repo.pdf(f.at.id,version.id)
  const rawAt=db.prepare('SELECT * FROM atendimentos').all(),rawPiece=db.prepare('SELECT id,atendimento_id,piece_id,diagnosis_id,notes,enabled,revision,created_at,updated_at FROM diagnosis_items').all(),rawServices=db.prepare('SELECT * FROM diagnosis_services').all(),rawFlags=s.list(f.at.id)
  db.close();db=openDatabase(file)
  assert.deepEqual(db.prepare('SELECT * FROM atendimentos').all(),rawAt);assert.deepEqual(db.prepare('SELECT id,atendimento_id,piece_id,diagnosis_id,notes,enabled,revision,created_at,updated_at FROM diagnosis_items').all(),rawPiece);assert.deepEqual(db.prepare('SELECT * FROM diagnosis_services').all(),rawServices)
  const scenarios=new ScenarioRepository(db);assert.deepEqual(scenarios.list(f.at.id),rawFlags)
  scenarios.remove(f.at.id,two.id,{revision:two.revision})
  assert.deepEqual(scenarios.list(f.at.id),[one,three])
  for(const table of ['scenario_piece_flags','scenario_service_flags','scenario_component_flags'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE scenario_id=?`).get(two.id)!.n,0)
  assert.deepEqual(new BudgetRepository(db).get(f.at.id,version.id),version);assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,version.id),pdf)
  assert.equal(new BudgetRepository(db).emit(f.at.id,payload).id,version.id)
  assert.equal(new ComponentRepository(db).list(f.at.id)[0]!.id,part.id)
  const four=scenarios.create(f.at.id,{name:'Quatro'});assert.equal(four.position,4);scenarios.remove(f.at.id,four.id,{revision:four.revision})
  assert.equal(scenarios.create(f.at.id,{name:'Cinco'}).position,5)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  const expected=scenarios.list(f.at.id);db.close();db=openDatabase(file)
  assert.deepEqual(new ScenarioRepository(db).list(f.at.id),expected)
  assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,version.id),pdf)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})

test('scenario delete rejects last, stale revision, wrong Atendimento, unknown fields and duplicate delete without mutating survivors',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),s=f.scenarios,first=s.list(f.at.id)[0]!
  assert.throws(()=>s.remove(f.at.id,first.id,{revision:first.revision}),e=>(e as {code:string}).code==='LAST_SCENARIO')
  const second=s.create(f.at.id,{name:'Dois'}),before=s.list(f.at.id)
  assert.throws(()=>s.remove(f.at.id,second.id,{}));assert.throws(()=>s.remove(f.at.id,second.id,{revision:second.revision,atendimentoId:'foreign'}))
  s.update(f.at.id,second.id,{revision:second.revision,name:'Atualizado'})
  assert.throws(()=>s.remove(f.at.id,second.id,{revision:second.revision}),e=>(e as {code:string}).code==='VERSION_CONFLICT')
  assert.throws(()=>s.remove('foreign',second.id,{revision:2}))
  s.remove(f.at.id,second.id,{revision:2});assert.throws(()=>s.remove(f.at.id,second.id,{revision:2}))
  assert.deepEqual(s.list(f.at.id),[before[0]])
  assert.equal(new CommercialRepository(db).list(f.at.id)[0]!.services[0]!.quantity,'3')
 }finally{db.close()}
})

test('piece totals are exact backend outputs, honor parent/child flags, keep real zero and expose unknown/empty included pieces as pending',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),repo=new BudgetRepository(db),parts=new ComponentRepository(db)
  const p=component(f,db),input={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  let c=repo.preview(f.at.id,input).snapshot.calculation;assert.equal(c.pieceTotals![0]!.total,'320.15')
  let s=f.scenarios.list(f.at.id)[0]!
  s=f.scenarios.update(f.at.id,s.id,{revision:s.revision,serviceFlags:{[f.item.services[0]!.id]:false}})
  assert.equal(repo.preview(f.at.id,input).snapshot.calculation.pieceTotals![0]!.total,'20')
  parts.save(f.at.id,{...fields(p),manualPrice:'0'},p.id)
  assert.equal(repo.preview(f.at.id,input).snapshot.calculation.pieceTotals![0]!.total,'0')
  const zero=parts.list(f.at.id)[0]!;parts.save(f.at.id,{...fields(zero),manualPrice:null},zero.id)
  assert.equal(repo.preview(f.at.id,input).snapshot.calculation.pieceTotals![0]!.total,null)
  s=f.scenarios.list(f.at.id)[0]!;s=f.scenarios.update(f.at.id,s.id,{revision:s.revision,componentFlags:{[p.id]:false}})
  assert.equal(repo.preview(f.at.id,input).snapshot.calculation.pieceTotals![0]!.total,null)
  f.scenarios.update(f.at.id,s.id,{revision:s.revision,pieceFlags:{[f.item.id]:false}})
  assert.equal(repo.preview(f.at.id,input).snapshot.calculation.pieceTotals![0]!.total,'0')
 }finally{db.close()}
})

test('discount and whole-budget targets reduce or increase only services, never alter components, and do not emit while previewing',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),repo=new BudgetRepository(db);component(f,db)
  const discount=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'discount',value:'10',acknowledgeResidual:false}})
  assert.equal(discount.snapshot.calculation.total,'310.15');assert.equal(discount.snapshot.calculation.componentSubtotal,'20')
  const low=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:totalDeal('310.15')})
  assert.equal(low.snapshot.calculation.negotiation.mode,'adjust');assert.equal(low.snapshot.calculation.target,'290.15');assert.equal(low.snapshot.calculation.total,'310.15');assert.equal(low.snapshot.requestedTotal,'310.15')
  const high=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:totalDeal('380',true)})
  assert.equal(high.snapshot.calculation.componentSubtotal,'20');assert.equal(high.snapshot.calculation.total,'380');assert.equal(high.canEmit,true)
  assert.equal(repo.list(f.at.id).length,0)
  assert.throws(()=>repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:totalDeal('19.99')}),/inferior.*componentes/)
  assert.throws(()=>repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'discount',value:'9999',valueIncludesComponents:true}}))
 }finally{db.close()}
})

test('whole-budget translation preserves generated fractional digits beyond six and retains component quantity',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),repo=new BudgetRepository(db);f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,resaleMultipliers:[{id:'mr',name:'MR sintético',factor:'1'}]}});component(f,db,{quantity:'0.000001',manualPrice:'0.05'})
  const preview=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:totalDeal('300')})
  assert.equal(preview.snapshot.calculation.componentSubtotal,'0.00000005')
  assert.equal(preview.snapshot.calculation.target,'299.99999995')
  assert.equal(preview.snapshot.calculation.total,'300');assert(preview.canEmit)
  const input={scenarioId:f.scenario.id,negotiation:totalDeal('300'),previewToken:preview.token,idempotencyKey:randomUUID()}
  const emitted=repo.emit(f.at.id,input);assert.equal(emitted.snapshot.composition.components[0]!.quantity,'0.000001')
  assert.equal(repo.emit(f.at.id,input).id,emitted.id)
 }finally{db.close()}
})

test('residual and consent use effective preview total; excessive residual and missing component price block issuance',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),repo=new BudgetRepository(db);const p=component(f,db)
  const unaccepted=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:totalDeal('381.03')})
  assert.notEqual(unaccepted.snapshot.calculation.residual,'0');assert.equal(unaccepted.canEmit,false)
  const accepted=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:totalDeal('381.03',true)})
  assert(accepted.canEmit);assert.notEqual(accepted.snapshot.calculation.total,'381.03')
  assert.equal(Q.from('381.03').sub(Q.from(accepted.snapshot.calculation.total!)).toString(),accepted.snapshot.calculation.residual)
  const old=f.commercial.list(f.at.id)[0]!;f.commercial.updateDiagnosis(f.at.id,old.id,{revision:old.revision,services:old.services.map(l=>({...l,quantity:'100'}))})
  const excess=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:totalDeal('10027.5',true)})
  assert.equal(excess.canEmit,false);assert(excess.snapshot.calculation.errors.some(e=>e.includes('superior a R$ 0,50')))
  new ComponentRepository(db).save(f.at.id,{...fields(p),manualPrice:null},p.id)
  assert.throws(()=>repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:totalDeal('381.03')}),/componentes pendente/)
 }finally{db.close()}
})

test('whole-budget preview rejects stale components at emission; legacy adjust still targets service subtotal',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),repo=new BudgetRepository(db),p=component(f,db)
  const request={scenarioId:f.scenario.id,negotiation:totalDeal('310.15')},preview=repo.preview(f.at.id,request)
  const payload={...request,previewToken:preview.token,idempotencyKey:randomUUID()}
  new ComponentRepository(db).save(f.at.id,{...fields(p),manualPrice:'42'},p.id)
  assert.throws(()=>repo.emit(f.at.id,payload),e=>(e as {code:string}).code==='VERSION_CONFLICT')
  assert.equal(repo.list(f.at.id).length,0)
  const fresh=repo.preview(f.at.id,request);assert.equal(fresh.snapshot.calculation.total,'310.15');assert.equal(fresh.snapshot.calculation.target,'289.15')
  const legacy=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'adjust',value:'289.15',acknowledgeResidual:false}})
  assert.equal(legacy.snapshot.calculation.total,'310.15');assert.equal(legacy.snapshot.requestedTotal,undefined)
 }finally{db.close()}
})
