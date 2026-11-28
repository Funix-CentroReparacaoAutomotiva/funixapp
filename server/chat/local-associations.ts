import { recordConfirmedSalesContact } from '../erp/sales-events.ts'
import {atendimentoDisplayPhone} from './conversation-phones.ts'
import { randomUUID, createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { ConversationIdentities, type ConversationAssociationReader } from './conversation-identities.ts'
import {ServiceError} from '../errors.ts'
import {CustomerRepository,pendingShortNumber} from '../customers.ts'
import {normalizeCustomerPhone,normalizePhone} from '../phone.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { conversationNames, type NamePart, type CommercialConversation, type CustomerRecord } from '../../shared/customer.ts'
import type { ConversationEvent } from './conversation-event.ts'
import {hasTextualObservedNumber,reviewedNumber,reviewNumberPair,ShortNumberReview,textualNumberTargets} from './short-number-review.ts'

const instance = 'funix_comercial'
const historicalTriageReason = 'explicit_history_triage'
const shortNumberTriageReason = 'authenticated_short_number_triage'
/** Local commercial authority. Technical aliases remain owned by ConversationIdentities. */
export class LocalConversationAssociations extends ConversationIdentities implements ConversationAssociationReader {
  private readonly unifiedCustomers:boolean
  constructor(db: DatabaseSync, now = () => new Date().toISOString(), unifiedCustomers=false) { super(db, now);this.unifiedCustomers=unifiedCustomers }
  private members(jid: string) { return this.identityJids(jid) }
  private handles(jid: string): string[] {
    const members = this.members(jid)
    if (!members) return []
    const rows = this.db.prepare(`SELECT id,remote_jid FROM chat_provider_conversations WHERE instance=? AND remote_jid IN (${members.map(() => '?').join(',')})`).all(instance, ...members)
    for(const row of rows)this.db.prepare('INSERT OR IGNORE INTO v20_conversations(id,instance,remote_jid,created_at) VALUES(?,?,?,?)').run(row.id!,instance,row.remote_jid!,this.now())
    return [...new Set([this.rememberProviderConversation(jid), ...rows.map(r => String(r.id))])]
  }
  override rememberProviderConversation(jid: string): string {
    const id = super.rememberProviderConversation(jid)
    this.db.prepare('INSERT OR IGNORE INTO v20_conversations(id,instance,remote_jid,created_at) VALUES(?,?,?,?)').run(id, instance, this.providerJid(id)!, this.now())
    return id
  }
  links(jid: string) {
    const ids = this.handles(jid)
    if (!ids.length) return []
    return this.db.prepare(`SELECT l.*,a.stage,a.closed_at,a.updated_at FROM v20_associations l JOIN atendimentos a ON a.id=l.atendimento_id WHERE l.conversation_id IN (${ids.map(()=>'?').join(',')}) AND l.unlinked_at IS NULL ORDER BY l.linked_at,l.id`).all(...ids)
  }
  associationScope(conversationId:string) {
    const jid=this.providerJid(conversationId)
    if(!jid||!this.members(jid))throw new ServiceError(409,'CHAT_IDENTITY_CONFLICT','Identidade do canal precisa de revisão.')
    const ids=this.handles(jid)
    if(ids.some(id=>!this.db.prepare('SELECT 1 FROM v20_conversations WHERE id=?').get(id)))throw new ServiceError(409,'CHAT_CONTEXT_CONFLICT','Referências técnicas anteriores precisam de revisão; histórico preservado.')
    return ids
  }
  private contextHeld(jid:string) {
    const ids=this.handles(jid)
    return ids.length>0&&!!this.db.prepare(`SELECT 1 FROM chat_local_context_holds WHERE conversation_id IN (${ids.map(()=>'?').join(',')}) LIMIT 1`).get(...ids)
  }
  resolveIdentityActive(jid: string): string | null {
    if (!this.members(jid)||this.contextHeld(jid)) return null
    const links = this.links(jid)
    const handles=this.handles(jid)
    const selections=this.db.prepare(`SELECT link_id FROM v20_active_context WHERE conversation_id IN (${handles.map(()=>'?').join(',')})`).all(...handles)
    const chosen=[...new Set(selections.map(s=>links.find(l=>l.id===s.link_id)?.atendimento_id).filter((id):id is string=>typeof id==='string'))]
    if(chosen.length>1)return null
    if(chosen.length===1)return chosen[0]!
    // A cleared/revoked working context must never fall back to an implicit selection.
    if(this.db.prepare(`SELECT 1 FROM v20_conversations WHERE id IN (${handles.map(()=>'?').join(',')}) AND context_revision>0 LIMIT 1`).get(...handles))return null
    const open = links.filter(l=>!l.closed_at&&l.stage!=='rejeitados')
    const ids = [...new Set((open.length?open:links).map(l => String(l.atendimento_id)))]
    return ids.length === 1 ? ids[0]! : null
  }
  resolveActive(jid: string) { return this.resolveIdentityActive(jid) }

  /** Display-only number from the uniquely active Atendimento. Not PN/LID evidence. */
  linkedAtendimentoPhone(jid: string): string | null {
    const atendimentoId = this.resolveIdentityActive(jid)
    if (!atendimentoId) return null
    return atendimentoDisplayPhone(this.db,atendimentoId)
  }

  /** Explicit operator action, reads recipient from saved ficha; no browser-supplied JID and no send. */
  prepareConversation(at:string,index:number,revision:number) {
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const repository=new AtendimentoRepository(this.db),record=repository.get(at,true)
      if(record.revision!==revision)throw new ServiceError(409,'VERSION_CONFLICT','Salve e atualize o Atendimento antes de abrir a conversa.')
      if(!Number.isSafeInteger(index)||index<0||index>=100)throw new ServiceError(400,'INVALID_REFERENCE','Contato inválido.')
      const ref=record.references?.contact[index],phone=ref?normalizeCustomerPhone(ref.text):null
      const customers=new CustomerRepository(this.db)
      const knownContact=ref?.id?customers.record(ref.id):null
      const existingJid=knownContact?.conversationId?this.providerJid(knownContact.conversationId):null
      if(!ref||(!phone&&!existingJid))throw new ServiceError(400,'PHONE_COUNTRY_REQUIRED','Informe o telefone completo com DDD ou com + e DDI antes de abrir a conversa.')
      const jid=existingJid??phone!.slice(1)+'@s.whatsapp.net',members=this.members(jid)
      if(!members)throw new ServiceError(409,'CHAT_IDENTITY_CONFLICT','Identidade do canal precisa de revisão.')
      const links=this.links(jid),linked=links.find(l=>l.atendimento_id===at)
      const messages=this.db.prepare(`SELECT 1 FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE c.instance=? AND c.remote_jid IN (${members.map(()=>'?').join(',')}) LIMIT 1`).get(instance,...members)
      if(!linked&&(links.length||messages))throw new ServiceError(409,'CHAT_EXPLICIT_LINK_REQUIRED','Já existe histórico para este canal. Associe explicitamente pela lista de Conversas; editar o telefone não transfere histórico.')
      const matches=phone?customers.phoneMatches(phone):[]
      const matched=matches[0]??null
      if(matches.length>1||knownContact&&matched&&matched.id!==knownContact.id)
        throw new ServiceError(409,'CONTACT_PHONE_CONFLICT','Número com cadastro conflitante. Revise a associação antes de abrir a conversa.')
      if(!knownContact&&matched?.entityId&&!record.references?.person.some(person=>person.id===matched.entityId))
        throw new ServiceError(409,'CONTACT_OWNER_CONFLICT','Selecione o titular e o Contato cadastrados antes de abrir a conversa.')
      const selected=knownContact??matched
      const id=this.rememberProviderConversation(jid),linkId=linked?String(linked.id):randomUUID()
      const contact=customers.resolveChannelContact(id,selected?.id)
      if(!linked){this.db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)').run(linkId,id,at,this.now(),'operator','explicit_saved_contact');this.db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(id)}
      const scope=this.handles(jid),refs=record.references!
      refs.contact[index]={id:contact.id,text:contact.text}
      customers.saveReferences(at,refs)
      const placeholders=scope.map(()=>'?').join(',')
      this.db.prepare(`DELETE FROM v20_active_context WHERE conversation_id IN (${placeholders})`).run(...scope)
      this.db.prepare('INSERT INTO v20_active_context VALUES(?,?)').run(linked?linked.conversation_id!:id,linkId)
      this.db.prepare(`UPDATE v20_conversations SET context_revision=context_revision+1 WHERE id IN (${placeholders})`).run(...scope)
      this.db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(at)
      this.db.exec('COMMIT');return {conversationId:id}
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
  conversationsForAtendimento(at:string) {
    const rows=this.db.prepare('SELECT DISTINCT c.id,c.remote_jid FROM v20_associations l JOIN chat_provider_conversations c ON c.id=l.conversation_id WHERE l.atendimento_id=? AND l.unlinked_at IS NULL').all(at)
    const items=new Map<string,{conversationId:string;aliases:string[];phone:string|null;linkedHistory:boolean;blocked:boolean}>()
    for(const row of rows){
      const jid=String(row.remote_jid),members=this.members(jid)
      const blocked=!members||this.contextHeld(jid)
      const id=members?this.rememberProviderConversation(jid):String(row.id)
      const aliases=members?this.handles(jid):[id]
      items.set(id,{conversationId:id,aliases,
        phone:blocked?null:members?.find(member=>member.endsWith('@s.whatsapp.net'))?.split('@')[0]??null,
        linkedHistory:!blocked&&this.resolveIdentityActive(jid)!==at,blocked})
    }
    return [...items.values()]
  }
  technicalHistoryJid(conversationId:string) {
    const jid=this.providerJid(conversationId)
    if(!jid)return null
    const conflict=()=>new ServiceError(409,'CHAT_IDENTITY_CONFLICT','Identidade do canal em revisão. Consulte os vínculos antes de abrir o histórico.')
    const members=this.members(jid)
    if(!members)throw conflict()
    const ids=this.handles(jid),scope=ids.map(()=>'?').join(',')
    const holds=this.db.prepare(`SELECT reason FROM chat_local_context_holds
      WHERE conversation_id IN (${scope}) AND reason NOT IN ('legacy_cutover_context_review','confirmed_local_context_conflict','ambiguous_atendimento_candidates')`).all(...ids)
    const linkedContact=this.db.prepare(`SELECT 1 FROM customer_records c
      JOIN atendimento_references r ON r.record_id=c.id AND r.kind='contact'
      JOIN v20_associations a ON a.atendimento_id=r.atendimento_id AND a.unlinked_at IS NULL
      WHERE c.kind='contact' AND c.phone_normalized IS NULL AND c.entity_id IS NOT NULL
        AND c.conversation_id IN (${scope}) AND a.conversation_id IN (${scope})
        AND EXISTS(SELECT 1 FROM atendimento_references p WHERE p.atendimento_id=a.atendimento_id
          AND p.kind='person' AND p.record_id=c.entity_id) LIMIT 1`).get(...ids,...ids)
    if(holds.length&&(holds.some(hold=>hold.reason!=='autonomous_contact_conflict')||
      !linkedContact&&!new ShortNumberReview(this.db,()=>false).triageCandidate(conversationId)))throw conflict()
    const contacts=this.db.prepare(`SELECT id,phone_normalized,conversation_id FROM customer_records
      WHERE kind='contact' AND conversation_id IN (${scope})`).all(...ids)
    const pn=members.find(member=>member.endsWith('@s.whatsapp.net'))
    const phone=pn?normalizeCustomerPhone('+'+pn.split('@')[0]):null
    const registered=phone?new CustomerRepository(this.db).phoneMatches(phone):[]
    const contact=contacts[0]
    const review=typeof contact?.conversation_id==='string'?reviewedNumber(this.db,contact.conversation_id):null
    const reviewed=review?.active===1&&review.contact_id===contact?.id&&review.observed_phone==='+'+pn?.split('@')[0]&&
      review.registered_phone===contact?.phone_normalized
    if(contacts.length>1||registered.length>1||contact&&(
      contact.phone_normalized&&contact.phone_normalized!==phone&&!reviewed||
      registered.some(record=>record.id!==contact.id)
    ))throw conflict()
    return jid
  }
  linkedHistoryJid(atendimentoId:string,conversationId:string) {
    const jid=this.technicalHistoryJid(conversationId)
    if(!jid)return null
    return this.links(jid).some(link=>link.atendimento_id===atendimentoId)?jid:null
  }
  canonicalChannelSendAllowed(jid:string) {
    const members=this.members(jid)
    const pn=members?.find(member=>member.endsWith('@s.whatsapp.net'))
    const phone=pn?normalizeCustomerPhone('+'+pn.split('@')[0]):null
    if(!phone||this.contextHeld(jid))return false
    const scope=this.handles(jid)
    const contacts=this.db.prepare(`SELECT c.id,c.phone_normalized FROM customer_records c
      JOIN customer_records e ON e.id=c.entity_id AND e.kind='entity'
      WHERE c.kind='contact' AND c.conversation_id IN (${scope.map(()=>'?').join(',')})`).all(...scope)
    return contacts.length===1&&contacts[0]!.phone_normalized===phone&&
      new CustomerRepository(this.db).phoneMatches(phone).every(contact=>contact.id===contacts[0]!.id)
  }
  resolveIdentityJid(at: string): string | null {
    const rows = this.db.prepare('SELECT DISTINCT c.remote_jid FROM v20_associations l JOIN chat_provider_conversations c ON c.id=l.conversation_id WHERE l.atendimento_id=? AND l.unlinked_at IS NULL').all(at)
    const jids = [...new Set(rows.map(r=>String(r.remote_jid)).filter(j=>this.resolveIdentityActive(j)===at).map(j=>this.identityJids(j)?.[0]).filter((j):j is string=>!!j))]
    return jids.length===1 ? jids[0]! : null
  }
  identityState(jid: string): ReturnType<ConversationAssociationReader['identityState']> {
    if (!this.members(jid)) return 'identity_conflict'
    if(this.contextHeld(jid))return 'context_conflict'
    if (this.resolveIdentityActive(jid)) return 'linked'
    return this.links(jid).length ? 'context_conflict' : 'missing_confirmation'
  }
  contextToken(jid: string) {
    if (this.identityState(jid)!=='linked') return null
    return createHash('sha256').update(JSON.stringify([this.members(jid),this.resolveIdentityActive(jid),this.db.prepare('SELECT context_revision FROM v20_conversations WHERE id=?').get(this.rememberProviderConversation(jid))?.context_revision,this.links(jid).map(l=>[l.id,l.atendimento_id])])).digest('hex')
  }
  /** The same links, selections and revocations govern inbound and Contact sends. */
  interaction(jid:string) {
    const handles=this.handles(jid)
    if(!handles.length)return {blocked:true,at:null,closedAt:null,version:null}
    const scope=handles.map(()=>'?').join(',')
    const links=this.links(jid)
    const state=this.db.prepare(`SELECT c.id,c.context_revision,c.revision,s.link_id FROM v20_conversations c
      LEFT JOIN v20_active_context s ON s.conversation_id=c.id WHERE c.id IN (${scope}) ORDER BY c.id`).all(...handles)
    const selected=new Set(state.flatMap(row=>row.link_id?[String(row.link_id)]:[]))
    const chosen=links.filter(link=>selected.has(String(link.id)))
    const open=links.filter(link=>!link.closed_at&&link.stage!=='rejeitados')
    const eligible=selected.size?open.filter(link=>selected.has(String(link.id))):open
    const candidates=[...new Set(eligible.map(link=>String(link.atendimento_id)))]
    const revoked=(!selected.size&&state.some(row=>Number(row.context_revision)>0))||
      (selected.size>0&&chosen.length!==selected.size)||
      (!links.length&&this.db.prepare(`SELECT 1 FROM v20_associations WHERE conversation_id IN (${scope}) LIMIT 1`).get(...handles))
    const blocked=!!revoked||this.contextHeld(jid)||new Set(chosen.map(link=>link.atendimento_id)).size>1||
      candidates.length>1||(open.length>0&&candidates.length===0)
    const closedAt=links.filter(link=>link.closed_at||link.stage==='rejeitados')
      .map(link=>String(link.closed_at??link.updated_at)).sort().at(-1)??null
    const version=[state,links.map(link=>[link.id,link.atendimento_id,link.closed_at,link.stage==='rejeitados']),blocked]
    return {blocked,at:blocked?null:candidates[0]??null,closedAt,version}
  }

  private unlinkedAtendimentos(contact:CustomerRecord|null,phone:string|null,authenticatedInteraction=false) {
    const customers=new CustomerRepository(this.db)
    const owner=contact?.entityId&&!customers.channelOwnerIsProvisional(contact.entityId)?contact.entityId:null
    const rows=this.db.prepare(`SELECT a.id,a.name,a.vehicle,a.plate,a.closed_at,a.stage,a.updated_at,
      EXISTS(SELECT 1 FROM atendimento_references r WHERE r.atendimento_id=a.id AND r.kind='contact' AND r.record_id=?) AS exact_contact
      FROM atendimentos a WHERE exact_contact OR (? IS NOT NULL AND (
        EXISTS(SELECT 1 FROM atendimento_references r WHERE r.atendimento_id=a.id AND r.kind='contact'
          AND r.record_id IS NULL AND funix_customer_phone(json_extract(r.data,'$.text'))=?)
        OR (NOT EXISTS(SELECT 1 FROM atendimento_references r WHERE r.atendimento_id=a.id AND r.kind='contact')
          AND funix_customer_phone(a.phone)=?)
      )) ORDER BY a.created_at,a.id`).all(contact?.id??null,phone,phone,phone)
    const candidates:{id:string;name:string;vehicle:string;plate:string}[]=[]
    let textualName:string|null=null
    let conflict=false,closedAt:string|null=null
    for(const row of rows){
      if(row.closed_at||row.stage==='rejeitados'){
        const date=String(row.closed_at??row.updated_at)
        if(!closedAt||date>closedAt)closedAt=date
        continue
      }
      if(!row.exact_contact){
        const refs=customers.references(String(row.id))
        // A different referenced owner or Contact is not a safe match.
        if(refs.person.some(person=>person.id&&person.id!==owner)||
          refs.contact.some(ref=>ref.id&&ref.id!==contact?.id)){
          conflict=true
          continue
        }
        if(!owner){
          const person=refs.person[0],number=refs.contact[0]
          if(authenticatedInteraction&&!contact&&phone&&refs.person.length===1&&!person?.id&&person?.text.trim()&&
            refs.contact.length===1&&!number?.id&&number&&normalizeCustomerPhone(number.text)===phone){
            // Promote the ficha's own participant. Never look up another Entity by name.
            textualName=person.text.trim()
          }else conflict=true
        }
      }
      candidates.push({id:String(row.id),name:String(row.name),vehicle:String(row.vehicle),plate:String(row.plate)})
    }
    return {candidates,conflict,closedAt,textualName}
  }

  /** Suggestions are advisory. Only an operator's explicit V20 link writes a binding. */
  suggestAtendimentos(conversationId:string) {
    const jid=this.technicalHistoryJid(conversationId)
    if(!jid||this.links(jid).length)return undefined
    const members=this.members(jid)!
    const pn=members.find(member=>member.endsWith('@s.whatsapp.net'))
    const phone=pn?normalizeCustomerPhone('+'+pn.split('@')[0]):null
    if(!phone)return undefined
    const customers=new CustomerRepository(this.db)
    if(customers.hasUnindexedDialingContact(phone))
      return {candidates:[],conflict:true,canCreateTriage:false}
    const [contact]=customers.phoneMatches(phone)
    const pair=pn?reviewNumberPair(pn):null
    if(!contact&&pair&&new CustomerRepository(this.db).phoneMatches(pair.registeredPhone).length)
      return {candidates:[],conflict:false,canCreateTriage:false}
    const resolution=this.unlinkedAtendimentos(contact??null,phone)
    const canCreateTriage=this.unifiedCustomers&&!resolution.conflict&&resolution.candidates.length===0&&
      !this.interaction(jid).blocked&&!this.db.prepare(`SELECT 1 FROM chat_events
        WHERE instance=? AND CASE WHEN json_valid(payload) THEN
          json_extract(payload,'$.selfChat')=1 AND
          (json_extract(payload,'$.message.remoteJid') IN (${members.map(()=>'?').join(',')}) OR
            json_extract(payload,'$.message.remoteJidAlt') IN (${members.map(()=>'?').join(',')}))
        END LIMIT 1`).get(instance,...members,...members)
    return {...resolution,canCreateTriage}
  }

  createTriageFromHistory(conversationId:string,inTransaction=false) {
    if(!inTransaction)this.db.exec('BEGIN IMMEDIATE')
    else if(!this.db.isTransaction)throw Error('A recuperação exige transação ativa.')
    try{
      const jid=this.technicalHistoryJid(conversationId)
      if(!jid||!this.unifiedCustomers)throw new ServiceError(409,'CHAT_TRIAGE_UNAVAILABLE','Conversa indisponível para triagem.')
      const existing=this.links(jid)
      // A retry after a lost response can reopen the ficha created by this action.
      if(existing.length===1&&existing[0]!.link_reason===historicalTriageReason){
        if(!inTransaction)this.db.exec('COMMIT')
        return {atendimentoId:String(existing[0]!.atendimento_id),created:false}
      }
      const short=new ShortNumberReview(this.db,()=>false).triageCandidate(conversationId)
      if(existing.length||!short&&!this.suggestAtendimentos(conversationId)?.canCreateTriage)
        throw new ServiceError(409,'CHAT_TRIAGE_REVIEW_REQUIRED','Confira os vínculos e os Atendimentos existentes antes de criar uma triagem.')
      const members=this.members(jid)!
      const pn=members.find(member=>member.endsWith('@s.whatsapp.net'))!
      const phone='+'+pn.split('@')[0]
      if(!this.db.prepare(`SELECT 1 FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id
        WHERE c.instance=? AND c.remote_jid IN (${members.map(()=>'?').join(',')}) LIMIT 1`).get(instance,...members))
        throw new ServiceError(409,'CHAT_TRIAGE_HISTORY_REQUIRED','Carregue o histórico da conversa antes de criar uma triagem.')
      const id=this.rememberProviderConversation(jid)
      const customers=new CustomerRepository(this.db)
      const contact=short?customers.createUnnumberedChannelContact('',id,true).contact:customers.resolveChannelContact(id)
      const atendimentoId=this.ensureInteraction(jid,null,contact.id,short?'':phone,short?'':phone,historicalTriageReason,'operator')
      if(short){
        const handles=this.handles(jid)
        this.db.prepare(`DELETE FROM chat_local_context_holds WHERE conversation_id IN (${handles.map(()=>'?').join(',')})
          AND reason='autonomous_contact_conflict'`).run(...handles)
      }
      // An explicit link for reading must not imply selection for sending.
      this.db.prepare('UPDATE v20_conversations SET context_revision=context_revision+1 WHERE id=?').run(id)
      if(!inTransaction)this.db.exec('COMMIT')
      return {atendimentoId,created:true}
    }catch(error){if(!inTransaction)this.db.exec('ROLLBACK');throw error}
  }

  /** Caller owns the transaction. Add references without rewriting an existing ficha. */
  ensureInteraction(jid:string, at:string|null, contactId:string, phone:string, name:string, reason:string, actor='system') {
    const id=this.rememberProviderConversation(jid)
    const customers=new CustomerRepository(this.db)
    const assigned=customers.record(contactId)
    if(!assigned.conversationId||!this.handles(jid).includes(assigned.conversationId))
      throw new ServiceError(409,'CHAT_IDENTITY_CONFLICT','O Contato informado não pertence ao canal.')
    customers.resolveChannelContact(id,contactId,name)
    const previous=this.links(jid)
    const created=!at
    // Only the explicitly assigned Entity participates; provider names and phone text are not identity evidence.
    const owner=this.db.prepare(`SELECT e.id,e.data FROM customer_records c
      JOIN customer_records e ON e.id=c.entity_id AND e.kind='entity'
      WHERE c.id=? AND c.kind='contact'`).get(contactId)
    const ownerName=owner?String(JSON.parse(String(owner.data)).text??''):null
    at??=new AtendimentoRepository(this.db).create({phone,name:ownerName??name,purpose:'unclassified',...(this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='erp_experience_origin'").get()?{channel:'WhatsApp'}:{})},true).id
    let referencesChanged=false
    if(!previous.some(link=>link.atendimento_id===at)){
      const linkId=randomUUID()
      this.db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)')
        .run(linkId,id,at,this.now(),actor,reason)
      this.db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(id)
      // A previously selected closed interaction must not retain working context.
      if(created&&reason!==shortNumberTriageReason&&previous.some(link=>link.closed_at||link.stage==='rejeitados')){
        const handles=this.handles(jid),scope=handles.map(()=>'?').join(',')
        this.db.prepare(`DELETE FROM v20_active_context WHERE conversation_id IN (${scope})`).run(...handles)
        this.db.prepare(`UPDATE v20_conversations SET context_revision=context_revision+1 WHERE id IN (${scope})`).run(...handles)
        this.db.prepare('INSERT INTO v20_active_context VALUES(?,?)').run(id,linkId)
      }
    }
    if(!this.db.prepare("SELECT 1 FROM atendimento_references WHERE atendimento_id=? AND kind='contact' AND record_id=?").get(at,contactId)){
      const old=this.db.prepare('SELECT phone FROM atendimentos WHERE id=?').get(at)!
      const position=Number(this.db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM atendimento_references WHERE atendimento_id=? AND kind='contact'").get(at)!.n)
      const add=this.db.prepare("INSERT INTO atendimento_references(atendimento_id,kind,position,record_id,data) VALUES(?,'contact',?,?,?)")
      const keepPrevious=position===0&&!created&&old.phone&&String(old.phone)!==phone&&(!phone||normalizeCustomerPhone(String(old.phone))!==phone)
      if(keepPrevious)add.run(at,0,null,JSON.stringify({id:null,text:String(old.phone)}))
      add.run(at,keepPrevious?1:position,contactId,JSON.stringify({id:contactId,text:phone}))
      referencesChanged=true
    }
    if(owner&&(this.unifiedCustomers||!customers.channelOwnerIsProvisional(String(owner.id))||reason==='confirmed_contact_send')&&!this.db.prepare("SELECT 1 FROM atendimento_references WHERE atendimento_id=? AND kind='person' AND record_id=?").get(at,owner.id!)){
      const people=this.db.prepare("SELECT position,record_id,data FROM atendimento_references WHERE atendimento_id=? AND kind='person' ORDER BY position").all(at)
      const ref=JSON.stringify({id:String(owner.id),text:ownerName??''})
      const add=this.db.prepare("INSERT INTO atendimento_references(atendimento_id,kind,position,record_id,data) VALUES(?,'person',?,?,?)")
      // Do not overwrite existing people or infer that a free-text name denotes the same Entity.
      // A sole empty placeholder has no participant to preserve.
      if(people.length===1&&people[0]!.record_id===null&&!String(JSON.parse(String(people[0]!.data)).text??'').trim()){
        this.db.prepare("UPDATE atendimento_references SET record_id=?,data=? WHERE atendimento_id=? AND kind='person' AND position=?")
          .run(owner.id!,ref,at,people[0]!.position!)
      }else{
        const previousName=String(this.db.prepare('SELECT name FROM atendimentos WHERE id=?').get(at)!.name??'')
        const keepPrevious=!created&&!people.length&&!!previousName.trim()
        if(keepPrevious)add.run(at,0,null,JSON.stringify({id:null,text:previousName}))
        const position=people.length?Number(people.at(-1)!.position)+1:keepPrevious?1:0
        add.run(at,position,owner.id!,ref)
      }
      referencesChanged=true
    }
    if(customers.groupCanonicalParticipant(at,contactId,created&&this.unifiedCustomers))referencesChanged=true
    if(!created&&referencesChanged)this.db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(at)
    return at
  }

  /** Caller owns BEGIN IMMEDIATE covering event, message, snapshot and associations. */
  inbound(e: ConversationEvent, newMessage:boolean,allowOutgoingStart=false) {
    const jid=e.message.remoteJid, members=this.members(jid)
    if(e.type!=='message.upsert'||e.selfChat||!newMessage||!members||this.contextHeld(jid))return
    const plan=this.interaction(jid), id=this.rememberProviderConversation(jid)
    const timestamp=new Date(e.message.timestamp!*1000).toISOString()
    if(e.message.fromMe!==false&&(!allowOutgoingStart||plan.at)){
      if(plan.at&&this.canonicalChannelSendAllowed(jid)){
        this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(plan.at,id,e.message.messageId,timestamp)
        if(e.message.fromMe===true)recordConfirmedSalesContact(this.db,plan.at,e.message.messageId,timestamp)
      }
      return
    }
    const handles=this.handles(jid),scope=handles.map(()=>'?').join(',')
    const prior=this.db.prepare(`SELECT 1 FROM conversation_initialization WHERE conversation_id IN (${scope})`).get(...handles)
    const phone=members.find(j=>j.endsWith('@s.whatsapp.net'))?.split('@')[0]
    const initial={phone:phone?'+'+phone:'',name:e.message.fromMe?'':e.displayName??'',source:e.message.fromMe?'whatsapp_outbound':'whatsapp_inbound',eventId:e.eventId,identity:'channel_evidence_only'}
    let channels=this.db.prepare(`SELECT id FROM customer_records WHERE kind='contact' AND conversation_id IN (${scope})`).all(...handles)
    const customers=new CustomerRepository(this.db)
    const matches=initial.phone?customers.phoneMatches(initial.phone):[]
    const historicalDialingConflict=!!initial.phone&&customers.hasUnindexedDialingContact(initial.phone)
    if(!historicalDialingConflict&&!plan.blocked&&initial.phone&&e.message.remoteJidAlt&&channels.length===1&&matches.length===1&&channels[0]!.id!==matches[0]!.id){
      const alias=customers.record(String(channels[0]!.id))
      const origin=alias.conversationId?this.providerJid(alias.conversationId):null
      if(origin?.endsWith('@lid')&&customers.reconcileChannelAlias(alias,matches[0]!,initial.phone,handles))
        channels=[{id:matches[0]!.id}]
    }
    const known=channels.length===1?customers.record(String(channels[0]!.id)):matches.length===1?matches[0]!:null
    if(known?.conversationId&&reviewedNumber(this.db,known.conversationId))return
    const confirmedPhone=normalizePhone(initial.phone)
    const incompatible=!!known&&(!!known.conversationId&&!handles.includes(known.conversationId)||
      !!known.text&&!!confirmedPhone&&normalizeCustomerPhone(known.text)!==confirmedPhone)
    const pair=phone?reviewNumberPair(phone+'@s.whatsapp.net'):null
    const possibleReview=pair&&(customers.phoneMatches(pair.registeredPhone).length>0||
      textualNumberTargets(this.db,pair.registeredPhone).length>0||hasTextualObservedNumber(this.db,pair.observedPhone)||
      !!this.db.prepare('SELECT 1 FROM chat_provider_conversations WHERE instance=? AND remote_jid=?')
        .get(instance,pair.registeredPhone.slice(1)+'@s.whatsapp.net'))
    if(this.unifiedCustomers&&pair&&possibleReview&&!plan.at&&!plan.blocked){
      const candidate=new ShortNumberReview(this.db,()=>true).recoveryCandidate(id)
      if(candidate){
        const reason='Vínculo automático por correspondência única do número do canal com Contato cadastrado.'
        new ShortNumberReview(this.db,()=>true).confirm(id,candidate.atendimentoId,
          {token:candidate.token,requestId:randomUUID(),reason},true)
        this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)')
          .run(candidate.atendimentoId,id,e.message.messageId,timestamp)
        return
      }
    }
    const pending=known?.conversationId?pendingShortNumber(this.db,known.conversationId):null
    if(this.unifiedCustomers&&pair&&pending&&known){
      const previous=this.links(jid),open=previous.filter(link=>!link.closed_at&&link.stage!=='rejeitados')
      const latest=previous.reduce((last,link)=>String(link.closed_at??link.updated_at)>last?String(link.closed_at??link.updated_at):last,'')
      const at=open.length===1?String(open[0]!.atendimento_id):
        open.length===0&&previous.length>0&&!possibleReview&&timestamp>latest
          ?this.ensureInteraction(jid,null,known.id,'',initial.name,shortNumberTriageReason):null
      if(at)this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(at,id,e.message.messageId,timestamp)
      return
    }
    // A received channel can have one triage even without a valid civil phone.
    // A possible matching cadastro is enough to defer creation, never to link.
    if(this.unifiedCustomers&&pair&&!plan.at&&!plan.blocked&&channels.length===0&&matches.length===0&&!prior&&!possibleReview){
      const schema=this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='chat_confirmed_short_numbers'").get()
      if(schema){
        const {contact}=customers.createUnnumberedChannelContact(initial.name,id,true)
        const at=this.ensureInteraction(jid,null,contact.id,'',initial.name,shortNumberTriageReason)
        this.db.prepare('UPDATE v20_conversations SET context_revision=context_revision+1 WHERE id=?').run(id)
        this.db.prepare('INSERT INTO conversation_initialization VALUES(?,?,?,?,?,?)')
          .run(id,at,e.eventId,this.now(),JSON.stringify(initial),'created')
        this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(at,id,e.message.messageId,timestamp)
        return
      }
    }
    const contactConflict=historicalDialingConflict||possibleReview||!!initial.phone&&normalizeCustomerPhone(initial.phone)!==initial.phone||channels.length>1||matches.length>1||
      (channels.length===1&&matches.length===1&&channels[0]!.id!==matches[0]!.id)||
      incompatible
    // Keep the received message, but require explicit review before associating
    // or sending against a contradictory Contact in autonomous mode.
    if(contactConflict)
      this.db.prepare('INSERT OR IGNORE INTO chat_local_context_holds VALUES(?,?)').run(id,'autonomous_contact_conflict')
    const resolution=this.unifiedCustomers&&!plan.at&&!plan.blocked&&!contactConflict&&(known||confirmedPhone)
      ?this.unlinkedAtendimentos(known,confirmedPhone,true):undefined
    const ambiguous=!!resolution&&(resolution.conflict||resolution.candidates.length>1)
    if(ambiguous)this.db.prepare('INSERT OR IGNORE INTO chat_local_context_holds VALUES(?,?)').run(id,'ambiguous_atendimento_candidates')
    const target=plan.at??resolution?.candidates[0]?.id??null
    const blocked=plan.blocked||contactConflict||ambiguous
    const historical=!!(plan.closedAt&&timestamp<=plan.closedAt||!target&&resolution?.closedAt&&timestamp<=resolution.closedAt)
    let at:string|null=null
    if(!blocked&&!historical){
      let contactId=channels.length?String(channels[0]!.id):null
      // In the autonomous target model, the first real interaction produces one shared
      // Entity + Contact for a confirmed PN. The channel label is provisional, not ID proof.
      const owner=known?.entityId?customers.record(known.entityId):null
      const textualName=target?resolution?.textualName:null
      if(this.unifiedCustomers&&confirmedPhone&&(owner||textualName||!plan.at&&!prior)){
        const saved=customers.confirmChannelContact(owner,owner?.text||textualName||initial.name.trim()||confirmedPhone,known,confirmedPhone,id)
        contactId=saved.contact.id
        if(target&&textualName) customers.reconcileParticipant(target,customers.references(target),saved.person,saved.contact,0,0)
        this.db.prepare("UPDATE customer_records SET data=json_set(data,'$.channelState','response_received'),revision=revision+1 WHERE id=? AND COALESCE(json_extract(data,'$.channelState'),'')!='response_received'").run(contactId)
      }else if(this.unifiedCustomers&&!initial.phone&&!plan.at&&!prior&&!known){
        // LID-only first interaction: the same Entity and Contact survive until
        // authenticated PN evidence arrives. Never use the LID digits as a number.
        contactId=customers.createUnnumberedChannelContact(initial.name,id).contact.id
      // Compatibility path for previously separate registrations; no inferred owner.
      }else {
        contactId=customers.resolveChannelContact(id,known?.id,initial.name).id
        this.db.prepare("UPDATE customer_records SET data=json_set(data,'$.channelState','response_received'),revision=revision+1 WHERE id=? AND COALESCE(json_extract(data,'$.channelState'),'')!='response_received'").run(contactId)
      }
      at=this.ensureInteraction(jid,target,contactId,initial.phone,initial.name,e.message.fromMe?'authenticated_outbound':'authenticated_inbound')
      this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(at,id,e.message.messageId,timestamp)
      if(e.message.fromMe===true)recordConfirmedSalesContact(this.db,at,e.message.messageId,timestamp)
    }
    if(!prior)this.db.prepare('INSERT INTO conversation_initialization VALUES(?,?,?,?,?,?)')
      .run(id,at,e.eventId,this.now(),JSON.stringify(initial),at?(target?'reused':'created'):historical?'closed':'ambiguous')
  }
  projections(jids:string[]):Map<string,CommercialConversation & {unreadCount:number;lastMessageAt:string|null;phoneNumber:string|null}> {
    const result=new Map<string,CommercialConversation & {unreadCount:number;lastMessageAt:string|null;phoneNumber:string|null}>()
    if(!jids.length)return result
    const scopes=jids.map(jid=>({jid,members:this.members(jid),ids:this.handles(jid),id:this.rememberProviderConversation(jid)}))
    const ids=[...new Set(scopes.flatMap(s=>s.ids))]
    const placeholders=ids.map(()=>'?').join(',')
    const contacts=ids.length?this.db.prepare(`SELECT * FROM customer_records WHERE conversation_id IN (${placeholders}) ORDER BY rowid`).all(...ids):[]
    const links=ids.length?this.db.prepare(`SELECT l.conversation_id,l.atendimento_id,a.name,r.data,c.data AS record,c.kind,c.id AS record_id
      FROM v20_associations l JOIN atendimentos a ON a.id=l.atendimento_id
      LEFT JOIN atendimento_references r ON r.atendimento_id=a.id AND r.kind='person' AND r.position=0
      LEFT JOIN customer_records c ON c.id=r.record_id
      WHERE l.conversation_id IN (${placeholders}) AND l.unlinked_at IS NULL ORDER BY l.linked_at,l.id`).all(...ids):[]
    const pairs=scopes.flatMap(s=>(s.members??[]).map(jid=>[s.id,jid]))
    const messages=pairs.length?this.db.prepare(`WITH scope(handle,jid) AS (VALUES ${pairs.map(()=>'(?,?)').join(',')}), ranked AS (
      SELECT scope.handle,m.text,m.message_id,m.occurred_at,m.sequence,m.from_me,
        ROW_NUMBER() OVER(PARTITION BY scope.handle ORDER BY m.occurred_at DESC,m.sequence DESC) AS position
      FROM scope JOIN chat_conversations c ON c.remote_jid=scope.jid AND c.instance=? JOIN chat_messages m ON m.conversation_id=c.id)
      SELECT * FROM ranked WHERE position=1`).all(...pairs.flat(),instance):[]
    const readPairs=scopes.flatMap(s=>s.ids.map(id=>[s.id,id]))
    const unread=pairs.length?this.db.prepare(`WITH scope(handle,jid) AS (VALUES ${pairs.map(()=>'(?,?)').join(',')}), read_scope(handle,member_id) AS (VALUES ${readPairs.map(()=>'(?,?)').join(',')})
      SELECT scope.handle,COUNT(DISTINCT m.message_id) AS n FROM scope
      JOIN chat_conversations c ON c.remote_jid=scope.jid AND c.instance=? JOIN chat_messages m ON m.conversation_id=c.id
      WHERE m.from_me=0 AND NOT EXISTS(SELECT 1 FROM read_scope rs JOIN conversation_message_reads r ON r.conversation_id=rs.member_id WHERE rs.handle=scope.handle AND r.message_id=m.message_id)
      GROUP BY scope.handle`).all(...pairs.flat(),...readPairs.flat(),instance):[]
    for(const scope of scopes){
      const related=links.filter(l=>scope.ids.includes(String(l.conversation_id)))
      const people:NamePart[]=related.map(l=>{const r=l.record||l.data?JSON.parse(String(l.record??l.data)):null;return {name:r?String(r.text??''):String(l.name),entityId:l.kind==='entity'?String(l.record_id):null}})
      const canonical=contacts.find(c=>c.conversation_id===scope.id)
      const named=(c:typeof canonical)=>c&&String(JSON.parse(String(c.data)).nickname??'').trim()
      // Canonical nickname wins; otherwise retain the seller's exact-alias nickname and editable source.
      const contact=named(canonical)?canonical:contacts.find(c=>scope.ids.includes(String(c.conversation_id))&&named(c))??canonical,data=contact?JSON.parse(String(contact.data)):null
      const entity=scope.members&&contact?.entity_id?new CustomerRepository(this.db).record(String(contact.entity_id)):null
      const last=messages.find(m=>m.handle===scope.id)
      result.set(scope.jid,{phoneNumber:scope.members?.find(j=>j.endsWith('@s.whatsapp.net'))?.split('@')[0]??null,...(contact?{contactId:String(contact.id)}:{}),names:entity&&this.unifiedCustomers?[{name:entity.text,entityId:entity.id}]:conversationNames(data?.nickname??null,null,scope.members?people:[]),atendimentoCount:scope.members?new Set(related.map(l=>l.atendimento_id)).size:0,preview:last?(last.text?String(last.text):'Mídia ou mensagem indisponível'):null,profilePhoto:null,unreadCount:Number(unread.find(u=>u.handle===scope.id)?.n??0),lastMessageAt:last?String(last.occurred_at):null})
    }
    return result
  }
  projection(jid:string) {return this.projections([jid]).get(jid)!}
  recordAccepted(at:string,jid:string,messageId:string) {
    if(this.members(jid)&&this.links(jid).some(l=>l.atendimento_id===at)){
      const occurredAt=this.now()
      this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(at,this.rememberProviderConversation(jid),messageId,occurredAt)
      recordConfirmedSalesContact(this.db,at,messageId,occurredAt)
    }
  }
  markRead(jid:string, messages:string[]) {
    const id=this.rememberProviderConversation(jid)
    for(const mid of messages)this.db.prepare('INSERT OR IGNORE INTO conversation_message_reads VALUES(?,?)').run(id,mid)
  }
}
