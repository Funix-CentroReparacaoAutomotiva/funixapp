// Opt-in runner inside the disposable Evolution container. Never bootstrap/import in FunixApp.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { EvolutionReadPoc, reconcileReadBatches } from '/poc/client.ts'

const require = createRequire('/evolution/package.json')
const { Client } = require('pg')
const uri = new URL(process.env.DATABASE_CONNECTION_URI)
assert.equal(uri.hostname, 'postgres'); assert.equal(uri.pathname, '/evolution_lab')
assert.equal(process.env.DATABASE_CONNECTION_CLIENT_NAME, 'synthetic_contract_lab')
assert.equal(JSON.parse(await readFile('/evolution/package.json', 'utf8')).version, '2.3.7')
const db = new Client({ connectionString: uri.toString(), statement_timeout: 5000 })
const PN = '000000000001@s.whatsapp.net', LID = 'synthetic-lab@lid', OTHER = 'synthetic-other@lid'
const NAME = 'synthetic-contract-lab', SECOND = 'synthetic-second-lab'
const observations = { checks: [], probes: {}, measurements: [], recovery: false,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch } }
const key = process.env.AUTHENTICATION_API_KEY
assert.ok(key && /^[a-f0-9]{64}$/.test(key))

async function request(path, body, authorized = true, method = 'POST', signal) {
  // Closed allowlist: cannot call QR/connect/send/delete/provider/media endpoints.
  assert.ok(/^\/chat\/(findChats|findMessages)\/synthetic-[a-z-]+$/.test(path) || path === '/instance/create' || path === '/')
  const response = await fetch('http://127.0.0.1:8080' + path, {
    method, redirect: 'error', signal: signal ?? AbortSignal.timeout(8000),
    headers: { 'content-type': 'application/json', ...(authorized ? { apikey: key } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    assert.ok(size <= 2 * 1024 * 1024, 'Laboratory response bound exceeded')
    chunks.push(chunk)
  }
  let payload
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { payload = null }
  return { status: response.status, body: payload }
}
async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await request('/', undefined, true, 'GET')).status === 200) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw Error('Local Evolution not ready')
}
async function check(name, execute) {
  try { await execute(); observations.checks.push({ name, result: 'passed' }) }
  catch { observations.checks.push({ name, result: 'failed' }); throw Error('Laboratory assertion failed: ' + name) }
}
const query = (jid = PN, page = 1, extra = {}) => ({ where: { key: { remoteJid: jid, remoteJidAlt: jid } }, page, offset: 50, ...extra })
async function rawMessages(body = query(), name = NAME) {
  const result = await request('/chat/findMessages/' + name, body)
  assert.equal(result.status, 200)
  assert.ok(Array.isArray(result.body?.messages?.records))
  return result.body.messages
}
function adapter(instanceId, instance = NAME) {
  return new EvolutionReadPoc({ instance, instanceId, transport: r => request(r.path, r.body, true, r.method, r.signal) })
}
async function create(name) {
  const result = await request('/instance/create', { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: false })
  assert.equal(result.status, 201)
  assert.equal(result.body.instance.instanceName, name)
  assert.ok(!result.body.qrcode)
  return result.body.instance.instanceId // generated hash/token deliberately not retained
}
async function insert(instanceId, n, jid = PN, timestamp = 1700000000 + n, type = 'conversation', content) {
  const id = `${instanceId}-row-${n}`
  const messageKey = { id: `synthetic-message-${n}`, remoteJid: jid, fromMe: n % 2 === 0,
    ...(jid === LID ? { remoteJidAlt: PN } : {}) }
  const payload = content ?? { conversation: `Synthetic message ${n}` }
  await db.query('INSERT INTO "Message" (id,key,"messageType",message,source,"messageTimestamp","instanceId") VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, messageKey, type, payload, 'unknown', timestamp, instanceId])
  return id
}
async function seed(instanceId) {
  // Use the schema created by the image's migrations; never create a guessed schema.
  const columns = await db.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' ORDER BY ordinal_position")
  for (const name of ['id', 'key', 'messageTimestamp', 'instanceId', 'messageType', 'message']) assert.ok(columns.rows.some(c => c.column_name === name))
  observations.columns = columns.rows
  await db.query('BEGIN')
  try {
    for (let i = 1; i <= 123; i++) await insert(instanceId, i)
    await db.query('INSERT INTO "Chat" (id,"remoteJid","instanceId",name) VALUES ($1,$2,$3,$4)', ['synthetic-chat', PN, instanceId, 'Synthetic chat'])
    const id = `${instanceId}-row-123`
    for (const status of ['READ', 'ERROR', 'SERVER_ACK']) await db.query('INSERT INTO "MessageUpdate" (id,"keyId","remoteJid","fromMe",status,"messageId","instanceId") VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['synthetic-status-' + status, 'synthetic-message-123', PN, false, status, id, instanceId])
    await db.query('COMMIT')
  } catch (error) { await db.query('ROLLBACK'); throw error }
}
async function catalogAndMeasure(instanceId) {
  observations.indexes = (await db.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('Message','Chat','MessageUpdate') ORDER BY tablename,indexname")).rows
  observations.constraints = (await db.query("SELECT c.relname AS table_name,con.contype,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('Message','Chat','MessageUpdate') ORDER BY c.relname,con.contype")).rows
  // Explain/analyze ONLY this new local lab database, with fixed statement timeout.
  observations.plan = (await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM "Message" WHERE "instanceId"=$1 AND (key->>\'remoteJid\'=$2 OR key->>\'remoteJidAlt\'=$2) ORDER BY "messageTimestamp" DESC LIMIT 50', [instanceId, PN])).rows
  // Moderate invented history, no index changes or benchmark claim about production.
  await db.query('BEGIN')
  try {
    for (let i = 1000; i < 2000; i++) await insert(instanceId, i, OTHER)
    await db.query('COMMIT')
  } catch (error) { await db.query('ROLLBACK'); throw error }
  for (const [operation, body, path] of [
    ['messages-first', query(), '/chat/findMessages/' + NAME],
    ['messages-deeper', query(OTHER, 15), '/chat/findMessages/' + NAME],
    ['chats', { take: 50, skip: 0 }, '/chat/findChats/' + NAME],
  ]) {
    const timings = []
    for (let i = 0; i < 3; i++) assert.equal((await request(path, body)).status, 200)
    // Two workers, 20 samples total. Do not launch unbounded traffic.
    await Promise.all([0, 1].map(async () => {
      for (let i = 0; i < 10; i++) {
        const start = performance.now(); const r = await request(path, body)
        assert.equal(r.status, 200); timings.push(performance.now() - start)
      }
    }))
    timings.sort((a, b) => a - b)
    observations.measurements.push({ operation, samples: 20, warmup: 3, concurrency: 2,
      p50Ms: timings[Math.ceil(timings.length * .50) - 1], p95Ms: timings[Math.ceil(timings.length * .95) - 1] })
  }
}

async function exercise() {
  const instanceId = await create(NAME), secondId = await create(SECOND)
  await seed(instanceId); await insert(secondId, 999)
  const api = adapter(instanceId)
  await check('latest 50 and earlier static history through unchanged POC', async () => {
    const first = await api.findMessages(PN), second = await api.findMessages(PN, { page: 2 }), third = await api.findMessages(PN, { page: 3 })
    assert.equal(first.items.length, 50); assert.equal(first.items[0].messageId, 'synthetic-message-74')
    assert.equal(first.items.at(-1).messageId, 'synthetic-message-123')
    assert.equal(reconcileReadBatches(first.items, second.items, third.items).length, 123)
    assert.ok(first.items.some(m => m.fromMe) && first.items.some(m => !m.fromMe))
    assert.deepEqual(first.items.at(-1).statuses, ['ERROR', 'READ', 'SERVER_ACK'])
  })
  await check('findChats take/skip and GET mismatch', async () => {
    assert.equal((await api.findChats()).length, 1)
    assert.equal((await api.findChats({ skip: 1 })).length, 0)
    observations.probes.findChatsGet = (await request('/chat/findChats/' + NAME, undefined, true, 'GET')).status
    assert.notEqual(observations.probes.findChatsGet, 200)
  })
  await check('raw offset, truthiness fromMe, validation and instance isolation', async () => {
    assert.equal((await rawMessages({ where: { key: { remoteJid: PN, remoteJidAlt: PN, fromMe: false } }, page: 1, offset: 50 })).records.some(m => m.key.fromMe), true)
    assert.equal((await rawMessages({ where: { key: { remoteJid: PN, remoteJidAlt: PN, fromMe: true } }, page: 1, offset: 50 })).records.every(m => m.key.fromMe), true)
    assert.equal((await adapter(secondId, SECOND).findMessages(PN)).items.length, 1)
    observations.probes.unauthorized = (await request('/chat/findMessages/' + NAME, query(), false)).status
    assert.ok([401, 403].includes(observations.probes.unauthorized))
    observations.probes.missing = (await request('/chat/findMessages/synthetic-missing', query())).status
    assert.equal(observations.probes.missing, 404)
    observations.probes.invalidType = (await request('/chat/findMessages/' + NAME, { limit: 'invalid' })).status
    assert.equal(observations.probes.invalidType, 400)
    // Document implementation behavior; do not promise these unsafe inputs are bounded remotely.
    for (const [name, body] of [['zeroOffset', query(PN, 1, { offset: 0 })], ['negativeOffset', query(PN, 1, { offset: -1 })], ['sortAsc', query(PN, 1, { sort: 'asc' })]]) {
      const r = await request('/chat/findMessages/' + NAME, body)
      observations.probes[name] = { status: r.status, records: r.body?.messages?.records?.length ?? null }
    }
  })
  await check('insertion while paginating shows offset overlap', async () => {
    const first = await api.findMessages(PN)
    await Promise.all([insert(instanceId, 124), insert(instanceId, 125)])
    const next = await api.findMessages(PN, { page: 2 })
    assert.equal(first.items.filter(m => next.items.some(n => n.messageId === m.messageId)).length, 2)
    observations.probes.concurrentInsertionOverlap = 2
    await db.query('DELETE FROM "Message" WHERE "instanceId"=$1 AND id=ANY($2::text[])', [instanceId, [`${instanceId}-row-124`, `${instanceId}-row-125`]])
  })
  await check('deletion and backfill can escape loaded pages', async () => {
    const first = await api.findMessages(PN)
    await db.query('DELETE FROM "Message" WHERE id=$1', [`${instanceId}-row-123`])
    await insert(instanceId, 126, PN, 1700000100)
    const all = reconcileReadBatches(first.items, (await api.findMessages(PN, { page: 2 })).items, (await api.findMessages(PN, { page: 3 })).items)
    assert.ok(!all.some(m => m.messageId === 'synthetic-message-126'))
  })
  await check('equal timestamps have no secondary cursor', async () => {
    for (let n = 200; n < 260; n++) await insert(instanceId, n, 'synthetic-ties@lid', 1700000000)
    const first = await rawMessages(query('synthetic-ties@lid'))
    const second = await rawMessages(query('synthetic-ties@lid', 2))
    observations.probes.ties = { uniqueReceived: new Set([...first.records, ...second.records].map(r => r.id)).size,
      repeatedFirstPageStable: JSON.stringify(first.records.map(r => r.id)) === JSON.stringify((await rawMessages(query('synthetic-ties@lid'))).records.map(r => r.id)) }
    // Stability in one execution is evidence only for this run, not a guarantee.
  })
  await check('LID/PN alternate and opaque media projection', async () => {
    await insert(instanceId, 300, LID)
    for (const [i, type] of ['imageMessage', 'audioMessage', 'videoMessage', 'documentMessage'].entries()) {
      await insert(instanceId, 301 + i, LID, 1700000400 + i, type, { [type]: { mimetype: 'application/octet-stream', fileLength: 42,
        url: 'https://synthetic.invalid/not-fetched', mediaKey: 'synthetic-only', directPath: '/not-fetched' } })
    }
    const lid = await api.findMessages(LID)
    assert.equal(lid.items.length, 5)
    assert.ok(lid.items.every(m => m.remoteJid === LID && m.remoteJidAlt === PN))
    assert.equal(lid.items.filter(m => m.media?.available === false).length, 4)
    assert.ok(!JSON.stringify(lid).includes('synthetic.invalid'))
    const alternate = await api.findMessages(PN)
    assert.ok(alternate.items.some(m => m.remoteJid === LID))
  })
  await catalogAndMeasure(instanceId)
  observations.beforeRestartCount = Number((await db.query('SELECT count(*) AS n FROM "Message"')).rows[0].n)
  await writeFile('/results/recovery-baseline.json', JSON.stringify({ instanceId, secondId, count: observations.beforeRestartCount }))
}
try {
  await ready()
  if (process.argv[2] === 'outage') {
    // Host harness stopped ONLY this project's PostgreSQL. Timeout is a valid observed limit.
    try {
      const r = await request('/chat/findMessages/' + NAME, query())
      observations.probes.databaseUnavailable = { status: r.status }
      assert.ok(r.status >= 500)
    } catch (error) {
      if (!['TimeoutError', 'AbortError'].includes(error.name)) throw error
      observations.probes.databaseUnavailable = { timeout: true }
    }
  } else {
    await db.connect()
    observations.runtime.postgresql = (await db.query('SHOW server_version')).rows[0].server_version
  }
  if (process.argv[2] === 'exercise') await exercise()
  else if (process.argv[2] === 'recovery') {
    const baseline = JSON.parse(await readFile('/results/recovery-baseline.json', 'utf8'))
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM "Message"')).rows[0].n), baseline.count)
    assert.ok((await adapter(baseline.instanceId).findMessages(PN)).items.length)
    assert.equal((await db.query('SELECT count(*) AS n FROM "Session"')).rows[0].n, '0')
    observations.recovery = true
  } else if (process.argv[2] !== 'outage') throw Error('Unknown laboratory phase')
  await writeFile('/results/' + process.argv[2] + '.json', JSON.stringify(observations, null, 2))
} catch {
  await writeFile('/results/failure.json', JSON.stringify({ phase: process.argv[2], checks: observations.checks, failed: true }))
  process.exitCode = 1 // no raw DB/HTTP exceptions or even lab credentials in logs
} finally { await db.end().catch(() => {}) }
