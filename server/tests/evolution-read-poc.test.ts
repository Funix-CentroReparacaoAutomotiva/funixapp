import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EvolutionReadError, EvolutionReadPoc, reconcileReadBatches } from '../experimental/evolution-read/client.ts'
import type { ReadTransport } from '../experimental/evolution-read/client.ts'
import { ConversationContextPoc } from '../experimental/evolution-read/context.ts'
import { envelope, syntheticMessage, syntheticSource, INSTANCE, LID, PN, OTHER } from './fixtures/evolution-read.ts'

const client = (transport: ReadTransport, timeoutMs = 1000) => new EvolutionReadPoc({ instance: 'synthetic-offline', instanceId: INSTANCE, transport, timeoutMs })
const response = (body: unknown): ReadTransport => async () => ({ status: 200, body })
const errorCode = (code: string) => (error: unknown) => error instanceof EvolutionReadError && error.code === code
const ids = (items: { messageId: string }[]) => items.map(m => m.messageId)
const history = (n: number) => Array.from({ length: n }, (_, i) => syntheticMessage(i + 1))

test('Evolution POC: POST findChats uses take/skip and strips previews and URLs', async () => {
  const source = syntheticSource([syntheticMessage(1), syntheticMessage(2, { key: { id: 'lid-message', remoteJid: LID, fromMe: true } })])
  const api = client(source.transport)
  assert.deepEqual((await api.findChats({ take: 1 })).map(c => c.remoteJid), [PN])
  assert.deepEqual((await api.findChats({ take: 1, skip: 1 })).map(c => c.remoteJid), [LID])
  assert.equal(source.requests[0].method, 'POST')
  assert.equal(source.requests[0].path, '/chat/findChats/synthetic-offline')
  assert.deepEqual(source.requests[0].body, { take: 1, skip: 0 })
  const chats = await client(response([{ remoteJid: LID, updatedAt: null, unreadCount: null,
    lastMessage: { text: 'not projected' }, profilePicUrl: 'https://synthetic.invalid/private', pushName: 'Contato Sintético' }])).findChats()
  assert.deepEqual(chats, [{ remoteJid: LID, displayName: 'Contato Sintético', phoneNumber: null, updatedAt: null, unreadCount: null }])
})

test('Evolution POC: latest 50 chronological, older pages, empty and exact page boundary', async () => {
  const source = syntheticSource(history(123)), api = client(source.transport)
  const first = await api.findMessages(PN)
  assert.equal(first.items.length, 50)
  assert.deepEqual(ids(first.items), history(123).slice(73).map(r => (r.key as { id: string }).id))
  assert.equal(first.nextPage, 2); assert.equal(first.consistency, 'offset-not-snapshot')
  assert.deepEqual(source.requests[0].body, { where: { key: { remoteJid: PN, remoteJidAlt: PN } }, page: 1, offset: 50 })
  const second = await api.findMessages(PN, { page: 2 }), third = await api.findMessages(PN, { page: 3 })
  const all = reconcileReadBatches(first.items, second.items, third.items)
  assert.equal(all.length, 123); assert.equal(third.nextPage, null)
  assert.deepEqual(ids(all), history(123).map(r => (r.key as { id: string }).id))
  assert.deepEqual((await api.findMessages(OTHER)).items, [])
  const exact = client(syntheticSource(history(50)).transport)
  assert.equal((await exact.findMessages(PN)).nextPage, 2) // extra empty request, no completeness claim from count
  assert.equal((await exact.findMessages(PN, { page: 2 })).nextPage, null)
})

test('Evolution POC: insertion shifts offset; dedup removes repeat but does not discover new head', async () => {
  const source = syntheticSource(history(100)), api = client(source.transport)
  const first = await api.findMessages(PN)
  source.insert(syntheticMessage(101))
  const second = await api.findMessages(PN, { page: 2 })
  assert.equal(first.items.filter(m => ids(second.items).includes(m.messageId)).length, 1)
  const merged = reconcileReadBatches(first.items, second.items)
  assert.equal(merged.length, 99)
  assert.ok(!ids(merged).includes('msg-1')); assert.ok(!ids(merged).includes('msg-101'))
  const third = await api.findMessages(PN, { page: 3 })
  assert.equal(reconcileReadBatches(merged, third.items).length, 100)
  assert.ok(ids((await api.findMessages(PN)).items).includes('msg-101')) // explicit head refresh
})

