import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, symlinkSync, existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingestFixture, ingestPath, signedHeaders, syntheticEvent, syntheticKey } from './fixtures/chat-ingest.ts'
import { ingestKeys, loadIngestOptions } from '../chat/ingest-config.ts'
import { MAX_CHAT_EVENT_BYTES } from '../chat/events.ts'
import { openDatabase } from '../database.ts'
import { ChatRepository } from '../chat/repository.ts'

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
const count = (f: Awaited<ReturnType<typeof ingestFixture>>, table: string) => Number(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n)

test('ingest configuration requires explicit flag and private bounded regular file; invalid/duplicate keys fail closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'funix-ingest-config-')), file = join(directory, 'keys.json'), link = join(directory, 'link.json')
  try {
    const key = syntheticKey(), config = { version: 1, keys: [key] }
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 })
    assert.equal(loadIngestOptions({ FUNIX_OPERATOR_PASSWORD: 'synthetic-only', FUNIX_WHATSAPP_INGEST_CONFIG_FILE: file }), undefined)
    assert.equal(loadIngestOptions({ FUNIX_WHATSAPP_INGEST_ENABLED: 'TRUE', FUNIX_WHATSAPP_INGEST_CONFIG_FILE: file }), undefined)
    assert(ingestKeys(loadIngestOptions({ FUNIX_WHATSAPP_INGEST_ENABLED: 'true', FUNIX_WHATSAPP_INGEST_CONFIG_FILE: file })))
    chmodSync(file, 0o644)
    assert.equal(ingestKeys(loadIngestOptions({ FUNIX_WHATSAPP_INGEST_ENABLED: 'true', FUNIX_WHATSAPP_INGEST_CONFIG_FILE: file })), null)
    chmodSync(file, 0o600); symlinkSync(file, link)
    for (const path of [link, directory, join(directory, 'absent')]) assert.equal(ingestKeys(loadIngestOptions({ FUNIX_WHATSAPP_INGEST_ENABLED: 'true', FUNIX_WHATSAPP_INGEST_CONFIG_FILE: path })), null)
    for (const config of [null, {}, { version: 2, keys: [key] }, { version: 1, keys: [key, key] },
      { version: 1, keys: [{ ...key, instances: [] }] }, { version: 1, keys: [{ ...key, secretBase64: '' }] }]) assert.equal(ingestKeys({ enabled: true, config }), null)
    writeFileSync(file, ' '.repeat(17 * 1024))
    assert.equal(ingestKeys(loadIngestOptions({ FUNIX_WHATSAPP_INGEST_ENABLED: 'true', FUNIX_WHATSAPP_INGEST_CONFIG_FILE: file })), null)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('disabled/configuration missing hides every method even with operator cookie; whitelist and explicit registration are independent gates', async () => {
  for (const options of [{ enabled: false, register: false }, { config: null, register: false }]) {
    const f = await ingestFixture(options)
    try {
      for (const method of ['GET', 'POST', 'OPTIONS']) {
        const response = await fetch(f.base + ingestPath, { method, headers: { Cookie: 'funix_session=synthetic', Origin: 'https://synthetic.invalid' } })
        assert.equal(response.status, 404)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.equal(response.headers.get('access-control-allow-origin'), null)
        assert.equal(response.headers.get('location'), null)
      }
      assert.equal(count(f, 'chat_instances'), 0); assert.equal(count(f, 'chat_events'), 0)
      assert.equal((await (await fetch(f.base + '/api/health')).json()).capabilities.messages, false)
    } finally { await f.close() }
  }
  const f = await ingestFixture({ register: false })
  try {
    assert.equal((await f.post()).status, 403)
    assert.equal(count(f, 'chat_instances'), 0); assert.equal(count(f, 'chat_conversations'), 0)
    f.chat.registerInstance('other-synthetic', '2026-11-05T12:00:00.000Z')
    const unauthorized = bytes({ ...syntheticEvent(), instance: 'other-synthetic' })
    assert.equal((await f.post(unauthorized)).status, 403)
    assert.equal(count(f, 'chat_events'), 0)
  } finally { await f.close() }
})

