import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,rmSync,copyFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {openDatabase,backupDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {ScenarioRepository} from '../scenarios.ts'

test('V14-to-V15 upgrades a disposable SQLite file, preserves records, and permits recovery from a pre-migration backup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-issue121-backup-'))
 const file=join(dir,'app.sqlite'),backup=join(dir,'before-v15.sqlite')
 let db=openDatabase(file)
 try{
  const at=new AtendimentoRepository(db).create({phone:'31999990000',name:'Cliente sintético'})
  const before=new ScenarioRepository(db).list(at.id)[0]!
  // Build a real V14-like file from the current schema; no production database is touched.
  db.exec('ALTER TABLE scenarios DROP COLUMN negotiation_draft_json')
  db.exec('DELETE FROM schema_migrations WHERE version=15')
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,14)
  await backupDatabase(db,backup)
  db.close()
  db=openDatabase(file)
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,15)
  assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  assert.equal(new AtendimentoRepository(db).get(at.id).name,'Cliente sintético')
  const scenario=new ScenarioRepository(db).list(at.id)[0]!
  assert.equal(scenario.id,before.id)
  assert.deepEqual(scenario.negotiationDraft,{mode:'none',value:''})
  const updated=new ScenarioRepository(db).update(at.id,scenario.id,{revision:scenario.revision,negotiationDraft:{mode:'discount',value:'120'}})
  assert.deepEqual(updated.negotiationDraft,{mode:'discount',value:'120'})
  db.close()
  // Restore the original V14 backup: the previous binary can be used only with a V14 database.
  copyFileSync(backup,file)
  db=new DatabaseSync(file,{readOnly:true})
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,14)
  assert(!db.prepare('PRAGMA table_info(scenarios)').all().some(c=>c.name==='negotiation_draft_json'))
  assert.equal(db.prepare('SELECT name FROM atendimentos WHERE id=?').get(at.id)!.name,'Cliente sintético')
  assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
