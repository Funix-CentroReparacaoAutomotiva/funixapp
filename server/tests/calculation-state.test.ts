import test from 'node:test'
import assert from 'node:assert/strict'
import {calculationFixture} from './pricing.test.ts'
import {diagnosisPending,servicePending} from '../../src/calculation-state.ts'

test('input comparison invalidates only affected service, handles fractions/flags and restores confirmed status without calculating money',()=>{
 const f=calculationFixture(),saved=f.items[0]!,draft=structuredClone(saved)
 draft.services.push({...draft.services[0]!,id:'second'});const baseline=structuredClone(draft)
 assert(!diagnosisPending(draft,[],baseline,[]))
 draft.services[0]!.quantity='0,25'
 assert(servicePending(draft,draft.services[0]!,baseline));assert(!servicePending(draft,draft.services[1]!,baseline))
 assert(diagnosisPending(draft,[],baseline,[]))
 baseline.services[0]!.quantity='0.250000';assert(!servicePending(draft,draft.services[0]!,baseline))
 draft.services[0]!.dimensionId=null;assert(servicePending(draft,draft.services[0]!,baseline))
 draft.enabled=false;assert(servicePending(draft,draft.services[1]!,baseline))
})
test('components, new/incomplete or removed lines invalidate financial totals without per-component factor or frontend sums',()=>{
 const piece=calculationFixture().items[0]!,p={id:'c',atendimentoId:'at',pieceId:piece.id,name:'QA',quantity:'0.25',manualPrice:'0',notes:'',revision:1,enabled:true}
 assert(!diagnosisPending(piece,[p],piece,[{...p,quantity:'0,250'}]))
 assert(diagnosisPending(piece,[{...p,manualPrice:null}],piece,[p]))
 assert(diagnosisPending(piece,[{...p,enabled:false}],piece,[p]))
 assert(diagnosisPending(piece,[],piece,[p]))
 assert(diagnosisPending({...piece,services:[]},[],piece,[]))
 assert(diagnosisPending({...piece,services:[...piece.services,{...piece.services[0]!,id:'new:qa',serviceId:''}]},[],piece,[]))
})
