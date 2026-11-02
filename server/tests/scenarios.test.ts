import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../database.ts'
import { migrate as baseline } from './fixtures/m1_2_migrations.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { CommercialRepository } from '../commercial.ts'
import { ScenarioRepository } from '../scenarios.ts'

function setup() {
  const db=openDatabase(':memory:'), at=new AtendimentoRepository(db).create({phone:'123'}), commercial=new CommercialRepository(db), scenarios=new ScenarioRepository(db)
  const piece=commercial.catalogs().items.find(p=>p.code==='capo')!
  commercial.saveCatalog({revision:piece.revision,status:'validado'},piece.id)
  const service=commercial.saveCatalog({kind:'servico',name:'Serviço sintético',status:'validado'})
  const item=commercial.add(at.id,{pieceCodes:['capo']})[0]!
  const updated=commercial.updateDiagnosis(at.id,item.id,{revision:item.revision,services:[{serviceId:service.id,quantity:'0.25'},{serviceId:service.id,quantity:'2'}]})
  return {db,at,commercial,scenarios,item:updated,service}
}

test('scenario masks clone flags only; duplicate services and master attributes keep stable IDs across edits',()=>{
 const {db,at,commercial:c,scenarios:s,item}=setup()
 try {
  const a=s.list(at.id)[0]!, b=s.create(at.id,{name:'Alternativa',duplicateFrom:a.id,sourceRevision:a.revision})
  assert.equal(c.list(at.id,b.id)[0]!.services.length,2)
  assert.equal(new Set(item.services.map(l=>l.id)).size,2)
  assert.equal(db.prepare('SELECT count(*) AS n FROM diagnosis_services').get()!.n,2)
  s.update(at.id,b.id,{revision:b.revision,serviceFlags:{[item.services[0]!.id]:false}})
  const before=c.list(at.id,a.id)[0]!
  c.updateDiagnosis(at.id,item.id,{revision:before.revision,scenarioId:a.id,notes:'Global',services:before.services.map((l,i)=>({...l,quantity:i===0?'0.5':l.quantity}))})
  const other=c.list(at.id,b.id)[0]!
  assert.equal(other.notes,'Global');assert.equal(other.services[0]!.quantity,'0.5')
  assert.equal(other.services[0]!.enabled,false)
  assert.deepEqual(other.services.map(l=>l.id),item.services.map(l=>l.id))
  assert.equal(c.list(at.id,a.id)[0]!.services[0]!.enabled,true)
 } finally {db.close()}
})

test('parent exclusion preserves child flags; new launches exist in every scenario but enable only active; deletion cascades masks',()=>{
 const {db,at,commercial:c,scenarios:s,item,service}=setup()
 try {
  const a=s.list(at.id)[0]!, b=s.create(at.id,{name:'B',duplicateFrom:a.id,sourceRevision:a.revision})
  let bs=s.update(at.id,b.id,{revision:b.revision,pieceFlags:{[item.id]:false}})
  assert.equal(bs.serviceFlags[item.services[0]!.id],true)
  bs=s.update(at.id,b.id,{revision:bs.revision,pieceFlags:{[item.id]:true}})
  assert.equal(bs.serviceFlags[item.services[0]!.id],true)
  const old=c.list(at.id,b.id)[0]!
  const added=c.updateDiagnosis(at.id,item.id,{revision:old.revision,scenarioId:b.id,scenarioRevision:bs.revision,services:[...old.services,{serviceId:service.id,quantity:'3'}]})
  const id=added.services.at(-1)!.id
  assert.equal(c.list(at.id,a.id)[0]!.services.length,3)
  assert.equal(c.list(at.id,a.id)[0]!.services.at(-1)!.enabled,false)
  assert.equal(c.list(at.id,b.id)[0]!.services.at(-1)!.enabled,true)
  c.updateDiagnosis(at.id,item.id,{revision:added.revision,scenarioId:b.id,services:added.services.filter(l=>l.id!==id)})
  assert.equal(db.prepare('SELECT count(*) AS n FROM scenario_service_flags WHERE service_id=?').get(id)!.n,0)
  assert.equal(c.add(at.id,{pieceCodes:['capo'],scenarioId:b.id}).length,1)
 } finally {db.close()}
})

