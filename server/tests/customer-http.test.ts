import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {loadConversationRuntime} from '../chat/conversation-runtime.ts'
import {V20AssociationRepository} from '../chat/v20-associations.ts'
import {createEvolutionChatBridge} from '../chat/evolution-bridge.ts'
import {createApp} from '../app.ts'
import {createProfilePhotoGateway} from '../chat/profile-photo.ts'

test('authenticated relay → unique ficha → operator-only list/history; customer writes require origin and known records',async()=>{
 const db=openDatabase(':memory:'),at=new AtendimentoRepository(db),local=loadConversationRuntime({FUNIX_CHAT_LOCAL_ENABLED:'true',FUNIX_CHAT_LOCAL_READ_ENABLED:'true'},db)!,links=new V20AssociationRepository(db),secret=Buffer.alloc(32,7),origin='http://localhost:5173'
 let sends=0
 const bridge=createEvolutionChatBridge({findChatsPage:async()=>{throw Error('synthetic offline')},findMessages:async()=>{throw Error('synthetic no network')}},Date.now,links,local.authority,async()=>{sends++;return {messageId:'synthetic-send'}},undefined,local)
 const {createCodaEventSchema,CodaEventSyncRepository}=await import('../chat/coda-sync.ts');createCodaEventSchema(db)
 const app=createApp({codaSync:{repo:new CodaEventSyncRepository(db),secret},atendimentos:at,origin,password:'synthetic-only-password',voiceProvider:null,conversationRuntime:local,evolutionChat:bridge,v20Associations:links,whatsappIngest:{enabled:true,config:{version:1,keys:[{keyId:'synthetic',secretBase64:secret.toString('base64'),instances:['funix_comercial']}]}}})
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(app.address()as {port:number}).port
 const raw=JSON.stringify({schemaVersion:2,instance:'funix_comercial',eventId:'http-synthetic-inbound',type:'message.upsert',occurredAt:'2026-01-01T00:00:00.000Z',displayName:'Maria',message:{remoteJid:'5531999990101@s.whatsapp.net',remoteJidAlt:null,messageId:'synthetic-inbound',timestamp:1767225600,fromMe:false,kind:'text',text:'Mensagem sintética',media:null}})
 const time=String(Math.floor(Date.now()/1000)),signature='sha256='+createHmac('sha256',secret).update('v1\nsynthetic\n'+time+'\n').update(raw).digest('hex'),headers={'Content-Type':'application/json','x-funix-key-id':'synthetic','x-funix-timestamp':time,'x-funix-signature':signature}
 try{
  const rejected=await fetch(base+'/api/integrations/whatsapp/events',{method:'POST',headers:{...headers,'x-funix-signature':'sha256='+'0'.repeat(64)},body:raw});assert.equal(rejected.status,401);assert.equal(at.list().total,0)
  const receipts=await Promise.all(Array.from({length:3},async()=>{const r=await fetch(base+'/api/integrations/whatsapp/events',{method:'POST',headers,body:raw});assert.equal(r.status,202);return r.json()}));assert.deepEqual(receipts[0],receipts[1]);assert.equal(at.list().total,1);assert.equal(sends,0)
  assert.equal((await fetch(base+'/api/integrations/coda/atendimentos',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404)
  assert.equal((await fetch(base+'/api/chat/conversations')).status,401)
  const login=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({password:'synthetic-only-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0]!
  const list=await(await fetch(base+'/api/chat/conversations?skip=0',{headers:{Cookie:cookie}})).json()as {items:{conversationId:string;unreadCount:number;commercial:{names:unknown[];contactId:string}}[]};assert.equal(list.items[0]!.unreadCount,1);assert.deepEqual(list.items[0]!.commercial.names,[{name:'Maria',entityId:null}])
  const cid=list.items[0]!.conversationId,id=at.list().items[0]!.id
  assert.equal((await fetch(base+`/api/atendimentos/${id}/evolution-conversations/${cid}/messages?page=1`,{headers:{Cookie:cookie}})).status,200)
  const after=await(await fetch(base+'/api/chat/conversations?skip=0',{headers:{Cookie:cookie}})).json()as typeof list;assert.equal(after.items[0]!.unreadCount,0)
  const contact='/api/customer-records/'+list.items[0]!.commercial.contactId
  assert.equal((await fetch(base+contact)).status,401)
  assert.equal((await fetch(base+contact,{method:'PATCH',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:'https://invalid.example'},body:'{}'})).status,403)
  const invalid=await fetch(base+'/api/atendimentos/'+id,{method:'PATCH',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:origin},body:JSON.stringify({revision:1,references:{person:[{id:'unknown',text:'Maria'}],contact:[],vehicle:[],payer:[]}})});assert.equal(invalid.status,404)
 }finally{await new Promise<void>(r=>app.close(()=>r()));db.close()}
})

test('profile photo bounds calls and caches present/absent capability without forwarding credentials to CDN',async()=>{
 let calls=0,time=0
 const gateway=createProfilePhotoGateway({origin:'http://synthetic.invalid',apiKey:'synthetic-key',instance:'synthetic',now:()=>time,fetcher:(async(input:URL|string,init?:RequestInit)=>{calls++;if(String(input).startsWith('http:')){assert.equal((init?.headers as Record<string,string>).apikey,'synthetic-key');return new Response(JSON.stringify({profilePictureUrl:'https://pps.whatsapp.net/synthetic.jpg'}))}assert.equal(init?.headers,undefined);return new Response(Buffer.from([255,216,255,0]),{headers:{'Content-Type':'image/jpeg'}})})as typeof fetch})
 assert.equal((await gateway('5531999990101'))?.mime,'image/jpeg');await gateway('5531999990101');assert.equal(calls,2)
 assert.equal(await gateway('lid-only'),null);assert.equal(calls,2)
 time=36000000;await gateway('5531999990101');assert.equal(calls,4)
 let absent=0;const unavailable=createProfilePhotoGateway({origin:'http://synthetic.invalid',apiKey:'synthetic-key',instance:'synthetic',fetcher:(async()=>{absent++;return new Response('{}',{status:404})})as typeof fetch});assert.equal(await unavailable('5531999990101'),null);assert.equal(await unavailable('5531999990101'),null);assert.equal(absent,1)
})

test('new authenticated V1 inbound uses the same autonomous policy; replay keeps receipt and existing V1 receipts are not reprocessed',async()=>{
 const {ChatRepository}=await import('../chat/repository.ts'),db=openDatabase(':memory:'),at=new AtendimentoRepository(db),local=loadConversationRuntime({FUNIX_CHAT_LOCAL_ENABLED:'true'},db)!,secret=Buffer.alloc(32,8)
 const app=createApp({atendimentos:at,voiceProvider:null,conversationRuntime:local,whatsappIngest:{enabled:true,config:{version:1,keys:[{keyId:'v1',secretBase64:secret.toString('base64'),instances:['funix_comercial']}]}}})
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(app.address()as {port:number}).port
 const value=(eventId:string,number:string)=>({schemaVersion:1,instance:'funix_comercial',eventId,type:'message.upsert',occurredAt:'2026-01-01T00:00:00.000Z',message:{remoteJid:number+'@s.whatsapp.net',messageId:eventId,fromMe:false,origin:'unknown',kind:'text',text:'Sintético V1',media:null}})
 async function post(value:unknown){const raw=JSON.stringify(value),time=String(Math.floor(Date.now()/1000)),signature='sha256='+createHmac('sha256',secret).update('v1\nv1\n'+time+'\n').update(raw).digest('hex');const r=await fetch(base+'/api/integrations/whatsapp/events',{method:'POST',headers:{'Content-Type':'application/json','x-funix-key-id':'v1','x-funix-timestamp':time,'x-funix-signature':signature},body:raw});assert.equal(r.status,202);return r.json()}
 try{
  const v1=value('new-v1','5531999990202'),first=await post(v1);assert.deepEqual(await post(v1),first);assert.equal(at.list().total,1)
  await post(value('second-v1','5531999990202'));assert.equal(at.list().total,1)
  const historic=value('historic-v1','5531999990303'),receipt=new ChatRepository(db).ingest(JSON.stringify(historic));assert.deepEqual(await post(historic),{receiptId:receipt.receiptId,state:receipt.state,disposition:receipt.disposition});assert.equal(at.list().total,1)
 }finally{await new Promise<void>(r=>app.close(()=>r()));db.close()}
})
