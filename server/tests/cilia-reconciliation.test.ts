import test from 'node:test'
import assert from 'node:assert/strict'
import {chooseCiliaReviewedCombination,listCiliaDimensionCandidates} from '../cilia-reconciliation.ts'
const option=(rowId:string,optionId:string,gross:string,discountable=true)=>({rowId,optionId,serviceId:'service',dimensionId:optionId,gross,discountable})
const group=(rowId:string,sourceTotal:string,prices:string[])=>({rowId,sourceTotal,options:prices.map((p,i)=>option(rowId,rowId+i,p))})
test('Cilia reconciliation prioritizes closeness per group over just the smallest discount',()=>{
 const p=chooseCiliaReviewedCombination('200',[group('a','100',['10','110']),group('b','100',['100','190'])])
 assert.equal(p.state,'matched');assert.equal(p.match?.gross,'210');assert.equal(p.match?.discount,'10');assert.equal(p.match?.deviation,'10')
 assert.deepEqual(p.match?.options.map(o=>o.optionId),['a1','b0'])
})
test('Cilia reconciliation chooses smaller discount on equal deviation and is stable across option order',()=>{
 const a=group('a','100',['90','110']),b=group('b','100',['110','90'])
 const r=chooseCiliaReviewedCombination('200',[a,b])
 assert.equal(r.match?.gross,'200');assert.equal(r.match?.discount,'0');assert.equal(r.match?.deviation,'20')
 assert.deepEqual(r,chooseCiliaReviewedCombination('200',[{...b,options:[...b.options].reverse()},{...a,options:[...a.options].reverse()}]))
})
test('Cilia reconciliation respects discount eligibility, exact cents and missing feasible alternatives',()=>{
 const a={rowId:'a',sourceTotal:'45',options:[option('a','x','74.95',false),option('a','y','149.90')]}
 assert.equal(chooseCiliaReviewedCombination('45',[a]).match?.discount,'104.9')
 assert.equal(chooseCiliaReviewedCombination('45',[{...a,options:[a.options[0]!]}]).state,'no-match')
 assert.equal(chooseCiliaReviewedCombination('45',[group('a','45',['44.99'])]).state,'no-match')
 assert.equal(chooseCiliaReviewedCombination('45',[group('a','45',['45.001'])]).state,'no-match')
 assert.equal(chooseCiliaReviewedCombination('45',[group('a','45',['74.95'])]).match?.discount,'29.95')
})
test('Cilia reconciliation rejects duplicate source/options or a different total, and never returns a partial optimum',()=>{
 const a=group('a','45',['50','60'])
 assert.throws(()=>chooseCiliaReviewedCombination('90',[a,a]),/CILIA_RECONCILIATION_INVALID_INPUT/)
 assert.throws(()=>chooseCiliaReviewedCombination('44',[a]),/CILIA_RECONCILIATION_INVALID_INPUT/)
 assert.throws(()=>chooseCiliaReviewedCombination('45',[{...a,options:[a.options[0]!,a.options[0]!]}]),/CILIA_RECONCILIATION_INVALID_INPUT/)
 const limited=chooseCiliaReviewedCombination('45',[a],1)
 assert.equal(limited.state,'search-limit');assert.equal(limited.match,null);assert.equal(limited.exhaustive,false)
 const many=Array.from({length:49},(_,i)=>group('row-'+i,'45',['45','100','200']))
 assert.equal(chooseCiliaReviewedCombination('2205',many).match?.discount,'0')
})
test('Cilia dimension candidates use only unique, active linked catalog entries and require review',()=>{
 const service={id:'s',kind:'servico',name:'Montagem',active:true,serviceId:null}
 const dim=(id:string,serviceId='s',active=true)=>({id,kind:'dimensao',name:id,active,serviceId})
 const catalog=[service,dim('P'),dim('M'),dim('GG','different'),dim('inactive','s',false),dim('duplicate'),dim('duplicate')]
 assert.deepEqual(listCiliaDimensionCandidates('s',catalog),[{dimensionId:'M',name:'M',requiresTechnicalReview:true},{dimensionId:'P',name:'P',requiresTechnicalReview:true}])
 assert.deepEqual(listCiliaDimensionCandidates('s',[...catalog,service]),[])
 assert.deepEqual(listCiliaDimensionCandidates('s',catalog.slice(1)),[])
})
