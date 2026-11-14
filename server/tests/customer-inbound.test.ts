import {test} from 'node:test'
import {Q} from '../exact.ts'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {loadConversationRuntime} from '../chat/conversation-runtime.ts'
import {V20AssociationRepository} from '../chat/v20-associations.ts'
import {CustomerRepository} from '../customers.ts'
import {conversationNames} from '../../shared/customer.ts'
import {funnelProjection} from '../funnel.ts'
const PN='5531999990101@s.whatsapp.net',LID='synthetic-origin@lid'
const env={FUNIX_CHAT_LOCAL_ENABLED:'true',FUNIX_CHAT_LOCAL_READ_ENABLED:'true'}
function event(mid='first',jid=PN,alt:string|null=null,name='Maria') {return {schemaVersion:2,instance:'funix_comercial',eventId:'event-'+mid,type:'message.upsert',occurredAt:'2026-01-01T00:00:00.000Z',displayName:name,message:{remoteJid:jid,remoteJidAlt:alt,messageId:mid,timestamp:1767225600,fromMe:false,kind:'text',text:'Mensagem sintética',media:null,statuses:[]}}}
function fixture(){const db=openDatabase(':memory:'),runtime=loadConversationRuntime(env,db)!;return {db,runtime,at:new AtendimentoRepository(db),links:new V20AssociationRepository(db),customers:new CustomerRepository(db),ingest:(value=event())=>runtime.store.ingest(JSON.stringify(value))}}

