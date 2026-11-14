import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {openDatabase} from '../database.ts'
import {createGmailIntakeSchema} from '../gmail-intake-schema.ts'
import {createUpdatePackageSchema} from '../update-packages-schema.ts'
import {createGmailAnalysisSchema} from '../gmail-analysis-schema.ts'
import {GmailIntakeRepository} from '../gmail-intake.ts'
import {GmailAnalysisService} from '../gmail-analysis.ts'
import {analysisHash} from '../gmail-analysis-contract.ts'
import {loadGmailAnalysis,syntheticAnalysisProviders} from '../gmail-analysis-providers.ts'
import {UpdatePackageRepository} from '../update-packages.ts'
import {createUpdatePackageSimulationSchema,UpdatePackageSimulationRepository} from '../update-packages-simulation-store.ts'
import {actionSnapshotHash} from '../update-packages-execution-simulation.ts'
import {analysisFixture,analysisNotice} from './fixtures/gmail-analysis.ts'
const cutover='2026-11-14T00:00:00.000Z',instant='2026-11-14T01:00:00.000Z'
const columns={processId:'c-process',experienceId:'c-xp',plate:'c-plate',vehicle:'c-vehicle',partner:'c-partner',budgetId:'c-budget',budgetVersion:'c-version'}
function setup(path=':memory:'){
 const db=openDatabase(path);createGmailIntakeSchema(db);createUpdatePackageSchema(db);createGmailAnalysisSchema(db)
 const notices=new GmailIntakeRepository(db,()=>instant)
 const oldRepo=new GmailIntakeRepository(db,()=> '2026-11-13T01:00:00.000Z')
 const historic=oldRepo.ingest({...analysisNotice(),messageId:'b'.repeat(16)})
 const selected=notices.ingest(analysisNotice())
 const denied=notices.ingest({...analysisNotice(),messageId:'c'.repeat(16)})
 function decide(id:string,decision:'authorize'|'deny'='authorize'){
  const n=notices.get(id);return notices.decide(id,{decision,revision:n.revision,snapshotHash:n.snapshotHash,requestId:randomUUID()},'synthetic_operator')
 }
 const h=oldRepo.get(historic.id);oldRepo.decide(h.id,{decision:'authorize',revision:h.revision,snapshotHash:h.snapshotHash,requestId:randomUUID()},'synthetic_operator')
 decide(denied.id,'deny')
 const env:NodeJS.ProcessEnv={NODE_ENV:'production',FUNIX_GMAIL_ANALYSIS_ENABLED:'true',FUNIX_GMAIL_ANALYSIS_MODE:'real-pilot',
  FUNIX_GMAIL_ANALYSIS_GMAIL_ACCOUNT:'synthetic@funix.invalid',FUNIX_GMAIL_ANALYSIS_GMAIL_TOKEN:'synthetic-gmail-secret',
  FUNIX_GMAIL_ANALYSIS_CODA_TOKEN:'synthetic-coda-secret',FUNIX_GMAIL_ANALYSIS_CODA_DOC_ID:'doc-synthetic',FUNIX_GMAIL_ANALYSIS_CODA_TABLE_ID:'grid-synthetic',FUNIX_GMAIL_ANALYSIS_CODA_COLUMNS_JSON:JSON.stringify(columns),FUNIX_GMAIL_ANALYSIS_CODA_READ_ONLY_CONFIRMED:'true',
  FUNIX_GMAIL_ANALYSIS_OPENAI_API_KEY:'synthetic-ai-secret',FUNIX_GMAIL_ANALYSIS_OPENAI_MODEL:'synthetic-model',FUNIX_GMAIL_ANALYSIS_PILOT_NOTICE_ID:selected.id,FUNIX_GMAIL_ANALYSIS_PILOT_ACTIVATED_AT:cutover}
 const scope={noticeId:selected.id,activatedAt:cutover,accountId:'synthetic@funix.invalid',configurationHash:analysisHash({synthetic:true})}
 return {db,notices,selected,historic,denied,env,scope,decide}
}
function fakeProviders(){
 const fixture=analysisFixture(),calls:Array<{host:string,path:string,method:string}>=[]
 let codaFailures=0,account='synthetic@funix.invalid',scopes='https://www.googleapis.com/auth/gmail.readonly'
 const mock:typeof fetch=async(input,init)=>{
  const url=new URL(String(input)),method=init?.method??'GET';calls.push({host:url.host,path:url.pathname,method})
  assert.equal(init?.redirect,'error')
  let data:unknown
  if(url.host==='oauth2.googleapis.com'){
   assert.equal(method,'POST');assert.equal(url.search,'');assert.ok(new Headers(init?.headers).get('Authorization')?.startsWith('Bearer '))
   data={scope:scopes,expires_in:3600}
  }
  else if(url.pathname.endsWith('/profile'))data={emailAddress:account}
  else if(url.host==='gmail.googleapis.com'){
   assert.ok(url.pathname.endsWith(fixture.messages[0]!.message.messageId))
   data={id:fixture.messages[0]!.message.messageId,payload:{headers:[{name:'Subject',value:fixture.messages[0]!.message.subject}],mimeType:'text/plain',body:{data:Buffer.from(fixture.messages[0]!.message.body).toString('base64url')}}}
  }else if(url.host==='coda.io'){
   assert.equal(method,'GET');assert.equal(url.searchParams.get('query'),'c-process:"12345"')
   if(codaFailures-->0)throw Error('synthetic network failure')
   const r=fixture.records[0]!
   data={items:[{id:r.rowId,values:Object.fromEntries(Object.entries(columns).map(([key,value])=>[value,r[key as keyof typeof r]]))}]}
  }else if(url.host==='api.openai.com'){
   assert.equal(method,'POST');const body=JSON.parse(String(init!.body));assert.equal(body.tools,undefined);assert.equal(body.store,false)
   assert.equal(body.model,'synthetic-model');data={status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(fixture.messages[0]!.interpretation)}]}]}
  }else throw Error('UNEXPECTED_EXTERNAL_HOST')
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})
 }
 return {mock,calls,failCoda:()=>{codaFailures=1},wrongAccount:()=>{account='other@funix.invalid'},writeScope:()=>{scopes+=' https://www.googleapis.com/auth/gmail.modify'}}
}
test('real-pilot: configuração estática completa não faz IO; só aviso selecionado e autorizado é processado',async()=>{
 const x=setup(),f=fakeProviders();try{
  const before=x.db.prepare('SELECT * FROM gmail_intake_notices ORDER BY id').all()
  const s=loadGmailAnalysis(x.db,x.env,f.mock)!;assert.equal(f.calls.length,0)
  await s.drain();assert.equal(f.calls.length,0);assert.equal(s.get(x.selected.id),null)
  assert.throws(()=>s.schedule(x.historic.id),{code:'GMAIL_ANALYSIS_NOT_ELIGIBLE'})
  assert.throws(()=>s.schedule(x.denied.id),{code:'GMAIL_ANALYSIS_NOT_ELIGIBLE'})
  assert.deepEqual(x.db.prepare('SELECT * FROM gmail_intake_notices ORDER BY id').all(),before)
  const authorized=x.decide(x.selected.id);await s.drain();await s.drain()
  assert.equal(s.get(x.selected.id)!.state,'ready');assert.equal(s.get(x.historic.id),null);assert.equal(s.get(x.denied.id),null)
  assert.equal(f.calls.length,5);assert.equal(f.calls.filter(c=>c.host==='gmail.googleapis.com'||c.host==='coda.io').every(c=>c.method==='GET'),true)
  assert.equal(f.calls.some(c=>c.host.includes('drive')),false)
  assert.equal(s.scopeStatus().mode,'real-pilot');assert.equal(JSON.stringify(s.scopeStatus()).includes('secret'),false)
  const p=s.get(x.selected.id)!.proposal!,packages=new UpdatePackageRepository(x.db)
  const approved=packages.decide(p.id,{decision:'approve',revision:p.revision,snapshotHash:p.snapshotHash,requestId:randomUUID()},'operator')
  createUpdatePackageSimulationSchema(x.db);const simulation=new UpdatePackageSimulationRepository(x.db,packages)
  assert.throws(()=>simulation.inspect(p.id),/ANALYSIS_REVIEW_ONLY/)
  assert.throws(()=>simulation.record(p.id,{revision:approved.revision,snapshotHash:approved.snapshotHash},{actionId:p.actions[0]!.id,actionHash:actionSnapshotHash(p.actions[0]!),attempt:1,outcome:'succeeded'}),/ANALYSIS_REVIEW_ONLY/)
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM update_package_simulated_receipts').get()!.n,0)
  await s.drain();assert.equal(f.calls.length,5)
  assert.equal(x.notices.get(x.selected.id).revision,authorized.revision)
 }finally{x.db.close()}
})
test('inicialização rejeita campos incompletos, modos conflitantes e escopos malformados sem IO',()=>{
 const x=setup(),f=fakeProviders();try{
  assert.equal(loadGmailAnalysis(x.db,{},f.mock),undefined)
  for(const key of Object.keys(x.env).filter(k=>k.startsWith('FUNIX_GMAIL_ANALYSIS_')&&!['FUNIX_GMAIL_ANALYSIS_ENABLED','FUNIX_GMAIL_ANALYSIS_MODE'].includes(k))){
   const env={...x.env};delete env[key];assert.throws(()=>loadGmailAnalysis(x.db,env,f.mock),/GMAIL_ANALYSIS_/,key)
  }
  for(const change of [
   {FUNIX_GMAIL_ANALYSIS_MODE:'real'},
   {FUNIX_GMAIL_ANALYSIS_SYNTHETIC:'true'},
   {FUNIX_GMAIL_ANALYSIS_FIXTURE_FILE:'not-read.json'},
   {FUNIX_GMAIL_ANALYSIS_PILOT_NOTICE_ID:x.historic.id},
   {FUNIX_GMAIL_ANALYSIS_PILOT_NOTICE_ID:x.denied.id},
   {FUNIX_GMAIL_ANALYSIS_PILOT_NOTICE_ID:randomUUID()},
   {FUNIX_GMAIL_ANALYSIS_PILOT_ACTIVATED_AT:'not-a-date'},
   {FUNIX_GMAIL_ANALYSIS_CODA_COLUMNS_JSON:'{invalid'},
   {FUNIX_GMAIL_ANALYSIS_CODA_COLUMNS_JSON:JSON.stringify({...columns,vehicle:'c-process'})},
   {FUNIX_GMAIL_ANALYSIS_CODA_COLUMNS_JSON:JSON.stringify({...columns,extra:'c-extra'})},
   {FUNIX_GMAIL_ANALYSIS_GMAIL_TOKEN:'bad\nsecret'}
  ])assert.throws(()=>loadGmailAnalysis(x.db,{...x.env,...change},f.mock))
  assert.equal(f.calls.length,0);assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM gmail_analysis_pilot_scope').get()!.n,0)
 }finally{x.db.close()}
})
test('escopo imutável no reinício; trocar UUID, corte, conta/contexto/modelo ou modo não amplia escopo',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gmail-real-pilot-')),path=join(dir,'test.sqlite'),x=setup(path),f=fakeProviders()
 try{
  x.decide(x.selected.id);const s=loadGmailAnalysis(x.db,x.env,f.mock)!;f.failCoda();await s.drain()
  assert.equal(s.get(x.selected.id)!.errorCode,'CODA_UNAVAILABLE');await s.stop();x.db.close()
  const db=openDatabase(path);try{
   const env=x.env
   for(const change of [{FUNIX_GMAIL_ANALYSIS_PILOT_NOTICE_ID:x.historic.id},{FUNIX_GMAIL_ANALYSIS_PILOT_ACTIVATED_AT:'2026-11-13T00:00:00.000Z'},{FUNIX_GMAIL_ANALYSIS_GMAIL_ACCOUNT:'other@funix.invalid'},{FUNIX_GMAIL_ANALYSIS_CODA_DOC_ID:'other-doc'},{FUNIX_GMAIL_ANALYSIS_OPENAI_MODEL:'other-model'}])assert.throws(()=>loadGmailAnalysis(db,{...env,...change},f.mock),/SCOPE_MISMATCH/)
   assert.throws(()=>new GmailAnalysisService(db,syntheticAnalysisProviders(analysisFixture())),/SCOPE_REQUIRED/)
   assert.throws(()=>db.exec('DELETE FROM gmail_analysis_pilot_scope'),/immutable/)
   assert.equal(loadGmailAnalysis(db,{...env,FUNIX_GMAIL_ANALYSIS_ENABLED:'false'},f.mock),undefined)
   const restarted=loadGmailAnalysis(db,{...env,FUNIX_GMAIL_ANALYSIS_GMAIL_TOKEN:'rotated-synthetic-token'},f.mock)!
   const notice=new GmailIntakeRepository(db).get(x.selected.id)
   restarted.retry(notice.id,{revision:notice.revision,snapshotHash:notice.snapshotHash,requestId:randomUUID()},'operator');await restarted.drain()
   assert.equal(restarted.get(notice.id)!.state,'ready')
   assert.equal(f.calls.filter(c=>c.host==='api.openai.com').length,1)
   assert.equal(restarted.get(x.historic.id),null);assert.equal(restarted.get(x.denied.id),null)
   assert.equal(new UpdatePackageRepository(db).list('all','').total,1)
  }finally{db.close()}
 }finally{try{x.db.close()}catch{}rmSync(dir,{recursive:true,force:true})}
})
test('jobs históricos já existentes permanecem intocados pelo scheduler restrito',async()=>{
 const x=setup(),f=fakeProviders();try{
  const unrestricted=new GmailAnalysisService(x.db,syntheticAnalysisProviders(analysisFixture()))
  unrestricted.schedule(x.historic.id)
  x.db.prepare("UPDATE gmail_analysis_jobs SET state='processing',attempts=5,lease_token='old-lease',lease_expires_at='2020-01-01T00:00:00.000Z' WHERE notice_id=?").run(x.historic.id)
  const before=x.db.prepare('SELECT * FROM gmail_analysis_jobs WHERE notice_id=?').get(x.historic.id)
  const restricted=loadGmailAnalysis(x.db,x.env,f.mock)!
  await unrestricted.drain();await restricted.drain()
  assert.equal(f.calls.length,0)
  x.decide(x.selected.id);await restricted.drain()
  assert.deepEqual(x.db.prepare('SELECT * FROM gmail_analysis_jobs WHERE notice_id=?').get(x.historic.id),before)
  assert.equal(restricted.get(x.selected.id)!.state,'ready')
 }finally{x.db.close()}
})
test('conta diferente ou escopo Gmail de escrita bloqueiam leitura, IA e Coda',async()=>{
 for(const invalid of ['account','scope']){
  const x=setup(),f=fakeProviders();try{
   if(invalid==='account')f.wrongAccount();else f.writeScope()
   const s=loadGmailAnalysis(x.db,x.env,f.mock)!;x.decide(x.selected.id);await s.drain()
   assert.equal(s.get(x.selected.id)!.errorCode,'SOURCE_AUTH_REQUIRED');assert.equal(s.get(x.selected.id)!.nextAttemptAt,null)
   assert.equal(f.calls.some(c=>c.path.includes('/messages/')),false)
   assert.equal(f.calls.some(c=>c.host==='api.openai.com'||c.host==='coda.io'),false)
  }finally{x.db.close()}
 }
})
test('modo sintético legado e explícito preservados; não pode substituir piloto real no mesmo banco',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gmail-synthetic-mode-')),file=join(dir,'fixture.json');writeFileSync(file,JSON.stringify(analysisFixture()))
 try{
  for(const explicit of [false,true]){
   const x=setup();try{
    const s=loadGmailAnalysis(x.db,{FUNIX_GMAIL_ANALYSIS_ENABLED:'true',FUNIX_GMAIL_ANALYSIS_SYNTHETIC:'true',FUNIX_GMAIL_ANALYSIS_FIXTURE_FILE:file,...(explicit?{FUNIX_GMAIL_ANALYSIS_MODE:'synthetic'}:{})})!
    x.decide(x.selected.id);await s.drain();assert.equal(s.get(x.selected.id)!.state,'ready');assert.equal(s.scopeStatus().mode,'synthetic')
   }finally{x.db.close()}
  }
  const x=setup();try{
   loadGmailAnalysis(x.db,x.env,fakeProviders().mock)
   assert.throws(()=>loadGmailAnalysis(x.db,{FUNIX_GMAIL_ANALYSIS_ENABLED:'true',FUNIX_GMAIL_ANALYSIS_MODE:'synthetic',FUNIX_GMAIL_ANALYSIS_FIXTURE_FILE:file}),/SCOPE_REQUIRED/)
  }finally{x.db.close()}
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('negação do aviso selecionado depois do bind continua excluída após reinício',async()=>{
 const x=setup(),f=fakeProviders();try{
  const service=loadGmailAnalysis(x.db,x.env,f.mock)!;x.decide(x.selected.id,'deny');await service.drain()
  const restarted=loadGmailAnalysis(x.db,x.env,f.mock)!;await restarted.drain()
  const notice=x.notices.get(x.selected.id)
  assert.equal(notice.status,'denied');assert.equal(restarted.get(notice.id),null);assert.equal(f.calls.length,0)
  assert.throws(()=>restarted.retry(notice.id,{revision:notice.revision,snapshotHash:notice.snapshotHash,requestId:randomUUID()},'operator'),{code:'GMAIL_ANALYSIS_NOT_AUTHORIZED'})
 }finally{x.db.close()}
})
test('gate é revalidado antes da IA e contexto; bind impede reutilizar análise antiga do mesmo aviso',async()=>{
 const x=setup(),f=fakeProviders();try{
  const unscoped=new GmailAnalysisService(x.db,syntheticAnalysisProviders(analysisFixture()))
  x.decide(x.selected.id);unscoped.schedule(x.selected.id)
  assert.throws(()=>loadGmailAnalysis(x.db,x.env,f.mock),/NOTICE_ALREADY_STARTED/)
  assert.equal(f.calls.length,0)
 }finally{x.db.close()}
 const y=setup();try{
  y.decide(y.selected.id);const providers=syntheticAnalysisProviders(analysisFixture()),reader=providers.readMessage
  let interpretations=0,queries=0
  providers.readMessage=async(...args)=>({...await reader(...args),accountId:'wrong@funix.invalid'})
  providers.interpret=async()=>{interpretations++;return {claims:[]}}
  providers.lookup=async()=>{queries++;return []}
  const service=new GmailAnalysisService(y.db,providers,Date.now,y.scope)
  await service.drain();assert.equal(interpretations,0);assert.equal(queries,0)
  assert.equal(service.get(y.selected.id)!.state,'failed')
 }finally{y.db.close()}
})
test('serviço iniciado sem scope é cercado se o banco for vinculado ao piloto durante um await',async()=>{
 const x=setup(),f=fakeProviders();try{
  const providers=syntheticAnalysisProviders(analysisFixture());let release!:(value:unknown)=>void,entered!:()=>void,queries=0
  const reached=new Promise<void>(resolve=>{entered=resolve})
  providers.readMessage=async()=>{entered();return new Promise(resolve=>{release=resolve as (value:unknown)=>void})}
  providers.interpret=async()=>{queries++;return {claims:[]}}
  const unscoped=new GmailAnalysisService(x.db,providers)
  // Start a synthetic historical job before the pilot is bound.
  const running=unscoped.drain();await reached
  const before=x.db.prepare('SELECT * FROM gmail_analysis_jobs WHERE notice_id=?').get(x.historic.id)
  loadGmailAnalysis(x.db,x.env,f.mock)
  release(analysisFixture().messages[0]!.message);await running
  assert.equal(queries,0);assert.equal(f.calls.length,0)
  assert.deepEqual(x.db.prepare('SELECT * FROM gmail_analysis_jobs WHERE notice_id=?').get(x.historic.id),before)
 }finally{x.db.close()}
})
test('API: status do scope sem conteúdo; autorização de outro aviso não agenda e piloto funciona',async()=>{
 const {createApp}=await import('../app.ts'),{AtendimentoRepository}=await import('../atendimentos.ts')
 const x=setup(),f=fakeProviders(),service=loadGmailAnalysis(x.db,x.env,f.mock)!
 const keys=['FUNIX_GMAIL_INTAKE_STORAGE_ENABLED','FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED'],saved=keys.map(k=>[k,process.env[k]] as const)
 for(const k of keys)process.env[k]='true'
 const app=createApp({atendimentos:new AtendimentoRepository(x.db),gmailAnalysis:service,password:'synthetic-pilot-api-password',origin:'http://localhost:5173',voiceProvider:null})
 await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve))
 const address=app.address() as {port:number},base='http://127.0.0.1:'+address.port
 try{
  const login=await fetch(base+'/api/session',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-pilot-api-password'})})
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!
  const health=await fetch(base+'/api/atualizacoes/analises-gmail?ids=',{headers:{cookie}}).then(r=>r.json())
  assert.deepEqual(health.items,[]);assert.equal(health.scope.noticeId,x.selected.id);assert.equal(health.scope.authorized,false)
  assert.equal(JSON.stringify(health).includes('secret'),false);assert.equal(JSON.stringify(health).includes('synthetic@'),false)
  const other=x.notices.ingest({...analysisNotice(),messageId:'d'.repeat(16)})
  for(const n of [other,x.selected]){
   const response=await fetch(base+`/api/atualizacoes/avisos-gmail/${n.id}/decisao`,{method:'POST',headers:{cookie,Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({decision:'authorize',revision:n.revision,snapshotHash:n.snapshotHash,requestId:randomUUID()})})
   assert.equal(response.status,200);await service.drain()
   if(n.id===other.id){assert.equal(f.calls.length,0);assert.equal(service.get(other.id),null)}
  }
  assert.equal(service.get(x.selected.id)!.state,'ready');assert.equal(x.notices.get(other.id).status,'authorized')
  assert.equal(service.get(other.id),null);assert.equal(f.calls.length,5)
 }finally{await service.stop();await new Promise<void>(resolve=>app.close(()=>resolve()));x.db.close();for(const [k,v] of saved)if(v===undefined)delete process.env[k];else process.env[k]=v}
})
