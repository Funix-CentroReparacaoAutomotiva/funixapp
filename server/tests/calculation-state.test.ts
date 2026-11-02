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

test('Stage3 incomplete form is distinct from an outstanding calculation; valid fractional inputs, missing dimensions and disabled scope remain distinct',async()=>{
 const {draftIncomplete,serviceIncomplete,componentIncomplete,validQuantity,validManualPrice,calculationLabel}=await import('../../src/calculation-state.ts')
 const piece=structuredClone(calculationFixture().items[0]!),line=piece.services[0]!
 assert(!draftIncomplete(piece,[]));line.dimensionId=null;assert(serviceIncomplete(line));assert(draftIncomplete(piece,[]))
 line.enabled=false;assert(!draftIncomplete(piece,[]));line.quantity='0';assert(draftIncomplete(piece,[]));line.quantity='1';line.enabled=true;piece.enabled=false;assert(!draftIncomplete(piece,[]))
 for(const q of ['1','0,25','0.000001','999999999.123456'])assert(validQuantity(q))
 for(const q of ['0','-1','1e2','01','1.0000001',''])assert(!validQuantity(q))
 assert(validManualPrice('0'));assert(validManualPrice(null));assert(!validManualPrice('NaN'))
 const p={id:'p',atendimentoId:'at',pieceId:piece.id,name:'',quantity:'1',manualPrice:null,notes:'',revision:1}
 assert(componentIncomplete(p));assert(!componentIncomplete({...p,name:'QA'}))
 assert.equal(calculationLabel('incomplete'),'Rascunho incompleto');assert.equal(calculationLabel('missing'),'Configuração pendente');assert.notEqual(calculationLabel('incomplete'),calculationLabel('pending'))
})
