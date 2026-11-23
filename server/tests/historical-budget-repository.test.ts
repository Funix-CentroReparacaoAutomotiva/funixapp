import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CommercialRepository} from '../commercial.ts'
import {createCodaEventSchema,CodaEventSyncRepository} from '../chat/coda-sync.ts'
import {createHistoricalBudgetSchema,HistoricalBudgetRepository} from '../historical-budget-repository.ts'
import {historicalCapture} from './fixtures/historical-capture.ts'
import {historicalCodaColumns as c} from '../historical-coda-capture.ts'

function fixture(){
  const db=openDatabase(':memory:')
  createCodaEventSchema(db)
  createHistoricalBudgetSchema(db)
  const at=new CodaEventSyncRepository(db).sync({version:1,source:'coda',eventId:'synthetic:historical',codaRowId:'i-synthetic-at',instance:'funix_comercial',remoteJid:'synthetic_only@lid',phoneE164:null,displayName:'Sintético',occurredAt:1767225600}).atendimentoId
  const catalog=new CommercialRepository(db)
  const piece=catalog.catalogs().items.find(x=>x.kind==='peca'&&x.active&&x.code)!
  const diagnosis=catalog.saveCatalog({kind:'diagnostico',name:'Diagnóstico sintético',status:'validado'})
  const service=catalog.saveCatalog({kind:'servico',name:'Serviço sintético',status:'validado'})
  const dimension=catalog.saveCatalog({kind:'dimensao',name:'Dimensão sintética',serviceId:service.id,status:'validado'})
  const review=[
    {rowId:'i-synthetic-diag',role:'piece',catalogId:piece.id},
    {rowId:'i-synthetic-diag',role:'diagnosis',catalogId:diagnosis.id},
    {rowId:'i-synthetic-service',role:'service',catalogId:service.id},
    {rowId:'i-synthetic-service',role:'dimension',catalogId:dimension.id},
  ]
  const capture=historicalCapture(),captures={first:capture,second:structuredClone(capture)}
  const repo=new HistoricalBudgetRepository(db,()=> '2026-01-02T12:00:00.000Z')
  return {db,at,catalog,piece,diagnosis,service,dimension,review,captures,repo}
}
test('historical preview is read-only, import preserves snapshot, exact replay and ordinary emission isolation',()=>{
  const f=fixture()
  try{
    const before=f.db.prepare('SELECT * FROM atendimentos WHERE id=?').get(f.at)
    const p=f.repo.preview(f.at,f.captures,f.review);assert.equal(p.state,'preview')
    assert.equal(f.repo.list(f.at).length,0)
    const input={atendimentoId:f.at,captures:f.captures,review:f.review,confirmed:true,previewToken:p.previewToken}
    assert.throws(()=>f.repo.confirm({...input,confirmed:false},'operator'),{code:'HISTORICAL_CONFIRMATION_REQUIRED'})
    const saved=f.repo.confirm(input,'operator')
    assert.equal(saved.state,'created');assert.equal(saved.record.snapshot.totals.total,'220.00')
    assert.equal(saved.record.pdfAvailable,false);assert.equal(saved.record.workOrderAvailable,false)
    assert.deepEqual(f.repo.confirm(input,'operator'),{state:'existing',record:saved.record})
    assert.deepEqual(f.repo.get(f.at,saved.record.id),saved.record)
    assert.deepEqual(f.db.prepare('SELECT * FROM atendimentos WHERE id=?').get(f.at),before)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM budget_versions').get()!.n,0)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM budget_emission_attempts').get()!.n,0)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM work_orders').get()!.n,0)
    assert.throws(()=>f.db.prepare('UPDATE historical_budget_imports SET source_number=?').run('other'),/immutable/)
    assert.throws(()=>f.db.exec('DELETE FROM historical_budget_imports'),/immutable/)
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0)
  }finally{f.db.close()}
})
test('exact attendance only, reviewed catalog role and dimension ownership required',()=>{
  const f=fixture()
  try{
    const other=new AtendimentoRepository(f.db).create({phone:'123',name:'Outro sintético'})
    assert.throws(()=>f.repo.preview(other.id,f.captures,f.review),{code:'HISTORICAL_IMPORT_CONFLICT'})
    assert.throws(()=>f.repo.preview(f.at,f.captures,f.review.slice(1)),{code:'HISTORICAL_CATALOG_REVIEW_INVALID'})
    const wrong=f.review.map(x=>x.role==='piece'?{...x,catalogId:f.service.id}:x)
    assert.throws(()=>f.repo.preview(f.at,f.captures,wrong),{code:'HISTORICAL_CATALOG_REVIEW_INVALID'})
    const service2=f.catalog.saveCatalog({kind:'servico',name:'Outro serviço',status:'validado'})
    const wrongDimension=f.catalog.saveCatalog({kind:'dimensao',name:'Outra dimensão',serviceId:service2.id,status:'validado'})
    const mismatch=f.review.map(x=>x.role==='dimension'?{...x,catalogId:wrongDimension.id}:x)
    assert.throws(()=>f.repo.preview(f.at,f.captures,mismatch),{code:'HISTORICAL_CATALOG_REVIEW_INVALID'})
    assert.equal(f.repo.list(f.at).length,0)
  }finally{f.db.close()}
})
test('source or catalog/attendance changes invalidate preview; no overwrite or partial write',()=>{
  const f=fixture()
  try{
    const p=f.repo.preview(f.at,f.captures,f.review)
    const input={atendimentoId:f.at,captures:f.captures,review:f.review,confirmed:true,previewToken:p.previewToken}
    f.catalog.saveCatalog({revision:f.service.revision,name:'Serviço sintético revisado'},f.service.id)
    assert.throws(()=>f.repo.confirm(input,'operator'),{code:'HISTORICAL_IMPORT_CONFLICT'})
    const p2=f.repo.preview(f.at,f.captures,f.review)
    const changed=historicalCapture();changed.tables.budget.pages[0]!.rows[0]!.values[c.budget.days]={value:8}
    assert.throws(()=>f.repo.confirm({...input,previewToken:p2.previewToken,captures:{first:changed,second:structuredClone(changed)}},'operator'),{code:'HISTORICAL_IMPORT_CONFLICT'})
    f.db.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON historical_budget_imports BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAIL');END;")
    assert.throws(()=>f.repo.confirm({...input,previewToken:p2.previewToken},'operator'),/SYNTHETIC_FAIL/)
    assert.equal(f.repo.list(f.at).length,0)
    f.db.exec('DROP TRIGGER synthetic_fail')
    const saved=f.repo.confirm({...input,previewToken:p2.previewToken},'operator')
    assert.equal(saved.state,'created')
    assert.throws(()=>f.repo.preview(f.at,{first:changed,second:structuredClone(changed)},f.review),{code:'HISTORICAL_IMPORT_CONFLICT'})
    assert.equal(f.repo.list(f.at).length,1)
  }finally{f.db.close()}
})
test('repository remains disabled without explicit schema setup',()=>{
  const db=openDatabase(':memory:')
  try{assert.throws(()=>new HistoricalBudgetRepository(db).list('synthetic'),{code:'HISTORICAL_IMPORT_DISABLED'})}
  finally{db.close()}
})
