import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
import {openDatabase,backupDatabase} from '../database.ts'
import {BudgetRepository,versionLabel} from './fixtures/budget-renderer.ts'
import {commercialFixture} from './fixtures/commercial.ts'

test('new budget snapshots use numeric scenario order without renaming legacy data or emitted version letters',async ()=>{
 const db=openDatabase(':memory:')
 try {
  const f=commercialFixture(db),repo=new BudgetRepository(db)
  f.scenarios.update(f.at.id,f.scenario.id,{revision:f.scenario.revision,name:'Nome legado A'})
  const original=f.scenarios.list(f.at.id)[0]!
  const copy=f.scenarios.create(f.at.id,{name:'Nome interno B',duplicateFrom:original.id,sourceRevision:original.revision})
  const emitted=[]
  for(const [index,scenario] of [original,copy].entries()){
   const input={scenarioId:scenario.id,negotiation:{mode:'none'}},preview=repo.preview(f.at.id,input)
   assert.equal(preview.snapshot.scenarioName,`Cenário ${index+1}`)
   assert.equal(preview.snapshot.calculation.scenarioName,`Cenário ${index+1}`)
   const version=(await repo.emit(f.at.id,{...input,previewToken:preview.token,idempotencyKey:randomUUID()}))
   assert.equal(version.label,index===0?'A':'B');emitted.push(version)
  }
  assert.deepEqual(f.scenarios.list(f.at.id).map(s=>s.name),['Nome legado A','Nome interno B'])
  const pdf=repo.pdf(f.at.id,emitted[0]!.id)
  f.scenarios.update(f.at.id,original.id,{revision:original.revision,name:'Outro nome interno'})
  assert.deepEqual(repo.get(f.at.id,emitted[0]!.id),emitted[0]);assert.deepEqual(repo.pdf(f.at.id,emitted[0]!.id),pdf)
 }finally{db.close()}
})

test('commercial identity is globally sequential, distinct from UUID and frozen filename',async ()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),repo=new BudgetRepository(db)
  f.atendimentos.update(f.at.id,{revision:f.at.revision,plate:'QUM-7553'})
  const input={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const p=repo.preview(f.at.id,input)
  const first=(await repo.emit(f.at.id,{...input,previewToken:p.token,idempotencyKey:randomUUID()}))
  assert.equal(first.documentNumber,'OR-000001')
  assert.equal(first.filename,'QUM7553 - Orçamento FUNIX - 1.pdf')
  const again=(await repo.emit(f.at.id,{...input,previewToken:p.token,idempotencyKey:randomUUID()}))
  assert.equal(again.documentNumber,'OR-000002')
  const other=f.atendimentos.create({phone:'31999999999',plate:'',name:'Outra pessoa'})
  const op=new BudgetRepository(db)
  const scenario=f.scenarios.list(f.at.id)[0]!
  const copy=f.scenarios.create(f.at.id,{name:'Alternativa',duplicateFrom:scenario.id,sourceRevision:scenario.revision})
  const pp=op.preview(f.at.id,{scenarioId:copy.id,negotiation:{mode:'none'}})
  const third=(await op.emit(f.at.id,{scenarioId:copy.id,negotiation:{mode:'none'},previewToken:pp.token,idempotencyKey:randomUUID()}))
  assert.equal(third.documentNumber,'OR-000003')
  assert.equal(other.plate,'')
  assert.deepEqual(repo.get(f.at.id,first.id),first)
  assert.deepEqual(repo.list(f.at.id).map(v=>v.documentNumber),['OR-000003','OR-000002','OR-000001'])
  const priorPdf=repo.pdf(f.at.id,first.id)
  const changed=f.atendimentos.get(f.at.id)
  f.atendimentos.update(f.at.id,{revision:changed.revision,plate:'ABC1234'})
  assert.equal(repo.get(f.at.id,first.id).filename,'QUM7553 - Orçamento FUNIX - 1.pdf')
  assert.deepEqual(repo.pdf(f.at.id,first.id),priorPdf)
 }finally{db.close()}
})

test('N immutable budget versions include 26 Z/27 AA; PDF bytes and snapshots survive all live edits and replay',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'funix-versions-')),file=join(directory,'test.sqlite')
 let db=openDatabase(file)
 try {
  const f=commercialFixture(db),repo=new BudgetRepository(db),input={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const preview=repo.preview(f.at.id,input);assert.equal(preview.canEmit,true)
  const firstPayload={...input,previewToken:preview.token,idempotencyKey:randomUUID()},first=(await repo.emit(f.at.id,firstPayload)),pdf=repo.pdf(f.at.id,first.id)
  assert.match(pdf.subarray(0,8).toString(),/^%PDF-1.7/);assert.match(pdf.toString('latin1'),/\/ToUnicode/);assert.match(pdf.toString('latin1'),/\/FontFile2/)
  assert.equal(first.snapshot.calculation.total,'300.15')
  for(let i=2;i<=27;i++){
   const p=repo.preview(f.at.id,input),v=(await repo.emit(f.at.id,{...input,previewToken:p.token,idempotencyKey:randomUUID()}))
   assert.equal(v.sequence,i);if(i===26)assert.equal(v.label,'Z');if(i===27)assert.equal(v.label,'AA')
  }
  assert.equal(repo.list(f.at.id).length,27);assert.equal(versionLabel(703),'AAA')
  const backup=join(directory,'backup.sqlite');await backupDatabase(db,backup)
  const restored=openDatabase(backup)
  try{assert.equal(new BudgetRepository(restored).list(f.at.id).length,27);assert.deepEqual(new BudgetRepository(restored).pdf(f.at.id,first.id),pdf)}finally{restored.close()}
  assert.throws(()=>db.prepare("UPDATE budget_versions SET label='mutated' WHERE id=?").run(first.id),/immutable/)
  assert.throws(()=>db.prepare('DELETE FROM budget_versions WHERE id=?').run(first.id),/immutable/)
  f.atendimentos.update(f.at.id,{revision:f.at.revision,name:'Alterado após emissão'})
  f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,capacity:'1',services:[{...f.config.services[0]!,base:'999'}]}})
  f.commercial.remove(f.at.id,f.item.id,{revision:f.item.revision,compositionRevision:f.pricing.settings(f.at.id).revision,scenarios:f.scenarios.list(f.at.id).map(s=>({id:s.id,revision:s.revision}))})
  assert.deepEqual(repo.get(f.at.id,first.id),first);assert.deepEqual(repo.pdf(f.at.id,first.id),pdf)
  assert.equal((await repo.emit(f.at.id,firstPayload)).id,first.id)
  await assert.rejects(async ()=>(await repo.emit(f.at.id,{...firstPayload,negotiation:{mode:'discount',value:'1',acknowledgeResidual:false}})))
  db.close();db=openDatabase(file)
  assert.deepEqual(new BudgetRepository(db).get(f.at.id,first.id),first)
  assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,first.id),pdf)
 }finally{db.close();rmSync(directory,{recursive:true,force:true})}
})

