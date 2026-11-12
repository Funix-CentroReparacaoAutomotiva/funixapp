import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createRequestHandler } from '../app.ts'
import { createDevelopmentSourceLedgerSchema,DevelopmentSourceLedger } from '../chat/coda-source-storage-dev.ts'
import { createDevelopmentDecisionLedgerSchema,DevelopmentDecisionLedger } from '../chat/coda-decision-ledger-dev.ts'
import { createDevelopmentOutboxSchema,DevelopmentCodaOutbox } from '../chat/coda-outbox-dev.ts'
import { createCodaEventSchema,CodaEventSyncRepository } from '../chat/coda-sync.ts'
import { createCodaBackedDevelopmentReconciliationCycle } from '../chat/coda-reconciliation-coda-dev.ts'

const now=1794144000000
const secret=Buffer.alloc(32,29)
const jid='5531999990001@s.whatsapp.net'
const original='evo:funix_comercial:SYNTH_ORIGINAL'
const reused='evo:funix_comercial:SYNTH_REUSED'
const codaRow='i-SYNTH_CANONICAL'
const source=(eventId:string,occurredAt:number)=>({
  eventId,remoteJid:jid,phoneE164:'+5531999990001',
  displayName:'Cliente de teste',occurredAt,
  instance:'funix_comercial',source:'whatsapp',suppressed:false,
})
const decision=(eventId:string,codaRowId=codaRow)=>({eventId,codaRowId,remoteJid:jid})
function fixture() {
  const db=openDatabase(':memory:')
  const atendimentos=new AtendimentoRepository(db)
  createDevelopmentSourceLedgerSchema(db)
  createDevelopmentDecisionLedgerSchema(db)
  createDevelopmentOutboxSchema(db)
  createCodaEventSchema(db)
  const sources=new DevelopmentSourceLedger(db)
  const decisions=new DevelopmentDecisionLedger(db)
  const outbox=new DevelopmentCodaOutbox(db)
  const recipient=new CodaEventSyncRepository(db)
  const handler=createRequestHandler({
    atendimentos,voiceProvider:null,password:'synthetic-test-password',
    origin:'http://localhost:5173',now:()=>now,
    sourceLedger:{ledger:sources,secret},
    decisionLedger:{ledger:decisions,secret},
  })
  async function send(
    path:'/api/integrations/whatsapp/source-ledger'|'/api/integrations/whatsapp/confirmed-decision',
    value:unknown,
    domain:'whatsapp-source-v1'|'whatsapp-decision-v1',
  ) {
    const body=JSON.stringify(value)
    const timestamp=String(Math.floor(now/1000))
    const signature='sha256='+createHmac('sha256',secret)
      .update(domain+'\n'+timestamp+'\n').update(body).digest('hex')
    const headers:Record<string,string>={
      'content-type':'application/json','content-length':String(Buffer.byteLength(body)),
      'x-funix-timestamp':timestamp,'x-funix-signature':signature,
    }
    const req=Object.assign(Readable.from([Buffer.from(body)]),{
      method:'POST',url:path,headers,rawHeaders:Object.entries(headers).flat(),
      socket:{remoteAddress:'127.0.0.1'},
    }) as unknown as IncomingMessage
    let status=200,returned=''
    const res={
      setHeader(){},writeHead(code:number){status=code},
      end(body:string){returned=body},
    } as unknown as ServerResponse
    await handler(req,res)
    return {status,body:JSON.parse(returned)}
  }
  let fetchCalls=0
  const fetchImpl=(async()=>{
    fetchCalls++
    return new Response(JSON.stringify({items:[{
      id:codaRow,
      values:{
        'c-lsQIF3vIWr':original,
        'c-rAEurF2Nmz':jid,
        'c-PHvyLm0gyd':{type:'ref',rowId:'i-O01Tgl0bN2'},
        'c-5poWJk5IsH':'+5531999990001',
      },
    }]}),{status:200})
  }) as typeof fetch
  const cycle=createCodaBackedDevelopmentReconciliationCycle(
    {token:'synthetic_Coda_read_token_not_real',fetchImpl},
    {
      source:sources,decisions,outbox,now:()=>now,
      hmacSecret:Buffer.alloc(32,41),
      transport:async request=>({status:202,body:recipient.sync(JSON.parse(request.body))}),
    },
  )
  return {db,send,cycle,outbox,recipient,getFetchCalls:()=>fetchCalls}
}

test('authenticated DEV chain: signed source then confirmed Coda decision, idempotent reuse, no ERP manual import',async()=>{
  const f=fixture()
  try {
    assert.equal((await f.send('/api/integrations/whatsapp/source-ledger',source(original,1794144000),'whatsapp-source-v1')).status,202)
    assert.equal((await f.send('/api/integrations/whatsapp/source-ledger',source(reused,1794144020),'whatsapp-source-v1')).status,202)
    // Two source messages alone must never create a local Atendimento.
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),0)
    assert.equal((await f.send('/api/integrations/whatsapp/confirmed-decision',decision(reused),'whatsapp-decision-v1')).status,202)
    assert.equal((await f.send('/api/integrations/whatsapp/confirmed-decision',decision(reused),'whatsapp-decision-v1')).body.state,'existing')
    const first=await f.cycle()
    assert.equal(first.status,'completed')
    if(first.status==='completed') {
      assert.equal(first.created,2)
      assert.equal(first.delivery.status,'delivered')
    }
    assert.equal(f.getFetchCalls(),2)
    const second=await f.cycle()
    assert.equal(second.status,'completed')
    if(second.status==='completed')assert.equal(second.delivery.status,'delivered')
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),1)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM coda_sync_receipts').get()!.n),2)
    assert.equal(f.outbox.stats().delivered,2)
    assert.ok(f.recipient.resolveActive(jid))
    const third=await f.cycle()
    assert.equal(third.status,'completed')
    if(third.status==='completed')assert.equal(third.delivery.status,'idle')
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),1)
  } finally {f.db.close()}
})

test('authenticated DEV chain: cross-domain HMAC reuse does not write source or decision',async()=>{
  const f=fixture()
  try {
    const invalidSource=await f.send('/api/integrations/whatsapp/source-ledger',source(original,1794144000),'whatsapp-decision-v1')
    const invalidDecision=await f.send('/api/integrations/whatsapp/confirmed-decision',decision(reused),'whatsapp-source-v1')
    assert.equal(invalidSource.status,401)
    assert.equal(invalidDecision.status,401)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM dev_whatsapp_source_ledger').get()!.n),0)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM dev_whatsapp_confirmed_decisions').get()!.n),0)
  } finally {f.db.close()}
})
