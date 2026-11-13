import test from 'node:test'
import assert from 'node:assert/strict'
import {calculationFixture} from './pricing.test.ts'
import {codaServiceId} from '../../shared/commercial-curation.ts'
import {executionDeadline,hasIncludedPainting} from '../../shared/budget-terms.ts'

const paint=codaServiceId('i-XDTMBmueos')

test('Issue #177: automatic deadline is max(technical, 5) only when painting is included',()=>{
 for(const [technical,expected] of [['3',5],['5',5],['8',8]] as const){
  const result=executionDeadline({mode:'automatic',manualDays:null},technical,true)
  assert.equal(result.technicalDays,technical)
  assert.equal(result.effectiveDays,expected)
  assert.equal(result.warning,technical==='3'?'Prazo mínimo de 5 dias úteis aplicado devido à pintura.':null)
 }
 assert.equal(executionDeadline(undefined,'3',false).effectiveDays,3)
 assert.equal(executionDeadline(undefined,null,true).effectiveDays,null)
 assert.equal(executionDeadline(undefined,'0',true).effectiveDays,null)
 assert.equal(executionDeadline(undefined,'not-valid',true).effectiveDays,null)
})

test('Issue #177: manual duration remains persisted as entered; emitted effective days respect painting floor',()=>{
 const input={mode:'manual' as const,manualDays:3}
 const painted=executionDeadline(input,'2',true)
 assert.equal(painted.manualDays,3)
 assert.equal(painted.technicalDays,'2')
 assert.equal(painted.effectiveDays,5)
 assert.match(painted.warning??'',/Prazo manual inferior/)
 assert.equal(executionDeadline(input,'8',true).effectiveDays,5)
 assert.equal(executionDeadline({mode:'manual',manualDays:8},'3',true).effectiveDays,8)
 assert.equal(executionDeadline(input,'2',false).effectiveDays,3)
 assert.equal(executionDeadline({mode:'manual',manualDays:null},'3',true).effectiveDays,null)
 assert.equal(executionDeadline({mode:'manual',manualDays:5},null,true).effectiveDays,5)
})

test('Issue #177: only catalog ID and effective scenario flags trigger the deadline floor',()=>{
 const f=calculationFixture()
 const second={...f.scenario,id:'b',serviceFlags:{l:false},pieceFlags:{p:true}}
 f.items[0]!.services[0]!.serviceId=paint
 assert.equal(hasIncludedPainting(f.items,f.scenario),true)
 assert.equal(hasIncludedPainting(f.items,second),false)
 f.scenario.serviceFlags.l=false
 assert.equal(hasIncludedPainting(f.items,f.scenario),false)
 f.scenario.serviceFlags.l=true
 f.scenario.pieceFlags.p=false
 assert.equal(hasIncludedPainting(f.items,f.scenario),false)
 f.scenario.pieceFlags.p=true
 f.items[0]!.services[0]!.serviceId='other-service'
 assert.equal(hasIncludedPainting(f.items,f.scenario),false)
 f.items[0]!.services[0]!.serviceId=paint
 f.items[0]!.services.push({id:'other',serviceId:'ordinary',dimensionId:'dim',quantity:'1',enabled:true})
 f.scenario.serviceFlags.other=true
 assert.equal(hasIncludedPainting(f.items,f.scenario),true)
 f.scenario.serviceFlags.l=false
 assert.equal(hasIncludedPainting(f.items,f.scenario),false)
 f.scenario.serviceFlags.l=true
 const calculation={lines:[{id:'l',kind:'service',included:false}]}
 assert.equal(hasIncludedPainting(f.items,f.scenario,calculation as never),false)
 calculation.lines[0]!.included=true
 assert.equal(hasIncludedPainting(f.items,f.scenario,calculation as never),true)
 assert.equal(executionDeadline(undefined,'3',hasIncludedPainting(f.items,f.scenario,calculation as never)).effectiveDays,5)
 calculation.lines[0]!.included=false
 assert.equal(executionDeadline(undefined,'3',hasIncludedPainting(f.items,f.scenario,calculation as never)).effectiveDays,3)
 assert.equal(executionDeadline(undefined,'5',false).effectiveDays,5) // Technical 5, not a paint floor.
})
