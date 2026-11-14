import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase, backupDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { migrate } from '../migrations.ts'
import { ChatRepository } from '../chat/repository.ts'
import { parseEvent, MAX_CHAT_EVENT_BYTES } from '../chat/events.ts'
import { ServiceError } from '../errors.ts'
import type { ChatUpsert } from '../../shared/chat.ts'

const activation = '2026-11-05T12:00:00.000Z'
const messageTime = '2026-11-05T13:00:00.000Z'
const later = '2026-11-05T14:00:00.000Z'
function event(id = 'one', jid = 'synthetic@lid'): ChatUpsert {
  return { schemaVersion: 1, instance: 'synthetic-instance', eventId: `event-${id}`, occurredAt: messageTime,
    type: 'message.upsert', message: { remoteJid: jid, messageId: `message-${id}`, fromMe: false,
      origin: 'unknown', kind: 'text', text: `Conteúdo sintético ${id}`, media: null } }
}
const raw = (value: unknown) => JSON.stringify(value)
const status = (state: string, id = 'one') => ({ schemaVersion: 1, instance: 'synthetic-instance', eventId: `status-${id}-${state}`,
  occurredAt: messageTime, type: 'message.status', message: { remoteJid: 'synthetic@lid', messageId: `message-${id}`, status: state } })
function setup(db = openDatabase(':memory:')) {
  let now = messageTime
  const repo = new ChatRepository(db, () => now)
  repo.registerInstance('synthetic-instance', activation)
  const atendimentos = new AtendimentoRepository(db)
  // Deliberately ambiguous same phone, never used as a binding key.
  const a = atendimentos.create({ phone: '000000000', name: 'Atendimento A sintético' })
  const b = atendimentos.create({ phone: '000000000', name: 'Atendimento B sintético' })
  return { db, repo, a, b, setNow: (value: string) => { now = value } }
}
function decision(conversationId: string, atendimentoId: string, revision = 0, ids = ['message-one']) {
  return { conversationId, atendimentoId, revision, requestId: `request-${revision}`, actor: 'synthetic-operator',
    reason: 'Escolha humana sintética explícita', pendingMessageIds: ids }
}
function code(expected: number) { return (error: unknown) => error instanceof ServiceError && error.status === expected }
function count(db: DatabaseSync, table: string) { return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n) }

test('Chat is disabled without explicit local instance; replay returns same durable receipt and never creates Atendimento', () => {
  const db = openDatabase(':memory:')
  try {
    const repo = new ChatRepository(db, () => messageTime)
    assert.throws(() => repo.ingest(raw(event())), code(403))
    assert.equal(count(db, 'chat_events'), 0)
    repo.registerInstance('synthetic-instance', activation)
    const receipt = repo.ingest(raw(event()))
    assert.equal(receipt.disposition, 'pending')
    assert.equal(receipt.state, 'persisted')
    // Object key order is irrelevant to replay identity.
    assert.deepEqual(repo.ingest(raw(Object.fromEntries(Object.entries(event()).reverse()))), receipt)
    assert.equal(count(db, 'chat_events'), 1)
    assert.equal(count(db, 'chat_messages'), 1)
    assert.equal(count(db, 'atendimentos'), 0)
    assert.equal(count(db, 'chat_links'), 0)
    assert.throws(() => repo.ingest(raw({ ...event(), message: { ...event().message, text: 'Outro conteúdo sintético' } })), code(409))
    assert.equal(count(db, 'chat_events'), 1)
    assert.throws(() => repo.registerInstance('synthetic-instance', later), code(409))
  } finally { db.close() }
})

