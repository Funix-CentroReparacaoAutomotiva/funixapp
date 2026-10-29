import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,openSync,closeSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {DatabaseSync} from 'node:sqlite'
import {openDatabase,backupDatabase} from '../database.ts'
import {planImport,applyImport,digest} from '../coda-import.ts'
import {TABLES,sourceId,parseCodaJson} from '../coda-import-source.ts'
import {codaFixture,table,pushRow,set,row,ref} from './fixtures/coda-import.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {CommercialRepository} from '../commercial.ts'
import {ScenarioRepository} from '../scenarios.ts'
import {PricingConfigurationRepository} from '../pricing-config.ts'
import {BudgetRepository} from '../budgets.ts'

function snapshot(db:DatabaseSync){return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r=>({table:r.name,rows:db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all()}))}
const imported=(table:string,id:string)=>sourceId(table,'i-synthetic-'+id)

test('dry-run is read-only; apply preserves V7 pieces, Atendimento, scenarios, configuration and immutable budget/PDF; repeat/restart is idempotent',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'funix18-')),file=join(folder,'v7.sqlite'),backup=join(folder,'copy.sqlite')
 let db=openDatabase(file)
 try{
  assert.equal(db.prepare("SELECT count(*) n FROM catalog_items WHERE kind='peca' AND active=1").get()!.n,163)
  const f=commercialFixture(db),budgets=new BudgetRepository(db),preview=budgets.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}})
  const version=budgets.emit(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'},previewToken:preview.token,idempotencyKey:'synthetic-import-preserve'})
  const initial=snapshot(db),pdf=budgets.pdf(f.at.id,version.id),config=f.pricing.get().config
  await backupDatabase(db,backup)
  const copy=new DatabaseSync(backup,{readOnly:true})
  assert.deepEqual(snapshot(copy),initial);copy.close()
  const src=codaFixture(),before=readFileSync(file),p=planImport(db,src)
  assert.deepEqual(snapshot(db),initial);assert.deepEqual(readFileSync(file),before)
  assert.equal(p.report.conflicts.length,0)
  assert.equal(p.catalog.length,3);assert.equal(p.config.services.at(-1)!.dimensions[0]!.stages[0]!.baseEnergy,'2')
  applyImport(db,src,p.planHash)
  assert.equal(f.commercial.catalogs().items.filter(i=>i.kind==='peca' && i.active).length,163)
  for(const preserved of initial.filter(t=>!['catalog_items','catalog_history','pricing_configuration'].includes(String(t.table))))assert.deepEqual(snapshot(db).find(t=>t.table===preserved.table),preserved)
  assert.deepEqual(budgets.get(f.at.id,version.id),version);assert.deepEqual(budgets.pdf(f.at.id,version.id),pdf)
  const now=f.pricing.get().config;assert.deepEqual(now.resaleMultipliers,config.resaleMultipliers);assert.equal(now.conditions,config.conditions);assert.deepEqual(now.specialPrices,config.specialPrices)
  assert.deepEqual(now.services[0],config.services[0])
  const after=snapshot(db),repeat=planImport(db,src);assert.equal(repeat.report.inserts,0)
  applyImport(db,src,repeat.planHash);assert.deepEqual(snapshot(db),after)
  db.close();db=openDatabase(file)
  assert.deepEqual(snapshot(db),after);assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,7)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')
 }finally{db.close();rmSync(folder,{recursive:true,force:true})}
})

