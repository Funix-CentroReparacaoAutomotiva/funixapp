import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../database.ts'
import {BudgetRepository} from '../budgets.ts'
import {fase4Fixture} from './fixtures/fase4.ts'

const pdf=()=>Buffer.from('%PDF-1.7\nSynthetic painting deadline\n%%EOF')

test('Issue #177: preview, frozen snapshot, PDF terms and scenario flags agree with painting minimum',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=fase4Fixture(db)
  const paint=f.entries[2]!,ordinary=f.entries[1]!
  const item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{
   revision:f.item.revision,
   services:[
    {serviceId:ordinary.serviceId,dimensionId:ordinary.dimensionId,quantity:'1'},
    {serviceId:paint.serviceId,dimensionId:paint.dimensionId,quantity:'1'}
   ]
  })
  const b=new BudgetRepository(db,{render:async()=>pdf()})
  let active=f.scenarios.list(f.at.id).find(s=>s.id===f.scenario.id)!
  // Explicit scenario-local inclusion avoids relying on default insertion flags.
  active=f.scenarios.update(f.at.id,active.id,{revision:active.revision,serviceFlags:Object.fromEntries(item.services.map(s=>[s.id,true]))})
  const request={scenarioId:active.id,negotiation:{mode:'none'}}
  const before=b.preview(f.at.id,request)
  assert.equal(before.canEmit,true)
  assert.equal(before.snapshot.calculation.days,'1')
  assert.equal(before.snapshot.executionDeadline?.effectiveDays,5)
  assert.equal(before.snapshot.calculation.total,'20.1')
  const emitted=await b.emit(f.at.id,{...request,previewToken:before.token,idempotencyKey:randomUUID()})
  assert.equal(emitted.snapshot.executionDeadline?.effectiveDays,5)
  assert.equal(emitted.snapshot.document?.data.condicoes.prazo,'5')
  const frozenPdf=b.pdf(f.at.id,emitted.id)
  const paintedLine=item.services.find(s=>s.serviceId===paint.serviceId)!
  active=f.scenarios.list(f.at.id).find(s=>s.id===active.id)!
  f.scenarios.update(f.at.id,active.id,{revision:active.revision,serviceFlags:{[paintedLine.id]:false}})
  const after=b.preview(f.at.id,request)
  assert.equal(after.canEmit,true)
  assert.equal(after.snapshot.executionDeadline?.effectiveDays,1)
  assert.equal(after.snapshot.calculation.days,'1')
  assert.notEqual(after.token,before.token)
  assert.deepEqual(b.get(f.at.id,emitted.id),emitted)
  assert.deepEqual(b.pdf(f.at.id,emitted.id),frozenPdf)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})
