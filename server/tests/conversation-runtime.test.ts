import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDatabase } from '../database.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../chat/coda-sync.ts'
import { loadConversationRuntime } from '../chat/conversation-runtime.ts'
import { createEvolutionChatBridge } from '../chat/evolution-bridge.ts'
import { deliverConversationEvent } from '../chat/conversation-relay.ts'
import { parseConversationEvent } from '../chat/conversation-event.ts'
import { EvolutionReadPoc } from '../experimental/evolution-read/client.ts'
import { syntheticMessage, INSTANCE, envelope } from './fixtures/evolution-read.ts'

const PN = '000000000001@s.whatsapp.net',
  LID = 'local-synthetic@lid'
function fixture(path = ':memory:', read = true) {
  const db = openDatabase(path)
  createCodaEventSchema(db)
  const identities = new CodaEventSyncRepository(db),
    local = loadConversationRuntime(
      {
        FUNIX_CHAT_LOCAL_ENABLED: 'true',
        FUNIX_CHAT_LOCAL_READ_ENABLED: read ? 'true' : 'false',
        FUNIX_EVOLUTION_READ_ENABLED: 'true',
      },
      db,
      identities,
    )!
  let fail = false,
    after: undefined | (() => void),
    calls = 0,
    sends = 0,
    mediaReads = 0
  let rows = [
    syntheticMessage(1, { key: { id: 'msg-1', fromMe: false, remoteJid: LID, remoteJidAlt: PN } }),
  ]
  const provider = new EvolutionReadPoc({
    instance: 'funix_comercial',
    instanceId: INSTANCE,
    transport: async () => {
      calls++
      after?.()
      if (fail) throw Error('synthetic outage')
      return { status: 200, body: envelope(rows) }
    },
  })
  const bridge = createEvolutionChatBridge(
    {
      findChatsPage: async () => {
        if (fail) throw Error('offline')
        return {
          items: [
            {
              remoteJid: LID,
              remoteJidAlt: PN,
              displayName: 'Sintético',
              phoneNumber: null,
              updatedAt: null,
              unreadCount: 0,
            },
          ],
          sourceCount: 1,
        }
      },
      findMessages: provider.findMessages.bind(provider),
      findMediaEnvelope: async (_jid, _id) => {
        mediaReads++
        after?.()
        return {
          envelope: { key: { id: _id, remoteJid: LID, remoteJidAlt: PN } },
          kind: 'image' as const,
          bytes: 4,
        }
      },
    },
    Date.now,
    undefined,
    identities,
    async () => {
      sends++
      return { messageId: 'provider-receipt' }
    },
    {
      send: async () => {
        sends++
        return { messageId: 'media-receipt' }
      },
      get: async () => ({ kind: 'image', mimeType: 'image/jpeg', base64: 'synthetic' }),
    },
    local,
  )
  const event = (n = 1, overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 2,
    instance: 'funix_comercial',
    eventId: `event:${n}`,
    occurredAt: `2026-11-13T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
    type: 'message.upsert',
    message: {
      remoteJid: LID,
      remoteJidAlt: PN,
      messageId: `msg-${n}`,
      timestamp: 1700000000 + n,
      fromMe: false,
      kind: 'text',
      text: `Synthetic ${n}`,
      media: null,
    },
    ...overrides,
  })
  const confirm = (row = 'i-LOCAL_A', at = 100) =>
    identities.sync({
      version: 1,
      source: 'coda',
      instance: 'funix_comercial',
      eventId: `${row}:${at}`,
      codaRowId: row,
      remoteJid: PN,
      phoneE164: null,
      displayName: 'Sintético',
      occurredAt: at,
    }).atendimentoId
  return {
    db,
    identities,
    local,
    bridge,
    event,
    confirm,
    get mediaReads() {
      return mediaReads
    },
    get calls() {
      return calls
    },
    get sends() {
      return sends
    },
    outage: (value = true) => {
      fail = value
    },
    rows: (value: typeof rows) => {
      rows = value
    },
    during: (callback: () => void) => {
      after = callback
    },
  }
}
const code = (value: string) => (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === value

test('local pending event is durable/idempotent without Atendimento; late ERP confirmation opens same local conversation offline', async () => {
  const f = fixture()
  try {
    const raw = JSON.stringify(f.event()),
      receipt = f.local.store.ingest(raw)
    assert.equal(receipt.disposition, 'pending')
    assert.deepEqual(f.local.store.ingest(raw), receipt)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 0)
    const handle = f.identities.rememberProviderConversation(LID)
    assert.equal(await f.bridge.messages(handle, 1), null)
    const id = f.confirm()
    f.outage()
    assert.equal((await f.bridge.list(0)).source, 'local')
    const page = await f.bridge.messagesForAtendimento(id, handle, 1)
    assert.equal(page?.source, 'local')
    assert.equal(page?.items[0]?.text, 'Synthetic 1')
    assert.equal(f.calls, 0)
    assert.deepEqual(f.bridge.conversationForAtendimento(id), { conversationId: handle })
  } finally {
    f.db.close()
  }
})

test('edit, delayed original, deletion and later edit never duplicate or resurrect a message', () => {
  const f = fixture()
  try {
    const original = f.event(),
      message = original.message
    f.local.store.ingest(JSON.stringify(original))
    f.local.store.ingest(
      JSON.stringify(
        f.event(2, { type: 'message.edit', message: { ...message, text: 'Edited synthetic' } }),
      ),
    )
    f.local.store.ingest(JSON.stringify({ ...original, eventId: 'late-original' }))
    assert.equal(f.local.store.page(LID, 1).items[0]?.text, 'Edited synthetic')
    f.local.store.ingest(
      JSON.stringify(
        f.event(3, {
          type: 'message.delete',
          message: { remoteJid: LID, remoteJidAlt: PN, messageId: 'msg-1' },
        }),
      ),
    )
    f.local.store.ingest(
      JSON.stringify(
        f.event(4, { type: 'message.edit', message: { ...message, text: 'Must not resurrect' } }),
      ),
    )
    assert.equal(f.local.store.page(LID, 1).items[0]?.text, null)
    assert.equal(f.local.store.page(LID, 1).items[0]?.kind, 'unsupported')
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n), 1)
  } finally {
    f.db.close()
  }
})

test('status before message creates no placeholder; old null snapshot does not erase newer live content', async () => {
  const f = fixture()
  try {
    f.local.store.ingest(
      JSON.stringify(
        f.event(1, {
          type: 'message.status',
          message: { remoteJid: LID, remoteJidAlt: PN, messageId: 'msg-1', statuses: ['READ'] },
        }),
      ),
    )
    assert.equal(f.local.store.page(LID, 1).items.length, 0)
    f.local.store.ingest(JSON.stringify(f.event(2, { message: f.event().message })))
    const provider = new EvolutionReadPoc({
      instance: 'funix_comercial',
      instanceId: INSTANCE,
      transport: async () => ({
        status: 200,
        body: envelope([
          syntheticMessage(1, {
            message: null,
            MessageUpdate: [{ status: 'EDITED' }],
            key: { id: 'msg-1', fromMe: false, remoteJid: LID, remoteJidAlt: PN },
          }),
        ]),
      }),
    })
    f.local.store.observePage(LID, (await provider.findMessages(LID)).items, 1)
    assert.equal(f.local.store.page(LID, 1).items[0]?.text, 'Synthetic 1')
    assert.deepEqual(f.local.store.page(LID, 1).items[0]?.statuses, ['EDITED', 'READ'])
  } finally {
    f.db.close()
  }
})

test('future, malformed and same-event divergent content leave no partial projection', () => {
  const f = fixture()
  try {
    const e = f.event()
    f.local.store.ingest(JSON.stringify(e))
    assert.throws(
      () =>
        f.local.store.ingest(
          JSON.stringify({ ...e, message: { ...e.message, text: 'different' } }),
        ),
      code('CHAT_IDENTITY_CONFLICT'),
    )
    assert.throws(
      () =>
        f.local.store.ingest(
          JSON.stringify({ ...e, eventId: 'future', occurredAt: '2099-01-01T00:00:00.000Z' }),
        ),
      code('CHAT_FUTURE_EVENT'),
    )
    for (const malformed of [
      { ...e, type: ['message.delete'] },
      { ...e, message: { ...e.message, kind: ['text'] } },
      { ...e, message: { ...e.message, statuses: [['READ']] } },
      { ...e, message: { ...e.message, url: 'https://private.invalid' } },
    ])
      assert.throws(
        () => parseConversationEvent(JSON.stringify(malformed)),
        code('CHAT_INVALID_EVENT'),
      )
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_events').get()!.n), 1)
  } finally {
    f.db.close()
  }
})

test('alias collision is quarantined durably and blocks cached generic, canonical and send paths', async () => {
  const f = fixture()
  try {
    f.local.store.ingest(JSON.stringify(f.event()))
    const id = f.confirm(),
      handle = f.identities.rememberProviderConversation(LID)
    const collision = f.event(2, { message: { ...f.event(2).message, remoteJid: 'other-lid@lid' } })
    assert.equal(f.local.store.ingest(JSON.stringify(collision)).disposition, 'quarantined')
    assert.equal(await f.bridge.messagesForAtendimento(id, handle, 1), null)
    assert.equal(await f.bridge.messages(handle, 1), null)
    assert.equal(f.calls, 0)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 1)
  } finally {
    f.db.close()
  }
})

test('local keyset spans equal timestamps and ignores insertions beyond ceiling; context change invalidates cursor', () => {
  const f = fixture()
  try {
    f.confirm()
    for (let n = 1; n <= 70; n++)
      f.local.store.ingest(
        JSON.stringify(f.event(n, { message: { ...f.event(n).message, timestamp: 1700000000 } })),
      )
    const first = f.local.store.page(LID, 1)
    assert.equal(first.items.length, 50)
    assert(first.nextCursor)
    f.local.store.ingest(
      JSON.stringify(f.event(71, { message: { ...f.event(71).message, timestamp: 1600000000 } })),
    )
    const second = f.local.store.page(LID, 2, first.nextCursor)
    assert.equal(second.items.length, 20)
    assert.equal(new Set([...first.items, ...second.items].map((m) => m.messageId)).size, 70)
    f.confirm('i-LOCAL_B', 200)
    assert.throws(() => f.local.store.page(LID, 2, first.nextCursor!), code('CHAT_CONTEXT_CHANGED'))
  } finally {
    f.db.close()
  }
})

test('SQLite reopen preserves local messages, handles and accepted send receipts without another provider send', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'funix-local-')),
    path = join(directory, 'test.sqlite')
  let f = fixture(path)
  try {
    f.local.store.ingest(JSON.stringify(f.event()))
    const id = f.confirm(),
      handle = f.identities.rememberProviderConversation(LID)
    const command = { requestId: randomUUID(), contextToken: f.identities.contextToken(LID)! }
    assert.equal(
      (await f.bridge.sendTextForAtendimento(id, handle, 'synthetic', command)).state,
      'accepted',
    )
    f.db.close()
    f = fixture(path)
    assert.equal(
      (await f.bridge.sendTextForAtendimento(id, handle, 'synthetic', command)).state,
      'accepted',
    )
    assert.equal(f.sends, 0)
    assert.equal((await f.bridge.messagesForAtendimento(id, handle, 1))?.items.length, 1)
  } finally {
    f.db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('text/media commands bind content and context; uncertain sends and changed commands cannot be repeated', async () => {
  const f = fixture()
  try {
    f.local.store.ingest(JSON.stringify(f.event()))
    const id = f.confirm(),
      handle = f.identities.rememberProviderConversation(LID)
    assert.equal((await f.bridge.sendTextForAtendimento(id, handle, 'synthetic')).state, 'unlinked')
    const command = { requestId: randomUUID(), contextToken: f.identities.contextToken(LID)! }
    await f.bridge.sendTextForAtendimento(id, handle, 'synthetic', command)
    await f.bridge.sendTextForAtendimento(id, handle, 'synthetic', command)
    assert.equal(f.sends, 1)
    await assert.rejects(
      f.bridge.sendTextForAtendimento(id, handle, 'changed', command),
      code('CHAT_SEND_CONFLICT'),
    )
    const photo = {
        kind: 'image' as const,
        mimeType: 'image/jpeg' as const,
        base64: Buffer.from([255, 216, 255, 0]).toString('base64'),
      },
      mediaCommand = { ...command, requestId: randomUUID() }
    await f.bridge.sendMediaForAtendimento(id, handle, photo, mediaCommand)
    await f.bridge.sendMediaForAtendimento(id, handle, photo, mediaCommand)
    assert.equal(f.sends, 2)
    const uncertain = { ...command, requestId: randomUUID() }
    let attempts = 0
    await assert.rejects(
      f.local.sends.run(uncertain, PN, 'payload', async () => {
        attempts++
        throw Error('timeout')
      }),
    )
    await assert.rejects(
      f.local.sends.run(uncertain, PN, 'payload', async () => {
        attempts++
        return { messageId: 'bad' }
      }),
      code('CHAT_SEND_UNCERTAIN'),
    )
    assert.equal(attempts, 1)
    f.confirm('i-LOCAL_B', 200)
    assert.equal(
      (await f.bridge.sendTextForAtendimento(id, handle, 'synthetic', command)).state,
      'unlinked',
    )
  } finally {
    f.db.close()
  }
})

test('failed bootstrap is not empty history; successful empty page does not repeatedly consult provider', async () => {
  const f = fixture()
  try {
    f.identities.rememberProviderAliases([{ remoteJid: LID, remoteJidAlt: PN }])
    const id = f.confirm(),
      handle = f.identities.rememberProviderConversation(LID)
    f.outage()
    await assert.rejects(f.bridge.messagesForAtendimento(id, handle, 1))
    f.outage(false)
    f.rows([])
    assert.equal((await f.bridge.messagesForAtendimento(id, handle, 1))?.items.length, 0)
    const calls = f.calls
    f.outage()
    assert.equal((await f.bridge.messagesForAtendimento(id, handle, 1))?.items.length, 0)
    assert.equal(f.calls, calls)
  } finally {
    f.db.close()
  }
})

test('backfill rechecks canonical context after response before exposing historical messages', async () => {
  const f = fixture()
  try {
    const id = f.confirm(),
      handle = f.identities.rememberProviderConversation(LID)
    assert.equal(await f.bridge.recoverHistory('other', handle, 1), null)
    assert.equal(f.calls, 0)
    f.during(() => f.confirm('i-LOCAL_B', 200))
    assert.equal(await f.bridge.recoverHistory(id, handle, 1), null)
    assert.equal(await f.bridge.messagesForAtendimento(id, handle, 1), null)
  } finally {
    f.db.close()
  }
})

test('dispatch lock covers destination across handles; interrupted sending becomes uncertain on restart', async () => {
  const f = fixture()
  try {
    const command = { requestId: randomUUID(), contextToken: 'a'.repeat(64) }
    let release!: () => void
    const pending = f.local.sends.run(command, PN, 'a', async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { messageId: 'one' }
    })
    await assert.rejects(
      f.local.sends.run({ ...command, requestId: randomUUID() }, PN, 'b', async () => ({
        messageId: 'bad',
      })),
      code('CHAT_SEND_IN_PROGRESS'),
    )
    release()
    await pending
    const crashed = randomUUID()
    f.db
      .prepare("INSERT INTO chat_send_operations VALUES(?,?,?,'sending',NULL,?,?)")
      .run(crashed, PN, 'digest', 'now', 'now')
    f.local.sends.recoverInterrupted()
    assert.equal(
      f.db.prepare('SELECT state FROM chat_send_operations WHERE request_id=?').get(crashed)!.state,
      'uncertain',
    )
  } finally {
    f.db.close()
  }
})

test('lost relay ACK retries event only and requires a matching receipt, without duplicate messages or Atendimento', async () => {
  const f = fixture()
  try {
    const raw = JSON.stringify(f.event()),
      config = { keyId: 'synthetic', secret: Buffer.alloc(32, 7) }
    let attempts = 0
    const transport = async () => {
      attempts++
      const receipt = f.local.store.ingest(raw)
      if (attempts === 1) throw Error('lost ACK')
      return { status: 202, body: receipt }
    }
    assert.equal((await deliverConversationEvent(raw, config, transport)).state, 'retry')
    assert.equal((await deliverConversationEvent(raw, config, transport)).state, 'persisted')
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n), 1)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 0)
    assert.equal(
      (
        await deliverConversationEvent(raw, config, async () => ({
          status: 202,
          body: { state: 'persisted', eventId: 'wrong', receiptId: randomUUID() },
        }))
      ).state,
      'retry',
    )
    assert.equal(
      (await deliverConversationEvent(raw, config, async () => ({ status: 401 }))).state,
      'review',
    )
  } finally {
    f.db.close()
  }
})

test('disabled gates create no metadata/instance and cannot enable read without storage', () => {
  const db = openDatabase(':memory:')
  try {
    assert.equal(loadConversationRuntime({}, db), undefined)
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM chat_instances').get()!.n), 0)
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_schema WHERE name='chat_message_state'").get(),
      undefined,
    )
    assert.throws(
      () => loadConversationRuntime({ FUNIX_CHAT_LOCAL_READ_ENABLED: 'true' }, db),
      /REQUIRES_STORAGE/,
    )
    assert.throws(
      () => loadConversationRuntime({ FUNIX_CHAT_LOCAL_ENABLED: 'true' }, db),
      /REQUIRES_CANONICAL/,
    )
  } finally {
    db.close()
  }
})

test('identity upgrade retains four-column evidence and adds provenance without creating commercial data', () => {
  const db = openDatabase(':memory:')
  try {
    db.exec(
      'CREATE TABLE chat_provider_alias_evidence(instance TEXT,pn TEXT,lid TEXT,first_seen_at TEXT,PRIMARY KEY(instance,pn,lid))',
    )
    db.prepare('INSERT INTO chat_provider_alias_evidence VALUES(?,?,?,?)').run(
      'funix_comercial',
      PN,
      LID,
      '2026-01-01T00:00:00.000Z',
    )
    createCodaEventSchema(db)
    const identities = new CodaEventSyncRepository(db)
    assert.deepEqual(identities.identityJids(PN), [LID, PN])
    identities.rememberProviderAliases(
      [{ remoteJid: LID, remoteJidAlt: PN, messageId: 'proof-message' }],
      false,
      'webhook',
    )
    const evidence = db.prepare('SELECT * FROM chat_provider_alias_evidence').get()!
    assert.equal(evidence.first_seen_at, '2026-01-01T00:00:00.000Z')
    assert.equal(evidence.evidence_source, 'webhook')
    assert.match(String(evidence.evidence_reference), /^sha256:[a-f0-9]{64}$/)
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 0)
  } finally {
    db.close()
  }
})

test('same Atendimento event keeps revision; A to B to A rejects old send commands', async () => {
  const f = fixture()
  try {
    f.local.store.ingest(JSON.stringify(f.event()))
    const id = f.confirm(),
      handle = f.identities.rememberProviderConversation(LID),
      token = f.identities.contextToken(LID)!,
      command = { requestId: randomUUID(), contextToken: token }
    f.confirm('i-LOCAL_A', 150)
    assert.equal(f.identities.contextToken(LID), token)
    assert.equal(
      (await f.bridge.sendTextForAtendimento(id, handle, 'synthetic', command)).state,
      'accepted',
    )
    f.confirm('i-LOCAL_B', 200)
    f.confirm('i-LOCAL_A', 250)
    assert.notEqual(f.identities.contextToken(LID), token)
    assert.equal(
      (await f.bridge.sendTextForAtendimento(id, handle, 'synthetic', command)).state,
      'unlinked',
    )
    assert.equal(f.sends, 1)
  } finally {
    f.db.close()
  }
})

test('replay CLI defaults to dry-run with metadata only, even with an unreachable configured origin', () => {
  const f = fixture(),
    directory = mkdtempSync(join(tmpdir(), 'chat-replay-'))
  try {
    const path = join(directory, 'event.json')
    writeFileSync(path, JSON.stringify(f.event()))
    const run = spawnSync(process.execPath, ['scripts/chat-relay-replay.ts', '--input=' + path], {
      encoding: 'utf8',
      env: { ...process.env, FUNIX_APP_ORIGIN: 'http://127.0.0.1:1' },
    })
    assert.equal(run.status, 0, run.stderr)
    const result = JSON.parse(run.stdout)
    assert.equal(result.mode, 'dry-run')
    assert.equal(result.eventId, 'event:1')
    assert(!run.stdout.includes('Synthetic'))
    assert(!run.stdout.includes(PN))
    assert(!run.stdout.includes(LID))
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n), 0)
  } finally {
    f.db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('provider EDITED version repairs lost edits; missing edited body is hidden and newer live content is preserved', async () => {
  const f = fixture()
  try {
    f.local.store.ingest(JSON.stringify(f.event()))
    const snapshot = async (text: string | null, stamp: number) => {
      const provider = new EvolutionReadPoc({
        instance: 'funix_comercial',
        instanceId: INSTANCE,
        transport: async () => ({
          status: 200,
          body: envelope([
            syntheticMessage(1, {
              key: { id: 'msg-1', remoteJid: LID, remoteJidAlt: PN, fromMe: false },
              messageTimestamp: stamp,
              message: text === null ? null : { conversation: text },
              MessageUpdate: [{ status: 'EDITED' }],
            }),
          ]),
        }),
      })
      f.local.store.observePage(LID, (await provider.findMessages(LID)).items, 1)
    }
    await snapshot('Recovered edit', 1794528002)
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, 'Recovered edit')
    assert.equal(f.local.store.page(LID, 1).items[0]!.timestamp, 1700000001)
    await snapshot(null, 1794528003)
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, null)
    assert.equal(f.db.prepare('SELECT text FROM chat_messages').get()!.text, 'Recovered edit')
    await snapshot('Recovered body', 1794528003)
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, 'Recovered body')
    f.local.store.ingest(
      JSON.stringify(
        f.event(7, {
          type: 'message.edit',
          message: { ...f.event().message, text: 'Newer live edit' },
        }),
      ),
    )
    await snapshot('Old provider copy', 1794528003)
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, 'Newer live edit')
  } finally {
    f.db.close()
  }
})

test('PN handle created before LID evidence stays canonical after reconciliation; both raw domains share public identity', async () => {
  const f = fixture()
  try {
    const id = f.confirm(),
      before = f.identities.rememberProviderConversation(PN)
    f.local.store.ingest(
      JSON.stringify(
        f.event(1, { message: { ...f.event().message, remoteJid: PN, remoteJidAlt: null } }),
      ),
    )
    f.local.store.ingest(JSON.stringify(f.event(2)))
    assert.equal(f.identities.rememberProviderConversation(LID), before)
    assert.equal(f.identities.rememberProviderConversation(PN), before)
    assert.deepEqual(f.bridge.conversationForAtendimento(id), { conversationId: before })
    const history = await f.bridge.messagesForAtendimento(id, before, 1)
    assert.equal(history?.items.length, 2)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 1)
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally {
    f.db.close()
  }
})

test('healthy provider page cannot hide an independently received conversation from the local list', async () => {
  const f = fixture()
  try {
    f.local.store.ingest(
      JSON.stringify(
        f.event(4, {
          displayName: 'Outro contato sintético',
          message: {
            ...f.event(4).message,
            remoteJid: 'independent@lid',
            remoteJidAlt: '000000000002@s.whatsapp.net',
          },
        }),
      ),
    )
    const listed = await f.bridge.list(0)
    assert.equal(listed.source, 'local')
    assert.equal(listed.providerUnavailable, false)
    assert(listed.items.some((row) => row.displayName === 'Outro contato sintético'))
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 0)
  } finally {
    f.db.close()
  }
})

test('rendered older message refresh returns edits/deletions outside newest page, filters unchanged versions and isolates another peer', async () => {
  const f = fixture()
  try {
    for (let n = 1; n <= 65; n++) f.local.store.ingest(JSON.stringify(f.event(n)))
    const id = f.confirm(),
      handle = f.identities.rememberProviderConversation(LID)
    const older = f.local.store.states(LID, [{ messageId: 'msg-1' }])[0]!
    assert.equal(
      (await f.bridge.messagesForAtendimento(id, handle, 1))!.items.some(
        (item) => item.messageId === 'msg-1',
      ),
      false,
    )
    f.local.store.ingest(
      JSON.stringify(
        f.event(66, {
          type: 'message.edit',
          occurredAt: '2026-11-13T00:02:00.000Z',
          message: { ...f.event().message, text: 'Older edited message' },
        }),
      ),
    )
    const refreshed = await f.bridge.messageStates(id, handle, [
      { messageId: 'msg-1', version: older.version },
    ])
    assert.equal(refreshed?.items[0]?.text, 'Older edited message')
    assert.deepEqual(
      (
        await f.bridge.messageStates(id, handle, [
          { messageId: 'msg-1', version: refreshed!.items[0]!.version },
        ])
      )?.items,
      [],
    )
    f.local.store.ingest(
      JSON.stringify(
        f.event(67, {
          type: 'message.delete',
          occurredAt: '2026-11-13T00:03:00.000Z',
          message: { remoteJid: LID, remoteJidAlt: PN, messageId: 'msg-1' },
        }),
      ),
    )
    assert.equal(
      (await f.bridge.messageStates(id, handle, [{ messageId: 'msg-1' }]))?.items[0]?.text,
      null,
    )
    f.local.store.ingest(
      JSON.stringify(
        f.event(68, {
          message: {
            ...f.event(68).message,
            remoteJid: 'another@lid',
            remoteJidAlt: '000000000002@s.whatsapp.net',
          },
        }),
      ),
    )
    assert.deepEqual(
      (await f.bridge.messageStates(id, handle, [{ messageId: 'msg-68' }]))?.items,
      [],
    )
    f.confirm('i-LOCAL_B', 200)
    assert.equal(await f.bridge.messageStates(id, handle, [{ messageId: 'msg-1' }]), null)
  } finally {
    f.db.close()
  }
})

test('deleted media is blocked before provider access and a deletion during retrieval withholds the file', async () => {
  const f = fixture()
  try {
    f.local.store.ingest(
      JSON.stringify(
        f.event(1, {
          message: {
            ...f.event().message,
            kind: 'image',
            text: null,
            media: { mimeType: 'image/jpeg', bytes: 4 },
          },
        }),
      ),
    )
    const id = f.confirm(),
      handle = f.identities.rememberProviderConversation(LID)
    assert.equal((await f.bridge.mediaForAtendimento(id, handle, 'msg-1', 1))?.state, 'ready')
    const remove = () =>
      f.local.store.ingest(
        JSON.stringify(
          f.event(2, {
            type: 'message.delete',
            message: { remoteJid: LID, remoteJidAlt: PN, messageId: 'msg-1' },
          }),
        ),
      )
    f.during(remove)
    assert.equal(await f.bridge.mediaForAtendimento(id, handle, 'msg-1', 1), null)
    const reads = f.mediaReads
    assert.equal(await f.bridge.mediaForAtendimento(id, handle, 'msg-1', 1), null)
    assert.equal(f.mediaReads, reads)
  } finally {
    f.db.close()
  }
})