test('Evolution POC: removal before offset permanently skips a still-existing message', async () => {
  const source = syntheticSource(history(100)), api = client(source.transport)
  const first = await api.findMessages(PN)
  source.remove('row-100')
  const second = await api.findMessages(PN, { page: 2 })
  const merged = reconcileReadBatches(first.items, second.items)
  assert.equal(second.nextPage, null)
  assert.ok(!ids(merged).includes('msg-50')) // still in source, no subsequent page repairs the gap
  assert.ok(ids(merged).includes('msg-100')) // stale deleted record remains in local batches
})

test('Evolution POC: timestamp ties can repeat half the page and omit half despite local stable sort', async () => {
  const rows = history(100).map(r => ({ ...r, messageTimestamp: 1700000000 }))
  const source = syntheticSource(rows), api = client(source.transport)
  const first = await api.findMessages(PN)
  source.reorderTies()
  const second = await api.findMessages(PN, { page: 2 })
  assert.equal(reconcileReadBatches(first.items, second.items).length, 50)
  assert.deepEqual(ids(reconcileReadBatches(first.items, second.items)), ids(reconcileReadBatches(second.items, first.items)))
  assert.equal((await api.findMessages(PN, { page: 3 })).items.length, 0)
})

test('Evolution POC: count is advisory and late backfill is not a snapshot', async () => {
  const page = await client(response(envelope([syntheticMessage(1)], 1, 0))).findMessages(PN)
  assert.equal(page.reportedTotal, 0); assert.equal(page.items.length, 1)
  const source = syntheticSource(history(100)), api = client(source.transport)
  const first = await api.findMessages(PN)
  source.insert(syntheticMessage(101, { messageTimestamp: 1700000075 }))
  const second = await api.findMessages(PN, { page: 2 })
  assert.ok(!ids(reconcileReadBatches(first.items, second.items)).includes('msg-101'))
})

test('Evolution POC: PN/LID/remoteJidAlt preserved without identity inference; fromMe never implies app origin', async () => {
  const raw = syntheticMessage(1, { key: { id: 'opaque-msg', remoteJid: LID, remoteJidAlt: PN, fromMe: true } })
  const api = client(response(envelope([raw])))
  const message = (await api.findMessages(PN)).items[0]
  assert.equal(message.remoteJid, LID); assert.equal(message.remoteJidAlt, PN)
  assert.equal(message.origin, 'unknown'); assert.equal(message.fromMe, true)
  assert.equal((await api.findMessages(LID)).items[0].remoteJid, LID)
  const inbound = (await client(response(envelope([syntheticMessage(1)]))).findMessages(PN)).items[0]
  assert.equal(inbound.fromMe, false)
  // The same provider key under two distinct primary JIDs is NOT merged by phone inference.
  const pn = { ...message, remoteJid: PN, remoteJidAlt: null }
  assert.equal(reconcileReadBatches([message, pn]).length, 2)
})

test('Evolution POC: different instance/conversation is rejected, including partially valid pages', async () => {
  for (const row of [syntheticMessage(2, { instanceId: 'other-instance' }),
    syntheticMessage(2, { key: { id: 'other', remoteJid: OTHER, fromMe: false } })]) {
    await assert.rejects(client(response(envelope([syntheticMessage(1), row]))).findMessages(PN), errorCode('SCOPE'))
  }
})

