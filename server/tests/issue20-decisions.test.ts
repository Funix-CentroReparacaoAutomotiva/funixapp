import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {planImport,applyImport,digest} from '../coda-import.ts'
import {TABLES} from '../coda-import-source.ts'
import {codaFixture,set} from './fixtures/coda-import.ts'
import {PricingConfigurationRepository} from '../pricing-config.ts'
import {CommercialRepository} from '../commercial.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {ScenarioRepository} from '../scenarios.ts'
import {ComponentRepository} from '../components.ts'
import {BudgetRepository} from '../budgets.ts'

// Approved target identities; every price/energy below comes from the synthetic fixture.
const approvedServices=[['i-qCp1gLfJn4','Interna'],['i-AlsNigbGqx','Lavagem'],['i-dMshyG5NMo','Inspeção técnica']] as const
const mr={id:'funix:mr:padrao',name:'Padrão',factor:'1.2'}
function sourceFor(id:string,name:string){
 const source=JSON.parse(JSON.stringify(codaFixture()).replaceAll('i-XDTMBmueos',id)) as ReturnType<typeof codaFixture>
 set(source,TABLES.services,'c-TvFH_jzZ3k',name)
 return source
}

test('direction disables FC only for the three stable source IDs; source flags, FR, and other services are not changed',()=>{
 for(const [id,name] of approvedServices){
  const db=openDatabase(':memory:'),source=sourceFor(id,name),before=digest(source)
  try{
   const plan=planImport(db,source),service=plan.config.services[0]!
   assert.equal(service.colorFactorEnabled,false,name);assert.equal(service.discountable,true);assert.equal(service.billable,true)
   assert.equal(digest(source),before);assert(plan.report.imported.some(r=>r.source===service.serviceId && r.reason.includes('6500884942')))
   assert(!plan.report.pending.some(r=>r.source===service.serviceId && r.reason.includes('FC por serviço')))
   applyImport(db,source,plan.planHash)
   const pricing=new PricingConfigurationRepository(db),commercial=new CommercialRepository(db),at=new AtendimentoRepository(db).create({phone:'123'})
   const item=commercial.add(at.id,{pieceCodes:['capo']})[0]!
   if(id==='i-qCp1gLfJn4'||id==='i-dMshyG5NMo'){
    assert.throws(()=>commercial.updateDiagnosis(at.id,item.id,{revision:item.revision,services:[{serviceId:service.serviceId,dimensionId:service.dimensions[0]!.dimensionId,quantity:'1'}]}),e=>(e as {code:string}).code==='CURATION_SELECTION_BLOCKED')
    // A real pre-curation reference is not reactivated or rewritten: seed it only in this synthetic legacy scenario.
    db.prepare('INSERT INTO diagnosis_services(id,diagnosis_item_id,service_id,dimension_id,quantity,enabled) VALUES(?,?,?,?,?,1)').run('legacy-line',item.id,service.serviceId,service.dimensions[0]!.dimensionId,'1')
    db.prepare('UPDATE scenario_service_flags SET enabled=1 WHERE service_id=?').run('legacy-line')
   }else commercial.updateDiagnosis(at.id,item.id,{revision:item.revision,services:[{serviceId:service.serviceId,dimensionId:service.dimensions[0]!.dimensionId,quantity:'1'}]})
   const scenario=new ScenarioRepository(db).list(at.id)[0]!,budgets=new BudgetRepository(db)
   pricing.saveSettings(at.id,{revision:pricing.settings(at.id).revision,tableId:plan.config.tables[0]!.id,riskId:plan.config.risks[0]!.id,colorId:null})
   let preview=budgets.preview(at.id,{scenarioId:scenario.id,negotiation:{mode:'none'}})
   assert(preview.canEmit,name);if(id==='i-dMshyG5NMo'){assert.equal(preview.snapshot.calculation.total,'0');assert.equal(preview.snapshot.calculation.lines[0]!.unit,null)}else{assert.equal(preview.snapshot.calculation.total,'100.05');assert.equal(preview.snapshot.calculation.lines[0]!.factors.FC,'1')}
   pricing.saveSettings(at.id,{revision:pricing.settings(at.id).revision,riskId:null})
   preview=budgets.preview(at.id,{scenarioId:scenario.id,negotiation:{mode:'none'}})
   if(id==='i-dMshyG5NMo')assert(preview.canEmit,'not-billed activity does not enter the normal price path');else{assert(!preview.canEmit);assert(preview.snapshot.calculation.errors.some(e=>e.includes('FR não configurado')))}
  }finally{db.close()}
 }
 const db=openDatabase(':memory:')
 try{
  const source=sourceFor('i-XDTMBmueos','Interna')
  assert.equal(planImport(db,source).config.services[0]!.colorFactorEnabled,true,'name alone must not override another identity')
  set(source,TABLES.rules,'c-jIfhQ2URf5',false);assert.equal(planImport(db,source).config.services[0]!.colorFactorEnabled,false)
 }finally{db.close()}
})

