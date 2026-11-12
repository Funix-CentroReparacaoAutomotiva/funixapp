import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createRequestHandler } from '../app.ts'
import { createDevelopmentSourceLedgerSchema, DevelopmentSourceLedger } from '../chat/coda-source-storage-dev.ts'
import { parseDevelopmentSourceSecret } from '../chat/coda-source-endpoint-dev.ts'

const secret=Buffer.alloc(32,11)
const t=1794144000000
const stamp=String(t/1000)
const sample={
  eventId:'evo:funix_comercial:SYNTHETIC1',
  remoteJid:'5531999990001@s.whatsapp.net',
  phoneE164:'+5531999990001',
  displayName:'Teste sem cliente real',
  occurredAt:1794144000,
  instance:'funix_comercial',
  source:'whatsapp',
  suppressed:false,
}
function harness(enabled=true) {
  const db=openDatabase(':memory:')
  const at=new AtendimentoRepository(db)
  if(enabled)createDevelopmentSourceLedgerSchema(db)
  const handler=createRequestHandler({
    atendimentos:at,voiceProvider:null,password:'synthetic-test-operator-password',
    origin:'http://localhost:5173',now:()=>t,
    ...(enabled?{sourceLedger:{ledger:new DevelopmentSourceLedger(db),secret}}:{}),
  })
  async function send(payload:unknown,extra?:{
    raw?:string,method?:string,origin?:string,stamp?:string,signature?:string,path?:string
  }) {
    const data=extra?.raw??JSON.stringify(payload)
    const timestamp=extra?.stamp??stamp
    const signature=extra?.signature??'sha256='+createHmac('sha256',secret)
      .update('whatsapp-source-v1\n'+timestamp+'\n').update(data).digest('hex')
    const headers:Record<string,string>={
      'content-type':'application/json','content-length':String(Buffer.byteLength(data)),
      'x-funix-timestamp':timestamp,'x-funix-signature':signature,
    }
    if(extra?.origin)headers.origin=extra.origin
    const req=Object.assign(Readable.from([Buffer.from(data)]),{
      method:extra?.method??'POST',
      url:extra?.path??'/api/integrations/whatsapp/source-ledger',
      headers,rawHeaders:Object.entries(headers).flat(),socket:{remoteAddress:'127.0.0.1'},
    }) as unknown as IncomingMessage
    let status=200,json=''
    const res={
      setHeader(){},writeHead(code:number){status=code},end(body:string){json=body},
    } as unknown as ServerResponse
    await handler(req,res)
    return {status,body:JSON.parse(json)}
  }
  return {db,send}
}
test('source intake: HMAC verified, replay idempotent, no Atendimento auto-created',async()=>{
  const f=harness()
  try{
    const first=await f.send(sample)
    assert.equal(first.status,202)
    assert.equal(first.body.state,'created')
    const second=await f.send(sample)
    assert.equal(second.status,202)
    assert.equal(second.body.state,'existing')
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM dev_whatsapp_source_ledger').get()!.n),1)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),0)
  }finally{f.db.close()}
})
test('source intake: invalid signatures, old timestamps, browser request and wrong method fail closed',async()=>{
  const f=harness()
  try{
    assert.equal((await f.send(sample,{signature:'sha256='+'0'.repeat(64)})).status,401)
    assert.equal((await f.send(sample,{stamp:'1500000000'})).status,401)
    assert.equal((await f.send(sample,{origin:'https://malicious.invalid'})).status,403)
    assert.equal((await f.send(sample,{method:'GET'})).status,405)
    assert.equal((await f.send({...sample,suppressed:true})).status,422)
    assert.equal((await f.send({...sample,remoteJid:'other@lid'})).status,422)
    assert.equal((await f.send({...sample,extra:'unexpected'})).status,422)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM dev_whatsapp_source_ledger').get()!.n),0)
  }finally{f.db.close()}
})
test('source intake: immutable conflicting event is 409 and never changes row',async()=>{
  const f=harness()
  try{
    assert.equal((await f.send(sample)).status,202)
    assert.equal((await f.send({...sample,displayName:'Different'})).status,409)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM dev_whatsapp_source_ledger').get()!.n),1)
  }finally{f.db.close()}
})
test('source intake: explicit feature flag required and disabled route remains 404',async()=>{
  assert.equal(parseDevelopmentSourceSecret({}),null)
  assert.equal(parseDevelopmentSourceSecret({FUNIX_SOURCE_LEDGER_ENABLED:'false',FUNIX_SOURCE_LEDGER_HMAC_KEY_BASE64:'invalid'}),null)
  assert.deepEqual(parseDevelopmentSourceSecret({FUNIX_SOURCE_LEDGER_ENABLED:'true',FUNIX_SOURCE_LEDGER_HMAC_KEY_BASE64:secret.toString('base64')}),secret)
  assert.throws(()=>parseDevelopmentSourceSecret({FUNIX_SOURCE_LEDGER_ENABLED:'true',FUNIX_SOURCE_LEDGER_HMAC_KEY_BASE64:'weak'}))
  const f=harness(false)
  try{
    assert.equal((await f.send(sample)).status,404)
    assert.equal(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='dev_whatsapp_source_ledger'").get(),undefined)
  }finally{f.db.close()}
})
