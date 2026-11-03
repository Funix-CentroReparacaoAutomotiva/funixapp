import test from'node:test'
import assert from'node:assert/strict'
import{randomUUID}from'node:crypto'
import{mkdtempSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{DatabaseSync}from'node:sqlite'
import{openDatabase}from'../database.ts'
import{migrate}from'../migrations.ts'
import{migrate as migrateV11}from'./fixtures/migrations-v11.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{commercialFixture as legacyFixture}from'./fixtures/pre-curation/fixture.ts'
import{BudgetRepository as LegacyBudgets}from'./fixtures/pre-curation/budgets.ts'
import{BudgetRepository}from'../budgets.ts'
import{InstallmentRepository,installmentSnapshot}from'../budget-terms.ts'
import{renderJsreportPdf}from'../jsreport-client.ts'
import{frozenTerms,toJsreportData}from'../jsreport-adapter.ts'
import type{BudgetVersion}from'../../shared/pricing.ts'
const pdf=(tag='synthetic')=>Buffer.from('%PDF-1.7\n'+tag+'\n%%EOF')
const code=(value:string)=>(error:unknown)=>(error as{code:string}).code===value
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return{promise,resolve}}
function setup(db:DatabaseSync,render:(v:BudgetVersion)=>Promise<Buffer>=async()=>pdf()){
 const f=commercialFixture(db),b=new BudgetRepository(db,{render}),req={scenarioId:f.scenario.id,negotiation:{mode:'none'}},payload=()=>({...req,previewToken:b.preview(f.at.id,req).token,idempotencyKey:randomUUID()})
 return{...f,b,req,payload}
}
test('PDF terms: approved global rates, exact cents, independent displayed installment rounding and revision validation',()=>{
 const db=openDatabase(':memory:');try{
  const r=new InstallmentRepository(db),initial=r.get();assert.deepEqual(initial.rates,{tres:'6',seis:'8',nove:'10',doze:'12'})
  const six=installmentSnapshot('600',initial);assert.deepEqual(Object.values(six.plans).map(p=>p.total),['636.00','648.00','660.00','672.00']);assert.deepEqual(Object.values(six.plans).map(p=>p.unit),['212.00','108.00','73.33','56.00']);assert.equal(six.plans.nove.displayDifference,'-0.03')
  const cents=installmentSnapshot('300.15',initial);assert.equal(cents.plans.nove.total,'330.17');assert.equal(cents.plans.nove.unit,'36.69');assert.equal(cents.plans.nove.displayDifference,'0.04');assert.deepEqual(cents.plans.nove.exactTotal,{n:'66033',d:'200'})
  assert.equal(installmentSnapshot('0',initial).plans.tres.unit,'0.00');assert.equal(installmentSnapshot('0.00000005',initial).plans.tres.exactTotal.n,'53')
  const saved=r.save({revision:1,rates:{...initial.rates,tres:'6.125'}});assert.equal(saved.revision,2);assert.equal(saved.rates.tres,'6.125')
  assert.throws(()=>r.save({revision:1,rates:initial.rates}),code('VERSION_CONFLICT'))
  for(const value of[-1,'-1','NaN','Infinity','1e2','',null])assert.throws(()=>r.save({revision:2,rates:{...initial.rates,tres:value}}))
  assert.throws(()=>r.save({revision:2,rates:{tres:'6'}}));assert.throws(()=>r.save({revision:2,rates:{...initial.rates,extra:'3'}}))
 }finally{db.close()}
})
test('PDF terms: automatic suggestion, manual persistence, independent scenarios and automatic duplicates without repricing',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-deadline-')),file=join(dir,'qa.sqlite');let db=openDatabase(file)
 try{
  let f=setup(db);const initial=f.b.preview(f.at.id,f.req);assert.equal(initial.snapshot.executionDeadline?.effectiveDays,4)
  let scene=f.scenarios.list(f.at.id)[0]!;assert.deepEqual(scene.deadline,{mode:'automatic',manualDays:null})
  scene=f.scenarios.update(f.at.id,scene.id,{revision:scene.revision,deadline:{mode:'manual',manualDays:2}});const manual=f.b.preview(f.at.id,f.req)
  assert.equal(manual.snapshot.executionDeadline?.effectiveDays,2);assert.match(manual.snapshot.executionDeadline?.warning??'',/menor/);assert.deepEqual(manual.snapshot.calculation,initial.snapshot.calculation)
  const copy=f.scenarios.create(f.at.id,{name:'Duplicação QA',duplicateFrom:scene.id,sourceRevision:scene.revision});assert.deepEqual(copy.deadline,{mode:'automatic',manualDays:null})
  const emitted=await f.b.emit(f.at.id,f.payload()),original=f.b.pdf(f.at.id,emitted.id)
  f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,capacity:'1'}})
  assert.equal(f.b.preview(f.at.id,f.req).snapshot.executionDeadline?.effectiveDays,2);assert.equal(f.b.preview(f.at.id,{...f.req,scenarioId:copy.id}).snapshot.executionDeadline?.effectiveDays,15)
  const id=f.at.id,sceneId=scene.id;db.close();db=openDatabase(file);const b=new BudgetRepository(db,{render:async()=>pdf()}),{ScenarioRepository}=await import('../scenarios.ts'),scenarios=new ScenarioRepository(db)
  assert.deepEqual(scenarios.list(id)[0]!.deadline,{mode:'manual',manualDays:2});assert.deepEqual(b.get(id,emitted.id),emitted);assert.deepEqual(b.pdf(id,emitted.id),original)
  scene=scenarios.list(id)[0]!;scenarios.update(id,sceneId,{revision:scene.revision,deadline:{mode:'automatic',manualDays:null}});assert.equal(b.preview(id,f.req).snapshot.executionDeadline?.effectiveDays,15)
  scene=scenarios.list(id)[0]!;for(const value of[0,-1,1.2,'2',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>scenarios.update(id,scene.id,{revision:scene.revision,deadline:{mode:'manual',manualDays:value}}))
  assert.throws(()=>scenarios.update(id,scene.id,{revision:scene.revision-1,deadline:{mode:'manual',manualDays:8}}),code('VERSION_CONFLICT'))
  assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
test('PDF terms: zero technical days are not a promised deadline; explicit manual works, missing energy is still a real pending calculation',async()=>{
 const db=openDatabase(':memory:');try{
  const f=setup(db);let scene=f.scenarios.list(f.at.id)[0]!
  f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:f.item.services.map(l=>({...l,enabled:false}))})
  const{ComponentRepository}=await import('../components.ts');new ComponentRepository(db).save(f.at.id,{pieceId:f.item.id,name:'Componente QA',quantity:'1',manualPrice:'10',notes:''})
  assert.equal(f.b.preview(f.at.id,f.req).canEmit,false);await assert.rejects(f.b.emit(f.at.id,f.payload()),code('BUDGET_INCOMPLETE'))
  scene=f.scenarios.list(f.at.id)[0]!;f.scenarios.update(f.at.id,scene.id,{revision:scene.revision,deadline:{mode:'manual',manualDays:1}});assert.equal(f.b.preview(f.at.id,f.req).canEmit,true)
  await f.b.emit(f.at.id,f.payload())
 }finally{db.close()}
})
test('PDF issuance: default renderer requires configuration, never silently uses legacy output',async()=>{
 const db=openDatabase(':memory:'),oldEndpoint=process.env.FUNIX_JSREPORT_ENDPOINT;delete process.env.FUNIX_JSREPORT_ENDPOINT;try{const f=setup(db),b=new BudgetRepository(db);await assert.rejects(b.emit(f.at.id,f.payload()),code('PDF_NOT_CONFIGURED'));assert.equal(b.list(f.at.id).length,0);assert.equal(db.prepare('SELECT state FROM budget_emission_attempts').get()!.state,'failed')}finally{if(oldEndpoint===undefined)delete process.env.FUNIX_JSREPORT_ENDPOINT;else process.env.FUNIX_JSREPORT_ENDPOINT=oldEndpoint;db.close()}
})
test('PDF issuance: rendering occurs outside transaction, persisted JSON/rates/PDF survive changes and replay never renders twice',async()=>{
 const db=openDatabase(':memory:');let renders=0,body:unknown
 try{
  const f=setup(db,async version=>{
   db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');renders++
   assert.equal(db.prepare('SELECT COUNT(*) n FROM budget_versions').get()!.n,0)
   return renderJsreportPdf(version,frozenTerms(version.snapshot),{endpoint:'https://renderer.invalid/api/report',username:'qa',password:'SECRET-SYNTHETIC',template:'FUNIX - Orcamento'},async(_url,init)=>{body=JSON.parse(String(init?.body));assert.equal(new Headers(init?.headers).get('Authorization'),'Basic '+Buffer.from('qa:SECRET-SYNTHETIC').toString('base64'));return new Response(new Uint8Array(pdf()),{headers:{'Content-Type':'application/pdf'}})})
  }),request=f.payload(),version=await f.b.emit(f.at.id,request)
  assert.equal(version.documentNumber,'OR-000001');assert.deepEqual((body as{data:unknown}).data,version.snapshot.document?.data);assert(!JSON.stringify(version.snapshot).includes('SECRET-SYNTHETIC'));assert.equal(version.snapshot.document?.data.condicoes.prazo,'4')
  const rates=new InstallmentRepository(db);rates.save({revision:rates.get().revision,rates:{tres:'9',seis:'10',nove:'11',doze:'12'}})
  const at=f.atendimentos.get(f.at.id);f.atendimentos.update(at.id,{revision:at.revision,plate:'XXX9999'});assert.deepEqual(f.b.get(f.at.id,version.id),version)
  assert.equal((await f.b.emit(f.at.id,request)).id,version.id);assert.equal(renders,1);assert.deepEqual(f.b.pdf(f.at.id,version.id),pdf());assert.equal(version.filename,'QA000 - Orçamento FUNIX - 1.pdf')
  await assert.rejects(f.b.emit(f.at.id,{...request,negotiation:{mode:'discount',value:'1',acknowledgeResidual:false}}),code('IDEMPOTENCY_CONFLICT'))
 }finally{db.close()}
})
test('PDF issuance: durable failed reservations are not reused; same key retries same number, no incomplete history',async()=>{
 const db=openDatabase(':memory:');let fail=true,calls=0
 try{
  const f=setup(db,async()=>{calls++;if(fail)throw Error('synthetic failure');return pdf()}),one=f.payload()
  await assert.rejects(f.b.emit(f.at.id,one));assert.equal(f.b.list(f.at.id).length,0);fail=false
  const second=await f.b.emit(f.at.id,f.payload());assert.equal(second.documentNumber,'OR-000002')
  const first=await f.b.emit(f.at.id,one);assert.equal(first.documentNumber,'OR-000001');assert.equal(calls,3);assert.equal((await f.b.emit(f.at.id,one)).id,first.id);assert.equal(calls,3)
 }finally{db.close()}
})
test('PDF issuance: concurrent same-key request cannot duplicate render or version, distinct keys retain unique global identity',async()=>{
 const db=openDatabase(':memory:'),gate=deferred();let calls=0
 try{
  const f=setup(db,async()=>{calls++;await gate.promise;return pdf()}),req=f.payload(),first=f.b.emit(f.at.id,req)
  await assert.rejects(f.b.emit(f.at.id,req),code('PDF_RENDER_IN_PROGRESS'));assert.equal(calls,1);gate.resolve();const version=await first;assert.equal((await f.b.emit(f.at.id,req)).id,version.id)
  const all=await Promise.all([f.b.emit(f.at.id,f.payload()),f.b.emit(f.at.id,f.payload())]);assert.equal(new Set(all.map(v=>v.documentNumber)).size,2);assert.equal(new Set(all.map(v=>v.sequence)).size,2);assert.equal(f.b.list(f.at.id).length,3)
 }finally{gate.resolve();db.close()}
})
test('PDF issuance: lease takeover after interruption uses same serial; stale renderer cannot replace final PDF',async()=>{
 const db=openDatabase(':memory:'),gate=deferred();let now=1000,calls=0
 try{
  const f=setup(db),b=new BudgetRepository(db,{now:()=>now,leaseMs:10,render:async()=>{calls++;if(calls===1){await gate.promise;return pdf('old')}return pdf('new')}}),req=f.payload(),first=b.emit(f.at.id,req)
  now=1011;const next=await b.emit(f.at.id,req);assert.equal(next.documentNumber,'OR-000001');gate.resolve();await assert.rejects(first,code('PDF_LEASE_EXPIRED'));assert.deepEqual(b.pdf(f.at.id,next.id),pdf('new'));assert.equal(b.list(f.at.id).length,1)
 }finally{gate.resolve();db.close()}
})
for(const changed of['composition','atendimento','pricing','installments','deadline']as const)test('PDF issuance: '+changed+' edit during HTTP blocks final commit and preserves history',async()=>{
 const db=openDatabase(':memory:'),gate=deferred()
 try{
  const f=setup(db,async()=>{await gate.promise;return pdf()}),request=f.payload(),pending=f.b.emit(f.at.id,request)
  if(changed==='composition')f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,notes:'changed'})
  if(changed==='atendimento')f.atendimentos.update(f.at.id,{revision:f.at.revision,name:'changed'})
  if(changed==='pricing')f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,capacity:'3'}})
  if(changed==='installments'){const r=new InstallmentRepository(db);r.save({revision:r.get().revision,rates:{tres:'7',seis:'8',nove:'10',doze:'12'}})}
  if(changed==='deadline'){const s=f.scenarios.list(f.at.id)[0]!;f.scenarios.update(f.at.id,s.id,{revision:s.revision,deadline:{mode:'manual',manualDays:8}})}
  gate.resolve();await assert.rejects(pending,code('VERSION_CONFLICT'));assert.equal(f.b.list(f.at.id).length,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM budget_document_identity').get()!.n,0);await assert.rejects(f.b.emit(f.at.id,request),code('VERSION_CONFLICT'))
 }finally{gate.resolve();db.close()}
})
test('PDF issuance: SQL failure at final identity insert rolls back snapshot/PDF/version together and can retry safely',async()=>{
 const db=openDatabase(':memory:');try{
  const f=setup(db),req=f.payload();db.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON budget_document_identity BEGIN SELECT RAISE(ABORT,'synthetic failure');END")
  await assert.rejects(f.b.emit(f.at.id,req),/synthetic failure/);assert.equal(f.b.list(f.at.id).length,0);db.exec('DROP TRIGGER synthetic_failure');const v=await f.b.emit(f.at.id,req);assert.equal(v.documentNumber,'OR-000001');assert.equal(f.b.list(f.at.id).length,1)
 }finally{db.close()}
})
test('PDF mapping: repeated service clusters, exact fractional components, current diagnosis/intensity and effective discount without mutating engine',async()=>{
 const db=openDatabase(':memory:');try{
  const f=setup(db),d=f.commercial.saveCatalog({kind:'diagnostico',name:'Quebrado QA'}),item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId:d.id,intensity:'moderado',services:[...f.item.services,{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'0.25',enabled:true,notes:'Nota QA'}]})
  assert.equal(item.services.length,2);const{ComponentRepository}=await import('../components.ts');new ComponentRepository(db).save(f.at.id,{pieceId:f.item.id,name:'Capa QA',quantity:'0.25',manualPrice:'10.01',notes:''})
  const req={scenarioId:f.scenario.id,negotiation:{mode:'discount',value:'1',acknowledgeResidual:false}},p=f.b.preview(f.at.id,req),v=await f.b.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:randomUUID()}),doc=toJsreportData(v)
  assert.equal(doc.diagnosticos[0]!.clusters.length,2);assert.match(doc.diagnosticos[0]!.resumo,/Quebrado QA.*Moderada/);const cluster=doc.diagnosticos[0]!.clusters[0]!;assert(cluster.tipo==='servico');assert(cluster.descricaoTexto.includes('Etapa sintética'));assert(cluster.descricaoTexto.some(s=>s.includes('0.25')))
  assert.equal(doc.financeiro.desconto,'R$ 1,00');assert.deepEqual(v.snapshot.calculation,p.snapshot.calculation)
  const components=doc.diagnosticos[0]!.clusters[1]!;assert(components.tipo==='itens');assert.equal(components.itensDetalhados[0]!.quantidade,'0.25');assert.equal(components.itensDetalhados[0]!.valorUnitario,'R$ 20,05')
 }finally{db.close()}
})
test('PDF V11→V12 upgrade keeps historical identities, snapshots/PDFs, all old fields and starts above existing serial',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-v12-')),file=join(dir,'qa.sqlite');let db=new DatabaseSync(file)
 try{
  migrateV11(db);const f=legacyFixture(db),legacy=new LegacyBudgets(db),req={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=legacy.preview(f.at.id,req),v=legacy.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:'old-budget-v11-first'}),before=legacy.pdf(f.at.id,v.id),v2=legacy.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:'old-budget-v11-second'})
  db.prepare('INSERT INTO budget_document_identity(serial,budget_version_id,filename)VALUES(42,?,?)').run(v.id,'ORIGINAL.pdf')
  const rows=db.prepare('SELECT * FROM budget_versions').all(),scene=db.prepare('SELECT * FROM scenarios').get();db.close();db=openDatabase(file)
  assert.deepEqual(db.prepare('SELECT * FROM budget_versions').all(),rows);const{deadline_mode,deadline_days,...rest}=db.prepare('SELECT * FROM scenarios').get()!;assert.deepEqual(rest,{...scene});assert.equal(deadline_mode,'automatic');assert.equal(deadline_days,null)
  const b=new BudgetRepository(db,{render:async()=>pdf()});assert.equal(b.get(f.at.id,v.id).documentNumber,'OR-000042');assert.equal(b.get(f.at.id,v2.id).documentNumber,undefined);assert.deepEqual(b.get(f.at.id,v.id).snapshot,v.snapshot);assert.deepEqual(b.pdf(f.at.id,v.id),before)
  const q=b.preview(f.at.id,req),next=await b.emit(f.at.id,{...req,previewToken:q.token,idempotencyKey:randomUUID()});assert.equal(next.documentNumber,'OR-000043');assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
 const failed=new DatabaseSync(':memory:');try{migrateV11(failed);failed.exec('CREATE VIEW installment_configuration AS SELECT id FROM atendimentos');assert.throws(()=>migrate(failed));assert.equal(failed.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,11);assert(!failed.prepare('PRAGMA table_info(scenarios)').all().some(c=>c.name==='deadline_mode'))}finally{failed.close()}
})