test('wrong-parent IDs, stale scenario revisions and malformed flags do not mutate any mask',()=>{
 const {db,at,scenarios:s,item}=setup()
 try {
  const a=s.list(at.id)[0]!, other=new AtendimentoRepository(db).create({phone:'456'}), foreign=s.list(other.id)[0]!
  assert.throws(()=>s.update(at.id,foreign.id,{revision:1,pieceFlags:{[item.id]:true}}))
  assert.throws(()=>s.update(at.id,a.id,{revision:a.revision,pieceFlags:{[item.id]:false,foreign:true}}))
  assert.deepEqual(s.list(at.id)[0],a)
  const changed=s.update(at.id,a.id,{revision:a.revision,pieceFlags:{[item.id]:false}})
  assert.throws(()=>s.update(at.id,a.id,{revision:a.revision,name:'Stale'}))
  assert.equal(s.list(at.id)[0]!.revision,changed.revision)
  for(let i=0;i<28;i++)s.create(at.id,{name:'N '+i})
  assert.equal(s.list(at.id).length,29)
 } finally {db.close()}
})

test('real M1.2 migration preserves raw records including repeated services, quantity and flags, then survives reopen',()=>{
 const directory=mkdtempSync(join(tmpdir(),'funix-m1-2-upgrade-')),file=join(directory,'commercial.sqlite')
 try {
  let db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');baseline(db)
  const at=new AtendimentoRepository(db).create({phone:'123',notes:'Preservado'})
  const now=new Date().toISOString()
  db.prepare("INSERT INTO catalog_items(id,kind,name,status,source,created_at,updated_at) VALUES('svc','servico','Sintético','validado','operador',?,?)").run(now,now)
  db.prepare("INSERT INTO diagnosis_items(id,atendimento_id,piece_id,enabled,created_at,updated_at) VALUES('piece',?,'v2:capo',0,?,?)").run(at.id,now,now)
  db.exec("INSERT INTO diagnosis_services VALUES('l1','piece','svc',NULL,'0.25',1),('l2','piece','svc',NULL,'2',0)")
  const rawAt=db.prepare('SELECT * FROM atendimentos').all(),rawPiece=db.prepare('SELECT id,atendimento_id,piece_id,diagnosis_id,notes,enabled,revision,created_at,updated_at FROM diagnosis_items').all(),rawCatalog=db.prepare('SELECT * FROM catalog_items').all()
  db.close();db=openDatabase(file)
  assert.deepEqual(db.prepare('SELECT * FROM atendimentos').all(),rawAt)
  assert.deepEqual(db.prepare('SELECT id,atendimento_id,piece_id,diagnosis_id,notes,enabled,revision,created_at,updated_at FROM diagnosis_items').all(),rawPiece)
  assert.deepEqual(db.prepare('SELECT * FROM catalog_items').all(),rawCatalog)
  const first=new ScenarioRepository(db).list(at.id)[0]!
  assert.equal(first.pieceFlags.piece,false);assert.equal(first.serviceFlags.l1,true);assert.equal(first.serviceFlags.l2,false)
  const items=new CommercialRepository(db).list(at.id)
  assert.equal(items[0]!.services[0]!.quantity,'0.25');assert.equal(items[0]!.services.length,2)
  db.close();db=openDatabase(file)
  assert.deepEqual(new ScenarioRepository(db).list(at.id)[0],first)
  assert.deepEqual(new CommercialRepository(db).list(at.id),items)
  db.close()
 } finally {rmSync(directory,{recursive:true,force:true})}
})

test('failure after additive M1.2 upgrades rolls back every new table/column without resetting old data',()=>{
 const directory=mkdtempSync(join(tmpdir(),'funix-migration-rollback-')),file=join(directory,'commercial.sqlite')
 try{
  let db=new DatabaseSync(file);baseline(db)
  const original=new AtendimentoRepository(db).create({phone:'123',notes:'Preservar em falha'})
  db.exec("CREATE TABLE pricing_configuration(marker TEXT);INSERT INTO pricing_configuration VALUES('sentinel')")
  db.close();assert.throws(()=>openDatabase(file),/already exists/)
  db=new DatabaseSync(file)
  assert.deepEqual(new AtendimentoRepository(db).get(original.id),original)
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>r.version),[1,2])
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='commercial_state'").get(),undefined)
  assert(!db.prepare('PRAGMA table_info(diagnosis_services)').all().some(c=>c.name==='notes'))
  assert.equal(db.prepare('SELECT marker FROM pricing_configuration').get()!.marker,'sentinel')
  db.exec('DROP TABLE pricing_configuration');db.close();db=openDatabase(file)
  assert.deepEqual(new AtendimentoRepository(db).get(original.id),original)
  assert.equal(new ScenarioRepository(db).list(original.id).length,1)
  db.close()
 }finally{rmSync(directory,{recursive:true,force:true})}
})
