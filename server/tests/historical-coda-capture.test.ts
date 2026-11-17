import test from 'node:test'
import assert from 'node:assert/strict'
import {historicalCodaColumns as c,normalizeHistoricalCodaCapture} from '../historical-coda-capture.ts'
import {historicalCapture} from './fixtures/historical-capture.ts'

test('connector normalization uses exact source parents, amounts and distinct physical stages',()=>{
  const a=historicalCapture(),b=structuredClone(a)
  b.tables.stages.pages[0]!.rows.reverse()
  const p=normalizeHistoricalCodaCapture(a,b)
  assert.equal(p.financialIntegrity,true)
  assert.equal(p.data.totals.discount,'0.00')
  assert.equal(p.calculated.total,'220')
  assert.equal(p.data.stages.length,3)
  assert.equal(p.data.diagnoses[0]!.intensity,'Moderado')
  assert.equal(p.data.installments[0]!.amount,'77.73')
  assert.ok(p.warnings.some(x=>x.code==='DUPLICATE_STAGE_CODE'))
})
test('rejects incomplete captures, incompatible parents, ambiguous source linkage and changed reads',()=>{
  const a=historicalCapture(),missing=historicalCapture(),changed=historicalCapture(),wrong=historicalCapture(),duplicate=historicalCapture()
  missing.tables.stages.pages[0]!.totalRows++
  assert.throws(()=>normalizeHistoricalCodaCapture(missing,missing),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
  wrong.tables.stages.pages[0]!.rows[0]!.values[c.stages.parent]={value:'other'}
  assert.throws(()=>normalizeHistoricalCodaCapture(wrong,wrong),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
  duplicate.tables.budget.pages[0]!.rows.push(structuredClone(duplicate.tables.budget.pages[0]!.rows[0]!))
  duplicate.tables.budget.pages[0]!.totalRows++
  assert.throws(()=>normalizeHistoricalCodaCapture(duplicate,duplicate),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
  changed.tables.budget.pages[0]!.rows[0]!.values[c.budget.days]={value:8}
  assert.throws(()=>normalizeHistoricalCodaCapture(a,changed),{code:'HISTORICAL_CODA_CAPTURE_CHANGED'})
})
test('fails closed on a mismatched budget relation or non-cent monetary source',()=>{
  const a=historicalCapture(),b=historicalCapture()
  a.tables.budget.pages[0]!.rows[0]!.values[c.budget.serviceRefs]={value:[]}
  assert.throws(()=>normalizeHistoricalCodaCapture(a,a),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
  b.tables.components.pages[0]!.rows[0]!.values[c.components.unit]={value:currency(120.003)}
  assert.throws(()=>normalizeHistoricalCodaCapture(b,b),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
})
