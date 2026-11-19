import {removeV24FixtureSchema} from './fixtures/production.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync,backup} from 'node:sqlite'
import {mkdtempSync,rmSync,copyFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../database.ts'
import {migrate} from '../migrations.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {customerInventory} from '../customer-inventory.ts'
import {verifyV19Copy} from '../../scripts/verify-v19-copy.ts'
function removeV22(db:DatabaseSync){removeV24FixtureSchema(db);db.exec('ALTER TABLE atendimentos DROP COLUMN purpose; DELETE FROM schema_migrations WHERE version=23; DROP TABLE contact_channel_checks; DROP INDEX customer_contact_phone; DROP INDEX customer_entity_contacts; ALTER TABLE customer_records DROP COLUMN phone_normalized; DELETE FROM schema_migrations WHERE version=22')}

test('V22 inventories duplicates without merging; atomic failed migration, retry, idempotency, disk backup and restore preserve history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-v22-synthetic-')),path=join(dir,'work.sqlite'),back=join(dir,'v21-backup.sqlite'),restore=join(dir,'restored.sqlite')
 let db=openDatabase(path)
 try{
  removeV22(db)
  const at=new AtendimentoRepository(db).create({name:'Pessoa histórica',phone:'+5531999990101'})
  const entity=randomUUID(),contacts=[randomUUID(),randomUUID()]
  db.prepare("INSERT INTO customer_records(id,kind,data) VALUES(?,'entity',?)").run(entity,JSON.stringify({text:'Entidade sintética'}))
  contacts.forEach((id,i)=>db.prepare("INSERT INTO customer_records(id,kind,data,entity_id) VALUES(?,'contact',?,?)").run(id,JSON.stringify({text:i?'+55 (31) 99999-0101':'+5531999990101'}),i?null:entity))
  db.prepare("INSERT INTO atendimento_references VALUES(?,'person',0,?,?)").run(at.id,entity,JSON.stringify({id:entity,text:'Snapshot histórico'}))
  const old=db.prepare('SELECT * FROM customer_records ORDER BY id').all(),refs=db.prepare('SELECT * FROM atendimento_references').all()
  const inventory=customerInventory(db);assert.equal(inventory.duplicateGroups.length,1);assert.equal(inventory.automaticAssociations,0)
  await backup(db,back)
  db.exec('CREATE TABLE contact_channel_checks(collision TEXT)')
  assert.throws(()=>migrate(db))
  assert.equal(db.prepare('SELECT max(version) n FROM schema_migrations').get()!.n,21)
  assert(!db.prepare('PRAGMA table_info(customer_records)').all().some(r=>r.name==='phone_normalized'))
  assert.deepEqual(db.prepare('SELECT * FROM customer_records ORDER BY id').all(),old)
  db.exec('DROP TABLE contact_channel_checks')
  assert.throws(()=>migrate(db),/V25 bloqueada/)
  assert.equal(db.prepare('SELECT max(version) n FROM schema_migrations').get()!.n,21)
  assert.deepEqual(db.prepare('SELECT * FROM customer_records ORDER BY id').all(),old)
  // Synthetic review supplies a distinct, explicitly identified number.
  db.prepare("UPDATE customer_records SET data=json_set(data,'$.text',?) WHERE id=?").run('(31) 99999-0102',contacts[1]!)
  const corrected=db.prepare('SELECT * FROM customer_records ORDER BY id').all()
  await backup(db,join(dir,'corrected.sqlite'))
  migrate(db)
  assert.equal(db.prepare('SELECT max(version) n FROM schema_migrations').get()!.n,25)
  assert.deepEqual(db.prepare('SELECT * FROM customer_records ORDER BY id').all().map(({phone_normalized:_,...r})=>({...r})),corrected.map(r=>({...r})))
  assert.deepEqual(db.prepare('SELECT * FROM atendimento_references').all(),refs)
  assert.equal(db.prepare('SELECT count(*) n FROM contact_channel_checks').get()!.n,0)
  assert.equal(db.prepare('SELECT count(*) n FROM customer_records WHERE phone_normalized=?').get('+5531999990101')!.n,1)
  const after=db.prepare('SELECT * FROM customer_records ORDER BY id').all();migrate(db);assert.deepEqual(db.prepare('SELECT * FROM customer_records ORDER BY id').all(),after)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')
  db.close();db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('SELECT count(*) n FROM customer_records').get()!.n,3)
  assert.equal(verifyV19Copy(join(dir,'corrected.sqlite'),path).afterVersion,25)
  copyFileSync(back,restore);const restored=new DatabaseSync(restore,{readOnly:true});try{assert.deepEqual(restored.prepare('SELECT * FROM customer_records ORDER BY id').all(),old);assert.deepEqual(restored.prepare('SELECT * FROM atendimento_references').all(),refs);assert.equal(restored.prepare('SELECT max(version) n FROM schema_migrations').get()!.n,21);assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')}finally{restored.close()}
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})

