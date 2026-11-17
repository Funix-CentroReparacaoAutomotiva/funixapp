import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CommercialRepository} from '../commercial.ts'
import {ScenarioRepository} from '../scenarios.ts'
import {readVoiceContext,modelVoiceContext} from '../voice-context.ts'
import {hierarchy,hierarchyPieces} from '../hierarchy.ts'
import {mapTree} from '../../src/map-navigation.ts'
import {classifyPiece,functionalTree,selectablePieces} from '../../src/piece-navigation.ts'
import {pieceDisplayName} from '../../shared/piece-display-name.ts'

const four=[
 ['moldura_porta_dianteira__motorista','Moldura dianteira · Motorista','Moldura da porta dianteira · Motorista'],
 ['moldura_porta_dianteira__passageiro','Moldura dianteira · Passageiro','Moldura da porta dianteira · Passageiro'],
 ['moldura_porta_traseira__motorista','Moldura traseira · Motorista','Moldura da porta traseira · Motorista'],
 ['moldura_porta_traseira__passageiro','Moldura traseira · Passageiro','Moldura da porta traseira · Passageiro']
] as const
const allNodes=(n:ReturnType<typeof mapTree>[number]):any[]=>[n,...(n.itens??[]).flatMap(allNodes)]

test('#165: os quatro códigos V2 e os IDs originais são preservados; rótulos são apenas projeção de leitura',()=>{
 const db=openDatabase(':memory:')
 try{
  const repo=new CommercialRepository(db)
  const rawHash=JSON.stringify(hierarchy),v2Hash=JSON.stringify(hierarchyPieces())
  const catalog=repo.catalogs().items
  assert.equal(catalog.length,163)
  for(const [code,legacy,presented] of four){
   const item=catalog.find(c=>c.code===code)!
   assert(item,code)
   assert.equal(item.id,'v2:'+code)
   assert.equal(item.name,presented)
   assert.equal(item.side,code.endsWith('motorista')?'motorista':'passageiro')
   assert.equal(item.status,'proposta')
   assert.equal(pieceDisplayName({code,name:legacy}),presented)
   assert.equal(repo.item(item.id).name,legacy)
   assert.equal(db.prepare('SELECT name FROM catalog_items WHERE id=?').get(item.id)!.name,legacy)
   assert.equal(repo.historyOf(item.id).length,1)
   assert.equal(classifyPiece(item),'Acessórios')
   assert.equal(selectablePieces(catalog).get(code)?.id,item.id)
   assert(functionalTree(catalog).find(g=>g.nome==='Acessórios')!.itens!.some(x=>x.codigo_peca===code))
  }
  assert.equal(new Set(four.map(([code])=>catalog.find(c=>c.code===code)!.id)).size,4)
  const map=mapTree(catalog).flatMap(allNodes).filter(node=>four.some(([code])=>node.codigo_peca===code))
  assert.equal(map.length,4)
  assert.deepEqual(map.map(n=>n.id).sort(),four.map(([code])=>'v2:'+code).sort())
  assert.equal(JSON.stringify(hierarchy),rawHash)
  assert.equal(JSON.stringify(hierarchyPieces()),v2Hash)
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,22)
 }finally{db.close()}
})

test('#165: status/ativação não persistem apelido de apresentação e renomeação manual é respeitada',()=>{
 const db=openDatabase(':memory:')
 try{
  const repo=new CommercialRepository(db),[code,legacy,presented]=four[0]!
  const original=repo.catalogs().items.find(p=>p.code===code)!
  const approved=repo.saveCatalog({revision:original.revision,status:'validado',name:presented},original.id)
  assert.equal(approved.name,legacy)
  assert.equal(repo.item(original.id).name,legacy)
  assert.equal(repo.catalogs().items.find(p=>p.code===code)!.name,presented)
  const custom=repo.saveCatalog({revision:approved.revision,name:'Moldura superior da porta (cadastro revisado)'},original.id)
  assert.equal(custom.name,'Moldura superior da porta (cadastro revisado)')
  assert.equal(repo.catalogs().items.find(p=>p.code===code)!.name,custom.name)
  assert.equal(repo.historyOf(original.id).length,3)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('#165: quatro seleções distintas persistem por cenário, duplicação/repetição é idempotente e não inclui serviço',()=>{
 const db=openDatabase(':memory:')
 try{
  const repo=new CommercialRepository(db),at=new AtendimentoRepository(db).create({phone:'123'}),scenarios=new ScenarioRepository(db)
  const initial=scenarios.list(at.id)[0]!
  const other=scenarios.create(at.id,{name:'Comparação',duplicateFrom:initial.id,sourceRevision:initial.revision})
  const codes=four.map(([code])=>code)
  const first=repo.add(at.id,{pieceCodes:[codes[0]!,codes[1]!],scenarioId:initial.id,scenarioRevision:scenarios.list(at.id).find(s=>s.id===initial.id)!.revision})
  assert.equal(first.length,2)
  assert(first.every(p=>p.services.length===0))
  const next=scenarios.list(at.id).find(s=>s.id===initial.id)!
  const second=repo.add(at.id,{pieceCodes:[codes[2]!,codes[3]!],scenarioId:initial.id,scenarioRevision:next.revision})
  assert.equal(second.length,4)
  const repeat=scenarios.list(at.id).find(s=>s.id===initial.id)!
  assert.deepEqual(repo.add(at.id,{pieceCodes:[codes[0]!],scenarioId:initial.id,scenarioRevision:repeat.revision}),second)
  const list=repo.list(at.id)
  assert.equal(list.length,4)
  assert.deepEqual(new Set(list.map(p=>p.pieceId)),new Set(codes.map(code=>'v2:'+code)))
  const bySide=scenarios.list(at.id).find(s=>s.id===other.id)!
  assert(four.every(([code])=>list.some(p=>p.pieceId==='v2:'+code&&bySide.pieceFlags[p.id]===false)))
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('#165: catálogo do Copiloto utiliza os quatro nomes claros sem inferir esquerda/direita física',()=>{
 const db=openDatabase(':memory:')
 try{
  const at=new AtendimentoRepository(db).create({phone:'123'}),scenario=new ScenarioRepository(db).list(at.id)[0]!
  const ctx=modelVoiceContext(readVoiceContext(db,at.id,scenario.id))
  for(const [code,,display] of four){
   const matches=ctx.catalog.filter(item=>item.code===code)
   assert.equal(matches.length,1)
   assert.equal(matches[0]!.name,display)
   assert(!/\b(esquerda|direita)\b/i.test(display))
  }
 }finally{db.close()}
})