test('autonomous inbound creates once, snapshots once, preserves manual changes and survives repeats',()=>{
 const f=fixture();try{
 const receipt=f.ingest(),first=f.at.list().items[0]!
 assert.equal(f.at.list().total,1);assert.equal(first.name,'Maria');assert.equal(first.phone,'+5531999990101')
 assert.deepEqual(f.ingest(),receipt)
 f.at.update(first.id,{revision:first.revision,name:'Pedro',phone:''})
 f.ingest(event('second',PN,null,'Outro nome'))
 assert.equal(f.at.list().total,1);assert.equal(f.at.get(first.id).name,'Pedro');assert.equal(f.at.get(first.id).phone,'')
 const snapshot=f.db.prepare('SELECT * FROM conversation_initialization').get()!;assert.equal(snapshot.decision,'created');assert.equal(JSON.parse(String(snapshot.snapshot)).name,'Maria')
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM chat_messages').get()!.n,2)
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM atendimento_contact_events').get()!.n,2)
 assert.equal(f.runtime.authority!.projection(PN).unreadCount,2)
 const page=f.runtime.store.page(PN,1);assert.equal(page.items.length,2)
 }finally{f.db.close()}
})
test('explicit unique active association is reused; ambiguous and closed links never create/reopen',()=>{
 for(const mode of ['unique','ambiguous','closed']as const){const f=fixture();try{
  const id=f.runtime.authority!.rememberProviderConversation(PN)
  const a=f.at.create({name:'Pedro',closed:mode==='closed'})
  f.links.link({conversationId:id,atendimentoId:a.id,requestId:randomUUID(),expectedRevision:0,reason:'synthetic explicit'})
  if(mode==='ambiguous'){const b=f.at.create({name:'Segundo'});f.links.link({conversationId:id,atendimentoId:b.id,requestId:randomUUID(),expectedRevision:1,reason:'synthetic explicit'})}
  f.ingest();f.ingest(event('retry-message'))
  assert.equal(f.at.list().total,mode==='ambiguous'?2:1)
  assert.equal(f.at.get(a.id).name,'Pedro');assert.equal(f.db.prepare('SELECT decision FROM conversation_initialization').get()!.decision,mode==='unique'?'reused':mode)
 }finally{f.db.close()}}
})
test('LID only stores message and creates partial ficha without invented phone; unique alias preserves original snapshot',()=>{
 const f=fixture();try{f.ingest(event('lid',LID));const a=f.at.list().items[0]!;assert.equal(a.phone,'');f.ingest(event('pn',PN,LID,'Novo nome'));assert.equal(f.at.list().total,1);assert.equal(f.at.get(a.id).phone,'');assert.equal(f.at.get(a.id).name,'Maria');assert.equal(f.runtime.store.page(LID,1).items.length,2)}finally{f.db.close()}
})
test('contradictory aliases preserve quarantined content and deny reading/sending contexts',()=>{
 const f=fixture();try{f.ingest(event('one',LID,PN));const other='5531999990202@s.whatsapp.net';f.ingest(event('two',LID,other));assert.equal(f.at.list().total,1);assert.equal(f.runtime.authority!.identityState(LID),'identity_conflict');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM chat_messages').get()!.n,2);assert.throws(()=>f.runtime.store.page(LID,1));assert.equal(f.runtime.authority!.resolveActive(other),null)}finally{f.db.close()}
})
test('manual progressive creation, entity selection, third-party contact, nickname and N:N preserve messages',()=>{
 const f=fixture();try{f.ingest();const a=f.at.list().items[0]!,contact=f.runtime.authority!.projection(PN).contactId!,entity=f.customers.save({kind:'entity',text:'Pedro'})
 const refs=f.at.get(a.id,true).references!;refs.person=[{id:entity.id,text:'Pedro'}]
 f.at.update(a.id,{revision:a.revision,references:refs,name:'Pedro'})
 assert.deepEqual(f.runtime.authority!.projection(PN).names,[{name:'Pedro',entityId:entity.id}])
 const c=f.customers.record(contact);f.customers.save({text:c.text,revision:c.revision,nickname:'Dona Maria'},contact)
 assert.deepEqual(f.runtime.authority!.projection(PN).names,[{name:'Dona Maria',entityId:null}])
 const b=f.at.create({});assert.equal(b.phone,'');const conversationId=f.runtime.authority!.rememberProviderConversation(PN)
 f.links.link({conversationId,atendimentoId:b.id,expectedRevision:1,requestId:randomUUID(),reason:'Second process'})
 assert.equal(f.runtime.authority!.projection(PN).atendimentoCount,2)
 const links=f.links.listActive(conversationId);for(const l of links.items){f.links.selectAtendimento(conversationId,l.linkId);assert.equal(f.runtime.store.page(PN,1).items.length,1)}
 assert.throws(()=>f.customers.save({text:'+5531999999999',revision:2},contact))
 }finally{f.db.close()}
})
test('individual seals, distinct names, own nickname and empty fallback',()=>{
 assert.deepEqual(conversationNames(null,null,[]),[{name:'Sem nome',entityId:null}])
 const people=[{name:'Ana',entityId:null},{name:'Ana',entityId:null},{name:'Pedro',entityId:'explicit-id'}]
 assert.deepEqual(conversationNames('',null,people),[people[0],people[2]])
 assert.deepEqual(conversationNames('Dona Maria',null,people),[{name:'Dona Maria',entityId:null}])
})
test('commercial clock stays unchanged after cadastral edit; closed ficha stays closed after new inbound',()=>{
 const f=fixture();try{f.ingest();const a=f.at.list().items[0]!,before=funnelProjection(f.db,[a])[0]!;assert.equal(before.lastContactAt,'2026-01-01T00:00:00.000Z');assert.equal(before.commercialValue,null);f.at.update(a.id,{revision:a.revision,plate:'ABC1D23',closed:true});f.ingest(event('after-closed'));assert.equal(f.at.list().total,1);assert.ok(f.at.get(a.id).closedAt);assert.equal(funnelProjection(f.db,[f.at.get(a.id)])[0]!.lastContactAt,before.lastContactAt)}finally{f.db.close()}
})
test('independent concurrent SQLite processes and restart create exactly one Atendimento',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-autonomous-')),path=join(dir,'synthetic.sqlite'),script=join(dir,'worker.mjs')
 try{
  const db=openDatabase(path);db.close()
  writeFileSync(script,`import {openDatabase} from ${JSON.stringify(new URL('../database.ts',import.meta.url).href)};import {loadConversationRuntime} from ${JSON.stringify(new URL('../chat/conversation-runtime.ts',import.meta.url).href)};const db=openDatabase(process.argv[2]);const runtime=loadConversationRuntime(${JSON.stringify(env)},db);runtime.store.ingest(process.argv[3]);db.close();`)
  await Promise.all(Array.from({length:6},(_,i)=>new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,[script,path,JSON.stringify(event(i%2?'same':'second'))],{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error)))})))
  const reopened=openDatabase(path);try{assert.equal(new AtendimentoRepository(reopened).list().total,1);assert.equal(reopened.prepare('SELECT COUNT(*) n FROM conversation_initialization').get()!.n,1);assert.equal(reopened.prepare('SELECT COUNT(*) n FROM chat_messages').get()!.n,2)}finally{reopened.close()}
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('V18 upgrade is additive, rolls back failed DDL, and promotes only explicit historical links',async()=>{
 const {removeV18FixtureSchema}=await import('./fixtures/pre-v18.ts'),{migrate}=await import('../migrations.ts')
 const db=openDatabase(':memory:');try{
  const at=new AtendimentoRepository(db).create({name:'Preservado',phone:''})
  removeV18FixtureSchema(db)
  db.prepare('INSERT INTO chat_instances VALUES(?,?)').run('funix_comercial','2026-01-01T00:00:00.000Z')
  const cid=randomUUID(),lid=randomUUID();db.prepare('INSERT INTO chat_conversations(id,instance,remote_jid) VALUES(?,?,?)').run(cid,'funix_comercial',PN)
  db.prepare('INSERT INTO chat_links VALUES(?,?,?,?,?,?,?,?)').run(lid,cid,at.id,1,'2026-01-01T00:00:00.000Z',null,'synthetic','explicit historical')
  db.exec('CREATE TABLE customer_records(collision TEXT)')
  assert.throws(()=>migrate(db));assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,17)
  assert.equal(db.prepare('PRAGMA table_info(atendimentos)').all().some(r=>r.name==='closed_at'),false)
  db.exec('DROP TABLE customer_records');migrate(db)
  assert.deepEqual(new AtendimentoRepository(db).get(at.id),at)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_links').get()!.n,1)
  const runtime=loadConversationRuntime(env,db)!
  runtime.store.ingest(JSON.stringify(event()))
  assert.equal(new AtendimentoRepository(db).list().total,1)
  assert.equal(db.prepare('SELECT decision FROM conversation_initialization').get()!.decision,'reused')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})

