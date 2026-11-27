import {legacyOrder,removeV24FixtureSchema} from './fixtures/production.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../database.ts'
import {migrate} from '../migrations.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {WorkOrderRepository} from '../work-orders.ts'
import {removeV19FixtureSchema} from './fixtures/pre-v19.ts'

// Synthetic, disposable memory DB. Never open the VPS/production database.
test('V18 work order survives the additive V19 customer/chat migration byte-for-byte',async()=>{
 const db=openDatabase(':memory:')
 try {
  const f=commercialFixture(db),budgets=new BudgetRepository(db)
  const input={scenarioId:f.scenario.id,negotiation:{mode:'none'} as const}
  const preview=budgets.preview(f.at.id,input)
  assert.equal(preview.canEmit,true)
  const issued=await budgets.emit(f.at.id,{...input,previewToken:preview.token,idempotencyKey:randomUUID()})
  removeV24FixtureSchema(db)
  const order=legacyOrder(db,issued)
  const storedBefore=db.prepare('SELECT * FROM work_orders WHERE id=?').get(order.id)
  const snapshotBefore=db.prepare('SELECT snapshot,pdf FROM budget_versions WHERE id=?').get(issued.id)
  assert.ok(storedBefore)
  assert.ok(snapshotBefore)
  removeV19FixtureSchema(db)
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,18)
  assert.deepEqual(db.prepare('SELECT * FROM work_orders WHERE id=?').get(order.id),storedBefore)
  migrate(db)
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,31)
  assert.deepEqual(db.prepare('SELECT * FROM work_orders WHERE id=?').get(order.id),{...storedBefore,experience_id:null,__proto__:null})
  assert.deepEqual(db.prepare('SELECT snapshot,pdf FROM budget_versions WHERE id=?').get(issued.id),snapshotBefore)
  assert.equal(new WorkOrderRepository(db).get(f.at.id,issued.id).number,order.number)
  assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{db.close()}
})
