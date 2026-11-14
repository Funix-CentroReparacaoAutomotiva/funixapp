import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {migrate as v6} from './fixtures/m1_6_migrations.ts'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/pre-curation/fixture.ts'
import {ComponentRepository} from '../components.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {randomUUID} from 'node:crypto'

test('V6 to V7 removes only the obsolete column, preserving inputs, catalogs, configuration, flags and restart integrity',async ()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-v7-')),file=join(dir,'qa.sqlite');let db=new DatabaseSync(file)
 try{
  db.exec('PRAGMA foreign_keys=ON');v6(db)
  const f=commercialFixture(db),parts=new ComponentRepository(db)
  const p=parts.save(f.at.id,{pieceId:f.item.id,name:'Componente QA',quantity:'0.25',manualPrice:'10.01',notes:'QA'})
  db.prepare('UPDATE component_items SET fct=? WHERE id=?').run('99',p.id)
  const tables=['atendimentos','catalog_items','catalog_history','pricing_configuration','commercial_state','scenarios','diagnosis_items','diagnosis_services','scenario_piece_flags','scenario_service_flags','scenario_component_flags']
  const before=tables.map(t=>db.prepare(`SELECT ${t==='scenarios'?'id,atendimento_id,name,position,revision,created_at':t==='diagnosis_items'?'id,atendimento_id,piece_id,diagnosis_id,notes,enabled,revision,created_at,updated_at':t==='diagnosis_services'?'id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id':'*'} FROM ${t}`).all()),component={...db.prepare('SELECT * FROM component_items').get()};delete component.fct
  db.close();db=openDatabase(file)
  assert(!db.prepare('PRAGMA table_info(component_items)').all().some(c=>c.name==='fct'))
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,17)
  assert.deepEqual({...db.prepare('SELECT * FROM component_items').get()},component)
  tables.forEach((t,i)=>assert.deepEqual(db.prepare(`SELECT ${t==='scenarios'?'id,atendimento_id,name,position,revision,created_at':t==='diagnosis_items'?'id,atendimento_id,piece_id,diagnosis_id,notes,enabled,revision,created_at,updated_at':t==='diagnosis_services'?'id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id':'*'} FROM ${t}`).all(),before[i]))
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  const repo=new BudgetRepository(db),request={scenarioId:f.scenario.id,negotiation:{mode:'none'}},preview=repo.preview(f.at.id,request)
  assert.equal(preview.snapshot.calculation.componentSubtotal,'5.0125')
  assert.deepEqual(preview.snapshot.calculation.lines.find(l=>l.kind==='component')!.factors,{manualPrice:'10.01',MR:'2'})
  assert.equal(preview.canEmit,true);await (await import('./fixtures/budget-renderer.ts')).configureSyntheticStageCategories(db)
  const confirmed=repo.preview(f.at.id,request)
  const version=(await repo.emit(f.at.id,{...request,previewToken:confirmed.token,idempotencyKey:randomUUID()})),pdf=repo.pdf(f.at.id,version.id)
  assert(!JSON.stringify(version.snapshot).includes('"fct"'))
  db.close();db=openDatabase(file)
  assert.deepEqual(new BudgetRepository(db).get(f.at.id,version.id),version);assert.deepEqual(new BudgetRepository(db).pdf(f.at.id,version.id),pdf)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})

test('V7 failure rolls back schema/history and never resets data; clean installation has no individual multiplier',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-v7-fail-')),file=join(dir,'qa.sqlite');let db=new DatabaseSync(file)
 try{
  v6(db);commercialFixture(db);db.exec('CREATE VIEW qa_block_drop AS SELECT fct FROM component_items')
  const before=db.prepare('SELECT * FROM atendimentos').all();db.close()
  assert.throws(()=>openDatabase(file));db=new DatabaseSync(file)
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,6)
  assert(db.prepare('PRAGMA table_info(component_items)').all().some(c=>c.name==='fct'))
  assert.deepEqual(db.prepare('SELECT * FROM atendimentos').all(),before)
  db.exec('DROP VIEW qa_block_drop');db.close();db=openDatabase(file)
  assert.deepEqual(db.prepare('SELECT * FROM atendimentos').all(),before)
  const fresh=openDatabase(':memory:')
  try{assert(!fresh.prepare('PRAGMA table_info(component_items)').all().some(c=>c.name==='fct'))}finally{fresh.close()}
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