test('PDF issuance: separate SQLite connections share the durable in-flight guard and permit unrelated writes during HTTP',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-render-lock-')),file=join(dir,'qa.sqlite'),db=openDatabase(file),gate=deferred();let second:DatabaseSync|undefined,calls=0
 try{
  const f=setup(db,async()=>{calls++;await gate.promise;return pdf()}),request=f.payload(),pending=f.b.emit(f.at.id,request);second=openDatabase(file)
  const b=new BudgetRepository(second,{render:async()=>{calls++;return pdf()}})
  await assert.rejects(b.emit(f.at.id,request),code('PDF_RENDER_IN_PROGRESS'));second.exec('BEGIN IMMEDIATE');second.prepare('UPDATE installment_configuration SET updated_at=updated_at WHERE id=1').run();second.exec('COMMIT')
  gate.resolve();const v=await pending;assert.equal((await b.emit(f.at.id,request)).id,v.id);assert.equal(calls,1)
 }finally{gate.resolve();second?.close();db.close();rmSync(dir,{recursive:true,force:true})}
})
test('PDF issuance: process interruption after durable reservation recovers the same OR number after restart',async()=>{
 const{spawnSync}=await import('node:child_process'),dir=mkdtempSync(join(tmpdir(),'funix-render-crash-')),file=join(dir,'qa.sqlite');let db=openDatabase(file)
 try{
  const f=setup(db),request=f.payload(),at=f.at.id;db.close()
  const source=`import{openDatabase}from ${JSON.stringify(new URL('../database.ts',import.meta.url).href)};import{BudgetRepository}from ${JSON.stringify(new URL('../budgets.ts',import.meta.url).href)};const db=openDatabase(process.argv[1]);await new BudgetRepository(db,{now:()=>1000,leaseMs:10,render:async()=>process.exit(0)}).emit(process.argv[2],JSON.parse(process.argv[3]));`
  const child=spawnSync(process.execPath,['--input-type=module','-e',source,file,at,JSON.stringify(request)],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);db=openDatabase(file)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM budget_versions').get()!.n,0);assert.equal(db.prepare('SELECT state FROM budget_emission_attempts').get()!.state,'rendering')
  const b=new BudgetRepository(db,{now:()=>1011,leaseMs:10,render:async()=>pdf()}),v=await b.emit(at,request);assert.equal(v.documentNumber,'OR-000001');assert.equal(b.list(at).length,1);assert.equal((await b.emit(at,request)).id,v.id)
 }finally{if(db.isOpen)db.close();rmSync(dir,{recursive:true,force:true})}
})

