import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {ComponentRepository} from '../components.ts'
import {budgetPdf} from '../pdf.ts'
import {BudgetRepository} from '../budgets.ts'
import {negotiationInput} from '../../src/negotiation.ts'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'

test('MR options and global selection are explicit, revision protected and preserved by legacy parameter/configuration writes',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db,false),before=db.prepare('SELECT * FROM component_items').all()
  assert.equal(f.pricing.get().config.resaleMultipliers,undefined)
  assert.equal(f.pricing.settings(f.at.id).settings.mrId,undefined)
  const old=f.pricing.settings(f.at.id)
  assert.throws(()=>f.pricing.saveSettings(f.at.id,{revision:old.revision,mrId:'not-registered'}))
  f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,resaleMultipliers:[{id:'mr-qa',name:'MR sintético',factor:'1.2'}]}})
  f.pricing.saveSettings(f.at.id,{revision:old.revision,mrId:'mr-qa'})
  assert.equal(f.pricing.settings(f.at.id).settings.mrId,'mr-qa')
  assert.throws(()=>f.pricing.saveSettings(f.at.id,{revision:old.revision,mrId:null}))
  const current=f.pricing.settings(f.at.id)
  f.pricing.saveSettings(f.at.id,{revision:current.revision,tableId:'table',colorId:'color',riskId:'risk'})
  assert.equal(f.pricing.settings(f.at.id).settings.mrId,'mr-qa')
  f.pricing.save({revision:f.pricing.get().revision,config:f.config})
  assert.equal(f.pricing.get().config.resaleMultipliers?.[0]?.factor,'1.2')
  assert.deepEqual(db.prepare('SELECT * FROM component_items').all(),before)
 }finally{db.close()}
})

test('global MR replaces divergent FCTs, ceilings units before fractional quantity, never changes services, rows or previous emissions',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db,false),components=new ComponentRepository(db),budgets=new BudgetRepository(db)
  const a=components.save(f.at.id,{pieceId:f.item.id,name:'QA A',quantity:'0.25',manualPrice:'10.01',fct:'99',notes:'Legado A'}),b=components.save(f.at.id,{pieceId:f.item.id,name:'QA B',quantity:'2',manualPrice:'10.01',fct:'0.01',notes:'Legado B'})
  const before=db.prepare('SELECT * FROM component_items').all(),request={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const pending=budgets.preview(f.at.id,request)
  assert.equal(pending.canEmit,false);assert.equal(pending.snapshot.calculation.componentSubtotal,null);assert(pending.snapshot.calculation.errors.some(e=>e.includes('MR do Atendimento')))
  f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,resaleMultipliers:[{id:'mr',name:'MR sintético',factor:'1.2'},{id:'zero',name:'MR zero sintético',factor:'0'}]}})
  f.pricing.saveSettings(f.at.id,{revision:f.pricing.settings(f.at.id).revision,mrId:'mr'})
  const preview=budgets.preview(f.at.id,request),c=preview.snapshot.calculation
  assert.equal(c.componentSubtotal,'27.1125');assert.equal(c.originalServiceSubtotal,'300.15')
  assert.deepEqual(c.lines.filter(l=>l.kind==='component').map(l=>l.unit),['12.05','12.05'])
  assert.equal(c.serviceNet,'300.15');assert.equal(c.adjustment,'0')
  const version=budgets.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:randomUUID()}),pdf=budgets.pdf(f.at.id,version.id)
  components.save(f.at.id,{revision:a.revision,pieceId:a.pieceId,name:a.name,quantity:'0.5',manualPrice:a.manualPrice,notes:a.notes},a.id)
  assert.equal(components.list(f.at.id).find(c=>c.id===a.id)!.fct,'99')
  f.pricing.saveSettings(f.at.id,{revision:f.pricing.settings(f.at.id).revision,mrId:'zero'})
  assert.equal(budgets.preview(f.at.id,request).snapshot.calculation.componentSubtotal,'0')
  assert.deepEqual(budgets.get(f.at.id,version.id),version);assert.deepEqual(budgets.pdf(f.at.id,version.id),pdf)
  assert.deepEqual(db.prepare('SELECT * FROM component_items WHERE id=?').get(b.id),before.find(c=>c.id===b.id))
 }finally{db.close()}
})

