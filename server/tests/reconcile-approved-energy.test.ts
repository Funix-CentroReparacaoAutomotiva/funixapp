import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase,backupDatabase} from '../database.ts'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CommercialRepository} from '../commercial.ts'
import {ScenarioRepository} from '../scenarios.ts'
import {PricingConfigurationRepository} from '../pricing-config.ts'
import {WorkOrderRepository} from '../work-orders.ts'
import {planApprovedPieces,applyApprovedPieces} from '../approved-pieces-165.ts'
import {requiredVehicleCatalog} from '../default-vehicle-composition.ts'
import {planImport,applyImport} from '../coda-import.ts'
import {planEnergyReconciliation,applyEnergyReconciliation} from '../reconcile-approved-energy.ts'
import {TABLES,sourceId} from '../coda-import-source.ts'
import type {PricingConfig} from '../../shared/pricing.ts'
import {codaFixture,table,row,ref} from './fixtures/coda-import.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'

// Synthetic configuration with the exact audited identities and historical
// operands. All financial values are synthetic; never loaded at startup.
function fullSource(){
 const s=codaFixture()
 const services=[
 ['i-SW0n7TLbtf','Degradê'],['i-6v-u7Wk73b','Vidraçaria'],
 ['i-XDTMBmueos','Pintura'],['i-NG0WMuMSy1','Polimento'],['i-MC_Z0KK6Hn','Vitrificação']
 ] as const
 const dims=[
 ['i-SW0n7TLbtf','P','i-SW0n7TLbtf',5],['i-k8ZulOn21b','M','i-SW0n7TLbtf',5],
 ['i-RQlr0QK5rR','G','i-SW0n7TLbtf',5],['i-gXduy16b-V','GG','i-SW0n7TLbtf',5],
 ['i-XAWXTYWQIa','-','i-6v-u7Wk73b',3],['i-6qb1FQ1krk','Pincelada','i-XDTMBmueos',1],
 ['i-6Nx-kpDlH8','Acessórios','i-XDTMBmueos',9],['i-c5xaRttDXs','Veículo M','i-NG0WMuMSy1',5],
 ['i-8o9Z1Z6jtk','Peça','i-MC_Z0KK6Hn',7]
 ] as const
 const stages=[
 ['i-SW0n7TLbtf','Degradê',5,'i-RkEIZ7Txjg'],['i-6v-u7Wk73b','Vidraçaria',3,'i-9eG6f0dpjb'],
 ['i-XDTMBmueos','Pintura',8,'i-RkEIZ7Txjg'],['i-avxVYqUXNz','Acabamento',3,'i-RkEIZ7Txjg'],
 ['i-7AlfEsZwkv','Descontaminação',2,'i-56WGZfFA7s'],['i-ff8qEu9_LD','Corte',2,'i-56WGZfFA7s'],
 ['i-x906J_jYhv','Refino',2,'i-56WGZfFA7s'],['i-rRYmRgRJK2','Lustre',2,'i-56WGZfFA7s'],
 ['i-MC_Z0KK6Hn','Vitrificação',7,'i-56WGZfFA7s']
 ] as const
 const rels=[
 ['i-ekeOrRBJGn','i-SW0n7TLbtf','i-SW0n7TLbtf','i-SW0n7TLbtf','i-jTU8EBeCLM',5,1],
 ['i-Ou8mlsIazc','i-SW0n7TLbtf','i-k8ZulOn21b','i-SW0n7TLbtf','i-jTU8EBeCLM',5,1],
 ['i-LLkWvIS_GR','i-SW0n7TLbtf','i-RQlr0QK5rR','i-SW0n7TLbtf','i-jTU8EBeCLM',5,1],
 ['i-gJGB2ADks6','i-SW0n7TLbtf','i-gXduy16b-V','i-SW0n7TLbtf','i-jTU8EBeCLM',5,1],
 ['i-5C_giBUwFs','i-6v-u7Wk73b','i-XAWXTYWQIa','i-6v-u7Wk73b',null,3,1],
 ['i-S_6NRwNdUK','i-XDTMBmueos','i-6qb1FQ1krk','i-XDTMBmueos','i-SUivHVlB1n',1,1],
 ['i-NXnon77Rne','i-XDTMBmueos','i-6Nx-kpDlH8','i-XDTMBmueos','i-g8kG8I5f8m',7,1],
 ['i-TBgYlc8UyX','i-XDTMBmueos','i-6Nx-kpDlH8','i-avxVYqUXNz','i-g8kG8I5f8m',2,2],
 ['i-U2gB0INEA4','i-NG0WMuMSy1','i-c5xaRttDXs','i-7AlfEsZwkv',null,2,1],
 ['i-vFq1IPDC6U','i-NG0WMuMSy1','i-c5xaRttDXs','i-ff8qEu9_LD','i-g8kG8I5f8m',1,2],
 ['i-5cH0Wlk0BH','i-NG0WMuMSy1','i-c5xaRttDXs','i-x906J_jYhv','i-g8kG8I5f8m',1,3],
 ['i-4AHDqDWW7R','i-NG0WMuMSy1','i-c5xaRttDXs','i-rRYmRgRJK2','i-g8kG8I5f8m',1,4],
 ['i-Shnk4eSMZO','i-MC_Z0KK6Hn','i-8o9Z1Z6jtk','i-MC_Z0KK6Hn','i-jTU8EBeCLM',7,1]
 ] as const
 table(s,TABLES.services).rows=services.map(([id,name])=>row(id,{'c-TvFH_jzZ3k':name,'c-mJimiTomMd':true,'c-r5HLQrISpN':true}))
 table(s,TABLES.dimensionNames).rows=[...dims.map(([,name],i)=>row('i-qa-name-'+i,{'c-FJw9NIz2cO':name})),row('i-synthetic-all-name',{'c-FJw9NIz2cO':'__ALL_dim__'})]
 table(s,TABLES.dimensions).rows=[...dims.map(([id,,service,total],i)=>row(id,{'c-TvFH_jzZ3k':ref(TABLES.services,service),'c-DGi7Us0d5f':ref(TABLES.dimensionNames,'i-qa-name-'+i),'c-YB4iqbCDp_':1,'c-wZoGYfi40i':total})),row('i-synthetic-all',{'c-DGi7Us0d5f':ref(TABLES.dimensionNames,'i-synthetic-all-name'),'c-YB4iqbCDp_':1})]
 table(s,TABLES.rules).rows=services.map(([id],i)=>row('i-qa-rule-'+i,{'c-VdW_35TQkv':ref(TABLES.tables,'i-synthetic-table'),'c-8CxdK7Oln0':ref(TABLES.services,id),'c-trJtxn7Rnm':ref(TABLES.dimensions,'i-synthetic-all'),'c-4i-UJzr0Ry':{name:'calculado'},'c-sGROPfan5w':100+i,'c-jIfhQ2URf5':true,'c--xF4R7C4Rv':true}))
 const energyId=(energy:number)=>'i-qa-energy-'+String(energy)
 table(s,TABLES.energy).rows=[-7,-1,2,3,5,7,8].map(e=>row(energyId(e),{'c-3-8rupyDNx':e}))
 table(s,TABLES.stages).rows=stages.map(([id,name,e,cluster])=>row(id,{'c-TvFH_jzZ3k':name,'c-96H1EFHFA1':ref('grid-ew1w2T2N9p',cluster),'c-K6LT-CKgWA':ref(TABLES.energy,energyId(e))}))
 table(s,TABLES.stageDimensions).rows=[
 row('i-jTU8EBeCLM',{'c-tb4TOqyqh7':'Peça','c-ufXqc_8vWI':''}),
 row('i-SUivHVlB1n',{'c-tb4TOqyqh7':'Pincelada','c-ufXqc_8vWI':ref(TABLES.energy,energyId(-7))}),
 row('i-g8kG8I5f8m',{'c-tb4TOqyqh7':'Acessórios','c-ufXqc_8vWI':ref(TABLES.energy,energyId(-1))})
 ]
 table(s,TABLES.relations).rows=rels.map(([id,service,dim,stage,sd,total,order])=>row(id,{'c-7sr002IvYn':ref(TABLES.services,service),'c-EBO2IBlQEH':ref(TABLES.dimensions,dim),'c-AWrfBjSHDl':ref(TABLES.stages,stage),'c-B9QLxROotP':sd?ref(TABLES.stageDimensions,sd):'','c-Ii7Vzlr1ni':total,'c-rTdEY2ynPh':1,'c-oh6TT09I-z':order}))
 for(const t of s.tables){t.totalRows=t.rows.length;t.schema.rowCount=t.rows.length}
 return s
}
type DB=ReturnType<typeof openDatabase>
const configRow=(db:DB)=>db.prepare('SELECT * FROM pricing_configuration WHERE id=1').get()!
const readConfig=(db:DB)=>JSON.parse(String(configRow(db).data)) as PricingConfig
function writeConfig(db:DB,c:PricingConfig){db.prepare('UPDATE pricing_configuration SET data=?,revision=revision+1 WHERE id=1').run(JSON.stringify(c))}
const snapshot=(db:DB)=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name!='pricing_configuration' ORDER BY name").all().map(r=>({table:r.name,rows:db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all()}))
function setup(db:DB){
 const src=fullSource(),plan=planImport(db,src)
 assert.deepEqual(plan.report.conflicts,[])
 applyImport(db,src,plan.planHash)
 const ids=new Set(plan.config.services.filter(s=>s.serviceId.startsWith('coda:')).map(s=>s.serviceId))
 const config=readConfig(db)
 for(const service of config.services.filter(s=>ids.has(s.serviceId))){
  service.base='123.45'
  for(const dim of service.dimensions){dim.fd='1.75';dim.stages=[]}
 }
 writeConfig(db,config)
 return {src,ids}
}

