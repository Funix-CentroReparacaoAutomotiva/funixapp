import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {calculationFixture} from './pricing.test.ts'
import {calculate} from '../pricing-engine.ts'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {PricingConfigurationRepository} from '../pricing-config.ts'
import {BudgetRepository} from '../budgets.ts'
import {codaFixture,set,pushRow,row,ref,table} from './fixtures/coda-import.ts'
import {planImport,applyImport} from '../coda-import.ts'
import {TABLES} from '../coda-import-source.ts'

test('Issue20 FC is conditional, missing legacy FC stays on, unknown is pending; FR always required for normal even with FV zero',()=>{
 const f=calculationFixture(),s=f.config.services[0]!
 s.base='10';s.colorFactorEnabled=false;f.config.colors=[];f.config.risks[0]!.factor='1.3'
 assert.equal(f.run().lines[0]!.unit,'13');assert.deepEqual(f.run().errors,[])
 s.colorFactorEnabled=true;assert(f.run().errors.some(e=>e.includes('FC não configurado')))
 delete s.colorFactorEnabled;assert(f.run().errors.some(e=>e.includes('FC não configurado')))
 s.colorFactorEnabled=null;assert(f.run().errors.some(e=>e.includes('Habilitação de FC')))
 s.colorFactorEnabled=false;f.config.risks=[];assert(f.run().errors.some(e=>e.includes('FR não configurado')))
 f.config.tables[0]!.factor='0';assert(f.run().errors.some(e=>e.includes('FR não configurado')))
})

test('Issue20 discounts affect only explicitly eligible services; all lines keep prices and components stay untouched',()=>{
 const f=calculationFixture();f.items[0]!.services[0]!.quantity='1';f.config.services[0]!.base='100'
 f.catalog.push({...f.catalog[1]!,id:'svc2',name:'Não descontável QA'},{...f.catalog[2]!,id:'dim2',serviceId:'svc2'})
 f.config.services.push({serviceId:'svc2',base:'50',colorFactorEnabled:false,discountable:false,dimensions:[{...f.config.services[0]!.dimensions[0]!,dimensionId:'dim2'}]})
 f.items[0]!.services.push({id:'l2',serviceId:'svc2',dimensionId:'dim2',quantity:'1',enabled:true});f.scenario.serviceFlags.l2=true
 f.components.push({id:'c',atendimentoId:'at',pieceId:'p',name:'QA componente',quantity:'2',manualPrice:'10',notes:'',revision:1});f.scenario.componentFlags.c=true
 const run=(value:string)=>calculate(f.items,f.components,f.catalog,f.scenario,f.config,f.settings,{mode:'discount',value,acknowledgeResidual:false})
 for(const [value,total] of [['0','174'],['100','74']]){
  const c=run(value!);assert.deepEqual(c.errors,[]);assert.equal(c.total,total);assert.equal(c.discountEligibleSubtotal,'100')
  assert.deepEqual(c.lines.map(l=>l.total),['100','50','24']);assert.equal(c.componentSubtotal,'24')
 }
 const over=run('100.01');assert(over.errors.some(e=>e.includes('descontáveis')));assert.equal(over.discount,'0');assert.equal(over.total,'174')
 delete f.config.services[0]!.discountable
 assert.equal(run('0').discountEligibleSubtotal,'0');assert.deepEqual(run('0').errors,[]);assert(run('1').errors.some(e=>e.includes('descontáveis')))
 // Existing Negociação is a distinct contract: target of all services, never components.
 const adjusted=calculate(f.items,f.components,f.catalog,f.scenario,f.config,f.settings,{mode:'adjust',value:'140',acknowledgeResidual:false})
 assert.deepEqual(adjusted.errors,[]);assert.equal(adjusted.total,'164');assert.equal(adjusted.componentSubtotal,'24')
})