test('raw HMAC precedes parsing: missing/unknown/tampered/old/future signatures never touch SQLite; no CORS or redirects', async () => {
  const f = await ingestFixture()
  try {
    const raw = bytes(syntheticEvent()), valid = f.headers(raw), seconds = Number(valid['X-Funix-Timestamp'])
    const cases = [{}, { ...valid, 'X-Funix-Key-Id': 'unknown-key' }, { ...valid, 'X-Funix-Signature': 'sha256=' + 'a'.repeat(64) },
      f.headers(raw, f.keys[0], seconds - 301), f.headers(raw, f.keys[0], seconds + 301),
      { ...valid, 'X-Funix-Timestamp': 'not-a-time' }, { ...valid, 'X-Funix-Signature': valid['X-Funix-Signature'].replace('sha256=', 'bad=') }]
    for (const headers of cases) assert.equal((await f.post(raw, { 'Content-Type': 'application/json', ...headers })).status, 401)
    assert.equal((await f.post(Buffer.concat([raw, Buffer.from(' ')]), valid)).status, 401)
    assert.equal((await f.post(Buffer.from('not JSON'), valid)).status, 401)
    assert.equal(count(f, 'chat_events'), 0)
    const cors = await f.post(raw, { ...valid, Origin: 'https://synthetic.invalid' })
    assert.equal(cors.status, 403); assert.equal(cors.headers.get('access-control-allow-origin'), null); assert.equal(cors.headers.get('location'), null)
    assert.equal((await f.post(raw, { ...valid, 'Sec-Fetch-Site': 'same-origin' })).status, 403)
    assert.equal((await fetch(f.base + ingestPath + '?synthetic=1', { method: 'POST' })).status, 400)
    assert.equal((await fetch(f.base + ingestPath)).status, 405)
    assert.equal(count(f, 'chat_events'), 0)
  } finally { await f.close() }
})

test('valid retries use raw-byte signatures and canonical event digest, stable receipts, controlled conflicts and safe aggregate telemetry', async () => {
  let asynchronous = false
  const metrics: unknown[] = [], f = await ingestFixture({ telemetry: metric => { metrics.push(metric); if (asynchronous) return Promise.reject(Error('synthetic monitoring failure')); throw Error('synthetic monitoring failure') } })
  try {
    const raw = bytes(syntheticEvent()), first = await f.post(raw), receipt = await first.json()
    assert.equal(first.status, 202); assert.equal(receipt.state, 'persisted'); assert.equal(receipt.disposition, 'pending')
    assert.deepEqual(Object.keys(receipt).sort(), ['disposition', 'receiptId', 'state'])
    assert(!JSON.stringify(receipt).includes('PRIVADO'))
    assert.deepEqual(await (await f.post(raw)).json(), receipt)
    f.advance(1000)
    assert.deepEqual(await (await f.post(Buffer.from(JSON.stringify(syntheticEvent(), null, 2)))).json(), receipt)
    asynchronous = true
    assert.deepEqual(await (await f.post(raw)).json(), receipt)
    const conflict = await f.post(bytes({ ...syntheticEvent(), message: { ...syntheticEvent().message, text: 'Outro texto sintético' } }))
    assert.equal(conflict.status, 409)
    assert.equal(count(f, 'chat_events'), 1); assert.equal(count(f, 'chat_messages'), 1)
    assert.equal(count(f, 'atendimentos'), 0); assert.equal(count(f, 'chat_links'), 0)
    assert(metrics.every(m => Object.keys(m as object).sort().join(',') === 'elapsedMs,outcome,status'))
    assert(!JSON.stringify(metrics).includes('synthetic'))
  } finally { await f.close() }
})