test('approved legacy MR option is added once; new MR20% default prices components only without selecting legacy IDs',()=>{
 const db=openDatabase(':memory:')
 try{
  const ats=new AtendimentoRepository(db),existing=ats.create({phone:'123'}),pricing=new PricingConfigurationRepository(db),source=codaFixture(),before=digest(pricing.get())
  const plan=planImport(db,source);assert.equal(digest(pricing.get()),before,'dry-run must not write')
  assert.deepEqual(plan.config.resaleMultipliers,[mr]);applyImport(db,source,plan.planHash)
  assert.equal(pricing.settings(existing.id).settings.mrId,undefined)
  assert.equal(pricing.settings(ats.create({phone:'456'}).id).settings.mrId,undefined)
  const commercial=new CommercialRepository(db),item=commercial.add(existing.id,{pieceCodes:['capo']})[0]!,service=plan.config.services[0]!
  commercial.updateDiagnosis(existing.id,item.id,{revision:item.revision,services:[{serviceId:service.serviceId,dimensionId:service.dimensions[0]!.dimensionId,quantity:'1'}]})
  pricing.saveSettings(existing.id,{revision:pricing.settings(existing.id).revision,tableId:plan.config.tables[0]!.id,colorId:plan.config.colors[0]!.id,riskId:plan.config.risks[0]!.id})
  const parts=new ComponentRepository(db)
  parts.save(existing.id,{pieceId:item.id,name:'Componente QA A',quantity:'1',manualPrice:'100',notes:''})
  parts.save(existing.id,{pieceId:item.id,name:'Componente QA B',quantity:'0.25',manualPrice:'10.01',notes:''})
  const scenario=new ScenarioRepository(db).list(existing.id)[0]!,budgets=new BudgetRepository(db),request={scenarioId:scenario.id,negotiation:{mode:'none'}}
  const initialized=budgets.preview(existing.id,request);assert(initialized.canEmit);assert.equal(pricing.settings(existing.id).settings.mrPercent,'20')
  pricing.saveSettings(existing.id,{revision:pricing.settings(existing.id).revision,mrId:mr.id})
  const preview=budgets.preview(existing.id,request),calc=preview.snapshot.calculation
  assert(preview.canEmit);assert.equal(calc.serviceSubtotal,'100.05');assert.equal(calc.componentSubtotal,'123.0125');assert.equal(calc.total,'223.0625')
  assert.deepEqual(calc.lines.filter(l=>l.kind==='component').map(l=>l.factors.MR),['1.2','1.2'])
  const settings=pricing.settings(existing.id),revision=pricing.get().revision,repeat=planImport(db,source)
  assert.equal(repeat.report.inserts,0);applyImport(db,source,repeat.planHash)
  assert.equal(pricing.get().revision,revision);assert.deepEqual(pricing.settings(existing.id),settings)
 }finally{db.close()}
})

test('equivalent local Padrão MR is reused by its own ID; unrelated options and selections survive',()=>{
 for(const equivalent of [false,true]){
  const db=openDatabase(':memory:'),pricing=new PricingConfigurationRepository(db)
  try{
   const config=pricing.get().config,local={id:'local-operator-mr',name:equivalent?'Padrão':'Outra opção QA',factor:equivalent?'1.20':'2'}
   config.resaleMultipliers=[local];pricing.save({revision:pricing.get().revision,config})
   const at=new AtendimentoRepository(db).create({phone:'123'});pricing.saveSettings(at.id,{revision:pricing.settings(at.id).revision,mrId:local.id})
   const before=pricing.settings(at.id),source=codaFixture(),plan=planImport(db,source)
   assert.equal(plan.report.conflicts.length,0);applyImport(db,source,plan.planHash)
   const options=pricing.get().config.resaleMultipliers!
   assert.equal(options.length,equivalent?1:2);assert.equal(options[0]!.id,local.id);assert.equal(options[0]!.factor,equivalent?'1.2':'2')
   assert.deepEqual(pricing.settings(at.id),before)
   assert.equal(planImport(db,source).report.inserts,0)
  }finally{db.close()}
 }
})

test('divergent/duplicate local Padrão MR and local FC edits are reported without overwrite or partial application',()=>{
 for(const options of [[{id:'local',name:'Padrão',factor:'2'}],[{id:mr.id,name:'Renomeado localmente',factor:'1.2'}],[{...mr},{id:'duplicate',name:'Padrão',factor:'1.2'}]]){
  const db=openDatabase(':memory:'),pricing=new PricingConfigurationRepository(db)
  try{
   const config=pricing.get().config;config.resaleMultipliers=options;pricing.save({revision:pricing.get().revision,config})
   const before=digest(pricing.get()),source=codaFixture(),plan=planImport(db,source)
   assert(plan.report.conflicts.some(c=>c.source===mr.id));assert.throws(()=>applyImport(db,source,plan.planHash),/Conflitos/)
   assert.equal(digest(pricing.get()),before);assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog_items WHERE kind='servico'").get()!.n,0)
  }finally{db.close()}
 }
 const db=openDatabase(':memory:'),pricing=new PricingConfigurationRepository(db),source=sourceFor(approvedServices[0][0],approvedServices[0][1])
 try{
  const plan=planImport(db,source);applyImport(db,source,plan.planHash)
  const config=pricing.get().config;config.services[0]!.colorFactorEnabled=true;pricing.save({revision:pricing.get().revision,config})
  const before=digest(pricing.get()),repeat=planImport(db,source)
  assert(repeat.report.conflicts.some(c=>c.source===config.services[0]!.serviceId));assert.throws(()=>applyImport(db,source,repeat.planHash),/Conflitos/)
  assert.equal(digest(pricing.get()),before)
 }finally{db.close()}
})
