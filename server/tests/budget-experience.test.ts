import test from'node:test'
import assert from'node:assert/strict'
import{randomUUID}from'node:crypto'
import{openDatabase}from'../database.ts'
import{BudgetRepository as RealBudgets}from'../budgets.ts'
import{BudgetRepository,syntheticRenderer}from'./fixtures/budget-renderer.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{budgetHistory}from'../../shared/budget-history.ts'
import{executionDeadline,InstallmentRepository}from'../budget-terms.ts'
import type{BudgetVersion}from'../../shared/pricing.ts'

test('transient PDF preview never reserves a number or writes documents; confirm is equivalent and idempotent',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),rendered:BudgetVersion[]=[]
  const repo=new RealBudgets(db,{render:async v=>{assert.equal(db.isTransaction,false);rendered.push(structuredClone(v));return syntheticRenderer(v)}})
  const input={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=repo.preview(f.at.id,input),changes=db.prepare('SELECT total_changes() AS n').get()!.n
  for(let i=0;i<2;i++)assert.match((await repo.previewPdf(f.at.id,{...input,previewToken:p.token})).toString(),/^%PDF/)
  assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,changes)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM budget_emission_attempts').get()!.n,0)
  assert.equal(repo.list(f.at.id).length,0)
  const body={...input,previewToken:p.token,idempotencyKey:randomUUID()},issued=await repo.emit(f.at.id,body)
  assert.equal(issued.documentNumber,'OR-000001')
  const temp=rendered[0]!.snapshot.document!.data,official=issued.snapshot.document!.data
  assert.equal(temp.meta.id,'PRÉVIA')
  assert.deepEqual({...temp,meta:null},{...official,meta:null})
  assert.deepEqual(await repo.emit(f.at.id,body),issued);assert.equal(rendered.length,3)
  const bytes=repo.pdf(f.at.id,issued.id),snap=repo.get(f.at.id,issued.id)
  assert.deepEqual(repo.pdf(f.at.id,issued.id),bytes);assert.deepEqual(repo.get(f.at.id,issued.id),snap)
 }finally{db.close()}
})

test('preview rejects invalid token, incomplete configuration, invalid bytes and changes during render without writes',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),input={scenarioId:f.scenario.id,negotiation:{mode:'none'}},repo=new BudgetRepository(db),p=repo.preview(f.at.id,input)
  await assert.rejects(()=>repo.previewPdf(f.at.id,{...input,previewToken:'0'.repeat(64)}),{status:409})
  const invalid=new RealBudgets(db,{render:async()=>Buffer.from('invalid')})
  await assert.rejects(()=>invalid.previewPdf(f.at.id,{...input,previewToken:p.token}))
  const racing=new RealBudgets(db,{render:async v=>{const config=new InstallmentRepository(db),c=config.get();config.save({revision:c.revision,rates:{...c.rates,tres:'9'}});return syntheticRenderer(v)}})
  await assert.rejects(()=>racing.previewPdf(f.at.id,{...input,previewToken:p.token}),{status:409})
  f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,capacity:null}})
  const next=repo.preview(f.at.id,input)
  await assert.rejects(()=>repo.previewPdf(f.at.id,{...input,previewToken:next.token}),{status:422})
  assert.equal(repo.list(f.at.id).length,0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM budget_emission_attempts').get()!.n,0)
 }finally{db.close()}
})

test('per-scenario presentation letters use frozen IDs, independent of current names/deletion and global legacy labels',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),repo=new BudgetRepository(db),first=f.scenarios.list(f.at.id)[0]!,second=f.scenarios.create(f.at.id,{name:'Nome editável',duplicateFrom:first.id,sourceRevision:first.revision})
  const saved=[]
  for(const scenario of[first,second,first,second,first]){const input={scenarioId:scenario.id,negotiation:{mode:'none'}},p=repo.preview(f.at.id,input);saved.push(await repo.emit(f.at.id,{...input,previewToken:p.token,idempotencyKey:randomUUID()}))}
  const before=saved.map(v=>({snapshot:repo.get(f.at.id,v.id),pdf:repo.pdf(f.at.id,v.id)}))
  const grouped=budgetHistory(repo.list(f.at.id)as unknown as {id:string;sequence:number;createdAt:string;scenarioId:string;scenarioName:string;label:string}[])
  assert.deepEqual(grouped.map(g=>g.name),['Cenário 1','Cenário 2'])
  assert.deepEqual(grouped.map(g=>g.versions.map(v=>v.scenarioVersion)),[['A','B','C'],['A','B']])
  assert.deepEqual(grouped[0]!.versions.map(v=>v.label),['A','C','E'])
  f.scenarios.update(f.at.id,second.id,{revision:second.revision,name:'Renomeado'})
  // Removing live rows is not used to group historical documents.
  db.prepare('DELETE FROM scenarios WHERE id=?').run(second.id)
  assert.deepEqual(budgetHistory(repo.list(f.at.id)as unknown as Parameters<typeof budgetHistory>[0]),grouped)
  saved.forEach((v,i)=>{assert.deepEqual(repo.get(f.at.id,v.id),before[i]!.snapshot);assert.deepEqual(repo.pdf(f.at.id,v.id),before[i]!.pdf)})
 }finally{db.close()}
})

test('shared deadline uses existing automatic/manual semantics, never zero or a fabricated suggestion',()=>{
 assert.equal(executionDeadline(undefined,'5').effectiveDays,5)
 assert.equal(executionDeadline({mode:'manual',manualDays:3},'8').effectiveDays,3)
 for(const value of[null,'0','-1','1.5','Infinity'])assert.equal(executionDeadline(undefined,value).effectiveDays,null)
 assert.equal(executionDeadline({mode:'manual',manualDays:7},null).effectiveDays,7)
})