test('stale previews, missing energy/capacity and wrong-parent requests cannot issue or consume sequence numbers',async ()=>{
 const db=openDatabase(':memory:')
 try {
  const f=commercialFixture(db),repo=new BudgetRepository(db),input={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const p=repo.preview(f.at.id,input)
  f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,notes:'Mudança global'})
  await assert.rejects(async ()=>(await repo.emit(f.at.id,{...input,previewToken:p.token,idempotencyKey:randomUUID()})))
  assert.equal(repo.list(f.at.id).length,0)
  f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,capacity:null}})
  const missing=repo.preview(f.at.id,input);assert.equal(missing.canEmit,false);assert(missing.snapshot.calculation.errors.some(e=>e.includes('Capacidade')))
  await assert.rejects(async ()=>(await repo.emit(f.at.id,{...input,previewToken:missing.token,idempotencyKey:randomUUID()})))
  const other=f.atendimentos.create({phone:'456'})
  assert.throws(()=>repo.preview(other.id,input))
  f.pricing.save({revision:f.pricing.get().revision,config:f.config})
  const fresh=repo.preview(f.at.id,input),v=(await repo.emit(f.at.id,{...input,previewToken:fresh.token,idempotencyKey:randomUUID()}))
  assert.equal(v.sequence,1)
  assert.throws(()=>repo.get(other.id,v.id));assert.throws(()=>repo.pdf(other.id,v.id))
 }finally{db.close()}
})

test('two separate Node processes serialize emission sequencing in one SQLite file',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'funix-concurrent-')),file=join(directory,'commercial.sqlite')
 try {
  const db=openDatabase(file),f=commercialFixture(db),preview=new BudgetRepository(db).preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}});db.close()
  const child=join(directory,'issue.mjs')
  writeFileSync(child,`import {writeFileSync} from 'node:fs'; import {openDatabase} from ${JSON.stringify(new URL('../database.ts',import.meta.url).href)}; import {BudgetRepository} from ${JSON.stringify(new URL('./fixtures/budget-renderer.ts',import.meta.url).href)}; const [file,at,scenarioId,token,key,out]=process.argv.slice(2); const db=openDatabase(file); const version=await new BudgetRepository(db).emit(at,{scenarioId,negotiation:{mode:'none'},previewToken:token,idempotencyKey:key}); db.close(); writeFileSync(out,JSON.stringify({id:version.id,sequence:version.sequence,pid:process.pid}));`)
  const reports=[join(directory,'one.json'),join(directory,'two.json')]
  await Promise.all(reports.map((report,i)=>new Promise<void>((resolve,reject)=>{
   const processChild=spawn(process.execPath,[child,file,f.at.id,f.scenario.id,preview.token,'concurrent-request-'+i,report],{stdio:'ignore'})
   processChild.on('error',reject);processChild.on('exit',code=>code===0?resolve():reject(new Error('Child emission failed: '+code)))
  })))
  const result=reports.map(p=>JSON.parse(readFileSync(p,'utf8')))
  assert.deepEqual(result.map(r=>r.sequence).sort(),[1,2]);assert.notEqual(result[0].pid,result[1].pid)
  assert.notEqual(result[0].id,result[1].id)
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('real PDF paginates long accented observations without dropping the final document identity',async ()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),repo=new BudgetRepository(db)
  const notes='Observação acentuada e ação. '.repeat(220)+'FIM DA OBSERVAÇÃO'
  f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:f.item.services.map(l=>({...l,notes}))})
  const input={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=repo.preview(f.at.id,input)
  const v=(await repo.emit(f.at.id,{...input,previewToken:p.token,idempotencyKey:randomUUID()})),pdf=repo.pdf(f.at.id,v.id)
  const count=/\/Type \/Pages \/Count (\d+)/.exec(pdf.toString('latin1'))
  assert(count&&Number(count[1])>=2)
  assert.match(pdf.subarray(-30).toString(),/%%EOF/)
  assert.equal(v.snapshot.calculation.lines[0]!.notes,notes)
 }finally{db.close()}
})
