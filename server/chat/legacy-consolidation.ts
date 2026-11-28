import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {CustomerRepository} from '../customers.ts'
import {normalizePhone} from '../phone.ts'
import {LocalConversationAssociations} from './local-associations.ts'
import {CodaEventSyncRepository} from './coda-sync.ts'

export {normalizeCustomerPhone as normalizeLegacyPhone} from '../phone.ts'
import {normalizeCustomerPhone as normalizeLegacyPhone} from '../phone.ts'

/** Offline preparation on a database copy. No network, no message or Atendimento changes in count.
 * Preview rolls back the same transaction that apply would commit.
 */
export function consolidateLegacyCustomers(db:DatabaseSync,apply=false) {
  const report={legacyLinks:0,copiedLinks:0,existingLinks:0,unlinkedPreserved:0,blockedLinks:0,
    reconciled:0,alreadyShared:0,pending:0,withoutChannel:0,contextReview:0,restoredContexts:0,normalizedLegacy:0,duplicateContactPhones:0,contactsInDuplicateGroups:0,pendingReasons:{} as Record<string,number>,contextReasons:{} as Record<string,number>}
  const pending=(reason:string,n=1)=>{report.pending+=n;report.pendingReasons[reason]=(report.pendingReasons[reason]??0)+n}
  const contextReview=(reason:string)=>{report.contextReview++;report.contextReasons[reason]=(report.contextReasons[reason]??0)+1}
  const customers=new CustomerRepository(db),local=new LocalConversationAssociations(db)
  const table=(name:string)=>!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)
  db.exec('BEGIN IMMEDIATE')
  try {
    const version=Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v)
    if(![23,24,25,26,27,28,29,30,31,32,33].includes(version))
      throw Error('Requer cópia do banco V23 a V33.')
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Banco com referências inválidas.')
    if(table('coda_sync_conversation_links')){
      const rows=db.prepare(`SELECT l.remote_jid,l.first_seen_at,a.atendimento_id
        FROM coda_sync_conversation_links l JOIN coda_sync_atendimentos a ON a.coda_row_id=l.coda_row_id
        WHERE l.instance='funix_comercial' ORDER BY l.first_seen_at,l.remote_jid,a.atendimento_id`).all()
      for(const row of rows){
        report.legacyLinks++
        const jid=String(row.remote_jid),at=String(row.atendimento_id)
        if(!local.identityJids(jid)){report.blockedLinks++;continue}
        const cid=local.rememberProviderConversation(jid),scope=local.associationScope(cid)
        const old=db.prepare(`SELECT unlinked_at FROM v20_associations WHERE atendimento_id=?
          AND conversation_id IN (${scope.map(()=>'?').join(',')})`).all(at,...scope)
        if(old.some(link=>link.unlinked_at===null)){report.existingLinks++;continue}
        if(old.length){report.unlinkedPreserved++;continue}
        if(version>=25&&
          Number(db.prepare('SELECT COUNT(*) AS n FROM customer_channel_contacts WHERE conversation_id=?').get(cid)?.n)!==1){
          report.blockedLinks++
          continue
        }
        db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)')
          .run(randomUUID(),cid,at,String(row.first_seen_at),'system','legacy_cutover_confirmed_coda_link')
        db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(cid)
        report.copiedLinks++
      }
    }
    // Restore a confirmed active context only when there is no local decision to override.
    // Conflicts and unresolved differences are held; no historical links are removed.
    if(table('coda_sync_active_conversations')){
      const legacy=new CodaEventSyncRepository(db),seen=new Set<string>()
      for(const row of db.prepare("SELECT remote_jid FROM coda_sync_active_conversations WHERE instance='funix_comercial'").all()){
        const jid=String(row.remote_jid)
        if(!local.identityJids(jid)){contextReview('alias_unresolved');continue}
        const cid=local.rememberProviderConversation(jid),scope=local.associationScope(cid)
        const key=[...scope].sort().join(',')
        if(seen.has(key))continue
        seen.add(key)
        const expected=legacy.resolveIdentityActive(jid)
        const actual=local.resolveIdentityActive(jid)
        const marks=scope.map(()=>'?').join(',')
        const hold=(reason:string)=>{db.prepare('INSERT OR IGNORE INTO chat_local_context_holds VALUES(?,?)').run(cid,'legacy_cutover_context_review');contextReview(reason)}
        if(!expected){hold('legacy_context_unresolved');continue}
        if(actual===expected)continue
        const explicit=db.prepare(`SELECT 1 FROM v20_conversations WHERE id IN (${marks}) AND context_revision>0`).get(...scope)
          ||db.prepare(`SELECT 1 FROM v20_active_context WHERE conversation_id IN (${marks})`).get(...scope)
          ||db.prepare(`SELECT 1 FROM chat_local_context_holds WHERE conversation_id IN (${marks})`).get(...scope)
        const links=local.links(jid).filter(l=>l.atendimento_id===expected)
        if(explicit||links.length!==1){hold(explicit?'local_decision_preserved':'link_not_unique');continue}
        db.prepare('INSERT INTO v20_active_context(conversation_id,link_id) VALUES(?,?)').run(links[0]!.conversation_id!,links[0]!.id!)
        db.prepare(`UPDATE v20_conversations SET context_revision=context_revision+1 WHERE id IN (${marks})`).run(...scope)
        report.restoredContexts++
      }
    }
    type Candidate={at:string;phone:string;jid:string|null;name:string;personId:string|null;contactId:string|null;normalized:boolean}
    const groups=new Map<string,Candidate[]>(),unsafe=new Set<string>()
    for(const row of db.prepare('SELECT id FROM atendimentos ORDER BY id').all()){
      const at=String(row.id),refs=customers.references(at)
      const links=db.prepare(`SELECT DISTINCT c.remote_jid FROM v20_associations l JOIN v20_conversations c ON c.id=l.conversation_id
        WHERE l.atendimento_id=? AND l.unlinked_at IS NULL AND c.instance='funix_comercial'`).all(at)
      if(!links.length)report.withoutChannel++
      const jids=links.map(link=>String(link.remote_jid)),members=jids.map(jid=>local.identityJids(jid))
      const savedPhones=refs.contact.flatMap(ref=>{const phone=normalizeLegacyPhone(ref.text);return phone?[phone]:[]})
      const phones=[...new Set(links.length
        ?members.flatMap(set=>set?.filter(jid=>/^[1-9][0-9]{7,14}@s\.whatsapp\.net$/.test(jid)).map(jid=>'+'+jid.split('@')[0]!)??[])
        :savedPhones)]
      const person=refs.person[0],phone=phones[0]
      const valid=!!phone&&normalizeLegacyPhone(phone)===phone&&phones.length===1&&members.every(set=>set?.includes(phone.slice(1)+'@s.whatsapp.net'))&&
        refs.person.length===1&&!!person?.text.trim()&&refs.contact.length<=1&&
        refs.contact.every(ref=>!ref.text||normalizeLegacyPhone(ref.text)===phone)
      if(!valid){
        pending(phone&&normalizeLegacyPhone(phone)!==phone?'unusable_provider_number':!phone?(links.length?'chat_without_confirmed_number':refs.contact.some(r=>r.text.trim())?'invalid_phone':'missing_phone'):
          phones.length>1?'multiple_numbers':refs.person.length>1?'multiple_people':!person?.text.trim()?'missing_name':
          refs.contact.length>1?'multiple_contacts':'phone_chat_mismatch')
        for(const p of [...phones,...savedPhones])unsafe.add(p);continue
      }
      const candidate={at,phone:phone!,jid:jids[0]??null,name:person!.text.trim(),personId:person!.id,contactId:refs.contact[0]?.id??null,normalized:refs.contact.some(r=>!!r.text&&!normalizePhone(r.text)&&normalizeLegacyPhone(r.text)===phone)}
      const list=groups.get(candidate.phone)??[];list.push(candidate);groups.set(candidate.phone,list)
    }
    // Count all ambiguous keys, including contacts without an Atendimento.
    const contactCounts=new Map<string,number>()
    for(const row of db.prepare("SELECT data FROM customer_records WHERE kind='contact'").all()){
      const phone=normalizeLegacyPhone(String(JSON.parse(String(row.data)).text??''))
      if(phone)contactCounts.set(phone,(contactCounts.get(phone)??0)+1)
    }
    for(const count of contactCounts.values())if(count>1){
      report.duplicateContactPhones++
      report.contactsInDuplicateGroups+=count
    }
    for(const [phone,list]of groups){
      const ids=[...new Set(list.map(c=>c.personId).filter((id):id is string=>id!==null))]
      const names=new Set(list.map(c=>c.name))
      if(unsafe.has(phone)||ids.length>1||names.size!==1){pending(unsafe.has(phone)?'number_with_unsafe_case':ids.length>1?'distinct_entities':'different_names',list.length);continue}
      const jid=list.find(c=>c.jid)?.jid??null
      const channel=jid?local.rememberProviderConversation(jid):null,scope=channel?local.associationScope(channel):[]
      const byChannel=scope.length?db.prepare(`SELECT id FROM customer_records WHERE kind='contact'
        AND conversation_id IN (${scope.map(()=>'?').join(',')})`).all(...scope).map(row=>customers.record(String(row.id))):[]
      const byReference=list.flatMap(c=>c.contactId?[customers.record(c.contactId)]:[])
      const matches=[...new Map([...customers.phoneMatches(phone),...byChannel,...byReference].map(c=>[c.id,c])).values()]
      const contact=matches[0]??null
      if(matches.length>1||contact&&contact.kind!=='contact'||contact?.conversationId&&channel&&!scope.includes(contact.conversationId)||
        contact?.text&&normalizeLegacyPhone(contact.text)!==phone||contact?.conversationId&&!channel&&!contact.text){
        pending('contact_conflict',list.length)
        continue
      }
      let person=ids.length?customers.record(ids[0]!):null
      if(contact?.entityId){
        const owner=customers.record(contact.entityId)
        if(person&&person.id!==owner.id||owner.text!==list[0]!.name){pending('owner_mismatch',list.length);continue}
        person=owner
      }
      // A name alone does not identify an unrelated existing Entity.
      if(!person&&db.prepare("SELECT 1 FROM customer_records WHERE kind='entity' AND trim(json_extract(data,'$.text'))=?").get(list[0]!.name)){
        pending('same_name_existing_entity',list.length);continue
      }
      const saved=customers.confirmChannelContact(person,list[0]!.name,contact,phone,channel)
      for(const candidate of list){
        const refs=customers.references(candidate.at)
        if(refs.person[0]?.id===saved.person.id&&refs.contact.some(ref=>ref.id===saved.contact.id)){report.alreadyShared++;continue}
        customers.reconcileParticipant(candidate.at,refs,saved.person,saved.contact,candidate.personId?undefined:0,refs.contact.length===1&&!refs.contact[0]!.id?0:undefined)
        report.reconciled++
        if(candidate.normalized)report.normalizedLegacy++
      }
    }
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Consolidação com referências inválidas.')
    db.exec(apply?'COMMIT':'ROLLBACK')
    return report
  }catch(error){db.exec('ROLLBACK');throw error}
}
