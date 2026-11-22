import {createHash,randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {CustomerRepository} from '../customers.ts'
import {ServiceError} from '../errors.ts'
import {normalizeCustomerPhone} from '../phone.ts'
import {inputObject,transaction} from '../scenarios.ts'
import {ConversationIdentities} from './conversation-identities.ts'
import {V20AssociationRepository} from './v20-associations.ts'

const instance='funix_comercial'
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hash=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex')
const invalid=():never=>{throw new ServiceError(400,'CHAT_NUMBER_REVIEW_INVALID','Confira o Contato da ficha e informe o motivo da revisão.')}
const conflict=():never=>{throw new ServiceError(409,'CHAT_NUMBER_REVIEW_UNAVAILABLE','A conversa e o Contato não podem ser vinculados por esta revisão de numeração.')}
const compactPhone=(column:string)=>`replace(replace(replace(replace(replace(replace(${column},' ',''),'(',''),')',''),'.',''),'-',''),char(9),'')`
const textualForms=(phone:string)=>[phone,phone.slice(1),phone.slice(3)]

/** The shape can identify a review candidate. It is never identity evidence. */
export function reviewNumberPair(pn:string) {
  const parts=/^(55\d{2})([6-9]\d{7})@s\.whatsapp\.net$/.exec(pn)
  if(!parts)return null
  const observedPhone='+'+parts[1]+parts[2],registeredPhone='+'+parts[1]+'9'+parts[2]
  return normalizeCustomerPhone(registeredPhone)===registeredPhone?{observedPhone,registeredPhone}:null
}

export function reviewedNumber(db:DatabaseSync,conversationId:string) {
  if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='chat_confirmed_short_numbers' AND type='table'").get())return null
  return db.prepare(`SELECT s.contact_id,s.entity_id,s.observed_phone,s.registered_phone,s.conversation_id,
    EXISTS(SELECT 1 FROM v20_associations a JOIN customer_channel_contacts c USING(conversation_id)
      WHERE c.contact_id=s.contact_id AND a.atendimento_id=s.atendimento_id AND a.unlinked_at IS NULL) AS active
    FROM chat_confirmed_short_numbers s WHERE s.conversation_id=?`).get(conversationId)??null
}

export function textualNumberTargets(db:DatabaseSync,phone:string) {
  return db.prepare(`SELECT a.id FROM atendimentos a WHERE
    EXISTS(SELECT 1 FROM atendimento_references r WHERE r.atendimento_id=a.id AND r.kind='contact'
      AND r.record_id IS NULL AND funix_customer_phone(json_extract(r.data,'$.text'))=?)
    OR (NOT EXISTS(SELECT 1 FROM atendimento_references r WHERE r.atendimento_id=a.id AND r.kind='contact')
      AND funix_customer_phone(a.phone)=?)`).all(phone,phone).map(row=>String(row.id))
}

export function hasTextualObservedNumber(db:DatabaseSync,phone:string) {
  return !!db.prepare(`SELECT 1 FROM customer_records WHERE kind='contact'
    AND json_extract(data,'$.canonicalContactId') IS NULL AND ${compactPhone("json_extract(data,'$.text')")} IN (?,?,?) LIMIT 1`)
    .get(...textualForms(phone))
}

/** Explicit commercial linkage to an observed Chat. No technical alias or send permission. */
export class ShortNumberReview {
  private readonly db:DatabaseSync
  private readonly observed:(jid:string)=>boolean
  private readonly identities:ConversationIdentities
  private readonly customers:CustomerRepository
  private readonly associations:V20AssociationRepository

  constructor(db:DatabaseSync,observed:(jid:string)=>boolean) {
    this.db=db
    this.observed=observed
    this.identities=new ConversationIdentities(db)
    this.customers=new CustomerRepository(db)
    this.associations=new V20AssociationRepository(db)
  }

  private channel(conversationId:string) {
    const jid=this.identities.providerJid(conversationId)
    const members=jid?this.identities.identityJids(jid):null
    const pn=members?.find(value=>value.endsWith('@s.whatsapp.net'))
    const pair=pn?reviewNumberPair(pn):null
    if(!jid||!members||!pair||!this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='chat_confirmed_short_numbers'").get())return null
    const observed=members.some(member=>this.observed(member)||this.db.prepare(`SELECT 1 FROM chat_conversations c
      JOIN chat_messages m ON m.conversation_id=c.id WHERE c.instance=? AND c.remote_jid=? LIMIT 1`).get(instance,member))
    if(!observed)return null
    const marks=members.map(()=>'?').join(',')
    const contacts=this.db.prepare(`SELECT c.id FROM customer_records c JOIN chat_provider_conversations p ON p.id=c.conversation_id
      WHERE c.kind='contact' AND p.instance=? AND p.remote_jid IN (${marks}) LIMIT 2`).all(instance,...members)
    const links=this.db.prepare(`SELECT a.id AS link_id,a.atendimento_id,v.id AS conversation_id,
      EXISTS(SELECT 1 FROM chat_provider_conversations p WHERE p.id=v.id AND p.instance=v.instance AND p.remote_jid=v.remote_jid) AS readable
      FROM v20_associations a
      JOIN v20_conversations v ON v.id=a.conversation_id
      WHERE v.instance=? AND v.remote_jid IN (${marks}) AND a.unlinked_at IS NULL LIMIT 2`).all(instance,...members)
    const held=this.db.prepare(`SELECT 1 FROM chat_local_context_holds h JOIN chat_provider_conversations p ON p.id=h.conversation_id
      WHERE p.instance=? AND p.remote_jid IN (${marks}) AND h.reason NOT IN ('autonomous_contact_conflict','ambiguous_atendimento_candidates') LIMIT 1`).get(instance,...members)
    const selfChat=this.db.prepare(`SELECT 1 FROM chat_events WHERE instance=? AND CASE WHEN json_valid(payload) THEN
      json_extract(payload,'$.selfChat')=1 AND (json_extract(payload,'$.message.remoteJid') IN (${marks})
        OR json_extract(payload,'$.message.remoteJidAlt') IN (${marks})) END LIMIT 1`).get(instance,...members,...members)
    if(contacts.length>1||links.length>1||links[0]?.readable===0||!links.length&&contacts.length||held||selfChat||
      hasTextualObservedNumber(this.db,pair.observedPhone))return null
    const alreadyReviewed=this.db.prepare(`SELECT 1 FROM chat_confirmed_short_numbers s JOIN chat_provider_conversations p ON p.id=s.conversation_id
      WHERE p.instance=? AND p.remote_jid IN (${marks}) LIMIT 1`).get(instance,...members)
    if(alreadyReviewed)return null
    return {jid,members,boundContactId:contacts[0]?.id??null,link:links[0]??null,...pair}
  }

  available(conversationId:string) {
    const channel=this.channel(conversationId)
    if(!channel)return false
    if(channel.link){
      try{this.inspect(conversationId,String(channel.link.atendimento_id),channel);return true}
      catch(error){
        if(error instanceof ServiceError&&error.status===409)return false
        throw error
      }
    }
    return this.customers.phoneMatches(channel.registeredPhone).length===1||
      textualNumberTargets(this.db,channel.registeredPhone).length===1
  }

  triageCandidate(conversationId:string) {
    const channel=this.channel(conversationId)
    if(!channel||channel.link||this.customers.phoneMatches(channel.registeredPhone).length||
      textualNumberTargets(this.db,channel.registeredPhone).length)return null
    const registeredJid=channel.registeredPhone.slice(1)+'@s.whatsapp.net'
    if(this.db.prepare('SELECT 1 FROM chat_provider_conversations WHERE instance=? AND remote_jid=?').get(instance,registeredJid))return null
    return channel
  }

  private inspect(conversationId:string,atendimentoId:string,channel=this.channel(conversationId)) {
    if(!channel||channel.link&&channel.link.atendimento_id!==atendimentoId)return conflict()
    const at=this.db.prepare('SELECT revision FROM atendimentos WHERE id=?').get(atendimentoId)
    if(!at)throw new ServiceError(404,'CHAT_NOT_FOUND','Atendimento não encontrado.')
    const matches=this.customers.phoneMatches(channel.registeredPhone),refs=this.customers.references(atendimentoId)
    if(matches.length>1)return conflict()
    const contact=matches[0]??null
    const owner=contact?.entityId?this.customers.record(contact.entityId):null
    let legacyIndex=-1,legacyName=''
    if(contact){
      const alreadyBound=contact.conversationId?this.identities.providerJid(contact.conversationId):null
      if(!owner||contact.conversationId&&(!alreadyBound||!channel.members.includes(alreadyBound)||channel.boundContactId!==contact.id)||
        channel.boundContactId&&channel.boundContactId!==contact.id||this.customers.channelOwnerIsProvisional(owner.id)||
        !refs.contact.some(ref=>ref.id===contact.id)||!refs.person.some(ref=>ref.id===owner.id))return conflict()
    }else{
      if(channel.link)return conflict()
      const candidates=textualNumberTargets(this.db,channel.registeredPhone)
      const people=refs.person.filter(ref=>ref.id||ref.text.trim())
      const numbers=refs.contact.filter(ref=>ref.id||ref.text.trim())
      const [person]=people,[number]=numbers
      if(candidates.length!==1||candidates[0]!==atendimentoId||people.length!==1||numbers.length!==1||
        !person?.text.trim()||person.id||!number||number.id||normalizeCustomerPhone(number.text)!==channel.registeredPhone)return conflict()
      legacyIndex=refs.person.indexOf(person)
      legacyName=person.text.trim()
    }
    const forms=textualForms(channel.observedPhone)
    if(this.db.prepare(`SELECT 1 FROM atendimentos WHERE id<>? AND ${compactPhone('phone')} IN (?,?,?)
      UNION ALL SELECT 1 FROM atendimento_references WHERE atendimento_id<>? AND kind='contact' AND record_id IS NULL
        AND ${compactPhone("json_extract(data,'$.text')")} IN (?,?,?) LIMIT 1`).get(atendimentoId,...forms,atendimentoId,...forms))return conflict()
    const registeredJid=channel.registeredPhone.slice(1)+'@s.whatsapp.net'
    if(this.db.prepare(`SELECT 1 FROM chat_provider_conversations WHERE instance=? AND remote_jid=?`).get(instance,registeredJid))return conflict()
    const revision=this.associations.listActive(conversationId).revision
    const token=hash([conversationId,atendimentoId,at.revision,revision,channel,contact,owner,legacyIndex,legacyName])
    return {token,revision,contact,owner,entityName:owner?.text??legacyName,legacyIndex,channel,refs}
  }

  preview(conversationId:string,atendimentoId:string) {
    const {token,contact,entityName,channel}=this.inspect(conversationId,atendimentoId)
    return {token,contactId:contact?.id??null,entityName,registeredPhone:channel.registeredPhone,observedPhone:channel.observedPhone}
  }

  confirm(conversationId:string,atendimentoId:string,body:unknown) {
    const {token,requestId,reason}=inputObject(body,['token','requestId','reason'])
    if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token)||typeof requestId!=='string'||!uuid.test(requestId)||
      typeof reason!=='string'||!reason.trim()||reason.length>500)return invalid()
    const key=hash(['short_number_review',atendimentoId,token,reason.trim()])
    return transaction(this.db,()=>{
      const receipt=this.db.prepare('SELECT digest,result_json FROM v20_association_receipts WHERE conversation_id=? AND request_id=?').get(conversationId,requestId)
      if(receipt){
        if(receipt.digest!==key)return conflict()
        return JSON.parse(String(receipt.result_json)) as {linkId:string;revision:number}
      }
      const current=this.inspect(conversationId,atendimentoId)
      if(current.token!==token)return conflict()
      const handle=current.contact?.conversationId??this.identities.rememberProviderConversation(current.channel.jid)
      const now=new Date().toISOString(),existing=current.channel.link
      const linkId=existing?String(existing.link_id):randomUUID()
      const participant=current.contact&&current.owner?{contact:current.contact,person:current.owner}:
        this.customers.confirmChannelContact(null,current.entityName,null,current.channel.registeredPhone,null)
      if(!current.contact)this.customers.reconcileParticipant(atendimentoId,current.refs,participant.person,participant.contact,current.legacyIndex)
      this.db.prepare(`UPDATE customer_records SET conversation_id=?,revision=revision+1 WHERE id=? AND conversation_id IS NULL`).run(handle,participant.contact.id)
      this.db.prepare(`INSERT INTO chat_confirmed_short_numbers VALUES(?,?,?,?,?,?,?,?,?)`).run(handle,participant.contact.id,participant.person.id,
        atendimentoId,current.channel.observedPhone,current.channel.registeredPhone,requestId,now,reason.trim())
      if(!existing)this.db.prepare(`INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)`)
        .run(linkId,conversationId,atendimentoId,now,'operator',reason.trim())
      if(!this.db.prepare(`SELECT 1 FROM v20_associations a JOIN customer_channel_contacts c USING(conversation_id)
        WHERE a.id=? AND a.unlinked_at IS NULL AND c.contact_id=?`).get(linkId,participant.contact.id))return conflict()
      const marks=current.channel.members.map(()=>'?').join(',')
      this.db.prepare(`DELETE FROM chat_local_context_holds WHERE reason IN ('autonomous_contact_conflict','ambiguous_atendimento_candidates')
        AND conversation_id IN (SELECT id FROM chat_provider_conversations WHERE instance=? AND remote_jid IN (${marks}))`)
        .run(instance,...current.channel.members)
      this.db.prepare(`DELETE FROM v20_active_context WHERE conversation_id IN (
        SELECT id FROM v20_conversations WHERE instance=? AND remote_jid IN (${marks}))`).run(instance,...current.channel.members)
      this.db.prepare(`UPDATE v20_conversations SET context_revision=context_revision+1 WHERE instance=? AND remote_jid IN (${marks})`)
        .run(instance,...current.channel.members)
      this.db.prepare(`UPDATE v20_conversations SET revision=revision+1 WHERE id=?`).run(conversationId)
      const result={linkId,revision:current.revision+1}
      this.db.prepare('INSERT INTO v20_association_receipts VALUES(?,?,?,?)').run(conversationId,requestId,key,JSON.stringify(result))
      return result
    })
  }
}
