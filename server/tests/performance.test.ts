import test from 'node:test'
import assert from 'node:assert/strict'
import type {DatabaseSync} from 'node:sqlite'
import type {DiagnosisItem,Scenario} from '../../shared/commercial.ts'
import {openDatabase} from '../database.ts'
import {performanceCases,performanceFixture} from './fixtures/performance.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {calculate} from '../pricing-engine.ts'
import {pieceSignature,pieceDataSignature,partSignature,partDataSignature} from '../../src/calculation-state.ts'

// Independent pre-optimization readers: same database, original per-row SQL contracts.
function legacyItems(db:DatabaseSync,at:string,scene:string):DiagnosisItem[]{
 return db.prepare('SELECT * FROM diagnosis_items WHERE atendimento_id=? ORDER BY created_at,id').all(at).map(r=>({id:String(r.id),atendimentoId:at,pieceId:String(r.piece_id),diagnosisId:r.diagnosis_id===null?null:String(r.diagnosis_id),notes:String(r.notes),revision:Number(r.revision),createdAt:String(r.created_at),updatedAt:String(r.updated_at),enabled:db.prepare('SELECT enabled FROM scenario_piece_flags WHERE scenario_id=? AND piece_id=?').get(scene,r.id!)?.enabled===1,services:db.prepare('SELECT * FROM diagnosis_services WHERE diagnosis_item_id=? ORDER BY rowid').all(r.id!).map(l=>({id:String(l.id),serviceId:String(l.service_id),dimensionId:l.dimension_id===null?null:String(l.dimension_id),quantity:String(l.quantity),notes:String(l.notes),diagnosisId:l.diagnosis_id===null?null:String(l.diagnosis_id),enabled:db.prepare('SELECT enabled FROM scenario_service_flags WHERE scenario_id=? AND service_id=?').get(scene,l.id!)?.enabled===1}))}))
}
function legacyScenarios(db:DatabaseSync,at:string):Scenario[]{
 return db.prepare('SELECT * FROM scenarios WHERE atendimento_id=? ORDER BY position').all(at).map(r=>{
  const flags=(table:string,column:string)=>Object.fromEntries(db.prepare(`SELECT ${column} AS id,enabled FROM ${table} WHERE scenario_id=?`).all(r.id!).map(f=>[String(f.id),f.enabled===1]))
  return{id:String(r.id),atendimentoId:at,name:String(r.name),position:Number(r.position),revision:Number(r.revision),pieceFlags:flags('scenario_piece_flags','piece_id'),serviceFlags:flags('scenario_service_flags','service_id'),componentFlags:flags('scenario_component_flags','component_id')}
 })
}

test('batched reads equal original SQL for every scenario and calculated result, with constant SELECT count and Atendimento isolation',()=>{
 for(const spec of performanceCases){
  const db=openDatabase(':memory:')
  try{
   const f=performanceFixture(db,spec),other=new AtendimentoRepository(db).create({phone:'123'});f.commercial.add(other.id,{pieceCodes:['capo']})
   for(const s of f.scenarios.list(f.at.id)){
    const p=f.commercial.list(f.at.id,s.id)[0]!
    f.scenarios.update(f.at.id,s.id,{revision:s.revision,pieceFlags:{[p.id]:s.position%2===0},serviceFlags:{[p.services[0]!.id]:false}})
   }
   assert.deepEqual(f.scenarios.list(f.at.id),legacyScenarios(db,f.at.id))
   for(const s of f.scenarios.list(f.at.id)){
    const before=legacyItems(db,f.at.id,s.id),after=f.commercial.list(f.at.id,s.id)
    assert.deepEqual(after.map(({intensity:_intensity,...p})=>p),before,s.id)
    const args=[f.components.list(f.at.id),f.commercial.catalogs().items,s,f.pricing.get().config,f.pricing.settings(f.at.id).settings] as const
    assert.deepEqual(calculate(after,...args),calculate(before,...args))
   }
   const prepare=db.prepare.bind(db);let selects=0
   db.prepare=(sql)=>{if(/^SELECT/i.test(sql))selects++;return prepare(sql)}
   f.scenarios.list(f.at.id);f.commercial.list(f.at.id)
   db.prepare=prepare;assert.equal(selects,9,`${spec.name}: no per-piece/service/scenario queries`)
   assert.equal(f.commercial.list(other.id).length,1);assert(!f.commercial.list(f.at.id).some(p=>p.atendimentoId===other.id))
  }finally{db.close()}
 }
})

test('autosave signatures ignore metadata/default-property order while retaining persistent edits and scenario flags',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=performanceFixture(db,performanceCases[0]),p=f.commercial.list(f.at.id)[0]!,copy=structuredClone(p)
  copy.revision++;copy.updatedAt='2030-01-01';copy.services[0]!.quantity='01.000'
  assert.equal(pieceSignature(p),pieceSignature(copy));copy.services.reverse();assert.equal(pieceSignature(p),pieceSignature(copy),'visual order is not persisted ordering')
  const flipped=structuredClone(p);flipped.services[0]!.enabled=!flipped.services[0]!.enabled
  assert.notEqual(pieceSignature(p),pieceSignature(flipped));assert.equal(pieceDataSignature(p),pieceDataSignature(flipped))
  const paired=structuredClone(p);paired.services[0]!.quantity='2';paired.services[1]!.enabled=false;const swapped=structuredClone(paired);swapped.services[0]!.enabled=false;swapped.services[1]!.enabled=true;assert.notEqual(pieceSignature(paired,false),pieceSignature(swapped,false),'recovery keeps attributes paired with their flags')
  flipped.services[0]!.notes='must save';assert.notEqual(pieceDataSignature(p),pieceDataSignature(flipped))
  const part={...f.components.list(f.at.id)[0]!,enabled:true},next={...part,revision:99,quantity:'01.000',manualPrice:'10.000'}
  assert.equal(partSignature(part),partSignature(next));next.enabled=false
  assert.notEqual(partSignature(part),partSignature(next));assert.equal(partDataSignature(part),partDataSignature(next))
 }finally{db.close()}
})