test('component creation is idempotent after lost response; stale edits cannot duplicate or overwrite newer data',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),repo=new ComponentRepository(db),input={clientId:randomUUID(),pieceId:f.item.id,name:'QA componente',quantity:'0.25',manualPrice:'0',notes:''}
  const first=repo.save(f.at.id,input),revision=f.pricing.settings(f.at.id).revision
  assert.deepEqual(repo.save(f.at.id,input),first);assert.equal(f.pricing.settings(f.at.id).revision,revision);assert.equal(repo.list(f.at.id).length,1)
  assert.throws(()=>repo.save(f.at.id,{...input,name:'Outro'}),e=>(e as {code:string}).code==='VERSION_CONFLICT')
  const updated=repo.save(f.at.id,{...input,revision:first.revision,manualPrice:'10'},first.id)
  assert.throws(()=>repo.save(f.at.id,{...input,revision:first.revision},first.id),e=>(e as {code:string}).code==='VERSION_CONFLICT')
  assert.equal(repo.list(f.at.id)[0]!.manualPrice,updated.manualPrice)
 }finally{db.close()}
})

test('UI zero maps both visible negotiation choices to none; general target retains existing API contract',()=>{
 for(const mode of ['discount','adjust'] as const)for(const value of ['0','0,00','000.000'])assert.deepEqual(negotiationInput({mode,value,acknowledgeResidual:false}),{mode:'none'})
 assert.deepEqual(negotiationInput({mode:'adjust',value:'350,25',acknowledgeResidual:false}),{mode:'adjust',value:'350.25',acknowledgeResidual:false,valueIncludesComponents:true})
})

test('pre-MR schema-1 snapshot/PDF with individual FCT remains readable byte-for-byte after selecting global MR',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db,false),parts=new ComponentRepository(db),repo=new BudgetRepository(db)
  parts.save(f.at.id,{pieceId:f.item.id,name:'Histórico sintético',quantity:'2',manualPrice:'10',fct:'1.2',notes:'Legado'})
  // Representative persisted V6 record: the old engine used FCT 1.2 => 12 × 2.
  // Build the historical snapshot explicitly; do not ask the new engine to emulate FCT.
  const snapshot=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}}).snapshot
  const line=snapshot.calculation.lines.find(l=>l.kind==='component')!
  Object.assign(line,{unit:'12',finalUnit:'12',total:'24',factors:{manualPrice:'10',FCT:'1.2'}})
  Object.assign(snapshot.calculation,{errors:[],componentSubtotal:'24',total:'324.15',pieceTotals:[{pieceId:f.item.id,total:'324.15'}]})
  delete snapshot.calculation.serviceNet;delete snapshot.calculation.adjustment
  const createdAt=new Date().toISOString();snapshot.issuedAt=createdAt
  const historical={id:randomUUID(),atendimentoId:f.at.id,sequence:1,label:'A',createdAt,snapshot}
  const bytes=budgetPdf(historical)
  db.prepare('INSERT INTO budget_versions(id,atendimento_id,sequence,label,created_at,snapshot,pdf,idempotency_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(historical.id,f.at.id,1,'A',createdAt,JSON.stringify(snapshot),bytes,randomUUID(),'qa-historical')
  const raw=db.prepare('SELECT * FROM component_items').all()
  f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,resaleMultipliers:[{id:'mr',name:'MR sintético',factor:'2'}]}})
  f.pricing.saveSettings(f.at.id,{revision:f.pricing.settings(f.at.id).revision,mrId:'mr'})
  assert.equal(repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}}).snapshot.calculation.componentSubtotal,'40')
  assert.deepEqual(repo.get(f.at.id,historical.id),historical);assert.deepEqual(repo.pdf(f.at.id,historical.id),bytes)
  assert.deepEqual(db.prepare('SELECT * FROM component_items').all(),raw)
 }finally{db.close()}
})