test('approved reconciliation restores nine complete dimensions, preserves all other data, and is idempotent',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),budgets=new BudgetRepository(db)
  const preview=budgets.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}})
  const issued=await budgets.emit(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'},previewToken:preview.token,idempotencyKey:'qa-energy-preservation'})
  const pdf=budgets.pdf(f.at.id,issued.id)
  const {src,ids}=setup(db),before=configRow(db),other=snapshot(db)
  const p=planEnergyReconciliation(db,src)
  assert.deepEqual(p.conflicts,[])
  assert.equal(p.findings.length,9)
  assert.equal(p.findings.reduce((n,f)=>n+f.after.length,0),13)
  assert(p.findings.every(f=>f.action==='restore'))
  assert.deepEqual(configRow(db),before)
  assert.deepEqual(snapshot(db),other)
  applyEnergyReconciliation(db,src,p.planHash)
  const after=readConfig(db)
  const expected=JSON.parse(String(before.data)) as PricingConfig
  for(const service of expected.services.filter(s=>ids.has(s.serviceId)))for(const dim of service.dimensions){
   dim.stages=p.findings.find(f=>f.serviceId===service.serviceId&&f.dimensionId===dim.dimensionId)!.after
  }
  assert.deepEqual(after,expected)
  assert.equal(Number(configRow(db).revision),Number(before.revision)+1)
  const polish=after.services.find(s=>s.serviceId===sourceId(TABLES.services,'i-NG0WMuMSy1'))!.dimensions[0]!
  assert.deepEqual(polish.stages.map(s=>[s.baseEnergy,s.dimensionEnergy]),[['2','0'],['2','0'],['2','0'],['2','0']])
  assert.deepEqual(snapshot(db),other)
  assert.deepEqual(budgets.get(f.at.id,issued.id),issued)
  assert.deepEqual(budgets.pdf(f.at.id,issued.id),pdf)
  const stored=configRow(db),repeat=planEnergyReconciliation(db,src)
  assert.deepEqual(repeat.conflicts,[])
  assert(repeat.findings.every(f=>f.action==='unchanged'))
  applyEnergyReconciliation(db,src,repeat.planHash)
  assert.deepEqual(configRow(db),stored)
  assert.deepEqual(snapshot(db),other)
 }finally{db.close()}
})