test('Evolution POC: strict consumed-field validation; unsupported types do not fake support', async () => {
  const invalid = [null, {}, { messages: { total: '1', pages: 1, currentPage: 1, records: [] } },
    envelope([syntheticMessage(1, { key: { id: 'id', remoteJid: PN, fromMe: 'false' } })]),
    envelope([syntheticMessage(1, { messageTimestamp: 1.5 })]),
    envelope([syntheticMessage(1, { message: { conversation: 12 } })]),
    envelope([syntheticMessage(1, { MessageUpdate: [{ status: 'unrecognized' }] })]),
    envelope(history(51)), envelope([], 2)]
  for (const body of invalid) await assert.rejects(client(response(body)).findMessages(PN), errorCode('RESPONSE'))
  const unsupported = syntheticMessage(1, { messageType: 'futureMessage', message: { futureMessage: { secret: 'omit' } } })
  const m = (await client(response(envelope([unsupported]))).findMessages(PN)).items[0]
  assert.equal(m.kind, 'unsupported'); assert.equal(m.text, null); assert.equal(m.media, null)
  assert.ok(!JSON.stringify(m).includes('secret'))
  for (const badChats of [{}, [{ remoteJid: '12345@unknown' }], [{ remoteJid: 'not-a-valid-pn@s.whatsapp.net' }], [{ remoteJid: LID, updatedAt: 'invalid' }],
    [{ remoteJid: LID, unreadCount: -1 }], [{ remoteJid: LID }, { remoteJid: LID }]]) {
    await assert.rejects(client(response(badChats)).findChats(), EvolutionReadError)
  }
})

test('Evolution POC: status observations retained without fabricated chronology or delivery', async () => {
  const m = syntheticMessage(1, { MessageUpdate: [{ status: 'READ' }, { status: 'SERVER_ACK' }, { status: 'ERROR' }, { status: 'READ' }] })
  assert.deepEqual((await client(response(envelope([m]))).findMessages(PN)).items[0].statuses, ['ERROR', 'READ', 'SERVER_ACK'])
  const pending = syntheticMessage(1, { MessageUpdate: [] })
  assert.deepEqual((await client(response(envelope([pending]))).findMessages(PN)).items[0].statuses, [])
})

test('Evolution POC: four media formats project opaque metadata only; no retrieval or secrets', async () => {
  for (const [messageType, kind] of [['imageMessage', 'image'], ['audioMessage', 'audio'], ['videoMessage', 'video'], ['documentMessage', 'document']]) {
    const row = syntheticMessage(1, { messageType, message: { [messageType]: { mimetype: 'application/octet-stream', fileLength: 42,
      url: 'https://synthetic.invalid/private', mediaKey: 'synthetic-not-a-key', directPath: '/private', caption: 'omitted' } } })
    const source = syntheticSource([row])
    const m = (await client(source.transport).findMessages(PN)).items[0]
    assert.equal(m.kind, kind); assert.equal(m.media?.bytes, 42); assert.equal(m.media?.available, false)
    assert.ok(!/private|mediaKey|caption|https:/.test(JSON.stringify(m)))
    assert.equal(source.requests.length, 1)
  }
  const extended = syntheticMessage(1, { messageType: 'extendedTextMessage', message: { extendedTextMessage: { text: 'Synthetic extended' } } })
  assert.equal((await client(response(envelope([extended]))).findMessages(PN)).items[0].text, 'Synthetic extended')
})

test('Evolution POC: numeric-string protobuf media sizes and MIME parameters normalize without leaking metadata', async () => {
  const raw = syntheticMessage(3, {
    messageType: 'audioMessage',
    message: { audioMessage: {
      mimetype: 'audio/ogg; codecs=opus',
      fileLength: '12345',
      mediaKey: 'PRIVATE_FIXTURE_KEY',
      directPath: '/private',
    } },
  })
  const page = await client(response(envelope([raw]))).findMessages(PN)
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0]?.kind, 'audio')
  assert.equal(page.items[0]?.media?.mimeType, 'audio/ogg')
  assert.equal(page.items[0]?.media?.bytes, 12345)
  assert.equal(page.items[0]?.media?.available, false)
  assert.ok(!/PRIVATE_FIXTURE_KEY|private|codecs/.test(JSON.stringify(page.items)))
  const sizes = ['-1', '1.5', '01', '1e2', '9007199254740992', { low: 1, high: 0 }, true]
  for (const fileLength of sizes) {
    const item = (await client(response(envelope([syntheticMessage(5, {
      messageType: 'audioMessage', message: { audioMessage: { mimetype: 'audio/ogg', fileLength } },
    })]))).findMessages(PN)).items[0]
    assert.equal(item?.kind, 'audio')
    assert.equal(item?.media?.bytes, null)
    assert.equal(item?.media?.available, false)
  }
  for (const mimetype of ['audio/ogg; evil=<script>', 'audio/ogg; codecs=', 'bad', 'audio/ogg;\nsecret=x']) {
    const item = (await client(response(envelope([syntheticMessage(6, {
      messageType: 'audioMessage', message: { audioMessage: { mimetype } },
    })]))).findMessages(PN)).items[0]
    assert.equal(item?.kind, 'audio')
    assert.equal(item?.media?.mimeType, null)
    assert.equal(item?.media?.available, false)
    assert.ok(!JSON.stringify(item).includes('script'))
  }
})

