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
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM atendimento_contact_events').get()!.n,1)
 assert.equal(f.runtime.authority!.interaction(PN).blocked,true)
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
test('closed interaction is preserved; old/replayed messages do not start a new Atendimento',()=>{
 const f=fixture();try{
  const first=event()
  f.ingest(first)
  const a=f.at.list().items[0]!,before=funnelProjection(f.db,[a])[0]!
  assert.equal(a.purpose,'unclassified')
  assert.equal(before.lastContactAt,first.occurredAt)
  const closed=f.at.update(a.id,{revision:a.revision,plate:'ABC1D23',purpose:'non_commercial',closed:true})
  assert.equal(closed.explicitRefusal,false)
  f.ingest({...first,eventId:'another-event-same-message'})
  f.ingest(event('late-history'))
  assert.equal(f.at.list().total,1)
  // Close precedes a genuinely new inbound with a different message ID.
  const next=event('new-demand')
  next.message.timestamp=Math.floor(Date.parse(closed.closedAt!)/1000)+2
  next.occurredAt=new Date(next.message.timestamp*1000).toISOString()
  f.ingest(next);f.ingest(next)
  assert.equal(f.at.list().total,2)
  assert.equal(f.runtime.authority!.projection(PN).atendimentoCount,2)
  assert.equal(f.at.get(a.id).closedAt,closed.closedAt)
  assert.equal(funnelProjection(f.db,[f.at.get(a.id)])[0]!.lastContactAt,before.lastContactAt)
 }finally{f.db.close()}
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

test('V19 upgrade is additive, rolls back failed DDL, and promotes only explicit historical links',async()=>{
 const {removeV19FixtureSchema}=await import('./fixtures/pre-v19.ts'),{migrate}=await import('../migrations.ts')
 const db=openDatabase(':memory:');try{
  const at=new AtendimentoRepository(db).create({name:'Preservado',phone:''})
  removeV19FixtureSchema(db)
  db.prepare('INSERT INTO chat_instances VALUES(?,?)').run('funix_comercial','2026-01-01T00:00:00.000Z')
  const cid=randomUUID(),lid=randomUUID();db.prepare('INSERT INTO chat_conversations(id,instance,remote_jid) VALUES(?,?,?)').run(cid,'funix_comercial',PN)
  db.prepare('INSERT INTO chat_links VALUES(?,?,?,?,?,?,?,?)').run(lid,cid,at.id,1,'2026-01-01T00:00:00.000Z',null,'synthetic','explicit historical')
  db.exec('CREATE TABLE customer_records(collision TEXT)')
  assert.throws(()=>migrate(db));assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,18)
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
  const manual=f.at.create({name:'Manual',phone:'(31) 99999-0888'}),prepared=f.runtime.authority!.prepareConversation(manual.id,0,manual.revision)
  assert.ok(prepared.conversationId);assert.equal(f.at.list().total,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM chat_messages').get()!.n,0)
  const manualJid='5531999990888@s.whatsapp.net';f.ingest(event('manual-inbound',manualJid,null,'Nome canal'));assert.equal(f.at.list().total,1);assert.equal(f.at.get(manual.id).name,'Manual')
  const other=f.at.create({phone:'+5531999990888',name:'Pessoa diferente'})
  assert.throws(()=>f.runtime.authority!.prepareConversation(other.id,0,other.revision),/Já existe histórico/)
  assert.equal(f.runtime.authority!.resolveIdentityActive(manualJid),manual.id)
  const partial=f.at.create({phone:'99999-0000'});assert.throws(()=>f.runtime.authority!.prepareConversation(partial.id,0,partial.revision),/DDI/)
 }finally{f.db.close()}
})

test('preparing a conversation reuses the equivalent PN only for the selected owner',()=>{
 const f=fixture()
 try{
  const customers=new CustomerRepository(f.db)
  const owner=customers.save({kind:'entity',text:'Titular sintético',contacts:[{text:'(31) 99999-0888'}]})
  const [contact]=customers.contacts(owner.id)
  const other=f.at.create({name:'Outro nome',phone:'+5531999990888'})
  assert.throws(()=>f.runtime.authority!.prepareConversation(other.id,0,other.revision),/titular/)
  const at=f.at.create({references:{person:[{id:owner.id,text:owner.text}],contact:[{id:null,text:'5531999990888'}],vehicle:[],payer:[]}})
  const prepared=f.runtime.authority!.prepareConversation(at.id,0,at.revision)
  assert.equal(f.at.get(at.id,true).references!.contact[0]!.id,contact!.id)
  assert.equal(customers.record(contact!.id).conversationId,prepared.conversationId)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM customer_records WHERE kind='contact'").get()!.n,1)
 }finally{f.db.close()}
})

test('previously separate PN/LID handles retain both processes and identity hold survives context selection',()=>{
 const f=fixture();try{
  f.ingest(event('pn-independent',PN,null,'Pedro'));f.ingest(event('lid-independent',LID,null,'Maria'))
  f.ingest(event('alias-evidence',LID,PN,'Canal'))
  const cid=f.runtime.authority!.rememberProviderConversation(PN),scope=f.runtime.authority!.associationScope(cid),links=f.links.listActive(cid,scope)
  assert.equal(f.at.list().total,2);assert.equal(links.items.length,2);assert.equal(f.runtime.authority!.resolveIdentityActive(PN),null)
  for(const link of links.items){assert.throws(()=>f.links.selectAtendimento(cid,link.linkId,scope),/identidade/);assert.equal(f.runtime.authority!.resolveIdentityActive(LID),null);assert.equal(f.runtime.store.page(PN,1).items.length,3)}
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

test('V19 reuses previously confirmed bindings stored in the app database and preserves pending context conflicts without external access',async()=>{
 const {createCodaEventSchema,CodaEventSyncRepository}=await import('../chat/coda-sync.ts'),{removeV19FixtureSchema}=await import('./fixtures/pre-v19.ts'),{migrate}=await import('../migrations.ts')
 for(const conflicted of [false,true]){
  const db=openDatabase(':memory:');try{
   removeV19FixtureSchema(db);createCodaEventSchema(db)
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


test('authenticated inbound references the explicitly assigned Entity without copying provider name',()=>{
 const f=fixture();try{
  const entity=f.customers.save({kind:'entity',text:'Pessoa cadastrada',contacts:[{text:'+5531999990101'}]})
  const contact=f.customers.contacts(entity.id)[0]!
  const cid=f.runtime.authority!.rememberProviderConversation(PN)
  f.db.prepare('UPDATE customer_records SET conversation_id=? WHERE id=?').run(cid,contact.id)
  f.ingest(event('first-known',PN,null,'Nome do WhatsApp'))
  const a=f.at.list().items[0]!
  assert.deepEqual(f.at.get(a.id,true).references!.person,[{id:entity.id,text:entity.text}])
  f.ingest(event('second-known'))
  assert.equal(f.at.list().total,1)
  assert.equal(f.at.get(a.id,true).references!.person.length,1)
  f.customers.save({text:'Pessoa renomeada',revision:entity.revision},entity.id)
  assert.equal(f.at.get(a.id,true).references!.person[0]!.text,'Pessoa renomeada')
 }finally{f.db.close()}
})


test('target autonomous runtime creates the shared Entity and Contact atomically; exact known number reuses owner',()=>{
 const db=openDatabase(':memory:')
 try{
  const runtime=loadConversationRuntime({...env,FUNIX_CHAT_AUTONOMOUS_ENABLED:'true'},db)!
  const customers=new CustomerRepository(db),at=new AtendimentoRepository(db)
  const ingest=(value:ReturnType<typeof event>)=>runtime.store.ingest(JSON.stringify(value))
  const first=event('canonical-new')
  const receipt=ingest(first)
  assert.deepEqual(ingest(first),receipt)
  const a=at.get(at.list().items[0]!.id,true)
  const person=a.references!.person[0]!,contact=a.references!.contact[0]!
  assert.ok(person.id);assert.ok(contact.id)
  assert.equal(customers.record(contact.id!).entityId,person.id)
  assert.equal(customers.contacts(person.id!).length,1)
  assert.equal(runtime.authority!.projection(PN).names[0]?.name,a.name)
  const known=customers.save({kind:'entity',text:'Cadastro compartilhado',contacts:[{text:'+5531999990888'}]})
  const pn2='5531999990888@s.whatsapp.net'
  ingest(event('canonical-existing',pn2,null,'Nome do canal'))
  const b=at.get(runtime.authority!.resolveIdentityActive(pn2)!,true)
  assert.equal(b.references!.person[0]!.id,known.id)
  assert.equal(b.references!.contact[0]!.id,customers.contacts(known.id)[0]!.id)
  assert.equal(b.name,known.text)
  assert.notEqual(customers.record(contact.id!).conversationId,customers.contacts(known.id)[0]!.conversationId)
  assert.equal(at.list().total,2)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM customer_records WHERE kind='entity'").get()!.n,2)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})


test('standalone first LID interaction shares one provisional registration; later confirmed PN completes that same Contact',()=>{
 const db=openDatabase(':memory:')
 try{
  const runtime=loadConversationRuntime({...env,FUNIX_CHAT_AUTONOMOUS_ENABLED:'true'},db)!
  const at=new AtendimentoRepository(db),customers=new CustomerRepository(db),authority=runtime.authority!
  const ingest=(value:ReturnType<typeof event>)=>runtime.store.ingest(JSON.stringify(value))
  const first=event('new-lid-only',LID,null,'Pessoa do canal')
  assert.deepEqual(ingest(first),ingest(first))
  const a=at.get(at.list().items[0]!.id,true),person=a.references!.person[0]!,contact=a.references!.contact[0]!
  assert.ok(person.id);assert.ok(contact.id);assert.equal(a.phone,'')
  assert.equal(customers.record(contact.id!).entityId,person.id)
  assert.equal(authority.projection(LID).names[0]!.entityId,person.id)
  ingest(event('late-confirmed-pn',PN,LID,'Outro nome do canal'))
  const b=at.get(a.id,true)
  assert.equal(b.references!.person[0]!.id,person.id)
  assert.equal(b.references!.contact[0]!.id,contact.id)
  assert.equal(b.phone,'+5531999990101');assert.equal(b.name,'Pessoa do canal')
  assert.equal(authority.projection(PN).contactId,contact.id)
  assert.equal(authority.projection(LID).contactId,contact.id)
  assert.equal(at.list().total,1)
  assert.equal(db.prepare('SELECT count(*) n FROM customer_records').get()!.n,2)
  assert.equal(db.prepare("SELECT search_text FROM atendimentos WHERE id=?").get(a.id)!.search_text?.toString().includes('+5531999990101'),true)
  assert.equal(runtime.store.page(PN,1).items.length,2)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})
test('standalone LID without a name keeps phone empty and a shared provisional identity',()=>{
 const db=openDatabase(':memory:')
 try{
  const runtime=loadConversationRuntime({...env,FUNIX_CHAT_AUTONOMOUS_ENABLED:'true'},db)!
  const bare=event('unknown-lid',LID,null,'')
  delete (bare as {displayName?:string}).displayName
  runtime.store.ingest(JSON.stringify(bare))
  const at=new AtendimentoRepository(db),a=at.get(at.list().items[0]!.id,true)
  assert.equal(a.phone,'');assert.equal(a.name,'Sem nome')
  assert.ok(a.references!.person[0]!.id);assert.ok(a.references!.contact[0]!.id)
  assert.equal(new CustomerRepository(db).record(a.references!.contact[0]!.id!).entityId,a.references!.person[0]!.id)
 }finally{db.close()}
})
test('same-owner LID then existing PN reconciles references and replays without moving messages',()=>{
 const db=openDatabase(':memory:')
 try{
  const runtime=loadConversationRuntime({...env,FUNIX_CHAT_AUTONOMOUS_ENABLED:'true'},db)!
  const customers=new CustomerRepository(db),at=new AtendimentoRepository(db)
  runtime.store.ingest(JSON.stringify(event('lid-before-known-phone',LID)))
  const first=at.get(at.list().items[0]!.id,true),owner=customers.record(first.references!.person[0]!.id!)
  const provisional=first.references!.contact[0]!.id!
  const known=customers.save({kind:'contact',text:'(31) 99999-0101',entityId:owner.id})
  const signed=JSON.stringify(event('same-owner-pn',PN,LID))
  const receipt=runtime.store.ingest(signed)
  assert.deepEqual(runtime.store.ingest(signed),receipt)
  assert.equal(at.list().total,1)
  assert.equal(at.get(first.id,true).references!.contact[0]!.id,known.id)
  assert.equal(customers.record(provisional).id,known.id)
  assert.throws(()=>customers.save({text:'+5531999990711',revision:1},provisional),/arquivado/)
  assert.ok(customers.search('contact','').every(contact=>contact.id!==provisional))
  assert.deepEqual(customers.contacts(owner.id).map(contact=>contact.id),[known.id])
  assert.equal(runtime.store.page(LID,1).items.length,2)
 }finally{db.close()}
})

test('standalone late PN cannot silently adopt another Entity Contact',()=>{
 const db=openDatabase(':memory:')
 try{
  const runtime=loadConversationRuntime({...env,FUNIX_CHAT_AUTONOMOUS_ENABLED:'true'},db)!
  const customers=new CustomerRepository(db),at=new AtendimentoRepository(db)
  const existing=customers.save({kind:'entity',text:'Outro titular',contacts:[{text:'+5531999990101'}]})
  runtime.store.ingest(JSON.stringify(event('lid-before-collision',LID)))
  const a=at.get(at.list().items[0]!.id,true),contactId=a.references!.contact[0]!.id!
  runtime.store.ingest(JSON.stringify(event('pn-collision',PN,LID)))
  assert.equal(customers.record(contactId).text,'')
  assert.notEqual(customers.record(contactId).entityId,existing.id)
  assert.equal(runtime.authority!.identityState(PN),'context_conflict')
  assert.equal(runtime.authority!.contextToken(PN),null)
  assert.equal(customers.contacts(existing.id)[0]!.text,'+5531999990101')
  assert.equal(at.list().total,1)
  assert.equal(db.prepare('SELECT count(*) n FROM chat_messages').get()!.n,2)
 }finally{db.close()}
})

test('explicit autonomous cutover creates a shared registration on first authenticated upsert even after history observation',()=>{
 const db=openDatabase(':memory:')
 try{
  const runtime=loadConversationRuntime({...env,FUNIX_CHAT_AUTONOMOUS_ENABLED:'true',FUNIX_CHAT_AUTONOMOUS_SINCE:'2026-01-01T00:00:00.000Z'},db)!
  const at=new AtendimentoRepository(db),customers=new CustomerRepository(db)
  const first=event('snapshot-then-webhook')
  runtime.store.observePage(PN,[{...first.message,recordId:'synthetic',instanceId:'synthetic',origin:'unknown',kind:'text'}],1)
  assert.equal(at.list().total,0)
  const receipt=runtime.store.ingest(JSON.stringify(first))
  assert.deepEqual(runtime.store.ingest(JSON.stringify(first)),receipt)
  runtime.store.ingest(JSON.stringify({...first,eventId:'same-authenticated-message'}))
  assert.equal(at.list().total,1)
  const record=at.get(at.list().items[0]!.id,true)
  assert.equal(customers.record(record.references!.contact[0]!.id!).entityId,record.references!.person[0]!.id)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM atendimento_contact_events').get()!.n,1)
  const before=event('before-cutover','5531999990999@s.whatsapp.net')
  before.message.timestamp-=1;before.occurredAt=new Date(before.message.timestamp*1000).toISOString()
  runtime.store.ingest(JSON.stringify(before))
  assert.equal(at.list().total,1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages').get()!.n,2)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})

test('future abbreviated PN automatically reuses the sole matching ficha and only opens history',()=>{
 const db=openDatabase(':memory:')
 try{
  const runtime=loadConversationRuntime({...env,FUNIX_CHAT_AUTONOMOUS_ENABLED:'true',
   FUNIX_CHAT_AUTONOMOUS_SINCE:'2026-01-01T00:00:00.000Z'},db)!
  const customers=new CustomerRepository(db),at=new AtendimentoRepository(db)
  const owner=customers.save({kind:'entity',text:'Titular sintético',contacts:[{text:'+5531999990101'}]})
  const ficha=at.create({references:{person:[{id:owner.id,text:owner.text}],
   contact:[{id:customers.contacts(owner.id)[0]!.id,text:'+5531999990101'}],vehicle:[],payer:[]}})
  const abbreviated=event('future-short','553199990101@s.whatsapp.net')
  runtime.store.ingest(JSON.stringify(abbreviated))
  assert.equal(at.list().total,1)
  assert.equal(runtime.authority!.linkedHistoryJid(ficha.id,runtime.authority!.rememberProviderConversation(abbreviated.message.remoteJid)),
   abbreviated.message.remoteJid)
  assert.equal(runtime.authority!.canonicalChannelSendAllowed(abbreviated.message.remoteJid),false)
  assert.equal(db.prepare('SELECT count(*) n FROM v20_associations WHERE atendimento_id=? AND unlinked_at IS NULL').get(ficha.id)!.n,1)
  assert.equal(db.prepare('SELECT count(*) n FROM chat_confirmed_short_numbers').get()!.n,1)
  assert.equal(db.prepare('SELECT count(*) n FROM atendimento_contact_events WHERE atendimento_id=?').get(ficha.id)!.n,1)
 }finally{db.close()}
})

test('Atendimento references resolve equivalent phone through the explicitly selected owner without a Chat',()=>{
 const f=fixture()
 try{
  const owner=f.customers.save({kind:'entity',text:'Pessoa sintética'})
  const references={person:[{id:owner.id,text:owner.text}],contact:[{id:null,text:'(31) 99999-0987'}],vehicle:[],payer:[]}
  const first=f.at.create({references})
  const next=f.at.create({references:{...references,contact:[{id:null,text:'5531999990987'}]}})
  const contact=f.customers.contacts(owner.id)[0]!
  assert.equal(f.at.get(first.id,true).references!.contact[0]!.id,contact.id)
  assert.equal(f.at.get(next.id,true).references!.contact[0]!.id,contact.id)
  assert.equal(contact.conversationId,null)
  const other=f.customers.save({kind:'entity',text:'Outra pessoa'})
  assert.throws(()=>f.at.create({references:{...references,person:[{id:other.id,text:other.text}]}}),/titular/)
  assert.equal(f.at.list().total,2)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM v20_associations').get()!.n,0)
 }finally{f.db.close()}
})
