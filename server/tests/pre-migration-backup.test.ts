import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,readdirSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {backupBeforeVoiceMigration} from '../pre-migration-backup.ts'

test('V12 SQLite backup preserves existing Atendimento and is created before additive V13 migration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-v13-backup-')),file=join(dir,'funix.sqlite')
 try{
  let db=openDatabase(file)
  const at=new AtendimentoRepository(db).create({phone:'1234567890',name:'Synthetic Operator QA'})
  db.exec('DROP TABLE voice_apply_receipts;DELETE FROM schema_migrations WHERE version=13;')
  db.close()
  const before=readFileSync(file)
  const backup=await backupBeforeVoiceMigration(file)
  assert(backup&&backup!==file)
  assert.deepEqual(readFileSync(file),before,'the backup procedure must not modify the original')
  let copy=new DatabaseSync(backup,{readOnly:true})
  assert.equal(copy.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')
  assert.equal(copy.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,12)
  assert.equal(copy.prepare('SELECT name FROM atendimentos WHERE id=?').get(at.id)!.name,'Synthetic Operator QA')
  copy.close()
  db=openDatabase(file)
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,13)
  assert.equal(db.prepare('SELECT name FROM atendimentos WHERE id=?').get(at.id)!.name,'Synthetic Operator QA')
  db.close()
  assert.equal(await backupBeforeVoiceMigration(file),null,'do not repeat backup after successful migration')
  assert.equal(readdirSync(dir).filter(name=>name.includes('.pre-v13-')).length,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('a missing source or already migrated source needs no pre-V13 backup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-v13-empty-')),file=join(dir,'new.sqlite')
 try{
  assert.equal(await backupBeforeVoiceMigration(file),null)
  const db=openDatabase(file)
  db.close()
  assert.equal(await backupBeforeVoiceMigration(file),null)
  assert.deepEqual(readdirSync(dir),['new.sqlite'])
 }finally{rmSync(dir,{recursive:true,force:true})}
})
