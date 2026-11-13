import test from'node:test'
import assert from'node:assert/strict'
import{mkdtempSync,readFileSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{randomUUID}from'node:crypto'
import{openDatabase}from'../database.ts'
import{curationFixture}from'./fixtures/curation.ts'
import{codaFixture,set}from'./fixtures/coda-import.ts'
import{BudgetRepository}from'./fixtures/budget-renderer.ts'
import{planImport,applyImport}from'../coda-import.ts'
import{TABLES}from'../coda-import-source.ts'
import{CURATION_STAMP}from'../curation.ts'
import{SERVICE_POLICIES,newServiceSelectionIssue,executionScope,codaServiceId}from'../../shared/commercial-curation.ts'
const request=(scenarioId:string)=>({scenarioId,negotiation:{mode:'none'}})
function errorCode(e:unknown,code:string){return(e as{code:string}).code===code}

test('curation has 28 stable IDs, 2 hidden, 4 not billed, 5 conditional external and one blocked two-source activity',()=>{
 const all=Object.values(SERVICE_POLICIES);assert.equal(all.length,28);assert.equal(all.filter(p=>!p.visible).length,2);assert.equal(all.filter(p=>p.billing==='not_billed').length,4);assert.equal(all.filter(p=>p.execution==='external_confirmation').length,5);assert.equal(all.filter(p=>p.canonicalBlocked).length,2)
 assert(newServiceSelectionIssue(codaServiceId('i-unknown')));assert.equal(newServiceSelectionIssue('manual-operator-id'),null)
})

test('hidden new lines and either canonical alias are blocked by backend; existing hidden references remain editable, calculable and immutable in history',async ()=>{
 const db=openDatabase(':memory:')
 try{const f=curationFixture(db),budgets=new BudgetRepository(db),before=f.commercial.list(f.at.id)
  for(const key of ['hidden','legacy','technical','inspection']as const)assert.throws(()=>f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[{serviceId:f.ids[key],dimensionId:f.dimensions[key],quantity:'1'}]}),e=>errorCode(e,'CURATION_SELECTION_BLOCKED'))
  assert.deepEqual(f.commercial.list(f.at.id),before)
  const req=request(f.scenario.id),p=budgets.preview(f.at.id,req),v=(await budgets.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:randomUUID()})),pdf=budgets.pdf(f.at.id,v.id)
  // Seed a pre-curation reference in this synthetic DB; no remapping is performed by the app.
  db.prepare('UPDATE diagnosis_services SET service_id=?,dimension_id=? WHERE id=?').run(f.ids.hidden,f.dimensions.hidden,f.item.services[0]!.id)
  const old=f.commercial.list(f.at.id)[0]!,edited=f.commercial.updateDiagnosis(f.at.id,old.id,{revision:old.revision,notes:'Legado preservado',services:old.services})
  assert.equal(edited.services[0]!.serviceId,f.ids.hidden);assert.equal(f.commercial.item(f.ids.hidden).active,true);assert(budgets.preview(f.at.id,req).canEmit)
  assert.deepEqual(budgets.get(f.at.id,v.id),v);assert.deepEqual(budgets.pdf(f.at.id,v.id),pdf)
 }finally{db.close()}
})

test('mixed not-billed activities never require price/FD/FC/FR or enter subtotal, discount or negotiation; energy and deadline still count',()=>{
 const db=openDatabase(':memory:')
 try{const f=curationFixture(db),cfg=f.pricing.get();const free=cfg.config.services.find(s=>s.serviceId===f.ids.free)!;free.base=null;free.dimensions[0]!.fd=null;f.pricing.save({revision:cfg.revision,config:cfg.config})
  const item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[...f.item.services,{serviceId:f.ids.free,dimensionId:f.dimensions.free,quantity:'0.25'}]})
  const repo=new BudgetRepository(db),p=repo.preview(f.at.id,request(f.scenario.id)),c=p.snapshot.calculation,l=c.lines.find(l=>l.id===item.services[1]!.id)!
  assert(p.canEmit);assert.equal(c.total,'300.15');assert.equal(c.energy,'16.25');assert.equal(c.days,'5');assert.equal(l.billing,'not_billed');assert.equal(l.unit,null);assert.equal(l.finalUnit,null);assert.equal(l.total,null);assert.deepEqual(l.factors,{})
  for(const mode of ['discount','adjust']as const){const result=repo.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode,value:'10',acknowledgeResidual:true}}).snapshot.calculation;assert.equal(result.lines.find(l=>l.id===item.services[1]!.id)!.total,null);assert.equal(result.discountEligibleSubtotal,'300.15')}
 }finally{db.close()}
})

