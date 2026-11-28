import {chmodSync,closeSync,lstatSync,openSync,writeFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {customerInventory,participantInventory,dialingPrefixInventory} from './customer-inventory.ts'
import {normalizeCustomerPhone} from './phone.ts'

const [source,privateReport,...extra]=process.argv.slice(2)
if(!source||extra.length||!lstatSync(source).isFile())
  throw Error('Uso: node server/inventory-customer-copy.ts COPIA_EXISTENTE [RELATORIO_PRIVADO_NOVO]')
const db=new DatabaseSync(source,{readOnly:true})
try{
  db.exec('BEGIN')
  const version=Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v)
  if(![23,24,25,26,27,28,29,30,31,32,33].includes(version))throw Error('O inventário requer uma cópia V23 a V33.')
  if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)
    throw Error('A cópia tem falhas de integridade.')
  const inventory=customerInventory(db)
  const participants=participantInventory(db)
  const dialing=dialingPrefixInventory(db)
  const dialingCounts=Object.fromEntries(Object.entries(dialing).map(([key,ids])=>[key,ids.length]))
  const participantCounts=Object.fromEntries(Object.entries(participants).map(([key,ids])=>[key,ids.length]))
  const contacts=db.prepare("SELECT id,entity_id,conversation_id,phone_normalized,data FROM customer_records WHERE kind='contact' AND json_extract(data,'$.canonicalContactId') IS NULL").all()
  const nullKeysWithPhone=contacts.filter(row=>row.phone_normalized===null&&normalizeCustomerPhone(String(JSON.parse(String(row.data)).text??''))).map(row=>row.id)
  const differingKeys=contacts.filter(row=>row.phone_normalized!==null&&row.phone_normalized!==normalizeCustomerPhone(String(JSON.parse(String(row.data)).text??''))).map(row=>row.id)
  const missingOwners=contacts.filter(row=>!row.entity_id).map(row=>row.id)
  const links=db.prepare(`SELECT l.id,l.conversation_id,v.remote_jid,v.instance FROM v20_associations l
    JOIN v20_conversations v ON v.id=l.conversation_id WHERE l.unlinked_at IS NULL ORDER BY l.id`).all()
  const handles=db.prepare('SELECT id,instance,remote_jid FROM chat_provider_conversations').all()
  const aliases=db.prepare('SELECT instance,pn,lid FROM chat_provider_alias_evidence').all()
  const hasReviewSchema=!!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='chat_confirmed_short_numbers'").get()
  const readOnlyContact=hasReviewSchema?db.prepare(`SELECT c.contact_id, s.contact_id IS NOT NULL AS confirmed,
    json_extract(r.data,'$.shortNumberReviewPending')=1 AS pending
    FROM customer_channel_contacts c JOIN customer_records r ON r.id=c.contact_id
    LEFT JOIN chat_confirmed_short_numbers s ON s.contact_id=c.contact_id WHERE c.conversation_id=?`):null
  const missingChannelContacts=[],channelConflicts=[],shortNumbersPending=[]
  let reviewedHistoryLinks=0
  for(const link of links){
    const edges=aliases.filter(edge=>edge.instance===link.instance&&(edge.pn===link.remote_jid||edge.lid===link.remote_jid))
    const jids=new Set([link.remote_jid,...edges.flatMap(edge=>[edge.pn,edge.lid])])
    const ids=new Set(handles.filter(handle=>handle.instance===link.instance&&jids.has(handle.remote_jid)).map(handle=>handle.id))
    const found=contacts.filter(contact=>ids.has(contact.conversation_id))
    const pn=[...jids].find(jid=>String(jid).endsWith('@s.whatsapp.net'))
    const phone=pn?normalizeCustomerPhone('+'+String(pn).split('@')[0]):null
    const exact=found.length===1?found[0]:undefined
    const text=exact?String(JSON.parse(String(exact.data)).text??''):''
    const identityConflict=edges.some(edge=>aliases.some(other=>other.instance===edge.instance&&
      (other.pn===edge.pn&&other.lid!==edge.lid||other.lid===edge.lid&&other.pn!==edge.pn)))
    const readOnly=exact&&readOnlyContact?.get(link.conversation_id!)
    if(!identityConflict&&exact&&readOnly&&readOnly.contact_id===exact.id&&exact.entity_id&&!inventory.invalidOwners.includes(String(exact.id))){
      if(readOnly.confirmed===1){reviewedHistoryLinks++;continue}
      if(readOnly.pending===1){shortNumbersPending.push(link.id);continue}
    }
    if(!found.length)missingChannelContacts.push(link.id)
    else if(identityConflict||!exact?.entity_id||inventory.invalidOwners.includes(String(exact.id))||
      (pn?!phone||normalizeCustomerPhone(text)!==phone:text!==''))
      channelConflicts.push(link.id)
  }
  const textual=db.prepare(`SELECT atendimento_id,data FROM atendimento_references WHERE kind='contact' AND record_id IS NULL
    UNION ALL
    SELECT id AS atendimento_id,json_object('text',phone) AS data FROM atendimentos a
    WHERE NOT EXISTS(SELECT 1 FROM atendimento_references r WHERE r.atendimento_id=a.id AND r.kind='contact')`).all()
  const unresolvedIdentifiedPhones=[...new Set(textual.filter(row=>normalizeCustomerPhone(String(JSON.parse(String(row.data)).text??''))).map(row=>row.atendimento_id))]
  const details={unresolvedIdentifiedPhones,duplicateGroups:inventory.duplicateGroups,nullKeysWithPhone,differingKeys,missingOwners,missingChannelContacts,channelConflicts,shortNumbersPending}
  if(privateReport){
    const fd=openSync(privateReport,'wx',0o600)
    try{chmodSync(privateReport,0o600);writeFileSync(fd,JSON.stringify({version,...details,participants,dialing},null,2)+'\n')}
    finally{closeSync(fd)}
  }
  const counts=Object.fromEntries(Object.entries(details).map(([key,rows])=>[key,rows.length]))
  const needsReview=Object.values(counts).some(count=>count>0)||participants.groupingCandidates.length>0||participants.ownerMissingFromCase.length>0||participants.unresolvedPhones.length>0||participants.ownerConflicts.length>0||Object.values(dialingCounts).some(count=>count>0)
  process.stdout.write(JSON.stringify({version,...counts,reviewedHistoryLinks,unresolvedReferences:inventory.partialReferences,participants:participantCounts,dialing:dialingCounts,needsReview})+'\n')
  if(needsReview)process.exitCode=2
}finally{db.close()}