test('approved reconciliation never overwrites a nonempty divergent dimension; the full batch is atomic',()=>{
 const db=openDatabase(':memory:')
 try{
  const {src}=setup(db),p=planEnergyReconciliation(db,src),config=readConfig(db)
  assert.deepEqual(p.conflicts,[])
  const f=p.findings[0]!,dim=config.services.find(s=>s.serviceId===f.serviceId)!.dimensions.find(d=>d.dimensionId===f.dimensionId)!
  dim.stages=structuredClone(f.after)
  dim.stages[0]!.baseEnergy='99'
  writeConfig(db,config)
  const before=configRow(db),other=snapshot(db),changed=planEnergyReconciliation(db,src)
  assert.equal(changed.conflicts.length,1)
  assert.throws(()=>applyEnergyReconciliation(db,src,p.planHash),/Plano mudou/)
  assert.throws(()=>applyEnergyReconciliation(db,src,changed.planHash),/Conflitos/)
  assert.deepEqual(configRow(db),before)
  assert.deepEqual(snapshot(db),other)
 }finally{db.close()}
})

test('approved reconciliation rolls back on write failure and leaves a fresh valid plan',()=>{
 const db=openDatabase(':memory:')
 try{
  const {src}=setup(db),p=planEnergyReconciliation(db,src),before=configRow(db)
  assert.deepEqual(p.conflicts,[])
  db.exec("CREATE TRIGGER qa_reconcile_abort BEFORE UPDATE ON pricing_configuration BEGIN SELECT RAISE(ABORT,'QA forced failure'); END")
  assert.throws(()=>applyEnergyReconciliation(db,src,p.planHash),/QA forced failure/)
  assert.deepEqual(configRow(db),before)
  db.exec('DROP TRIGGER qa_reconcile_abort')
  assert.equal(planEnergyReconciliation(db,src).planHash,p.planHash)
 }finally{db.close()}
})

