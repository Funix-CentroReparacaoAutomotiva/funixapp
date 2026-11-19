import {createHash} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {CustomerRepository} from '../customers.ts'
import {normalizeCustomerPhone as normalizePhone} from '../phone.ts'
import {ServiceError} from '../errors.ts'
import {inputObject,transaction} from '../scenarios.ts'
import {ConversationIdentities} from './conversation-identities.ts'

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const digest=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex')
const review=(message:string):never=>{throw new ServiceError(409,'CHAT_IDENTITY_REVIEW',message)}
const invalid=():never=>{throw new ServiceError(400,'CHAT_IDENTITY_INVALID','Confirme uma pessoa e o Atendimento correspondente.')}

/** An explicit confirmation reconciles one channel and at most one existing Atendimento. */
export class SharedConversationIdentity {
  private readonly db:DatabaseSync
  private readonly customers:CustomerRepository
  private readonly identities:ConversationIdentities
  private readonly observed:(jid:string)=>boolean

  constructor(db:DatabaseSync,observed:(jid:string)=>boolean){
    this.db=db
    this.observed=observed
    this.customers=new CustomerRepository(db)
    this.identities=new ConversationIdentities(db)
  }

  private inspect(conversationId:string) {
    const jid=this.identities.providerJid(conversationId)
    if(!jid)throw new ServiceError(404,'CHAT_NOT_FOUND','Conversa não encontrada.')
    const members=this.identities.identityJids(jid)
    const pn=members?.find(value=>value.endsWith('@s.whatsapp.net'))
    const observed=members?.some(member=>this.observed(member))||members?.some(member=>this.db.prepare(`SELECT 1
      FROM chat_conversations c JOIN chat_messages m ON m.conversation_id=c.id
      WHERE c.instance='funix_comercial' AND c.remote_jid=? LIMIT 1`).get(member))
    const exactPhone=pn?'+'+pn.split('@')[0]!:null
    const phone=observed?exactPhone:null
    const handles=members?this.db.prepare(`SELECT id FROM (
        SELECT id,instance,remote_jid FROM v20_conversations
        UNION SELECT id,instance,remote_jid FROM chat_provider_conversations
      ) WHERE instance='funix_comercial' AND remote_jid IN (${members.map(()=>'?').join(',')}) ORDER BY id`)
      .all(...members).map(row=>String(row.id)):[]
    const placeholders=handles.map(()=>'?').join(',')
    const channelContacts=handles.length?this.db.prepare(`SELECT id FROM customer_records WHERE kind='contact'
      AND conversation_id IN (${placeholders}) ORDER BY id`).all(...handles).map(row=>this.customers.record(String(row.id))):[]
    const phoneContacts=exactPhone?this.customers.phoneMatches(exactPhone):[]
    const matches=[...new Map([...channelContacts,...phoneContacts].map(contact=>[contact.id,contact])).values()]
    const contact=matches.length===1?matches[0]!:null
    const blocked=!members||matches.length>1||!!(contact?.conversationId&&!handles.includes(contact.conversationId))||
      !!(contact?.text&&normalizePhone(contact.text)!==exactPhone)
    const rows=handles.length?this.db.prepare(`SELECT DISTINCT l.atendimento_id,a.revision,a.name
      FROM v20_associations l JOIN atendimentos a ON a.id=l.atendimento_id
      WHERE l.unlinked_at IS NULL AND l.conversation_id IN (${placeholders}) ORDER BY l.atendimento_id`).all(...handles):[]
    const targets=rows.map(row=>{
      const id=String(row.atendimento_id)
      const refs=this.customers.references(id)
      return {id,name:refs.person.find(person=>person.text)?.text||String(row.name),revision:Number(row.revision),refs}
    })
    const owner=contact?.entityId?this.customers.record(contact.entityId):null
    const token=digest([conversationId,members,phone,handles,matches,targets,owner])
    return {jid,phone,blocked,contact,owner,targets,token,handles}
  }