test('imported service/dimension/diagnosis feed existing composition, exact pricing, energy, preview, emission and PDF contracts',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db)
  const source=codaFixture(),p=planImport(db,source);applyImport(db,source,p.planHash)
  const serviceId=imported(TABLES.services,'service'),dimensionId=imported(TABLES.dimensions,'dimension'),diagnosisId=imported(TABLES.diagnoses,'diagnosis')
  const repo=new CommercialRepository(db)
  const item=repo.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId,services:[{serviceId,dimensionId,quantity:'3'}]})
  assert.equal(item.services[0]!.dimensionId,dimensionId)
  const pricing=new PricingConfigurationRepository(db)
  pricing.saveSettings(f.at.id,{revision:pricing.settings(f.at.id).revision,tableId:imported(TABLES.tables,'table'),colorId:imported(TABLES.colors,'color'),riskId:imported(TABLES.risks,'risk')})
  const scenario=new ScenarioRepository(db).list(f.at.id)[0]!,budgets=new BudgetRepository(db)
  const preview=budgets.preview(f.at.id,{scenarioId:scenario.id,negotiation:{mode:'none'}})
  assert(preview.canEmit);assert.equal(preview.snapshot.calculation.total,'300.15');assert.equal(preview.snapshot.calculation.energy,'15');assert.equal(preview.snapshot.calculation.days,'4')
  const version=budgets.emit(f.at.id,{scenarioId:scenario.id,negotiation:{mode:'none'},previewToken:preview.token,idempotencyKey:'synthetic-import-calculation'})
  assert.match(budgets.pdf(f.at.id,version.id).toString('latin1'),/^%PDF/)
 }finally{db.close()}
})

test('CLI defaults to dry-run and requires explicit existing V7 destination and exact plan hash',()=>{
 const folder=mkdtempSync(join(tmpdir(),'funix18-cli-')),file=join(folder,'v7.sqlite'),sourceFile=join(folder,'export.json')
 const db=openDatabase(file);db.close();writeFileSync(sourceFile,JSON.stringify(codaFixture()))
 const env={...process.env};delete env.NODE_TEST_CONTEXT
 const run=(args:string[])=>{
  const out=join(folder,'stdout.json'),err=join(folder,'stderr.txt'),outFd=openSync(out,'w'),errFd=openSync(err,'w')
  try{const result=spawnSync(process.execPath,['server/import-coda.ts',...args],{env,stdio:['ignore',outFd,errFd]});return {...result,stdout:readFileSync(out,'utf8'),stderr:readFileSync(err,'utf8')}}
  finally{closeSync(outFd);closeSync(errFd)}
 }
 try{
  const before=digest(readFileSync(file)),args=['--source',sourceFile,'--database',file]
  const dry=run(args);assert.equal(dry.status,0,dry.stderr);assert.equal(digest(readFileSync(file)),before)
  const plan=JSON.parse(dry.stdout);assert.equal(plan.mode,'dry-run')
  assert.equal(run([...args,'--confirm-plan','0'.repeat(64)]).status,1);assert.equal(digest(readFileSync(file)),before)
  assert.equal(run([...args,'--confirm-plan',plan.planHash]).status,0)
  assert.equal(run(['--source',sourceFile]).status,1)
  const missing=join(folder,'missing.sqlite');assert.equal(run(['--source',sourceFile,'--database',missing]).status,1)
 }finally{rmSync(folder,{recursive:true,force:true})}
})