test('PDF deadline: valid manual promise replaces missing capacity suggestion only; financial and energy errors stay blocking',async()=>{
 const db=openDatabase(':memory:');try{
  const f=setup(db);f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,capacity:null}})
  const automatic=f.b.preview(f.at.id,f.req);assert.equal(automatic.canEmit,false);assert.equal(automatic.snapshot.calculation.energy,'15');assert.equal(automatic.snapshot.calculation.days,null)
  const scene=f.scenarios.list(f.at.id)[0]!;f.scenarios.update(f.at.id,scene.id,{revision:scene.revision,deadline:{mode:'manual',manualDays:7}})
  const manual=f.b.preview(f.at.id,f.req);assert.deepEqual(manual.snapshot.calculation,automatic.snapshot.calculation);assert.equal(manual.canEmit,true);const v=await f.b.emit(f.at.id,f.payload());assert.equal(v.snapshot.document?.data.condicoes.prazo,'7');assert.equal(v.snapshot.calculation.days,null)
  f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,capacity:null,services:f.config.services.map(s=>({...s,dimensions:s.dimensions.map(d=>({...d,stages:[]}))}))}})
  assert.equal(f.b.preview(f.at.id,f.req).canEmit,false);await assert.rejects(f.b.emit(f.at.id,f.payload()),code('BUDGET_INCOMPLETE'))
 }finally{db.close()}
})
