import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {backupDatabase} from '../database.ts'
import {removeV26FixtureSchema} from './fixtures/production.ts'
import {entityContactsFixture} from './fixtures/entity-contacts.ts'
import {planParticipantGrouping,applyParticipantGrouping} from '../participant-grouping.ts'
import {participantInventory} from '../customer-inventory.ts'

function seed(){
 const f=entityContactsFixture()
 const a=f.customers.save({kind:'entity',text:'Pessoa A',contacts:[{text:'+5531999990101'}]})
 const b=f.customers.save({kind:'entity',text:'Pessoa B',contacts:[{text:'+5531999990202'}]})
 const ca=f.customers.contacts(a.id)[0]!,cb=f.customers.contacts(b.id)[0]!
 const make=()=>f.at.create({}).id
 const add=(id:string,kind:string,pos:number,recordId:string|null,text:string,key?:string)=>
   f.db.prepare('INSERT INTO atendimento_references VALUES(?,?,?,?,?)').run(id,kind,pos,recordId,JSON.stringify({id:recordId,text,...(key?{participantKey:key}:{})}))
 const safe=make()
 add(safe,'person',0,a.id,a.text);add(safe,'person',1,b.id,b.text)
 add(safe,'contact',0,ca.id,ca.text);add(safe,'contact',1,cb.id,cb.text)
 const mismatch=make()
 add(mismatch,'person',0,a.id,a.text);add(mismatch,'person',1,b.id,b.text)
 add(mismatch,'contact',0,cb.id,cb.text)
 const partial=make()
 add(partial,'person',0,a.id,a.text,'a');add(partial,'contact',0,ca.id,ca.text)
 const unresolved=make()
 add(unresolved,'person',0,a.id,a.text);add(unresolved,'contact',0,null,ca.text)
 return {...f,safe,mismatch,partial,unresolved,a,b,ca,cb}
}
test('legacy grouping plans only cases with explicit owners and unchanged primary selection; preserves all IDs and history',()=>{
 const f=seed()
 try{
  const before=f.db.prepare('SELECT total_changes() n').get()!.n
  const plan=planParticipantGrouping(f.db)
  assert.deepEqual(plan.entries.map(e=>e.atendimentoId),[f.safe])
  assert.equal(plan.deferred,2)
  assert.equal(f.db.prepare('SELECT total_changes() n').get()!.n,before)
  const records=f.db.prepare('SELECT * FROM customer_records ORDER BY id').all()
  const links=f.db.prepare('SELECT * FROM v20_associations ORDER BY id').all()
  const messages=f.db.prepare('SELECT * FROM chat_messages').all()
  const refs=f.db.prepare("SELECT atendimento_id,kind,position,record_id FROM atendimento_references ORDER BY atendimento_id,kind,position").all()
  const primary=f.at.get(f.safe,true)
  assert.deepEqual(applyParticipantGrouping(f.db,plan),{atendimentos:1,references:4,deferred:2})
  const after=f.at.get(f.safe,true)
  assert.equal(after.name,primary.name);assert.equal(after.phone,primary.phone)
  assert.equal(after.revision,primary.revision+1)
  assert.equal(after.references!.person[0]!.participantKey,after.references!.contact[0]!.participantKey)
  assert.equal(after.references!.person[1]!.participantKey,after.references!.contact[1]!.participantKey)
  assert.deepEqual(f.db.prepare('SELECT * FROM customer_records ORDER BY id').all(),records)
  assert.deepEqual(f.db.prepare('SELECT * FROM v20_associations ORDER BY id').all(),links)
  assert.deepEqual(f.db.prepare('SELECT * FROM chat_messages').all(),messages)
  assert.deepEqual(f.db.prepare("SELECT atendimento_id,kind,position,record_id FROM atendimento_references ORDER BY atendimento_id,kind,position").all(),refs)
  assert.ok(participantInventory(f.db).alreadyGrouped.includes(f.safe))
  assert.equal(planParticipantGrouping(f.db).entries.length,0)
  assert.deepEqual(applyParticipantGrouping(f.db,planParticipantGrouping(f.db)),{atendimentos:0,references:0,deferred:2})
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.db.close()}
})

test('legacy grouping rejects a stale plan and rolls back partial writes on failure',()=>{
 const f=seed()
 try{
  const plan=planParticipantGrouping(f.db)
  f.db.prepare('UPDATE atendimentos SET revision=revision+1 WHERE id=?').run(f.safe)
  assert.throws(()=>applyParticipantGrouping(f.db,plan),/desatualizado/)
  const fresh=planParticipantGrouping(f.db)
  const snapshot=f.db.prepare('SELECT * FROM atendimento_references ORDER BY atendimento_id,kind,position').all()
  const revision=f.at.get(f.safe).revision
  f.db.exec("CREATE TRIGGER grouping_test_failure BEFORE UPDATE ON atendimento_references WHEN NEW.kind='contact' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
  assert.throws(()=>applyParticipantGrouping(f.db,fresh),/synthetic failure/)
  assert.deepEqual(f.db.prepare('SELECT * FROM atendimento_references ORDER BY atendimento_id,kind,position').all(),snapshot)
  assert.equal(f.at.get(f.safe).revision,revision)
  assert.equal(f.db.isTransaction,false)
 }finally{f.db.close()}
})

test('offline CLI previews without changing source and applies only to a fresh copy',async()=>{
 const f=seed(),dir=mkdtempSync(join(tmpdir(),'funix-grouping-'))
 const source=join(dir,'source.sqlite'),target=join(dir,'target.sqlite')
 const run=(...args:string[])=>JSON.parse(execFileSync(process.execPath,['server/group-participants-copy.ts',...args],{encoding:'utf8'}))
 try{
   removeV26FixtureSchema(f.db)
   await backupDatabase(f.db,source)
   const original=readFileSync(source)
   assert.deepEqual(run(source),{mode:'preview_only',atendimentos:1,references:4,deferred:2})
   assert.deepEqual(readFileSync(source),original)
   assert.deepEqual(run(source,target),{mode:'copy_only',atendimentos:1,references:4,deferred:2})
   assert.deepEqual(readFileSync(source),original)
   const copy=new DatabaseSync(target,{readOnly:true})
   try{
     assert.equal(planParticipantGrouping(copy).entries.length,0)
     assert.ok(participantInventory(copy).alreadyGrouped.includes(f.safe))
   }finally{copy.close()}
   assert.throws(()=>run(source,target),/Command failed/)
   assert.deepEqual(readFileSync(source),original)
 }finally{f.db.close();rmSync(dir,{recursive:true,force:true})}
})
