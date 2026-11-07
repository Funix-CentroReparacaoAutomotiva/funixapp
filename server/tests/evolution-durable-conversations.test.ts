import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../database.ts'
import { EvolutionConversationStore } from '../chat/evolution-conversation-store.ts'
import { createEvolutionChatBridge } from '../chat/evolution-bridge.ts'

const instance = 'synthetic_evolution'
const jid = '000000000001@s.whatsapp.net'

test('V15 is additive, isolated from legacy Chat and produces a stable opaque ID across restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'funix-evolution-ref-'))
  const file = join(dir, 'funix.sqlite')
  try {
    const first = openDatabase(file)
    let conversationId: string
    try {
      assert.equal(Number(first.prepare('SELECT MAX(version) AS n FROM schema_migrations').get()!.n), 15)
      const oldTables = first.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_links','chat_messages')").all()
      assert.equal(oldTables.length, 2)
      const store = new EvolutionConversationStore(first, instance)
      conversationId = store.register(jid)
      assert.match(conversationId, /^[a-f0-9-]{36}$/)
      assert.equal(store.register(jid), conversationId)
      assert.equal(store.findRemoteJid(conversationId), jid)
      assert.equal(store.findRemoteJid('00000000-0000-4000-8000-000000000000'), null)
      assert.equal(store.findRemoteJid('not-a-uuid'), null)
      assert.equal(Number(first.prepare('SELECT COUNT(*) AS n FROM evolution_conversations').get()!.n), 1)
    } finally { first.close() }
    const second = openDatabase(file)
    try {
      const store = new EvolutionConversationStore(second, instance)
      assert.equal(store.register(jid), conversationId!)
      assert.equal(store.findRemoteJid(conversationId!), jid)
      assert.equal(new EvolutionConversationStore(second, 'another_instance').findRemoteJid(conversationId!), null)
      assert.equal(new EvolutionConversationStore(second, 'another_instance').register(jid) === conversationId, false)
      assert.equal(Number(second.prepare('SELECT COUNT(*) AS n FROM evolution_conversations').get()!.n), 2)
    } finally { second.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('V15 accepts only individual PN or opaque LID and never conflates aliases', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new EvolutionConversationStore(db, instance)
    for (const invalid of ['bad', '123', 'x@g.us', '', '0'.repeat(200), '000000000001@s.whatsapp.net\n']) {
      assert.throws(() => store.register(invalid), /Invalid provider conversation/)
    }
    const pn = store.register(jid)
    const lid = store.register('synthetic_alias@lid')
    assert.notEqual(pn, lid)
    assert.equal(store.findRemoteJid(pn), jid)
    assert.equal(store.findRemoteJid(lid), 'synthetic_alias@lid')
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM evolution_conversations').get()!.n), 2)
  } finally { db.close() }
})

test('bridge with SQLite mapping keeps conversation ID across instances of bridge and resolves JID server-side', async () => {
  const db = openDatabase(':memory:')
  const calls: string[] = []
  const provider = {
    async findChats() { return [{ remoteJid: jid, updatedAt: null, unreadCount: null }] },
    async findMessages(requested: string, { page } = { page: 1 }) {
      calls.push(requested)
      return {
        items: [], currentPage: page, reportedTotal: 0, reportedPages: 0, nextPage: null,
        consistency: 'offset-not-snapshot' as const,
      }
    },
  }
  try {
    const store = new EvolutionConversationStore(db, instance)
    const first = createEvolutionChatBridge(provider, Date.now, store)
    const id = (await first.list(0)).items[0]!.conversationId
    const second = createEvolutionChatBridge(provider, Date.now, store)
    assert.equal((await second.list(0)).items[0]!.conversationId, id)
    const page = await second.messages(id, 1)
    assert.equal(page?.conversationId, id)
    assert.deepEqual(calls, [jid])
  } finally { db.close() }
})
