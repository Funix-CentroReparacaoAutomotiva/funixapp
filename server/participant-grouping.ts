import {createHash} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {participantInventory} from './customer-inventory.ts'

type Change={kind:'person'|'contact';position:number;key:string}
type Entry={atendimentoId:string;fingerprint:string;changes:Change[]}
export type ParticipantGroupingPlan={entries:Entry[];deferred:number}

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const validKey=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9:_-]{1,120}$/.test(value)
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)

/** Deliberately narrower than the inventory: only explicit, active canonical
 * registrations, already selected in the same case, with no change of primary
 * recipient. No new contact/person, association, alias or ownership is created.
 */
export function planParticipantGrouping(db:DatabaseSync):ParticipantGroupingPlan {
 const inventory=participantInventory(db)
 const mismatch=new Set(inventory.primaryMismatch)
 const entries:Entry[]=[]
 const read=db.prepare("SELECT r.kind,r.position,r.record_id,r.data,c.kind AS registered_kind,c.entity_id,c.data AS registered_data FROM atendimento_references r LEFT JOIN customer_records c ON c.id=r.record_id WHERE r.atendimento_id=? AND r.kind IN ('person','contact') ORDER BY r.kind,r.position")
 for(const atendimentoId of inventory.groupingCandidates){
   if(mismatch.has(atendimentoId))continue
   const rows=read.all(atendimentoId)
   const data=rows.map(r=>JSON.parse(String(r.data)) as unknown)
   if(data.some(d=>!isObject(d)))continue
   const people=rows.filter(r=>r.kind==='person'),contacts=rows.filter(r=>r.kind==='contact')
   if(!people.length||!contacts.length||people[0]?.position!==0||contacts[0]?.position!==0)continue
   if(rows.some(r=>!r.record_id||!r.registered_data||r.registered_kind!==(r.kind==='person'?'entity':'contact')||
     JSON.parse(String(r.registered_data)).canonicalContactId))continue
   if(contacts[0]?.entity_id!==people[0]?.record_id)continue
   const keys=new Map<string,string>(),used=new Set<string>(),changes:Change[]=[]
   let safe=true
   for(const p of people){
     const raw=JSON.parse(String(p.data))
     const key=raw.participantKey??'entity:'+String(p.record_id)
     if(!validKey(key)||used.has(key)){safe=false;break}
     keys.set(String(p.record_id),key);used.add(key)
     if(raw.participantKey!==key)changes.push({kind:'person',position:Number(p.position),key})
   }
   if(!safe)continue
   for(const c of contacts){
     const key=keys.get(String(c.entity_id)),raw=JSON.parse(String(c.data))
     if(!key||(raw.participantKey!==undefined&&raw.participantKey!==key)){safe=false;break}
     if(raw.participantKey!==key)changes.push({kind:'contact',position:Number(c.position),key})
   }
   if(!safe||!changes.length)continue
   const revision=db.prepare('SELECT revision FROM atendimentos WHERE id=?').get(atendimentoId)?.revision
   entries.push({atendimentoId,fingerprint:hash([revision,rows]),changes})
 }
 return {entries,deferred:inventory.groupingCandidates.length-entries.length}
}

/** Offline copy only. Revalidate the entire plan inside a write transaction.
 * Writes grouping metadata and optimistic revision only; primary projection,
 * selection order, contact IDs, ownership, messages and documents are unchanged.
 */
export function applyParticipantGrouping(db:DatabaseSync,expected:ParticipantGroupingPlan) {
 if(db.isTransaction)throw Error('Agrupamento requer transação própria.')
 db.exec('BEGIN IMMEDIATE')
 try{
   const current=planParticipantGrouping(db)
   if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('Plano de agrupamento desatualizado; gere novo inventário.')
   const update=db.prepare("UPDATE atendimento_references SET data=json_set(data,'$.participantKey',?) WHERE atendimento_id=? AND kind=? AND position=?")
   let references=0
   for(const entry of current.entries){
     for(const change of entry.changes){
       if(Number(update.run(change.key,entry.atendimentoId,change.kind,change.position).changes)!==1)
         throw Error('Referência alterada durante o agrupamento.')
       references++
     }
     db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(entry.atendimentoId)
   }
   if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Falha de integridade após agrupamento.')
   const remaining=planParticipantGrouping(db)
   if(remaining.entries.length)throw Error('Agrupamento incompleto; operação revertida.')
   db.exec('COMMIT')
   return {atendimentos:current.entries.length,references,deferred:remaining.deferred}
 }catch(error){db.exec('ROLLBACK');throw error}
}
