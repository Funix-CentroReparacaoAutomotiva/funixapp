import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {migrate} from '../migrations.ts'
import {CommercialRepository} from '../commercial.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {classifyPiece,functionalTree,selectablePieces} from '../../src/piece-navigation.ts'
import {hierarchyPieces} from '../hierarchy.ts'

const CODE='para_choque_traseiro_inferior'
const NAME='Para-choque traseiro inferior'

test('#180: migração aditiva oferece peça distinta sem modificar hierarquia V2',()=>{
 const db=openDatabase(':memory:')
 try{
  const repo=new CommercialRepository(db)
  const items=repo.catalogs().items
  const part=items.find(item=>item.code===CODE)!
  const bumper=items.find(item=>item.code==='para_choque_traseiro')!
  assert(part)
  assert(bumper)
  assert.notEqual(part.id,bumper.id)
  assert.equal(part.name,NAME)
  assert.equal(part.kind,'peca')
  assert.equal(part.source,'operador')
  assert.equal(part.status,'proposta')
  assert.equal(items.filter(item=>item.code===CODE).length,1)
  assert.equal(items.length,164)
  assert.equal(hierarchyPieces().length,163)
  assert.equal(classifyPiece(part),'Lataria')
  assert(selectablePieces(items).has(CODE))
  const lataria=functionalTree(items).find(group=>group.nome==='Lataria')!
  assert(lataria.itens?.some(node=>node.codigo_peca===CODE))
  assert.equal(repo.historyOf(part.id).length,1)
  const config=JSON.parse(String(db.prepare('SELECT data FROM pricing_configuration WHERE id=1').get()!.data))
  assert.deepEqual(config.services,[])
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('#180: inclusão, recarregamento, seleção repetida e concorrência de peças preservam identidades',()=>{
 const db=openDatabase(':memory:')
 try{
  const at=new AtendimentoRepository(db).create({phone:'123'})
  const repo=new CommercialRepository(db)
  const part=repo.catalogs().items.find(item=>item.code===CODE)!
  const bumper=repo.catalogs().items.find(item=>item.code==='para_choque_traseiro')!
  const one=repo.add(at.id,{pieceCodes:[CODE]})
  assert.equal(one.length,1)
  assert.equal(one[0]!.pieceId,part.id)
  assert.deepEqual(one[0]!.services,[])
  const repeated=repo.add(at.id,{pieceCodes:[CODE]})
  assert.deepEqual(repeated,one)
  const both=repo.add(at.id,{pieceCodes:['para_choque_traseiro']})
  assert.equal(both.length,2)
  assert.deepEqual(new Set(both.map(x=>x.pieceId)),new Set([part.id,bumper.id]))
  assert.equal(repo.list(at.id).length,2)
  migrate(db)
  assert.equal(repo.catalogs().items.filter(item=>item.code===CODE).length,1)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('#180: identidade conflitante recusa migração inteira, sem duplicar ou renomear operador',()=>{
 const db=openDatabase(':memory:')
 try{
  const repo=new CommercialRepository(db)
  const existing=repo.catalogs().items.find(item=>item.code===CODE)!
  db.prepare('DELETE FROM catalog_history WHERE item_id=?').run(existing.id)
  db.prepare('DELETE FROM catalog_items WHERE id=?').run(existing.id)
  db.prepare('DELETE FROM schema_migrations WHERE version=21').run()
  const other=repo.saveCatalog({kind:'peca',name:NAME,code:'peca_local_conflitante'})
  assert.throws(()=>migrate(db),/conflitante|conflitante|revisão|diferente/)
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,20)
  assert.equal(repo.item(other.id).name,NAME)
  assert.equal(repo.catalogs().items.filter(item=>item.code===CODE).length,0)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})
