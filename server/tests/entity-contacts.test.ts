import {removeV25FixtureSchema} from './fixtures/production.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {entityContactsFixture} from './fixtures/entity-contacts.ts'
import {ContactChannels} from '../chat/contact-channels.ts'
import {createEvolutionChatBridge} from '../chat/evolution-bridge.ts'
import {EvolutionReadPoc} from '../experimental/evolution-read/client.ts'
import {createApp} from '../app.ts'
import {parseConversationMessages} from '../../src/chat/evolution-read-model.ts'
const phone1='+5531999990101',phone2='+5531999990202',jid=(p:string)=>p.slice(1)+'@s.whatsapp.net'
const code=(value:string)=>(e:unknown)=>(e as {code?:string}).code===value

test('standalone Contacts keep the verified handle and Entity name without commercial association services',async()=>{
 const f=entityContactsFixture();try{
  const entity=f.customers.save({kind:'entity',text:'Pessoa independente',contacts:[{text:phone1}]})
  const contact=(await f.channels.verifyEntity(entity.id)).contacts[0]!
  f.rows.push(jid(phone1))
  const bridge=createEvolutionChatBridge(f.provider,Date.now,undefined,undefined,undefined,undefined,undefined,undefined,f.channels)
  const row=(await bridge.list(0)).items[0]!
  assert.equal(row.conversationId,contact.conversationId)
  assert.deepEqual(row.commercial?.names,[{name:entity.text,entityId:entity.id}])
  assert.equal((await bridge.list(0)).items[0]!.conversationId,contact.conversationId)
  assert.equal(f.sends(),0)
 }finally{f.db.close()}
})

test('entity has multiple phones; availability/negative/pending retain all records and send nothing',async()=>{
 const f=entityContactsFixture();try{
  f.answers.set(phone2.slice(1),'unavailable')
  const entity=f.customers.save({kind:'entity',text:'Pessoa sintética',contacts:[{text:phone1},{text:phone2},{text:'31 9999'}]})
  const result=await f.channels.verifyEntity(entity.id)
  assert.deepEqual(result.contacts.map(c=>c.whatsapp.state),['available','unavailable','incomplete'])
  assert.equal(f.sends(),0);assert.equal(f.at.list().total,0);assert.equal(f.db.prepare('SELECT count(*) n FROM v20_associations').get()!.n,0)
  assert.equal(f.db.prepare('SELECT count(*) n FROM chat_messages').get()!.n,0)
  assert.equal(result.contacts[0]!.entityId,entity.id)
  const unavailable=result.contacts[1]!;assert.throws(()=>f.channels.context(unavailable.id),code('CONTACT_CHANNEL_CONFLICT'))
  f.setOffline(true);f.advance(8*86400_000)
  const pending=await f.channels.verifyEntity(entity.id)
  assert.equal(pending.contacts.length,3);assert.equal(pending.contacts[0]!.whatsapp.state,'pending');assert.equal(pending.contacts[1]!.whatsapp.state,'pending')
 }finally{f.db.close()}
})

test('two numbers of one person retain independent messages, UUIDs and commercial links; names update once',async()=>{
 const f=entityContactsFixture();try{
  const handle=f.channels.identities.rememberProviderConversation(jid(phone1))
  f.histories.set(jid(phone1),'Histórico A');f.histories.set(jid(phone2),'Histórico B');f.rows.push(jid(phone1),jid(phone2))
  const entity=f.customers.save({kind:'entity',text:'Nome único',contacts:[{text:phone1},{text:phone2}]})
  const result=await f.channels.verifyEntity(entity.id),[a,b]=result.contacts
  assert.equal(a!.conversationId,handle);assert.notEqual(a!.conversationId,b!.conversationId)
  for(const [contact,text]of [[a!,'Histórico A'],[b!,'Histórico B']] as const){const messages=await f.channels.messages(contact.id,contact.conversationId!,1);assert.equal(parseConversationMessages(messages,contact.conversationId!).items[0]!.text,text)}
  f.customers.save({text:'Nome atualizado',revision:entity.revision},entity.id)
  const list=await f.bridge.list(0);assert.deepEqual(list.items.map(r=>r.commercial?.names),Array(2).fill([{name:'Nome atualizado',entityId:entity.id}]))
  assert.equal(f.at.list().total,0);assert.equal(f.sends(),0)
  assert.equal(f.db.prepare('SELECT count(*) n FROM v20_associations').get()!.n,0)
 }finally{f.db.close()}
})