test('only not-billed activities may emit an actual zero-total budget, without synthetic unit prices; missing energy/capacity blocks safely and snapshot/PDF stay frozen',async ()=>{
 const db=openDatabase(':memory:')
 try{const f=curationFixture(db),item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[{serviceId:f.ids.free,dimensionId:f.dimensions.free,quantity:'1'}]}),cfg=f.pricing.get();cfg.config.tables=[];cfg.config.colors=[];cfg.config.risks=[];cfg.config.services.find(s=>s.serviceId===f.ids.free)!.base=null;cfg.config.services.find(s=>s.serviceId===f.ids.free)!.dimensions[0]!.fd=null;f.pricing.save({revision:cfg.revision,config:cfg.config});f.pricing.saveSettings(f.at.id,{revision:f.pricing.settings(f.at.id).revision,tableId:null,colorId:null,riskId:null,mrId:null})
  const b=new BudgetRepository(db),req=request(f.scenario.id),p=b.preview(f.at.id,req);assert(p.canEmit);assert.equal(p.snapshot.calculation.nonBillableOnly,true);assert.equal(p.snapshot.calculation.total,'0');assert.equal(p.snapshot.calculation.lines[0]!.unit,null);assert.equal(p.snapshot.calculation.energy,'5');assert.deepEqual(p.snapshot.commercialCuration,CURATION_STAMP)
  const key=randomUUID(),v=(await b.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:key})),pdf=b.pdf(f.at.id,v.id);assert.equal((await b.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:key})).id,v.id)
  const conf=f.pricing.get();conf.config.services.find(s=>s.serviceId===f.ids.free)!.dimensions[0]!.stages=[];f.pricing.save({revision:conf.revision,config:conf.config});const blocked=b.preview(f.at.id,req);assert(!blocked.canEmit);assert.equal(blocked.snapshot.calculation.energy,'0');assert(blocked.snapshot.calculation.errors.some(e=>e.includes('Etapas técnicas')))
  assert.deepEqual(b.get(f.at.id,v.id),v);assert.deepEqual(b.pdf(f.at.id,v.id),pdf);assert.equal(f.commercial.list(f.at.id)[0]!.services[0]!.id,item.services[0]!.id)
 }finally{db.close()}
})

test('Issue #158 external inclusion is sufficient across scenarios while historical confirmation metadata stays isolated',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=curationFixture(db),item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[{serviceId:f.ids.third,dimensionId:f.dimensions.third,quantity:'1'}]}),line=item.services[0]!,b=new BudgetRepository(db)
  let scenario=f.scenarios.list(f.at.id)[0]!
  const initial=b.preview(f.at.id,request(scenario.id))
  assert(initial.canEmit)
  assert.equal(initial.snapshot.calculation.lines.find(l=>l.id===line.id)!.executionConfirmed,true)
  const payload={revision:scenario.revision,pieceRevision:item.revision,scope:executionScope(line),confirmed:true}
  assert.throws(()=>f.scenarios.confirmService(f.at.id,scenario.id,line.id,{...payload,scope:'wrong'}),e=>errorCode(e,'VERSION_CONFLICT'))
  scenario=f.scenarios.confirmService(f.at.id,scenario.id,line.id,payload)
  assert(b.preview(f.at.id,request(scenario.id)).canEmit)
  const copy=f.scenarios.create(f.at.id,{name:'Outra',duplicateFrom:scenario.id,sourceRevision:scenario.revision})
  assert(!copy.serviceConfirmations)
  assert(b.preview(f.at.id,request(copy.id)).canEmit)
  const current=f.commercial.list(f.at.id,scenario.id)[0]!
  f.commercial.updateDiagnosis(f.at.id,current.id,{revision:current.revision,scenarioId:scenario.id,scenarioRevision:scenario.revision,services:current.services.map(l=>{const data={...l,quantity:'2'};delete data.executionConfirmed;return data})})
  assert.equal(db.prepare('SELECT COUNT(*) n FROM scenario_service_confirmations').get()!.n,0)
  scenario=f.scenarios.list(f.at.id)[0]!
  const amount=b.preview(f.at.id,request(scenario.id)).snapshot.calculation.total
  assert(b.preview(f.at.id,request(scenario.id)).canEmit)
  assert.equal(b.preview(f.at.id,request(copy.id)).snapshot.calculation.total,amount)
  scenario=f.scenarios.update(f.at.id,scenario.id,{revision:scenario.revision,serviceFlags:{[line.id]:false}})
  assert.equal(db.prepare('SELECT COUNT(*) n FROM scenario_service_confirmations').get()!.n,0)
  assert.equal(b.preview(f.at.id,request(scenario.id)).snapshot.calculation.lines.find(l=>l.id===line.id)!.included,false)
  assert.equal(b.preview(f.at.id,request(copy.id)).snapshot.calculation.lines.find(l=>l.id===line.id)!.included,true)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})

