import {test} from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CustomerRepository} from '../customers.ts'
import {createCodaEventSchema,CodaEventSyncRepository} from '../chat/coda-sync.ts'
import {LocalConversationAssociations} from '../chat/local-associations.ts'
import {consolidateLegacyCustomers,normalizeLegacyPhone} from '../chat/legacy-consolidation.ts'

const pn='5531999990101@s.whatsapp.net'
function fixture(){
  const db=openDatabase(':memory:');createCodaEventSchema(db)
  const coda=new CodaEventSyncRepository(db),at=new AtendimentoRepository(db),customers=new CustomerRepository(db)
  const record=(id:string,name:string)=>coda.sync({version:1,source:'coda',eventId:'synthetic:'+id,codaRowId:'i-'+id,instance:'funix_comercial',remoteJid:pn,phoneE164:null,displayName:name,occurredAt:1794144000+Number(id.slice(-1))}).atendimentoId
  return {db,at,customers,record}
}
test('Coda legacy name without phone: preview rolls back, apply shares person and number, replay is idempotent',()=>{
  const f=fixture()
  try{
    const at=f.record('TEST1','Pessoa sintética')
    assert.equal(f.at.get(at,true).phone,'')
    const preview=consolidateLegacyCustomers(f.db)
    assert.equal(preview.copiedLinks,1);assert.equal(preview.reconciled,1)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM customer_records').get()!.n,0)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM v20_associations').get()!.n,0)
    assert.deepEqual(consolidateLegacyCustomers(f.db,true),preview)
    const after=f.at.get(at,true),local=new LocalConversationAssociations(f.db)
    assert.equal(after.phone,'+5531999990101')
    const person=after.references!.person[0]!.id!,contact=after.references!.contact[0]!.id!
    assert.ok(person);assert.ok(contact)
    assert.equal(f.customers.record(contact).entityId,person)
    assert.equal(local.resolveIdentityActive(pn),at)
    assert.equal(local.projection(pn).names[0]?.name,'Pessoa sintética')
    const replay=consolidateLegacyCustomers(f.db,true)
    assert.equal(replay.reconciled,0);assert.equal(replay.alreadyShared,1);assert.equal(replay.copiedLinks,0)
    assert.equal(f.at.list().total,1)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM chat_messages').get()!.n,0)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM customer_records').get()!.n,2)
  }finally{f.db.close()}
})
test('different participants on the same number require review',()=>{
  const f=fixture()
  try{
    f.record('TEST1','Pessoa A');f.record('TEST2','Pessoa B')
    const result=consolidateLegacyCustomers(f.db,true)
    assert.equal(result.copiedLinks,2);assert.equal(result.pending,2);assert.equal(result.reconciled,0)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM customer_records').get()!.n,0)
    assert.equal(f.at.list().total,2)
  }finally{f.db.close()}
})
test('existing owner with another name is preserved without a duplicate',()=>{
  const f=fixture()
  try{
    const at=f.record('TEST1','Outra pessoa')
    const entity=f.customers.save({kind:'entity',text:'Titular',contacts:[{text:'+5531999990101'}]})
    const result=consolidateLegacyCustomers(f.db,true)
    assert.equal(result.pending,1);assert.equal(result.reconciled,0)
    assert.equal(f.customers.contacts(entity.id).length,1)
    assert.equal(f.at.get(at,true).phone,'')
  }finally{f.db.close()}
})


test('multiple historical links retain the last confirmed context, without overwriting a local decision',()=>{
 const f=fixture()
 try{
  const first=f.record('TEST1','Pessoa sintética'),latest=f.record('TEST2','Pessoa sintética')
  const report=consolidateLegacyCustomers(f.db,true)
  assert.equal(report.copiedLinks,2);assert.equal(report.restoredContexts,1)
  assert.equal(report.contextReview,0)
  const local=new LocalConversationAssociations(f.db)
  assert.equal(local.resolveIdentityActive(pn),latest)
  assert.equal(f.at.get(first,true).references!.person[0]!.id,f.at.get(latest,true).references!.person[0]!.id)
  const replay=consolidateLegacyCustomers(f.db,true)
  assert.equal(replay.restoredContexts,0);assert.equal(replay.reconciled,0)
 }finally{f.db.close()}
})


