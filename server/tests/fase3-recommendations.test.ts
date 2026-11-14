import test from'node:test'
import assert from'node:assert/strict'
import{DatabaseSync}from'node:sqlite'
import{mkdtempSync,readFileSync,rmSync,writeFileSync,statSync,openSync,closeSync}from'node:fs'
import{join}from'node:path'
import{tmpdir}from'node:os'
import{spawnSync}from'node:child_process'
import{openDatabase}from'../database.ts'
import{migrate}from'../migrations.ts'
import{migrate as migrateV8}from'./fixtures/migrations-v8.ts'
import{commercialFixture as legacyFixture}from'./fixtures/pre-curation/fixture.ts'
import{BudgetRepository as LegacyBudgets}from'./fixtures/pre-curation/budgets.ts'
import{BudgetRepository}from'./fixtures/budget-renderer.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{CommercialRepository}from'../commercial.ts'
import{ComponentRepository}from'../components.ts'
import{recommendationsFixture}from'./fixtures/recommendations.ts'
import{planRecommendations,applyRecommendations,recommendations}from'../diagnosis-recommendations.ts'
import{planImport,applyImport}from'../coda-import.ts'
import{codaFixture}from'./fixtures/coda-import.ts'
import{pieceDataSignature,pieceSignature}from'../../src/calculation-state.ts'
const records=(db:DatabaseSync)=>db.prepare('SELECT * FROM diagnosis_recommendations ORDER BY id').all()
test('Fase3 V8→V9 additive migration preserves IDs, flags, MR, services/components and immutable historical snapshot/PDF; failure rolls back',async ()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-fase3-upgrade-')),file=join(dir,'qa.sqlite');let db=new DatabaseSync(file)
 try{
  db.exec('PRAGMA foreign_keys=ON');migrateV8(db);const f=legacyFixture(db),budgets=new LegacyBudgets(db),req={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=budgets.preview(f.at.id,req),v=(await budgets.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:'qa-legacy-v8-only'})),pdf=budgets.pdf(f.at.id,v.id)
  const tables=['atendimentos','catalog_items','commercial_state','pricing_configuration','diagnosis_services','component_items','scenarios','scenario_piece_flags','scenario_service_flags','scenario_component_flags','budget_versions'],before=tables.map(t=>db.prepare(`SELECT ${t==='scenarios'?'id,atendimento_id,name,position,revision,created_at':t==='atendimentos'?'id,phone,phone_normalized,name,vehicle,brand,model,plate,reason,notes,search_text,stage,rejection_reason,explicit_refusal,created_at,updated_at,revision':t==='diagnosis_services'?'id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id':'*'} FROM ${t}`).all()),piece={...db.prepare('SELECT * FROM diagnosis_items').get()}
  db.exec('CREATE VIEW diagnosis_recommendations AS SELECT id FROM atendimentos');assert.throws(()=>migrate(db));assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,8);assert(!db.prepare('PRAGMA table_info(diagnosis_items)').all().some(c=>c.name==='intensity'));tables.forEach((t,i)=>assert.deepEqual(db.prepare(`SELECT ${t==='scenarios'?'id,atendimento_id,name,position,revision,created_at':t==='atendimentos'?'id,phone,phone_normalized,name,vehicle,brand,model,plate,reason,notes,search_text,stage,rejection_reason,explicit_refusal,created_at,updated_at,revision':t==='diagnosis_services'?'id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id':'*'} FROM ${t}`).all(),before[i]))
  db.exec('DROP VIEW diagnosis_recommendations');migrate(db);assert.deepEqual({...db.prepare('SELECT * FROM diagnosis_items').get()},{...piece,intensity:null,piece_review_pending:0});tables.forEach((t,i)=>assert.deepEqual(db.prepare(`SELECT ${t==='scenarios'?'id,atendimento_id,name,position,revision,created_at':t==='atendimentos'?'id,phone,phone_normalized,name,vehicle,brand,model,plate,reason,notes,search_text,stage,rejection_reason,explicit_refusal,created_at,updated_at,revision':t==='diagnosis_services'?'id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id':'*'} FROM ${t}`).all(),before[i]))
  assert.deepEqual(new BudgetRepository(db).get(f.at.id,v.id),v);assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,v.id),pdf)
  db.close();db=openDatabase(file);assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,18);assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,v.id),pdf)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
