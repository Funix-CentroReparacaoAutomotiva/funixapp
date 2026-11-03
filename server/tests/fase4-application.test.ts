import test from'node:test'
import assert from'node:assert/strict'
import{randomUUID}from'node:crypto'
import{DatabaseSync}from'node:sqlite'
import{openDatabase}from'../database.ts'
import{migrate as v9}from'./fixtures/migrations-v9.ts'
import{migrate}from'../migrations.ts'
import{fase4Fixture}from'./fixtures/fase4.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{applySuggestedServices}from'../apply-recommendations.ts'
import{recommendations}from'../diagnosis-recommendations.ts'
import{ComponentRepository}from'../components.ts'
import{BudgetRepository}from'../budgets.ts'
import{executionScope,compareRecommendations}from'../../shared/commercial-curation.ts'
import{sourceId,TABLES}from'../coda-import-source.ts'
import type{RecommendationApplicationRequest}from'../../shared/commercial.ts'
function ready(f:ReturnType<typeof fase4Fixture>,intensity='leve'){
 const p=f.commercial.list(f.at.id)[0]!
 return f.commercial.updateDiagnosis(f.at.id,p.id,{revision:p.revision,diagnosisId:f.diagnosis.id,intensity})
}
function request(f:ReturnType<typeof fase4Fixture>,mode:'automatic'|'assisted'='automatic',ruleIds?:string[]):RecommendationApplicationRequest{
 const p=f.commercial.list(f.at.id)[0]!,s=f.scenarios.list(f.at.id)[0]!
 return{revision:p.revision,scenarioId:s.id,scenarioRevision:s.revision,diagnosisId:p.diagnosisId!,intensity:p.intensity!,mode,...(ruleIds?{ruleIds}:{}),idempotencyKey:randomUUID()}
}
test('Fase4 automatic atomic batch preserves optional rows, provenance, priority and independent scenario masks; forbidden services and pending rules are skipped',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=fase4Fixture(db);ready(f);const before=f.scenarios.list(f.at.id),req=request(f),r=applySuggestedServices(db,f.at.id,f.item.id,req)
  assert.equal(r.created.length,6);assert.equal(r.skipped.filter(x=>x.reason==='CURATION_BLOCKED').length,3);assert(!r.notEmpty);assert.deepEqual(r.item.services.map(l=>l.serviceId),f.entries.slice(0,6).map(s=>s.serviceId));assert(r.item.services.every(l=>l.quantity==='1'&&l.recommendationRuleId));assert.deepEqual(r.item.services.map(l=>l.enabled),[true,true,true,false,false,true]);assert.equal(r.item.services.at(-1)!.executionConfirmed,false)
  const after=f.scenarios.list(f.at.id);assert.deepEqual(after.map(s=>s.pieceFlags),before.map(s=>s.pieceFlags));assert.deepEqual(after.map(s=>s.componentFlags),before.map(s=>s.componentFlags));assert(Object.values(after[1]!.serviceFlags).every(v=>!v));assert(r.item.services.every(l=>!l.recommendationRuleId!.includes('pending')))
  assert.deepEqual(applySuggestedServices(db,f.at.id,f.item.id,req),r);assert.equal(f.commercial.list(f.at.id)[0]!.services.length,6);assert.equal(db.prepare('SELECT COUNT(*)n FROM recommendation_applications').get()!.n,1)
  const sorted=[...recommendations(db,f.diagnosis.id,'leve')].sort(compareRecommendations);assert.deepEqual(sorted.slice(0,5).map(r=>r.serviceId),f.entries.slice(0,5).map(s=>s.serviceId))
 }finally{db.close()}
})
test('Fase4 automatic guard preserves manual rows/components; assisted inclusion never overwrites dimensions, quantities, repeated lines, order or masks',()=>{
 for(const component of[false,true]){
  const db=openDatabase(':memory:')
  try{
   const f=fase4Fixture(db);ready(f)
   if(component)new ComponentRepository(db).save(f.at.id,{pieceId:f.item.id,name:'QA componente',quantity:'0.25',manualPrice:'0',notes:'Preservar'})
   else{const p=f.commercial.list(f.at.id)[0]!;f.commercial.updateDiagnosis(f.at.id,p.id,{revision:p.revision,services:[{serviceId:f.entries[2]!.serviceId,dimensionId:null,quantity:'0.25',enabled:false},{serviceId:f.entries[2]!.serviceId,dimensionId:null,quantity:'2',enabled:true}]})}
   const before=f.commercial.list(f.at.id)[0]!,raw=db.prepare('SELECT * FROM component_items').all(),auto=applySuggestedServices(db,f.at.id,f.item.id,request(f));assert(auto.notEmpty);assert.deepEqual(auto.item.services,before.services);assert.deepEqual(db.prepare('SELECT * FROM component_items').all(),raw)
   const suggestions=recommendations(db,f.diagnosis.id,'leve'),r=applySuggestedServices(db,f.at.id,f.item.id,request(f,'assisted',suggestions.map(r=>r.id)));assert.deepEqual(r.item.services.slice(0,before.services.length),before.services);assert.equal(r.created.length,component?6:5);assert.equal(r.item.services.filter(l=>l.serviceId===f.entries[2]!.serviceId).length,component?1:2);assert.deepEqual(db.prepare('SELECT * FROM component_items').all(),raw)
  }finally{db.close()}
 }
})
test('Fase4 lost response replay cannot restore deleted or manually adjusted suggestions; later operator edits preserve origin and exact quantities',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=fase4Fixture(db);ready(f);const req=request(f),reply=applySuggestedServices(db,f.at.id,f.item.id,req),line=reply.item.services[0]!
  const edited=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:reply.item.revision,services:reply.item.services.map(({recommendationRuleId:_origin,executionConfirmed:_confirmed,...l})=>l.id===line.id?{...l,quantity:'0.25',dimensionId:null,enabled:false}:l)})
  assert.equal(edited.services[0]!.recommendationRuleId,line.recommendationRuleId);assert.equal(edited.services[0]!.quantity,'0.25');assert.equal(edited.services[0]!.dimensionId,null)
  f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:edited.revision,services:[]});assert.equal(f.commercial.list(f.at.id)[0]!.services.length,0);assert.deepEqual(applySuggestedServices(db,f.at.id,f.item.id,req),reply);assert.equal(f.commercial.list(f.at.id)[0]!.services.length,0,'receipt must not recreate lines after manual deletion')
  assert.throws(()=>applySuggestedServices(db,f.at.id,f.item.id,{...req,mode:'assisted',ruleIds:[]}));assert.equal(f.commercial.list(f.at.id)[0]!.services.length,0)
 }finally{db.close()}
})
test('Fase4 missing context, stale revisions, wrong scenario/Atendimento, inactive catalogs and ambiguous dimensions never fabricate or partially insert data',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=fase4Fixture(db);assert.throws(()=>applySuggestedServices(db,f.at.id,f.item.id,request(f)));ready(f);const req=request(f)
  for(const patch of[{revision:req.revision-1},{scenarioRevision:req.scenarioRevision-1},{diagnosisId:f.otherDiagnosis.id},{intensity:'severo'},{scenarioId:'not-owned'}])assert.throws(()=>applySuggestedServices(db,f.at.id,f.item.id,{...req,...patch}));assert.equal(f.commercial.list(f.at.id)[0]!.services.length,0)
  db.prepare('UPDATE catalog_items SET active=0 WHERE id=?').run(f.entries[0]!.dimensionId);const r=applySuggestedServices(db,f.at.id,f.item.id,req);assert.equal(r.created.length,5);assert(!r.item.services.some(l=>l.serviceId===f.entries[0]!.serviceId))
  assert.throws(()=>f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:r.item.revision,services:[{serviceId:f.entries[0]!.serviceId,dimensionId:null,quantity:'1',recommendationRuleId:'forged'}]}))
 }finally{db.close()}
})
test('Fase4 capacity and actual write failure roll back all inserts/flags/origins/receipts; exact 50 boundary succeeds',()=>{
 for(const count of[45,44]){
  const db=openDatabase(':memory:')
  try{
   const f=fase4Fixture(db);ready(f);let p=f.commercial.list(f.at.id)[0]!;p=f.commercial.updateDiagnosis(f.at.id,p.id,{revision:p.revision,services:Array.from({length:count},()=>({serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1'}))})
   const ids=recommendations(db,f.diagnosis.id,'leve').map(r=>r.id),req=request(f,'assisted',ids),before=f.commercial.list(f.at.id),scenes=f.scenarios.list(f.at.id)
   if(count===45){assert.throws(()=>applySuggestedServices(db,f.at.id,p.id,req),e=>(e as {code:string}).code==='RECOMMENDATION_LIMIT');assert.deepEqual(f.commercial.list(f.at.id),before);assert.deepEqual(f.scenarios.list(f.at.id),scenes);assert.equal(db.prepare('SELECT COUNT(*)n FROM recommendation_applications').get()!.n,0)}
   else{db.exec("CREATE TRIGGER qa_fail_suggestion BEFORE INSERT ON diagnosis_services WHEN NEW.service_id LIKE '%i-XDTMBmueos' BEGIN SELECT RAISE(ABORT,'synthetic failure');END;");assert.throws(()=>applySuggestedServices(db,f.at.id,p.id,req));assert.deepEqual(f.commercial.list(f.at.id),before);assert.deepEqual(f.scenarios.list(f.at.id),scenes);db.exec('DROP TRIGGER qa_fail_suggestion');assert.equal(applySuggestedServices(db,f.at.id,p.id,req).item.services.length,50)}
  }finally{db.close()}
 }
})
test('Fase4 new suggestions do not alter financial rules, component MR, technical totals or frozen budgets/PDF; third parties require explicit confirmation',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=fase4Fixture(db,false),b=new BudgetRepository(db);new ComponentRepository(db).save(f.at.id,{pieceId:f.item.id,name:'QA componente',manualPrice:'10.01',quantity:'0.25',notes:''});const s=f.scenarios.list(f.at.id)[0]!,input={scenarioId:s.id,negotiation:{mode:'none'}},preview=b.preview(f.at.id,input),v=b.emit(f.at.id,{...input,previewToken:preview.token,idempotencyKey:randomUUID()}),pdf=b.pdf(f.at.id,v.id)
  ready(f);const req=request(f,'assisted',recommendations(db,f.diagnosis.id,'leve').map(r=>r.id)),settings=f.pricing.settings(f.at.id).settings,r=applySuggestedServices(db,f.at.id,f.item.id,req);assert(r.item.services.at(-1)!.executionConfirmed===false);assert.equal(db.prepare('SELECT COUNT(*)n FROM scenario_service_confirmations').get()!.n,0)
  assert(b.preview(f.at.id,input).snapshot.calculation.errors.some(e=>e.toLowerCase().includes('confirm')));assert.equal(b.preview(f.at.id,input).snapshot.calculation.componentSubtotal,preview.snapshot.calculation.componentSubtotal);assert.deepEqual(f.pricing.settings(f.at.id).settings,settings);assert.deepEqual(b.get(f.at.id,v.id),v);assert.deepEqual(b.pdf(f.at.id,v.id),pdf)
  const scene=f.scenarios.list(f.at.id)[0]!,external=r.item.services.find(l=>l.serviceId===f.entries[5]!.serviceId)!;f.scenarios.update(f.at.id,scene.id,{revision:scene.revision,serviceFlags:{[external.id]:false}});const p=b.preview(f.at.id,input);assert(p.canEmit);assert.equal(p.snapshot.calculation.energy,'21');assert.equal(p.snapshot.calculation.days,'6')
 }finally{db.close()}
})
test('Fase4 V9→V10 additive origin/receipt migration preserves all existing records and rolls back failure',()=>{
 const db=new DatabaseSync(':memory:')
 try{
  db.exec('PRAGMA foreign_keys=ON');v9(db);const f=commercialFixture(db),before=db.prepare('SELECT * FROM diagnosis_services').all(),settings=f.pricing.settings(f.at.id)
  db.exec('CREATE VIEW recommendation_applications AS SELECT id FROM scenarios');assert.throws(()=>migrate(db));assert(!db.prepare('PRAGMA table_info(diagnosis_services)').all().some(c=>c.name==='recommendation_rule_id'));assert.equal(db.prepare('SELECT MAX(version)v FROM schema_migrations').get()!.v,9);assert.deepEqual(db.prepare('SELECT * FROM diagnosis_services').all(),before)
  db.exec('DROP VIEW recommendation_applications');migrate(db);assert.equal(db.prepare('SELECT MAX(version)v FROM schema_migrations').get()!.v,11);assert.deepEqual(f.pricing.settings(f.at.id),settings);assert.deepEqual(db.prepare('SELECT * FROM diagnosis_services').all().map(({recommendation_rule_id,...r})=>{assert.equal(recommendation_rule_id,null);return{...r}}),before.map(r=>({...r})));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})
test('Fase4 ambiguous suggestions require explicit dimension choice, preserving exact rule identity without automatic inference',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=fase4Fixture(db);ready(f);const service=f.entries[0]!,dim=sourceId(TABLES.dimensions,'i-qa-alternative'),id=sourceId(TABLES.diagnosisServices,'i-qa-alternative');db.prepare("INSERT INTO catalog_items(id,kind,name,service_id,status,source,created_at,updated_at)VALUES(?,'dimensao','Outra QA',?,'proposta','operador','qa','qa')").run(dim,service.serviceId);db.prepare("INSERT INTO diagnosis_recommendations VALUES(?,?,'i-qa-alternative',?,'leve',?,?,1,'valid',NULL)").run(id,TABLES.diagnosisServices,f.diagnosis.id,service.serviceId,dim)
  const auto=applySuggestedServices(db,f.at.id,f.item.id,request(f));assert.equal(auto.created.length,5);assert.equal(auto.skipped.filter(r=>r.reason==='CHOOSE_DIMENSION').length,2);assert(!auto.item.services.some(r=>r.serviceId===service.serviceId));const assisted=applySuggestedServices(db,f.at.id,f.item.id,request(f,'assisted',[id]));assert.equal(assisted.created.length,1);assert.equal(assisted.item.services.at(-1)!.dimensionId,dim)
 }finally{db.close()}
})

test('Fase4 existing third-party scope confirmations and flags remain intact after assisted additions',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=fase4Fixture(db);ready(f);const p=f.commercial.list(f.at.id)[0]!,external=f.entries[5]!,saved=f.commercial.updateDiagnosis(f.at.id,p.id,{revision:p.revision,services:[{serviceId:external.serviceId,dimensionId:external.dimensionId,quantity:'0.25',enabled:true}]}),s=f.scenarios.list(f.at.id)[0]!
  f.scenarios.confirmService(f.at.id,s.id,saved.services[0]!.id,{revision:s.revision,pieceRevision:saved.revision,scope:executionScope(saved.services[0]!),confirmed:true})
  const before=db.prepare('SELECT * FROM scenario_service_confirmations').all(),old=f.commercial.list(f.at.id)[0]!.services[0]!,r=applySuggestedServices(db,f.at.id,p.id,request(f,'assisted',recommendations(db,f.diagnosis.id,'leve').map(r=>r.id)))
  assert.deepEqual(db.prepare('SELECT * FROM scenario_service_confirmations').all(),before);assert.deepEqual(r.item.services[0],old);assert.equal(r.created.length,5);assert.equal(r.item.services.filter(l=>l.serviceId===external.serviceId).length,1)
 }finally{db.close()}
})

