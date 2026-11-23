import type {DatabaseSync} from 'node:sqlite'
import {normalizePhone} from './atendimentos.ts'
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
