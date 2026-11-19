import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveHistoricalManualPrice,chooseReviewedServiceCombination} from '../historical-budget-reconciliation.ts'
import {Q} from '../exact.ts'

test('reverse component MR reproduces sale unit using existing ceiling without claiming purchase cost',()=>{
  for(const [unit,mr] of [['84.00','1.2'],['638.40','1.2'],['1920.00','1.2'],['235.20','1.2'],['478.80','1.2'],['10.05','3.333333']]){
    const candidate=deriveHistoricalManualPrice(unit!,mr!)
    assert.notEqual(candidate,null)
    assert.equal(Q.from(candidate!).mul(Q.from(mr!)).ceilUnit().cmp(Q.from(unit!)),0)
  }
  assert.equal(deriveHistoricalManualPrice('10.03','1.2'),null)
  assert.equal(deriveHistoricalManualPrice('10.05','0'),null)
})
const option=(rowId:string,optionId:string,gross:string,discountable:boolean)=>({rowId,optionId,gross,discountable,serviceId:'synthetic-service',dimensionId:'synthetic-dimension'})
test('selects smallest valid gross from reviewed alternatives with exact eligible discount',()=>{
  const groups=[
    [option('a','a1','30',false),option('a','a2','40',false)],
    [option('b','b1','60',true),option('b','b2','80',true)],
  ]
  const result=chooseReviewedServiceCombination('95.25',groups)
  assert.equal(result.state,'matched')
  assert.deepEqual(result.match?.options.map(o=>o.optionId),['a2','b1'])
  assert.equal(result.match?.gross,'100')
  assert.equal(result.match?.discount,'4.75')
  assert.equal(result.match?.net,'95.25')
})
test('does not invent scope or use discount on protected services; search cap is explicit',()=>{
  assert.equal(chooseReviewedServiceCombination('99.99',[[option('a','a1','100',false)]]).state,'no-match')
  assert.equal(chooseReviewedServiceCombination('101',[[option('a','a1','100',true)]]).state,'no-match')
  assert.equal(chooseReviewedServiceCombination('10',[[option('a','a1','20',true)]],1).state,'search-limit')
  assert.throws(()=>chooseReviewedServiceCombination('20',[[option('a','a1','20',true),option('b','b1','20',true)]]))
})