test('Evolution POC: duplicate media rows use matched chosen-row opaque reference; changing media bytes fails closed', async () => {
  const a = syntheticMessage(10, { messageType: 'imageMessage',
    message: { imageMessage: { mimetype: 'image/jpeg', fileLength: '9' } } })
  const b = { ...a, id: 'row-11', MessageUpdate: [{ status: 'READ' }] }
  const forward = (await client(response(envelope([a,b]))).findMessages(PN)).items
  const reverse = (await client(response(envelope([b,a]))).findMessages(PN)).items
  assert.deepEqual(forward, reverse)
  assert.equal(forward.length, 1)
  assert.equal(forward[0]?.media?.reference, JSON.stringify([INSTANCE, 'row-10', 'imageMessage']))
  assert.deepEqual(forward[0]?.statuses, ['READ', 'SERVER_ACK'])
  const changed = { ...b, message: { imageMessage: { mimetype: 'image/jpeg', fileLength: '10' } } }
  await assert.rejects(client(response(envelope([a,changed]))).findMessages(PN), errorCode('CONFLICT'))
})

test('Evolution POC: exact duplicates collapse; changed content/status never silently overwrites', async () => {
  const m = syntheticMessage(1)
  const page = await client(response(envelope([m, m]))).findMessages(PN)
  assert.equal(page.items.length, 1)
  const changed = { ...page.items[0], text: 'different' }
  assert.throws(() => reconcileReadBatches(page.items, [changed]), errorCode('CONFLICT'))
  assert.deepEqual(reconcileReadBatches(page.items, [{ ...page.items[0], statuses: ['READ'] }])[0]?.statuses, ['READ', 'SERVER_ACK'])
  const withStatusAndRow = { ...page.items[0], recordId: 'provider-row-2', statuses: ['READ', 'SERVER_ACK'] }
  const forward = reconcileReadBatches(page.items, [withStatusAndRow])
  const reverse = reconcileReadBatches([withStatusAndRow], page.items)
  assert.deepEqual(forward, reverse)
  assert.equal(forward.length, 1)
  assert.deepEqual(forward[0]?.statuses, ['READ', 'SERVER_ACK'])
  assert.equal(forward[0]?.recordId, 'provider-row-2')
  // No cross-chat, cross-instance or content collapsing.
  assert.throws(() => reconcileReadBatches(page.items, [{ ...page.items[0], timestamp: page.items[0]!.timestamp + 1 }]), errorCode('CONFLICT'))
  assert.throws(() => reconcileReadBatches(page.items, [{ ...page.items[0], remoteJidAlt: PN }]), errorCode('CONFLICT'))
  assert.throws(() => reconcileReadBatches(page.items, [{ ...page.items[0], fromMe: !page.items[0]!.fromMe }]), errorCode('CONFLICT'))
})

test('Evolution POC: invalid input never invokes transport; no arbitrary query or path', async () => {
  let calls = 0
  const api = client(async () => { calls++; throw Error('must not call') })
  for (const value of ['123', 'group@g.us', 'https://synthetic.invalid', 'x@lid/../../', 'x@lid\n']) await assert.rejects(api.findMessages(value), errorCode('INPUT'))
  for (const page of [0, -1, 1.5, Infinity, 10001]) await assert.rejects(api.findMessages(PN, { page }), errorCode('INPUT'))
  await assert.rejects(api.findChats({ take: 101 }), errorCode('INPUT'))
  await assert.rejects(api.findChats({ skip: -1 }), errorCode('INPUT'))
  assert.throws(() => new EvolutionReadPoc({ instance: '../bad', instanceId: INSTANCE, transport: response([]) }), errorCode('INPUT'))
  assert.equal(calls, 0)
})

