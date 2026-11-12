import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { createDevelopmentOutboxSchema, DevelopmentCodaOutbox } from '../chat/coda-outbox-dev.ts'
import { createDevelopmentSourceLedgerSchema, DevelopmentSourceLedger } from '../chat/coda-source-storage-dev.ts'
import { createDevelopmentDecisionLedgerSchema, DevelopmentDecisionLedger, reconcileConfirmedDecisions } from '../chat/coda-decision-ledger-dev.ts'

const t=1794144000000
const jid='5531999990001@s.whatsapp.net'
const ev='evo:funix_comercial:SYNTH_MESSAGE_2'
const orig='evo:funix_comercial:SYNTH_MESSAGE_1'
const source=(eventId=ev)=>({
  eventId,remoteJid:jid,phoneE164:'+5531999990001',
  displayName:'Nome Fictício',occurredAt:1794144000,
  instance:'funix_comercial' as const,source:'whatsapp' as const,suppressed:false as const
})
const originalRow={
  id:'i-ROW_1',fx_UUID:orig,
  'api_ID Omnichanel':jid,
  funil_Canal:{rowId:'i-O01Tgl0bN2'},
  funil_contatoE164:'+5531999990001',
}
function fixture(){
  const db=openDatabase(':memory:')
  createDevelopmentSourceLedgerSchema(db)
  createDevelopmentDecisionLedgerSchema(db)
  createDevelopmentOutboxSchema(db)
  return {db,source:new DevelopmentSourceLedger(db),
    decisions:new DevelopmentDecisionLedger(db),
    outbox:new DevelopmentCodaOutbox(db)}
}
test('DEV decision: reuse of an existing WhatsApp Coda row requires exact durable message decision',()=>{
  const f=fixture()
  try{
    assert.equal(f.source.append(source(),t),'created')
    assert.equal(f.decisions.append({eventId:ev,codaRowId:'i-ROW_1',remoteJid:jid},t),'created')
    assert.equal(f.decisions.append({eventId:ev,codaRowId:'i-ROW_1',remoteJid:jid},t),'existing')
    assert.throws(()=>f.decisions.append({eventId:ev,codaRowId:'i-ROW_2',remoteJid:jid},t),/DECISION_CONFLICT/)
    const result=reconcileConfirmedDecisions(f.outbox,f.source,f.decisions,[originalRow],t+1)
    assert.deepEqual(result,{queued:1,existing:0,review:0,missingSource:0})
    const again=reconcileConfirmedDecisions(f.outbox,f.source,f.decisions,[originalRow],t+2)
    assert.equal(again.existing,1)
    assert.deepEqual(f.outbox.stats(),{pending:1,leased:0,delivered:0,quarantined:0})
  }finally{f.db.close()}
})
test('DEV decision: no source, manual Coda row or mismatched identity never creates an outbox record',()=>{
  const f=fixture()
  try{
    f.decisions.append({eventId:ev,codaRowId:'i-ROW_1',remoteJid:jid},t)
    let r=reconcileConfirmedDecisions(f.outbox,f.source,f.decisions,[originalRow],t)
    assert.equal(r.missingSource,1)
    f.source.append(source(),t)
    for(const row of [
      {...originalRow,fx_UUID:''},
      {...originalRow,'api_ID Omnichanel':'5531888880000@s.whatsapp.net'},
      {...originalRow,funil_Canal:{rowId:'i-NON_WHATSAPP'}},
      {...originalRow,funil_contatoE164:'+5531888880000'},
    ]){
      r=reconcileConfirmedDecisions(f.outbox,f.source,f.decisions,[row],t)
      assert.equal(r.queued,0)
      assert.equal(r.review,1)
    }
    assert.equal(f.outbox.stats().pending,0)
  }finally{f.db.close()}
})
test('DEV decision: duplicate canonical rows fail closed rather than choosing first',()=>{
  const f=fixture()
  try{
    f.source.append(source(),t)
    f.decisions.append({eventId:ev,codaRowId:'i-ROW_1',remoteJid:jid},t)
    const r=reconcileConfirmedDecisions(f.outbox,f.source,f.decisions,[originalRow,originalRow],t)
    assert.equal(r.queued,0)
    assert.equal(r.review,1)
  }finally{f.db.close()}
})

test('DEV decision: modified persisted mapping cannot evade digest verification',()=>{
  const f=fixture()
  try{
    f.source.append(source(),t)
    f.decisions.append({eventId:ev,codaRowId:'i-ROW_1',remoteJid:jid},t)
    f.db.prepare('UPDATE dev_whatsapp_confirmed_decisions SET coda_row_id=? WHERE event_id=?')
      .run('i-MANUAL',ev)
    assert.throws(()=>reconcileConfirmedDecisions(f.outbox,f.source,f.decisions,[originalRow],t),/DECISION_LEDGER_CORRUPT/)
    assert.equal(f.outbox.stats().pending,0)
  }finally{f.db.close()}
})

test('DEV decision: two Coda rows sharing one origin marker cannot be selected',()=>{
  const f=fixture()
  try{
    f.source.append(source(),t)
    f.decisions.append({eventId:ev,codaRowId:'i-ROW_1',remoteJid:jid},t)
    const duplicate={...originalRow,id:'i-ROW_2'}
    assert.throws(
      ()=>reconcileConfirmedDecisions(f.outbox,f.source,f.decisions,[originalRow,duplicate],t),
      /DECISION_ORIGIN_DUPLICATE/,
    )
    assert.equal(f.outbox.stats().pending,0)
  }finally{f.db.close()}
})
test('DEV decision: original message cannot be remapped to a different canonical row',()=>{
  const f=fixture()
  try{
    f.source.append(source(orig),t)
    f.decisions.append({eventId:orig,codaRowId:'i-ROW_2',remoteJid:jid},t)
    assert.throws(
      ()=>reconcileConfirmedDecisions(f.outbox,f.source,f.decisions,[originalRow],t),
      /DECISION_ORIGIN_CONFLICT/,
    )
    assert.equal(f.outbox.stats().pending,0)
  }finally{f.db.close()}
})