test('legacy technical aliases never become two silent offers; existing distinct IDs stay intact and only the conflicting effective scenario is blocked',()=>{
 const db=openDatabase(':memory:')
 try{const f=curationFixture(db),line=f.item.services[0]!,second=randomUUID()
  // Reproduce pre-curation data, without going through a forbidden new inclusion.
  db.prepare('UPDATE diagnosis_services SET service_id=?,dimension_id=? WHERE id=?').run(f.ids.technical,f.dimensions.technical,line.id)
  db.prepare('INSERT INTO diagnosis_services(id,diagnosis_item_id,service_id,dimension_id,quantity,enabled) VALUES(?,?,?,?,?,1)').run(second,f.item.id,f.ids.inspection,f.dimensions.inspection,'1')
  let scenario=f.scenarios.list(f.at.id)[0]!;scenario=f.scenarios.update(f.at.id,scenario.id,{revision:scenario.revision,serviceFlags:{[second]:true}})
  const budgets=new BudgetRepository(db),blocked=budgets.preview(f.at.id,request(scenario.id));assert(!blocked.canEmit);assert(blocked.snapshot.calculation.errors.some(e=>e.includes('duas origens equivalentes')))
  scenario=f.scenarios.update(f.at.id,scenario.id,{revision:scenario.revision,serviceFlags:{[second]:false}})
  const allowed=budgets.preview(f.at.id,request(scenario.id));assert(allowed.canEmit);assert.equal(allowed.snapshot.calculation.total,'0');assert.equal(f.commercial.list(f.at.id)[0]!.services.length,2)
  assert.deepEqual(new Set(f.commercial.list(f.at.id)[0]!.services.map(l=>l.serviceId)),new Set([f.ids.technical,f.ids.inspection]))
 }finally{db.close()}
})

test('curated import binds manifest/hash, keeps hidden identities active for legacy, rejects unknown source IDs and is idempotent without replacing local policy or settings',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-curation-import-')),file=join(dir,'qa.sqlite');const db=openDatabase(file)
 try{const source=codaFixture();let plan=planImport(db,source);assert.equal(plan.report.curation!.version,CURATION_STAMP.version);assert.deepEqual(plan.config.commercialCuration,CURATION_STAMP);const before=readFileSync(file);assert.equal(plan.report.conflicts.length,0);assert.deepEqual(readFileSync(file),before);applyImport(db,source,plan.planHash);const after=readFileSync(file);plan=planImport(db,source);assert.equal(plan.report.inserts,0);applyImport(db,source,plan.planHash);assert.deepEqual(readFileSync(file),after)
  const unknown=JSON.parse(JSON.stringify(source).replaceAll('i-XDTMBmueos','i-unapproved-source'));const rejected=planImport(db,unknown);assert(rejected.report.conflicts.some(c=>c.reason.includes('curadoria')));assert.throws(()=>applyImport(db,unknown,rejected.planHash),/Conflitos/)
  const hidden=JSON.parse(JSON.stringify(source).replaceAll('i-XDTMBmueos','i-qCp1gLfJn4').replaceAll('i-synthetic-dimension','i-hidden-dimension'));set(hidden,TABLES.services,'c-TvFH_jzZ3k','Interna QA');const p=planImport(db,hidden);assert.equal(p.report.conflicts.length,0);applyImport(db,hidden,p.planHash);assert.equal(db.prepare('SELECT active FROM catalog_items WHERE id=?').get(codaServiceId('i-qCp1gLfJn4'))!.active,1);assert(!newServiceSelectionIssue(codaServiceId('i-XDTMBmueos')))
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})

