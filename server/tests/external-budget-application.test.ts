import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {createCodaEventSchema} from '../chat/coda-sync.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {historicalCapture} from './fixtures/historical-capture.ts'
import {normalizeHistoricalCodaCapture} from '../historical-coda-capture.ts'
import {externalBudgetFromCoda} from '../external-budget.ts'
import {ExternalBudgetApplication,createExternalBudgetApplicationSchema} from '../external-budget-application.ts'

function setup(){
  const db=openDatabase(':memory:'),f=commercialFixture(db)
  createCodaEventSchema(db)
  createExternalBudgetApplicationSchema(db)
  const raw=historicalCapture(),data=externalBudgetFromCoda(normalizeHistoricalCodaCapture(raw,raw).data).data
  const source=data
  db.prepare('INSERT INTO coda_sync_atendimentos VALUES(?,?,?)').run('i-synthetic-at',f.at.id,'2026-01-01T00:00:00Z')
  const piece=f.commercial.catalogs().items.find(c=>c.kind==='peca'&&c.code&&c.active&&c.id!==f.item.pieceId)!
  const diagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'Diagnóstico sintético',status:'validado'})
  const mapping={diagnoses:[{sourceId:'i-synthetic-diag',pieceId:piece.id,diagnosisId:diagnosis.id,intensity:'moderado' as const}],
    services:[{sourceId:'i-synthetic-service',options:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1'}]}]}
  const input={atendimentoId:f.at.id,source,mapping}
  const app=new ExternalBudgetApplication(db)
  return {db,f,app,input}
}
function preview(x:ReturnType<typeof setup>){
  const p=x.app.preview(x.input)
  assert.equal(p.state,'preview')
  if(p.state!=='preview')assert.fail('expected preview')
  return {...x.input,previewToken:p.previewToken,confirmed:true,identityReviewed:true,scopeReviewed:true,financialReviewed:true}
}
test('applies exact native scenario once, leaves earlier scope intact and never emits',()=>{
  const x=setup()
  try{
    const before=x.f.commercial.list(x.f.at.id,x.f.scenario.id)
    const input=preview(x)
    assert.deepEqual(x.f.commercial.list(x.f.at.id,x.f.scenario.id),before)
    assert.throws(()=>x.app.confirm({...input,scopeReviewed:false},'synthetic'),{code:'EXTERNAL_CONFIRMATION_REQUIRED'})
    const saved=x.app.confirm(input,'synthetic')
    assert.equal(saved.state,'created');assert.equal(saved.record.result.total,'220')
    assert.equal(saved.record.result.servicesNet,'100');assert.equal(saved.record.result.components,'120');assert.equal(saved.record.result.discount,'0.05')
    const scenarios=x.f.scenarios.list(x.f.at.id)
    assert.equal(scenarios.length,2)
    const old=scenarios.find(s=>s.id===x.f.scenario.id)!,now=scenarios.find(s=>s.id===saved.record.scenarioId)!
    assert.equal(old.pieceFlags[before[0]!.id],true)
    assert.deepEqual(x.f.commercial.list(x.f.at.id,old.id).find(i=>i.id===before[0]!.id),before[0])
    assert.equal(now.pieceFlags[before[0]!.id],false)
    assert.ok(saved.record.result.pieceIds.every(id=>old.pieceFlags[id]===false&&now.pieceFlags[id]===true))
    assert.ok(saved.record.result.componentIds.every(id=>old.componentFlags[id]===false&&now.componentFlags[id]===true))
    assert.deepEqual(now.negotiationDraft,{mode:'discount',value:'0.05'})
    assert.deepEqual(x.app.confirm(input,'synthetic'),{state:'existing',record:saved.record})
    assert.equal(x.db.prepare('SELECT count(*) AS n FROM external_budget_receipts').get()!.n,1)
    assert.equal(x.db.prepare('SELECT count(*) AS n FROM budget_versions').get()!.n,0)
    assert.equal(x.db.prepare('SELECT count(*) AS n FROM work_orders').get()!.n,0)
    assert.equal(x.db.prepare('PRAGMA foreign_key_check').all().length,0)
  }finally{x.db.close()}
})
test('blocks collision, stale preview and performs atomic rollback on receipt failure',()=>{
  const x=setup()
  try{
    const collision={...x.input,mapping:{...x.input.mapping,diagnoses:x.input.mapping.diagnoses.map(d=>({...d,pieceId:x.f.item.pieceId}))}}
    assert.equal(x.app.preview(collision).state,'blocked')
    const stale=preview(x)
    x.f.scenarios.update(x.f.at.id,x.f.scenario.id,{revision:x.f.scenario.revision,name:'Revisado'})
    assert.throws(()=>x.app.confirm(stale,'synthetic'),{code:'EXTERNAL_IMPORT_CONFLICT'})
    const input=preview(x),before=x.f.commercial.list(x.f.at.id,x.f.scenario.id)
    x.db.exec("CREATE TRIGGER synthetic_receipt_fail BEFORE INSERT ON external_budget_receipts BEGIN SELECT RAISE(ABORT,'SYNTHETIC_ROLLBACK');END;")
    assert.throws(()=>x.app.confirm(input,'synthetic'),/SYNTHETIC_ROLLBACK/)
    assert.deepEqual(x.f.commercial.list(x.f.at.id,x.f.scenario.id),before)
    assert.equal(x.f.scenarios.list(x.f.at.id).length,1)
    assert.equal(x.db.prepare('SELECT count(*) AS n FROM component_items').get()!.n,0)
    x.db.exec('DROP TRIGGER synthetic_receipt_fail')
    assert.equal(x.app.confirm(input,'synthetic').state,'created')
    const changed={...x.input,source:{...x.input.source,source:{...x.input.source.source,revision:'2'}}}
    assert.throws(()=>x.app.preview(changed),{code:'EXTERNAL_IMPORT_CONFLICT'})
  }finally{x.db.close()}
})
test('Coda source must link exact attendance and repository is disabled by default',()=>{
  const x=setup()
  try{
    const raw=historicalCapture(),source=externalBudgetFromCoda(normalizeHistoricalCodaCapture(raw,raw).data).data
    x.db.prepare('DELETE FROM coda_sync_atendimentos WHERE coda_row_id=?').run('i-synthetic-at')
    assert.throws(()=>x.app.preview({...x.input,source}),{code:'EXTERNAL_ATTENDANCE_UNLINKED'})
  }finally{x.db.close()}
  const db=openDatabase(':memory:')
  try{assert.throws(()=>new ExternalBudgetApplication(db).preview({atendimentoId:'synthetic',source:null,mapping:{diagnoses:[],services:[]}}),{code:'EXTERNAL_IMPORT_DISABLED'})}
  finally{db.close()}
})

test('non-Coda comparison cannot enter native write path despite valid arithmetic and explicit confirmations',()=>{
  const x=setup()
  try{
    const before=x.f.scenarios.list(x.f.at.id)
    for(const provider of ['cilia','other'] as const){
      const source={...x.input.source,source:{...x.input.source.source,provider,issuerKey:'synthetic-partner',evidenceKind:'file-bytes'}}
      const input={...x.input,source}
      assert.deepEqual(x.app.preview(input),{state:'blocked',issues:['EXTERNAL_PROVIDER_WRITE_NOT_ENABLED']})
      assert.throws(()=>x.app.confirm({...input,previewToken:'a'.repeat(64),confirmed:true,identityReviewed:true,scopeReviewed:true,financialReviewed:true},'synthetic'),{code:'EXTERNAL_PLAN_BLOCKED'})
    }
    assert.deepEqual(x.f.scenarios.list(x.f.at.id),before)
    assert.equal(x.db.prepare('SELECT count(*) AS n FROM external_budget_receipts').get()!.n,0)
  }finally{x.db.close()}
})
