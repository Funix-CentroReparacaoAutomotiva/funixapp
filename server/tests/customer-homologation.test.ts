import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {openDatabase,backupDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {removeV19FixtureSchema} from './fixtures/pre-v19.ts'
import {ChatRepository} from '../chat/repository.ts'
import {loadConversationRuntime} from '../chat/conversation-runtime.ts'
import {verifyV19Copy} from '../../scripts/verify-v19-copy.ts'
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex')

test('controlled V19 rehearsal backs up V18 with WAL, preserves commercial/PDF/message data, retries inbound and restores to a new file',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-homolog-v19-')),source=join(dir,'synthetic-v18.sqlite'),backup=join(dir,'before.sqlite'),work=join(dir,'work.sqlite'),restored=join(dir,'recovery.sqlite')
 let db:DatabaseSync|undefined=openDatabase(source)
 try{
  db.exec('PRAGMA journal_mode=WAL')
  const f=commercialFixture(db),budgets=new BudgetRepository(db),input={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const preview=budgets.preview(f.at.id,input),version=await budgets.emit(f.at.id,{...input,previewToken:preview.token,idempotencyKey:randomUUID()}),pdf=budgets.pdf(f.at.id,version.id)
  removeV19FixtureSchema(db) // Only this synthetic fixture is downgraded; never an operator procedure.
  const chat=new ChatRepository(db);chat.registerInstance('funix_comercial','2026-01-01T00:00:00.000Z')
  const cid=randomUUID(),link=randomUUID(),pn='5531999990101@s.whatsapp.net'
  db.prepare('INSERT INTO chat_conversations(id,instance,remote_jid) VALUES(?,?,?)').run(cid,'funix_comercial',pn)
  db.prepare('INSERT INTO chat_links VALUES(?,?,?,?,?,?,?,?)').run(link,cid,f.at.id,1,'2026-01-01T00:00:00.000Z',null,'synthetic','explicit fixture link')
  chat.ingest(JSON.stringify({schemaVersion:1,instance:'funix_comercial',eventId:'old',type:'message.upsert',occurredAt:'2026-01-02T00:00:00.000Z',message:{remoteJid:pn,messageId:'old',fromMe:false,origin:'unknown',kind:'text',text:'Somente sintético',media:null}}))
  // Exercise the existing operator CLI while the source is open with committed WAL data.
  execFileSync(process.execPath,['server/backup.ts',backup],{env:{...process.env,FUNIX_DATABASE_PATH:source},stdio:'pipe'})
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,18)
  const immutableBackup=hash(backup),readOnly=new DatabaseSync(backup,{readOnly:true})
  try{assert.equal(readOnly.prepare('SELECT COUNT(*) n FROM chat_messages').get()!.n,1);await backupDatabase(readOnly,work)}finally{readOnly.close()}
  db.close();db=undefined
  // Fail only the disposable clone, then prove versioned DDL rolled back on disk.
  const fault=new DatabaseSync(work);fault.exec('CREATE TABLE customer_records(collision TEXT)');fault.close()
  assert.throws(()=>openDatabase(work))
  const failed=new DatabaseSync(work)
  try{
   assert.equal(failed.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,18)
   assert.equal(failed.prepare('PRAGMA table_info(atendimentos)').all().some(c=>c.name==='closed_at'),false)
   assert.equal(failed.prepare('SELECT COUNT(*) n FROM chat_messages').get()!.n,1)
   failed.exec('DROP TABLE customer_records') // Remove only the injected fault in this synthetic clone.
  }finally{failed.close()}
  db=openDatabase(work)
  const check=verifyV19Copy(backup,work);assert.equal(check.beforeVersion,18);assert.equal(check.afterVersion,27)
  assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,version.id),pdf)
  assert.deepEqual(new BudgetRepository(db).get(f.at.id,version.id),version)
  assert.equal(db.prepare('SELECT link_id FROM chat_messages').get()!.link_id,link)
  const env={FUNIX_CHAT_LOCAL_ENABLED:'true',FUNIX_CHAT_LOCAL_READ_ENABLED:'true'},runtime=loadConversationRuntime(env,db)!
  const inbound=JSON.stringify({schemaVersion:2,instance:'funix_comercial',eventId:'after',type:'message.upsert',occurredAt:'2026-01-03T00:00:00.000Z',displayName:'Outro nome',message:{remoteJid:pn,remoteJidAlt:null,messageId:'after',timestamp:1767398400,fromMe:false,kind:'text',text:'Somente sintético novo',media:null}})
  const receipt=runtime.store.ingest(inbound);assert.deepEqual(runtime.store.ingest(inbound),receipt)
  db.close();db=openDatabase(work);assert.deepEqual(loadConversationRuntime(env,db)!.store.ingest(inbound),receipt)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM atendimentos').get()!.n,1)
  assert.equal(db.prepare('SELECT decision FROM conversation_initialization').get()!.decision,'reused')
  assert.equal(db.prepare('SELECT name FROM atendimentos').get()!.name,f.at.name)
  assert.equal(hash(backup),immutableBackup)
  db.close();db=undefined
  // Rollback selects a NEW destination; it never overwrites a running DB or its WAL/SHM.
  const recoverySource=new DatabaseSync(backup,{readOnly:true});try{await backupDatabase(recoverySource,restored)}finally{recoverySource.close()}
  db=new DatabaseSync(restored,{readOnly:true});assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,18)
  assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,version.id),pdf)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages').get()!.n,1)
 }finally{db?.close();rmSync(dir,{recursive:true,force:true})}
})

test('offline verifier rejects altered records, broken references and same-file comparisons without writing either input',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-homolog-guards-')),base=join(dir,'before.sqlite'),copy=join(dir,'copy.sqlite')
 const db=openDatabase(base)
 try{
  const f=commercialFixture(db);await backupDatabase(db,copy)
  const before=hash(base),after=hash(copy)
  assert.throws(()=>verifyV19Copy(base,base),/DISTINCT_FILES/)
  const cli=JSON.parse(execFileSync(process.execPath,['scripts/verify-v19-copy.ts',base,copy],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
  assert.equal(cli.readOnly,true);assert.equal(cli.afterVersion,27)
  verifyV19Copy(base,copy);assert.equal(hash(base),before);assert.equal(hash(copy),after)
  const changed=new DatabaseSync(copy)
  try{
   changed.prepare('UPDATE atendimentos SET name=? WHERE id=?').run('Divergência sintética',f.at.id)
   assert.throws(()=>verifyV19Copy(base,copy),/DATA_CHANGED:atendimentos/)
   changed.prepare('UPDATE atendimentos SET name=? WHERE id=?').run(f.at.name,f.at.id)
   changed.exec('PRAGMA foreign_keys=OFF');changed.prepare('UPDATE scenarios SET atendimento_id=? WHERE id=?').run(randomUUID(),f.scenario.id)
   assert.throws(()=>verifyV19Copy(base,copy),/FOREIGN_KEYS/)
  }finally{changed.close()}
  assert.equal(hash(base),before)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