test('Fase3 master intensity persists across scenarios/restart without changing manual composition, parameters, masks or calculations; omitted/null preserved',async ()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-fase3-intensity-')),file=join(dir,'qa.sqlite');let db=openDatabase(file)
 try{
  const f=commercialFixture(db),parts=new ComponentRepository(db);parts.save(f.at.id,{pieceId:f.item.id,name:'QA componente',quantity:'0.25',manualPrice:'10.01',notes:'Preservar'})
  const d=f.commercial.saveCatalog({kind:'diagnostico',name:'Dano sintético'}),s=f.scenarios.list(f.at.id)[0]!,two=f.scenarios.create(f.at.id,{name:'Outro',duplicateFrom:s.id,sourceRevision:s.revision}),b=new BudgetRepository(db),request={scenarioId:s.id,negotiation:{mode:'none'}},preview=b.preview(f.at.id,request),version=(await b.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:'qa-fase3-before-snapshot'})),pdf=b.pdf(f.at.id,version.id)
  const before=f.commercial.list(f.at.id)[0]!,storedParts=parts.list(f.at.id),settings=f.pricing.settings(f.at.id).settings,flags=f.scenarios.list(f.at.id).map(x=>[x.pieceFlags,x.serviceFlags,x.componentFlags])
  assert.equal(before.intensity,null)
  for(const intensity of['leve','moderado','severo',null]as const){const piece=f.commercial.list(f.at.id)[0]!,next=f.commercial.updateDiagnosis(f.at.id,piece.id,{revision:piece.revision,intensity,diagnosisId:d.id})
   assert.equal(next.intensity,intensity);assert.deepEqual(next.services,before.services);assert.deepEqual(parts.list(f.at.id),storedParts);assert.deepEqual(f.pricing.settings(f.at.id).settings,settings);assert.deepEqual(f.scenarios.list(f.at.id).map(x=>[x.pieceFlags,x.serviceFlags,x.componentFlags]),flags)
   assert.equal(f.commercial.list(f.at.id,two.id)[0]!.intensity,intensity);assert.equal(b.preview(f.at.id,request).snapshot.calculation.total,preview.snapshot.calculation.total)
  }
  let item=f.commercial.list(f.at.id)[0]!;item=f.commercial.updateDiagnosis(f.at.id,item.id,{revision:item.revision,intensity:'moderado'});const selected=f.scenarios.list(f.at.id)[1]!;f.scenarios.update(f.at.id,two.id,{revision:selected.revision,pieceFlags:{[item.id]:false}});assert.equal(f.commercial.list(f.at.id,two.id)[0]!.intensity,'moderado');assert(f.commercial.list(f.at.id,s.id)[0]!.enabled)
  const stale=item.revision;item=f.commercial.updateDiagnosis(f.at.id,item.id,{revision:item.revision,notes:'QA observação'});assert.equal(item.intensity,'moderado');assert.throws(()=>f.commercial.updateDiagnosis(f.at.id,item.id,{revision:stale,intensity:'leve'}));assert.throws(()=>f.commercial.updateDiagnosis(f.at.id,item.id,{revision:item.revision,intensity:'extremo'}))
  assert.notEqual(pieceSignature(item),pieceSignature({...item,intensity:'severo'}));assert.notEqual(pieceDataSignature(item),pieceDataSignature({...item,intensity:'severo'}));assert.equal(pieceSignature({...item,intensity:undefined}),pieceSignature({...item,intensity:null}))
  assert.deepEqual(b.get(f.at.id,version.id),version);assert.deepEqual(b.pdf(f.at.id,version.id),pdf);db.close();db=openDatabase(file);const read=new CommercialRepository(db).list(f.at.id)[0]!;assert.equal(read.intensity,'moderado');assert.equal(read.notes,'QA observação');assert.deepEqual(read.services,before.services)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
