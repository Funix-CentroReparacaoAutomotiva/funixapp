import type {DatabaseSync} from 'node:sqlite'
import {normalizeCustomerPhone as normalizePhone,normalizeCustomerInputPhone} from './phone.ts'
/** Read-only inventory. IDs/counts only: no names, phone numbers, messages or documents in report. */
export function customerInventory(db:DatabaseSync) {
 const records=db.prepare('SELECT id,kind,data,entity_id,conversation_id FROM customer_records ORDER BY id').all()
 const numbers=new Map<string,string[]>(),incomplete:string[]=[],invalidOwners:string[]=[],technicalReview:string[]=[]
 for(const row of records){
  if(row.kind!=='contact')continue
  const phone=normalizePhone(String(JSON.parse(String(row.data)).text??''))
  if(phone)numbers.set(phone,[...(numbers.get(phone)??[]),String(row.id)]);else incomplete.push(String(row.id))
  if(row.entity_id&&!records.some(r=>r.id===row.entity_id&&r.kind==='entity'))invalidOwners.push(String(row.id))
  if(row.conversation_id)technicalReview.push(String(row.id)) // Existing evidence must be revalidated before new contact-scoped sending.
 }
 const duplicateGroups=[...numbers.values()].filter(ids=>ids.length>1)
 return {entities:records.filter(r=>r.kind==='entity').length,contacts:records.filter(r=>r.kind==='contact').length,
   explicitOwners:records.filter(r=>r.kind==='contact'&&r.entity_id).length,
   partialReferences:Number(db.prepare('SELECT count(*) n FROM atendimento_references WHERE record_id IS NULL').get()!.n),
   duplicateGroups,incomplete,invalidOwners,technicalReview,
   automaticAssociations:0,policy:'Preserve explicit IDs and relations. Exact normalized number is lookup data, not authority to merge or assign a person.'}
}

/** Classify legacy Atendimento references without assigning ownership from
 * array positions, free-text names or coincident phone numbers.
 * Report contains only Atendimento IDs and counts. No writes. */
export function participantInventory(db:DatabaseSync) {
 const records=new Map(db.prepare("SELECT id,kind,entity_id,data FROM customer_records").all().map(r=>[String(r.id),r]))
 const rows=db.prepare("SELECT atendimento_id,kind,position,record_id,data FROM atendimento_references WHERE kind IN ('person','contact') ORDER BY atendimento_id,kind,position").all()
 const byAt=new Map<string,typeof rows>()
 for(const row of rows){
   const id=String(row.atendimento_id),group=byAt.get(id)??[]
   group.push(row);byAt.set(id,group)
 }
 const groupingCandidates:string[]=[],alreadyGrouped:string[]=[],ownerMissingFromCase:string[]=[],
   unresolvedPhones:string[]=[],ownerConflicts:string[]=[],primaryMismatch:string[]=[],withoutPhone:string[]=[]
 for(const a of db.prepare('SELECT id,phone FROM atendimentos ORDER BY id').all()){
   const id=String(a.id),refs=byAt.get(id)??[]
   const people=refs.filter(r=>r.kind==='person'),contacts=refs.filter(r=>r.kind==='contact')
   const keys=new Set<string>(),owners=new Set<string>()
   let conflict=false,missing=false,unresolved=false,candidate=false,confirmed=0
   for(const p of people){
     const data=JSON.parse(String(p.data))
     const key=data.participantKey
     if(key){if(keys.has(key))conflict=true;keys.add(key)}
     if(p.record_id){
       if(records.get(String(p.record_id))?.kind!=='entity'||owners.has(String(p.record_id)))conflict=true
       owners.add(String(p.record_id))
     }
   }
   const seen=new Set<string>()
   for(const c of contacts){
     const data=JSON.parse(String(c.data))
     if(!c.record_id){if(String(data.text??'').trim())unresolved=true;continue}
     const record=records.get(String(c.record_id))
     if(seen.has(String(c.record_id)))conflict=true
     seen.add(String(c.record_id))
     if(record?.kind!=='contact'||!record.entity_id||records.get(String(record.entity_id))?.kind!=='entity'){
       unresolved=true;continue
     }
     const matches=people.filter(p=>p.record_id===record.entity_id)
     if(matches.length!==1){missing=true;continue}
     const key=JSON.parse(String(matches[0]!.data)).participantKey
     if(data.participantKey&&data.participantKey!==key){conflict=true;continue}
     confirmed++
     if(!key||!data.participantKey)candidate=true
   }
   if(!contacts.length&&String(a.phone??'').trim())unresolved=true
   if(!contacts.some(c=>c.record_id||String(JSON.parse(String(c.data)).text??'').trim())&&!String(a.phone??'').trim())withoutPhone.push(id)
   const first=contacts[0],primary=people[0]
   const firstOwner=first?.record_id?records.get(String(first.record_id))?.entity_id:null
   if(firstOwner&&primary?.record_id&&firstOwner!==primary.record_id)primaryMismatch.push(id)
   if(conflict)ownerConflicts.push(id)
   if(missing)ownerMissingFromCase.push(id)
   if(unresolved)unresolvedPhones.push(id)
   // Only existing explicit, consistent owners are eligible for a metadata-only
   // grouping proposal. A single unresolved row excludes the entire case.
   if(!conflict&&!missing&&!unresolved&&confirmed){
     if(candidate)groupingCandidates.push(id)
     else alreadyGrouped.push(id)
   }
 }
 return {groupingCandidates,alreadyGrouped,ownerMissingFromCase,unresolvedPhones,ownerConflicts,primaryMismatch,withoutPhone}
}

/** Prospective civil input keys; do not change the V25 key function. IDs only. */
export function dialingPrefixInventory(db:DatabaseSync) {
 const groups=new Map<string,string[]>(),newlyRecognized:string[]=[],textualAtendimentos:string[]=[]
 for(const row of db.prepare("SELECT id,data FROM customer_records WHERE kind='contact' AND json_extract(data,'$.canonicalContactId') IS NULL ORDER BY id").all()){
   const raw=String(JSON.parse(String(row.data)).text??'')
   const phone=normalizeCustomerInputPhone(raw)
   if(!phone)continue
   groups.set(phone,[...(groups.get(phone)??[]),String(row.id)])
   if(!normalizePhone(raw))newlyRecognized.push(String(row.id))
 }
 for(const row of db.prepare("SELECT id,phone FROM atendimentos UNION ALL SELECT atendimento_id AS id,json_extract(data,'$.text') AS phone FROM atendimento_references WHERE kind='contact' AND record_id IS NULL").all()){
   const raw=String(row.phone??'')
   if(!normalizePhone(raw)&&normalizeCustomerInputPhone(raw))textualAtendimentos.push(String(row.id))
 }
 return {newlyRecognized,collisionGroups:[...groups.values()].filter(ids=>ids.length>1&&ids.some(id=>newlyRecognized.includes(id))),textualAtendimentos:[...new Set(textualAtendimentos)].sort()}
}
