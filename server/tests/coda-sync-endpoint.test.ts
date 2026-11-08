import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createRequestHandler } from '../app.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../chat/coda-sync.ts'
import { parseCodaSyncSecret } from '../chat/coda-sync-endpoint.ts'

const secret = Buffer.alloc(32, 7)
const time = 1794144000000
const timestamp = String(time / 1000)
const body = { version:1, source:'coda', eventId:'evo:synthetic:one',
  codaRowId:'i-SYNTH_A', instance:'funix_comercial',
  remoteJid:'5531999990001@s.whatsapp.net',
  phoneE164:'+5531999990001', displayName:'Teste sem cliente real',
  occurredAt:1794144000 }

function harness() {
  const db = openDatabase(':memory:')
  const at = new AtendimentoRepository(db)
  createCodaEventSchema(db)
  const handler = createRequestHandler({
    atendimentos: at, password:'synthetic-strong-operator-password', origin:'http://localhost:5173',
    now: () => time, codaSync: { repo:new CodaEventSyncRepository(db), secret }, voiceProvider:null,
  })
  async function request(payload: unknown, override?: {
    signature?: string; time?: string; method?: string; origin?: string; raw?: string; path?: string
  }) {
    const data = override?.raw ?? JSON.stringify(payload)
    const stamp = override?.time ?? timestamp
    const sig = override?.signature ?? 'sha256=' + createHmac('sha256',secret)
      .update('coda-sync-v1\n' + stamp + '\n').update(data).digest('hex')
    const headers: Record<string,string> = {
      'content-type':'application/json', 'content-length':String(Buffer.byteLength(data)),
      'x-funix-timestamp':stamp, 'x-funix-signature':sig,
    }
    if (override?.origin) headers.origin=override.origin
    const req = Object.assign(Readable.from([Buffer.from(data)]), {
      method:override?.method ?? 'POST', url:override?.path ?? '/api/integrations/coda/atendimentos',
      headers, socket: { remoteAddress:'127.0.0.1' },
      rawHeaders: Object.entries(headers).flat(),
    }) as unknown as IncomingMessage
    const responseHeaders = new Headers()
    let status=200,output=''
    const res={
      setHeader(name:string,value:string){responseHeaders.set(name,value)},
      writeHead(value:number){status=value}, end(value:string){output=value},
    } as unknown as ServerResponse
    await handler(req,res)
    return { status, value: JSON.parse(output), headers:responseHeaders }
  }
  return { db, at, request }
}

test('server-only opt-in Coda event is accepted once with signature, replay is idempotent', async () => {
  const f = harness()
  try {
    const first = await f.request(body)
    assert.equal(first.status, 202)
    assert.equal(first.value.state, 'created')
    const second = await f.request(body)
    assert.equal(second.status, 202)
    assert.equal(second.value.state, 'existing')
    assert.equal(second.value.atendimentoId, first.value.atendimentoId)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM atendimentos').get()!.n),1)
    assert.equal(first.headers.get('cache-control'),'no-store')
  } finally { f.db.close() }
})

test('tamper, stale timestamp, browser origin, wrong method, unknown JID and conflicting receipt fail closed', async () => {
  const f = harness()
  try {
    assert.equal((await f.request(body,{signature:'sha256='+ '0'.repeat(64)})).status,401)
    assert.equal((await f.request(body,{time:'1600000000'})).status,401)
    assert.equal((await f.request(body,{origin:'https://malicious.invalid'})).status,403)
    assert.equal((await f.request(body,{method:'GET'})).status,405)
    assert.equal((await f.request({...body,remoteJid:'spoof@g.us'})).status,422)
    assert.equal((await f.request(body)).status,202)
    assert.equal((await f.request({...body,codaRowId:'i-OTHER_ROW'})).status,409)
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM atendimentos').get()!.n),1)
  } finally { f.db.close() }
})

test('disabled production secret requires exact flag and independent valid HMAC key', () => {
  assert.equal(parseCodaSyncSecret({FUNIX_CODA_SYNC_ENABLED:'false',FUNIX_CODA_SYNC_HMAC_KEY_BASE64:'invalid'}),null)
  assert.equal(parseCodaSyncSecret({}),null)
  assert.deepEqual(parseCodaSyncSecret({FUNIX_CODA_SYNC_ENABLED:'true',FUNIX_CODA_SYNC_HMAC_KEY_BASE64:secret.toString('base64')}),secret)
  assert.throws(()=>parseCodaSyncSecret({FUNIX_CODA_SYNC_ENABLED:'true',FUNIX_CODA_SYNC_HMAC_KEY_BASE64:'weak'}))
})

test('Coda event endpoint remains 404 when not injected into ordinary App', async () => {
  const db=openDatabase(':memory:')
  try {
    const handler=createRequestHandler({atendimentos:new AtendimentoRepository(db),password:'synthetic-strong-operator-password',voiceProvider:null})
    const req=Object.assign(Readable.from([]),{
      url:'/api/integrations/coda/atendimentos',method:'POST',headers:{},socket:{remoteAddress:'127.0.0.1'},
    }) as unknown as IncomingMessage
    let status=200
    const res={setHeader(){},writeHead(v:number){status=v},end(){} } as unknown as ServerResponse
    await handler(req,res)
    assert.equal(status,404)
    assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='coda_sync_receipts'").get(),undefined)
  } finally { db.close() }
})