test('Fase4 null intensity and diagnostics without rules never invent lines; missing financial setup remains pending after legitimate suggestions',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=fase4Fixture(db),care=f.commercial.saveCatalog({kind:'diagnostico',name:'Cuidados operacionais QA'}),p=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId:care.id,intensity:null});assert.equal(p.intensity,null);assert.equal(p.services.length,0)
  const withSeverity=f.commercial.updateDiagnosis(f.at.id,p.id,{revision:p.revision,intensity:'leve'});assert.equal(applySuggestedServices(db,f.at.id,p.id,request(f)).created.length,0);assert.equal(f.commercial.list(f.at.id)[0]!.services.length,0);assert.equal(withSeverity.services.length,0)
  ready(f);const c=f.pricing.get();c.config.services.find(s=>s.serviceId===f.entries[0]!.serviceId)!.base=null;f.pricing.save({revision:c.revision,config:c.config});const r=applySuggestedServices(db,f.at.id,f.item.id,request(f));assert.equal(r.created.length,6);const preview=new BudgetRepository(db).preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}});assert(!preview.canEmit);const line=preview.snapshot.calculation.lines.find(l=>l.id===r.item.services[0]!.id)!;assert.equal(line.unit,null);assert.equal(line.total,null)
 }finally{db.close()}
})
