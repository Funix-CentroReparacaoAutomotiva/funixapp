import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../chat/coda-sync.ts'
import { createDevelopmentSourceLedgerSchema, DevelopmentSourceLedger } from '../chat/coda-source-storage-dev.ts'
import { createDevelopmentDecisionLedgerSchema, DevelopmentDecisionLedger } from '../chat/coda-decision-ledger-dev.ts'
import { createDevelopmentOutboxSchema, DevelopmentCodaOutbox } from '../chat/coda-outbox-dev.ts'
import { createCodaBackedDevelopmentReconciliationCycle } from '../chat/coda-reconciliation-coda-dev.ts'

const timestamp=1794144000000
const eventId='evo:funix_comercial:synthetic-CODA-01'
const jid='5531999990001@s.whatsapp.net'
const values={
  'c-lsQIF3vIWr':eventId,
  'c-rAEurF2Nmz':jid,
  'c-PHvyLm0gyd':{additionalType:'row',rowId:'i-O01Tgl0bN2'},
  'c-5poWJk5IsH':'+5531999990001',
}
test('DEV Coda integration: two complete paginated scans before idempotent delivery',async()=>{
  const db=openDatabase(':memory:')
  try{
    new AtendimentoRepository(db)
    createCodaEventSchema(db)
    createDevelopmentSourceLedgerSchema(db)
    createDevelopmentDecisionLedgerSchema(db)
    createDevelopmentOutboxSchema(db)
    const source=new DevelopmentSourceLedger(db)
    const decisions=new DevelopmentDecisionLedger(db)
    const outbox=new DevelopmentCodaOutbox(db)
    const recipient=new CodaEventSyncRepository(db)
    source.append({
      eventId,remoteJid:jid,phoneE164:'+5531999990001',
      displayName:'Nome fictício',occurredAt:Math.floor(timestamp/1000),
      instance:'funix_comercial',source:'whatsapp',suppressed:false,
    },timestamp)
    let pageCalls=0
    const fetchImpl=(async()=> {
      pageCalls++
      return new Response(JSON.stringify({
        items:[{id:'i-SYNTHETIC_ROW_1',values}],
      }),{status:200})
    }) as typeof fetch
    const cycle=createCodaBackedDevelopmentReconciliationCycle(
      {token:'synthetic_not_a_real_credential',fetchImpl},
      {
        source,decisions,outbox,
        hmacSecret:Buffer.alloc(32,17),
        now:()=>timestamp,
        transport:async req=>({status:202,body:recipient.sync(JSON.parse(req.body))}),
      },
    )
    const result=await cycle()
    assert.equal(result.status,'completed')
    assert.equal(pageCalls,2)
    if(result.status==='completed'){
      assert.equal(result.created,1)
      assert.equal(result.delivery.status,'delivered')
    }
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),1)
    const again=await cycle()
    assert.equal(again.status,'completed')
    assert.equal(pageCalls,4)
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),1)
  }finally{db.close()}
})
test('DEV Coda integration: inconsistent two-pass Coda read never touches outbox',async()=>{
  const db=openDatabase(':memory:')
  try{
    new AtendimentoRepository(db)
    createDevelopmentSourceLedgerSchema(db)
    createDevelopmentDecisionLedgerSchema(db)
    createDevelopmentOutboxSchema(db)
    const outbox=new DevelopmentCodaOutbox(db)
    let calls=0
    const fetchImpl=(async()=> {
      calls++
      const item={id:'i-SYNTH_ROW_1',values:{
        ...values,'c-rAEurF2Nmz':calls===1?jid:'5531888880000@s.whatsapp.net',
      }}
      return new Response(JSON.stringify({items:[item]}),{status:200})
    }) as typeof fetch
    const cycle=createCodaBackedDevelopmentReconciliationCycle(
      {token:'synthetic_not_a_real_credential',fetchImpl},
      {
        source:new DevelopmentSourceLedger(db),
        decisions:new DevelopmentDecisionLedger(db),
        outbox,hmacSecret:Buffer.alloc(32,17),now:()=>timestamp,
        transport:async()=>{throw Error('unexpected delivery')},
      },
    )
    await assert.rejects(cycle(),/CODA_SCAN_CHANGED/)
    assert.equal(calls,2)
    assert.deepEqual(outbox.stats(),{pending:0,leased:0,delivered:0,quarantined:0})
  }finally{db.close()}
})