test('full synthetic source preserves 28 IDs, all 16 diagnoses and all 75 dimensions including incomplete ones; hidden is not inactive and repeat has no effects',async()=>{
 const{fullCurationSource}=await import('./fixtures/curation.ts'),db=openDatabase(':memory:')
 try{const source=await fullCurationSource(),p=planImport(db,source);assert.equal(p.report.conflicts.length,0);applyImport(db,source,p.planHash)
  const counts=db.prepare("SELECT kind,COUNT(*) n,SUM(active) active FROM catalog_items GROUP BY kind").all();assert.equal(counts.find(c=>c.kind==='servico')!.n,28);assert.equal(counts.find(c=>c.kind==='diagnostico')!.n,16);assert.equal(counts.find(c=>c.kind==='dimensao')!.n,75);assert.equal(counts.find(c=>c.kind==='dimensao')!.active,75)
  const r=planImport(db,source);assert.equal(r.report.inserts,0);assert.equal(r.report.conflicts.length,0);applyImport(db,source,r.planHash);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})

test('V7 to V8 is additive, preserves actual legacy rows/snapshots/PDF bytes and rolls back a failed migration; importer refuses V7 without migrating',async()=>{
 const{DatabaseSync}=await import('node:sqlite'),{migrate:v7}=await import('./fixtures/m1_7_migrations.ts'),{commercialFixture:legacyFixture}=await import('./fixtures/pre-curation/fixture.ts'),{BudgetRepository:LegacyBudgets}=await import('./fixtures/pre-curation/budgets.ts')
 const dir=mkdtempSync(join(tmpdir(),'funix-v8-upgrade-')),file=join(dir,'qa.sqlite');let db=new DatabaseSync(file)
 try{v7(db);const f=legacyFixture(db),b=new LegacyBudgets(db),req=request(f.scenario.id),p=b.preview(f.at.id,req),v=(await b.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:randomUUID()})),pdf=b.pdf(f.at.id,v.id)
  const tables=['atendimentos','catalog_items','catalog_history','pricing_configuration','commercial_state','scenarios','diagnosis_items','diagnosis_services','scenario_piece_flags','scenario_service_flags','scenario_component_flags','component_items','budget_versions'];const before=tables.map(t=>db.prepare(`SELECT ${t==='scenarios'?'id,atendimento_id,name,position,revision,created_at':t==='diagnosis_items'?'id,atendimento_id,piece_id,diagnosis_id,notes,enabled,revision,created_at,updated_at':t==='atendimentos'?'id,phone,phone_normalized,name,vehicle,brand,model,plate,reason,notes,search_text,stage,rejection_reason,explicit_refusal,created_at,updated_at,revision':t==='diagnosis_services'?'id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id':'*'} FROM ${t} ORDER BY rowid`).all())
  assert.throws(()=>planImport(db,codaFixture()),/exatamente V8/);assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,7)
  db.exec('CREATE VIEW scenario_service_confirmations AS SELECT id FROM scenarios');db.close();assert.throws(()=>openDatabase(file));db=new DatabaseSync(file);assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,7);tables.forEach((t,i)=>assert.deepEqual(db.prepare(`SELECT ${t==='scenarios'?'id,atendimento_id,name,position,revision,created_at':t==='diagnosis_items'?'id,atendimento_id,piece_id,diagnosis_id,notes,enabled,revision,created_at,updated_at':t==='atendimentos'?'id,phone,phone_normalized,name,vehicle,brand,model,plate,reason,notes,search_text,stage,rejection_reason,explicit_refusal,created_at,updated_at,revision':t==='diagnosis_services'?'id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id':'*'} FROM ${t} ORDER BY rowid`).all(),before[i]));db.exec('DROP VIEW scenario_service_confirmations');db.close();db=openDatabase(file)
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,16);tables.forEach((t,i)=>assert.deepEqual(db.prepare(`SELECT ${t==='scenarios'?'id,atendimento_id,name,position,revision,created_at':t==='diagnosis_items'?'id,atendimento_id,piece_id,diagnosis_id,notes,enabled,revision,created_at,updated_at':t==='atendimentos'?'id,phone,phone_normalized,name,vehicle,brand,model,plate,reason,notes,search_text,stage,rejection_reason,explicit_refusal,created_at,updated_at,revision':t==='diagnosis_services'?'id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id':'*'} FROM ${t} ORDER BY rowid`).all(),before[i]));assert.equal(db.prepare('SELECT COUNT(*) n FROM scenario_service_confirmations').get()!.n,0)
  assert.deepEqual(new BudgetRepository(db).get(f.at.id,v.id),v);assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,v.id),pdf);db.close();db=openDatabase(file);assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,v.id),pdf);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
