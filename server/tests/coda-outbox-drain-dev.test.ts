import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { createDevelopmentOutboxSchema,DevelopmentCodaOutbox } from '../chat/coda-outbox-dev.ts'
import { createDevelopmentOutboxDrain } from '../chat/coda-outbox-drain-dev.ts'

const t=1794144000000
const event=(suffix:string)=>({
  version:1 as const,source:'coda' as const,
  eventId:'evo:funix_comercial:SYNTH_'+suffix,
  codaRowId:'i-SYNTH_'+suffix,
  instance:'funix_comercial' as const,
  remoteJid:'5531999990001@s.whatsapp.net',
  phoneE164:'+5531999990001',
  displayName:'Contato sintético',
  occurredAt:1794144000,
})
const receipt={state:'created',atendimentoId:'00000000-0000-4000-8000-000000000001'}
test('DEV independent delivery: queued events are delivered without a Coda read',async()=>{
  const db=openDatabase(':memory:')
  try{
    createDevelopmentOutboxSchema(db)
    const queue=new DevelopmentCodaOutbox(db)
    queue.enqueue(event('A'),'whatsapp','i-SYNTH_A',t)
    queue.enqueue(event('B'),'whatsapp','i-SYNTH_B',t)
    queue.enqueue(event('C'),'whatsapp','i-SYNTH_C',t)
    let calls=0
    const drain=createDevelopmentOutboxDrain(queue,async()=>{
      calls++
      return {status:202,body:receipt}
    },Buffer.alloc(32,14),()=>t,2)
    assert.deepEqual(await drain(),{status:'completed',attempted:2,delivered:2,failures:0})
    assert.equal(calls,2)
    assert.deepEqual(queue.stats(),{pending:1,leased:0,delivered:2,quarantined:0})
    assert.deepEqual(await drain(),{status:'completed',attempted:1,delivered:1,failures:0})
    assert.deepEqual(queue.stats(),{pending:0,leased:0,delivered:3,quarantined:0})
  }finally{db.close()}
})
test('DEV independent delivery: 503 is retried later without new Coda scan',async()=>{
  const db=openDatabase(':memory:')
  try{
    createDevelopmentOutboxSchema(db)
    const queue=new DevelopmentCodaOutbox(db)
    queue.enqueue(event('A'),'whatsapp','i-SYNTH_A',t)
    let now=t,requests=0
    const drain=createDevelopmentOutboxDrain(queue,async()=>{
      requests++
      return requests===1?{status:503}:{status:202,body:receipt}
    },Buffer.alloc(32,14),()=>now)
    assert.deepEqual(await drain(),{status:'completed',attempted:1,delivered:0,failures:1})
    assert.equal((await drain()).attempted,0)
    now+=30_001
    assert.deepEqual(await drain(),{status:'completed',attempted:1,delivered:1,failures:0})
    assert.equal(requests,2)
  }finally{db.close()}
})