test('multiple responsible entities share registrations across Atendimentos without implicit conversation association',async()=>{
 const f=entityContactsFixture();try{
  const a=f.customers.save({kind:'entity',text:'Maria sintética',contacts:[{text:phone1}]}),b=f.customers.save({kind:'entity',text:'Pedro sintético',contacts:[{text:phone2}]})
  await f.channels.verifyEntity(a.id);await f.channels.verifyEntity(b.id)
  const references={person:[{id:a.id,text:a.text},{id:b.id,text:b.text}],contact:[],vehicle:[],payer:[]}
  const first=f.at.create({references}),second=f.at.create({references})
  assert.deepEqual(f.at.get(first.id,true).references?.person,f.at.get(second.id,true).references?.person)
  assert.equal(f.channels.entity(a.id).contacts[0]!.text,phone1)
  assert.equal(f.channels.entity(b.id).contacts[0]!.text,phone2)
  assert.equal(f.db.prepare('SELECT count(*) n FROM v20_associations').get()!.n,0)
 }finally{f.db.close()}
})

test('duplicate numbers and ownership transfer reject atomically; exact existing unowned Contact can be selected',()=>{
 const f=entityContactsFixture();try{
  const existing=f.customers.save({kind:'contact',text:phone1})
  assert.throws(()=>f.customers.save({kind:'entity',text:'Não deve persistir',contacts:[{text:phone1}]}),code('CONTACT_PHONE_CONFLICT'))
  assert.equal(f.customers.search('entity','').length,0)
  const a=f.customers.save({kind:'entity',text:'Pessoa A',contacts:[{id:existing.id,text:phone1,revision:existing.revision}]}),b=f.customers.save({kind:'entity',text:'Pessoa B'})
  const contact=f.customers.record(existing.id)
  assert.throws(()=>f.customers.save({kind:'entity',text:'Pessoa B alterada',revision:b.revision,contacts:[{id:contact.id,text:phone1,revision:contact.revision}]},b.id),code('CONTACT_OWNER_CONFLICT'))
  assert.throws(()=>f.customers.save({text:phone1,revision:contact.revision,entityId:b.id},contact.id),code('CONTACT_OWNER_CONFLICT'))
  assert.equal(f.customers.record(b.id).text,'Pessoa B');assert.equal(f.customers.record(existing.id).entityId,a.id)
  for(const text of ['+55 (31) 99999-0101','(31) 99999-0101','5531999990101']){
   assert.throws(()=>f.customers.save({kind:'contact',text}),code('CONTACT_PHONE_CONFLICT'))
   assert.deepEqual(f.customers.search('contact',text).map(record=>record.id),[existing.id])
  }
 }finally{f.db.close()}
})

test('checks coalesce across concurrent calls and cache/revalidate proportionally; instance change invalidates evidence',async()=>{
 const f=entityContactsFixture();try{
  const c=f.customers.save({kind:'contact',text:phone1})
  await Promise.all(Array.from({length:10},()=>f.channels.verify(c.id)));assert.equal(f.checks.length,1)
  await f.channels.verify(c.id);assert.equal(f.checks.length,1)
  const another=new ContactChannels(f.db,f.provider,'different-synthetic-instance')
  assert.equal(another.status(c.id).state,'pending')
  f.advance(7*86400_000+1);assert.equal(f.channels.status(c.id).state,'pending');await f.channels.verify(c.id);assert.equal(f.checks.length,2)
 }finally{f.db.close()}
})

test('provider number rewrite, LID-only reply, malformed/negative mismatch and conflict evidence cannot authorize Chat',async()=>{
 for(const answer of [{number:phone1.slice(1),jid:'opaque@lid',exists:true},{number:phone1.slice(1),jid:jid(phone2),exists:true},{number:phone1.slice(1),jid:jid(phone2),exists:false},{number:phone2.slice(1),jid:jid(phone1),exists:true},{number:phone1.slice(1),jid:jid(phone1),exists:'true'}]){
  const f=entityContactsFixture();try{
   const c=f.customers.save({kind:'contact',text:phone1}),provider=new EvolutionReadPoc({instance:'funix_comercial',instanceId:'synthetic',transport:async()=>({status:200,body:[answer]})}),channels=new ContactChannels(f.db,provider,'synthetic')
   assert.notEqual((await channels.verify(c.id)).state,'available');assert.equal(f.customers.record(c.id).conversationId,null);assert.throws(()=>channels.context(c.id),code('CONTACT_CHANNEL_CONFLICT'))
  }finally{f.db.close()}
 }
 const f=entityContactsFixture();try{
  const c=f.customers.save({kind:'contact',text:phone1});await f.channels.verify(c.id)
  f.channels.identities.rememberProviderAliases([{remoteJid:'conflict@lid',remoteJidAlt:jid(phone1)},{remoteJid:'conflict@lid',remoteJidAlt:jid(phone2)}])
  assert.equal(f.channels.status(c.id).state,'conflict');assert.throws(()=>f.channels.context(c.id),code('CONTACT_CHANNEL_CONFLICT'));assert.equal(f.sends(),0)
 }finally{f.db.close()}
})