test('funnel derives range from alternative scenarios and saved negotiations with exact existing motor',async()=>{
 const {commercialFixture}=await import('./fixtures/commercial.ts'),{ComponentRepository}=await import('../components.ts')
 const db=openDatabase(':memory:');try{
  const f=commercialFixture(db),base=funnelProjection(db,[f.at])[0]!.commercialValue!
  assert.equal(base.min,base.max)
  const b=f.scenarios.create(f.at.id,{name:'Alternativa',duplicateFrom:f.scenario.id,sourceRevision:f.scenarios.list(f.at.id)[0]!.revision})
  const service=f.commercial.list(f.at.id)[0]!.services[0]!
  f.scenarios.update(f.at.id,b.id,{revision:b.revision,serviceFlags:{[service.id]:false}})
  new ComponentRepository(db).save(f.at.id,{pieceId:f.item.id,name:'Componente sintético',quantity:'1',manualPrice:'100',notes:'',scenarioId:b.id,scenarioRevision:f.scenarios.list(f.at.id).find(s=>s.id===b.id)!.revision})
  const range=funnelProjection(db,[f.at])[0]!.commercialValue!
  assert.equal(range.min,'200');assert.equal(range.max,base.max)
  const original=f.scenarios.list(f.at.id).find(s=>s.id===f.scenario.id)!
  f.scenarios.update(f.at.id,original.id,{revision:original.revision,negotiationDraft:{mode:'discount',value:'50'}})
  const negotiated=funnelProjection(db,[f.at])[0]!.commercialValue!
  assert.equal(negotiated.max,Q.from(base.max).sub(Q.from('50')).toString())
 }finally{db.close()}
})

test('local A→B→A context epochs revoke old send commands, without changing messages or link revisions',()=>{
 const f=fixture();try{
  f.ingest();const id=f.runtime.authority!.rememberProviderConversation(PN),a=f.at.list().items[0]!,before=f.runtime.authority!.contextToken(PN)
  const b=f.at.create({name:'Outro contexto'});f.links.link({conversationId:id,atendimentoId:b.id,expectedRevision:1,requestId:randomUUID(),reason:'synthetic'})
  const links=f.links.listActive(id);f.links.selectAtendimento(id,links.items.find(l=>l.atendimentoId===b.id)!.linkId);f.links.selectAtendimento(id,links.items.find(l=>l.atendimentoId===a.id)!.linkId)
  assert.notEqual(f.runtime.authority!.contextToken(PN),before)
  assert.equal(f.links.listActive(id).revision,2)
  assert.equal(f.runtime.store.page(PN,1).items.length,1)
 }finally{f.db.close()}
})

