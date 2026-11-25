import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {entityContactsFixture} from './fixtures/entity-contacts.ts'
import {planHistoricalDialing,applyHistoricalDialing} from '../historical-dialing.ts'

function seed(){
 const f=entityContactsFixture()
 const owner=f.customers.save({kind:'entity',text:'Pessoa A'})
 const legacy=(text:string)=>{
   const id=randomUUID()
   f.db.prepare("INSERT INTO customer_records(id,kind,data,entity_id,phone_normalized) VALUES(?,'contact',?,?,NULL)")
     .run(id,JSON.stringify({id:null,text,nickname:'preservar'}),owner.id)
   return id
 }
 const safe=legacy('031999990101')
 const collision=legacy('031999990202')
 f.customers.save({kind:'contact',text:'+5531999990202',entityId:owner.id})
 const observed=legacy('031999990303')
 f.channels.identities.rememberProviderConversation('5531999990303@s.whatsapp.net')
 const at=f.at.create({}).id
 f.db.prepare("UPDATE atendimentos SET phone='031999990101',phone_normalized=NULL WHERE id=?").run(at)
 const insert=f.db.prepare('INSERT INTO atendimento_references VALUES(?,?,?,?,?)')
 insert.run(at,'person',0,owner.id,JSON.stringify({id:owner.id,text:owner.text,participantKey:'p'}))
 insert.run(at,'contact',0,safe,JSON.stringify({id:safe,text:'031999990101',participantKey:'p'}))
 return {...f,owner,safe,collision,observed,caseId:at}
}
test('historical dialing normalization preserves ownership and IDs; defers conflicts and known channel evidence',()=>{
 const f=seed()
 try{
   const before=f.db.prepare('SELECT total_changes() n').get()!.n
   const plan=planHistoricalDialing(f.db)
   assert.deepEqual(plan.entries.map(e=>e.contactId),[f.safe])
   assert.equal(plan.deferred,2)
   assert.equal(f.db.prepare('SELECT total_changes() n').get()!.n,before)
   const histories=f.db.prepare('SELECT * FROM v20_associations').all()
   const messages=f.db.prepare('SELECT * FROM chat_messages').all()
   assert.deepEqual(applyHistoricalDialing(f.db,plan),{contacts:1,atendimentos:1,deferred:2})
   const contact=f.customers.record(f.safe)
   assert.equal(contact.text,'+5531999990101')
   assert.equal(contact.entityId,f.owner.id)
   assert.equal(f.customers.phoneMatches('+5531999990101')[0]?.id,f.safe)
   const at=f.at.get(f.caseId,true)
   assert.equal(at.phone,'+5531999990101')
   assert.equal(at.phoneNormalized,'+5531999990101')
   assert.equal(at.references!.contact[0]!.id,f.safe)
   assert.equal(at.references!.contact[0]!.participantKey,'p')
   assert.equal(f.customers.record(f.collision).text,'031999990202')
   assert.equal(f.customers.record(f.observed).text,'031999990303')
   assert.deepEqual(f.db.prepare('SELECT * FROM v20_associations').all(),histories)
   assert.deepEqual(f.db.prepare('SELECT * FROM chat_messages').all(),messages)
   assert.equal(planHistoricalDialing(f.db).entries.length,0)
 }finally{f.db.close()}
})
test('historical dialing rejects stale plan and rolls back writes on a failure',()=>{
 const f=seed()
 try{
   const plan=planHistoricalDialing(f.db)
   f.db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(f.caseId)
   assert.throws(()=>applyHistoricalDialing(f.db,plan),/desatualizado/)
   const fresh=planHistoricalDialing(f.db)
   f.db.exec("CREATE TRIGGER test_dialing_failure BEFORE UPDATE OF phone ON atendimentos BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
   assert.throws(()=>applyHistoricalDialing(f.db,fresh),/synthetic failure/)
   assert.equal(f.customers.record(f.safe).text,'031999990101')
   assert.equal(f.db.prepare('SELECT phone_normalized FROM customer_records WHERE id=?').get(f.safe)!.phone_normalized,null)
   assert.equal(f.db.isTransaction,false)
 }finally{f.db.close()}
})