test('confirmed exact PN/LID retrieves the established opaque handle; changing phone never moves its history',async()=>{
 const f=entityContactsFixture();try{
  const identities=f.channels.identities
  const cid=identities.rememberProviderConversation('known@lid')
  identities.rememberProviderAliases([{remoteJid:'known@lid',remoteJidAlt:jid(phone1)}]);f.histories.set('known@lid','Histórico do alias confirmado')
  const c=f.customers.save({kind:'contact',text:phone1});await f.channels.verify(c.id)
  assert.equal(f.channels.context(c.id).conversationId,cid)
  assert.equal((await f.channels.messages(c.id,cid,1)).items[0]!.text,'Histórico do alias confirmado')
  const latest=f.customers.record(c.id)
  assert.throws(()=>f.customers.save({text:phone2,revision:latest.revision},c.id),code('CONTACT_HISTORY_PROTECTED'))
  assert.equal(f.customers.record(c.id).text,phone1)
 }finally{f.db.close()}
})

test('contact sends use durable recipient-scoped idempotency and reject stale context/session and reserve the Atendimento before dispatch',async()=>{
 const f=entityContactsFixture();try{
  const c=f.customers.save({kind:'contact',text:phone1}),other=f.customers.save({kind:'contact',text:phone2});await f.channels.verify(c.id);await f.channels.verify(other.id)
  const context=f.channels.context(c.id),command={requestId:randomUUID(),contextToken:context.token}
  assert.equal(f.sends(),0)
  const checked=new ContactChannels(f.db,f.provider,'synthetic-entities',async()=>{
    assert.equal(f.at.list().total,1)
    assert.equal(f.at.list().items[0]!.purpose,'unclassified')
    assert.equal(f.links.listActive(context.conversationId).items.length,1)
    return {messageId:'confirmed'}
  },()=>Date.UTC(2026,0,1))
  const receipt=await checked.send(c.id,context.conversationId,'Mensagem sintética',command,()=>{})
  assert.deepEqual(await f.channels.send(c.id,context.conversationId,'Mensagem sintética',command,()=>{}),receipt);assert.equal(f.sends(),0)
  await assert.rejects(()=>f.channels.send(other.id,context.conversationId,'X',command,()=>{}),code('CONTACT_CHANNEL_CONFLICT'))
  await assert.rejects(()=>f.channels.send(c.id,context.conversationId,'X',{...command,requestId:randomUUID()},()=>{throw Error('session revoked')}),/session revoked/);assert.equal(f.sends(),0)
  const latest=f.customers.record(c.id);f.customers.save({text:latest.text,revision:latest.revision,nickname:'historical'},c.id)
  await assert.rejects(()=>f.channels.send(c.id,context.conversationId,'X',{...command,requestId:randomUUID()},()=>{}),code('CHAT_CONTEXT_CHANGED'))
  assert.equal(f.sends(),0)
 }finally{f.db.close()}
})