test('Evolution POC: HTTP/transport failures sanitized, no retries or provider echo', async () => {
  for (const status of [301, 401, 403, 404, 429, 500]) {
    let calls = 0
    await assert.rejects(client(async () => { calls++; return { status, body: { secret: 'must not echo' } } }).findChats(),
      error => error instanceof EvolutionReadError && error.code === 'HTTP' && error.httpStatus === status && !error.message.includes('echo'))
    assert.equal(calls, 1)
  }
  await assert.rejects(client(async () => { throw Error('secret-provider-url') }).findChats(), error =>
    error instanceof EvolutionReadError && error.code === 'TRANSPORT' && !JSON.stringify(error).includes('secret'))
})

test('Evolution POC: timeout/cancel bounds a transport ignoring signal; pre-abort skips it', async () => {
  let observed: AbortSignal | undefined
  const hanging: ReadTransport = request => { observed = request.signal; return new Promise(() => {}) }
  await assert.rejects(client(hanging, 5).findChats(), errorCode('TIMEOUT')); assert.equal(observed?.aborted, true)
  const controller = new AbortController()
  const pending = client(hanging).findChats({ signal: controller.signal })
  await Promise.resolve(); controller.abort()
  await assert.rejects(pending, errorCode('CANCELLED')); assert.equal(observed?.aborted, true)
  let calls = 0
  await assert.rejects(client(async () => { calls++; return { status: 200, body: [] } }).findChats({ signal: controller.signal }), errorCode('CANCELLED'))
  assert.equal(calls, 0)
})

test('V20 POC: N:N links, explicit context per chat, unlinked chat and no history change on atendimento switch', async () => {
  const model = new ConversationContextPoc([
    { conversationId: 'chat-a', instance: 'synthetic-offline', remoteJid: PN },
    { conversationId: 'chat-b', instance: 'synthetic-offline', remoteJid: LID },
    { conversationId: 'chat-free', instance: 'synthetic-offline', remoteJid: OTHER },
  ], ['att-a', 'att-b', 'att-without-chat'])
  const source = syntheticSource([...history(70), syntheticMessage(71, { key: { id: 'unlinked-msg', remoteJid: OTHER, fromMe: false } })]), api = client(source.transport)
  model.link('chat-a', 'att-a'); model.link('chat-a', 'att-b'); model.link('chat-b', 'att-a'); model.link('chat-a', 'att-a')
  assert.deepEqual(model.atendimentosFor('chat-a'), ['att-a', 'att-b'])
  assert.equal(model.conversationsFor('att-a').length, 2)
  assert.deepEqual(model.conversationsFor('att-without-chat'), [])
  model.selectConversation('chat-a'); model.selectAtendimento('att-a')
  const before = await api.findMessages(model.context().conversation!.remoteJid)
  model.selectAtendimento('att-b')
  const after = await api.findMessages(model.context().conversation!.remoteJid)
  assert.deepEqual(before, after); assert.deepEqual(source.requests[0].body, source.requests[1].body)
  model.selectConversation('chat-b'); assert.equal(model.context().atendimentoId, null)
  model.selectAtendimento('att-a'); model.selectConversation('chat-a'); assert.equal(model.context().atendimentoId, 'att-b')
  model.selectConversation('chat-free'); assert.equal(model.context().atendimentoId, null)
  assert.deepEqual(model.atendimentosFor('chat-free'), [])
  assert.deepEqual(ids((await api.findMessages(model.context().conversation!.remoteJid)).items), ['unlinked-msg'])
  assert.throws(() => model.selectAtendimento('att-a'))
  model.selectConversation('chat-a'); model.unlink('chat-a', 'att-b'); assert.equal(model.context().atendimentoId, null)
  assert.equal(model.conversationsFor('att-a').length, 2)
  assert.throws(() => model.link('chat-a', 'unknown'))
  assert.throws(() => model.selectConversation('unknown'))
  assert.equal(source.requests.length, 3) // context/link operations never query or mutate source
})


