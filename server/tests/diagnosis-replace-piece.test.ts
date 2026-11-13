import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {CommercialRepository} from '../commercial.ts'
import {ScenarioRepository} from '../scenarios.ts'
import {ComponentRepository} from '../components.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {ServiceError} from '../errors.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {randomUUID} from 'node:crypto'

test('#168: troca mantém o mestre, componentes e flags de dois cenários',()=>{
 const db=openDatabase(':memory:')
 try{
  const repo=new CommercialRepository(db),scenarios=new ScenarioRepository(db),components=new ComponentRepository(db)
  const at=new AtendimentoRepository(db).create({phone:'123'})
  const initial=scenarios.list(at.id)[0]!
  const from=repo.add(at.id,{pieceCodes:['capo'],scenarioId:initial.id,scenarioRevision:initial.revision})[0]!
  const selected=scenarios.list(at.id)[0]!
  const part=components.save(at.id,{pieceId:from.id,name:'Componente sintético',quantity:'2',manualPrice:'40',notes:'preservar',scenarioId:selected.id,scenarioRevision:selected.revision})
  const afterPart=scenarios.list(at.id)[0]!
  const second=scenarios.create(at.id,{name:'Outro cenário',duplicateFrom:afterPart.id,sourceRevision:afterPart.revision})
  const disabled=scenarios.update(at.id,second.id,{revision:second.revision,pieceFlags:{[from.id]:false},componentFlags:{[part.id]:false}})
  const beforeFlags=scenarios.list(at.id).map(s=>({id:s.id,pieceFlags:s.pieceFlags,serviceFlags:s.serviceFlags,componentFlags:s.componentFlags}))
  const before=db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(at.id)!
  const dest=repo.catalogs().items.find(x=>x.code==='para_choque_traseiro')!
  const request={pieceId:dest.id,revision:from.revision,compositionRevision:Number(before.revision),scenarios:scenarios.list(at.id).map(s=>({id:s.id,revision:s.revision}))}
  const result=repo.replacePiece(at.id,from.id,request)
  assert.equal(result.id,from.id)
  assert.equal(result.pieceId,dest.id)
  assert.equal(result.revision,from.revision+1)
  assert.deepEqual(components.list(at.id).find(c=>c.id===part.id),part)
  for(const old of beforeFlags){
   const current=scenarios.list(at.id).find(s=>s.id===old.id)!
   assert.deepEqual(current.pieceFlags,old.pieceFlags)
   assert.deepEqual(current.serviceFlags,old.serviceFlags)
   assert.deepEqual(current.componentFlags,old.componentFlags)
  }
  assert.equal(scenarios.list(at.id).find(s=>s.id===second.id)!.pieceFlags[from.id],false)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
  assert.throws(()=>repo.replacePiece(at.id,from.id,request),(e:unknown)=>e instanceof ServiceError&&e.status===409)
  assert.notEqual(disabled.revision,scenarios.list(at.id).find(s=>s.id===second.id)!.revision)
 }finally{db.close()}
})
test('#168: destino já selecionado, revisão obsoleta e catálogo inválido não alteram dados',()=>{
 const db=openDatabase(':memory:')
 try{
  const repo=new CommercialRepository(db),scenarios=new ScenarioRepository(db),at=new AtendimentoRepository(db).create({phone:'123'})
  const initial=scenarios.list(at.id)[0]!
  const added=repo.add(at.id,{pieceCodes:['capo','para_choque_traseiro'],scenarioId:initial.id,scenarioRevision:initial.revision})
  const from=added.find(x=>repo.item(x.pieceId).code==='capo')!,dest=added.find(x=>x.id!==from.id)!
  const state=()=>JSON.stringify({diagnoses:repo.list(at.id),scenarios:scenarios.list(at.id),composition:db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(at.id)})
  const before=state()
  const request={pieceId:dest.pieceId,revision:from.revision,compositionRevision:Number(db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(at.id)!.revision),scenarios:scenarios.list(at.id).map(s=>({id:s.id,revision:s.revision}))}
  assert.throws(()=>repo.replacePiece(at.id,from.id,request),(e:unknown)=>e instanceof ServiceError&&e.status===409&&e.code==='PIECE_ALREADY_SELECTED')
  assert.equal(state(),before)
  assert.throws(()=>repo.replacePiece(at.id,from.id,{...request,pieceId:'inexistente'}),(e:unknown)=>e instanceof ServiceError&&e.status===404)
  assert.equal(state(),before)
  assert.throws(()=>repo.replacePiece(at.id,from.id,{...request,compositionRevision:request.compositionRevision-1}),(e:unknown)=>e instanceof ServiceError&&e.status===409)
  assert.equal(state(),before)
 }finally{db.close()}
})


test('#168: troca preserva IDs de serviços e não reescreve orçamento ou PDF emitido',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),budgets=new BudgetRepository(db)
  const scenario=f.scenarios.list(f.at.id)[0]!
  const request={scenarioId:scenario.id,negotiation:{mode:'none' as const}}
  const preview=budgets.preview(f.at.id,request)
  assert.equal(preview.canEmit,true)
  const issued=await budgets.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:randomUUID()})
  const frozen=structuredClone(budgets.get(f.at.id,issued.id))
  const pdf=Buffer.from(budgets.pdf(f.at.id,issued.id))
  const before=f.commercial.list(f.at.id)[0]!
  assert.equal(before.id,f.item.id)
  const dest=f.commercial.catalogs().items.find(i=>i.code==='para_choque_traseiro')!
  const state=db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(f.at.id)!
  const changed=f.commercial.replacePiece(f.at.id,before.id,{pieceId:dest.id,revision:before.revision,compositionRevision:Number(state.revision),scenarios:f.scenarios.list(f.at.id).map(s=>({id:s.id,revision:s.revision}))})
  assert.equal(changed.id,before.id)
  assert.deepEqual(changed.services.map(s=>s.id),before.services.map(s=>s.id))
  assert.deepEqual(changed.services.map(s=>({serviceId:s.serviceId,dimensionId:s.dimensionId,quantity:s.quantity,notes:s.notes,enabled:s.enabled})),before.services.map(s=>({serviceId:s.serviceId,dimensionId:s.dimensionId,quantity:s.quantity,notes:s.notes,enabled:s.enabled})))
  assert.deepEqual(budgets.get(f.at.id,issued.id),frozen)
  assert.deepEqual(Buffer.from(budgets.pdf(f.at.id,issued.id)),pdf)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})