test('QA integrated: restore energies and install approved pieces on an isolated SQLite copy, then emit a new quote and OS',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'funix-integrated-')),file=join(folder,'qa.sqlite')
 const original=openDatabase(':memory:')
 let db:DB|undefined
 try{
  const f=commercialFixture(original),oldBudgets=new BudgetRepository(original)
  const beforePreview=oldBudgets.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}})
  const issued=await oldBudgets.emit(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'},previewToken:beforePreview.token,idempotencyKey:'qa-integrated-historical'})
  const pdf=oldBudgets.pdf(f.at.id,issued.id),oldOS=new WorkOrderRepository(original).create(f.at.id,issued.id,{authorized:true})
  const {src}=setup(original)
  // Synthetic wash price and stage. Identities and energy are approved;
  // no real commercial amounts are used in this fixture.
  for(const r of requiredVehicleCatalog)original.prepare("INSERT INTO catalog_items(id,kind,name,status,source,service_id,created_at,updated_at) VALUES (?,?,?,'validado','operador',?,'QA','QA')").run(r.id,r.kind,r.name,r.serviceId)
  const washing=sourceId(TABLES.services,'i-AlsNigbGqx'),washingM=sourceId(TABLES.dimensions,'i-07mjG2Tryl')
  const config=readConfig(original)
  config.services.push({serviceId:washing,base:'100',billable:true,colorFactorEnabled:false,discountable:true,dimensions:[{dimensionId:washingM,fd:'1',stages:[{id:'qa-wash-stage',name:'Lavagem',dimension:'M',baseEnergy:'5',dimensionEnergy:'2',presentation:{stageId:null,stageDimensionId:null,clusterId:null,cluster:'Estética e revitalização',order:null}}]}]})
  writeConfig(original,config)
  const originalConfig=configRow(original),originalOther=snapshot(original)
  await backupDatabase(original,file)
  db=openDatabase(file)
  const energy=planEnergyReconciliation(db,src)
  assert.deepEqual(energy.conflicts,[])
  applyEnergyReconciliation(db,src,energy.planHash)
  const catalog=planApprovedPieces(db)
  assert.deepEqual(catalog.conflicts,[]);assert.deepEqual(catalog.prerequisites,[])
  assert.equal(catalog.decisions.filter(d=>d.action==='insert').length,13)
  applyApprovedPieces(db,catalog.planHash)
  const budgets=new BudgetRepository(db),orders=new WorkOrderRepository(db),commercial=new CommercialRepository(db)
  assert.deepEqual(budgets.get(f.at.id,issued.id),issued)
  assert.deepEqual(budgets.pdf(f.at.id,issued.id),pdf)
  assert.deepEqual(orders.get(f.at.id,issued.id),oldOS)
  const at=new AtendimentoRepository(db).create({phone:'124',name:'QA integração — SINTÉTICO',vehicle:'Veículo QA',plate:'QA-001'})
  const items=commercial.list(at.id),vehicle=items[0]!
  assert.equal(items.length,1)
  assert.equal(commercial.item(vehicle.pieceId).code,'veiculo_completo')
  assert.equal(vehicle.services.length,2)
  assert.equal(vehicle.services.find(s=>s.serviceId===washing)?.enabled,true)
  assert.equal(vehicle.services.find(s=>s.serviceId===washing)?.dimensionId,washingM)
  assert.equal(vehicle.services.find(s=>s.serviceId!==washing)?.enabled,false)
  commercial.updateDiagnosis(at.id,vehicle.id,{revision:vehicle.revision,services:[...vehicle.services,{serviceId:sourceId(TABLES.services,'i-NG0WMuMSy1'),dimensionId:sourceId(TABLES.dimensions,'i-c5xaRttDXs'),quantity:'1',enabled:true}]})
  const pieces=commercial.add(at.id,{pieceCodes:['para_choque_traseiro_inferior','moldura_porta_dianteira']})
  for(const [code,dim] of [['para_choque_traseiro_inferior','i-6Nx-kpDlH8'],['moldura_porta_dianteira','i-6qb1FQ1krk']] as const){
   const item=pieces.find(p=>commercial.item(p.pieceId).code===code)!
   assert(item)
   commercial.updateDiagnosis(at.id,item.id,{revision:item.revision,enabled:true,services:[{serviceId:sourceId(TABLES.services,'i-XDTMBmueos'),dimensionId:sourceId(TABLES.dimensions,dim),quantity:'1',enabled:true}]})
  }
  const pricing=new PricingConfigurationRepository(db)
  pricing.saveSettings(at.id,{revision:pricing.settings(at.id).revision,tableId:'table',colorId:'color',riskId:'risk'})
  const scenario=new ScenarioRepository(db).list(at.id)[0]!,input={scenarioId:scenario.id,negotiation:{mode:'none'} as const}
  const preview=budgets.preview(at.id,input)
  assert(preview.canEmit,JSON.stringify(preview.snapshot.calculation.errors))
  assert.equal(preview.snapshot.calculation.energy,'25')
  assert.deepEqual(preview.snapshot.calculation.lines.filter(l=>l.included).map(l=>l.energy).sort(),['1','7','8','9'])
  const version=await budgets.emit(at.id,{...input,previewToken:preview.token,idempotencyKey:'qa-integrated-new'})
  assert.match(budgets.pdf(at.id,version.id).toString('latin1'),/^%PDF/)
  const os=orders.create(at.id,version.id,{authorized:true})
  assert.equal(os.scope.lines.length,4)
  assert.deepEqual(orders.get(f.at.id,issued.id),oldOS)
  assert.deepEqual(budgets.pdf(f.at.id,issued.id),pdf)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,22)
  assert.deepEqual(configRow(original),originalConfig)
  assert.deepEqual(snapshot(original),originalOther)
 }finally{db?.close();original.close();rmSync(folder,{recursive:true,force:true})}
})
