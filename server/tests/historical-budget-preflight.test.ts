import test from 'node:test'
import assert from 'node:assert/strict'
import {preflightHistoricalBudget} from '../historical-budget-preflight.ts'

function fixture(){
  return {
    schema:1,source:{docId:'synthetic-doc',budgetTableId:'grid-budget',budgetRowId:'i-budget',budgetNumber:'TEST-BUDGET-C',atendimentoTableId:'grid-attendance',atendimentoRowId:'i-attendance',diagnosisTableId:'grid-diagnosis',serviceTableId:'grid-service',componentTableId:'grid-component',stageTableId:'grid-stage'},
    metadata:{createdAt:'2026-01-02T00:00:00.000Z',status:'Consentido',deadlineDays:7,colorFactor:null,riskFactor:null,pricingSource:'Padrão'},
    totals:{services:'300.00',components:'120.00',discount:'10.00',total:'410.00'},
    diagnoses:[{rowId:'i-d1',code:'A',piece:'Peça sintética A',position:'Dianteiro',damage:'Riscado',intensity:'Moderado',services:'200.00',components:'120.00'},{rowId:'i-d2',code:'B',piece:'Peça sintética B',position:'Esquerdo',damage:'Comprometido',intensity:'Severo',services:'100.00',components:'0.00'}],
    services:[{rowId:'i-s1',diagnosisRowId:'i-d1',code:'A.1',service:'Pintura',dimension:'Completa',quantity:'1',unitPrice:'200.00',total:'200.00',energy:'3'},{rowId:'i-s2',diagnosisRowId:'i-d2',code:'B.1',service:'Montagem',dimension:'G',quantity:'2',unitPrice:'50.00',total:'100.00',energy:'2'}],
    components:[{rowId:'i-c1',diagnosisRowId:'i-d1',code:'A.i',description:'Item sintético já com fator',quantity:'1',unitSalePrice:'120.00',total:'120.00'}],
    stages:[{rowId:'i-e1',serviceRowId:'i-s1',code:'A.1.1',stage:'Preparação',energy:'1',allocatedAmount:'66.666666666666667',category:'Preparação técnica'},{rowId:'i-e2',serviceRowId:'i-s1',code:'A.1.2',stage:'Acabamento',energy:'1',allocatedAmount:'66.666666666666667',category:'Pintura e acabamento'},{rowId:'i-e3',serviceRowId:'i-s1',code:'A.1.2',stage:'Colorimetria',energy:'1',allocatedAmount:'66.666666666666667',category:'Preparação técnica'},{rowId:'i-e4',serviceRowId:'i-s2',code:'B.1.1',stage:'Montagem',energy:'2',allocatedAmount:'100.00',category:'Preparação técnica'}],
    installments:[{count:3,amount:'144.87',total:'434.60'}]
  }
}
test('historical preflight preserves original amounts and source rows; no current MR or pricing applied',()=>{
  const raw=fixture(),copy=structuredClone(raw),p=preflightHistoricalBudget(raw)
  assert.equal(p.financialIntegrity,true)
  assert.deepEqual(p.calculated,{services:'300',components:'120',total:'410'})
  assert.deepEqual(raw,copy)
  assert.equal(p.data.stages.length,4)
  assert.equal(p.data.metadata.colorFactor,null)
  assert.equal(p.data.components[0]!.unitSalePrice,'120.00')
  assert.ok(p.warnings.some(x=>x.code==='DUPLICATE_STAGE_CODE'))
  assert.ok(p.warnings.some(x=>x.code==='STAGE_ALLOCATION_ROUNDING'))
  assert.ok(p.warnings.some(x=>x.code==='HISTORICAL_FACTORS_UNKNOWN'))
  assert.ok(p.warnings.some(x=>x.code==='INSTALLMENT_ROUNDING'))
})
test('digest does not depend on input key or physical row ordering and is sensitive to historical changes',()=>{
  const raw=fixture(),original=preflightHistoricalBudget(raw)
  raw.services.reverse();raw.stages.reverse();raw.diagnoses.reverse()
  const reversed=Object.fromEntries(Object.entries(raw).reverse())
  assert.equal(preflightHistoricalBudget(reversed).digest,original.digest)
  raw.metadata.status='Cancelado'
  assert.notEqual(preflightHistoricalBudget(raw).digest,original.digest)
})
test('rejects malformed, lossy or duplicate physical identities',()=>{
  const raw=fixture()
  raw.stages.push({...raw.stages[0]!})
  assert.throws(()=>preflightHistoricalBudget(raw),{code:'HISTORICAL_BUDGET_INVALID'})
  assert.throws(()=>preflightHistoricalBudget({...fixture(),totals:{...fixture().totals,total:410}}),{code:'HISTORICAL_BUDGET_INVALID'})
  assert.throws(()=>preflightHistoricalBudget({...fixture(),metadata:{...fixture().metadata,createdAt:'2026-02-30T00:00:00.000Z'}}),{code:'HISTORICAL_BUDGET_INVALID'})
  assert.throws(()=>preflightHistoricalBudget({...fixture(),authorization:true}),{code:'HISTORICAL_BUDGET_INVALID'})
})
test('reports integrity errors without altering original commercial commitment',()=>{
  const raw=fixture()
  raw.services[0]!.total='199.99';raw.components[0]!.diagnosisRowId='i-missing'
  raw.stages[0]!.allocatedAmount='0';raw.stages[1]!.energy='2'
  raw.installments[0]!.total='500.00'
  const p=preflightHistoricalBudget(raw)
  assert.equal(p.financialIntegrity,false)
  for(const code of ['SERVICE_TOTAL_MISMATCH','COMPONENT_PARENT_MISSING','DIAGNOSIS_SERVICES_MISMATCH','DIAGNOSIS_COMPONENTS_MISMATCH','SERVICES_TOTAL_MISMATCH','BUDGET_TOTAL_MISMATCH','STAGE_ALLOCATION_MISMATCH','STAGE_ENERGY_MISMATCH','INSTALLMENT_TOTAL_MISMATCH'])assert.ok(p.errors.some(e=>e.code===code),code)
  assert.equal(p.data.totals.total,'410.00')
})
test('requires parent stages and prevents a global discount from reducing components',()=>{
  const raw=fixture();raw.stages=[];raw.totals.discount='350';raw.totals.total='70'
  const p=preflightHistoricalBudget(raw)
  assert.equal(p.financialIntegrity,false)
  assert.ok(p.errors.some(x=>x.code==='STAGES_MISSING'))
  assert.ok(p.errors.some(x=>x.code==='DISCOUNT_EXCEEDS_SERVICES'))
})