  preview(conversationId:string) {
    const {phone,blocked,owner,contact,targets,token}=this.inspect(conversationId)
    return {
      phone,blocked,token,
      owner:owner&&!this.customers.canReplaceProvisionalOwner(owner.id)?{id:owner.id,text:owner.text,confirmed:!!contact?.conversationId}:null,
      targets:targets.map(({id,name,refs})=>({id,name,reconciled:!!(owner&&contact?.conversationId&&refs.person.some(person=>person.id===owner.id)&&refs.contact.some(ref=>ref.id===contact.id)),people:refs.person.flatMap((person,index)=>
        person.text?[{id:person.id,text:person.text,index}]:[])})),
    }
  }

  forAtendimento(conversationId:string,atendimentoId:string) {
    const {blocked,contact,owner,targets}=this.inspect(conversationId)
    if(blocked||!contact?.conversationId||!owner||!targets.some(target=>target.id===atendimentoId))return null
    return {name:owner.text,phone:normalizePhone(contact.text)??''}
  }

  confirm(conversationId:string,body:unknown) {
    const input=inputObject(body,['requestId','token','atendimentoId','entityId','name','legacyIndex'])
    const {requestId,token,atendimentoId,entityId,name,legacyIndex}=input
    if(typeof requestId!=='string'||!uuid.test(requestId)||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||
      (atendimentoId!==null&&(typeof atendimentoId!=='string'||!uuid.test(atendimentoId)))||
      (entityId!==null&&(typeof entityId!=='string'||!uuid.test(entityId)))||
      (entityId===null?(typeof name!=='string'||!name.trim()||name.length>250):name!==undefined)||
      (legacyIndex!==undefined&&(!Number.isInteger(legacyIndex)||Number(legacyIndex)<0||Number(legacyIndex)>=100)))return invalid()
    const key=digest(['shared_identity',token,atendimentoId,entityId,name,legacyIndex])
    return transaction(this.db,()=>{
      const receipt=this.db.prepare('SELECT digest,result_json FROM v20_association_receipts WHERE conversation_id=? AND request_id=?').get(conversationId,requestId)
      if(receipt){
        if(receipt.digest!==key)return review('Esta confirmação já foi usada com outros dados.')
        return JSON.parse(String(receipt.result_json)) as {entityId:string;contactId:string;atendimentoId:string|null}
      }
      const view=this.inspect(conversationId)
      if(view.token!==token)return review('A conversa ou a ficha mudou. Atualize os dados antes de confirmar.')
      if(!view.phone||view.blocked)return review('Número ou titularidade precisa de revisão.')
      const target=view.targets.find(row=>row.id===atendimentoId)
      if(view.targets.length?!target:atendimentoId!==null)return invalid()
      if(view.owner&&view.owner.id!==entityId&&!this.customers.canReplaceProvisionalOwner(view.owner.id))return review('Este telefone já pertence a outra pessoa. Titularidade preservada.')
      const entity=entityId?this.customers.record(entityId):null
      if(entity&&entity.kind!=='entity')return invalid()
      const label=entity?.text??String(name).trim()
      const legacy=target?.refs.person[Number(legacyIndex)]
      if(legacyIndex!==undefined&&(!legacy||legacy.id||legacy.text!==label))return review('O nome escolhido deve corresponder à pessoa informada na ficha.')
      const channel=this.identities.rememberProviderConversation(view.jid)
      const {person,contact}=this.customers.confirmChannelContact(entity,label,view.contact,view.phone,channel)
      this.customers.confirmChannelOwnerLabel(person.id)
      if(target)this.customers.reconcileParticipant(target.id,target.refs,person,contact,legacyIndex===undefined?undefined:Number(legacyIndex))
      if(view.handles.length){
        const placeholders=view.handles.map(()=>'?').join(',')
        const cleared=this.db.prepare(`DELETE FROM chat_local_context_holds WHERE reason='autonomous_contact_conflict'
          AND conversation_id IN (${placeholders})`).run(...view.handles)
        if(cleared.changes)this.db.prepare(`UPDATE v20_conversations SET context_revision=context_revision+1
          WHERE id IN (${placeholders})`).run(...view.handles)
      }
      const result={entityId:person.id,contactId:contact.id,atendimentoId:target?.id??null}
      this.db.prepare('INSERT INTO v20_association_receipts VALUES(?,?,?,?)').run(conversationId,requestId,key,JSON.stringify(result))
      return result
    })
  }
}
