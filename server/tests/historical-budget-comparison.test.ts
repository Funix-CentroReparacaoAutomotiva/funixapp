import test from 'node:test'
import assert from 'node:assert/strict'
import {compareHistoricalPricing} from '../historical-budget-comparison.ts'
import {normalizeHistoricalCodaCapture} from '../historical-coda-capture.ts'
import {historicalCapture} from './fixtures/historical-capture.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {openDatabase} from '../database.ts'

test('comparison uses mapped service scope, never reapplies MR to historical component sale price',()=>{
  const db=openDatabase(':memory:')
  try{
    const f=commercialFixture(db),raw=historicalCapture(),p=normalizeHistoricalCodaCapture(raw,raw)
    const piece=f.commercial.item(f.item.pieceId),mapping=[
      {rowId:'i-synthetic-diag',role:'piece' as const,catalog:piece},
      {rowId:'i-synthetic-service',role:'service' as const,catalog:f.service},
      {rowId:'i-synthetic-service',role:'dimension' as const,catalog:f.dimension},
    ]
    const before=f.commercial.list(f.at.id,f.scenario.id)
    const result=compareHistoricalPricing(p.data,mapping,f.pricing.get(),f.pricing.settings(f.at.id))
    assert.deepEqual(result.services,{historical:'100.00',current:'100.05',delta:'0.05'})
    assert.equal(result.lines[0]!.delta,'0.05')
    assert.equal(result.components.current,null);assert.equal(result.gross.current,null)
    assert.equal(result.historicNet,'220.00');assert.equal(result.complete,false)
    assert.deepEqual(f.commercial.list(f.at.id,f.scenario.id),before)
    assert.equal(p.data.components[0]!.unitSalePrice,'120.00')
    const missing=compareHistoricalPricing(p.data,mapping,f.pricing.get(),{revision:1,settings:{tableId:null,colorId:null,riskId:null}})
    assert.equal(missing.services.current,null);assert.equal(missing.lines[0]!.delta,null)
    assert.ok(missing.errors.length)
  }finally{db.close()}
})
