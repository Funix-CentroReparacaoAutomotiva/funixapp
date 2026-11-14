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
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

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


test('#168: troca permanece após fechar e reabrir SQLite sintético',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-replace-piece-')),file=join(dir,'test.sqlite')
 let db=openDatabase(file)
 try{
  const repo=new CommercialRepository(db),at=new AtendimentoRepository(db).create({phone:'123'})
  const initial=new ScenarioRepository(db).list(at.id)[0]!
  const from=repo.add(at.id,{pieceCodes:['capo'],scenarioId:initial.id,scenarioRevision:initial.revision})[0]!
  const selected=new ScenarioRepository(db).list(at.id)[0]!
  const part=new ComponentRepository(db).save(at.id,{pieceId:from.id,name:'Peça de teste',quantity:'1',manualPrice:'10',notes:'Reter',scenarioId:selected.id,scenarioRevision:selected.revision})
  const destination=repo.catalogs().items.find(c=>c.code==='para_choque_traseiro')!
  const request={pieceId:destination.id,revision:from.revision,compositionRevision:Number(db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(at.id)!.revision),scenarios:new ScenarioRepository(db).list(at.id).map(s=>({id:s.id,revision:s.revision}))}
  const changed=repo.replacePiece(at.id,from.id,request)
  db.close()
  db=openDatabase(file)
  const stored=new CommercialRepository(db).list(at.id)[0]!
  assert.equal(stored.id,from.id)
  assert.equal(stored.pieceId,destination.id)
  assert.equal(stored.revision,changed.revision)
  const savedPart=new ComponentRepository(db).list(at.id)[0]!
  assert.equal(savedPart.id,part.id)
  assert.equal(savedPart.pieceId,from.id)
  assert.equal(savedPart.manualPrice,'10')
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})

test('#168: troca direta não bloqueia orçamento e preserva documento emitido',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),budgets=new BudgetRepository(db)
  const original=f.commercial.list(f.at.id)[0]!,sc=f.scenarios.list(f.at.id)[0]!
  const request={scenarioId:sc.id,negotiation:{mode:'none' as const}}
  const preview=budgets.preview(f.at.id,request);assert.equal(preview.canEmit,true)
  const issued=await budgets.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:randomUUID()})
  const frozen=structuredClone(budgets.get(f.at.id,issued.id)),pdf=Buffer.from(budgets.pdf(f.at.id,issued.id))
  const destination=f.commercial.catalogs().items.find(c=>c.code==='para_choque_traseiro')!
  const state=()=>({revision:Number(db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(f.at.id)!.revision),scenarios:f.scenarios.list(f.at.id).map(x=>({id:x.id,revision:x.revision}))})
  const old=state()
  const changed=f.commercial.replacePiece(f.at.id,original.id,{pieceId:destination.id,revision:original.revision,compositionRevision:old.revision,scenarios:old.scenarios})
  assert.equal(changed.pieceReviewPending,false)
  assert.equal(changed.id,original.id)
  assert.deepEqual(changed.services,original.services)
  assert.equal(budgets.preview(f.at.id,request).canEmit,true)
  const nextPreview=budgets.preview(f.at.id,request)
  const next=await budgets.emit(f.at.id,{...request,previewToken:nextPreview.token,idempotencyKey:randomUUID()})
  assert.equal(next.snapshot.composition.items.find(item=>item.id===original.id)?.pieceId,destination.id)
  assert.deepEqual(budgets.get(f.at.id,issued.id),frozen)
  assert.deepEqual(Buffer.from(budgets.pdf(f.at.id,issued.id)),pdf)
 }finally{db.close()}
})

test('#168: pendência legada de revisão não bloqueia orçamento e é limpa na próxima troca',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),budgets=new BudgetRepository(db)
  const original=f.commercial.list(f.at.id)[0]!
  db.prepare('UPDATE diagnosis_items SET piece_review_pending=1 WHERE id=?').run(original.id)
  const before=budgets.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}})
  assert.equal(before.canEmit,true)
  const next=f.commercial.catalogs().items.find(x=>x.code==='para_choque_traseiro')!
  const state=db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(f.at.id)!
  const switched=f.commercial.replacePiece(f.at.id,original.id,{pieceId:next.id,revision:original.revision,compositionRevision:Number(state.revision),scenarios:f.scenarios.list(f.at.id).map(s=>({id:s.id,revision:s.revision}))})
  assert.equal(switched.pieceReviewPending,false)
  assert.equal(budgets.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}}).canEmit,true)
 }finally{db.close()}
})
