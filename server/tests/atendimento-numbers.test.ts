import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {migrate} from '../migrations.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CustomerRepository} from '../customers.ts'
test('V32 backfills public numbers without modifying old UUIDs or records; new inserts never reuse a number',()=>{
 const db=openDatabase(':memory:')
 try{
  db.exec('DROP TRIGGER atendimento_assign_number; DROP TABLE atendimento_numbers; DROP TABLE erp_component_events; DELETE FROM schema_migrations WHERE version IN (32,33)')
  const repo=new AtendimentoRepository(db), first=repo.create({name:'Sintético A'}),second=repo.create({name:'Sintético B'})
  const original=db.prepare('SELECT * FROM atendimentos ORDER BY id').all()
  migrate(db);const a=repo.get(first.id),b=repo.get(second.id)
  assert.match(a.displayNumber!,/^AT\d{6}$/);assert.notEqual(a.displayNumber,b.displayNumber)
  assert.deepEqual(db.prepare('SELECT * FROM atendimentos ORDER BY id').all(),original)
  const third=repo.create({name:'Sintético C'});assert.equal(third.displayNumber,'AT000003')
  migrate(db);assert.equal(repo.get(first.id).displayNumber,a.displayNumber)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})
test('payer types are optional relationship metadata, independently preserved in reference JSON',()=>{
 const db=openDatabase(':memory:')
 try{
  const customers=new CustomerRepository(db),repo=new AtendimentoRepository(db)
  const at=repo.create({name:'Sintético'})
  const refs=customers.references(at.id)
  const payer=[{id:null,text:'Pessoa A',payerType:'Particular' as const},{id:null,text:'Seguradora B',payerType:'Seguradora' as const}]
  const validated=customers.validate({...refs,payer})
  customers.saveReferences(at.id,validated)
  assert.deepEqual(customers.references(at.id).payer,payer)
  assert.throws(()=>customers.validate({...refs,payer:[{id:null,text:'Teste',payerType:'invalid'}]}))
  customers.saveReferences(at.id,customers.validate({...refs,payer:[]}))
  assert.deepEqual(customers.references(at.id).payer,[])
 }finally{db.close()}
})
