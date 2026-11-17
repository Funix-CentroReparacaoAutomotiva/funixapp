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
function removeV22(db:DatabaseSync){db.exec('DROP TABLE contact_channel_checks; DROP INDEX customer_contact_phone; DROP INDEX customer_entity_contacts; ALTER TABLE customer_records DROP COLUMN phone_normalized; DELETE FROM schema_migrations WHERE version=22')}

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
  db.exec('DROP TABLE contact_channel_checks');migrate(db)
  assert.equal(db.prepare('SELECT max(version) n FROM schema_migrations').get()!.n,22)
  assert.deepEqual(db.prepare('SELECT * FROM customer_records ORDER BY id').all().map(({phone_normalized:_,...r})=>({...r})),old.map(r=>({...r})))
  assert.deepEqual(db.prepare('SELECT * FROM atendimento_references').all(),refs)
  assert.equal(db.prepare('SELECT count(*) n FROM contact_channel_checks').get()!.n,0)
  assert.equal(db.prepare('SELECT count(*) n FROM customer_records WHERE phone_normalized=?').get('+5531999990101')!.n,2)
  const after=db.prepare('SELECT * FROM customer_records ORDER BY id').all();migrate(db);assert.deepEqual(db.prepare('SELECT * FROM customer_records ORDER BY id').all(),after)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')
  db.close();db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('SELECT count(*) n FROM customer_records').get()!.n,3)
  assert.equal(verifyV19Copy(back,path).afterVersion,22)
  copyFileSync(back,restore);const restored=new DatabaseSync(restore,{readOnly:true});try{assert.deepEqual(restored.prepare('SELECT * FROM customer_records ORDER BY id').all(),old);assert.deepEqual(restored.prepare('SELECT * FROM atendimento_references').all(),refs);assert.equal(restored.prepare('SELECT max(version) n FROM schema_migrations').get()!.n,21);assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')}finally{restored.close()}
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
