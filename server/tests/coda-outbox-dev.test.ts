import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../database.ts'
import { CodaEventSyncRepository, createCodaEventSchema } from '../chat/coda-sync.ts'
import { createDevelopmentOutboxSchema, DevelopmentCodaOutbox } from '../chat/coda-outbox-dev.ts'
import { resolveCodaCommercialContext } from '../chat/coda-eligibility-dev.ts'

const t0 = 1794150000000
const event = (eventId = 'evo:synthetic:one', codaRowId = 'i-SYNTH_1') => ({
  version: 1 as const, source: 'coda' as const, eventId, codaRowId,
  instance: 'funix_comercial' as const, remoteJid: '5531999990001@s.whatsapp.net',
  phoneE164: '+5531999990001', displayName: 'Pessoa Sintética', occurredAt:1794144000,
})
const candidate = (rowId = 'i-SYNTH_1', commercialStatus='Novo Lead', origin:'whatsapp'|'manual'|'unknown'='whatsapp')=>({
  rowId,origin,commercialStatus,phoneE164:'+5531999990001',
  name:'Contato Sintético',vehicle:'Carro de teste',plate:'TEST-0000',
})
const context = (candidates:ReturnType<typeof candidate>[],suppressed=false)=>({
  remoteJid:'5531999990001@s.whatsapp.net',phoneE164:'+5531999990001',candidates,suppressed,
})

test('DEV outbox: stable event, exact verified Coda row and manual exclusion, 20x idempotency',()=>{
  const db=openDatabase(':memory:')
  try{
    createDevelopmentOutboxSchema(db)
    const queue=new DevelopmentCodaOutbox(db)
    assert.equal(queue.enqueue(event(),'whatsapp','i-SYNTH_1',t0),'created')
    for(let i=0;i<20;i++) assert.equal(queue.enqueue(event(),'whatsapp','i-SYNTH_1',t0),'existing')
    assert.deepEqual(queue.stats(),{pending:1,leased:0,delivered:0,quarantined:0})
    assert.throws(()=>queue.enqueue({...event(),displayName:'Outro Nome'},'whatsapp','i-SYNTH_1',t0),/OUTBOX_EVENT_CONFLICT/)
    assert.throws(()=>queue.enqueue(event(),'whatsapp','i-DIFFERENT',t0),/OUTBOX_UNCONFIRMED_SOURCE/)
    assert.throws(()=>queue.enqueue(event(),'manual' as 'whatsapp','i-SYNTH_1',t0),/OUTBOX_UNCONFIRMED_SOURCE/)
    assert.deepEqual(queue.stats(),{pending:1,leased:0,delivered:0,quarantined:0})
  }finally{db.close()}
})

test('DEV outbox: retry, lease fencing, worker recovery, delivered immutable',()=>{
  const db=openDatabase(':memory:')
  try{
    createDevelopmentOutboxSchema(db)
    const q=new DevelopmentCodaOutbox(db)
    q.enqueue(event(),'whatsapp','i-SYNTH_1',t0)
    const a=q.claim(t0,5_000)!
    assert.equal(a.attempts,1)
    assert.equal(q.claim(t0+1,5_000),null)
    assert.equal(q.complete(a,503,t0+2),'retry')
    assert.equal(q.claim(t0+1000,5_000),null)
    const b=q.claim(t0+30_002,5_000)!
    assert.equal(b.attempts,2)
    assert.equal(q.complete(a,202,t0+30_003),'stale')
    const c=q.claim(t0+35_002,5_000)!
    assert.equal(c.attempts,3)
    assert.equal(q.complete(b,202,t0+35_003),'stale')
    assert.equal(q.complete(c,202,t0+35_003),'delivered')
    assert.equal(q.claim(t0+100_000,5_000),null)
    assert.deepEqual(q.stats(),{pending:0,leased:0,delivered:1,quarantined:0})
  }finally{db.close()}
})

