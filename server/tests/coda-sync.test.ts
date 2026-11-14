import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../chat/coda-sync.ts'
import { createEvolutionChatBridge } from '../chat/evolution-bridge.ts'

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
    assert.equal(f.db.prepare('SELECT max(version) AS v FROM schema_migrations').get()!.v,17)
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


test('read-only conversation list reports linked local Atendimento only when event mapping is available', async () => {
  const f = fixture()
  try {
    const pn='5531999990001@s.whatsapp.net'
    const rows = [{ remoteJid: pn, displayName: 'Fictício', phoneNumber: '5531999990001',
      updatedAt: null, unreadCount: 0 }]
    const provider = {
      async findChatsPage() { return { items: rows, sourceCount: rows.length } },
      async findMessages() { return { items: [], currentPage: 1, reportedTotal: 0, reportedPages: 0,
        nextPage: null, consistency: 'offset-not-snapshot' as const } },
    }
    const noSync = createEvolutionChatBridge(provider)
    const withSync = createEvolutionChatBridge(provider, Date.now, undefined, f.sync)
    const before = await withSync.list(0)
    assert.equal(before.items[0]?.atendimentoId, null)
    const linked = f.sync.sync(synthetic('i-SYNTH_A'))
    const after = await withSync.list(0)
    assert.equal(after.items[0]?.atendimentoId, linked.atendimentoId)
    const old = await noSync.list(0)
    assert.equal(Object.hasOwn(old.items[0]!, 'atendimentoId'), false)
    assert.equal(Object.hasOwn(after.items[0]!, 'remoteJid'), false)
  } finally { f.db.close() }
})


test('same-time conflicting canonical Coda rows cannot silently switch active conversation', () => {
  const f = fixture()
  try {
    f.sync.sync(synthetic('i-SYNTH_A', 'event:alpha'))
    assert.throws(() => f.sync.sync(synthetic('i-SYNTH_B', 'event:beta')), isCode('CODA_SYNC_CONFLICT'))
    assert.equal(f.sync.resolveActive('5531999990001@s.whatsapp.net'), null)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM atendimentos').get()!.n), 1)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM coda_sync_receipts').get()!.n), 1)
  } finally { f.db.close() }
})


test('canonical Evolution history is never exposed under another Atendimento or an unlinked conversation', async () => {
  const f = fixture()
  try {
    const jid = '5531999990001@s.whatsapp.net'
    const seen: string[] = []
    const provider = {
      async findChatsPage() { return { items: [{remoteJid: jid, displayName: null, phoneNumber: null, updatedAt: null, unreadCount: 0}], sourceCount: 1 } },
      async findMessages(requestedJid: string) { seen.push(requestedJid); return { items: [], currentPage: 1, reportedTotal: 0, reportedPages: 0, nextPage: null, consistency: 'offset-not-snapshot' as const } },
    }
    const bridge = createEvolutionChatBridge(provider, Date.now, undefined, f.sync)
    const conversationId = (await bridge.list(0)).items[0]!.conversationId
    const a = f.sync.sync(synthetic('i-SYNTH_A'))
    assert.equal(await bridge.messagesForAtendimento(randomUUID(), conversationId, 1), null)
    assert.equal(await bridge.messagesForAtendimento(a.atendimentoId, randomUUID(), 1), null)
    assert.equal(seen.length, 0)
    assert.equal((await bridge.messagesForAtendimento(a.atendimentoId, conversationId, 1))?.source, 'evolution')
    assert.deepEqual(seen, [jid])
    const b = f.sync.sync(synthetic('i-SYNTH_B', 'evo:synthetic:changed', jid, 1794144010))
    assert.equal(await bridge.messagesForAtendimento(a.atendimentoId, conversationId, 1), null)
    assert.equal((await bridge.messagesForAtendimento(b.atendimentoId, conversationId, 1))?.source, 'evolution')
    assert.deepEqual(seen, [jid, jid])
  } finally { f.db.close() }
})

test('Coda sync rejects mismatched verified PN identity before any insert', () => {
  const f = fixture()
  try {
    assert.throws(() => f.sync.sync({ ...synthetic('i-SYNTH_MISMATCH'), phoneE164: '+5531888880000' }), isCode('CODA_SYNC_INVALID_EVENT'))
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 0)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM coda_sync_receipts').get()!.n), 0)
    assert.equal(f.sync.sync(synthetic('i-SYNTH_MATCH')).state, 'created')
  } finally { f.db.close() }
})

test('direct Funil canonical lookup fails closed for zero or multiple active conversations', () => {
  const f = fixture()
  try {
    const canonical = f.sync.sync(synthetic('i-SYNTH_A'))
    assert.equal(f.sync.resolveUniqueActiveJid(canonical.atendimentoId), '5531999990001@s.whatsapp.net')
    assert.equal(f.sync.resolveUniqueActiveJid(randomUUID()), null)
    // Distinct verified PN number, same canonical Coda row: no arbitrary pick.
    const second = { ...synthetic('i-SYNTH_A','evo:synthetic:other-pn','5531888880000@s.whatsapp.net',1794144010), phoneE164:'+5531888880000' }
    assert.equal(f.sync.sync(second).atendimentoId, canonical.atendimentoId)
    assert.equal(f.sync.resolveUniqueActiveJid(canonical.atendimentoId), null)
  } finally { f.db.close() }
})

test('canonical Evolution response is withheld if active Coda Atendimento changes during fetch', async () => {
  const f = fixture()
  try {
    const first = f.sync.sync(synthetic('i-SYNTH_A','event:race-a'))
    const jid = '5531999990001@s.whatsapp.net'
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let started!: () => void
    const called = new Promise<void>(resolve => { started = resolve })
    const bridge = createEvolutionChatBridge({
      async findChatsPage() { return {items:[{remoteJid:jid,displayName:null,phoneNumber:null,updatedAt:null,unreadCount:0}],sourceCount:1} },
      async findMessages() {
        started()
        await pending
        return {items:[],currentPage:1,reportedTotal:0,reportedPages:0,nextPage:null,consistency:'offset-not-snapshot' as const}
      },
    },Date.now,undefined,f.sync)
    const conversationId = (await bridge.list(0)).items[0]!.conversationId
    const read = bridge.messagesForAtendimento(first.atendimentoId,conversationId,1)
    await called
    f.sync.sync(synthetic('i-SYNTH_B','event:race-b',jid,1794144050))
    release()
    assert.equal(await read,null)
  } finally { f.db.close() }
})
