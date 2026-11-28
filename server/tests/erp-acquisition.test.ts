import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {openDatabase} from '../database.ts'
import {handleAcquisition,listAcquisition} from '../erp/acquisition.ts'
import {handleWorkshop,listWorkshopVehicles} from '../erp/workshop.ts'
import {migrate} from '../migrations.ts'
import {ComponentRepository} from '../components.ts'
import {BudgetCancellationRepository} from '../budget-cancellations.ts'
import {ProductionRepository} from '../production.ts'
import {WorkOrderRepository} from '../work-orders.ts'
import {renderOrderV1} from '../os-template.ts'
import {ServiceError} from '../errors.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {identifyForProduction,scheduleInput} from './fixtures/production.ts'
import type {AcquisitionComponent} from '../../shared/acquisition.ts'

test('Aquisição manual compartilha a referência e código da OS; saída física não muda recebimento',async()=>{
  const db=openDatabase(':memory:')
  try {
    const f=commercialFixture(db)
    const components=new ComponentRepository(db)
    components.save(f.at.id,{pieceId:f.item.id,name:'Presilha sintética',quantity:'2',manualPrice:'10',notes:''})
    components.save(f.at.id,{pieceId:f.item.id,name:'Suporte sintético',quantity:'1',manualPrice:'20',notes:''})
    identifyForProduction(db,f.at.id)
    let now=Date.parse('2026-11-25T12:00:00Z')
    const budgetRepo=new BudgetRepository(db)
    const input={scenarioId:f.scenario.id,negotiation:{mode:'none'} as const}
    const issued=await budgetRepo.emit(f.at.id,{...input,previewToken:budgetRepo.preview(f.at.id,input).token,idempotencyKey:randomUUID()})
    const unlinked=await budgetRepo.emit(f.at.id,{...input,previewToken:budgetRepo.preview(f.at.id,input).token,idempotencyKey:randomUUID()})
    const production=new ProductionRepository(db,()=>now)
    assert.deepEqual(listAcquisition(db),[])
    production.schedule(f.at.id,scheduleInput(db,f.at.id,[issued.id]))
    let items=listAcquisition(db)
    assert.equal(items.length,2)
    assert.ok(items.every(item=>item.budgetVersionId===issued.id&&item.status==='identified'&&!item.custody))
    assert.deepEqual(items.map(item=>item.code),['A1','A2'])
    assert.ok(items.every(item=>item.orderNumber===null))
    const id=items[0]!
    const update=(item:AcquisitionComponent,changes:Record<string,unknown>)=>handleAcquisition({
      db,method:'POST',path:'/update',query:new URLSearchParams(),
      body:{experienceId:item.experienceId,budgetVersionId:item.budgetVersionId,lineId:item.lineId,revision:item.revision,...changes},
      now:()=>now,
    }) as AcquisitionComponent
    const invalid=(error:unknown)=>error instanceof ServiceError&&error.status===422
    assert.throws(()=>update(id,{status:'requested'}),invalid)
    assert.throws(()=>update(id,{custody:'stored'}),invalid)
    const requested=update(id,{status:'requested',origin:'Seguradora'})
    assert.equal(requested.status,'requested')
    assert.equal(requested.custody,null)
    now+=86400000
    const approved=update(requested,{status:'approved'})
    assert.equal(approved.statusUpdatedAt,new Date(now).toISOString())
    assert.throws(()=>update(id,{status:'received',origin:'Seguradora'}),error=>error instanceof ServiceError&&error.status===409)
    production.authorize(f.at.id,issued.id,{confirmed:true})
    items=listAcquisition(db,id.experienceId)
    assert.deepEqual(items.map(item=>item.status),['approved','identified'])
    const order=new WorkOrderRepository(db).get(f.at.id,issued.id)
    const html=renderOrderV1(order).content
    for(const item of items) {
      assert.equal(item.orderId,order.id)
      assert.equal(item.orderNumber,order.number)
      assert.ok(html.includes('>'+item.code+'</div>'))
    }
    now+=86400000
    const received=update(items[0]!,{status:'received'})
    assert.equal(received.custody,'stored')
    assert.equal(received.statusUpdatedAt,new Date(now).toISOString())
    assert.equal(received.custodyUpdatedAt,received.statusUpdatedAt)
    // Physical vehicle departure is independent from component custody.
    const move=(action:string,extra:Record<string,unknown>={})=>handleWorkshop({db,method:'POST',path:'/movement',
      query:new URLSearchParams(),now:()=>now,body:{experienceId:id.experienceId,requestId:randomUUID(),action,
        revision:listWorkshopVehicles(db).find(vehicle=>vehicle.experienceId===id.experienceId)!.revision,operator:'QA',...extra}})
    move('entry');move('phase',{phase:'finished',note:'Etapas sintéticas concluídas'});move('departure')
    assert.equal(listAcquisition(db).find(item=>item.lineId===received.lineId)?.custody,'stored')
    now+=86400000
    const out=update(received,{custody:'out'})
    assert.equal(out.status,'received')
    assert.equal(out.statusUpdatedAt,received.statusUpdatedAt)
    assert.equal(out.custodyUpdatedAt,new Date(now).toISOString())
    assert.equal(listAcquisition(db).find(item=>item.lineId===out.lineId)?.custody,'out')
    assert.equal(update(out,{custody:'out'}).revision,out.revision)
    const returned=update(out,{custody:'stored'})
    assert.equal(returned.status,'received')
    assert.equal(returned.custody,'stored')
    assert.ok(!listAcquisition(db).some(item=>item.budgetVersionId===unlinked.id))
    assert.throws(()=>update(returned,{status:'approved'}),invalid)
    const pending=update(items[1]!,{status:'requested',origin:'Cliente'})
    new BudgetCancellationRepository(db,()=>now).cancel(f.at.id,issued.id,{reason:'Cancelamento sintético'})
    assert.equal(listAcquisition(db).find(item=>item.lineId===returned.lineId)?.custody,'stored')
    const late=listAcquisition(db).find(item=>item.lineId===pending.lineId)!
    assert.ok(late.cancelled)
    assert.equal(update(late,{status:'received'}).custody,'stored')
    assert.throws(()=>db.exec("UPDATE erp_component_events SET origin='Cliente'"),/imutável/)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  } finally {db.close()}
})

test('V33 é aditiva, idempotente e mantém atendimentos/OS V32',()=>{
  const db=openDatabase(':memory:')
  try {
    db.exec('DROP TABLE erp_component_events; DELETE FROM schema_migrations WHERE version=33;')
    commercialFixture(db)
    const old=db.prepare('SELECT * FROM atendimentos ORDER BY id').all()
    migrate(db);migrate(db)
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version,33)
    assert.deepEqual(db.prepare('SELECT * FROM atendimentos ORDER BY id').all(),old)
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok')
  }finally{db.close()}
})