test('legacy manual fichas share an Entity and Contact by the exact number, without inventing a conversation',()=>{
 const db=openDatabase(':memory:')
 try{
  const at=new AtendimentoRepository(db),customers=new CustomerRepository(db)
  const first=at.create({name:'Pessoa manual',phone:'+5531999990777'})
  const second=at.create({name:'Pessoa manual',phone:'+55 (31) 99999-0777'})
  const result=consolidateLegacyCustomers(db,true)
  assert.equal(result.withoutChannel,2);assert.equal(result.reconciled,2);assert.equal(result.pending,0)
  const a=at.get(first.id,true),b=at.get(second.id,true)
  assert.equal(a.references!.person[0]!.id,b.references!.person[0]!.id)
  assert.equal(a.references!.contact[0]!.id,b.references!.contact[0]!.id)
  const contact=customers.record(a.references!.contact[0]!.id!)
  assert.equal(contact.entityId,a.references!.person[0]!.id)
  assert.equal(contact.conversationId,null)
  assert.equal(db.prepare('SELECT count(*) AS n FROM v20_associations').get()!.n,0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM chat_provider_conversations').get()!.n,0)
  assert.equal(consolidateLegacyCustomers(db,true).alreadyShared,2)
 }finally{db.close()}
})


test('legacy phone normalization preserves digits and rejects ambiguity',()=>{
 for(const value of ['(31) 99999-0777','31999990777','5531999990777','+55 (31) 99999-0777'])assert.equal(normalizeLegacyPhone(value),'+5531999990777')
 assert.equal(normalizeLegacyPhone('(31) 3333-0777'),'+553133330777')
 for(const value of ['99999-0777','3199990777','031999990777','(00) 99999-0777','31 99999-0777 / 88888-0777','31 99999-0777 ramal 2','Não informado'])assert.equal(normalizeLegacyPhone(value),null)
})
test('complete national and country-prefixed legacy numbers reconcile in place, without duplicate text references',()=>{
 const db=openDatabase(':memory:')
 try{
  const at=new AtendimentoRepository(db),customers=new CustomerRepository(db)
  const first=at.create({name:'Pessoa manual',phone:'(31) 99999-0777'})
  const second=at.create({name:'Pessoa manual',phone:'5531999990777'})
  const preview=consolidateLegacyCustomers(db)
  assert.equal(preview.normalizedLegacy,2)
  assert.deepEqual(consolidateLegacyCustomers(db,true),preview)
  assert.equal(preview.pending,0)
  const a=at.get(first.id,true),b=at.get(second.id,true)
  assert.equal(a.phone,'+5531999990777');assert.equal(b.phone,a.phone)
  assert.equal(a.references!.contact.length,1);assert.equal(b.references!.contact.length,1)
  assert.equal(a.references!.contact[0]!.id,b.references!.contact[0]!.id)
  assert.equal(customers.record(a.references!.contact[0]!.id!).conversationId,null)
  const again=consolidateLegacyCustomers(db,true)
  assert.equal(again.alreadyShared,2);assert.equal(again.pending,0)
 }finally{db.close()}
})
test('a legacy national number must match the linked Chat exactly; no ninth digit guessing',()=>{
 const f=fixture()
 try{
  const id=f.record('TEST1','Pessoa sintética')
  f.db.prepare('UPDATE atendimentos SET phone=? WHERE id=?').run('(31) 99999-0101',id)
  const report=consolidateLegacyCustomers(f.db,true)
  assert.equal(report.normalizedLegacy,1)
  assert.equal(f.at.get(id,true).phone,'+5531999990101')
  assert.equal(f.at.get(id,true).references!.contact.length,1)
 }finally{f.db.close()}
 const g=fixture()
 try{
  const id=g.record('TEST1','Pessoa sintética')
  g.db.prepare('UPDATE atendimentos SET phone=? WHERE id=?').run('(31) 99999-0102',id)
  const report=consolidateLegacyCustomers(g.db,true)
  assert.equal(report.pendingReasons.phone_chat_mismatch,1)
  assert.equal(report.reconciled,0)
 }finally{g.db.close()}
})
test('an existing legacy-format Contact blocks accidental creation of a duplicate',()=>{
 const db=openDatabase(':memory:')
 try{
  const at=new AtendimentoRepository(db),customers=new CustomerRepository(db)
  customers.save({kind:'entity',text:'Pessoa manual',contacts:[{text:'(31) 99999-0777'}]})
  at.create({name:'Pessoa manual',phone:'+5531999990777'})
  const report=consolidateLegacyCustomers(db,true)
  assert.equal(report.pendingReasons.legacy_contact_requires_review,1)
  assert.equal(report.reconciled,0)
  assert.equal(db.prepare("SELECT count(*) n FROM customer_records WHERE kind='contact'").get()!.n,1)
 }finally{db.close()}
})
