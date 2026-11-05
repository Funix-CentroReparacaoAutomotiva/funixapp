import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../database.ts'
import { ChatRepository } from '../chat/repository.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import type { ChatMessage } from '../../shared/chat.ts'
import { ServiceError } from '../errors.ts'

test('latest 50 then older pages cover 503 tied/out-of-order messages exactly once; new and late events wait for refresh', () => {
  const db = openDatabase(':memory:')
  try {
    const atendimentos = new AtendimentoRepository(db), a = atendimentos.create({ phone: '000000000' }), b = atendimentos.create({ phone: '000000000' })
    let clock = Date.parse('2026-11-05T16:00:00.000Z')
    const repo = new ChatRepository(db, () => new Date(clock).toISOString())
    repo.registerInstance('synthetic-pagination', '2026-11-05T12:00:00Z')
    const insert = (id: string, time: string, jid = 'a-synthetic@lid') => repo.ingest(JSON.stringify({ schemaVersion: 1, instance: 'synthetic-pagination', eventId: id,
      occurredAt: time, type: 'message.upsert', message: { remoteJid: jid, messageId: id, fromMe: false, origin: 'unknown', kind: 'text', text: id, media: null } }))
    // Deliberately insert out of chronological order, with large timestamp ties.
    for (let index = 0; index < 503; index++) insert('synthetic-' + index, index % 3 ? '2026-11-05T14:00:00.000Z' : '2026-11-05T13:00:00.000Z')
    const conversationId = repo.pending()[0]!.conversationId
    let revision = 0
    for (let start = 0; start < 503; start += 100) {
      repo.link({ conversationId, atendimentoId: a.id, revision, requestId: 'batch-' + start, actor: 'qa', reason: 'Associação sintética explícita',
        pendingMessageIds: Array.from({ length: Math.min(100, 503 - start) }, (_, offset) => 'synthetic-' + (start + offset)) })
      revision++; clock++
    }
    insert('private-b', '2026-11-05T14:00:00.000Z', 'b-synthetic@lid')
    repo.link({ conversationId: repo.pending()[0]!.conversationId, atendimentoId: b.id, revision: 0, requestId: 'b', actor: 'qa', reason: 'Vínculo B sintético', pendingMessageIds: ['private-b'] })
    insert('private-pending', '2026-11-05T14:00:00.000Z', 'pending-synthetic@lid')
    const expected = db.prepare('SELECT sequence,message_id,occurred_at FROM chat_messages WHERE conversation_id=? ORDER BY occurred_at,sequence').all(conversationId)
    const first = repo.messages(a.id)
    assert.equal(first.items.length, 50)
    assert.deepEqual(first.items.map(m => m.messageId), expected.slice(-50).map(m => m.message_id))
    assert.throws(() => repo.messages(b.id, { cursor: first.nextCursor! }), e => e instanceof ServiceError && e.status === 422)
    const oldCursor = Buffer.from(JSON.stringify([a.id, first.items[0]!.occurredAt, first.items[0]!.sequence, 999999])).toString('base64url')
    assert.throws(() => repo.messages(a.id, { cursor: oldCursor }), e => e instanceof ServiceError && e.status === 422)
    // Both land after the first page's durable sequence ceiling. One is newer,
    // another is older than its boundary; neither can change the open traversal.
    insert('newest-after-page', '2026-11-05T16:00:00.000Z')
    insert('late-after-page', '2026-11-05T12:30:00.000Z')
    repo.link({ conversationId, atendimentoId: a.id, revision, requestId: 'late-explicit', actor: 'qa', reason: 'Mensagem tardia sintética selecionada', pendingMessageIds: ['late-after-page'] })
    const all: ChatMessage[] = [...first.items]
    let cursor = first.nextCursor
    while (cursor) {
      const page = repo.messages(a.id, { cursor })
      assert(page.items.length <= 50)
      all.unshift(...page.items); cursor = page.nextCursor
    }
    assert.equal(all.length, 503)
    assert.equal(new Set(all.map(m => m.sequence)).size, 503)
    assert.deepEqual(all.map(m => m.messageId), expected.map(m => m.message_id))
    assert(!JSON.stringify(all).includes('private-'))
    const refreshed = repo.messages(a.id)
    assert.equal(refreshed.items.at(-1)!.messageId, 'newest-after-page')
    const refreshedAll = [...refreshed.items]; cursor = refreshed.nextCursor
    while (cursor) { const page = repo.messages(a.id, { cursor }); refreshedAll.unshift(...page.items); cursor = page.nextCursor }
    assert.equal(refreshedAll.length, 505)
    assert.equal(refreshedAll[0]!.messageId, 'late-after-page')
    assert.equal(new Set(refreshedAll.map(m => m.sequence)).size, 505)
  } finally { db.close() }
})
