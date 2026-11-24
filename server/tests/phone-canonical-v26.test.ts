import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../database.ts'
import {migrate} from '../migrations.ts'
import {registerCustomerPhoneFunction} from '../customer-identity-schema.ts'
import {normalizeCustomerPhone} from '../phone.ts'
import {CustomerRepository} from '../customers.ts'
import {AtendimentoRepository} from '../atendimentos.ts'

test('Brazilian formatting resolves one canonical phone without inventing digits',()=>{
 const same=['+55 (31) 99999-0101','5531999990101','31 99999-0101',
   '031 99999-0101','03131 99999-0101','0 15 (31) 99999-0101']
 for(const input of same)assert.equal(normalizeCustomerPhone(input),'+5531999990101',input)
 for(const input of ['+55 (31) 3333-2222','553133332222','3133332222',
   '03133332222','0153133332222'])
   assert.equal(normalizeCustomerPhone(input),'+553133332222',input)
 assert.equal(normalizeCustomerPhone('+14155550123'),'+14155550123')
 for(const invalid of ['3199990101','03199990101','0319999010','0313199990101',
   '031 9999','11 91234','031 12345-6789','031 00000-0000','+55 031 99999-0101',
   '0031999990101','+55 (31) 99999-0101 ramal 2'])
   assert.equal(normalizeCustomerPhone(invalid),null,invalid)
})

function oldTrunkKey(db:ReturnType<typeof openDatabase>) {
 // Simulate the *previous release* SQL key function while constructing a V25
 // fixture. The production V26 migrator registers its canonical function again.
 db.function('funix_customer_phone',{deterministic:true},value=>
   typeof value==='string'&&value.startsWith('0')?null:
   typeof value==='string'?normalizeCustomerPhone(value):null)
 db.prepare('DELETE FROM schema_migrations WHERE version=26').run()
}

test('V26 rekeys V25 0DDD/0CSPDDD without changing registration IDs, references or names',()=>{
 const db=openDatabase(':memory:')
 try{
  const customers=new CustomerRepository(db),at=new AtendimentoRepository(db)
  const owner=customers.save({kind:'entity',text:'Titular sintético'})
  const record=at.create({name:'Titular sintético'})
  const refId=randomUUID()
  oldTrunkKey(db)
  db.prepare("INSERT INTO customer_records(id,kind,data,entity_id,phone_normalized) VALUES(?,'contact',?,?,NULL)")
    .run(refId,JSON.stringify({id:null,text:'031999990101'}),owner.id)
  db.prepare("INSERT INTO atendimento_references(atendimento_id,kind,position,record_id,data) VALUES(?,'contact',0,?,?)")
    .run(record.id,refId,JSON.stringify({id:refId,text:'031999990101'}))
  db.prepare("UPDATE atendimentos SET phone=?,phone_normalized=NULL WHERE id=?")
    .run('03131 99999-0101',record.id)
  registerCustomerPhoneFunction(db)
  migrate(db)
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,26)
  assert.equal(db.prepare('SELECT phone_normalized FROM customer_records WHERE id=?').get(refId)!.phone_normalized,'+5531999990101')
  assert.equal(db.prepare('SELECT phone_normalized FROM atendimentos WHERE id=?').get(record.id)!.phone_normalized,'+5531999990101')
  assert.equal(customers.phoneMatches('+5531999990101')[0]?.id,refId)
  assert.equal(at.get(record.id,true).references!.contact[0]!.id,refId)
  assert.equal(customers.record(refId).text,'031999990101')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  migrate(db)
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get()!.total,26)
 }finally{db.close()}
})

test('V26 refuses a canonical collision and rolls back all derived changes',()=>{
 const db=openDatabase(':memory:')
 try{
  const customers=new CustomerRepository(db)
  const owner=customers.save({kind:'entity',text:'Pessoa A',contacts:[{text:'+5531999990101'}]})
  const already=customers.contacts(owner.id)[0]!
  const other=customers.save({kind:'entity',text:'Pessoa B'})
  const secondId=randomUUID()
  oldTrunkKey(db)
  db.prepare("INSERT INTO customer_records(id,kind,data,entity_id,phone_normalized) VALUES(?,'contact',?,?,NULL)")
    .run(secondId,JSON.stringify({id:null,text:'031999990101'}),other.id)
  registerCustomerPhoneFunction(db)
  assert.throws(()=>migrate(db),/V26 bloqueada/)
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,25)
  assert.equal(db.prepare('SELECT phone_normalized FROM customer_records WHERE id=?').get(secondId)!.phone_normalized,null)
  assert.equal(db.prepare('SELECT phone_normalized FROM customer_records WHERE id=?').get(already.id)!.phone_normalized,'+5531999990101')
  assert.equal(customers.record(secondId).text,'031999990101')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})