test('DEV outbox: permanent failure quarantine and max bounded transient retries',()=>{
  const db=openDatabase(':memory:')
  try{
    createDevelopmentOutboxSchema(db)
    const q=new DevelopmentCodaOutbox(db)
    q.enqueue(event(),'whatsapp','i-SYNTH_1',t0)
    const a=q.claim(t0,5000)!
    assert.equal(q.complete(a,422,t0+1),'quarantined')
    assert.deepEqual(q.stats(),{pending:0,leased:0,delivered:0,quarantined:1})
    q.enqueue(event('evo:synthetic:two','i-SYNTH_2'),'whatsapp','i-SYNTH_2',t0)
    let now=t0
    for(let attempt=1;attempt<=8;attempt++){
      const claim=q.claim(now,5000)!
      assert.equal(claim.attempts,attempt)
      const status=q.complete(claim,503,now+1)
      assert.equal(status,attempt===8?'quarantined':'retry')
      now+=15*60_000+2 // past the maximum backoff from completion timestamp
    }
    assert.deepEqual(q.stats(),{pending:0,leased:0,delivered:0,quarantined:2})
  }finally{db.close()}
})

test('DEV outbox: event delivery can be replayed to receiver without creating duplicates',()=>{
  const db=openDatabase(':memory:')
  try{
    createCodaEventSchema(db)
    createDevelopmentOutboxSchema(db)
    const q=new DevelopmentCodaOutbox(db), receiver=new CodaEventSyncRepository(db)
    q.enqueue(event(),'whatsapp','i-SYNTH_1',t0)
    const claim=q.claim(t0,5000)!
    const first=receiver.sync(JSON.parse(claim.body))
    const second=receiver.sync(JSON.parse(claim.body))
    assert.equal(first.atendimentoId,second.atendimentoId)
    assert.equal(second.state,'existing')
    assert.equal(q.complete(claim,202,t0+1),'delivered')
    assert.equal(Number(db.prepare('SELECT count(*) AS n FROM coda_sync_atendimentos').get()!.n),1)
  }finally{db.close()}
})

test('DEV commercial resolver: manual independence, open/closed, ambiguity and suppressed leads',()=>{
  assert.deepEqual(resolveCodaCommercialContext(context([])),{kind:'create',reason:'new'})
  assert.deepEqual(resolveCodaCommercialContext(context([candidate('i-MANUAL_1','Novo Lead','manual')])),{kind:'create',reason:'new'})
  assert.deepEqual(resolveCodaCommercialContext(context([candidate('i-SYNTH_1','Novo Lead') ])),{kind:'direct',codaRowId:'i-SYNTH_1'})
  assert.deepEqual(resolveCodaCommercialContext(context([candidate('i-SYNTH_1','Fim Positivo')])),{kind:'create',reason:'all_closed'})
  assert.deepEqual(resolveCodaCommercialContext(context([
    candidate('i-SYNTH_1','Fim Negativo'),candidate('i-SYNTH_2','Novo Lead'),
  ])),{kind:'direct',codaRowId:'i-SYNTH_2'})
  const ambiguous=resolveCodaCommercialContext(context([
    candidate('i-SYNTH_1','Novo Lead'),candidate('i-SYNTH_2','Aguardando Dados'),
  ]))
  assert.equal(ambiguous.kind,'choose')
  if(ambiguous.kind==='choose')assert.equal(ambiguous.candidates.length,2)
  assert.deepEqual(resolveCodaCommercialContext(context([candidate()],true)),{kind:'suppressed',reason:'commercial_opt_out'})
  assert.deepEqual(resolveCodaCommercialContext(context([candidate('i-UNKNOWN','Novo Lead','unknown')])),{kind:'identity_review',reason:'unknown_record_origin'})
  assert.deepEqual(resolveCodaCommercialContext(context([candidate('i-SYNTH_1','')])),{kind:'identity_review',reason:'unknown_commercial_status'})
  assert.deepEqual(resolveCodaCommercialContext({...context([candidate()]),remoteJid:'synthetic@lid'}),{kind:'identity_review',reason:'unverified_identity'})
})