test('manual contact prepares an explicit conversation without sending; phone correction cannot adopt existing history',()=>{
 const f=fixture();try{
  const manual=f.at.create({name:'Manual',phone:'+5531999990888'}),prepared=f.runtime.authority!.prepareConversation(manual.id,0,manual.revision)
  assert.ok(prepared.conversationId);assert.equal(f.at.list().total,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM chat_messages').get()!.n,0)
  const manualJid='5531999990888@s.whatsapp.net';f.ingest(event('manual-inbound',manualJid,null,'Nome canal'));assert.equal(f.at.list().total,1);assert.equal(f.at.get(manual.id).name,'Manual')
  const other=f.at.create({phone:'+5531999990888',name:'Pessoa diferente'})
  assert.throws(()=>f.runtime.authority!.prepareConversation(other.id,0,other.revision),/Já existe histórico/)
  assert.equal(f.runtime.authority!.resolveIdentityActive(manualJid),manual.id)
  const partial=f.at.create({phone:'31999990000'});assert.throws(()=>f.runtime.authority!.prepareConversation(partial.id,0,partial.revision),/DDI/)
 }finally{f.db.close()}
})

test('previously separate PN/LID handles retain both processes; exact alias evidence permits explicit context selection without a third ficha',()=>{
 const f=fixture();try{
  f.ingest(event('pn-independent',PN,null,'Pedro'));f.ingest(event('lid-independent',LID,null,'Maria'))
  f.ingest(event('alias-evidence',LID,PN,'Canal'))
  const cid=f.runtime.authority!.rememberProviderConversation(PN),scope=f.runtime.authority!.associationScope(cid),links=f.links.listActive(cid,scope)
  assert.equal(f.at.list().total,2);assert.equal(links.items.length,2);assert.equal(f.runtime.authority!.resolveIdentityActive(PN),null)
  for(const link of links.items){f.links.selectAtendimento(cid,link.linkId,scope);assert.equal(f.runtime.authority!.resolveIdentityActive(LID),link.atendimentoId);assert.equal(f.runtime.store.page(PN,1).items.length,3)}
  f.links.unlink({conversationId:cid,linkId:links.items[0]!.linkId,expectedRevision:links.revision,requestId:randomUUID(),reason:'synthetic explicit unlink'},scope)
  assert.equal(f.links.listActive(cid,scope).items.length,1);assert.equal(f.runtime.store.page(LID,1).items.length,3)
 }finally{f.db.close()}
})

test('accepted outbound advances the contact clock once; replay never sends twice or resets clock',async()=>{
 const {createEvolutionChatBridge}=await import('../chat/evolution-bridge.ts'),f=fixture();try{
  f.ingest();const a=f.at.list().items[0]!,cid=f.runtime.authority!.rememberProviderConversation(PN)
  let sends=0;const bridge=createEvolutionChatBridge({findChatsPage:async()=>({items:[],sourceCount:0}),findMessages:async()=>{throw Error('No real provider')}},Date.now,f.links,f.runtime.authority,async()=>{sends++;return {messageId:'synthetic-accepted'}},undefined,f.runtime)
  const command={requestId:randomUUID(),contextToken:f.runtime.authority!.contextToken(PN)!}
  assert.equal((await bridge.sendTextForAtendimento(a.id,cid,'Sintético',command)).state,'accepted')
  const before=funnelProjection(f.db,[f.at.get(a.id)])[0]!.lastContactAt
  await bridge.sendTextForAtendimento(a.id,cid,'Sintético',command)
  assert.equal(sends,1);assert.equal(funnelProjection(f.db,[f.at.get(a.id)])[0]!.lastContactAt,before)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM atendimento_contact_events').get()!.n,2)
 }finally{f.db.close()}
})

test('an incomplete enabled scenario cannot present a falsely complete commercial range',async()=>{
 const {commercialFixture}=await import('./fixtures/commercial.ts'),{ComponentRepository}=await import('../components.ts')
 const db=openDatabase(':memory:');try{const f=commercialFixture(db);assert.ok(funnelProjection(db,[f.at])[0]!.commercialValue);new ComponentRepository(db).save(f.at.id,{pieceId:f.item.id,name:'Preço pendente',quantity:'1',manualPrice:null,notes:'',scenarioId:f.scenario.id,scenarioRevision:f.scenarios.list(f.at.id)[0]!.revision});assert.equal(funnelProjection(db,[f.at])[0]!.commercialValue,null)}finally{db.close()}
})

test('channel number as initial name is retained; a LID-only Contact can have an explicit seller nickname',()=>{
 const f=fixture();try{
  f.ingest(event('number-name',PN,null,'5531999990101'));assert.equal(f.at.list().items[0]!.name,'5531999990101')
  const bare=event('no-name-lid',LID);delete (bare as {displayName?:string}).displayName;f.ingest(bare)
  assert.deepEqual(f.runtime.authority!.projection(LID).names,[{name:'Sem nome',entityId:null}])
  const id=f.runtime.authority!.projection(LID).contactId!,record=f.customers.record(id)
  f.customers.save({text:'',revision:record.revision,nickname:'Canal pendente'},id)
  assert.deepEqual(f.runtime.authority!.projection(LID).names,[{name:'Canal pendente',entityId:null}]);assert.equal(f.runtime.authority!.projection(LID).phoneNumber,null)
 }finally{f.db.close()}
})

test('editing another reference preserves independent legacy brand/model/years until vehicle is explicitly edited',()=>{
 const f=fixture();try{
  const a=f.at.create({phone:'123',name:'Antigo',brand:'Fiat',model:'Punto',vehicle:'Punto 2019/2020',fabricationYear:null,modelYear:null,plate:'ABC1D23'})
  const refs=f.at.get(a.id,true).references!;refs.person[0]!.text='Novo nome'
  const saved=f.at.update(a.id,{revision:a.revision,references:refs})
  assert.equal(saved.brand,'Fiat');assert.equal(saved.model,'Punto');assert.equal(saved.vehicle,'Punto 2019/2020');assert.equal(saved.fabricationYear,null);assert.equal(saved.modelYear,null)
  refs.vehicle[0]={id:null,text:'Honda Civic',plate:'ABC1D23',fabricationYear:'2020',modelYear:'2021'}
  const changed=f.at.update(a.id,{revision:saved.revision,references:refs});assert.equal(changed.model,'Honda Civic');assert.equal(changed.vehicle,'Honda Civic');assert.equal(changed.fabricationYear,'2020');assert.equal(changed.modelYear,'2021')
 }finally{f.db.close()}
})

test('V18 reuses previously confirmed bindings stored in the app database and preserves pending context conflicts without external access',async()=>{
 const {createCodaEventSchema,CodaEventSyncRepository}=await import('../chat/coda-sync.ts'),{removeV18FixtureSchema}=await import('./fixtures/pre-v18.ts'),{migrate}=await import('../migrations.ts')
 for(const conflicted of [false,true]){
  const db=openDatabase(':memory:');try{
   removeV18FixtureSchema(db);createCodaEventSchema(db)
   const prior=new CodaEventSyncRepository(db),old=prior.sync({version:1,source:'coda',eventId:'stored-local-confirmation',codaRowId:'i-SYNTHETIC',instance:'funix_comercial',remoteJid:PN,phoneE164:'+5531999990101',displayName:'Ficha já existente',occurredAt:1767225600})
   if(conflicted)assert.throws(()=>prior.sync({version:1,source:'coda',eventId:'stored-local-conflict',codaRowId:'i-CONFLICT',instance:'funix_comercial',remoteJid:PN,phoneE164:'+5531999990101',displayName:'Conflito',occurredAt:1767225600}))
   migrate(db);const runtime=loadConversationRuntime(env,db)!,repo=new AtendimentoRepository(db)
   runtime.store.ingest(JSON.stringify(event()))
   assert.equal(repo.list().total,1);assert.equal(repo.get(old.atendimentoId).name,'Ficha já existente')
   if(conflicted){
    assert.equal(runtime.authority!.identityState(PN),'context_conflict');assert.equal(db.prepare('SELECT COUNT(*) n FROM conversation_initialization').get()!.n,0)
    const cid=runtime.authority!.rememberProviderConversation(PN),links=new V20AssociationRepository(db),scope=runtime.authority!.associationScope(cid),list=links.listActive(cid,scope)
    links.selectAtendimento(cid,list.items[0]!.linkId,scope);assert.equal(runtime.authority!.identityState(PN),'linked')
   }else assert.equal(db.prepare('SELECT decision FROM conversation_initialization').get()!.decision,'reused')
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  }finally{db.close()}
 }
})