test('Issue20 four FV factors and exact exception keep cents ceiling, quantities, energy, and eligibility independent',()=>{
 const f=calculationFixture(),s=f.config.services[0]!
 s.base='10.01';s.dimensions[0]!.fd='1.5';f.config.colors[0]!.factor='1.1';f.config.risks[0]!.factor='1.3';f.items[0]!.services[0]!.quantity='0.25'
 for(const [factor,unit,total] of [['1','21.5','5.375'],['0.8','17.2','4.3'],['0.6','12.9','3.225'],['0','0','0']]){f.config.tables[0]!.factor=factor!;const c=f.run();assert.equal(c.lines[0]!.unit,unit);assert.equal(c.total,total);assert.equal(c.energy,'1.25')}
 s.colorFactorEnabled=null;s.discountable=false;s.base=null;s.dimensions[0]!.fd=null;f.config.colors=[];f.config.risks=[];f.config.tables[0]!.factor=null
 f.config.specialPrices=[{tableId:'table',serviceId:'svc',dimensionId:'dim',unit:'5.01'}]
 const special=f.run();assert.deepEqual(special.errors,[]);assert.equal(special.lines[0]!.unit,'5.05');assert.equal(special.energy,'1.25')
 assert(calculate(f.items,[],f.catalog,f.scenario,f.config,f.settings,{mode:'discount',value:'0.01',acknowledgeResidual:false}).errors.some(e=>e.includes('descontáveis')))
 s.discountable=true;assert.deepEqual(calculate(f.items,[],f.catalog,f.scenario,f.config,f.settings,{mode:'discount',value:'0.01',acknowledgeResidual:false}).errors,[])
 f.config.specialPrices[0]!.tableId='other';assert(f.run().errors.some(e=>e.includes('Habilitação de FC')))
})

test('Issue20 reuses additive multi-stage energy, dimension isolation, quantity, capacity and special-price independence; MR never affects services',()=>{
 const f=calculationFixture(),s=f.config.services[0]!
 s.dimensions[0]!.stages.push({id:'other-step',name:'Etapa QA 2',dimension:'Técnica QA',baseEnergy:'1',dimensionEnergy:'4'})
 f.items[0]!.services[0]!.quantity='0.25';assert.equal(f.run().energy,'2.5');assert.equal(f.run().days,'1')
 f.config.capacity='1';assert.equal(f.run().days,'3')
 f.catalog.push({...f.catalog[2]!,id:'other-dim'});s.dimensions.push({dimensionId:'other-dim',fd:'2',stages:[{id:'isolated',name:'Outra etapa QA',dimension:'Outra dimensão QA',baseEnergy:'10',dimensionEnergy:'2'}]})
 f.items[0]!.services[0]!.dimensionId='other-dim';assert.equal(f.run().energy,'3');assert.equal(f.run().days,'3')
 f.config.specialPrices=[{tableId:'table',serviceId:'svc',dimensionId:'other-dim',unit:'1'}];assert.equal(f.run().energy,'3')
 const unit=f.run().lines[0]!.unit;f.config.resaleMultipliers![0]!.factor='9';assert.equal(f.run().lines[0]!.unit,unit)
})

test('Issue20 flags persist in V7 JSON, validate booleans, survive legacy PATCH omissions/restart and do not change frozen snapshots/PDF',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix20-')),file=join(dir,'qa-v7.sqlite');let db=openDatabase(file)
 try{
  const f=commercialFixture(db),repo=new PricingConfigurationRepository(db),budgets=new BudgetRepository(db)
  // Simulate the actual pre-Issue20 V7 JSON: no new flags and no automatic migration/write.
  const original=structuredClone(repo.get().config)
  for(const s of original.services){delete s.colorFactorEnabled;delete s.discountable;delete s.billable}
  db.prepare('UPDATE pricing_configuration SET data=? WHERE id=1').run(JSON.stringify(original))
  assert.equal(repo.get().revision,2)
  const request={scenarioId:f.scenario.id,negotiation:{mode:'none'}},preview=budgets.preview(f.at.id,request)
  const version=budgets.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:'issue20-preserve-snapshot'}),pdf=budgets.pdf(f.at.id,version.id),before=repo.get()
  assert.equal(version.snapshot.calculation.discountEligibleSubtotal,'0')
  const config=structuredClone(before.config);config.services[0]!.colorFactorEnabled=false;config.services[0]!.discountable=false;config.services[0]!.billable=false
  repo.save({revision:before.revision,config})
  assert.deepEqual(budgets.get(f.at.id,version.id),version);assert.deepEqual(budgets.pdf(f.at.id,version.id),pdf)
  const legacy=structuredClone(config);delete legacy.services[0]!.colorFactorEnabled;delete legacy.services[0]!.discountable;delete legacy.services[0]!.billable
  const saved=repo.save({revision:repo.get().revision,config:legacy});assert.equal(saved.config.services[0]!.colorFactorEnabled,false);assert.equal(saved.config.services[0]!.discountable,false)
  for(const flag of ['colorFactorEnabled','discountable','billable']){const invalid=structuredClone(config);Object.assign(invalid.services[0]!,{[flag]:'false'});assert.throws(()=>repo.save({revision:repo.get().revision,config:invalid}))}
  db.close();db=openDatabase(file);assert.equal(new PricingConfigurationRepository(db).get().config.services[0]!.discountable,false)
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,10);assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog_items WHERE kind='peca'").get()!.n,163)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})

