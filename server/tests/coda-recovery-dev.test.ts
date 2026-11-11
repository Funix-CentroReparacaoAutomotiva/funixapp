import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { createDevelopmentOutboxSchema, DevelopmentCodaOutbox } from '../chat/coda-outbox-dev.ts'
import { recoverConfirmedWhatsAppRows, type RecoverableCodaRow } from '../chat/coda-recovery-dev.ts'

const now = 1794150000000
const pn = '5531999990001@s.whatsapp.net'
const event = (eventId = 'evo:funix_comercial:message1', codaRowId = 'i-ROW1') => ({
  version:1, source:'coda',eventId,codaRowId,instance:'funix_comercial',
  remoteJid:pn,phoneE164:'+5531999990001',
  displayName:'Cliente Sintético',occurredAt:1794144000,
})
const row = (overrides: Partial<RecoverableCodaRow> = {}):RecoverableCodaRow => ({
  id:'i-ROW1',fx_UUID:'evo:funix_comercial:message1',
  'api_ID Omnichanel':pn,
  funil_Canal:{rowId:'i-O01Tgl0bN2'},
  funil_contatoE164:'+5531999990001',
  suppressed:false,syncSnapshot:event(),...overrides,
})
function withQueue(callback:(q:DevelopmentCodaOutbox)=>void) {
  const db=openDatabase(':memory:')
  try {
    createDevelopmentOutboxSchema(db)
    callback(new DevelopmentCodaOutbox(db))
  } finally { db.close() }
}

test('recovery: a trusted immutable event is queued once and fully repeatable',()=>{
  withQueue(q=>{
    const first=recoverConfirmedWhatsAppRows(q,[row()],now)
    assert.deepEqual(first,{scanned:1,queued:1,existing:0,skippedManual:0,missingSnapshot:0,identityReview:0,conflicts:0})
    const again=recoverConfirmedWhatsAppRows(q,[row()],now+1000)
    assert.equal(again.existing,1)
    assert.deepEqual(q.stats(),{pending:1,leased:0,delivered:0,quarantined:0})
  })
})

test('recovery: manual ERP rows never generate a queue event by phone or same customer',()=>{
  withQueue(q=>{
    const r=recoverConfirmedWhatsAppRows(q,[row({
      id:'i-MANUAL',fx_UUID:'',syncSnapshot:undefined,
      'api_ID Omnichanel':pn
    })],now)
    assert.equal(r.skippedManual,1)
    assert.equal(q.stats().pending,0)
  })
})

test('recovery: legacy WhatsApp record without source timestamp is reviewable, not invented',()=>{
  withQueue(q=>{
    const r=recoverConfirmedWhatsAppRows(q,[row({syncSnapshot:undefined})],now)
    assert.equal(r.missingSnapshot,1)
    assert.equal(r.queued,0)
  })
})

test('recovery: identity, opt-out, channel, and event mismatches all fail closed',()=>{
  withQueue(q=>{
    const mismatches:RecoverableCodaRow[]=[
      row({suppressed:true}),
      row({suppressed:undefined}),
      row({funil_Canal:{rowId:'i-DIFFERENT'}}),
      row({'api_ID Omnichanel':'5531888880000@s.whatsapp.net'}),
      row({syncSnapshot:{...event(),occurredAt:undefined}}),
      row({syncSnapshot:{...event(),occurredAt:NaN}}),
      row({syncSnapshot:{...event(),remoteJid:'5531888880000@s.whatsapp.net'}}),
      row({syncSnapshot:{...event(),phoneE164:'+5531888880000'}}),
      row({syncSnapshot:{...event(),codaRowId:'i-DIFFERENT'}}),
      row({syncSnapshot:{...event(),eventId:'evo:funix_comercial:changed'}}),
      row({funil_contatoE164:'+5531888880000'}),
      row({fx_UUID:'other:source'}),
    ].map((x,i)=>({...x,id:'i-MISMATCH'+i,syncSnapshot:x.syncSnapshot &&
      typeof x.syncSnapshot==='object' && !Array.isArray(x.syncSnapshot)
        ? {...x.syncSnapshot as object,codaRowId:'i-MISMATCH'+i}
        : x.syncSnapshot}))
    const r=recoverConfirmedWhatsAppRows(q,mismatches,now)
    assert.equal(r.queued,0)
    assert.equal(r.identityReview,12)
    assert.equal(q.stats().pending,0)
  })
})

test('recovery: identical event ID claimed by two confirmed rows cannot silently queue either twice',()=>{
  withQueue(q=>{
    const rows=[row(),row({id:'i-ROW2',syncSnapshot:{...event(),codaRowId:'i-ROW2'}})]
    const r=recoverConfirmedWhatsAppRows(q,rows,now)
    assert.equal(r.queued,1)
    assert.equal(r.identityReview,1)
    assert.equal(q.stats().pending,1)
  })
})
