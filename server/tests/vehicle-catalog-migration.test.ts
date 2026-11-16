import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {migrate} from '../migrations.ts'
import {CommercialRepository} from '../commercial.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {ScenarioRepository} from '../scenarios.ts'

const wholeVehicle=(repo:CommercialRepository)=>repo.catalogs().items.filter(item=>item.kind==='peca' && item.name==='Veículo')

test('V21 disponibiliza Veículo selecionável sem incluir serviços automaticamente ou alterar V2',()=>{
 const db=openDatabase(':memory:')
 try{
  const repo=new CommercialRepository(db)
  const vehicles=wholeVehicle(repo)
  assert.equal(vehicles.length,1)
  assert.equal(vehicles[0]!.code,'veiculo_completo')
  assert.equal(vehicles[0]!.active,true)
  const at=new AtendimentoRepository(db).create({phone:'123'})
  const scenario=new ScenarioRepository(db).list(at.id)[0]!
  assert.deepEqual(repo.list(at.id),[])
  const selected=repo.add(at.id,{pieceCodes:['veiculo_completo'],scenarioId:scenario.id,scenarioRevision:scenario.revision})
  assert.equal(selected.length,1)
  assert.equal(selected[0]!.pieceId,vehicles[0]!.id)
  assert.deepEqual(selected[0]!.services,[])
  const latest=new ScenarioRepository(db).list(at.id)[0]!
  assert.deepEqual(repo.add(at.id,{pieceCodes:['veiculo_completo'],scenarioId:latest.id,scenarioRevision:latest.revision}),selected)
  assert.equal(repo.list(at.id).length,1)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('V21 reaplicada preserva cadastro canônico existente sem gerar outra peça',()=>{
 const db=openDatabase(':memory:')
 try{
  const previous=wholeVehicle(new CommercialRepository(db))[0]!
  db.prepare('DELETE FROM catalog_history WHERE item_id=?').run(previous.id)
  db.prepare('DELETE FROM catalog_items WHERE id=?').run(previous.id)
  db.prepare('DELETE FROM schema_migrations WHERE version=21').run()
  const repo=new CommercialRepository(db)
  const existing=repo.saveCatalog({kind:'peca',code:'carro_todo',name:'Veículo',status:'proposta'})
  migrate(db)
  assert.deepEqual(wholeVehicle(repo).map(item=>item.id),[existing.id])
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,21)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('V21 falha de maneira atômica diante de cadastros homônimos conflitantes',()=>{
 const db=openDatabase(':memory:')
 try{
  const previous=wholeVehicle(new CommercialRepository(db))[0]!
  db.prepare('DELETE FROM catalog_history WHERE item_id=?').run(previous.id)
  db.prepare('DELETE FROM catalog_items WHERE id=?').run(previous.id)
  db.prepare('DELETE FROM schema_migrations WHERE version=21').run()
  const repo=new CommercialRepository(db)
  repo.saveCatalog({kind:'peca',code:'carro_todo',name:'Veículo',status:'proposta'})
  repo.saveCatalog({kind:'peca',code:'inteiro',name:'Veículo completo',status:'proposta'})
  assert.throws(()=>migrate(db),/ambígua/)
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,20)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catalog_items WHERE code='veiculo_completo'").get()!.n,0)
 }finally{db.close()}
})