test('Fase3 validates full rules, stages three incompatible links, retains non-default recommendations and imports idempotently without touching composition',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=recommendationsFixture(db),plan=planRecommendations(db,f.source),counts=db.prepare('SELECT COUNT(*) n FROM diagnosis_services').get()!.n
  assert.deepEqual(records(db),[]);assert.equal(plan.report.total,6);assert.equal(plan.report.valid,3);assert.equal(plan.report.notSelectedByDefault,3);assert.equal(plan.report.pending.length,3);assert.equal(plan.report.conflicts.length,0)
  applyRecommendations(db,f.source,plan.planHash);assert.equal(records(db).length,6)
  for(const intensity of['leve','moderado','severo']){const found=recommendations(db,f.diagnosisId,intensity);assert.equal(found.length,1);assert.equal(found[0]!.serviceId,f.serviceId);assert.equal(found[0]!.dimensionId,f.dimensionId);assert.equal(found[0]!.selectedByDefault,intensity!=='moderado');assert(String(found[0]!.sourceRowId).startsWith('i-qa-valid-'))}
  const before=records(db),again=planRecommendations(db,f.source);assert.equal(again.report.inserts,0);assert.equal(again.report.unchanged,6);applyRecommendations(db,f.source,again.planHash);assert.deepEqual(records(db),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM diagnosis_services').get()!.n,counts)
  const imported=planImport(db,codaFixture());applyImport(db,codaFixture(),imported.planHash);assert.deepEqual(records(db),before,'commercial importer on V9 preserves every recommendation')
  db.prepare('UPDATE catalog_items SET active=0 WHERE id=?').run(f.serviceId);assert.deepEqual(recommendations(db,f.diagnosisId,'leve'),[]);assert.equal(records(db).length,6)
  db.prepare('UPDATE catalog_items SET active=1 WHERE id=?').run(f.serviceId);db.prepare('UPDATE catalog_items SET service_id=(SELECT service_id FROM catalog_items WHERE id=?) WHERE id=?').run(f.wrong,f.dimensionId);assert.deepEqual(recommendations(db,f.diagnosisId,'leve'),[]);assert.equal(records(db).length,6,'catalog drift never makes an incompatible link queryable')
 }finally{db.close()}
})
test('Fase3 malformed origin IDs, missing/type-invalid references, wrong intensities, duplicates and local edits block the entire transaction',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=recommendationsFixture(db)
  for(const patch of[{id:'invented'},{diagnosisId:f.serviceId},{dimensionId:f.dimensionId.replace('i-synthetic-dimension','i-absent')},{intensity:'extremo'},{selectedByDefault:1}]){
   const source=structuredClone(f.source);Object.assign(source.rows[0]!,patch);const plan=planRecommendations(db,source);assert(plan.report.conflicts.length);assert.throws(()=>applyRecommendations(db,source,plan.planHash));assert.deepEqual(records(db),[])
  }
  for(const sameId of[true,false]){const source=structuredClone(f.source);source.rows.push({...source.rows[0]!,id:sameId?source.rows[0]!.id:'i-another-id'});const p=planRecommendations(db,source);assert(p.report.conflicts.length);assert.throws(()=>applyRecommendations(db,source,p.planHash));assert.deepEqual(records(db),[])}
  const p=planRecommendations(db,f.source);db.exec("CREATE TRIGGER qa_fail_rule BEFORE INSERT ON diagnosis_recommendations WHEN NEW.status='valid' BEGIN SELECT RAISE(ABORT,'synthetic failed write');END;");assert.throws(()=>applyRecommendations(db,f.source,p.planHash));assert.deepEqual(records(db),[]);db.exec('DROP TRIGGER qa_fail_rule');applyRecommendations(db,f.source,p.planHash);assert.throws(()=>applyRecommendations(db,f.source,p.planHash));const before=records(db),changed=structuredClone(f.source);changed.rows[0]!.selectedByDefault=!changed.rows[0]!.selectedByDefault;const conflict=planRecommendations(db,changed);assert(conflict.report.conflicts.length);assert.throws(()=>applyRecommendations(db,changed,conflict.planHash));assert.deepEqual(records(db),before)
  const c=structuredClone(f.source);c.documentId='other';assert.throws(()=>planRecommendations(db,c));assert.throws(()=>recommendations(db,f.diagnosisId,'Severo'));assert.throws(()=>recommendations(db,undefined,'leve'))
 }finally{db.close()}
})
test('Fase3 CLI dry-run opens existing V9 read-only, preserves hash/mode, requires matching hash to apply, refuses absent and older/future schemas',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-rules-cli-')),file=join(dir,'qa.sqlite'),sourceFile=join(dir,'qa-rules.json');let db=openDatabase(file)
 try{
  const f=recommendationsFixture(db);writeFileSync(sourceFile,JSON.stringify(f.source));db.close();const raw=readFileSync(file),mode=statSync(file).mode
  const env={...process.env};delete env.NODE_TEST_CONTEXT
  const run=(args:string[])=>{const out=join(dir,'stdout.json'),err=join(dir,'stderr.txt'),o=openSync(out,'w'),e=openSync(err,'w');try{const result=spawnSync(process.execPath,['server/import-recommendations.ts',...args],{env,stdio:['ignore',o,e]});return{...result,stdout:readFileSync(out,'utf8'),stderr:readFileSync(err,'utf8')}}finally{closeSync(o);closeSync(e)}}
  const args=['--source',sourceFile,'--database',file],dry=run(args);assert.equal(dry.status,0,dry.stderr);const p=JSON.parse(dry.stdout);assert.equal(p.mode,'dry-run');assert.deepEqual(readFileSync(file),raw);assert.equal(statSync(file).mode,mode)
  const applied=run([...args,'--confirm-plan',p.planHash]);assert.equal(applied.status,0,applied.stderr);const repeat=run(args);assert.equal(JSON.parse(repeat.stdout).inserts,0);assert.equal(run([...args,'--confirm-plan',p.planHash]).status,1)
  assert.equal(run(['--source',sourceFile,'--database',join(dir,'absent.sqlite')]).status,1)
  writeFileSync(sourceFile,'synthetic-sensitive-placeholder');const malformed=run(args);assert.equal(malformed.status,1);assert(!malformed.stderr.includes('synthetic-sensitive-placeholder'));writeFileSync(sourceFile,JSON.stringify(f.source))
  db=new DatabaseSync(file);db.exec('INSERT INTO schema_migrations VALUES(19,\'synthetic future\')');db.close();assert.equal(run(args).status,1);db=new DatabaseSync(file);db.exec('DELETE FROM schema_migrations WHERE version=13');db.close()
  const old=join(dir,'v8.sqlite');db=new DatabaseSync(old);migrateV8(db);assert.throws(()=>planRecommendations(db,f.source),/exatamente V9/);db.close()
 }finally{try{db.close()}catch{}rmSync(dir,{recursive:true,force:true})}
})

