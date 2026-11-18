import type {MediaGateway} from '../../chat/evolution-media.ts'
import {openDatabase} from '../../database.ts'
import {AtendimentoRepository} from '../../atendimentos.ts'
import {CustomerRepository} from '../../customers.ts'
import {EvolutionReadPoc} from '../../experimental/evolution-read/client.ts'
import {ContactChannels} from '../../chat/contact-channels.ts'
import {createEvolutionChatBridge} from '../../chat/evolution-bridge.ts'
import {V20AssociationRepository} from '../../chat/v20-associations.ts'
export function entityContactsFixture({unnamed=false}={}) {
 const db=openDatabase(':memory:'),customers=new CustomerRepository(db),at=new AtendimentoRepository(db),links=new V20AssociationRepository(db)
 let time=Date.UTC(2026,0,1),offline=false,sends=0
 const checks:string[]=[],reads:string[]=[],sent:string[]=[],mediaSent:string[]=[],answers=new Map<string,'available'|'unavailable'|'conflict'>(),histories=new Map<string,string>(),rows:string[]=[]
 const provider=new EvolutionReadPoc({instance:'funix_comercial',instanceId:'synthetic-entities',timeoutMs:100,transport:async r=>{
  if(offline)throw Error('synthetic offline')
  if(r.path.includes('/whatsappNumbers/')){const n=(r.body.numbers as string[])[0]!;checks.push(n);const state=answers.get(n)??'available';return {status:200,body:[{number:n,jid:(state==='conflict'?'5531999999999':n)+'@s.whatsapp.net',exists:state!=='unavailable'}]}}
  if(r.path.includes('/findChats/'))return {status:200,body:rows.map(jid=>({remoteJid:jid,pushName:unnamed?undefined:'Provisório sintético',unreadCount:0,updatedAt:null}))}
  const jid=((r.body.where as {key:{remoteJid:string}}).key.remoteJid);reads.push(jid)
  const text=histories.get(jid)
  return {status:200,body:{messages:{currentPage:Number(r.body.page),total:text?1:0,pages:text?1:0,records:text?[{id:'row-'+jid,key:{id:'msg-'+jid,remoteJid:jid,fromMe:false},instanceId:'synthetic-entities',messageTimestamp:1767225600,messageType:'conversation',message:{conversation:text},MessageUpdate:[]}]:[]}}}
 }})
 const sender=async(jid:string,_text:string)=>{sends++;sent.push(jid);return {messageId:'synthetic-send-'+sends}}
 const media:MediaGateway={send:async(jid)=>{mediaSent.push(jid);return {messageId:'synthetic-media-'+mediaSent.length}},get:async()=>({kind:'image',mimeType:'image/jpeg',base64:'/9j/AA=='})}
 const channels=new ContactChannels(db,provider,'synthetic-entities',sender,()=>time,media)
 const bridge=createEvolutionChatBridge(provider,()=>time,links,undefined,sender,undefined,undefined,undefined,channels)
 return {db,at,customers,links,channels,bridge,provider,checks,reads,sent,mediaSent,histories,rows,answers,setOffline:(v:boolean)=>{offline=v},advance:(ms:number)=>{time+=ms},sends:()=>sends}
}
