import test from 'node:test'
import assert from 'node:assert/strict'
import {preflightExternalBudget,externalBudgetFromCoda} from '../external-budget.ts'
import {planExternalBudget} from '../external-budget-plan.ts'
import {normalizeHistoricalCodaCapture} from '../historical-coda-capture.ts'
import {historicalCapture} from './fixtures/historical-capture.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {openDatabase} from '../database.ts'

function coda(){const raw=historicalCapture();return externalBudgetFromCoda(normalizeHistoricalCodaCapture(raw,raw).data)}
function cilia(){
  const source=coda().data
  return {...source,source:{provider:'cilia' as const,issuerKey:'synthetic-partner',documentNumber:'SYNTHETIC-QUOTE',revision:'1',evidenceSha256:'a'.repeat(64),evidenceKind:'file-bytes' as const},
    services:source.services.map(s=>({...s,quantity:'2',quantityUnit:'hour' as const,unitPrice:'50'}))}
}
test('neutral Coda adapter and synthetic Cilia structure keep correct independent totals',()=>{
  assert.equal(coda().valid,true)
  const x=preflightExternalBudget(cilia())
  assert.equal(x.valid,true);assert.equal(x.data.services[0]!.quantityUnit,'hour');assert.equal(x.data.totals.total,'220')
  const duplicate=cilia();duplicate.services.push({...duplicate.services[0]!})
  assert.throws(()=>preflightExternalBudget(duplicate),{code:'EXTERNAL_BUDGET_INVALID'})
  const partner=cilia();partner.components[0]!.billing='partner'
  assert.ok(preflightExternalBudget(partner).errors.some(x=>x.startsWith('COMPONENT_BILLING_REVIEW')))
  assert.equal(preflightExternalBudget({...cilia(),otherAmounts:[{id:'extra',label:'Franquia',amount:'30',kind:'deductible'}]}).valid,false)
})
test('native preview maps hours explicitly, reconciles derived components and legal discount in existing engine',()=>{
  const db=openDatabase(':memory:')
  try{
    const f=commercialFixture(db),raw=cilia(),piece=f.commercial.item(f.item.pieceId)
    const diagnostic=f.commercial.saveCatalog({kind:'diagnostico',name:'Diagnóstico sintético',status:'validado'})
    const mapping={diagnoses:[{sourceId:'i-synthetic-diag',pieceId:piece.id,diagnosisId:diagnostic.id,intensity:'moderado' as const}],
      services:[{sourceId:'i-synthetic-service',options:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1'}]}]}
    const before=db.prepare('SELECT * FROM diagnosis_items').all()
    const result=planExternalBudget(raw,mapping,[piece,diagnostic,f.service,f.dimension],f.pricing.get(),f.pricing.settings(f.at.id))
    assert.equal(result.state,'matched')
    if(!('plan' in result)||!result.plan)assert.fail('Expected native plan')
    assert.equal(result.plan.calculation.total,'220')
    assert.equal(result.plan.calculation.serviceNet,'100')
    assert.equal(result.plan.calculation.componentSubtotal,'120')
    assert.equal(result.plan.calculation.discount,'0.05')
    assert.equal(result.plan.components[0]!.manualPrice,'60')
    assert.equal(result.plan.selected[0]!.quantity,'1')
    assert.equal(result.canWrite,false)
    assert.deepEqual(db.prepare('SELECT * FROM diagnosis_items').all(),before)
    const config=f.pricing.get();config.config.services[0]!.discountable=false
    assert.equal(planExternalBudget(raw,mapping,[piece,diagnostic,f.service,f.dimension],config,f.pricing.settings(f.at.id)).state,'blocked')
    const sourceDiscount=cilia();sourceDiscount.totals.serviceDiscount='1';sourceDiscount.totals.total='219'
    const discountReview=planExternalBudget(sourceDiscount,mapping,[piece,diagnostic,f.service,f.dimension],f.pricing.get(),f.pricing.settings(f.at.id))
    assert.equal(discountReview.state,'blocked');assert.ok(discountReview.issues.includes('CILIA_SOURCE_DISCOUNT_REVIEW'))
    const changed=cilia();changed.components[0]!.unitSalePrice='120.03';changed.components[0]!.total='120.03';changed.totals.components='120.03';changed.totals.total='220.03'
    assert.equal(planExternalBudget(changed,mapping,[piece,diagnostic,f.service,f.dimension],f.pricing.get(),f.pricing.settings(f.at.id)).state,'blocked')
  }finally{db.close()}
})
