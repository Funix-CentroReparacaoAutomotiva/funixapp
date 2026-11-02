import test from 'node:test'
import assert from 'node:assert/strict'
import{mkdtempSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{randomUUID}from'node:crypto'
import{openDatabase}from'../database.ts'
import{PricingConfigurationRepository}from'../pricing-config.ts'
import{ComponentRepository}from'../components.ts'
import{BudgetRepository}from'../budgets.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{financialDefaults}from'../../shared/financial-defaults.ts'
import{canonicalPercent,percentInput,percentToFactor,legacyPercent,resolveMR}from'../../shared/mr.ts'
import{calculate}from'../pricing-engine.ts'
function defaultsFixture(db:ReturnType<typeof openDatabase>){
 const f=commercialFixture(db),config={...f.pricing.get().config,defaults:undefined,tables:[{id:'t-default',name:'Padrão',factor:'1'},{id:'other',name:'Outra',factor:'2'}],colors:[{id:'stable-c1',name:'C1',factor:'1.01'},{id:'c0',name:'C0',factor:'0.91'}],risks:[{id:'stable-r1',name:'R1',factor:'1.06'},{id:'r0',name:'R0',factor:'0.89'}]}
 // This fixture replaces an earlier synthetic catalog: request the approved defaults explicitly.
 f.pricing.save({revision:f.pricing.get().revision,config:{...config,defaults:{tableId:'t-default',colorId:'stable-c1',riskId:'stable-r1',mrPercent:'20'}}})
 return f
}
test('Fase2 exact percentage conversion, commas, zero, invalid and non-finite inputs',()=>{
 for(const[p,f]of[['0','1'],['20','1.2'],['30','1.3'],['25.5','1.255'],['0.000001','1.00000001']]as const){assert.equal(percentToFactor(p),f);assert.equal(legacyPercent(f),p)}
 assert.equal(percentInput(' 25,50% '),'25.5');assert.equal(percentInput('25.5'),'25.5')
 for(const invalid of['','-1','NaN','Infinity','1e2','1.2.3','1,2,3','0.1234567','9999999999999',null,20])assert.equal(canonicalPercent(invalid),null)
 assert.equal(legacyPercent('0.8'),null)
})
test('Fase2 new defaults persist across reopen; identities and manual choices survive default/value changes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-fase2-')),path=join(dir,'synthetic.sqlite');let db=openDatabase(path)
 try{
  const f=defaultsFixture(db),at=f.atendimentos.create({phone:'123'}),p=f.pricing.settings(at.id)
  assert.deepEqual(p.settings,{tableId:'t-default',colorId:'stable-c1',riskId:'stable-r1',mrPercent:'20',defaultsInitialized:true})
  f.pricing.saveSettings(at.id,{revision:p.revision,tableId:'other',colorId:'c0',riskId:'r0',mrPercent:'0'})
  const saved=f.pricing.settings(at.id),c=f.pricing.get();c.config.colors[0]!.factor='1.05';c.config.risks[0]!.factor='1.15';c.config.defaults!.mrPercent='30'
  f.pricing.save({revision:c.revision,config:c.config});f.pricing.initializeSettings(at.id,{})
  assert.deepEqual(f.pricing.settings(at.id),saved)
  const next=f.atendimentos.create({phone:'456'});assert.equal(f.pricing.settings(next.id).settings.mrPercent,'30');assert.equal(f.pricing.settings(next.id).settings.colorId,'stable-c1')
  db.close();db=openDatabase(path);assert.deepEqual(new PricingConfigurationRepository(db).settings(at.id),saved);assert.equal(new PricingConfigurationRepository(db).get().config.colors[0]!.id,'stable-c1')
  assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
test('Fase2 resolves defaults by unique names, never values; persisted IDs survive renames and missing factors stay pending',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),config={...f.config,tables:[{id:'t',name:'Padrão',factor:null}],colors:[{id:'c',name:'C1',factor:'1.05'}],risks:[{id:'r',name:'R1',factor:null}]}
  assert.deepEqual(financialDefaults(config),{tableId:'t',colorId:'c',riskId:'r',mrPercent:'20'})
  assert.equal(financialDefaults({...config,colors:[{id:'wrong',name:'Outro',factor:'1.01'}]}).colorId,null)
  assert.equal(financialDefaults({...config,colors:[...config.colors,{id:'dup',name:'C1',factor:'1.01'}]}).colorId,null)
  assert.equal(financialDefaults({...config,defaults:{...financialDefaults(config),colorId:'c'},colors:[]}).colorId,'c')
 }finally{db.close()}
})
test('Fase2 one-time legacy initialization preserves explicit null/zero/manual choices and converts only unambiguous MR',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=defaultsFixture(db)
  for(const[raw,expected]of[
   [{},{tableId:'t-default',colorId:'stable-c1',riskId:'stable-r1',mrPercent:'20'}],
   [{tableId:null,colorId:'c0',mrPercent:'0'},{tableId:null,colorId:'c0',riskId:'stable-r1',mrPercent:'0'}],
   [{mrId:'mr'},{tableId:'t-default',colorId:'stable-c1',riskId:'stable-r1',mrId:null,mrPercent:'100'}],
   [{mrId:'absent'},{tableId:'t-default',colorId:'stable-c1',riskId:'stable-r1',mrId:'absent'}],
  ]as const){
   const at=f.atendimentos.create({phone:'123'});db.prepare('UPDATE commercial_state SET settings_json=? WHERE atendimento_id=?').run(JSON.stringify(raw),at.id)
   const before=f.pricing.settings(at.id).revision;f.pricing.initializeSettings(at.id,{})
   assert.deepEqual(f.pricing.settings(at.id).settings,{...expected,defaultsInitialized:true});assert.equal(f.pricing.settings(at.id).revision,before+1)
   const once=f.pricing.settings(at.id);f.pricing.initializeSettings(at.id,{});assert.deepEqual(f.pricing.settings(at.id),once)
  }
  const at=f.atendimentos.create({phone:'123'}),cfg=f.pricing.get();cfg.config.resaleMultipliers!.push({id:'reduction',name:'Legado',factor:'0.8'});f.pricing.save({revision:cfg.revision,config:cfg.config})
  db.prepare('UPDATE commercial_state SET settings_json=? WHERE atendimento_id=?').run(JSON.stringify({mrId:'reduction'}),at.id);f.pricing.initializeSettings(at.id,{})
  assert.equal(f.pricing.settings(at.id).settings.mrId,'reduction');assert.equal(resolveMR(f.pricing.settings(at.id).settings,cfg.config).factor,'0.8')
 }finally{db.close()}
})
for(const[percent,unit,total]of[['20','120.05','30.0125'],['30','130.05','32.5125'],['0','100.05','25.0125'],['25.5','125.55','31.3875'],['0.000001','100.05','25.0125']]as const)test('Fase2 MR '+percent+'% exact unit ceiling before fractional quantity; shared scenarios and frozen emissions',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),parts=new ComponentRepository(db),b=new BudgetRepository(db),part=parts.save(f.at.id,{pieceId:f.item.id,name:'QA componente',quantity:'0.25',manualPrice:'100.01',notes:''})
  parts.save(f.at.id,{pieceId:f.item.id,name:'QA custo zero',quantity:'3',manualPrice:'0',notes:''})
  f.pricing.saveSettings(f.at.id,{revision:f.pricing.settings(f.at.id).revision,mrPercent:percent})
  const scene=f.scenarios.list(f.at.id)[0]!,two=f.scenarios.create(f.at.id,{name:'Outro',duplicateFrom:scene.id,sourceRevision:scene.revision}),req={scenarioId:scene.id,negotiation:{mode:'none'}},preview=b.preview(f.at.id,req),calc=preview.snapshot.calculation
  assert(preview.canEmit);assert.equal(calc.componentSubtotal,total);assert.equal(calc.originalServiceSubtotal,'300.15');assert.equal(calc.lines.find(l=>l.id===part.id)!.unit,unit);assert.equal(calc.lines.find(l=>l.id===part.id)!.factors.MRPercent,percent)
  assert.equal(b.preview(f.at.id,{...req,scenarioId:two.id}).snapshot.calculation.componentSubtotal,total)
  const v=b.emit(f.at.id,{...req,previewToken:preview.token,idempotencyKey:randomUUID()}),pdf=b.pdf(f.at.id,v.id)
  assert.equal(v.snapshot.settings.mrPercent,percent)
  f.pricing.saveSettings(f.at.id,{revision:f.pricing.settings(f.at.id).revision,mrPercent:'50'})
  assert.deepEqual(b.get(f.at.id,v.id),v);assert.deepEqual(b.pdf(f.at.id,v.id),pdf)
 }finally{db.close()}
})
test('Fase2 invalid writes and stale revisions preserve MR; dual interpretation rejected; zero is explicit',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),before=f.pricing.settings(f.at.id)
  for(const value of['','-1','Infinity','NaN','25,5',20])assert.throws(()=>f.pricing.saveSettings(f.at.id,{revision:before.revision,mrPercent:value}))
  assert.deepEqual(f.pricing.settings(f.at.id),before)
  assert.throws(()=>f.pricing.saveSettings(f.at.id,{revision:before.revision,mrId:'mr',mrPercent:'20'}))
  f.pricing.saveSettings(f.at.id,{revision:before.revision,mrPercent:'0'});assert.throws(()=>f.pricing.saveSettings(f.at.id,{revision:before.revision,mrPercent:'30'}))
  assert.equal(f.pricing.settings(f.at.id).settings.mrPercent,'0');assert.equal(f.pricing.settings(f.at.id).settings.mrId,null)
 }finally{db.close()}
})
test('Fase2 FC/FR factor edits retain identity, change applicable draft prices, invalidate previews, freeze PDF',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),budgets=new BudgetRepository(db),req={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=budgets.preview(f.at.id,req),v=budgets.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:randomUUID()}),pdf=budgets.pdf(f.at.id,v.id)
  for(const key of['colors','risks']as const){const c=f.pricing.get();c.config[key][0]!.factor='1.05';f.pricing.save({revision:c.revision,config:c.config});assert.equal(c.config[key][0]!.id,key==='colors'?'color':'risk');assert.notEqual(budgets.preview(f.at.id,req).snapshot.calculation.total,p.snapshot.calculation.total)}
  assert.throws(()=>budgets.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:randomUUID()}))
  assert.deepEqual(budgets.get(f.at.id,v.id),v);assert.deepEqual(budgets.pdf(f.at.id,v.id),pdf)
  const settings=f.pricing.settings(f.at.id).settings,config=f.pricing.get().config;config.colors[0]!.factor=null
  assert(calculate(f.commercial.list(f.at.id),[],f.commercial.catalogs().items,f.scenarios.list(f.at.id)[0]!,config,settings).errors.length>0)
 }finally{db.close()}
})
