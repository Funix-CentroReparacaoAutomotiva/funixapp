import {createHash} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {normalizeCustomerPhone,normalizeCustomerInputPhone} from './phone.ts'

type Entry={contactId:string;phone:string;atendimentos:string[];fingerprint:string}
export type HistoricalDialingPlan={entries:Entry[];deferred:number}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** V25-compatible repair: format conversion only. Do not change channel
 * identities, assign owners, attach conversations or merge records.
 * Conservative first batch: no channel evidence; every referencing case
 * must have exactly this person/contact and no conversation history. */
export function planHistoricalDialing(db:DatabaseSync):HistoricalDialingPlan {
 const rows=db.prepare("SELECT c.* FROM customer_records c WHERE c.kind='contact' AND json_extract(c.data,'$.canonicalContactId') IS NULL ORDER BY c.id").all()
 const groups=new Map<string,number>()
 for(const row of rows){
   const phone=normalizeCustomerInputPhone(String(JSON.parse(String(row.data)).text??''))
   if(phone)groups.set(phone,(groups.get(phone)??0)+1)
 }
 const entries:Entry[]=[]
 let candidates=0
 for(const row of rows){
   const data=JSON.parse(String(row.data)),raw=String(data.text??'')
   const phone=normalizeCustomerInputPhone(raw)
   if(!phone||normalizeCustomerPhone(raw))continue
   candidates++
   if(groups.get(phone)!==1||row.phone_normalized!==null||row.conversation_id||!row.entity_id||data.shortNumberReviewPending||
     !db.prepare("SELECT 1 FROM customer_records WHERE id=? AND kind='entity'").get(row.entity_id))continue
   const jid=phone.slice(1)+'@s.whatsapp.net'
   if(db.prepare('SELECT 1 FROM chat_provider_conversations WHERE remote_jid=?').get(jid)||
     db.prepare('SELECT 1 FROM v20_conversations WHERE remote_jid=?').get(jid)||
     db.prepare('SELECT 1 FROM chat_provider_alias_evidence WHERE pn=?').get(jid))continue
   const ats=db.prepare('SELECT DISTINCT atendimento_id FROM atendimento_references WHERE record_id=? ORDER BY atendimento_id').all(row.id!)
   const snapshots:unknown[]=[],ids:string[]=[]
   let safe=true
   for(const {atendimento_id} of ats){
     const at=String(atendimento_id)
     const record=db.prepare('SELECT id,phone,phone_normalized,revision,search_text FROM atendimentos WHERE id=?').get(at)
     const refs=db.prepare("SELECT kind,position,record_id,data FROM atendimento_references WHERE atendimento_id=? AND kind IN ('person','contact') ORDER BY kind,position").all(at)
     const people=refs.filter(r=>r.kind==='person'),contacts=refs.filter(r=>r.kind==='contact')
     if(!record||people.length!==1||contacts.length!==1||people[0]!.record_id!==row.entity_id||
       contacts[0]!.record_id!==row.id||people[0]!.position!==0||contacts[0]!.position!==0||
       normalizeCustomerInputPhone(String(record.phone??''))!==phone||
       record.phone_normalized!==null&&record.phone_normalized!==phone||
       JSON.parse(String(people[0]!.data)).participantKey!==JSON.parse(String(contacts[0]!.data)).participantKey||
       db.prepare('SELECT 1 FROM v20_associations WHERE atendimento_id=?').get(at)){
       safe=false;break
     }
     ids.push(at);snapshots.push([record,refs])
   }
   if(safe)entries.push({contactId:String(row.id),phone,atendimentos:ids,fingerprint:hash([row,snapshots])})
 }
 return {entries,deferred:candidates-entries.length}
}

export function applyHistoricalDialing(db:DatabaseSync,expected:HistoricalDialingPlan) {
 if(db.isTransaction)throw Error('Normalização requer transação própria.')
 db.exec('BEGIN IMMEDIATE')
 try{
   const current=planHistoricalDialing(db)
   if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('Plano de normalização desatualizado; gere nova simulação.')
   const update=db.prepare("UPDATE customer_records SET data=json_set(data,'$.text',?),phone_normalized=?,revision=revision+1 WHERE id=? AND phone_normalized IS NULL")
   const ref=db.prepare("UPDATE atendimento_references SET data=json_set(data,'$.text',?) WHERE atendimento_id=? AND kind='contact' AND record_id=?")
   const at=db.prepare("UPDATE atendimentos SET phone=?,phone_normalized=?,search_text=search_text||char(10)||?,revision=revision+1 WHERE id=?")
   let atendimentos=0
   for(const entry of current.entries){
     if(Number(update.run(entry.phone,entry.phone,entry.contactId).changes)!==1)throw Error('Contato alterado durante normalização.')
     for(const id of entry.atendimentos){
       if(Number(ref.run(entry.phone,id,entry.contactId).changes)!==1||
         Number(at.run(entry.phone,entry.phone,entry.phone,id).changes)!==1)throw Error('Atendimento alterado durante normalização.')
       atendimentos++
     }
   }
   if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Falha de integridade após normalização.')
   if(planHistoricalDialing(db).entries.length)throw Error('Normalização incompleta; operação revertida.')
   db.exec('COMMIT')
   return {contacts:current.entries.length,atendimentos,deferred:current.deferred}
 }catch(error){db.exec('ROLLBACK');throw error}
}
