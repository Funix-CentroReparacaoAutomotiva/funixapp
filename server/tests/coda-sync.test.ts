import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../chat/coda-sync.ts'

function synthetic(row: string, event = 'evo:synthetic:one', jid = '5531999990001@s.whatsapp.net', occurredAt = 1794144000) {
  return { version: 1, source: 'coda', eventId: event, codaRowId: row,
    instance: 'funix_comercial', remoteJid: jid, phoneE164: '+5531999990001',
    displayName: 'Contato Fictício', occurredAt }
}

function fixture() {
  const db = openDatabase(':memory:')
  const atendimentos = new AtendimentoRepository(db)
  createCodaEventSchema(db)
  return { db, atendimentos, sync: new CodaEventSyncRepository(db) }
}

const isCode = (code: string) => (error: unknown) =>
  error !== null && typeof error === 'object' && 'code' in error && error.code === code

test('Coda sync: one canonical Coda row, replay receipt, same row with another message never duplicates', () => {
  const f = fixture()
  try {
    const first = f.sync.sync(synthetic('i-SYNTH_A'))
    assert.equal(first.state, 'created')
    assert.match(first.atendimentoId, /^[0-9a-f-]{36}$/)
    assert.deepEqual(f.sync.sync(synthetic('i-SYNTH_A')), { ...first, state: 'existing' })
    assert.deepEqual(f.sync.sync(synthetic('i-SYNTH_A','evo:synthetic:two',undefined,1794144010)), { ...first, state: 'existing' })
    assert.equal(f.sync.resolveActive('5531999990001@s.whatsapp.net'), first.atendimentoId)
    assert.equal(f.atendimentos.get(first.atendimentoId).phone, '+5531999990001')
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM atendimentos').get()!.n),1)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM coda_sync_receipts').get()!.n),2)
    assert.equal(f.db.prepare('SELECT max(version) AS v FROM schema_migrations').get()!.v,14)
  } finally { f.db.close() }
})

test('Coda sync: changing same event ID fails closed, no partial records or associations', () => {
  const f = fixture()
  try {
    const first = synthetic('i-SYNTH_A')
    f.sync.sync(first)
    assert.throws(() => f.sync.sync({ ...first, codaRowId: 'i-SYNTH_B' }), isCode('CODA_SYNC_CONFLICT'))
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM coda_sync_atendimentos').get()!.n),1)
    assert.throws(() => f.sync.sync({ ...first, eventId: randomUUID(), remoteJid: 'other@g.us' }), isCode('CODA_SYNC_INVALID_EVENT'))
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM coda_sync_receipts').get()!.n),1)
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0)
  } finally { f.db.close() }
})

test('Coda sync: late event cannot switch active Atendimento backwards, historical pairs preserved', () => {
  const f=fixture()
  try {
    const older=f.sync.sync(synthetic('i-SYNTH_A','evo:synthetic:old',undefined,1794144000))
    const newer=f.sync.sync(synthetic('i-SYNTH_B','evo:synthetic:new',undefined,1794144200))
    const stale=f.sync.sync(synthetic('i-SYNTH_A','evo:synthetic:late',undefined,1794144050))
    assert.equal(stale.atendimentoId,older.atendimentoId)
    assert.equal(f.sync.resolveActive('5531999990001@s.whatsapp.net'),newer.atendimentoId)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM coda_sync_conversation_links').get()!.n),2)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM atendimentos').get()!.n),2)
  } finally { f.db.close() }
})

test('Coda sync: strict PN/LID isolation and LID-only case leaves phone empty (never fabricated)', () => {
  const f=fixture()
  try {
    const lid='synthetic_only@lid'
    const event={ ...synthetic('i-SYNTH_LID','evo:synthetic:lid',lid), phoneE164: null }
    const created=f.sync.sync(event)
    assert.equal(f.atendimentos.get(created.atendimentoId).phone,'')
    assert.equal(f.atendimentos.get(created.atendimentoId).phoneNormalized,null)
    assert.equal(f.sync.resolveActive(lid),created.atendimentoId)
    assert.equal(f.sync.resolveActive('5531999990001@s.whatsapp.net'),null)
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0)
  } finally { f.db.close() }
})

test('Coda sync: failure within the transaction rolls back Atendimento, row mapping and receipt together', () => {
  const f=fixture()
  try {
    f.db.exec('CREATE TRIGGER synthetic_fail_receipt BEFORE INSERT ON coda_sync_receipts BEGIN SELECT RAISE(ABORT, "SYNTHETIC_FAIL"); END;')
    assert.throws(() => f.sync.sync(synthetic('i-SYNTH_A')))
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM atendimentos').get()!.n),0)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM coda_sync_atendimentos').get()!.n),0)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM coda_sync_conversation_links').get()!.n),0)
    f.db.exec('DROP TRIGGER synthetic_fail_receipt')
    assert.equal(f.sync.sync(synthetic('i-SYNTH_A')).state,'created')
  } finally { f.db.close() }
})

test('Coda sync: V14 open/reopen remains valid with additive tables and local Atendimento', () => {
  const f=fixture()
  try {
    createCodaEventSchema(f.db)
    const fresh=new CodaEventSyncRepository(f.db)
    const event=synthetic('i-SYNTH_A')
    const one=f.sync.sync(event)
    assert.deepEqual(fresh.sync(event),{ ...one,state:'existing' })
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0)
  } finally { f.db.close() }
})
