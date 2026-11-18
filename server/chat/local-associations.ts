import {atendimentoDisplayPhone} from './conversation-phones.ts'
import { randomUUID, createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { ConversationIdentities, type ConversationAssociationReader } from './conversation-identities.ts'
import {ServiceError} from '../errors.ts'
import {CustomerRepository} from '../customers.ts'
import {normalizePhone} from '../atendimentos.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { conversationNames, type NamePart, type CommercialConversation } from '../../shared/customer.ts'
import type { ConversationEvent } from './conversation-event.ts'

const instance = 'funix_comercial'
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
      const ref=record.references?.contact[index],phone=ref?normalizePhone(ref.text):null
      const knownContact=ref?.id?new CustomerRepository(this.db).record(ref.id):null
      const existingJid=knownContact?.conversationId?this.providerJid(knownContact.conversationId):null
      if(!ref||(!phone&&!existingJid))throw new ServiceError(400,'PHONE_COUNTRY_REQUIRED','Informe o telefone completo com + e DDI antes de abrir a conversa.')
      const jid=existingJid??phone!.slice(1)+'@s.whatsapp.net',members=this.members(jid)
      if(!members)throw new ServiceError(409,'CHAT_IDENTITY_CONFLICT','Identidade do canal precisa de revisão.')
      const links=this.links(jid),linked=links.find(l=>l.atendimento_id===at)
      const messages=this.db.prepare(`SELECT 1 FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE c.instance=? AND c.remote_jid IN (${members.map(()=>'?').join(',')}) LIMIT 1`).get(instance,...members)
      if(!linked&&(links.length||messages))throw new ServiceError(409,'CHAT_EXPLICIT_LINK_REQUIRED','Já existe histórico para este canal. Associe explicitamente pela lista de Conversas; editar o telefone não transfere histórico.')
      const id=this.rememberProviderConversation(jid),linkId=linked?String(linked.id):randomUUID()
      if(!linked){this.db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)').run(linkId,id,at,this.now(),'operator','explicit_saved_contact');this.db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(id)}
      const known=this.db.prepare('SELECT id FROM customer_records WHERE conversation_id=?').get(id),contactId=known?String(known.id):ref.id??randomUUID()
      if(!known){if(ref.id)this.db.prepare('UPDATE customer_records SET conversation_id=?,revision=revision+1 WHERE id=? AND conversation_id IS NULL').run(id,ref.id);else this.db.prepare("INSERT INTO customer_records(id,kind,data,conversation_id) VALUES(?,'contact',?,?)").run(contactId,JSON.stringify({text:phone,channelState:'informed'}),id)}
      const refs=record.references!;refs.contact[index]={id:contactId,text:phone??ref.text};new CustomerRepository(this.db).saveReferences(at,refs)
      const scope=this.handles(jid),placeholders=scope.map(()=>'?').join(',')
      this.db.prepare(`DELETE FROM v20_active_context WHERE conversation_id IN (${placeholders})`).run(...scope)
      this.db.prepare('INSERT INTO v20_active_context VALUES(?,?)').run(linked?linked.conversation_id!:id,linkId)
      this.db.prepare(`UPDATE v20_conversations SET context_revision=context_revision+1 WHERE id IN (${placeholders})`).run(...scope)
      this.db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(at)
      this.db.exec('COMMIT');return {conversationId:id}
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
  conversationsForAtendimento(at:string) {
    const rows=this.db.prepare('SELECT DISTINCT c.id,c.remote_jid FROM v20_associations l JOIN chat_provider_conversations c ON c.id=l.conversation_id WHERE l.atendimento_id=? AND l.unlinked_at IS NULL').all(at)
    return rows.filter(r=>!!this.members(String(r.remote_jid))).map(r=>({conversationId:String(r.id),phone:this.members(String(r.remote_jid))?.find(j=>j.endsWith('@s.whatsapp.net'))?.split('@')[0]??null}))
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

  /** Caller owns the transaction. Add references without rewriting an existing ficha. */
  ensureInteraction(jid:string, at:string|null, contactId:string|null, phone:string, name:string, reason:string) {
    const id=this.rememberProviderConversation(jid)
    const previous=this.links(jid)
    const created=!at
    // Only the explicitly assigned Entity participates; provider names and phone text are not identity evidence.
    const owner=contactId?this.db.prepare(`SELECT e.id,e.data FROM customer_records c
      JOIN customer_records e ON e.id=c.entity_id AND e.kind='entity'
      WHERE c.id=? AND c.kind='contact'`).get(contactId):undefined
    const ownerName=owner?String(JSON.parse(String(owner.data)).text??''):null
    at??=new AtendimentoRepository(this.db).create({phone,name:ownerName??name,purpose:'unclassified'},true).id
    let referencesChanged=false
    if(!previous.some(link=>link.atendimento_id===at)){
      const linkId=randomUUID()
      this.db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)')
        .run(linkId,id,at,this.now(),'system',reason)
      this.db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(id)
      // A previously selected closed interaction must not retain working context.
      if(created&&previous.some(link=>link.closed_at||link.stage==='rejeitados')){
        const handles=this.handles(jid),scope=handles.map(()=>'?').join(',')
        this.db.prepare(`DELETE FROM v20_active_context WHERE conversation_id IN (${scope})`).run(...handles)
        this.db.prepare(`UPDATE v20_conversations SET context_revision=context_revision+1 WHERE id IN (${scope})`).run(...handles)
        this.db.prepare('INSERT INTO v20_active_context VALUES(?,?)').run(id,linkId)
      }
    }
    if(contactId&&!this.db.prepare("SELECT 1 FROM atendimento_references WHERE atendimento_id=? AND kind='contact' AND record_id=?").get(at,contactId)){
      const old=this.db.prepare('SELECT phone FROM atendimentos WHERE id=?').get(at)!
      const position=Number(this.db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM atendimento_references WHERE atendimento_id=? AND kind='contact'").get(at)!.n)
      const add=this.db.prepare("INSERT INTO atendimento_references(atendimento_id,kind,position,record_id,data) VALUES(?,'contact',?,?,?)")
      const keepPrevious=position===0&&!created&&old.phone&&old.phone!==phone
      if(keepPrevious)add.run(at,0,null,JSON.stringify({id:null,text:String(old.phone)}))
      add.run(at,keepPrevious?1:position,contactId,JSON.stringify({id:contactId,text:phone}))
      referencesChanged=true
    }
    if(owner&&!this.db.prepare("SELECT 1 FROM atendimento_references WHERE atendimento_id=? AND kind='person' AND record_id=?").get(at,owner.id!)){
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
    if(!created&&referencesChanged)this.db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(at)
    return at
  }

  /** Caller owns BEGIN IMMEDIATE covering event, message, snapshot and associations. */
  inbound(e: ConversationEvent, newMessage:boolean) {
    const jid=e.message.remoteJid, members=this.members(jid)
    if(e.type!=='message.upsert'||!newMessage||!members||this.contextHeld(jid))return
    const plan=this.interaction(jid), id=this.rememberProviderConversation(jid)
    const timestamp=new Date(e.message.timestamp!*1000).toISOString()
    if(e.message.fromMe!==false){
      if(plan.at)this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(plan.at,id,e.message.messageId,timestamp)
      return
    }
    const handles=this.handles(jid),scope=handles.map(()=>'?').join(',')
    const prior=this.db.prepare(`SELECT 1 FROM conversation_initialization WHERE conversation_id IN (${scope})`).get(...handles)
    const phone=members.find(j=>j.endsWith('@s.whatsapp.net'))?.split('@')[0]
    const initial={phone:phone?'+'+phone:'',name:e.displayName??'',source:'whatsapp_inbound',eventId:e.eventId,identity:'channel_evidence_only'}
    const channels=this.db.prepare(`SELECT id FROM customer_records WHERE kind='contact' AND conversation_id IN (${scope})`).all(...handles)
    const customers=new CustomerRepository(this.db)
    const matches=initial.phone?customers.phoneMatches(initial.phone):[]
    const blocked=plan.blocked||channels.length>1||matches.length>1||
      (channels.length===1&&matches.length===1&&channels[0]!.id!==matches[0]!.id)
    const historical=!!(plan.closedAt&&timestamp<=plan.closedAt)
    let at:string|null=null
    if(!blocked&&!historical){
      let contactId=channels.length?String(channels[0]!.id):null
      // In the autonomous target model, the first real interaction produces one shared
      // Entity + Contact for a confirmed PN. The channel label is provisional, not ID proof.
      const known=contactId?customers.record(contactId):matches[0]??null
      if(this.unifiedCustomers&&!plan.at&&!prior&&normalizePhone(initial.phone)&&
        (!known?.conversationId||handles.includes(known.conversationId))&&
        (!known?.text||normalizePhone(known.text)===initial.phone)){
        const owner=known?.entityId?customers.record(known.entityId):null
        const saved=customers.confirmChannelContact(owner,owner?.text||initial.name.trim()||initial.phone,known,initial.phone,id)
        contactId=saved.contact.id
        this.db.prepare("UPDATE customer_records SET data=json_set(data,'$.channelState','response_received'),revision=revision+1 WHERE id=? AND COALESCE(json_extract(data,'$.channelState'),'')!='response_received'").run(contactId)
      // Compatibility path, retained until the coordinated cutover. No inferred owner.
      }else if(!contactId&&!matches.length){
        contactId=randomUUID()
        this.db.prepare("INSERT INTO customer_records(id,kind,data,conversation_id,phone_normalized) VALUES(?,'contact',?,?,?)")
          .run(contactId,JSON.stringify({text:initial.phone,channelState:'response_received'}),id,initial.phone||null)
      }else if(contactId){
        this.db.prepare("UPDATE customer_records SET data=json_set(data,'$.channelState','response_received'),revision=revision+1 WHERE id=? AND COALESCE(json_extract(data,'$.channelState'),'')!='response_received'").run(contactId)
      }
      at=this.ensureInteraction(jid,plan.at,contactId,initial.phone,initial.name,'authenticated_inbound')
      this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(at,id,e.message.messageId,timestamp)
    }
    if(!prior)this.db.prepare('INSERT INTO conversation_initialization VALUES(?,?,?,?,?,?)')
      .run(id,at,e.eventId,this.now(),JSON.stringify(initial),at?(plan.at?'reused':'created'):historical?'closed':'ambiguous')
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
      result.set(scope.jid,{phoneNumber:scope.members?.find(j=>j.endsWith('@s.whatsapp.net'))?.split('@')[0]??null,...(contact?{contactId:String(contact.id)}:{}),names:entity?[{name:entity.text,entityId:entity.id}]:conversationNames(data?.nickname??null,null,scope.members?people:[]),atendimentoCount:scope.members?new Set(related.map(l=>l.atendimento_id)).size:0,preview:last?(last.text?String(last.text):'Mídia ou mensagem indisponível'):null,profilePhoto:null,unreadCount:Number(unread.find(u=>u.handle===scope.id)?.n??0),lastMessageAt:last?String(last.occurred_at):null})
    }
    return result
  }
  projection(jid:string) {return this.projections([jid]).get(jid)!}
  recordAccepted(at:string,jid:string,messageId:string) {
    if(this.members(jid)&&this.links(jid).some(l=>l.atendimento_id===at))this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(at,this.rememberProviderConversation(jid),messageId,this.now())
  }
  markRead(jid:string, messages:string[]) {
    const id=this.rememberProviderConversation(jid)
    for(const mid of messages)this.db.prepare('INSERT OR IGNORE INTO conversation_message_reads VALUES(?,?)').run(id,mid)
  }
}