test('discovery envelope accepts UTC seconds/correlation and canonicalizes timestamp without trusting command origin', () => {
  const db = openDatabase(':memory:')
  try {
    const repo = new ChatRepository(db, () => messageTime)
    repo.registerInstance('synthetic-instance', '2026-11-05T12:00:00Z')
    const e = { ...event(), occurredAt: '2026-11-05T13:00:00Z', correlation: { commandId: null, erpEventRef: null } }
    const receipt = repo.ingest(raw(e))
    assert.deepEqual(repo.ingest(raw({ ...e, occurredAt: messageTime })), receipt)
    assert.equal(db.prepare('SELECT origin FROM chat_messages').get()!.origin, 'unknown')
    assert.equal(db.prepare('SELECT occurred_at FROM chat_messages').get()!.occurred_at, messageTime)
    assert.throws(() => parseEvent(raw({ ...e, correlation: { commandId: null, erpEventRef: null, secret: 'synthetic' } })), code(422))
  } finally { db.close() }
})

test('missing identity, group, broadcast and invalid JID are quarantined; LID remains pending without inferred phone/link', () => {
  const f = setup()
  try {
    for (const [i, jid] of [null, 'invalid', 'group@g.us', 'status@broadcast'].entries()) {
      const e = event(String(i)); e.message.remoteJid = jid
      assert.equal(f.repo.ingest(raw(e)).disposition, 'quarantined')
    }
    const missingId = event('missing'); missingId.message.messageId = null
    assert.equal(f.repo.ingest(raw(missingId)).disposition, 'quarantined')
    assert.equal(f.repo.ingest(raw(event())).disposition, 'pending')
    assert.equal(count(f.db, 'chat_conversations'), 1)
    assert.equal(count(f.db, 'chat_links'), 0)
    assert.equal(count(f.db, 'atendimentos'), 2)
    assert.deepEqual(f.repo.messages(f.a.id).items, [])
    assert.deepEqual(f.repo.messages(f.b.id).items, [])
    assert(!raw(f.repo.pending()).includes('Conteúdo'))
    assert(!raw(f.repo.pending()).includes('@lid'))
    assert(f.db.prepare("SELECT payload FROM chat_events WHERE disposition='quarantined'").all().every(row => row.payload === null))
  } finally { f.db.close() }
})

test('activation excludes historical contents and future clocks are quarantined; invalid payloads leave no writes', () => {
  const f = setup()
  try {
    const old = { ...event(), occurredAt: '2026-11-04T12:00:00.000Z' }
    assert.equal(f.repo.ingest(raw(old)).disposition, 'before_activation')
    assert.equal(f.repo.ingest(raw({ ...event('future'), occurredAt: later })).disposition, 'quarantined')
    assert.equal(count(f.db, 'chat_messages'), 0)
    assert(f.db.prepare('SELECT payload FROM chat_events').all().every(row => row.payload === null))
    for (const value of [{ ...event('bad'), schemaVersion: 2 }, { ...event('bad'), extra: true },
      { ...event('bad'), occurredAt: '2026-02-30T13:00:00.000Z' },
      { ...event('bad'), message: { ...event().message, origin: 'app' } },
      { ...event('bad'), message: { ...event().message, text: 'x'.repeat(16385) } },
      { ...event('bad'), message: { ...event().message, media: { ref: 'http://127.0.0.1', mime: 'image/png', bytes: 1 } } }]) {
      assert.throws(() => f.repo.ingest(raw(value)), code(422))
    }
    assert.throws(() => parseEvent('not JSON'), code(422))
    assert.throws(() => parseEvent(' '.repeat(MAX_CHAT_EVENT_BYTES + 1)), code(413))
    assert.equal(count(f.db, 'chat_events'), 2)
  } finally { f.db.close() }
})

test('status before upsert never invents messages; delayed accepted/failed do not regress read/delivered', () => {
  const f = setup()
  try {
    assert.equal(f.repo.ingest(raw(status('read'))).disposition, 'pending')
    assert.equal(count(f.db, 'chat_messages'), 0)
    f.repo.ingest(raw(event()))
    const pending = f.repo.pending()[0]!
    f.repo.link(decision(pending.conversationId, f.a.id))
    for (const s of ['accepted', 'failed', 'delivered']) f.repo.ingest(raw(status(s)))
    assert.equal(f.repo.messages(f.a.id).items[0]!.status, 'read')
    assert.equal(f.repo.messages(f.a.id).items[0]!.fromMe, false)
    f.repo.ingest(raw(status('failed', 'two')))
    f.repo.ingest(raw(status('delivered', 'two')))
    f.repo.ingest(raw(event('two')))
    assert.equal(f.repo.messages(f.a.id).items[1]!.status, 'delivered')
  } finally { f.db.close() }
})

