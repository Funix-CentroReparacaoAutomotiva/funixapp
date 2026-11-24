import {withConfirmedOwnerChange} from './customer-identity-schema.ts'
import {normalizeCustomerPhone as normalizePhone} from './phone.ts'
import {AtendimentoRepository} from './atendimentos.ts'
import type {Atendimento} from '../shared/contracts.ts'
import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {EntityContactInput,CustomerRecord,CustomerReferences,CustomerReference,ReferenceKind} from '../shared/customer.ts'
import {ConversationIdentities} from './chat/conversation-identities.ts'
import {ServiceError} from './errors.ts'
import {inputObject,transaction} from './scenarios.ts'
const invalid=():never=>{throw new ServiceError(400,'INVALID_REFERENCE','Referência inválida.')}
const kinds=['person','contact','vehicle','payer'] as const
export function pendingShortNumber(db:DatabaseSync,conversationId:string) {
  if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='chat_confirmed_short_numbers'").get())return null
  return db.prepare(`SELECT COALESCE((SELECT a.pn FROM chat_provider_alias_evidence a WHERE a.instance=p.instance AND a.lid=p.remote_jid),p.remote_jid) AS jid,
    EXISTS(SELECT 1 FROM customer_channel_contacts v JOIN v20_associations a USING(conversation_id)
      WHERE v.contact_id=c.id AND a.unlinked_at IS NULL) AS active
    FROM customer_records c JOIN chat_provider_conversations p ON p.id=c.conversation_id
    WHERE c.kind='contact' AND c.conversation_id=? AND json_extract(c.data,'$.shortNumberReviewPending')=1`).get(conversationId)??null
}
export class CustomerRepository {
  readonly db:DatabaseSync
  constructor(db:DatabaseSync){this.db=db}
  available(){return !!this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='customer_records'").get()}
  record(id:string):CustomerRecord {
    const record=this.readRecord(id)
    if(!record.canonicalContactId)return record
    const canonical=this.readRecord(record.canonicalContactId)
    if(canonical.kind!=='contact'||canonical.canonicalContactId)invalid()
    return canonical
  }
  private readRecord(id:string):CustomerRecord&{canonicalContactId?:string;channelProvisional?:number} {
    const r=this.db.prepare('SELECT * FROM customer_records WHERE id=?').get(id)
    if(!r)throw new ServiceError(404,'NOT_FOUND','Cadastro não encontrado.')
    return {...JSON.parse(String(r.data)),id:String(r.id),kind:r.kind,revision:Number(r.revision),conversationId:r.conversation_id,entityId:r.entity_id}
  }
  search(kind:string,q:string) {
    if(!['entity','vehicle','contact'].includes(kind)||q.length>150)invalid()
    const phone=kind==='contact'?normalizePhone(q):null
    if(phone)return this.phoneMatches(phone).slice(0,20)
    return this.db.prepare("SELECT id FROM customer_records WHERE kind=? AND json_extract(data,'$.canonicalContactId') IS NULL AND data LIKE ? ESCAPE '\\' ORDER BY id LIMIT 20").all(kind,'%'+q.replace(/[\\%_]/g,'\\$&')+'%').map(r=>this.record(String(r.id)))
  }
  validateReference(raw:unknown,kind:ReferenceKind):CustomerReference {
    const r=inputObject(raw,['id','text','plate','fabricationYear','modelYear','entityId'])
    if(r.id!==null&&(typeof r.id!=='string'||r.id.length>100))invalid()
    if(typeof r.text!=='string'||r.text.length>250)invalid()
    const result:CustomerReference={id:r.id as string|null,text:String(r.text).trim()}
    if(kind==='vehicle'){
      if(r.plate!==undefined&&(typeof r.plate!=='string'||r.plate.length>100))invalid()
      result.plate=String(r.plate??'').trim().toUpperCase()
      for(const key of ['fabricationYear','modelYear']as const){if(r[key]!==undefined&&r[key]!==null&&(typeof r[key]!=='string'||(r[key]!==''&&!/^(19|20)\d{2}$/.test(String(r[key])))))invalid();result[key]=r[key] as string|null|undefined}
    }
    if(result.id){const found=this.record(result.id);if(found.kind!==(kind==='person'||kind==='payer'?'entity':kind))invalid();result.id=found.id}
    return result
  }
  validate(raw:unknown):CustomerReferences {
    const source=inputObject(raw,[...kinds]),result={} as CustomerReferences
    for(const kind of kinds){if(!Array.isArray(source[kind])||source[kind].length>100)invalid();result[kind]=(source[kind] as unknown[]).map(r=>this.validateReference(r,kind))}
    return result
  }
  primaryFields(refs:CustomerReferences,previous?:Atendimento) {
    const value=(kind:ReferenceKind)=>{const r=refs[kind][0];return r?.id?this.record(r.id):r}
    const person=value('person'),contact=value('contact'),vehicle=value('vehicle')
    const old=previous?this.references(previous.id).vehicle[0]:undefined,next=refs.vehicle[0]
    const unchanged=!!previous&&!next?.id&&old?.id===next?.id&&old?.text===next?.text&&(old?.plate??'')===(next?.plate??'')&&(old?.fabricationYear??null)===(next?.fabricationYear??null)&&(old?.modelYear??null)===(next?.modelYear??null)
    const vehicleFields=unchanged?{vehicle:previous.vehicle,model:previous.model,brand:previous.brand,plate:previous.plate,fabricationYear:previous.fabricationYear,modelYear:previous.modelYear}:{vehicle:vehicle?.text??'',model:vehicle?.text??'',brand:'',plate:vehicle?.plate??'',fabricationYear:vehicle?.fabricationYear??null,modelYear:vehicle?.modelYear??null}
    return {name:person?.text??'',phone:contact?.text??'',...vehicleFields}
  }
  /** Revoke working context, retaining auditable N:N links and all messages. */
  invalidateContactContexts(at:string,before:CustomerReference[],after:CustomerReference[]) {
    const key=(r:CustomerReference|undefined)=>r?.id?'id:'+r.id:'text:'+(r?.text??'')
    const primaryChanged=key(before[0])!==key(after[0])
    const removed=before.filter(r=>r.id&&!after.some(n=>n.id===r.id))
    if(!primaryChanged&&!removed.length)return
    const channels=new Set<string>()
    if(primaryChanged)for(const row of this.db.prepare('SELECT conversation_id FROM v20_associations WHERE atendimento_id=? AND unlinked_at IS NULL').all(at))channels.add(String(row.conversation_id))
    for(const r of removed){const cid=this.record(r.id!).conversationId;if(cid)channels.add(cid)}
    const identities=new ConversationIdentities(this.db)
    for(const cid of [...channels]){
      const jid=identities.providerJid(cid),members=jid?identities.identityJids(jid):null
      if(members)for(const row of this.db.prepare(`SELECT id FROM chat_provider_conversations WHERE instance='funix_comercial' AND remote_jid IN (${members.map(()=>'?').join(',')})`).all(...members))channels.add(String(row.id))
    }
    for(const cid of channels){
      this.db.prepare('DELETE FROM v20_active_context WHERE conversation_id=? AND link_id IN (SELECT id FROM v20_associations WHERE atendimento_id=?)').run(cid,at)
      this.db.prepare('UPDATE v20_conversations SET context_revision=context_revision+1 WHERE id=?').run(cid)
    }
  }
  resolveManualContactReferences(refs:CustomerReferences,previous?:CustomerReferences) {
    if(!this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='customer_contact_phone_unique'").get())return refs
    const person=[...refs.person]
    let ownerIds=[...new Set(person.flatMap(ref=>ref.id?[ref.id]:[]))]
    const selectExistingOwner=(entityId:string)=>{
      if(ownerIds.some(id=>id!==entityId)||ownerIds.length>1||!ownerIds.length&&person.length>1)
        throw new ServiceError(409,'CONTACT_OWNER_CONFLICT','O número pertence a outro titular. Revise os responsáveis desta ficha.')
      if(!ownerIds.length){
        const owner=this.record(entityId)
        if(person.length)person[0]={id:owner.id,text:owner.text}
        else person.push({id:owner.id,text:owner.text})
        ownerIds=[owner.id]
      }
    }
    const contact=refs.contact.map((ref,index)=>{
      if(ref.id){
        const selected=this.record(ref.id)
        if(selected.kind!=='contact')throw new ServiceError(400,'INVALID_REFERENCE','A referência deve ser um telefone cadastrado.')
        if(selected.entityId)selectExistingOwner(selected.entityId)
        return ref
      }
      const phone=normalizePhone(ref.text)
      if(!phone)return ref
      // Existing unresolved legacy text may survive unrelated edits.
      if(previous?.contact[index]?.id===null&&previous.contact[index]?.text===ref.text)return ref
      const matches=this.phoneMatches(phone),existing=matches[0]
      if(matches.length>1||ownerIds.length>1)
        throw new ServiceError(409,'CONTACT_OWNER_CONFLICT','Este número possui mais de uma referência ou titular. Revise o cadastro.')
      // A unique canonical phone is sufficient to reuse its known person and
      // contact. Free-text names do not create a second owner for the same number.
      if(existing?.entityId)selectExistingOwner(existing.entityId)
      let ownerId=ownerIds[0]
      if(!ownerId){
        if(person.length!==1||!person[0]!.text)
          throw new ServiceError(409,'CONTACT_OWNER_REQUIRED','Informe ou selecione o titular deste número, ou deixe o telefone em branco.')
        const owner=this.saveRecord({kind:'entity',text:person[0]!.text})
        ownerId=owner.id
        ownerIds=[ownerId]
        person[0]={id:owner.id,text:owner.text}
      }
      const saved=existing?.entityId?existing:this.saveRecord({kind:'contact',text:existing?.text??ref.text,entityId:ownerId,revision:existing?.revision},existing?.id)
      return {id:saved.id,text:saved.text}
    })
    return {...refs,person,contact}
  }

  saveReferences(at:string,refs:CustomerReferences,previous=this.references(at).contact) {
    this.invalidateContactContexts(at,previous,refs.contact)
    this.db.prepare('DELETE FROM atendimento_references WHERE atendimento_id=?').run(at)
    for(const kind of kinds)refs[kind].forEach((r,i)=>{
      this.db.prepare('INSERT INTO atendimento_references VALUES(?,?,?,?,?)').run(at,kind,i,r.id,JSON.stringify(r))
      // Selecting a known channel Contact is explicit; a textual phone match never reaches here.
      const cid=kind==='contact'&&r.id?this.record(r.id).conversationId:null
      if(cid&&!this.hasConversationReference(cid,at)){
        this.resolveChannelContact(cid,r.id!)
        this.db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)').run(randomUUID(),cid,at,new Date().toISOString(),'operator','explicit_contact_reference')
        this.db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(cid)
      }
    })
    this.updateSearch(at)
  }
  private hasConversationReference(conversationId:string,at:string) {
    const identities=new ConversationIdentities(this.db)
    const jid=identities.providerJid(conversationId),members=jid?identities.identityJids(jid):null
    if(!members)return !!this.db.prepare('SELECT 1 FROM v20_associations WHERE conversation_id=? AND atendimento_id=? AND unlinked_at IS NULL').get(conversationId,at)
    return !!this.db.prepare(`SELECT 1 FROM v20_associations a JOIN v20_conversations c ON c.id=a.conversation_id
      WHERE a.atendimento_id=? AND a.unlinked_at IS NULL AND c.instance='funix_comercial'
      AND c.remote_jid IN (${members.map(()=>'?').join(',')}) LIMIT 1`).get(at,...members)
  }

  references(at:string):CustomerReferences {
    const row=this.db.prepare('SELECT * FROM atendimentos WHERE id=?').get(at)!
    const refs:CustomerReferences={person:[{id:null,text:String(row.name)}],contact:[{id:null,text:String(row.phone)}],vehicle:[{id:null,text:String(row.vehicle),plate:String(row.plate),fabricationYear:row.fabrication_year as string|null,modelYear:row.model_year as string|null}],payer:[]}
    const stored=this.db.prepare('SELECT * FROM atendimento_references WHERE atendimento_id=? ORDER BY position').all(at)
    for(const kind of kinds){const rows=stored.filter(r=>r.kind===kind);if(rows.length)refs[kind]=rows.map(r=>{const data=JSON.parse(String(r.data));if(!r.record_id)return data;const found=this.record(String(r.record_id));return {id:found.id,text:found.text,...(kind==='contact'&&found.entityId?{entityId:found.entityId}:{}),...(kind==='vehicle'?{plate:found.plate,fabricationYear:found.fabricationYear,modelYear:found.modelYear}:{})}})}
    return refs
  }
  present(items:Atendimento[]):Atendimento[] {
    if(!items.length)return items
    const rows=this.db.prepare(`SELECT r.atendimento_id,r.kind,r.data,c.data AS record FROM atendimento_references r LEFT JOIN customer_records c ON c.id=r.record_id WHERE r.position=0 AND r.atendimento_id IN (${items.map(()=>'?').join(',')})`).all(...items.map(i=>i.id))
    return items.map(item=>{const out={...item};for(const row of rows.filter(r=>r.atendimento_id===item.id)){const r=JSON.parse(String(row.record??row.data));if(row.kind==='person')out.name=String(r.text??'');if(row.kind==='contact')out.phone=String(r.text??'');if(row.kind==='vehicle'){out.vehicle=String(r.text??'');out.plate=String(r.plate??'');out.fabricationYear=r.fabricationYear??null;out.modelYear=r.modelYear??null}}out.phoneNormalized=normalizePhone(out.phone);return out})
  }
  applyLegacyFields(at:string,fields:Record<string,string|boolean|number|null>,manual=false) {
    for(const [kind,key]of [['person','name'],['contact','phone'],['vehicle','vehicle']]as const){
      if(fields[key]===undefined&&!(kind==='vehicle'&&['plate','fabricationYear','modelYear'].some(k=>fields[k]!==undefined)))continue
      const row=this.db.prepare('SELECT data,record_id FROM atendimento_references WHERE atendimento_id=? AND kind=? AND position=0').get(at,kind)
      if(!row)continue
      const r=row.record_id?this.record(String(row.record_id)):JSON.parse(String(row.data))
      if(kind!=='vehicle'&&fields[key]===r.text)continue
      if(row.record_id&&(
        manual&&kind!=='vehicle'||
        kind==='person'&&!this.channelOwnerIsProvisional(String(row.record_id))||
        kind==='contact'&&r.entityId&&!this.channelOwnerIsProvisional(r.entityId)
      ))throw new ServiceError(409,'SHARED_CUSTOMER_REFERENCE','Edite o cadastro compartilhado ou selecione outra referência neste Atendimento.')
      // Explicit textual correction detaches this ficha reference, never moves messages or edits a shared record.
      const data={id:null,text:fields[key]??r.text,...(kind==='vehicle'?{plate:fields.plate??r.plate??'',fabricationYear:fields.fabricationYear??r.fabricationYear??null,modelYear:fields.modelYear??r.modelYear??null}:{})}
      this.db.prepare('UPDATE atendimento_references SET record_id=NULL,data=? WHERE atendimento_id=? AND kind=? AND position=0').run(JSON.stringify(data),at,kind)
    }
  }
  contacts(entityId:string) {
    if(this.record(entityId).kind!=='entity')invalid()
    return this.db.prepare("SELECT id FROM customer_records WHERE kind='contact' AND entity_id=? AND json_extract(data,'$.canonicalContactId') IS NULL ORDER BY rowid").all(entityId).map(r=>this.record(String(r.id)))
  }
  /** Exact full international number only. Existing duplicates remain reviewable, never merged. */
  phoneMatches(phone:string) {
    if(this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND name='customer_contact_phone_unique'").get())
      return this.db.prepare("SELECT id FROM customer_records WHERE kind='contact' AND phone_normalized=?").all(phone)
        .map(row=>this.record(String(row.id)))
    return this.db.prepare("SELECT id,data FROM customer_records WHERE kind='contact'").all()
      .filter(r=>normalizePhone(String(JSON.parse(String(r.data)).text??''))===phone).map(r=>this.record(String(r.id)))
  }
  save(raw:unknown,id?:string) {
    const input=inputObject(raw,['kind','text','plate','fabricationYear','modelYear','revision','nickname','entityId','contacts'])
    const {contacts,...record}=input
    if(contacts!==undefined&&(!Array.isArray(contacts)||contacts.length>50||(id?this.record(id).kind:input.kind)!=='entity'))invalid()
    return transaction(this.db,()=>{
      const saved=this.saveRecord(record,id)
      if(contacts!==undefined) {
        const seen=new Set<string>()
        for(const rawContact of contacts as unknown[]) {
          const c=inputObject(rawContact,['id','text','revision']) as EntityContactInput
          if(c.id!==undefined&&(typeof c.id!=='string'||!/^[a-f0-9-]{36}$/.test(c.id)||seen.has(c.id)))invalid()
          if(c.id)seen.add(c.id)
          const old=c.id?this.record(c.id):null
          if(old&&(old.kind!=='contact'||old.entityId&&old.entityId!==saved.id))throw new ServiceError(409,'CONTACT_OWNER_CONFLICT','Este número pertence a outro cadastro. Revise a associação antes de continuar.')
          this.saveRecord({kind:'contact',text:c.text,revision:c.revision,entityId:saved.id},c.id)
        }
        if(this.contacts(saved.id).length>50)throw new ServiceError(400,'CONTACT_LIMIT','Limite de 50 números por cadastro.')
      }
      return saved
    })
  }
  private provisionalChannelOwner(name:string) {
    const owner=this.saveRecord({kind:'entity',text:name.trim()||'Sem nome'})
    this.db.prepare("UPDATE customer_records SET data=json_set(data,'$.channelProvisional',1) WHERE id=?").run(owner.id)
    return this.record(owner.id)
  }

  channelOwnerIsProvisional(id:string) {
    return this.db.prepare("SELECT json_extract(data,'$.channelProvisional') AS pending FROM customer_records WHERE id=?").get(id)?.pending===1
  }

  confirmChannelOwnerLabel(id:string) {
    this.db.prepare(`UPDATE customer_records SET data=json_remove(data,'$.channelProvisional'),revision=revision+1
      WHERE id=? AND kind='entity' AND json_extract(data,'$.channelProvisional')=1`).run(id)
  }

  canReplaceProvisionalOwner(id:string) {
    return this.channelOwnerIsProvisional(id)&&!this.db.prepare('SELECT 1 FROM atendimento_references WHERE record_id=? LIMIT 1').get(id)
  }

  /** Caller holds the identity confirmation transaction and has checked aliases and ownership. */
  confirmChannelContact(person:CustomerRecord|null,name:string,existing:CustomerRecord|null,phone:string,conversationId:string|null,confirmation?:{conversationId:string;requestId:string;digest:string;atendimentoId:string|null}) {
    const entity=person??this.saveRecord({kind:'entity',text:name})
    const previousOwnerId=existing?.entityId
    if(previousOwnerId&&previousOwnerId!==entity.id){
      if(!confirmation||!this.canReplaceProvisionalOwner(previousOwnerId))
        throw new ServiceError(409,'CONTACT_OWNER_CONFLICT','Transferência de titularidade exige confirmação explícita.')
      const audit={entityId:entity.id,contactId:existing.id,atendimentoId:confirmation.atendimentoId,previousEntityId:previousOwnerId}
      this.db.prepare('INSERT INTO v20_association_receipts VALUES(?,?,?,?)')
        .run(confirmation.conversationId,confirmation.requestId,confirmation.digest,JSON.stringify(audit))
      const contact=withConfirmedOwnerChange(this.db,{contactId:existing.id,previousOwnerId,ownerId:entity.id},
        ()=>this.bindConfirmedPhone(existing,phone,entity.id,conversationId))
      return {person:entity,contact,receipted:true}
    }
    return {person:entity,contact:this.bindConfirmedPhone(existing,phone,entity.id,conversationId),receipted:false}
  }

  /** Register an authenticated channel with its own provisional owner and no invented phone.
   * Caller owns the transaction and checked uniqueness.
   */
  createUnnumberedChannelContact(name:string,conversationId:string,shortNumberReviewPending=false) {
    const entity=this.provisionalChannelOwner(name)
    const id=randomUUID()
    this.db.prepare("INSERT INTO customer_records(id,kind,data,conversation_id,entity_id) VALUES(?,'contact',?,?,?)")
      .run(id,JSON.stringify({text:'',channelState:'response_received',...(shortNumberReviewPending?{shortNumberReviewPending:true}:{})}),conversationId,entity.id)
    return {person:entity,contact:this.record(id)}
  }

  /** Resolve the existing handle in the caller's transaction. A technical handle
   * alone supplies no civil identity. New owners created here are provisional.
   */
  resolveChannelContact(conversationId:string,preferredId?:string,name='') {
    const identities=new ConversationIdentities(this.db)
    const jid=identities.providerJid(conversationId)
    const members=jid?identities.identityJids(jid):null
    if(!members)throw new ServiceError(409,'CHAT_IDENTITY_CONFLICT','Identidade do canal precisa de revisão.')
    const candidate=members.find(member=>member.endsWith('@s.whatsapp.net'))?.split('@')[0]
    const phone=candidate?normalizePhone('+'+candidate):null
    const registered=this.db.prepare(`SELECT c.id FROM customer_records c JOIN chat_provider_conversations p ON p.id=c.conversation_id
      WHERE c.kind='contact' AND p.instance='funix_comercial' AND p.remote_jid IN (${members.map(()=>'?').join(',')})`).all(...members)
    const ids=new Set([...registered.map(row=>String(row.id)),...(phone?this.phoneMatches(phone).map(match=>match.id):[]),...(preferredId?[preferredId]:[])])
    if(ids.size>1)throw new ServiceError(409,'CHAT_IDENTITY_CONFLICT','Identidade do Contato precisa de revisão.')
    const id=[...ids][0]
    const contact=id?this.record(id):null
    const originalJid=contact?.conversationId?identities.providerJid(contact.conversationId):null
    if(contact&&(contact.kind!=='contact'||contact.conversationId&&(!originalJid||!members.includes(originalJid))||
      contact.text&&normalizePhone(contact.text)!==phone))
      throw new ServiceError(409,'CHAT_IDENTITY_CONFLICT','Contato incompatível com o canal.')
    if(phone){
      const owner=contact?.entityId?this.record(contact.entityId):this.provisionalChannelOwner(name)
      return this.confirmChannelContact(owner,name.trim()||phone,contact,phone,conversationId).contact
    }
    if(candidate){
      const pending=contact?.conversationId===conversationId&&contact.entityId&&this.db.prepare(`SELECT 1 FROM customer_records
        WHERE id=? AND json_extract(data,'$.shortNumberReviewPending')=1`).get(contact.id)
      if(pending&&contact)return contact
      throw new ServiceError(409,'CHAT_IDENTITY_CONFLICT','O número informado pelo canal precisa de revisão.')
    }
    if(!contact)return this.createUnnumberedChannelContact(name,conversationId).contact
    if(!contact.entityId||!contact.conversationId){
      const owner=contact.entityId?this.record(contact.entityId):this.provisionalChannelOwner(name)
      this.db.prepare('UPDATE customer_records SET entity_id=?,conversation_id=COALESCE(conversation_id,?),revision=revision+1 WHERE id=?')
        .run(owner.id,conversationId,contact.id)
      return this.record(contact.id)
    }
    return contact
  }

  /** An authenticated alias may consolidate two handles for the same known
   * owner. Keep the provisional UUID and history as evidence.
   */
  reconcileChannelAlias(provisional:CustomerRecord,canonical:CustomerRecord,phone:string,handles:string[]) {
    if(!provisional.conversationId||!handles.includes(provisional.conversationId)||provisional.text||
      !provisional.entityId||provisional.entityId!==canonical.entityId||
      canonical.conversationId&&!handles.includes(canonical.conversationId)||
      normalizePhone(canonical.text)!==phone)return null
    const refs=this.db.prepare('SELECT atendimento_id,position FROM atendimento_references WHERE record_id=? AND kind=?')
      .all(provisional.id,'contact')
    if(refs.some(ref=>this.db.prepare("SELECT 1 FROM atendimento_references WHERE atendimento_id=? AND kind='contact' AND record_id=?")
      .get(ref.atendimento_id!,canonical.id)))return null
    this.db.prepare("UPDATE customer_records SET conversation_id=NULL,data=json_set(data,'$.canonicalContactId',?),revision=revision+1 WHERE id=?")
      .run(canonical.id,provisional.id)
    const saved=this.bindConfirmedPhone(canonical,phone,canonical.entityId,provisional.conversationId)
    for(const ref of refs){
      this.db.prepare("UPDATE atendimento_references SET record_id=?,data=? WHERE atendimento_id=? AND kind='contact' AND position=?")
        .run(saved.id,JSON.stringify({id:saved.id,text:saved.text}),ref.atendimento_id!,ref.position!)
      this.db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(ref.atendimento_id!)
      this.updateSearch(String(ref.atendimento_id))
    }
    return saved
  }

  private bindConfirmedPhone(existing:CustomerRecord|null,phone:string,entityId:string,conversationId:string|null) {
    if(normalizePhone(phone)!==phone||existing?.entityId&&existing.entityId!==entityId&&!this.canReplaceProvisionalOwner(existing.entityId)||
      existing?.text&&normalizePhone(existing.text)!==phone||this.phoneMatches(phone).some(match=>match.id!==existing?.id))
      throw new ServiceError(409,'CONTACT_PHONE_CONFLICT','O número e a titularidade do Contato precisam de revisão.')

    if(!existing){
      const contact=this.saveRecord({kind:'contact',text:phone,entityId})
      this.db.prepare('UPDATE customer_records SET conversation_id=? WHERE id=?').run(conversationId,contact.id)
      return this.record(contact.id)
    }
    const key=this.db.prepare('SELECT phone_normalized FROM customer_records WHERE id=?').get(existing.id)?.phone_normalized
    if(existing.entityId!==entityId||(!existing.conversationId&&conversationId)||!existing.text||key!==phone){
      this.db.prepare(`UPDATE customer_records SET entity_id=?,conversation_id=COALESCE(conversation_id,?),
        data=json_set(data,'$.text',?),phone_normalized=?,revision=revision+1 WHERE id=?`)
        .run(entityId,conversationId,existing.text||phone,phone,existing.id)
      // A verified number can complete an already referenced provisional Contact.
      // Refresh derived search values, without modifying frozen documents or ownership.
      if(!existing.text)for(const affected of this.db.prepare('SELECT DISTINCT atendimento_id FROM atendimento_references WHERE record_id=?').all(existing.id)){
        this.updateSearch(String(affected.atendimento_id))
        this.db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(affected.atendimento_id!)
      }
    }
    return this.record(existing.id)
  }

  reconcileParticipant(at:string,refs:CustomerReferences,person:CustomerRecord|null,contact:CustomerRecord,legacyIndex?:number,legacyContactIndex?:number) {
    let changed=false
    const write=(kind:'person'|'contact',index:number,record:CustomerRecord)=>{
      const ref={id:record.id,text:record.text}
      this.db.prepare(`INSERT INTO atendimento_references VALUES(?,?,?,?,?)
        ON CONFLICT(atendimento_id,kind,position) DO UPDATE SET record_id=excluded.record_id,data=excluded.data`)
        .run(at,kind,index,ref.id,JSON.stringify(ref))
      refs[kind][index]=ref
      changed=true
    }
    const append=(kind:'person'|'contact',record:CustomerRecord,index?:number)=>{
      const rows=refs[kind]
      if(rows.some(ref=>ref.id===record.id))return
      if(!rows.length||rows.length===1&&!rows[0]!.id&&!rows[0]!.text)write(kind,0,record)
      else if(index!==undefined)write(kind,index,record)
      else {
        // Persist the implicit first legacy reference before appending a distinct participant.
        const stored=this.db.prepare('SELECT MAX(position) AS position FROM atendimento_references WHERE atendimento_id=? AND kind=?').get(at,kind)
        if(stored?.position==null){
          const first=rows[0]!
          this.db.prepare('INSERT INTO atendimento_references VALUES(?,?,?,?,?)').run(at,kind,0,first.id,JSON.stringify(first))
        }
        write(kind,Number(stored?.position??0)+1,record)
      }
    }
    if(person)append('person',person,legacyIndex)
    const phone=normalizePhone(contact.text)
    const same=phone?refs.contact.findIndex(ref=>!ref.id&&normalizePhone(ref.text)===phone):-1
    append('contact',contact,legacyContactIndex??(same<0?undefined:same))
    if(changed)this.db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(at)
    this.updateSearch(at)
  }

  private updateSearch(at:string) {
    const [record]=this.present([new AtendimentoRepository(this.db).get(at)])
    const search=[record!.id,record!.phone,record!.name,record!.vehicle,record!.brand,record!.model,record!.plate].join('\n')
      .normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR')
    this.db.prepare('UPDATE atendimentos SET search_text=? WHERE id=?').run(search,at)
  }

  private saveRecord(raw:unknown,id?:string) {
    const source=inputObject(raw,['kind','text','plate','fabricationYear','modelYear','revision','nickname','entityId'])
    const old=id?this.readRecord(id):null,kind=old?.kind??source.kind
    if(old?.canonicalContactId)throw new ServiceError(409,'CONTACT_ARCHIVED','O Contato foi arquivado. Atualize o cadastro para editar o Contato canônico.')
    if(!['entity','contact','vehicle'].includes(String(kind)))invalid()
    const ref=this.validateReference({id:null,text:source.text, ...(kind==='vehicle'?{plate:source.plate,fabricationYear:source.fabricationYear,modelYear:source.modelYear}:{})},kind==='entity'?'person':kind as ReferenceKind)
    if(!ref.text.trim()&&!(kind==='contact'&&old?.conversationId))invalid()
    if(source.nickname!==undefined&&(kind!=='contact'||typeof source.nickname!=='string'||source.nickname.length>250))invalid()
    const entityId=source.entityId===undefined?old?.entityId??null:source.entityId
    if(entityId!==null&&(kind!=='contact'||typeof entityId!=='string'||this.record(entityId).kind!=='entity'))invalid()
    if(old?.entityId&&entityId!==old.entityId)throw new ServiceError(409,'CONTACT_OWNER_CONFLICT','Transferência de cadastro exige revisão explícita; o vínculo atual foi preservado.')
    const phone=kind==='contact'?normalizePhone(ref.text):null
    if(kind==='contact'&&phone&&(phone!==normalizePhone(old?.text??'')||entityId!==old?.entityId)){
      if(this.phoneMatches(phone).some(r=>r.id!==id))throw new ServiceError(409,'CONTACT_PHONE_CONFLICT','Número já cadastrado. Selecione o Contato existente; duplicidades exigem revisão.')
    }
    if(old?.conversationId&&old.text!==ref.text)throw new ServiceError(409,'CONTACT_HISTORY_PROTECTED','Contato com histórico: use outra referência para informar outro telefone.')
    {
      const key=id??randomUUID(),data=JSON.stringify({...ref,...(old?.channelProvisional===1?{channelProvisional:1}:{}),nickname:source.nickname??(old as CustomerRecord&{nickname?:string})?.nickname??'',channelState:old?.channelState??'informed'})
      if(old){if(source.revision!==old.revision)throw new ServiceError(409,'VERSION_CONFLICT','Cadastro alterado em outra edição.');const changed=this.db.prepare('UPDATE customer_records SET data=?,entity_id=?,phone_normalized=?,revision=revision+1 WHERE id=? AND revision=?').run(data,entityId as string|null,phone,key,old.revision);if(!changed.changes)invalid()}
      else this.db.prepare('INSERT INTO customer_records(id,kind,data,entity_id,phone_normalized) VALUES(?,?,?,?,?)').run(key,String(kind),data,entityId as string|null,phone)
      for(const affected of this.db.prepare('SELECT DISTINCT atendimento_id FROM atendimento_references WHERE record_id=?').all(key))
        this.updateSearch(String(affected.atendimento_id))
      return this.record(key)
    }
  }
}
