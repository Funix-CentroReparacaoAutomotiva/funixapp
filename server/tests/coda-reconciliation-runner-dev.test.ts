import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../chat/coda-sync.ts'
import { createDevelopmentOutboxSchema, DevelopmentCodaOutbox } from '../chat/coda-outbox-dev.ts'
import { createDevelopmentSourceLedgerSchema, DevelopmentSourceLedger } from '../chat/coda-source-storage-dev.ts'
import { createDevelopmentDecisionLedgerSchema, DevelopmentDecisionLedger } from '../chat/coda-decision-ledger-dev.ts'
import { createDevelopmentReconciliationCycle, type ConfirmedCodaPageProvider } from '../chat/coda-reconciliation-runner-dev.ts'
import type { RecoverableCodaRow } from '../chat/coda-recovery-dev.ts'

const now=1794144000000
const jid='5531999990001@s.whatsapp.net'
const firstId='evo:funix_comercial:SYNTH_SOURCE_01'
const secondId='evo:funix_comercial:SYNTH_SOURCE_02'
const source=(eventId:string)=>({
  eventId,remoteJid:jid,phoneE164:'+5531999990001',
  displayName:'Pessoa fictícia',occurredAt:1794144000,instance:'funix_comercial',
  source:'whatsapp' as const,suppressed:false as const,
})
const row: RecoverableCodaRow={
  id:'i-SYNTH_ROW_01',fx_UUID:firstId,
  'api_ID Omnichanel':jid,funil_Canal:{rowId:'i-O01Tgl0bN2'},
  funil_contatoE164:'+5531999990001',
}
function setup(pages: ConfirmedCodaPageProvider){
  const db=openDatabase(':memory:')
  const at=new AtendimentoRepository(db)
  createCodaEventSchema(db)
  createDevelopmentOutboxSchema(db)
  createDevelopmentSourceLedgerSchema(db)
  createDevelopmentDecisionLedgerSchema(db)
  const sourceLedger=new DevelopmentSourceLedger(db)
  const decisions=new DevelopmentDecisionLedger(db)
  const outbox=new DevelopmentCodaOutbox(db)
  const recipient=new CodaEventSyncRepository(db)
  sourceLedger.append(source(firstId),now)
  let calls=0
  const transport=async (request:{body:string;timestamp:string;signature:string})=>{
    calls++
    assert.match(request.signature,/^sha256=[a-f0-9]{64}$/)
    return {status:202,body:recipient.sync(JSON.parse(request.body))}
  }
  const cycle=createDevelopmentReconciliationCycle({
    pages,source:sourceLedger,decisions,outbox,transport,
    hmacSecret:Buffer.alloc(32,14),now:()=>now,
  })
  return {db,at,sourceLedger,decisions,outbox,cycle,getCalls:()=>calls}
}
test('DEV cycle: exhausts all pages before enqueue and delivers only verified WhatsApp event',async()=>{
  const f=setup(async cursor=>cursor===null?
    {rows:[{id:'i-MANUAL',fx_UUID:'','api_ID Omnichanel':jid,funil_Canal:'i-O01Tgl0bN2'}],nextCursor:'page-2',complete:false}:
    {rows:[row],nextCursor:null,complete:true})
  try{
    const result=await f.cycle()
    assert.equal(result.status,'completed')
    if(result.status!=='completed')throw Error('unexpected')
    assert.equal(result.scanned,2)
    assert.equal(result.created,1)
    assert.equal(result.delivery.status,'delivered')
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),1)
    assert.equal(f.getCalls(),1)
    const again=await f.cycle()
    assert.equal(again.status,'completed')
    if(again.status==='completed')assert.equal(again.created,0)
    assert.equal(f.getCalls(),1)
  }finally{f.db.close()}
})
test('DEV cycle: missing terminal page fails before any queue write or network delivery',async()=>{
  const f=setup(async()=>({rows:[row],nextCursor:null,complete:false}))
  try{
    await assert.rejects(f.cycle(),/RECONCILIATION_INCOMPLETE/)
    assert.equal(f.outbox.stats().pending,0)
    assert.equal(f.getCalls(),0)
  }finally{f.db.close()}
})
test('DEV cycle: repeating cursor is rejected and never queues',async()=>{
  const f=setup(async cursor=>({rows:[row],nextCursor:cursor??'repeat',complete:false}))
  try{
    await assert.rejects(f.cycle(),/RECONCILIATION_INVALID_CURSOR/)
    assert.equal(f.outbox.stats().pending,0)
    assert.equal(f.getCalls(),0)
  }finally{f.db.close()}
})
test('DEV cycle: concurrent trigger cannot race the same reconciliation',async()=>{
  let release:()=>void=()=>{}
  const gate=new Promise<void>(resolve=>{release=resolve})
  const f=setup(async()=>{await gate;return {rows:[row],nextCursor:null,complete:true}})
  try{
    const pending=f.cycle()
    assert.deepEqual(await f.cycle(),{status:'busy'})
    release()
    assert.equal((await pending).status,'completed')
    assert.equal(f.getCalls(),1)
  }finally{f.db.close()}
})
test('DEV cycle: explicitly confirmed reuse of existing Coda row resolves only with exact decision',async()=>{
  const f=setup(async()=>({rows:[row],nextCursor:null,complete:true}))
  try{
    f.sourceLedger.append(source(secondId),now)
    f.decisions.append({eventId:secondId,codaRowId:row.id,remoteJid:jid},now)
    const first=await f.cycle()
    assert.equal(first.status,'completed')
    if(first.status==='completed')assert.equal(first.created,2)
    const next=await f.cycle()
    assert.equal(next.status,'completed')
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),1)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM coda_sync_receipts').get()!.n),2)
    assert.equal(f.getCalls(),2)
  }finally{f.db.close()}
})