test('message identity scopes instance and JID; conflicting content never overwrites first projection', () => {
  const f = setup()
  try {
    f.repo.ingest(raw(event()))
    assert.equal(f.repo.ingest(raw({ ...event(), eventId: 'echo-copy' })).disposition, 'pending')
    assert.equal(count(f.db, 'chat_messages'), 1)
    assert.equal(f.repo.ingest(raw({ ...event(), eventId: 'divergent', message: { ...event().message, text: 'Divergência sintética' } })).disposition, 'quarantined')
    f.repo.ingest(raw({ ...event('one', 'other-synthetic@lid'), eventId: 'other-jid-event' }))
    f.repo.registerInstance('second-instance', activation)
    f.repo.ingest(raw({ ...event(), instance: 'second-instance' }))
    assert.equal(count(f.db, 'chat_messages'), 3)
    assert.equal(count(f.db, 'chat_conversations'), 3)
    assert.equal(f.db.prepare('SELECT text FROM chat_messages ORDER BY sequence LIMIT 1').get()!.text, event().message.text)
  } finally { f.db.close() }
})

test('explicit binding is idempotent, revisioned and atomic; later periods preserve prior Atendimento messages', () => {
  const f = setup()
  try {
    f.repo.ingest(raw(event()))
    const conversation = f.repo.pending()[0]!.conversationId
    const first = decision(conversation, f.a.id)
    const receipt = f.repo.link(first)
    assert.deepEqual(f.repo.link(first), receipt)
    assert.throws(() => f.repo.link({ ...first, atendimentoId: f.b.id }), code(409))
    assert.throws(() => f.repo.link({ ...first, requestId: 'stale' }), code(409))
    assert.equal(f.repo.messages(f.a.id).items.length, 1)
    assert.equal(f.repo.messages(f.b.id).items.length, 0)
    f.setNow(later)
    assert.throws(() => f.repo.link(decision(conversation, f.b.id, 1, ['message-one'])), code(409))
    assert.equal(count(f.db, 'chat_links'), 1, 'failed reassignment rolls back close/new link/revision')
    assert.equal(f.db.prepare('SELECT ended_at FROM chat_links').get()!.ended_at, null)
    assert.throws(() => f.repo.link(decision(conversation, 'absent', 1, [])), code(404))
    f.repo.link(decision(conversation, f.b.id, 1, []))
    f.repo.ingest(raw({ ...event('new-period'), occurredAt: later }))
    // Late event for the old period must not leak to the current Atendimento.
    f.repo.ingest(raw(event('late-old-period')))
    assert.deepEqual(f.repo.messages(f.a.id).items.map(m => m.messageId), ['message-one', 'message-late-old-period'])
    assert.deepEqual(f.repo.messages(f.b.id).items.map(m => m.messageId), ['message-new-period'])
    assert.equal(count(f.db, 'atendimentos'), 2)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { f.db.close() }
})

test('scoped cursor pagination excludes interleaved Atendimento, new arrivals and unlinked content; media has no retrieval URL', () => {
  const f = setup()
  try {
    f.repo.ingest(raw(event()))
    f.repo.link(decision(f.repo.pending()[0]!.conversationId, f.a.id))
    for (const kind of ['image', 'audio', 'video', 'document', 'unsupported'] as const) {
      const e = event(kind); e.message.kind = kind; e.message.text = null
      if (kind !== 'unsupported') e.message.media = { ref: 'synthetic-ref', mime: kind === 'document' ? 'application/pdf' : `${kind}/synthetic`, bytes: 100 }
      f.repo.ingest(raw(e))
    }
    f.repo.ingest(raw(event('unlinked', 'unlinked@lid')))
    const first = f.repo.messages(f.a.id, { limit: 2 })
    assert(first.nextCursor)
    assert.throws(() => f.repo.messages(f.b.id, { cursor: first.nextCursor! }), code(422))
    f.repo.ingest(raw(event('after-page')))
    const all = [...first.items]
    let cursor: string | null = first.nextCursor
    while (cursor) { const page = f.repo.messages(f.a.id, { limit: 2, cursor }); all.unshift(...page.items); cursor = page.nextCursor }
    assert.equal(all.length, 6)
    assert.equal(new Set(all.map(m => m.sequence)).size, 6)
    assert.equal(all[1]!.mediaState, 'unavailable')
    assert(!raw(all).includes('synthetic-ref'))
    assert.equal(f.repo.messages(f.b.id).items.length, 0)
    assert.throws(() => f.repo.messages(f.a.id, { cursor: 'invalid' }), code(422))
    assert.throws(() => f.repo.messages(f.a.id, { limit: 101 }), code(422))
    assert.throws(() => f.repo.messages('absent'), code(404))
  } finally { f.db.close() }
})

test('failed final inbox write rolls back projection and never returns ACK; retry then commits', () => {
  const f = setup()
  try {
    f.db.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON chat_events BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
    assert.throws(() => f.repo.ingest(raw(event())), /synthetic failure/)
    for (const table of ['chat_events', 'chat_messages', 'chat_conversations', 'chat_statuses']) assert.equal(count(f.db, table), 0)
    f.db.exec('DROP TRIGGER synthetic_failure')
    assert.equal(f.repo.ingest(raw(event())).state, 'persisted')
    assert.equal(count(f.db, 'chat_messages'), 1)
  } finally { f.db.close() }
})

test('chronological pagination uses provider time with durable sequence tie-breaker, including late arrivals', () => {
  const f = setup()
  try {
    f.repo.ingest(raw(event()))
    f.repo.link(decision(f.repo.pending()[0]!.conversationId, f.a.id))
    f.setNow(later)
    f.repo.ingest(raw({ ...event('later'), occurredAt: later }))
    f.repo.ingest(raw(event('late')))
    const first = f.repo.messages(f.a.id, { limit: 2 })
    assert.deepEqual(first.items.map(m => m.messageId), ['message-late', 'message-later'])
    assert.deepEqual(f.repo.messages(f.a.id, { cursor: first.nextCursor! }).items.map(m => m.messageId), ['message-one'])
  } finally { f.db.close() }
})

test('V13→V14 migration rollback and retry preserve preexisting records and create no fixtures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'funix-chat-migration-'))
  const file = join(directory, 'synthetic.sqlite')
  const db = openDatabase(file)
  try {
    // Empty additive tables can be removed in this disposable fixture to recover
    // the V13 baseline; the actual upgrade and its failure are exercised below.
    db.exec('ALTER TABLE diagnosis_items DROP COLUMN piece_review_pending; DELETE FROM schema_migrations WHERE version=17;')
    db.exec('ALTER TABLE atendimentos DROP COLUMN fabrication_year; ALTER TABLE atendimentos DROP COLUMN model_year; DELETE FROM schema_migrations WHERE version=16;')
    db.exec(`DROP TABLE chat_link_receipts; DROP TABLE chat_statuses; DROP TABLE chat_messages;
      DROP TABLE chat_links; DROP TABLE chat_conversations; DROP TABLE chat_events;
      DROP TABLE chat_instances; ALTER TABLE scenarios DROP COLUMN negotiation_draft_json; DELETE FROM schema_migrations WHERE version IN (14,15);`)
    db.exec('PRAGMA foreign_keys=ON')
    const at = new AtendimentoRepository(db).create({ phone: '000000000', notes: 'Preservar conteúdo sintético anterior' })
    const before = db.prepare('SELECT * FROM atendimentos').all()
    db.exec('CREATE VIEW chat_messages AS SELECT id FROM atendimentos')
    assert.throws(() => migrate(db))
    assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v, 13)
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='chat_instances'").get(), undefined)
    assert.deepEqual(db.prepare('SELECT * FROM atendimentos').all(), before)
    db.exec('DROP VIEW chat_messages'); migrate(db)
    assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v, 17)
    assert.equal(count(db, 'chat_instances'), 0)
    assert.equal(count(db, 'chat_messages'), 0)
    assert.equal(new AtendimentoRepository(db).get(at.id).notes, at.notes)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('file restart and SQLite backup/restore preserve receipts, links and statuses with no duplicate projection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'funix-chat-restart-')), file = join(directory, 'synthetic.sqlite')
  let db = openDatabase(file)
  try {
    const f = setup(db), receipt = f.repo.ingest(raw(event()))
    f.repo.link(decision(f.repo.pending()[0]!.conversationId, f.a.id))
    f.repo.ingest(raw(status('delivered')))
    const expected = f.repo.messages(f.a.id)
    await backupDatabase(db, join(directory, 'backup.sqlite'))
    db.close(); db = openDatabase(file)
    const repo = new ChatRepository(db, () => messageTime)
    assert.deepEqual(repo.ingest(raw(event())), receipt)
    assert.deepEqual(repo.messages(f.a.id), expected)
    const restored = openDatabase(join(directory, 'backup.sqlite'))
    try {
      const copy = new ChatRepository(restored)
      assert.deepEqual(copy.messages(f.a.id), expected)
      assert.deepEqual(copy.ingest(raw(event())), receipt)
      assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
    } finally { restored.close() }
    const script = join(directory, 'reader.mjs'), report = join(directory, 'report.json')
    writeFileSync(script, `import {writeFileSync} from 'node:fs';import {openDatabase} from ${JSON.stringify(new URL('../database.ts', import.meta.url).href)};import {ChatRepository} from ${JSON.stringify(new URL('../chat/repository.ts', import.meta.url).href)};const db=openDatabase(process.argv[2]);writeFileSync(process.argv[4],JSON.stringify(new ChatRepository(db).messages(process.argv[3])));db.close()`)
    const child = spawnSync(process.execPath, [script, file, f.a.id, report], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')), expected)
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('concurrent independent processes replay the same event into one receipt/message without creating Atendimento', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'funix-chat-race-')), file = join(directory, 'synthetic.sqlite')
  const db = openDatabase(file)
  try {
    new ChatRepository(db).registerInstance('synthetic-instance', activation)
    const script = join(directory, 'worker.mjs'), gate = join(directory, 'go')
    writeFileSync(script, `import {writeFileSync,existsSync} from 'node:fs';import {openDatabase} from ${JSON.stringify(new URL('../database.ts', import.meta.url).href)};import {ChatRepository} from ${JSON.stringify(new URL('../chat/repository.ts', import.meta.url).href)};const db=openDatabase(process.argv[2]);while(!existsSync(process.argv[4]))await new Promise(r=>setTimeout(r,5));const receipt=new ChatRepository(db,()=>${JSON.stringify(messageTime)}).ingest(${JSON.stringify(raw(event()))});writeFileSync(process.argv[3],JSON.stringify(receipt));db.close()`)
    const reports = [join(directory, 'a.json'), join(directory, 'b.json')]
    const workers = reports.map(report => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [script, file, report, gate], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk }); child.on('error', reject)
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)))
    }))
    writeFileSync(gate, 'go')
    await Promise.all(workers)
    assert.deepEqual(JSON.parse(readFileSync(reports[0]!, 'utf8')), JSON.parse(readFileSync(reports[1]!, 'utf8')))
    assert.equal(count(db, 'chat_events'), 1)
    assert.equal(count(db, 'chat_messages'), 1)
    assert.equal(count(db, 'atendimentos'), 0)
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})
