import test from 'node:test'
import assert from 'node:assert/strict'
import {calculationFixture} from './pricing.test.ts'
import {pieceFinancialSummary} from '../piece-financial-summary.ts'
import type {PricedLine} from '../../shared/pricing.ts'

test('totals come from the pricing engine and excluded lines are ignored',()=>{
 const f=calculationFixture()
 const calc=f.run()
 const result=pieceFinancialSummary(calc)
 assert.equal(result.p!.serviceTotal,'300.15')
 assert.equal(result.p!.componentTotal,'0')
 const extra:PricedLine={...calc.lines[0]!,id:'inactive',kind:'component',included:false,total:null}
 assert.deepEqual(pieceFinancialSummary({...calc,lines:[...calc.lines,extra]}),result)
})
test('all-excluded, non-billed-only and incomplete scope have different meanings',()=>{
 const f=calculationFixture()
 const original=f.run().lines[0]!
 const s=(line:Partial<PricedLine>)=>({...original,...line})
 assert.deepEqual(pieceFinancialSummary({...f.run(),lines:[s({included:false,total:null})]}).p,{serviceTotal:'0',componentTotal:'0',servicesNonBillableOnly:false})
 assert.deepEqual(pieceFinancialSummary({...f.run(),lines:[s({billing:'not_billed',total:null})]}).p,{serviceTotal:'0',componentTotal:'0',servicesNonBillableOnly:true})
 assert.equal(pieceFinancialSummary({...f.run(),lines:[s({total:null})]}).p!.serviceTotal,null)
})
test('sums decimal values exactly and isolates service/component categories and pieces',()=>{
 const f=calculationFixture(),base=f.run(),original=base.lines[0]!
 const rows:PricedLine[]=[
  {...original,total:'0.10',id:'s1'},
  {...original,total:'0.20',id:'s2'},
  {...original,id:'c1',kind:'component',total:'99.9999999'},
  {...original,id:'c2',kind:'component',total:'0.0000001'},
  {...original,id:'other',pieceId:'another',total:'23'},
  {...original,id:'disabled',included:false,total:'9000'},
 ]
 const totals=pieceFinancialSummary({...base,lines:rows})
 assert.equal(totals.p!.serviceTotal,'0.3')
 assert.equal(totals.p!.componentTotal,'100')
 assert.equal(totals.another!.serviceTotal,'23')
 assert.equal(totals.another!.componentTotal,'0')
})