test('rotation accepts current/previous keys with independent scopes; removing a key after restart revokes it and retains receipts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'funix-ingest-rotation-')), filename = join(directory, 'synthetic.sqlite')
  const current = syntheticKey(), previous = syntheticKey('synthetic-previous')
  let f = await ingestFixture({ filename, keys: [current, previous] })
  try {
    const raw = bytes(syntheticEvent()), receipt = await (await f.post(raw, signedHeaders(raw, previous))).json()
    assert.deepEqual(await (await f.post(raw, signedHeaders(raw, current))).json(), receipt)
    await f.close(); f = await ingestFixture({ filename, keys: [current], register: false })
    assert.equal((await f.post(raw, signedHeaders(raw, previous))).status, 401)
    assert.deepEqual(await (await f.post(raw, signedHeaders(raw, current))).json(), receipt)
    assert.equal(count(f, 'chat_events'), 1)
  } finally { await f.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('strict content type, encoding, byte limits, UTF-8 and normalized schema reject invalid bodies after authentication', async () => {
  const f = await ingestFixture()
  try {
    const raw = bytes(syntheticEvent()), valid = f.headers(raw)
    for (const type of ['text/plain', 'application/json; charset=latin1', 'application/json; extra=true', 'application/jsonx']) assert.equal((await f.post(raw, { ...valid, 'Content-Type': type })).status, 415)
    assert.equal((await f.post(raw, { ...valid, 'Content-Encoding': 'gzip' })).status, 415)
    for (const raw of [Buffer.from('not JSON'), Buffer.from([0xff]), bytes({ ...syntheticEvent(), schemaVersion: 2 }), bytes({ ...syntheticEvent(), telefone: 'synthetic' })]) assert.equal((await f.post(raw)).status, 422)
    assert.equal((await f.post(Buffer.alloc(MAX_CHAT_EVENT_BYTES + 1, 0x20))).status, 413)
    const chunked = Buffer.alloc(MAX_CHAT_EVENT_BYTES + 1, 0x20)
    const result = await new Promise<number>((resolve, reject) => {
      const req = request(f.base + ingestPath, { method: 'POST', headers: f.headers(chunked) }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
      req.on('error', reject); req.write(chunked); req.end()
    })
    assert.equal(result, 413); assert.equal(count(f, 'chat_events'), 0)
  } finally { await f.close() }
})

test('status before upsert, external fromMe, media, LID/groups and candidate/multiple Atendimentos never create links or ERP writes', async () => {
  const f = await ingestFixture()
  try {
    // Existing ambiguous contact context is deliberately not an authority.
    const { AtendimentoRepository } = await import('../atendimentos.ts')
    const atendimentos = new AtendimentoRepository(f.db)
    const a = atendimentos.create({ phone: '000000000' }); atendimentos.create({ phone: '000000000' })
    const status = { schemaVersion: 1, instance: 'synthetic-ingest', eventId: 'status-read', occurredAt: syntheticEvent().occurredAt, type: 'message.status',
      message: { remoteJid: 'synthetic@lid', messageId: 'synthetic-event', status: 'read' } }
    assert.equal((await f.post(bytes(status))).status, 202); assert.equal(count(f, 'chat_messages'), 0)
    assert.equal((await f.post()).status, 202)
    assert.equal(f.db.prepare('SELECT status FROM chat_statuses').get()!.status, 'read')
    for (const [id, patch] of [['outbound', { fromMe: true }], ['candidate', { text: 'Candidato sintético / Não gerar lead' }], ['photo', { kind: 'image', text: null, media: { ref: 'opaque-synthetic', mime: 'image/png', bytes: 12 } }]] as const) {
      assert.equal((await f.post(bytes({ ...syntheticEvent(id), message: { ...syntheticEvent(id).message, ...patch } }))).status, 202)
    }
    for (const [id, jid] of [['group', 'group@g.us'], ['broadcast', 'status@broadcast'], ['missing', null]]) {
      const response = await f.post(bytes({ ...syntheticEvent(id!), message: { ...syntheticEvent(id!).message, remoteJid: jid } }))
      assert.equal(response.status, 202); assert.equal((await response.json()).disposition, 'quarantined')
    }
    assert.equal(count(f, 'chat_links'), 0); assert.equal(count(f, 'atendimentos'), 2)
    assert.deepEqual(f.chat.messages(a.id).items, [])
  } finally { await f.close() }
})

test('no ACK before full body or after a failed commit; retry succeeds without partial projection', async () => {
  const f = await ingestFixture()
  try {
    const raw = bytes(syntheticEvent())
    let received = false
    const done = new Promise<number>((resolve, reject) => {
      const req = request(f.base + ingestPath, { method: 'POST', headers: f.headers(raw) }, res => { received = true; res.resume(); res.on('end', () => resolve(res.statusCode!)) })
      req.on('error', reject); req.write(raw.subarray(0, 20))
      setTimeout(() => {
        try { assert.equal(received, false); assert.equal(count(f, 'chat_events'), 0); req.end(raw.subarray(20)) }
        catch (cause) { req.destroy(); reject(cause) }
      }, 30)
    })
    assert.equal(await done, 202)
    f.db.exec("CREATE TRIGGER synthetic_ingest_failure BEFORE INSERT ON chat_events BEGIN SELECT RAISE(ABORT,'synthetic failure');END")
    const next = bytes(syntheticEvent('next'))
    const failure = await f.post(next)
    assert.equal(failure.status, 503); assert(!(await failure.text()).includes('synthetic failure'))
    assert.equal(count(f, 'chat_events'), 1); assert.equal(count(f, 'chat_messages'), 1)
    f.db.exec('DROP TRIGGER synthetic_ingest_failure')
    assert.equal((await f.post(next)).status, 202); assert.equal(count(f, 'chat_messages'), 2)
  } finally { await f.close() }
})

test('request rate is bounded and resets; partial body times out without ACK or persistent effects', async () => {
  const f = await ingestFixture()
  try {
    for (let index = 0; index < 120; index++) assert.equal((await f.post(Buffer.from('{}'), { 'Content-Type': 'application/json' })).status, 401)
    const limited = await f.post(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60')
    f.advance(60_000)
    const raw = bytes(syntheticEvent())
    const timedOut = await new Promise<number>((resolve, reject) => {
      const req = request(f.base + ingestPath, { method: 'POST', headers: f.headers(raw) }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
      req.on('error', reject); req.write(raw.subarray(0, 20))
    })
    assert.equal(timedOut, 408); assert.equal(count(f, 'chat_events'), 0)
  } finally { await f.close() }
})

test('operator cookie cannot replace HMAC, duplicate auth headers fail, timestamps are rechecked after upload and concurrent bodies are bounded', async () => {
  const f = await ingestFixture()
  const held: ReturnType<typeof request>[] = [], responses: Promise<number>[] = []
  try {
    const login = await fetch(f.base + '/api/session', { method: 'POST', headers: { Origin: 'http://127.0.0.1', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: f.operatorPassword }) })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    assert.equal((await f.post(bytes(syntheticEvent()), { Cookie: cookie, 'Content-Type': 'application/json' })).status, 401)
    const raw = bytes(syntheticEvent()), headers = f.headers(raw)
    const duplicate = await new Promise<number>((resolve, reject) => {
      const flat = Object.entries(headers).flat()
      const req = request(f.base + ingestPath, { method: 'POST', headers: ['Host', new URL(f.base).host, ...flat, 'X-Funix-Key-Id', f.keys[0]!.keyId] }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
      req.on('error', reject); req.end(raw)
    })
    assert.equal(duplicate, 401)
    const expired = new Promise<number>((resolve, reject) => {
      const req = request(f.base + ingestPath, { method: 'POST', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
      req.on('error', reject); req.write(raw.subarray(0, 1))
      setTimeout(() => { f.advance(301_000); req.end(raw.subarray(1)) }, 30)
    })
    assert.equal(await expired, 401)
    for (let index = 0; index < 4; index++) responses.push(new Promise<number>((resolve, reject) => {
      const req = request(f.base + ingestPath, { method: 'POST', headers: f.headers(raw) }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
      req.on('error', reject); held.push(req); req.write(raw.subarray(0, 1))
    }))
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal((await f.post(raw)).status, 429)
    for (const req of held) req.end(raw.subarray(1))
    assert.deepEqual(await Promise.all(responses), [202, 202, 202, 202])
    assert.equal(count(f, 'chat_events'), 1)
  } finally { held.forEach(req => req.destroy()); await Promise.allSettled(responses); await f.close() }
})

test('two independent HTTP processes commit one receipt; a restarted process replays the same receipt with no registration or link side effects', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'funix-ingest-processes-')), database = join(directory, 'synthetic.sqlite'), config = join(directory, 'keys.json')
  const key = syntheticKey(), children: ChildProcess[] = []
  writeFileSync(config, JSON.stringify({ version: 1, keys: [key] }), { mode: 0o600 })
  const db = openDatabase(database)
  new ChatRepository(db).registerInstance('synthetic-ingest', '2026-11-05T12:00:00.000Z'); db.close()
  const start = async (name: string) => {
    const ready = join(directory, name + '.json')
    const child = spawn(process.execPath, [new URL('./fixtures/chat-ingest-worker.ts', import.meta.url).pathname, database, config, ready], { stdio: 'ignore' })
    children.push(child)
    const until = Date.now() + 10_000
    while (!existsSync(ready)) {
      if (child.exitCode !== null || Date.now() > until) throw Error('Synthetic ingestion worker did not start')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return { child, url: `http://127.0.0.1:${JSON.parse(readFileSync(ready, 'utf8')).port}${ingestPath}` }
  }
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
      child.once('exit', () => { clearTimeout(timer); resolve() }); child.kill('SIGTERM')
    })
  }
  try {
    const [a, b] = await Promise.all([start('a'), start('b')]), raw = bytes(syntheticEvent())
    const responses = await Promise.all([a, b].map(worker => fetch(worker.url, { method: 'POST', headers: signedHeaders(raw, key), body: new Uint8Array(raw) })))
    assert(responses.every(response => response.status === 202))
    const receipts = await Promise.all(responses.map(response => response.json()))
    assert.deepEqual(receipts[0], receipts[1])
    await Promise.all([stop(a.child), stop(b.child)])
    const restarted = await start('restart')
    const replay = await fetch(restarted.url, { method: 'POST', headers: signedHeaders(raw, key), body: new Uint8Array(raw) })
    assert.equal(replay.status, 202); assert.deepEqual(await replay.json(), receipts[0])
    await stop(restarted.child)
    const recovered = openDatabase(database)
    try {
      for (const [table, expected] of [['chat_events', 1], ['chat_messages', 1], ['chat_instances', 1], ['chat_links', 0], ['atendimentos', 0]] as const) assert.equal(Number(recovered.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n), expected)
      assert.equal(recovered.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
    } finally { recovered.close() }
  } finally { await Promise.all(children.map(stop)); rmSync(directory, { recursive: true, force: true }) }
})
