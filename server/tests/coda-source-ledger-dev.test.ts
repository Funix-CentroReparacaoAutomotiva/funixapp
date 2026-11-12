import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { createDevelopmentOutboxSchema, DevelopmentCodaOutbox } from '../chat/coda-outbox-dev.ts'
import { reconcileSourceLedger, type ImmutableWhatsAppSource } from '../chat/coda-source-ledger-dev.ts'
import type { RecoverableCodaRow } from '../chat/coda-recovery-dev.ts'

const t = 1794150000000
const eventId = 'evo:funix_comercial:message1'
const pn = '5531999990001@s.whatsapp.net'
const source = (changes:Partial<ImmutableWhatsAppSource>={}):ImmutableWhatsAppSource=>({
  eventId,remoteJid:pn,phoneE164:'+5531999990001',
  displayName:'Contato Sintético',occurredAt:1794144000,
  instance:'funix_comercial',source:'whatsapp',suppressed:false,...changes,
})
const coda = (changes:Partial<RecoverableCodaRow>={}):RecoverableCodaRow=>({
  id:'i-TEST1',fx_UUID:eventId,
  'api_ID Omnichanel':pn,
  funil_Canal:{rowId:'i-O01Tgl0bN2'},
  funil_contatoE164:'+5531999990001',...changes,
})
function run(fn:(q:DevelopmentCodaOutbox)=>void) {
  const db=openDatabase(':memory:')
  try { createDevelopmentOutboxSchema(db); fn(new DevelopmentCodaOutbox(db)) }
  finally { db.close() }
}
test('source ledger: original timestamp recovered by exact Coda event, repeatable',()=>{
  run(q=>{
    const a=reconcileSourceLedger(q,[coda()],[source()],t)
    assert.equal(a.queued,1)
    assert.equal(a.sourceConflicts,0)
    assert.equal(a.unsupportedReuses,0)
    const b=reconcileSourceLedger(q,[coda()],[source()],t+1000)
    assert.equal(b.existing,1)
    assert.deepEqual(q.stats(),{pending:1,leased:0,delivered:0,quarantined:0})
  })
})
test('source ledger: cannot recover manual case or absent original message',()=>{
  run(q=>{
    const a=reconcileSourceLedger(q,[coda({id:'i-MANUAL',fx_UUID:''})],[source()],t)
    assert.equal(a.skippedManual,1)
    assert.equal(a.queued,0)
    const b=reconcileSourceLedger(q,[coda()],[],t)
    assert.equal(b.unsupportedReuses,1)
    // Without the inbound ledger there is no verified suppression decision.
    assert.equal(b.identityReview,1)
    assert.equal(b.missingSnapshot,0)
    assert.equal(q.stats().pending,0)
  })
})
test('source ledger: duplicate source events, identity drift and timestamps fail closed',()=>{
  run(q=>{
    const duplicated=reconcileSourceLedger(q,[coda()],[source(),source()],t)
    assert.equal(duplicated.sourceConflicts,1)
    assert.equal(duplicated.queued,0)
    for(const altered of [
      source({remoteJid:'5531888880000@s.whatsapp.net'}),
      source({occurredAt:0,phoneE164:'+5531888880000'}),
      source({occurredAt:Number.NaN}),
      source({instance:'other'}),
      source({suppressed:true as false}),
    ]) {
      const r=reconcileSourceLedger(q,[coda()],[altered],t)
      assert.equal(r.queued,0)
    }
    assert.equal(q.stats().pending,0)
  })
})
test('source ledger: a later message cannot attach by telephone to older canonical row',()=>{
  run(q=>{
    const later=source({eventId:'evo:funix_comercial:another-message'})
    const r=reconcileSourceLedger(q,[coda()],[later],t)
    assert.equal(r.unsupportedReuses,1)
    assert.equal(r.queued,0)
  })
})