test('authenticated entity HTTP save persists before provider checks, gates writes and never accepts browser recipient',async()=>{
 const f=entityContactsFixture(),origin='http://localhost:5173',app=createApp({atendimentos:f.at,evolutionChat:f.bridge,v20Associations:f.links,origin,password:'synthetic-only',voiceProvider:null})
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(app.address()as {port:number}).port
 try{
  assert.equal((await fetch(base+'/api/customer-records?kind=entity')).status,401)
  const login=await fetch(base+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-only'})}),cookie=login.headers.get('set-cookie')!.split(';')[0]!
  const write=(path:string,body:unknown,customOrigin=origin)=>fetch(base+path,{method:'POST',headers:{Cookie:cookie,Origin:customOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)})
  const input={kind:'entity',text:'Pessoa HTTP',contacts:[{text:phone1},{text:phone2}]}
  assert.equal((await write('/api/customer-records',input,'https://wrong.invalid')).status,403)
  const response=await write('/api/customer-records',input);assert.equal(response.status,201)
  const saved=await response.json() as {id:string;contacts:{id:string;whatsapp:{state:string;conversationId:string}}[]}
  assert.equal(saved.contacts.length,2);assert(saved.contacts.every(c=>c.whatsapp.state==='available'))
  const c=saved.contacts[0]!,path='/api/customer-records/'+c.id
  assert.equal((await write(path+'/open-chat',{recipient:phone2})).status,400)
  const opened=await(await write(path+'/open-chat',{})).json()as {conversationId:string};assert.equal(opened.conversationId,c.whatsapp.conversationId)
  const messages=await fetch(base+path+'/chat/'+opened.conversationId+'/messages?page=1',{headers:{Cookie:cookie}});assert.equal(messages.status,200)
  assert.equal((await fetch(base+path+'/chat/'+opened.conversationId+'/messages?page=1&page=2',{headers:{Cookie:cookie}})).status,400)
  assert.equal(f.sends(),0);assert.equal(f.at.list().total,0)
  f.setOffline(true)
  const pending=await write('/api/customer-records',{kind:'entity',text:'Offline',contacts:[{text:'+5531999990303'}]});assert.equal(pending.status,201);assert.equal(((await pending.json())as typeof saved).contacts[0]!.whatsapp.state,'pending')
 }finally{await new Promise<void>(r=>app.close(()=>r()));f.db.close()}
})

test('duplicate legacy phone records remain intact and block new verification; late provider response cannot bind an edited contact',async()=>{
 const f=entityContactsFixture();try{
  removeV25FixtureSchema(f.db)
  const a=f.customers.save({kind:'contact',text:phone1}),id=randomUUID()
  f.db.prepare("INSERT INTO customer_records(id,kind,data) VALUES(?,'contact',?)").run(id,JSON.stringify({text:phone1}))
  assert.equal((await f.channels.verify(a.id)).state,'conflict');assert.equal(f.checks.length,0)
  assert.equal(f.db.prepare("SELECT count(*) n FROM customer_records WHERE kind='contact'").get()!.n,2)
  const c=f.customers.save({kind:'contact',text:phone2})
  let release!:(value:'available')=>void
  const channels=new ContactChannels(f.db,{checkNumber:()=>new Promise(r=>{release=r}),findMessages:f.provider.findMessages.bind(f.provider)},'synthetic',undefined,()=>Date.UTC(2026,0,1))
  const pending=channels.verify(c.id)
  f.customers.save({text:'+5531999990303',revision:c.revision},c.id);release('available')
  assert.equal((await pending).state,'pending');assert.equal(f.customers.record(c.id).conversationId,null)
 }finally{f.db.close()}
})

test('ambiguous evidence arriving with history revokes the contact read before any message is disclosed',async()=>{
 const f=entityContactsFixture();try{
  const c=f.customers.save({kind:'contact',text:phone1});await f.channels.verify(c.id);const context=f.channels.context(c.id)
  const channels=new ContactChannels(f.db,{checkNumber:f.provider.checkNumber.bind(f.provider),findMessages:async()=>{
   f.channels.identities.rememberProviderAliases([{remoteJid:'late@lid',remoteJidAlt:jid(phone1)},{remoteJid:'late@lid',remoteJidAlt:jid(phone2)}])
   return {items:[],currentPage:1,reportedTotal:0,reportedPages:0,nextPage:null,consistency:'offset-not-snapshot'}
  }},'synthetic-entities',undefined,()=>Date.UTC(2026,0,1))
  await assert.rejects(()=>channels.messages(c.id,context.conversationId,1),code('CONTACT_CHANNEL_CONFLICT'))
  assert.equal(f.db.prepare('SELECT count(*) n FROM chat_messages').get()!.n,0)
 }finally{f.db.close()}
})

test('uncertain contact send is never replayed and concurrent sends share the canonical PN ledger scope',async()=>{
 const f=entityContactsFixture();try{
  const c=f.customers.save({kind:'contact',text:phone1});await f.channels.verify(c.id)
  let calls=0,release!:(v:{messageId:string})=>void
  const channels=new ContactChannels(f.db,f.provider,'synthetic-entities',()=>{calls++;return new Promise(r=>{release=r})},()=>Date.UTC(2026,0,1)),context=channels.context(c.id),command={requestId:randomUUID(),contextToken:context.token}
  const first=channels.send(c.id,context.conversationId,'Sintético',command,()=>{})
  await assert.rejects(()=>channels.send(c.id,context.conversationId,'Outra',{...command,requestId:randomUUID()},()=>{}),code('CHAT_SEND_IN_PROGRESS'))
  release({messageId:'only-one'});await first;assert.equal(calls,1)
  const failing=new ContactChannels(f.db,f.provider,'synthetic-entities',async()=>{calls++;throw Error('provider timeout')},()=>Date.UTC(2026,0,1)),uncertain={requestId:randomUUID(),contextToken:failing.context(c.id).token}
  await assert.rejects(()=>failing.send(c.id,context.conversationId,'Falha',uncertain,()=>{}),/provider timeout/)
  await assert.rejects(()=>failing.send(c.id,context.conversationId,'Falha',uncertain,()=>{}),code('CHAT_SEND_UNCERTAIN'));assert.equal(calls,2)
 }finally{f.db.close()}
})

test('contact media reuses format/size guards, exact context and durable send ledger; identity change withholds retrieved bytes',async()=>{
 const f=entityContactsFixture();try{
  const c=f.customers.save({kind:'contact',text:phone1});await f.channels.verify(c.id)
  let reads=0,mediaSends=0,change=false
  const provider={checkNumber:f.provider.checkNumber.bind(f.provider),findMessages:f.provider.findMessages.bind(f.provider),findMediaEnvelope:async()=>({envelope:{key:{id:'media-synthetic',remoteJid:jid(phone1)}},kind:'image' as const,bytes:4})}
  const gateway={send:async(recipient:string)=>{assert.equal(recipient,jid(phone1));assert.equal(f.at.list().total,1);assert.equal(f.links.listActive(f.channels.context(c.id).conversationId).items.length,1);mediaSends++;return {messageId:'media-receipt'}},get:async()=>{reads++;if(change)f.channels.identities.rememberProviderAliases([{remoteJid:'media-conflict@lid',remoteJidAlt:jid(phone1)},{remoteJid:'media-conflict@lid',remoteJidAlt:jid(phone2)}]);return {kind:'image' as const,mimeType:'image/jpeg',base64:'/9j/AA=='}}}
  const channels=new ContactChannels(f.db,provider,'synthetic-entities',undefined,()=>Date.UTC(2026,0,1),gateway),context=channels.context(c.id),item={kind:'image' as const,mimeType:'image/jpeg',base64:'/9j/AA=='},command={requestId:randomUUID(),contextToken:context.token}
  const receipt=await channels.sendMedia(c.id,context.conversationId,item,command,()=>{});assert.deepEqual(await channels.sendMedia(c.id,context.conversationId,item,command,()=>{}),receipt);assert.equal(mediaSends,1)
  await assert.rejects(()=>channels.sendMedia(c.id,context.conversationId,{...item,base64:'invalid'}, {...command,requestId:randomUUID()},()=>{}),code('CHAT_MEDIA_INVALID'));assert.equal(mediaSends,1)
  assert.equal((await channels.readMedia(c.id,context.conversationId,'media-synthetic',1)).base64,item.base64)
  change=true;await assert.rejects(()=>channels.readMedia(c.id,context.conversationId,'media-synthetic',1),code('CONTACT_CHANNEL_CONFLICT'));assert.equal(reads,2)
 }finally{f.db.close()}
})

test('existing enabled local history remains authoritative for Contact reads even when Evolution is unavailable; opening never ingests or creates Atendimento',async()=>{
 const {loadConversationRuntime}=await import('../chat/conversation-runtime.ts'),f=entityContactsFixture();try{
  const local=loadConversationRuntime({FUNIX_CHAT_LOCAL_ENABLED:'true',FUNIX_CHAT_LOCAL_READ_ENABLED:'true'},f.db)!
  const c=f.customers.save({kind:'contact',text:phone1});await f.channels.verify(c.id)
  f.histories.set(jid(phone1),'Histórico já salvo')
  const page=await f.provider.findMessages(jid(phone1));local.store.observePage(jid(phone1),page.items,1)
  const before=f.db.prepare('SELECT * FROM chat_messages').all();f.setOffline(true)
  const channels=new ContactChannels(f.db,f.provider,'synthetic-entities',undefined,()=>Date.UTC(2026,0,1),undefined,local),context=channels.context(c.id)
  const result=await channels.messages(c.id,context.conversationId,1)
  assert.equal(result.source,'local');assert.equal(result.items[0]!.text,'Histórico já salvo')
  assert.equal(local.authority!.projection(jid(phone1)).unreadCount,0)
  assert.equal(channels.states(c.id,context.conversationId,[{messageId:result.items[0]!.messageId}]).items[0]!.text,'Histórico já salvo')
  assert.deepEqual(f.db.prepare('SELECT * FROM chat_messages').all(),before);assert.equal(f.at.list().total,0);assert.equal(f.db.prepare('SELECT count(*) n FROM v20_associations').get()!.n,0)
 }finally{f.db.close()}
})

test('explicit context resolves two active demands and two numbers can share one Atendimento without sharing history',async()=>{
 const f=entityContactsFixture()
 try{
  const entity=f.customers.save({kind:'entity',text:'Pessoa sintética',contacts:[{text:phone1},{text:phone2}]})
  const {contacts:[first,second]}=await f.channels.verifyEntity(entity.id)
  const [a,b]=[f.at.create({purpose:'non_commercial'}),f.at.create({purpose:'unclassified'})]
  const add=(conversationId:string,atendimentoId:string,expectedRevision:number)=>
   f.links.link({conversationId,atendimentoId,expectedRevision,requestId:randomUUID(),reason:'Seleção sintética'})
  const cid=first!.conversationId!,otherId=second!.conversationId!
  const selected=add(cid,a.id,0)
  add(cid,b.id,1)
  add(otherId,a.id,0)
  const command=(id:string)=>({requestId:randomUUID(),contextToken:f.channels.context(id).token})
  const blocked=command(first!.id)
  await assert.rejects(()=>f.channels.send(first!.id,cid,'Dúvida',blocked,()=>{}),code('CHAT_CONTEXT_CONFLICT'))
  assert.equal(f.sends(),0)
  assert.equal(f.db.prepare('SELECT count(*) n FROM chat_send_operations').get()!.n,0)
  f.links.selectAtendimento(cid,selected.linkId)
  await assert.rejects(()=>f.channels.send(first!.id,cid,'Dúvida',blocked,()=>{}),code('CHAT_CONTEXT_CHANGED'))
  await f.channels.send(first!.id,cid,'Dúvida',command(first!.id),()=>{})
  await f.channels.send(second!.id,otherId,'Resposta',command(second!.id),()=>{})
  assert.deepEqual(f.sent,[jid(phone1),jid(phone2)])
  assert.equal(f.at.list().total,2)
  assert.equal(f.at.get(a.id,true).references!.contact.length,2)
  assert.equal(f.at.get(b.id,true).references!.contact.some(contact=>contact.id||contact.text),false)
  assert.equal(f.links.listActive(cid).items.length,2)
  assert.equal(f.links.listActive(otherId).items[0]!.atendimentoId,a.id)
  assert.equal(f.db.prepare('SELECT count(*) n FROM chat_messages').get()!.n,0)
 }finally{f.db.close()}
})


test('confirmed contact send references the shared Entity; repeated and additional numbers preserve participants',async()=>{
 const f=entityContactsFixture();try{
  const a=f.customers.save({kind:'entity',text:'Pessoa A',contacts:[{text:phone1}]})
  const b=f.customers.save({kind:'entity',text:'Pessoa B',contacts:[{text:phone2}]})
  const first=(await f.channels.verifyEntity(a.id)).contacts[0]!
  const second=(await f.channels.verifyEntity(b.id)).contacts[0]!
  const send=(c:typeof first,text:string)=>f.channels.send(c.id,c.conversationId!,text,{requestId:randomUUID(),contextToken:f.channels.context(c.id).token},()=>{})
  await send(first,'Primeira interação')
  const at=f.at.list().items[0]!
  assert.deepEqual(f.at.get(at.id,true).references!.person,[{id:a.id,text:a.text}])
  f.customers.save({text:'Pessoa A atualizada',revision:a.revision},a.id)
  assert.equal(f.at.get(at.id,true).references!.person[0]!.text,'Pessoa A atualizada')
  await send(first,'Continuação')
  assert.equal(f.at.list().total,1)
  assert.equal(f.at.get(at.id,true).references!.person.length,1)
  f.links.link({conversationId:second.conversationId!,atendimentoId:at.id,expectedRevision:0,requestId:randomUUID(),reason:'Participação sintética'})
  await send(second,'Mesmo assunto')
  assert.deepEqual(f.at.get(at.id,true).references!.person,[{id:a.id,text:'Pessoa A atualizada'},{id:b.id,text:b.text}])
  await send(second,'Continuação do segundo número')
  assert.equal(f.at.get(at.id,true).references!.person.length,2)
  assert.equal(f.at.list().total,1)
 }finally{f.db.close()}
})
