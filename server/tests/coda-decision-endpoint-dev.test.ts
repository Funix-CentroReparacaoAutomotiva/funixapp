import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createRequestHandler } from '../app.ts'
import { createDevelopmentDecisionLedgerSchema, DevelopmentDecisionLedger } from '../chat/coda-decision-ledger-dev.ts'

const key=Buffer.alloc(32,19)
const t=1794144000000
const stamp=String(t/1000)
const decision={
  eventId:'evo:funix_comercial:SYNTHETIC2',
  codaRowId:'i-SYNTH_CANONICAL',
  remoteJid:'5531999990001@s.whatsapp.net',
}
function harness(enabled=true) {
  const db=openDatabase(':memory:')
  const atendimento=new AtendimentoRepository(db)
  if(enabled)createDevelopmentDecisionLedgerSchema(db)
  const handler=createRequestHandler({
    atendimentos:atendimento,voiceProvider:null,password:'synthetic-test-operator-password',
    origin:'http://localhost:5173',now:()=>t,
    ...(enabled?{decisionLedger:{ledger:new DevelopmentDecisionLedger(db),secret:key}}:{}),
  })
  async function send(payload:unknown,overrides?:{stamp?:string,signature?:string,origin?:string,method?:string,body?:string}) {
    const raw=overrides?.body??JSON.stringify(payload)
    const ts=overrides?.stamp??stamp
    const sig=overrides?.signature??'sha256='+createHmac('sha256',key)
      .update('whatsapp-decision-v1\n'+ts+'\n').update(raw).digest('hex')
    const headers:Record<string,string>={
      'content-type':'application/json','content-length':String(Buffer.byteLength(raw)),
      'x-funix-timestamp':ts,'x-funix-signature':sig,
    }
    if(overrides?.origin)headers.origin=overrides.origin
    const req=Object.assign(Readable.from([Buffer.from(raw)]),{
      method:overrides?.method??'POST',url:'/api/integrations/whatsapp/confirmed-decision',
      headers,rawHeaders:Object.entries(headers).flat(),socket:{remoteAddress:'127.0.0.1'},
    }) as unknown as IncomingMessage
    let status=200,value=''
    const res={setHeader(){},writeHead(code:number){status=code},end(body:string){value=body}} as unknown as ServerResponse
    await handler(req,res)
    return {status,body:JSON.parse(value)}
  }
  return {db,send}
}
test('decision intake: signed receipt, identical replay, conflicting target 409, no Atendimento',async()=>{
  const f=harness()
  try{
    assert.deepEqual(await f.send(decision),{status:202,body:{state:'created'}})
    assert.deepEqual(await f.send(decision),{status:202,body:{state:'existing'}})
    assert.equal((await f.send({...decision,codaRowId:'i-SYNTH_OTHER'})).status,409)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM dev_whatsapp_confirmed_decisions').get()!.n),1)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),0)
  }finally{f.db.close()}
})
test('decision intake: bad signature, old timestamp, browser and unknown fields rejected',async()=>{
  const f=harness()
  try{
    assert.equal((await f.send(decision,{signature:'sha256='+'0'.repeat(64)})).status,401)
    assert.equal((await f.send(decision,{stamp:'1600000000'})).status,401)
    assert.equal((await f.send(decision,{origin:'https://malicious.invalid'})).status,403)
    assert.equal((await f.send(decision,{method:'GET'})).status,405)
    assert.equal((await f.send({...decision,extra:'secret'})).status,422)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM dev_whatsapp_confirmed_decisions').get()!.n),0)
  }finally{f.db.close()}
})
test('decision intake: route absent with feature gate disabled',async()=>{
  const f=harness(false)
  try{
    assert.equal((await f.send(decision)).status,404)
    assert.equal(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='dev_whatsapp_confirmed_decisions'").get(),undefined)
  }finally{f.db.close()}
})
