import {removeV25FixtureSchema} from './production.ts'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../../database.ts'
import {AtendimentoRepository} from '../../atendimentos.ts'
import {V20AssociationRepository} from '../../chat/v20-associations.ts'
import {createEvolutionChatBridge} from '../../chat/evolution-bridge.ts'
import {EvolutionReadPoc} from '../../experimental/evolution-read/client.ts'
import {loadConversationRuntime} from '../../chat/conversation-runtime.ts'

/** Entirely invented. Real normalizer, persistence and bridge; only provider transport is fake. */
export function conversationPhoneFixture(localRead=false){
 const db=openDatabase(':memory:'),at=new AtendimentoRepository(db),links=new V20AssociationRepository(db)
 removeV25FixtureSchema(db)
 const runtime=localRead?loadConversationRuntime({FUNIX_CHAT_LOCAL_ENABLED:'true',FUNIX_CHAT_LOCAL_READ_ENABLED:'true'},db):undefined
 let rows:Record<string,unknown>[]=[],offline=false,sends=0,historyCalls=0
 const provider=new EvolutionReadPoc({instance:'funix_comercial',instanceId:'synthetic-phone-instance',transport:async request=>{
  if(offline)throw Error('Synthetic offline provider')
  if(!request.path.includes('/findChats/')){historyCalls++;throw Error('No history request expected')}
  const start=Number(request.body.skip);return {status:200,body:rows.slice(start,start+Number(request.body.take))}
 }})
 const bridge=createEvolutionChatBridge(provider,Date.now,links,runtime?.authority,async()=>{sends++;return {messageId:'synthetic'}},undefined,runtime)
 function addChat(jid:string,name:string,alt?:string){
  const row:Record<string,unknown>={remoteJid:jid,pushName:name,unreadCount:1,updatedAt:'2026-01-01T00:00:00.000Z'}
  if(alt)row.lastMessage={instanceId:'synthetic-phone-instance',key:{remoteJid:jid,remoteJidAlt:alt,id:'synthetic-evidence'}}
  rows.push(row);return row
 }
 function addAt(phone:string,linkedContact=true){
  const record=at.create({name:'Ficha sintética',...(linkedContact?{}:{phone})})
  if(linkedContact){const id=randomUUID();db.prepare("INSERT INTO customer_records(id,kind,data,phone_normalized) VALUES(?,'contact',?,?)").run(id,JSON.stringify({text:phone}),phone);db.prepare("INSERT INTO atendimento_references VALUES(?,'contact',0,?,?)").run(record.id,id,JSON.stringify({id,text:phone}))}
  return record
 }
 function link(jid:string,atendimentoId:string){const cid=links.rememberConversation('funix_comercial',jid).conversationId,list=links.listActive(cid);return {cid,result:links.link({conversationId:cid,atendimentoId,expectedRevision:list.revision,requestId:randomUUID(),reason:'Explicit synthetic link'})}}
 return {db,at,links,runtime,bridge,provider,addChat,addAt,link,setRows:(next:Record<string,unknown>[])=>{rows=next},offline:()=>{offline=true},sideEffects:()=>({sends,historyCalls})}
}