test('failure during final write rolls back all catalogs/history/config; local edits and same-name operator records are not overwritten or duplicated',()=>{
 const db=openDatabase(':memory:')
 try{
  const s=codaFixture(),p=planImport(db,s),before=snapshot(db)
  db.exec("CREATE TRIGGER synthetic_abort BEFORE UPDATE ON pricing_configuration BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
  assert.throws(()=>applyImport(db,s,p.planHash),/synthetic failure/);assert.deepEqual(snapshot(db),before)
  db.exec('DROP TRIGGER synthetic_abort')
  const repo=new CommercialRepository(db),existing=repo.saveCatalog({kind:'servico',name:'Serviço sintético de QA'})
  const conflict=planImport(db,s);assert(conflict.report.conflicts.length);assert.throws(()=>applyImport(db,s,conflict.planHash),/Conflitos/)
  assert.equal(repo.catalogs().items.filter(c=>c.kind==='servico').length,1)
  repo.saveCatalog({revision:existing.revision,name:'Outro serviço sintético'},existing.id)
  applyImport(db,s,planImport(db,s).planHash)
  const importedService=repo.item(imported(TABLES.services,'service'));repo.saveCatalog({revision:importedService.revision,active:false},importedService.id)
  assert(planImport(db,s).report.conflicts.some(c=>c.reason.includes('inativado')))
 }finally{db.close()}
})

test('sentinels, broken refs, negative energy, conditional FC/FR, percent rules, duplicate keys and unknown MR never become arbitrary prices',()=>{
 const db=openDatabase(':memory:')
 try{
  for(const [name,change,expected] of [
   ['conditional FC',(s:ReturnType<typeof codaFixture>)=>set(s,TABLES.rules,'c-jIfhQ2URf5',false),'base'],
   ['percentage',(s:ReturnType<typeof codaFixture>)=>set(s,TABLES.rules,'c-4i-UJzr0Ry',{name:'percentual'}),'base'],
   ['duplicate rule',(s:ReturnType<typeof codaFixture>)=>pushRow(s,TABLES.rules,{...structuredClone(table(s,TABLES.rules).rows[0]!),rowId:'i-other-rule'}),'base'],
   ['scale',(s:ReturnType<typeof codaFixture>)=>set(s,TABLES.relations,'c-rTdEY2ynPh',0.5),'fd'],
   ['negative energy',(s:ReturnType<typeof codaFixture>)=>set(s,TABLES.energy,'c-3-8rupyDNx',-1),'energy'],
   ['broken energy',(s:ReturnType<typeof codaFixture>)=>set(s,TABLES.relations,'c-AWrfBjSHDl',ref(TABLES.stages,'i-missing')),'energy'],
   ['energy mismatch',(s:ReturnType<typeof codaFixture>)=>set(s,TABLES.dimensions,'c-wZoGYfi40i',6),'energy'],
   ['new formula',(s:ReturnType<typeof codaFixture>)=>{s.pricingFormulaSchema.columns[0]!.formula='Unreviewed formula'},'base'],
  ] as const){
   const source=codaFixture();change(source);const p=planImport(db,source),service=p.config.services[0]!,dimension=service.dimensions[0]!
   assert.equal(p.catalog.filter(c=>c.kind==='dimensao').length,1,name);assert(!p.catalog.some(c=>c.name==='__ALL_dim__'))
   if(expected==='base')assert.equal(service.base,null,name)
   if(expected==='fd')assert.equal(dimension.fd,null,name)
   if(expected==='energy')assert.deepEqual(dimension.stages,[],name)
   assert.equal(p.config.resaleMultipliers?.length??0,0);assert.deepEqual(p.config.specialPrices,[])
   assert(p.report.pending.length)
  }
  const source=codaFixture();set(source,TABLES.dimensions,'c-TvFH_jzZ3k',ref(TABLES.services,'i-missing'))
  assert.equal(planImport(db,source).catalog.filter(c=>c.kind==='dimensao').length,0)
  const incomplete=codaFixture();table(incomplete,TABLES.dimensions).hasMore=true;assert.throws(()=>planImport(db,incomplete),/incompleta/)
  const duplicate=codaFixture();pushRow(duplicate,TABLES.services,structuredClone(table(duplicate,TABLES.services).rows[0]!));assert.throws(()=>planImport(db,duplicate),/duplicada/)
 }finally{db.close()}
})

test('table inheritance is left pending; source IDs remain stable across renames, reordered rows and repeated names in different services',()=>{
 const db=openDatabase(':memory:')
 try{
  const s=codaFixture()
  pushRow(s,TABLES.tables,row('i-synthetic-derived',{'c-CeD0PIBx4t':'Tabela derivada sintética','c-tZ94U6MuW-':{name:'Interno'},'c-o2aKUZyPE7':true,'c-QMXNRk1uDX':0.6,'c-DMeUkMin9e':ref(TABLES.tables,'i-synthetic-table')}))
  const p=planImport(db,s);assert.equal(p.config.tables.at(-1)!.factor,null)
  set(s,TABLES.services,'c-TvFH_jzZ3k','Novo nome sintético');assert.equal(planImport(db,s).catalog[0]!.id,p.catalog[0]!.id)
  assert.throws(()=>{db.exec('DELETE FROM schema_migrations WHERE version=7');planImport(db,s)},/exatamente V7/)
 }finally{db.close()}
})

test('source decimals are not rounded by JSON Number before V7 precision validation',()=>{
 const parsed=parseCodaJson('{"rowCount":1,"c-price":999999999999.123456,"scalar":0.123456789,"value":0.100000}') as Record<string,unknown>
 assert.equal(parsed.rowCount,1);assert.equal(parsed['c-price'],'999999999999.123456');assert.equal(parsed.scalar,'0.123456789');assert.equal(parsed.value,'0.100000')
 const source=codaFixture(),db=openDatabase(':memory:')
 try{set(source,TABLES.rules,'c-sGROPfan5w',parsed.scalar);assert.equal(planImport(db,source).config.services[0]!.base,null)}finally{db.close()}
})

test('GET-only exporter paginates allowlisted config tables and produces a private offline bundle; no production token is needed by importer',()=>{
 const folder=mkdtempSync(join(tmpdir(),'funix18-export-')),file=join(folder,'source.json'),mock=join(folder,'transport.mjs'),out=join(folder,'stdout.txt'),err=join(folder,'stderr.txt')
 const fixture=new URL('./fixtures/coda-import.ts',import.meta.url).href
 writeFileSync(mock,`import {codaFixture} from ${JSON.stringify(fixture)};const s=codaFixture();globalThis.fetch=async(url,options)=>{if(options.method && options.method!=='GET')throw Error('Mutation forbidden');if(options.headers.Authorization!=='Bearer synthetic-export-test-only')throw Error('Test credential mismatch');const u=new URL(url);if(u.origin!=='https://coda.io')throw Error('Unexpected destination');const parts=u.pathname.split('/'),id=parts[parts.indexOf('tables')+1],resource=parts.at(-1);const t=s.tables.find(t=>t.id===id);let body;if(resource===id){if(!t)throw Error('Not allowlisted');body={rowCount:t.rows.length}}else if(resource==='columns'){const columns=id==='grid-aHz1ZDVlfK'?s.pricingFormulaSchema.columns:t.schema.columns;body={items:columns.map(c=>({id:c.columnId,name:c.name,formula:c.formula}))}}else if(resource==='rows'){if(!t)throw Error('Customer rows forbidden');const page=Number(u.searchParams.get('pageToken')||0);body={items:t.rows.slice(page,page+1).map(r=>({id:r.rowId,values:r.values})),...(page+1<t.rows.length?{nextPageToken:String(page+1)}:{})}}else throw Error('Unexpected resource');return new Response(JSON.stringify(body),{status:200})};`)
 const outFd=openSync(out,'w'),errFd=openSync(err,'w')
 try{
  const result=spawnSync(process.execPath,['--import',mock,'scripts/export-coda-commercial.ts',file],{env:{...process.env,CODA_API_TOKEN:'synthetic-export-test-only'},stdio:['ignore',outFd,errFd]})
  assert.equal(result.status,0,readFileSync(err,'utf8'))
  const data=readFileSync(file,'utf8');assert(!data.includes('synthetic-export-test-only'))
  const db=openDatabase(':memory:');try{const p=planImport(db,parseCodaJson(data));assert.equal(p.config.services[0]!.base,'100.01');assert.equal(p.catalog.length,3)}finally{db.close()}
 }finally{closeSync(outFd);closeSync(errFd);rmSync(folder,{recursive:true,force:true})}
})
