import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {V20AssociationRepository} from '../chat/v20-associations.ts'
import {createEvolutionChatBridge} from '../chat/evolution-bridge.ts'
import {EvolutionReadPoc} from '../experimental/evolution-read/client.ts'
import {createApp} from '../app.ts'
import {parseConversationList} from '../../src/chat/evolution-read-model.ts'

const origin='http://localhost:5173',lid='phone-contract@lid',commercial='+5531999990404'
test('provider list with manual N:N links uses the same primary Contact phone as the Atendimento HTTP detail, without a channel authority',async()=>{
 const db=openDatabase(':memory:'),at=new AtendimentoRepository(db),links=new V20AssociationRepository(db)
 const record=at.create({name:'Ficha sintética'}),contactId=randomUUID()
 db.prepare("INSERT INTO customer_records(id,kind,data) VALUES(?,'contact',?)").run(contactId,JSON.stringify({text:commercial}))
 db.prepare("INSERT INTO atendimento_references VALUES(?,'contact',0,?,?)").run(record.id,contactId,JSON.stringify({id:contactId,text:commercial}))
 let historyCalls=0,sends=0
 const provider=new EvolutionReadPoc({instance:'funix_comercial',instanceId:'synthetic-phone-instance',transport:async request=>{
  assert.ok(request.path.includes('/findChats/'));return {status:200,body:[{remoteJid:lid,pushName:'Nome provisório sintético',unreadCount:0}]}
 }})
 const bridge=createEvolutionChatBridge({findChatsPage:provider.findChatsPage.bind(provider),findMessages:async()=>{historyCalls++;throw Error('No history request expected')}},Date.now,links,undefined,async()=>{sends++;return {messageId:'synthetic'}})
 const cid=(await bridge.list(0)).items[0]!.conversationId
 links.link({conversationId:cid,atendimentoId:record.id,expectedRevision:0,requestId:randomUUID(),reason:'Explicit synthetic link'})
 const before=db.prepare('SELECT * FROM v20_associations').all()
 const app=createApp({atendimentos:at,evolutionChat:bridge,v20Associations:links,origin,password:'synthetic-phone-password',voiceProvider:null})
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(app.address()as {port:number}).port
 try{
  const login=await fetch(base+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-phone-password'})}),cookie=login.headers.get('set-cookie')!.split(';')[0]!
  const detail=await(await fetch(base+'/api/atendimentos/'+record.id,{headers:{Cookie:cookie}})).json()as {phone:string;phoneNormalized:string}
  assert.equal(detail.phone,commercial);assert.equal(at.get(record.id).phoneNormalized,null)
  const response=await fetch(base+'/api/chat/conversations?skip=0',{headers:{Cookie:cookie}});assert.equal(response.status,200)
  const wire=await response.json(),parsed=parseConversationList(wire),row=parsed.items[0]!
  assert.equal(row.displayName,'Nome provisório sintético');assert.equal(parsed.source,'evolution')
  assert.equal(row.phoneNumber,null)
  assert.equal(row.atendimentoPhone,detail.phoneNormalized.slice(1))
  assert.equal(await bridge.activeAtendimentoForConversation(cid),null)
  assert.equal((await bridge.sendTextForAtendimento(record.id,cid,'Não enviar')).state,'invalid')
  assert.deepEqual(db.prepare('SELECT * FROM v20_associations').all(),before)
  assert.equal(sends,0);assert.equal(historyCalls,0)
 }finally{await new Promise<void>(r=>app.close(()=>r()));db.close()}
})

for(const localRead of [false,true])test(`phone provenance handles missing numbers, aliases, ambiguous links and conflicts (${localRead?'local':'provider'} list)`,async()=>{
 const {conversationPhoneFixture}=await import('./fixtures/conversation-phone-list.ts'),f=conversationPhoneFixture(localRead)
 try{
  const phone='+5531999990404',pn='5531999990505@s.whatsapp.net',one='one-phone@lid',none='no-phone@lid',many='many-phones@lid',missing='missing-phone@lid'
  const a=f.addAt(phone),b=f.addAt(phone),empty=f.addAt('')
  f.addChat(one,'Nome do canal');f.addChat(none,'Sem vínculo');f.addChat(many,'Duas fichas');f.addChat(missing,'Sem número')
  f.addChat('partial-phone@lid','Número parcial');f.link('partial-phone@lid',f.addAt('319999').id)
  const first=f.link(one,a.id);f.link(many,a.id);f.link(many,b.id);f.link(missing,empty.id)
  const recordsBefore=f.db.prepare('SELECT * FROM atendimentos ORDER BY id').all(),customersBefore=f.db.prepare('SELECT * FROM customer_records ORDER BY id').all()
  let list=await f.bridge.list(0)
  const row=(name:string)=>list.items.find(r=>r.displayName===name)!
  assert.equal(list.source,localRead?'local':'evolution')
  assert.equal(row('Nome do canal').atendimentoPhone,phone.slice(1));assert.equal(row('Nome do canal').phoneNumber,null)
  for(const name of ['Sem vínculo','Duas fichas','Sem número','Número parcial'])assert.equal(row(name).atendimentoPhone,null)
  // Even a selected work context cannot make two associated fichas unambiguous for this display fallback.
  const manyCid=f.links.rememberConversation('funix_comercial',many).conversationId,selected=f.links.listActive(manyCid).items[0]!
  f.links.selectAtendimento(manyCid,selected.linkId)
  list=await f.bridge.list(0);assert.equal(row('Duas fichas').atendimentoPhone,null)
  const associations=f.db.prepare('SELECT * FROM v20_associations ORDER BY id').all(),refs=f.db.prepare('SELECT * FROM atendimento_references ORDER BY atendimento_id,kind,position').all()
  f.setRows([{remoteJid:one,pushName:'Nome do canal',unreadCount:1,lastMessage:{instanceId:'synthetic-phone-instance',key:{remoteJid:one,remoteJidAlt:pn,id:'confirmed'}}}])
  list=await f.bridge.list(0)
  assert.equal(row('Nome do canal').phoneNumber,pn.split('@')[0]);assert.equal(row('Nome do canal').atendimentoPhone,phone.slice(1))
  assert.equal(row('Nome do canal').conversationId,first.cid)
  if(localRead){
   // Revoking authorization does not erase the separate, unambiguous commercial display.
   const scope=f.runtime!.authority!.associationScope(first.cid);f.links.selectAtendimento(first.cid,null,scope)
   list=await f.bridge.list(0);assert.equal(row('Nome do canal').atendimentoPhone,phone.slice(1))
   assert.equal(f.runtime!.authority!.contextToken(one),null)
  }
  assert.notEqual((await f.bridge.sendTextForAtendimento(a.id,first.cid,'Não enviar')).state,'accepted')
  f.offline()
  if(localRead){list=await f.bridge.list(0);assert.equal(list.providerUnavailable,true);assert.equal(row('Nome do canal').phoneNumber,pn.split('@')[0])}
  assert.deepEqual(f.db.prepare('SELECT * FROM v20_associations ORDER BY id').all(),associations)
  assert.deepEqual(f.db.prepare('SELECT * FROM atendimento_references ORDER BY atendimento_id,kind,position').all(),refs)
  assert.deepEqual(f.db.prepare('SELECT * FROM atendimentos ORDER BY id').all(),recordsBefore)
  assert.deepEqual(f.db.prepare('SELECT * FROM customer_records ORDER BY id').all(),customersBefore)
  assert.deepEqual(f.sideEffects(),{sends:0,historyCalls:0})
 }finally{f.db.close()}
})

test('provider-only PN/LID conflicts are durable across pages and never override a known ficha into a WhatsApp number',async()=>{
 const {conversationPhoneFixture}=await import('./fixtures/conversation-phone-list.ts'),f=conversationPhoneFixture()
 try{
  const lid='conflicting-phone@lid',pn='5531999990505@s.whatsapp.net',other='5531999990606@s.whatsapp.net',a=f.addAt('+5531999990404')
  f.addChat(lid,'Conflito sintético',pn);const link=f.link(lid,a.id)
  let list=await f.bridge.list(0);assert.equal(list.items[0]!.phoneNumber,pn.split('@')[0]);assert.equal(list.items[0]!.atendimentoPhone,'5531999990404')
  const before=f.db.prepare('SELECT * FROM v20_associations').all()
  f.setRows([...Array.from({length:50},(_,i)=>({remoteJid:'synthetic-filler-'+i+'@lid'})),{remoteJid:lid,pushName:'Conflito sintético',lastMessage:{instanceId:'synthetic-phone-instance',key:{remoteJid:lid,remoteJidAlt:other,id:'contradiction'}}}])
  list=await f.bridge.list(50);assert.equal(list.items[0]!.phoneNumber,null);assert.equal(list.items[0]!.atendimentoPhone,null)
  f.setRows([{remoteJid:pn,pushName:'PN em conflito'}]);list=await f.bridge.list(0)
  assert.equal(list.items[0]!.phoneNumber,null);assert.equal(list.items[0]!.atendimentoPhone,null)
  assert.equal(await f.bridge.activeAtendimentoForConversation(link.cid),null)
  assert.equal((await f.bridge.sendTextForAtendimento(a.id,link.cid,'Não enviar')).state,'invalid')
  assert.deepEqual(f.db.prepare('SELECT * FROM v20_associations').all(),before)
  assert.deepEqual(f.sideEffects(),{sends:0,historyCalls:0})
 }finally{f.db.close()}
})

test('divergent explicit N:N and canonical Atendimento mappings suppress commercial fallback without changing either mapping',async()=>{
 const {conversationPhoneFixture}=await import('./fixtures/conversation-phone-list.ts'),{createCodaEventSchema,CodaEventSyncRepository}=await import('../chat/coda-sync.ts'),f=conversationPhoneFixture()
 try{
  createCodaEventSchema(f.db);const authority=new CodaEventSyncRepository(f.db),jid='divergent-ficha@lid'
  const canonical=authority.sync({version:1,source:'coda',eventId:'synthetic-divergent',codaRowId:'i-synthetic-row',instance:'funix_comercial',remoteJid:jid,phoneE164:'+5531999990808',displayName:'Ficha canônica sintética',occurredAt:1794144000})
  const other=f.addAt('+5531999990707');f.addChat(jid,'Canal com divergência');f.link(jid,other.id)
  const bridge=createEvolutionChatBridge(f.provider,Date.now,f.links,authority),row=(await bridge.list(0)).items[0]!
  assert.equal(row.atendimentoId,canonical.atendimentoId);assert.equal(row.phoneNumber,null);assert.equal(row.atendimentoPhone,null)
  assert.equal(authority.resolveIdentityActive(jid),canonical.atendimentoId)
  assert.equal(f.links.listActive(f.links.rememberConversation('funix_comercial',jid).conversationId).items[0]!.atendimentoId,other.id)
 }finally{f.db.close()}
})

test('the installed bootstrap factory reaches the phone projection with local storage and legacy authority absent (offline transport)',()=>{
 const script=`
  import assert from 'node:assert/strict';
  import {conversationPhoneFixture} from './server/tests/fixtures/conversation-phone-list.ts';
  import {loadEvolutionChat} from './server/chat/evolution-config.ts';
  const f=conversationPhoneFixture();let requests=0;
  try {
   const jid='bootstrap-phone@lid',a=f.addAt('+5531999990404');f.link(jid,a.id);
   globalThis.fetch=async(url,options)=>{requests++;assert.equal(new URL(url).pathname,'/chat/findChats/funix_comercial');assert.equal(options.method,'POST');return new Response(JSON.stringify([{remoteJid:jid,pushName:'Canal bootstrap'}]),{status:200,headers:{'Content-Type':'application/json'}})};
   const bridge=loadEvolutionChat({FUNIX_EVOLUTION_READ_ENABLED:'true',FUNIX_EVOLUTION_READ_API_KEY:'synthetic-only',FUNIX_EVOLUTION_INSTANCE_ID:'synthetic-phone-instance'},f.links);
   const row=(await bridge.list(0)).items[0];assert.equal(row.atendimentoPhone,'5531999990404');assert.equal(row.phoneNumber,null);assert.equal(row.atendimentoId,undefined);assert.equal(requests,1);
   console.log(JSON.stringify({factory:true,phone:true,realNetworkCalls:0}));
  }finally{f.db.close()}
 `
 const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-'],{input:script,encoding:'utf8',stdio:['pipe','pipe','pipe']}))
 assert.deepEqual(result,{factory:true,phone:true,realNetworkCalls:0})
})
