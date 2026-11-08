import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createV20AssociationSchema, V20AssociationRepository } from '../chat/v20-associations.ts'

const instance = 'funix_comercial'
const pn = '5531999990001@s.whatsapp.net'
const lid = 'random_lid_identifier@lid'
const another = '5531999990002@s.whatsapp.net'

function fixture() {
  const db = openDatabase(':memory:')
  createV20AssociationSchema(db)
  const operator = new AtendimentoRepository(db)
  const first = operator.create({ phone: '00000000001', name: 'Somente teste A' })
  const second = operator.create({ phone: '00000000002', name: 'Somente teste B' })
  let time = 0
  const repo = new V20AssociationRepository(db, () => new Date(Date.UTC(2026, 10, 8, 12, 0, time++)).toISOString())
  const conversation = repo.rememberConversation(instance, pn)
  return { db, repo, first, second, conversation }
}
const code = (expected: number) => (error: unknown) => error !== null &&
  typeof error === 'object' && 'status' in error && error.status === expected

test('stable identity is scoped to exact instance+JID, survives repository reconstruction and does not merge PN/LID', () => {
  const f = fixture()
  try {
    const same = f.repo.rememberConversation(instance, pn)
    assert.deepEqual(same, f.conversation)
    const later = new V20AssociationRepository(f.db).rememberConversation(instance, pn)
    assert.deepEqual(later, f.conversation)
    assert.notEqual(f.repo.rememberConversation(instance, lid).conversationId, same.conversationId)
    assert.notEqual(f.repo.rememberConversation('another_instance', pn).conversationId, same.conversationId)
    assert.equal(f.repo.listActive(same.conversationId).activeAtendimentoId, null)
    assert.equal(f.repo.listActive(same.conversationId).revision, 0)
    assert.throws(() => f.repo.rememberConversation(instance, 'group@g.us'), code(400))
    assert.throws(() => f.repo.rememberConversation(instance, 'not-a-pn@s.whatsapp.net'), code(400))
  } finally { f.db.close() }
})

test('N:N linking, choosing context, unlink preserves other links and leaves legacy tables/messages unchanged', () => {
  const f = fixture()
  try {
    const c1 = f.conversation.conversationId
    const c2 = f.repo.rememberConversation(instance, another).conversationId
    const beforeLegacy = Number(f.db.prepare('SELECT count(*) AS n FROM chat_links').get()!.n)
    const beforeMessages = Number(f.db.prepare('SELECT count(*) AS n FROM chat_messages').get()!.n)
    const a = f.repo.link({ conversationId: c1, atendimentoId: f.first.id, expectedRevision: 0, requestId: randomUUID(), reason: 'associação manual' })
    const b = f.repo.link({ conversationId: c1, atendimentoId: f.second.id, expectedRevision: 1, requestId: randomUUID(), reason: 'mais um atendimento' })
    f.repo.link({ conversationId: c2, atendimentoId: f.first.id, expectedRevision: 0, requestId: randomUUID(), reason: 'outro chat' })
    assert.equal(f.repo.listActive(c1).items.length, 2)
    assert.equal(f.repo.listActive(c2).items.length, 1)
    assert.equal(f.repo.selectAtendimento(c1, b.linkId), f.second.id)
    assert.equal(f.repo.listActive(c1).activeAtendimentoId, f.second.id)
    assert.equal(f.repo.selectAtendimento(c1, a.linkId), f.first.id)
    assert.equal(f.repo.listActive(c1).activeAtendimentoId, f.first.id)
    assert.equal(f.repo.selectAtendimento(c1, null), null)
    assert.equal(f.repo.listActive(c1).activeAtendimentoId, null)
    f.repo.selectAtendimento(c1, a.linkId)
    assert.deepEqual(f.repo.unlink({ conversationId: c1, linkId: a.linkId, expectedRevision: 2, requestId: randomUUID(), reason: 'desvincular' }),
      { linkId: a.linkId, revision: 3 })
    assert.equal(f.repo.listActive(c1).activeAtendimentoId, null)
    assert.deepEqual(f.repo.listActive(c1).items.map(x => x.atendimentoId), [f.second.id])
    assert.equal(f.repo.listActive(c2).items.length, 1)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM chat_links').get()!.n), beforeLegacy)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM chat_messages').get()!.n), beforeMessages)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM v20_associations WHERE unlinked_at IS NOT NULL').get()!.n), 1)
  } finally { f.db.close() }
})

test('revision, idempotent requestIds, invalid associations and context all fail closed', () => {
  const f = fixture()
  try {
    const conversationId = f.conversation.conversationId
    const input = { conversationId, atendimentoId: f.first.id, expectedRevision: 0, requestId: randomUUID(), reason: 'vínculo sintético' }
    const first = f.repo.link(input)
    assert.deepEqual(f.repo.link(input), first)
    assert.throws(() => f.repo.link({ ...input, atendimentoId: f.second.id }), code(409))
    assert.throws(() => f.repo.link({ ...input, requestId: randomUUID() }), code(409))
    assert.throws(() => f.repo.link({ ...input, expectedRevision: 1, requestId: randomUUID() }), code(409))
    assert.throws(() => f.repo.link({ ...input, atendimentoId: randomUUID(), expectedRevision: 1, requestId: randomUUID() }), code(404))
    assert.throws(() => f.repo.selectAtendimento(conversationId, randomUUID()), code(404))
    assert.throws(() => f.repo.selectAtendimento(randomUUID(), null), code(404))
    const release = { conversationId, linkId: first.linkId, expectedRevision: 1, requestId: randomUUID(), reason: 'desvincular' }
    const removed = f.repo.unlink(release)
    assert.deepEqual(f.repo.unlink(release), removed)
    assert.throws(() => f.repo.unlink({ ...release, reason: 'motivo distinto' }), code(409))
    assert.throws(() => f.repo.selectAtendimento(conversationId, first.linkId), code(404))
    assert.equal(f.repo.listActive(conversationId).items.length, 0)
    assert.equal(f.repo.listActive(conversationId).revision, 2)
  } finally { f.db.close() }
})

test('offline schema is explicitly not part of V14 bootstrap; no production migration is introduced', () => {
  const db = openDatabase(':memory:')
  try {
    const version = db.prepare('SELECT max(version) AS v FROM schema_migrations').get()!.v
    assert.equal(version, 14)
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='v20_associations'").get(), undefined)
    createV20AssociationSchema(db)
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='v20_associations'").get())
    assert.equal(db.prepare('SELECT max(version) AS v FROM schema_migrations').get()!.v, 14)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally { db.close() }
})
