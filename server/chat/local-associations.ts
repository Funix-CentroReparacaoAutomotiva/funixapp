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
  constructor(db: DatabaseSync, now = () => new Date().toISOString()) { super(db, now) }
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
    return this.db.prepare(`SELECT l.*,a.stage,a.closed_at FROM v20_associations l JOIN atendimentos a ON a.id=l.atendimento_id WHERE l.conversation_id IN (${ids.map(()=>'?').join(',')}) AND l.unlinked_at IS NULL ORDER BY l.linked_at,l.id`).all(...ids)
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
    const ids = [...new Set(links.map(l => String(l.atendimento_id)))]
    return ids.length === 1 ? ids[0]! : null
  }
  resolveActive(jid: string) { return this.resolveIdentityActive(jid) }
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
      const scope=this.handles(jid),placeholders=scope.map(()=>'?').join(',')
      this.db.prepare(`DELETE FROM v20_active_context WHERE conversation_id IN (${placeholders})`).run(...scope)
      this.db.prepare('INSERT INTO v20_active_context VALUES(?,?)').run(linked?linked.conversation_id!:id,linkId)
      this.db.prepare(`UPDATE v20_conversations SET context_revision=context_revision+1 WHERE id IN (${placeholders})`).run(...scope)
      const known=this.db.prepare('SELECT id FROM customer_records WHERE conversation_id=?').get(id),contactId=known?String(known.id):ref.id??randomUUID()
      if(!known){if(ref.id)this.db.prepare('UPDATE customer_records SET conversation_id=?,revision=revision+1 WHERE id=? AND conversation_id IS NULL').run(id,ref.id);else this.db.prepare("INSERT INTO customer_records(id,kind,data,conversation_id) VALUES(?,'contact',?,?)").run(contactId,JSON.stringify({text:phone,channelState:'informed'}),id)}
      const refs=record.references!;refs.contact[index]={id:contactId,text:phone??ref.text};new CustomerRepository(this.db).saveReferences(at,refs)
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
  /** Caller owns BEGIN IMMEDIATE covering event, message, snapshot and associations. */
  inbound(e: ConversationEvent) {
    if (e.type!=='message.upsert' || !this.members(e.message.remoteJid)||this.contextHeld(e.message.remoteJid)) return
    if(e.message.fromMe!==false){const at=this.resolveIdentityActive(e.message.remoteJid);if(at)this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(at,this.rememberProviderConversation(e.message.remoteJid),e.message.messageId,new Date(e.message.timestamp!*1000).toISOString());return}
    const jid=e.message.remoteJid, handles=this.handles(jid), id=this.rememberProviderConversation(jid)
    const prior = this.db.prepare(`SELECT * FROM conversation_initialization WHERE conversation_id IN (${handles.map(()=>'?').join(',')})`).all(...handles)
    const links=this.links(jid), active=[...new Set(links.filter(l=>l.stage!=='rejeitados'&&!l.closed_at).map(l=>String(l.atendimento_id)))]
    const contact=this.db.prepare('SELECT id FROM customer_records WHERE conversation_id=?').get(id)
    const phone=this.members(jid)!.find(j=>j.endsWith('@s.whatsapp.net'))?.split('@')[0]
    const initial={phone:phone?'+'+phone:'',name:e.displayName??'',source:'whatsapp_inbound',eventId:e.eventId,identity:'channel_evidence_only'}
    const contactId=contact?String(contact.id):randomUUID()
    if(!contact)this.db.prepare("INSERT INTO customer_records(id,kind,data,conversation_id) VALUES(?,'contact',?,?)").run(contactId,JSON.stringify({text:initial.phone,channelState:'response_received'}),id)
    else this.db.prepare("UPDATE customer_records SET data=json_set(data,'$.channelState','response_received'),revision=revision+1 WHERE id=? AND json_extract(data,'$.channelState')!='response_received'").run(contactId)
    if(!prior.length){
      let at:string|null=null,decision:'created'|'reused'|'ambiguous'|'closed'
      if(active.length===1){at=active[0]!;decision='reused'}
      else if(active.length>1){decision='ambiguous'}
      else if(links.length){decision='closed'}
      else{
        at=new AtendimentoRepository(this.db).create({phone:initial.phone,name:initial.name},true).id;decision='created'
        this.db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,at,this.now(),'system','first_authenticated_inbound')
        this.db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(id)
      }
      if(at){
        // Existing commercial fields are never overwritten, even if empty.
        if(!this.db.prepare("SELECT 1 FROM atendimento_references WHERE atendimento_id=? AND kind='contact' AND record_id=?").get(at,contactId)){const existing=this.db.prepare('SELECT phone FROM atendimentos WHERE id=?').get(at)!;if(decision==='reused'&&existing.phone&&existing.phone!==initial.phone&&!this.db.prepare("SELECT 1 FROM atendimento_references WHERE atendimento_id=? AND kind='contact'").get(at))this.db.prepare("INSERT INTO atendimento_references VALUES(?,'contact',0,NULL,?)").run(at,JSON.stringify({id:null,text:String(existing.phone)}));const position=Number(this.db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM atendimento_references WHERE atendimento_id=? AND kind='contact'").get(at)!.n);this.db.prepare("INSERT INTO atendimento_references(atendimento_id,kind,position,record_id,data) VALUES(?,'contact',?,?,?)").run(at,position,contactId,JSON.stringify({id:contactId,text:initial.phone}))}
      }
      this.db.prepare('INSERT INTO conversation_initialization VALUES(?,?,?,?,?,?)').run(id,at,e.eventId,this.now(),JSON.stringify(initial),decision)
    }
    // Genuine inbound is a commercial contact event; changes to cards are not.
    for(const at of active.length===1?active:prior.length===0?this.links(jid).filter(l=>l.stage!=='rejeitados'&&!l.closed_at).map(l=>String(l.atendimento_id)):[]){
      this.db.prepare('INSERT OR IGNORE INTO atendimento_contact_events VALUES(?,?,?,?)').run(at,id,e.message.messageId,new Date(e.message.timestamp!*1000).toISOString())
    }
  }
  projections(jids:string[]):Map<string,CommercialConversation & {unreadCount:number;lastMessageAt:string|null;phoneNumber:string|null}> {
    const result=new Map<string,CommercialConversation & {unreadCount:number;lastMessageAt:string|null;phoneNumber:string|null}>()
    if(!jids.length)return result
    const scopes=jids.map(jid=>({jid,members:this.members(jid),ids:this.handles(jid),id:this.rememberProviderConversation(jid)}))
    const ids=[...new Set(scopes.flatMap(s=>s.ids))]
    const placeholders=ids.map(()=>'?').join(',')
    const contacts=ids.length?this.db.prepare(`SELECT * FROM customer_records WHERE conversation_id IN (${placeholders})`).all(...ids):[]
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
    const unread=pairs.length?this.db.prepare(`WITH scope(handle,jid) AS (VALUES ${pairs.map(()=>'(?,?)').join(',')})
      SELECT scope.handle,COUNT(DISTINCT m.message_id) AS n FROM scope
      JOIN chat_conversations c ON c.remote_jid=scope.jid AND c.instance=? JOIN chat_messages m ON m.conversation_id=c.id
      WHERE m.from_me=0 AND NOT EXISTS(SELECT 1 FROM conversation_message_reads r WHERE r.conversation_id=scope.handle AND r.message_id=m.message_id)
      GROUP BY scope.handle`).all(...pairs.flat(),instance):[]
    for(const scope of scopes){
      const related=links.filter(l=>scope.ids.includes(String(l.conversation_id)))
      const people:NamePart[]=related.map(l=>{const r=l.record||l.data?JSON.parse(String(l.record??l.data)):null;return {name:r?String(r.text??''):String(l.name),entityId:l.kind==='entity'?String(l.record_id):null}})
      const contact=contacts.find(c=>c.conversation_id===scope.id),data=contact?JSON.parse(String(contact.data)):null
      const last=messages.find(m=>m.handle===scope.id)
      result.set(scope.jid,{phoneNumber:scope.members?.find(j=>j.endsWith('@s.whatsapp.net'))?.split('@')[0]??null,...(contact?{contactId:String(contact.id)}:{}),names:conversationNames(data?.nickname??null,contact?.entity_id?String(contact.entity_id):null,scope.members?people:[]),atendimentoCount:scope.members?new Set(related.map(l=>l.atendimento_id)).size:0,preview:last?(last.text?String(last.text):'Mídia ou mensagem indisponível'):null,profilePhoto:null,unreadCount:Number(unread.find(u=>u.handle===scope.id)?.n??0),lastMessageAt:last?String(last.occurred_at):null})
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