test('Fase3 sixteen explicitly non-default synthetic rules remain stored and queryable; no catalog or commercial lines are created',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=recommendationsFixture(db),source=structuredClone(f.source),now=new Date().toISOString();source.rows=[]
  const prefix=f.dimensionId.slice(0,f.dimensionId.lastIndexOf(':')+1)
  for(let i=0;i<16;i++){
   const dimensionId=prefix+'i-qa-option-'+i
   db.prepare("INSERT INTO catalog_items(id,kind,name,service_id,status,source,created_at,updated_at)VALUES(?,'dimensao',?,?,'proposta','operador',?,?)").run(dimensionId,'Opção SINTÉTICA '+i,f.serviceId,now,now)
   source.rows.push({id:'i-qa-option-rule-'+i,diagnosisId:f.diagnosisId,intensity:['leve','moderado','severo'][i%3]!,serviceId:f.serviceId,dimensionId,selectedByDefault:false})
  }
  const catalog=db.prepare('SELECT * FROM catalog_items ORDER BY id').all(),p=planRecommendations(db,source);assert.equal(p.report.valid,16);assert.equal(p.report.validNotSelectedByDefault,16);applyRecommendations(db,source,p.planHash)
  const found=['leve','moderado','severo'].flatMap(i=>recommendations(db,f.diagnosisId,i));assert.equal(found.length,16);assert(found.every(r=>r.selectedByDefault===false));assert.deepEqual(db.prepare('SELECT * FROM catalog_items ORDER BY id').all(),catalog);assert.equal(db.prepare('SELECT COUNT(*) n FROM diagnosis_services').get()!.n,0)
 }finally{db.close()}
})
