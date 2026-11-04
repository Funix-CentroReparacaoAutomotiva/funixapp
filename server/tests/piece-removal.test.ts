import test from'node:test'
import assert from'node:assert/strict'
import{mkdtempSync,rmSync}from'node:fs'
import{join}from'node:path'
import{tmpdir}from'node:os'
import{openDatabase}from'../database.ts'
import{CommercialRepository}from'../commercial.ts'
import{ComponentRepository}from'../components.ts'
import{ScenarioRepository}from'../scenarios.ts'
import{BudgetRepository}from'./fixtures/budget-renderer.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
const conflict=(e:unknown)=>(e as{status:number}).status===409
function guard(f:ReturnType<typeof commercialFixture>){return{compositionRevision:f.pricing.settings(f.at.id).revision,scenarios:f.scenarios.list(f.at.id).map(s=>({id:s.id,revision:s.revision}))}}
for(const kind of ['flags','component','new-scenario','deleted-scenario','service']as const)test(`Stage2 global removal rejects changed ${kind} since confirmation, atomically preserving both targets`,()=>{
 const db=openDatabase(':memory:');try{
  const f=commercialFixture(db),other=f.commercial.add(f.at.id,{pieceCodes:['alma_para_choque_dianteiro']}).find(p=>p.pieceId!==f.item.pieceId)!,parts=new ComponentRepository(db)
  const two=f.scenarios.create(f.at.id,{name:'two',duplicateFrom:f.scenarios.list(f.at.id)[0]!.id,sourceRevision:f.scenarios.list(f.at.id)[0]!.revision})
  const request={...guard(f),pieces:[{id:f.item.id,revision:f.item.revision},{id:other.id,revision:other.revision}]}
  if(kind==='flags')f.scenarios.update(f.at.id,two.id,{revision:two.revision,pieceFlags:{[f.item.id]:false}})
  if(kind==='component')parts.save(f.at.id,{pieceId:f.item.id,name:'QA',quantity:'0.125',manualPrice:'1',notes:''})
  if(kind==='new-scenario')f.scenarios.create(f.at.id,{name:'third'})
  if(kind==='deleted-scenario')f.scenarios.remove(f.at.id,two.id,{revision:two.revision})
  if(kind==='service')f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,notes:'changed'})
  const before=JSON.stringify({items:f.commercial.list(f.at.id),parts:parts.list(f.at.id),scenarios:f.scenarios.list(f.at.id)})
  assert.throws(()=>f.commercial.removeMany(f.at.id,request),conflict)
  assert.equal(JSON.stringify({items:f.commercial.list(f.at.id),parts:parts.list(f.at.id),scenarios:f.scenarios.list(f.at.id)}),before)
 }finally{db.close()}
})
test('Stage2 guard, identity validation and second target failure never partially remove Ambos',()=>{
 const db=openDatabase(':memory:');try{const f=commercialFixture(db),before=JSON.stringify(f.commercial.list(f.at.id)),p={id:f.item.id,revision:f.item.revision};assert.throws(()=>f.commercial.remove(f.at.id,p.id,{revision:p.revision}));for(const pieces of [[p,p],[p,{id:'foreign',revision:1}],[]])assert.throws(()=>f.commercial.removeMany(f.at.id,{...guard(f),pieces}));assert.equal(JSON.stringify(f.commercial.list(f.at.id)),before);assert.throws(()=>f.commercial.removeMany(f.at.id,{...guard(f),scenarios:[],pieces:[p]}))}finally{db.close()}
})
test('Stage2 batch deletion cascades only selected draft children/flags; IDs, fractions, SQLite restart and emitted snapshot/PDF remain intact',async ()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-stage2-'));let db=openDatabase(join(dir,'test.sqlite'))
 try{
  const f=commercialFixture(db),parts=new ComponentRepository(db),b=new BudgetRepository(db),request={scenarioId:f.scenario.id,negotiation:{mode:'none'}},preview=b.preview(f.at.id,request),issued=(await b.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:'stage2-immutable-budget'})),pdf=b.pdf(f.at.id,issued.id)
  const extra=f.commercial.add(f.at.id,{pieceCodes:['alma_para_choque_dianteiro','para_choque_dianteiro']}).filter(p=>p.id!==f.item.id)
  const child=parts.save(f.at.id,{pieceId:f.item.id,name:'Remove',quantity:'0.125',manualPrice:'1',notes:''}),keep=parts.save(f.at.id,{pieceId:extra[1]!.id,name:'Keep',quantity:'0.125',manualPrice:'1.000001',notes:'unchanged'})
  const before=JSON.stringify(f.commercial.list(f.at.id).find(p=>p.id===extra[1]!.id)),two=f.scenarios.create(f.at.id,{name:'two',duplicateFrom:f.scenarios.list(f.at.id)[0]!.id,sourceRevision:f.scenarios.list(f.at.id)[0]!.revision})
  const result=f.commercial.removeMany(f.at.id,{...guard(f),pieces:[{id:f.item.id,revision:f.item.revision},{id:extra[0]!.id,revision:extra[0]!.revision}]});assert.equal(result.removedIds.length,2)
  assert.equal(JSON.stringify(f.commercial.list(f.at.id).find(p=>p.id===extra[1]!.id)),before);assert(!parts.list(f.at.id).some(p=>p.id===child.id));assert.deepEqual(parts.list(f.at.id).find(p=>p.id===keep.id),keep)
  assert.equal(f.scenarios.list(f.at.id).length,2);assert(f.scenarios.list(f.at.id).some(s=>s.id===two.id));for(const s of f.scenarios.list(f.at.id))assert(!Object.hasOwn(s.pieceFlags,f.item.id))
  assert.deepEqual(b.get(f.at.id,issued.id),issued);assert.deepEqual(b.pdf(f.at.id,issued.id),pdf);assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  db.close();db=openDatabase(join(dir,'test.sqlite'));assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,issued.id),pdf);assert.equal(new CommercialRepository(db).list(f.at.id).length,1);assert.equal(new ComponentRepository(db).list(f.at.id)[0]!.quantity,'0.125');assert.equal(new ScenarioRepository(db).list(f.at.id).length,2)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
