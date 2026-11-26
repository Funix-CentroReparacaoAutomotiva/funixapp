import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {normalizeCustomerPhone,normalizeCustomerInputPhone} from '../phone.ts'
import {dialingPrefixInventory} from '../customer-inventory.ts'
import {entityContactsFixture} from './fixtures/entity-contacts.ts'
import {PossibleDuplicateAtendimentoError} from '../atendimentos.ts'

const phone='+5531999990101'
test('civil phone entry recognizes complete Brazilian dialing prefixes without changing V25 or provider normalization',()=>{
 for(const input of [phone,'(31) 99999-0101','5531999990101','031999990101','0 31 99999-0101','0 15 31 99999-0101'])
   assert.equal(normalizeCustomerInputPhone(input),phone,input)
 for(const input of ['03133332222','0153133332222'])
   assert.equal(normalizeCustomerInputPhone(input),'+553133332222',input)
 for(const invalid of ['03188888888','03199990101','99999-0101','+55031999990101','031999990101 ramal 2','0031999990101'])
   assert.equal(normalizeCustomerInputPhone(invalid),null,invalid)
 assert.equal(normalizeCustomerInputPhone('+14155550123'),'+14155550123')
 assert.equal(normalizeCustomerPhone('031999990101'),null)
 assert.equal(normalizeCustomerPhone('01531999990101'),null)
})

test('manual phone with dialing prefix reuses canonical Contact; duplicate warning still applies',()=>{
 const f=entityContactsFixture()
 try{
   const owner=f.customers.save({kind:'entity',text:'Pessoa sintética',contacts:[{text:'031999990101'}]})
   const contact=f.customers.contacts(owner.id)[0]!
   assert.equal(contact.text,phone)
   assert.equal(f.customers.search('contact','0 15 31 99999-0101')[0]?.id,contact.id)
   const draft={references:{person:[{id:null,text:'Nome livre',participantKey:'p'}],contact:[{id:null,text:'01531999990101',participantKey:'p'}],vehicle:[],payer:[]}}
   const first=f.at.create(draft,false,true)
   assert.equal(first.references!.person[0]!.id,owner.id)
   assert.equal(first.references!.contact[0]!.id,contact.id)
   assert.throws(()=>f.at.create(draft,false,true),PossibleDuplicateAtendimentoError)
   const renamed=f.customers.save({text:'Pessoa renomeada',revision:owner.revision,contacts:[{id:contact.id,text:contact.text,revision:contact.revision},{text:'0 31 99999-0101'}]},owner.id)
   assert.equal(renamed.text,'Pessoa renomeada')
   assert.equal(f.customers.contacts(owner.id).length,1)
   assert.equal(f.at.get(first.id,true).references!.contact[0]!.id,contact.id)
 }finally{f.db.close()}
})

test('historical dialing prefix candidates and collisions are inventoried without writes; manual creation does not add duplicates',()=>{
 const f=entityContactsFixture()
 try{
   const a=f.customers.save({kind:'entity',text:'A',contacts:[{text:phone}]})
   const b=f.customers.save({kind:'entity',text:'B'})
   const old=randomUUID()
   f.db.prepare("INSERT INTO customer_records(id,kind,data,entity_id,phone_normalized) VALUES(?,'contact',?,?,NULL)")
     .run(old,JSON.stringify({id:null,text:'031999990101'}),b.id)
   const original=f.db.prepare('SELECT total_changes() n').get()!.n
   const inventory=dialingPrefixInventory(f.db)
   assert.deepEqual(inventory.newlyRecognized,[old])
   assert.equal(inventory.collisionGroups.length,1)
   assert.ok(inventory.collisionGroups[0]!.includes(f.customers.contacts(a.id)[0]!.id))
   assert.equal(f.db.prepare('SELECT total_changes() n').get()!.n,original)
   assert.throws(()=>f.at.create({name:'Nome livre',phone:'031999990101'},false,true),e=>(e as {code?:string}).code==='CONTACT_PHONE_RECONCILIATION_REQUIRED')
   assert.equal(f.at.list().total,0)
   assert.equal(f.customers.contacts(b.id).length,1)
   assert.equal(f.customers.record(old).text,'031999990101')
 }finally{f.db.close()}
})
