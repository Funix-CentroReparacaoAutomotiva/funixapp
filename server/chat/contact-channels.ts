import type {ConversationRuntime} from './conversation-runtime.ts'
import {validateMedia,type MediaGateway,type MediaInput} from './evolution-media.ts'
import {createHash,randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {CustomerRepository,pendingShortNumber} from '../customers.ts'
import {normalizeCustomerPhone as normalizePhone} from '../phone.ts'
import {ServiceError} from '../errors.ts'
import {transaction} from '../scenarios.ts'
import {LocalConversationAssociations} from './local-associations.ts'
import type {CodaEventSyncRepository} from './coda-sync.ts'
import {SendOperations,type SendCommand} from './send-operations.ts'
import type {EvolutionReadPoc} from '../experimental/evolution-read/client.ts'
import type {EvolutionTextSender} from './evolution-send.ts'
import type {ContactAvailability,EntityRecord} from '../../shared/customer.ts'
import {reviewedNumber} from './short-number-review.ts'

const conflict=():never=>{throw new ServiceError(409,'CONTACT_CHANNEL_CONFLICT','Contato ou identidade mudou. Atualize o cadastro e verifique o WhatsApp novamente.')}
/** Read by verified Contact. Reserve the Atendimento only on confirmed dispatch. */
export class ContactChannels {
  readonly customers:CustomerRepository
  readonly identities:LocalConversationAssociations
  readonly sends:SendOperations
  private windowAt=0
  private attempts=0
  readonly db:DatabaseSync
  readonly provider:Pick<EvolutionReadPoc,'checkNumber'|'findMessages'> & Partial<Pick<EvolutionReadPoc,'findMediaEnvelope'>>
  readonly providerInstance:string
  readonly sender?:EvolutionTextSender
  readonly local?:ConversationRuntime
  private readonly legacy?:CodaEventSyncRepository
  readonly media?:MediaGateway
  readonly now:()=>number
  constructor(db:DatabaseSync,provider:Pick<EvolutionReadPoc,'checkNumber'|'findMessages'> & Partial<Pick<EvolutionReadPoc,'findMediaEnvelope'>>,
    providerInstance:string,sender?:EvolutionTextSender,now:()=>number=Date.now,media?:MediaGateway,local?:ConversationRuntime,legacy?:CodaEventSyncRepository) {
    this.legacy=legacy;this.local=local;this.media=media;this.db=db;this.provider=provider;this.providerInstance=providerInstance;this.sender=sender;this.now=now
    this.customers=new CustomerRepository(db);this.identities=local?.authority??new LocalConversationAssociations(db);this.sends=new SendOperations(db)
  }
  private contact(id:string) {
    const c=this.customers.record(id)
    if(c.kind!=='contact')throw new ServiceError(400,'INVALID_CONTACT','Selecione um Contato telefônico.')
    return c
  }
  private unique(id:string,phone:string) {
    const matches=this.customers.phoneMatches(phone)
    return matches.length===1&&matches[0]!.id===id
  }
  private technical(phone:string) {return this.identities.identityJids(phone.slice(1)+'@s.whatsapp.net')}
  status(id:string):ContactAvailability {
    const c=this.contact(id),phone=normalizePhone(c.text)
    const review=c.conversationId?reviewedNumber(this.db,c.conversationId):null
    if(review)return review.active===1?{state:'history_only',checkedAt:null,conversationId:c.conversationId??null}:
      {state:'conflict',checkedAt:null,conversationId:null}
    const pending=c.conversationId?pendingShortNumber(this.db,c.conversationId):null
    if(pending)return pending.active===1?{state:'history_only',checkedAt:null,conversationId:c.conversationId??null,
      observedPhone:'+'+String(pending.jid).split('@')[0]}:{state:'conflict',checkedAt:null,conversationId:null}
    if(!phone)return {state:'incomplete',checkedAt:null,conversationId:null}
    const check=this.db.prepare('SELECT * FROM contact_channel_checks WHERE contact_id=?').get(id)
    const checkedAt=check?.checked_at?new Date(Number(check.checked_at)).toISOString():null
    if(!this.unique(id,phone)||!this.technical(phone))return {state:'conflict',checkedAt,conversationId:null}
    if(!check||check.phone!==phone||check.provider_instance!==this.providerInstance||Number(check.next_check_at)<=this.now())return {state:'pending',checkedAt,conversationId:null}
    const state=check.state as ContactAvailability['state']
    return {state,checkedAt,conversationId:state==='available'&&check.conversation_id?String(check.conversation_id):null}
  }
  entity(id:string):EntityRecord {
    const entity=this.customers.record(id)
    return {...entity,contacts:this.customers.contacts(id).map(c=>({...c,whatsapp:this.status(c.id)}))}
  }
  async verify(id:string) {
    const c=this.contact(id),phone=normalizePhone(c.text)
    if(c.conversationId&&reviewedNumber(this.db,c.conversationId))return this.status(id)
    if(!phone||!this.unique(id,phone)||!this.technical(phone))return this.status(id)
    const lease=randomUUID(),time=this.now()
    const acquired=transaction(this.db,()=>{
      const old=this.db.prepare('SELECT * FROM contact_channel_checks WHERE contact_id=?').get(id)
      if(old&&old.phone===phone&&old.provider_instance===this.providerInstance&&Number(old.next_check_at)>time)return false
      // Global bounded rate + per-number durable lease/cache. No retry loop or background ingestion.
      if(time-this.windowAt>=60_000){this.windowAt=time;this.attempts=0}
      if(this.attempts>=60)return false
      this.attempts++
      this.db.prepare(`INSERT INTO contact_channel_checks VALUES(?,?,?,'pending',NULL,?,?,NULL)
        ON CONFLICT(contact_id) DO UPDATE SET phone=excluded.phone,provider_instance=excluded.provider_instance,state='pending',next_check_at=excluded.next_check_at,lease=excluded.lease,conversation_id=NULL`).run(id,phone,this.providerInstance,time+60_000,lease)
      return true
    })
    if(!acquired)return this.status(id)
    let state:'pending'|'available'|'unavailable'|'conflict'='pending'
    try{state=await this.provider.checkNumber(phone)}catch{/* Failure is pending, never a negative response. */}
    transaction(this.db,()=>{
      const current=this.contact(id),check=this.db.prepare('SELECT lease FROM contact_channel_checks WHERE contact_id=?').get(id)
      if(check?.lease!==lease)return
      if(current.revision!==c.revision||normalizePhone(current.text)!==phone){this.db.prepare("UPDATE contact_channel_checks SET state='pending',next_check_at=0,lease=NULL WHERE contact_id=?").run(id);return}
      let conversationId:string|null=null
      const members=this.technical(phone)
      if(!this.unique(id,phone)||!members)state='conflict'
      if(state==='available') {
        const jid=phone.slice(1)+'@s.whatsapp.net'
        // An existing different Contact on any exact alias is a conflict, not a merge.
        const owner=this.db.prepare(`SELECT c.id FROM customer_records c JOIN chat_provider_conversations p ON p.id=c.conversation_id WHERE p.instance='funix_comercial' AND p.remote_jid IN (${members!.map(()=>'?').join(',')}) AND c.id!=?`).get(...members!,id)
        const oldJid=current.conversationId?this.identities.providerJid(current.conversationId):null
        if(owner||(oldJid&&!members!.includes(oldJid)))state='conflict'
        else {
          conversationId=this.identities.rememberProviderConversation(jid)
          this.customers.resolveChannelContact(conversationId,id)
          // Preserve a pre-existing exact alias handle/UUID; no historical rewrites.
          conversationId=this.contact(id).conversationId??conversationId
        }
      }
      const ttl=state==='available'?7*86400_000:state==='unavailable'?86400_000:state==='conflict'?3600_000:60_000
      this.db.prepare('UPDATE contact_channel_checks SET state=?,checked_at=?,next_check_at=?,lease=NULL,conversation_id=? WHERE contact_id=? AND lease=?').run(state,this.now(),this.now()+ttl,conversationId,id,lease)
    })
    return this.status(id)
  }
  /** Called only after the entity transaction has committed. At most two provider requests concurrently. */
  async verifyEntity(id:string) {
    const contacts=this.customers.contacts(id)
    for(let i=0;i<contacts.length;i+=2){const results=await Promise.all(contacts.slice(i,i+2).map(c=>this.verify(c.id)));if(results.some(r=>r.state==='pending'))break}
    return this.entity(id)
  }
  presentation(conversationId:string) {
    const jid=this.identities.providerJid(conversationId),members=jid?this.identities.identityJids(jid):null
    if(!members)return null
    const rows=this.db.prepare(`SELECT c.id,c.entity_id,e.data FROM customer_records c JOIN customer_records e ON e.id=c.entity_id AND e.kind='entity' JOIN chat_provider_conversations p ON p.id=c.conversation_id WHERE p.instance='funix_comercial' AND p.remote_jid IN (${members.map(()=>'?').join(',')})`).all(...members)
    if(rows.length!==1)return null
    return {contactId:String(rows[0]!.id),names:[{name:String(JSON.parse(String(rows[0]!.data)).text),entityId:String(rows[0]!.entity_id)}]}
  }
  context(id:string,conversationId?:string) {
    const c=this.contact(id),status=this.status(id),phone=normalizePhone(c.text)
    if(status.state!=='available'||!status.conversationId||!phone||(conversationId&&status.conversationId!==conversationId))return conflict()
    const jid=this.identities.providerJid(status.conversationId),members=this.technical(phone)
    if(!jid||!members?.includes(jid))return conflict()
    const owners=this.db.prepare(`SELECT c.id FROM customer_records c JOIN chat_provider_conversations p ON p.id=c.conversation_id WHERE p.instance='funix_comercial' AND p.remote_jid IN (${members.map(()=>'?').join(',')})`).all(...members)
    if(owners.length!==1||owners[0]!.id!==id)return conflict()
    const check=this.db.prepare('SELECT checked_at FROM contact_channel_checks WHERE contact_id=?').get(id)!
    const identityToken=createHash('sha256').update(JSON.stringify([id,c.revision,c.entityId,status.conversationId,phone,members,this.providerInstance,check.checked_at])).digest('hex')
    const interaction=this.interaction(jid)
    const token=createHash('sha256').update(JSON.stringify([identityToken,interaction.version])).digest('hex')
    return {conversationId:status.conversationId,phone,jid,members,token,identityToken,interaction}
  }

  private interaction(jid:string) {
    const local=this.identities.interaction(jid)
    const legacyState=this.legacy?.identityState(jid)
    const legacyId=this.legacy?.resolveIdentityActive(jid)
    const legacyOpen=legacyId&&this.isOpen(legacyId)?legacyId:null
    const blocked=local.blocked||legacyState==='context_conflict'||legacyState==='identity_conflict'||
      !!(local.at&&legacyOpen&&local.at!==legacyOpen)
    return {at:local.at??legacyOpen,blocked,version:[local.version,this.legacy?.contextToken(jid),legacyOpen,blocked]}
  }

  allowsExistingSend(id:string,jid:string) {
    const plan=this.interaction(jid)
    return this.isOpen(id)&&!plan.blocked&&(!plan.at||plan.at===id)
  }

  private isOpen(id:string) {
    return !!this.db.prepare("SELECT 1 FROM atendimentos WHERE id=? AND closed_at IS NULL AND stage!='rejeitados'").get(id)
  }
  async messages(id:string,conversationId:string,page:number,cursor?:string) {
    const before=this.context(id,conversationId)
    if(this.local?.read&&this.local.store.page(before.jid,1).reportedTotal>0){
      const result=this.local.store.page(before.jid,page,cursor)
      if(this.context(id,conversationId).identityToken!==before.identityToken)return conflict()
      this.local.authority?.markRead(before.jid,result.items.map(m=>m.messageId))
      return {...result,conversationId,contextToken:this.context(id,conversationId).token,sendTextAvailable:!!this.sender,mediaSendAvailable:!!this.media,mediaReadAvailable:!!this.media&&!!this.provider.findMediaEnvelope,...this.local.store.health(before.jid)}
    }
    if(cursor)throw new ServiceError(400,'CHAT_INVALID_QUERY','Cursor indisponível nesta fonte.')
    const result=await this.provider.findMessages(before.members[0]!,{page})
    this.identities.rememberProviderAliases(result.items,false,'findMessages')
    if(this.context(id,conversationId).identityToken!==before.identityToken)return conflict()
    return {conversationId,contextToken:this.context(id,conversationId).token,sendTextAvailable:!!this.sender,mediaSendAvailable:!!this.media,mediaReadAvailable:!!this.media&&!!this.provider.findMediaEnvelope,
      items:result.items.map(({messageId,timestamp,fromMe,origin,kind,text,media,statuses})=>({messageId,timestamp,fromMe,origin,kind,text,media,statuses})),
      page:result.currentPage,nextPage:result.nextPage,reportedTotal:result.reportedTotal,reportedPages:result.reportedPages,
      consistency:'offset-not-snapshot',historyComplete:'unknown',source:'evolution'}
  }
  states(id:string,conversationId:string,messages:Array<{messageId:string;version?:string}>) {
    if(!this.local?.read)throw new ServiceError(404,'CHAT_STATES_UNAVAILABLE','Histórico local indisponível.')
    const before=this.context(id,conversationId),items=this.local.store.states(before.jid,messages)
    return {conversationId,items,page:1,nextPage:null,nextCursor:null,reportedTotal:items.length,reportedPages:items.length?1:0,source:'local',consistency:'local-keyset',historyComplete:'unknown'}
  }
  async send(id:string,conversationId:string,text:string,command:SendCommand,authorize:()=>void) {
    if(!this.sender)throw new ServiceError(503,'CHAT_SEND_DISABLED','Envio WhatsApp não habilitado.')
    if(typeof text!=='string'||!text.trim()||[...text].length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw new ServiceError(400,'CHAT_SEND_INVALID','Mensagem inválida.')
    return this.dispatch(id,conversationId,command,['text',text],authorize,recipient=>this.sender!(recipient,text))
  }
  async sendMedia(id:string,conversationId:string,item:MediaInput,command:SendCommand,authorize:()=>void) {
    if(!this.media)throw new ServiceError(503,'CHAT_MEDIA_DISABLED','Mídias não habilitadas.')
    try{validateMedia(item.kind,item.mimeType,item.base64)}catch{throw new ServiceError(400,'CHAT_MEDIA_INVALID','Formato ou tamanho inválido.')}
    if(item.caption!==undefined&&(typeof item.caption!=='string'||[...item.caption].length>1024||/[\u0000-\u001f\u007f]/.test(item.caption)))throw new ServiceError(400,'CHAT_MEDIA_INVALID','Legenda inválida.')
    return this.dispatch(id,conversationId,command,['media',item],authorize,recipient=>this.media!.send(recipient,item))
  }
  async readMedia(id:string,conversationId:string,messageId:string,page:number) {
    if(!this.media||!this.provider.findMediaEnvelope)throw new ServiceError(503,'CHAT_MEDIA_DISABLED','Mídias não habilitadas.')
    const before=this.context(id,conversationId)
    const localState=()=>{
      if(!this.local?.read)return 'provider'
      const message=this.local.store.states(before.jid,[{messageId}])[0]
      if(!message)return 'provider' // A provider-only history remains readable without importing it.
      return ['image','video','audio'].includes(message.kind)?JSON.stringify(message):null
    }
    const expected=localState()
    if(expected===null)throw new ServiceError(404,'CHAT_MEDIA_NOT_FOUND','Mídia não disponível.')
    const item=await this.provider.findMediaEnvelope(before.members[0]!,messageId,page)
    if(this.context(id,conversationId).identityToken!==before.identityToken)return conflict()
    if(!item)throw new ServiceError(404,'CHAT_MEDIA_NOT_FOUND','Mídia não encontrada nesta conversa.')
    const key=item.envelope.key as {remoteJid:string;remoteJidAlt?:string}
    this.identities.rememberProviderAliases([{remoteJid:key.remoteJid,remoteJidAlt:key.remoteJidAlt}],false,'findMessages')
    if(this.context(id,conversationId).identityToken!==before.identityToken)return conflict()
    if(item.bytes!==null&&item.bytes>12*1024*1024)throw new ServiceError(413,'CHAT_MEDIA_TOO_LARGE','Mídia acima de 12 MB.')
    const result=await this.media.get(item.envelope,item.kind)
    if(this.context(id,conversationId).identityToken!==before.identityToken||localState()!==expected)return conflict()
    return result
  }
  private async dispatch(id:string,conversationId:string,command:SendCommand,payload:unknown,authorize:()=>void,send:(recipient:string)=>Promise<{messageId:string}>) {
    const context=this.context(id,conversationId)
    const recipient=context.phone.slice(1)+'@s.whatsapp.net'
    authorize()
    let atendimentoId:string, preparedToken:string
    return this.sends.run(command,recipient,[context.identityToken,payload],async()=>{
      authorize()
      const prepared=this.context(id,conversationId)
      if(prepared.token!==preparedToken||prepared.interaction.at!==atendimentoId||prepared.interaction.blocked)
        throw new ServiceError(409,'CHAT_SEND_UNCERTAIN','O contexto mudou durante a operação. Confira o WhatsApp antes de tentar novamente.')
      const receipt=await send(recipient)
      this.identities.recordAccepted(atendimentoId,context.jid,receipt.messageId)
      return receipt
    },()=>{
      authorize()
      const current=this.context(id,conversationId)
      if(command.contextToken!==current.token){
        throw new ServiceError(409,'CHAT_CONTEXT_CHANGED','O Atendimento ou Contato mudou. Atualize o Chat antes de confirmar o envio.')
      }
      if(current.interaction.blocked)
        throw new ServiceError(409,'CHAT_CONTEXT_CONFLICT','Selecione o Atendimento em Detalhes da conversa antes de enviar.')
      const contact=this.contact(id)
      const name=contact.entityId?this.customers.record(contact.entityId).text:''
      atendimentoId=this.identities.ensureInteraction(current.jid,current.interaction.at,id,current.phone,name,'confirmed_contact_send')
      preparedToken=this.context(id,conversationId).token
    })
  }
}