test('Issue20 importer maps service flags separately, FR always-on decision and actual FV; conflicting FC is explicit, not chosen from a table',()=>{
 const db=openDatabase(':memory:'),source=codaFixture()
 try{
  set(source,TABLES.rules,'c-jIfhQ2URf5',false);set(source,TABLES.rules,'c--xF4R7C4Rv',false);set(source,TABLES.services,'c-r5HLQrISpN',false)
  let p=planImport(db,source),s=p.config.services[0]!
  assert.equal(s.base,'100.01');assert.equal(s.colorFactorEnabled,false);assert.equal(s.discountable,false);assert.equal(s.billable,true)
  const rule=structuredClone(table(source,TABLES.rules).rows[0]!);rule.rowId='i-other';rule.values['c-jIfhQ2URf5']={value:true};pushRow(source,TABLES.rules,rule)
  p=planImport(db,source);assert.equal(p.config.services[0]!.colorFactorEnabled,null);assert(p.report.pending.some(e=>e.reason.includes('FC por serviço pendente')))
  for(const [key,factor] of [['partner','0.8'],['team','0.6'],['rework','0']])pushRow(source,TABLES.tables,row('i-'+key,{'c-CeD0PIBx4t':'Tabela QA '+key,'c-QMXNRk1uDX':factor,'c-o2aKUZyPE7':true}))
  p=planImport(db,source);assert.deepEqual(p.config.tables.map(t=>t.factor),['1','0.8','0.6','0'])
  assert.deepEqual(p.config.resaleMultipliers,[{id:'funix:mr:padrao',name:'Padrão',factor:'1.2'}])
  // A tabled sentinel cannot become an invented special for every dimension.
  set(source,TABLES.rules,'c-4i-UJzr0Ry',{name:'tabelado'});assert.deepEqual(planImport(db,source).config.specialPrices,[])
  const specialSource=codaFixture();set(specialSource,TABLES.rules,'c-4i-UJzr0Ry',{name:'tabelado'});set(specialSource,TABLES.rules,'c-trJtxn7Rnm',ref(TABLES.dimensions,'i-synthetic-dimension'))
  assert.equal(planImport(db,specialSource).config.specialPrices.length,1)
 }finally{db.close()}
})

test('Issue20 technical import preserves all relation IDs and prevents stages leaking between service dimensions',()=>{
 const db=openDatabase(':memory:'),source=codaFixture()
 try{
  pushRow(source,TABLES.dimensionNames,row('i-name2',{'c-FJw9NIz2cO':'Outra dimensão QA'}))
  pushRow(source,TABLES.dimensions,row('i-dim2',{'c-TvFH_jzZ3k':ref(TABLES.services,'i-XDTMBmueos'),'c-DGi7Us0d5f':ref(TABLES.dimensionNames,'i-name2'),'c-YB4iqbCDp_':2,'c-wZoGYfi40i':8}))
  pushRow(source,TABLES.energy,row('i-energy6',{'c-3-8rupyDNx':6}))
  pushRow(source,TABLES.stageDimensions,row('i-stage-dim2',{'c-tb4TOqyqh7':'Outra dimensão técnica QA','c-ufXqc_8vWI':ref(TABLES.energy,'i-energy6')}))
  const duplicate=structuredClone(table(source,TABLES.relations).rows[0]!);duplicate.rowId='i-repeated-stage';pushRow(source,TABLES.relations,duplicate)
  set(source,TABLES.dimensions,'c-wZoGYfi40i',10)
  const other=structuredClone(duplicate);other.rowId='i-other-dimension';other.values['c-EBO2IBlQEH']={value:ref(TABLES.dimensions,'i-dim2')};other.values['c-B9QLxROotP']={value:ref(TABLES.stageDimensions,'i-stage-dim2')};other.values['c-Ii7Vzlr1ni']={value:8};pushRow(source,TABLES.relations,other)
  const plan=planImport(db,source);assert.equal(plan.report.conflicts.length,0)
  const dims=plan.config.services[0]!.dimensions;assert.equal(dims[0]!.stages.length,2);assert.equal(new Set(dims[0]!.stages.map(s=>s.id)).size,2)
  assert.equal(dims[1]!.stages.length,1);assert.equal(dims[1]!.stages[0]!.dimensionEnergy,'6')
  applyImport(db,source,plan.planHash);assert.equal(planImport(db,source).report.inserts,0)
 }finally{db.close()}
})