test('V23 upgrades a V22 copy without reclassifying existing Atendimentos',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-v23-synthetic-'))
 const path=join(dir,'copy.sqlite'),previous=join(dir,'v22.sqlite')
 const db=openDatabase(path)
 try{
  const repo=new AtendimentoRepository(db),old=repo.create({name:'Histórico sintético',stage:'rejeitados',explicitRefusal:true,rejectionReason:'Recusa histórica'})
  removeV24FixtureSchema(db)
  db.exec('ALTER TABLE atendimentos DROP COLUMN purpose; DELETE FROM schema_migrations WHERE version=23')
  await backup(db,previous)
  migrate(db);migrate(db)
  assert.deepEqual(repo.get(old.id),old)
  assert.equal(verifyV19Copy(previous,path).afterVersion,25)
  assert.equal(repo.create({purpose:'unclassified'}).purpose,'unclassified')
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})


test('V25 rejects SQL duplicates, mismatched keys and links without a channel Contact',()=>{
 const db=openDatabase(':memory:')
 try{
  const at=new AtendimentoRepository(db).create({name:'Ficha sintética'})
  const cid=randomUUID(),phone='+5531999990101'
  db.prepare("INSERT INTO v20_conversations(id,instance,remote_jid,created_at) VALUES(?,'funix_comercial',?,'2026-11-19')").run(cid,'5531999990101@s.whatsapp.net')
  assert.throws(()=>db.prepare("INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,'2026-11-19','operator','synthetic')").run(randomUUID(),cid,at.id),/canonical contact/)
  const insert=db.prepare("INSERT INTO customer_records(id,kind,data,phone_normalized) VALUES(?,'contact',?,?)")
  assert.throws(()=>insert.run(randomUUID(),JSON.stringify({text:'(31) 99999-0101'}),null),/canonical contact phone/)
  insert.run(randomUUID(),JSON.stringify({text:phone}),phone)
  assert.throws(()=>insert.run(randomUUID(),JSON.stringify({text:'(31) 99999-0101'}),phone),/UNIQUE/)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customer_records").get()!.n,1)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})

test('V25 validates PN scope on direct insert, reactivation and later contact mutations',()=>{
 const db=openDatabase(':memory:')
 try{
  const at=new AtendimentoRepository(db).create({name:'Ficha sintética'})
  const result=db.prepare("INSERT INTO customer_records(id,kind,data) VALUES(?,'entity',?)")
  const owner=randomUUID(),contact=randomUUID(),handle=randomUUID(),link=randomUUID()
  result.run(owner,'{"text":"Titular sintético"}')
  const jid='5531999990102@s.whatsapp.net'
  db.prepare("INSERT INTO chat_provider_conversations(id,instance,remote_jid) VALUES(?,'funix_comercial',?)").run(handle,jid)
  db.prepare("INSERT INTO v20_conversations(id,instance,remote_jid,created_at) VALUES(?,'funix_comercial',?,'2026-11-19')").run(handle,jid)
  db.prepare("INSERT INTO customer_records(id,kind,data,entity_id,conversation_id,phone_normalized) VALUES(?,'contact',?,?,?,?)")
    .run(contact,'{"text":"+5531999990101"}',owner,handle,'+5531999990101')
  const insert=db.prepare("INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,'2026-11-19','operator','synthetic')")
  assert.throws(()=>insert.run(link,handle,at.id),/canonical contact/)
  const change=db.prepare("UPDATE customer_records SET phone_normalized=?,data=json_set(data,'$.text',?) WHERE id=?")
  change.run('+5531999990102','(31) 99999-0102',contact)
  insert.run(link,handle,at.id)
  assert.throws(()=>change.run('+5531999990101','+5531999990101',contact),/canonical contact/)
  assert.throws(()=>db.prepare('UPDATE customer_records SET entity_id=NULL WHERE id=?').run(contact),/canonical contact/)
  assert.throws(()=>db.prepare('UPDATE customer_records SET conversation_id=NULL WHERE id=?').run(contact),/canonical contact/)
  db.prepare("UPDATE v20_associations SET unlinked_at='2026-11-19',unlinked_by='operator',unlink_reason='synthetic' WHERE id=?").run(link)
  change.run('+5531999990101','+5531999990101',contact)
  assert.throws(()=>db.prepare('UPDATE v20_associations SET unlinked_at=NULL,unlinked_by=NULL,unlink_reason=NULL WHERE id=?').run(link),/canonical contact/)
 }finally{db.close()}
})
