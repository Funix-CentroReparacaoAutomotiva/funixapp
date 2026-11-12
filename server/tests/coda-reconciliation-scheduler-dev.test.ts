import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startDevelopmentReconciliationScheduler } from '../chat/coda-reconciliation-scheduler-dev.ts'

test('DEV scheduler: only one active cycle and stop waits for completion',async()=>{
  let release:()=>void=()=>{}
  const gate=new Promise<void>(resolve=>{release=resolve})
  let runs=0
  const scheduler=startDevelopmentReconciliationScheduler(async()=>{
    runs++
    await gate
    return {status:'completed'}
  },{intervalMs:60_000})
  const pending=scheduler.trigger()
  assert.equal(await scheduler.trigger(),'busy')
  assert.equal(runs,1)
  const shutdown=scheduler.stop()
  assert.equal(await scheduler.trigger(),'busy')
  release()
  assert.equal(await pending,'completed')
  await shutdown
  assert.equal(await scheduler.trigger(),'busy')
})
test('DEV scheduler: fail closed without leaking failure details',async()=>{
  const statuses:string[]=[]
  const scheduler=startDevelopmentReconciliationScheduler(async()=>{
    throw Error('simulated PII token payload')
  },{intervalMs:60_000,onStatus:s=>statuses.push(s)})
  try{
    assert.equal(await scheduler.trigger(),'failed')
    assert.deepEqual(statuses,['failed'])
  }finally{await scheduler.stop()}
})
test('DEV scheduler: invalid cadence never creates timer',()=>{
  assert.throws(()=>startDevelopmentReconciliationScheduler(async()=>({status:'completed'}),{intervalMs:100}),/RECONCILIATION_INVALID_INTERVAL/)
})
