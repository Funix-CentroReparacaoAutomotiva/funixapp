import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../chat/coda-sync.ts'
import { createDevelopmentOutboxSchema, DevelopmentCodaOutbox } from '../chat/coda-outbox-dev.ts'
import { createDevelopmentSourceLedgerSchema, DevelopmentSourceLedger } from '../chat/coda-source-storage-dev.ts'
import { reconcilePersistedSourceLedger } from '../chat/coda-source-ledger-dev.ts'
import { deliverDevelopmentCodaEvent } from '../chat/coda-outbox-worker-dev.ts'

const now=1794144000000
const eventId='evo:funix_comercial:SYNTHETIC_VALID_01'
const jid='5531999990001@s.whatsapp.net'
const source={
  eventId,remoteJid:jid,phoneE164:'+5531999990001',
  displayName:'Teste fictício',occurredAt:Math.floor(now/1000),
  instance:'funix_comercial' as const,source:'whatsapp' as const,suppressed:false as const,
}
const row={
  id:'i-SYNTHETIC_CANONICAL',fx_UUID:eventId,'api_ID Omnichanel':jid,
  funil_Canal:{rowId:'i-O01Tgl0bN2'},
  funil_contatoE164:'+5531999990001',
}
const setup=(db:ReturnType<typeof openDatabase>)=>{
  new AtendimentoRepository(db)
  createCodaEventSchema(db)
  createDevelopmentOutboxSchema(db)
  createDevelopmentSourceLedgerSchema(db)
}
test('DEV full chain: source survives crash, Coda confirmation, temporary 503 and idempotent receipt',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'funix-coda-chain-synth-'))
  const filename=join(folder,'chain.sqlite')
  try{
    const db=openDatabase(filename)
    try{
      setup(db)
      const ledger=new DevelopmentSourceLedger(db)
      assert.equal(ledger.append(source,now),'created')
      // Simulate process crash before Coda confirms and before outbox exists.
      assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM dev_coda_sync_outbox').get()!.n),0)
    }finally{db.close()}

    const reopened=openDatabase(filename)
    try{
      setup(reopened)
      const q=new DevelopmentCodaOutbox(reopened)
      const ledger=new DevelopmentSourceLedger(reopened)
      assert.equal(reconcilePersistedSourceLedger(q,ledger,[row],now+1000).queued,1)
      assert.equal(reconcilePersistedSourceLedger(q,ledger,[row],now+1100).existing,1)
      let clock=now+2000
      let sent=0
      const secret=Buffer.alloc(32,17)
      const recipient=new CodaEventSyncRepository(reopened)
      const transport=async(request:{body:string;timestamp:string;signature:string})=>{
        assert.match(request.signature,/^sha256=[a-f0-9]{64}$/)
        sent++
        if(sent===1)return {status:503}
        const result=recipient.sync(JSON.parse(request.body))
        return {status:202,body:result}
      }
      const retry=await deliverDevelopmentCodaEvent(q,transport,secret,()=>clock)
      assert.equal(retry.status,'retry')
      assert.equal(Number(reopened.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),0)
      clock+=60_001
      const success=await deliverDevelopmentCodaEvent(q,transport,secret,()=>clock)
      assert.equal(success.status,'delivered')
      assert.equal(Number(reopened.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),1)
      assert.equal(Number(reopened.prepare('SELECT COUNT(*) AS n FROM coda_sync_receipts').get()!.n),1)
      assert.equal(recipient.resolveActive(jid)!==null,true)
      assert.deepEqual(q.stats(),{pending:0,leased:0,delivered:1,quarantined:0})
      assert.equal((await deliverDevelopmentCodaEvent(q,transport,secret,()=>clock)).status,'idle')
      assert.equal(sent,2)
    }finally{reopened.close()}
  }finally{rmSync(folder,{recursive:true,force:true})}
})
test('DEV full chain: manual Coda row never enters the synchronization outbox',()=>{
  const db=openDatabase(':memory:')
  try{
    setup(db)
    const q=new DevelopmentCodaOutbox(db)
    const ledger=new DevelopmentSourceLedger(db)
    const manual={...row,id:'i-MANUAL_ONLY',fx_UUID:''}
    const result=reconcilePersistedSourceLedger(q,ledger,[manual],now)
    assert.equal(result.skippedManual,1)
    assert.equal(result.queued,0)
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),0)
  }finally{db.close()}
})