test('Evolution POC: chat labels are hints, not identity, with PN and LID distinct', async () => {
  const api = client(response([
    { remoteJid: PN, pushName: '  Cliente de Teste  ', updatedAt: null, unreadCount: null },
    { remoteJid: LID, pushName: '\u202Eidentidade falsa', updatedAt: null, unreadCount: null },
  ]))
  const rows = await api.findChats()
  assert.equal(rows[0]?.displayName, 'Cliente de Teste')
  assert.equal(rows[0]?.phoneNumber, PN.split('@')[0])
  assert.equal(rows[1]?.displayName, null)
  assert.equal(rows[1]?.phoneNumber, null)
  assert.notEqual(rows[0]?.remoteJid, rows[1]?.remoteJid)
  const raw = await client(response([{ remoteJid: LID, pushName: '  ', updatedAt: null, unreadCount: null }])).findChats()
  assert.equal(raw[0]?.displayName, null)
})

test('Evolution POC: mixed provider chats omit only recognized non-individual types and preserve sourceCount', async () => {
  const mixed = [
    { remoteJid: '120363000000000000@g.us', pushName: 'Synthetic private group', lastMessage: { text: 'GROUP SECRET' } },
    { remoteJid: PN, pushName: 'Pessoa PN' },
    { remoteJid: 'status@broadcast', pushName: 'Synthetic status', lastMessage: { text: 'STATUS SECRET' } },
    { remoteJid: '123456789@newsletter', pushName: 'Synthetic newsletter' },
    { remoteJid: LID, pushName: 'Pessoa LID' },
  ]
  const api = client(response(mixed))
  const page = await api.findChatsPage({ take: 5, skip: 10 })
  assert.equal(page.sourceCount, 5)
  assert.deepEqual(page.items.map(row => row.remoteJid), [PN, LID])
  assert.deepEqual((await api.findChats({ take: 5 })).map(row => row.remoteJid), [PN, LID])
  assert.ok(!JSON.stringify(page).includes('GROUP SECRET'))
  assert.ok(!JSON.stringify(page).includes('STATUS SECRET'))
  assert.ok(!JSON.stringify(page).includes('120363000000000000'))
  assert.deepEqual(await client(response([{ remoteJid: 'status@broadcast' }])).findChatsPage(),
    { items: [], sourceCount: 1 })
})

test('Evolution POC: 50 group rows do not hide an individual on the next source page', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ remoteJid: `1203630000${String(i).padStart(10,'0')}@g.us` }))
  rows.push({ remoteJid: PN })
  const calls: { take: unknown; skip: unknown }[] = []
  const api = client(async request => {
    calls.push(request.body as { take: unknown; skip: unknown })
    const take = Number(request.body.take), skip = Number(request.body.skip)
    return { status: 200, body: rows.slice(skip, skip + take) }
  })
  const first = await api.findChatsPage({ take: 50, skip: 0 })
  assert.equal(first.items.length, 0)
  assert.equal(first.sourceCount, 50)
  const second = await api.findChatsPage({ take: 50, skip: 50 })
  assert.deepEqual(second.items.map(row => row.remoteJid), [PN])
  assert.equal(second.sourceCount, 1)
  assert.deepEqual(calls, [{ take: 50, skip: 0 }, { take: 50, skip: 50 }])
})

test('Evolution POC: invalid or ambiguous PN/LID is never silently skipped', async () => {
  for (const remoteJid of [
    '123@unknown', 'this-is-not-valid@s.whatsapp.net', 'bad id@lid',
    'group@g.us/../', '123@broadcast/abc', '123@newsletter?secret=1',
  ]) {
    await assert.rejects(
      client(response([{ remoteJid: PN }, { remoteJid }])).findChatsPage({ take: 2 }),
      errorCode('RESPONSE'),
    )
  }
  const pages = [
    [{ remoteJid: PN }, { remoteJid: PN }],
    Array.from({ length: 51 }, (_, i) => ({ remoteJid: `${i + 10000000}@s.whatsapp.net` })),
  ]
  for (const page of pages) await assert.rejects(
    client(response(page)).findChatsPage({ take: 50 }), EvolutionReadError,
  )
})
