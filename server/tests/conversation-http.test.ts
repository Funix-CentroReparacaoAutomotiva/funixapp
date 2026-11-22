import {commercialFixture} from './fixtures/commercial.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {issueProductionOrder,removeV25FixtureSchema} from './fixtures/production.ts'
import type {MessagePage} from '../experimental/evolution-read/client.ts'
import { observedEvolutionUpsert } from './fixtures/evolution-webhook.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHmac, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createRequestHandler } from '../app.ts'
import { openDatabase } from '../database.ts'
import { migrate } from '../migrations.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { CustomerRepository } from '../customers.ts'
import { V20AssociationRepository } from '../chat/v20-associations.ts'
import { CodaEventSyncRepository, createCodaEventSchema } from '../chat/coda-sync.ts'
import { loadConversationRuntime } from '../chat/conversation-runtime.ts'
import { createEvolutionChatBridge } from '../chat/evolution-bridge.ts'
import { normalizeEvolutionUpsert } from '../chat/evolution-normalize.ts'
import { syntheticMessage, INSTANCE } from './fixtures/evolution-read.ts'

const PN = '000000000001@s.whatsapp.net',
  LID = 'http-synthetic@lid',
  origin = 'http://localhost:5173',
  secret = Buffer.alloc(32, 8),
  password = 'synthetic-operator-password'
async function fixture(autonomous=false,withMedia=false,cutover?:string) {
  const db = openDatabase(':memory:')
  createCodaEventSchema(db)
  const repo = new CodaEventSyncRepository(db),
    local = loadConversationRuntime(
      {
        FUNIX_CHAT_LOCAL_ENABLED: 'true',
        FUNIX_CHAT_LOCAL_READ_ENABLED: 'true',
        FUNIX_EVOLUTION_READ_ENABLED: 'true',
        ...(autonomous?{FUNIX_CHAT_AUTONOMOUS_ENABLED:'true',FUNIX_CHAT_AUTONOMOUS_SINCE:cutover}:{}),
      },
      db,
      repo,
    )!
  local.providerIdentity = { instance: 'funix_comercial', instanceId: INSTANCE }
  let providerHistory:MessagePage|(() => Promise<MessagePage>)|undefined
  let reads = 0,
    sends = 0
  const bridge = createEvolutionChatBridge(
    {
      findChatsPage: async () => ({ items: [], sourceCount: 0 }),
      ...(withMedia?{findMediaEnvelope:async (jid:string,id:string)=>({envelope:{key:{remoteJid:jid,id}},kind:'image' as const,bytes:4})}:{}),
      findMessages: async () => {
        reads++
        if(providerHistory)return typeof providerHistory==='function'?providerHistory():providerHistory
        throw Error('provider intentionally offline')
      },
    },
    Date.now,
    undefined,
    local.authority??repo,
    async () => {
      sends++
      return { messageId: 'receipt-1' }
    },
    withMedia?{
      send:async()=>{sends++;return {messageId:'synthetic-media-send'}},
      get:async()=>({kind:'image',mimeType:'image/png',base64:'aW1n'}),
    }:undefined,
    local,
  )
  const handler = createRequestHandler({
    atendimentos: new AtendimentoRepository(db),
    password,
    origin,
    conversationRuntime: local,
    evolutionChat: bridge,
    whatsappIngest: {
      enabled: true,
      config: {
        version: 1,
        keys: [
          {
            keyId: 'test-key',
            secretBase64: secret.toString('base64'),
            instances: ['funix_comercial'],
          },
        ],
      },
    },
    ...(autonomous?{v20Associations:new V20AssociationRepository(db)}:{codaSync:{repo,secret}}),
    voiceProvider: null,
  })
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    const req = Object.assign(Readable.from(raw ? [raw] : []), {
      url: path,
      method,
      headers: { 'content-type': 'application/json', ...headers },
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage
    let status = 200,
      output = ''
    const outHeaders = new Headers()
    const res = {
      setHeader: (key: string, value: string) => outHeaders.set(key, value),
      writeHead: (value: number) => {
        status = value
      },
      end: (value: string) => {
        output = value
      },
    } as unknown as ServerResponse
    await handler(req, res)
    return new Response(output, { status, headers: outHeaders })
  }
  const login = await request('/api/session', 'POST', { password }, { origin })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!
  const browser = { origin, cookie }
  const sendEvent = async (body: unknown, invalidSignature = false) => {
    const raw = JSON.stringify(body),
      time = String(Math.floor(Date.now() / 1000)),
      sig = createHmac('sha256', secret).update(`v1\ntest-key\n${time}\n`).update(raw).digest('hex')
    return request('/api/integrations/whatsapp/events', 'POST', raw, {
      'x-funix-key-id': 'test-key',
      'x-funix-timestamp': time,
      'x-funix-signature': 'sha256=' + (invalidSignature ? '0'.repeat(64) : sig),
    })
  }
  const event = await normalizeEvolutionUpsert(
    {
      event: 'messages.upsert',
      instance: 'funix_comercial',
      data: syntheticMessage(1, {
        key: { id: 'message-1', remoteJid: LID, remoteJidAlt: PN, fromMe: false },
      }),
    },
    { instance: 'funix_comercial', instanceId: INSTANCE },
  )
  return {
    db,
    repo,
    local,
    bridge,
    request,
    browser,
    sendEvent,
    setProviderHistory(page:MessagePage|(() => Promise<MessagePage>)|undefined){providerHistory=page},
    event,
    get reads() {
      return reads
    },
    get sends() {
      return sends
    },
  }
}

test('v2 signed HTTP chain: ACK after durable pending message, ERP later, local history offline, strict/replayed sends and generic quarantine', async () => {
  const old = process.env.FUNIX_EVOLUTION_SEND_ENABLED
  process.env.FUNIX_EVOLUTION_SEND_ENABLED = 'true'
  const f = await fixture()
  try {
    assert.equal((await f.sendEvent(f.event, true)).status, 401)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_events').get()!.n), 0)
    const delivered = await f.sendEvent(f.event)
    assert.equal(delivered.status, 202)
    const receipt = await delivered.json()
    assert.equal(receipt.state, 'persisted')
    assert.equal(receipt.disposition, 'pending')
    assert.deepEqual(await (await f.sendEvent(f.event)).json(), receipt)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 0)
    const id = f.repo.sync({
      version: 1,
      source: 'coda',
      eventId: 'coda:confirmed',
      codaRowId: 'i-HTTP_A',
      instance: 'funix_comercial',
      remoteJid: PN,
      phoneE164: null,
      displayName: 'Sintético',
      occurredAt: 100,
    }).atendimentoId
    const handle = f.repo.rememberProviderConversation(LID),
      base = `/api/atendimentos/${id}/evolution-conversations/${handle}`
    assert.equal((await f.request(base + '/messages')).status, 401)
    const page = await (await f.request(base + '/messages', 'GET', undefined, f.browser)).json()
    assert.equal(page.source, 'local')
    assert.equal(page.items[0].text, 'Synthetic 1')
    assert.equal(f.reads, 0)
    assert.equal(
      (await f.request(base + '/send-text', 'POST', { text: 'synthetic' }, f.browser)).status,
      400,
    )
    const command = { text: 'synthetic', requestId: randomUUID(), contextToken: page.contextToken }
    assert.equal((await f.request(base + '/send-text', 'POST', command, f.browser)).status, 200)
    assert.equal((await f.request(base + '/send-text', 'POST', command, f.browser)).status, 200)
    assert.equal(f.sends, 1)
    assert.equal(
      (await f.request(base + '/send-text', 'POST', { ...command, text: 'modified' }, f.browser))
        .status,
      409,
    )
    assert.equal(
      (await f.request(base + '/sync-history', 'POST', { page: 1 }, { cookie: f.browser.cookie }))
        .status,
      403,
    )
    assert.equal(
      (await f.request(base + '/sync-history', 'POST', { page: 1 }, f.browser)).status,
      503,
    )
    assert.equal((await f.request(base + '/messages', 'GET', undefined, f.browser)).status, 200)
    f.repo.rememberProviderAliases([{ remoteJid: 'collision@lid', remoteJidAlt: PN }])
    assert.equal(
      (
        await f.request(
          '/api/chat/conversations/' + handle + '/messages',
          'GET',
          undefined,
          f.browser,
        )
      ).status,
      404,
    )
    assert.equal((await f.request(base + '/messages', 'GET', undefined, f.browser)).status, 404)
    assert.equal(
      (
        await f.request(
          base + '/send-text',
          'POST',
          { ...command, requestId: randomUUID() },
          f.browser,
        )
      ).status,
      404,
    )
    assert.equal(f.sends, 1)
  } finally {
    f.db.close()
    if (old === undefined) delete process.env.FUNIX_EVOLUTION_SEND_ENABLED
    else process.env.FUNIX_EVOLUTION_SEND_ENABLED = old
  }
})

test('v2 signed HTTP storage failure never ACKs; exact retry commits once after recovery', async () => {
  const f = await fixture()
  try {
    f.db.exec(
      "CREATE TRIGGER fail_projection BEFORE INSERT ON chat_events BEGIN SELECT RAISE(ABORT,'SYNTHETIC'); END",
    )
    assert.equal((await f.sendEvent(f.event)).status, 503)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n), 0)
    assert.equal(
      Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_provider_alias_evidence').get()!.n),
      0,
    )
    f.db.exec('DROP TRIGGER fail_projection')
    assert.equal((await f.sendEvent(f.event)).status, 202)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n), 1)
  } finally {
    f.db.close()
  }
})

test('normalizer validates provider instance, sender, unknown event type and edited-null upserts without leaking provider metadata', async () => {
  const expected = { instance: 'funix_comercial', instanceId: INSTANCE }
  const raw = {
    event: 'messages.upsert',
    instance: 'funix_comercial',
    data: syntheticMessage(1, {
      message: null,
      status: 'EDITED',
      MessageUpdate: undefined,
      key: { id: 'message-1', fromMe: true, remoteJid: LID, remoteJidAlt: PN },
      profilePicUrl: 'https://private.invalid',
    }),
  }
  const result = await normalizeEvolutionUpsert(raw, expected)
  assert.equal(result.message.kind, 'unsupported')
  assert.equal(result.message.text, null)
  assert.equal(result.message.fromMe, true)
  assert(!JSON.stringify(result).includes('private.invalid'))
  assert(!JSON.stringify(result).includes('recordId'))
  await assert.rejects(normalizeEvolutionUpsert({ ...raw, instance: 'another' }, expected))
  await assert.rejects(normalizeEvolutionUpsert({ ...raw, event: 'messages.update' }, expected))
  await assert.rejects(
    normalizeEvolutionUpsert({ ...raw, data: { ...raw.data, instanceId: 'wrong' } }, expected),
  )
})

test('raw observed Evolution upsert can be relayed with existing HMAC envelope; normalization precedes persistence', async () => {
  const f = await fixture()
  try {
    const raw = {
      event: 'messages.upsert',
      instance: 'funix_comercial',
      data: syntheticMessage(2, {
        key: { id: 'raw-2', remoteJid: LID, remoteJidAlt: PN, fromMe: true },
        profilePicUrl: 'https://private.invalid',
      }),
    }
    const res = await f.sendEvent(raw)
    assert.equal(res.status, 202)
    const receipt = await res.json()
    assert.equal(receipt.eventId, 'evo:funix_comercial:raw-2:upsert')
    const stored = String(
      f.db.prepare('SELECT payload FROM chat_events WHERE event_id=?').get(receipt.eventId)!
        .payload,
    )
    assert(!stored.includes('private.invalid'))
    assert(!stored.includes('MessageUpdate'))
    assert.equal(f.local.store.page(LID, 1).items[0]?.fromMe, true)
    assert.equal((await f.sendEvent({ ...raw, event: 'unverified.provider.event' })).status, 422)
  } finally {
    f.db.close()
  }
})

test('documented Evolution edit/status/delete shapes update one local message and keep original timeline', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.sendEvent(f.event)).status, 202)
    const mutationMs = 1793491205000
    const edit = {
      event: 'messages.edited',
      instance: 'funix_comercial',
      data: {
        key: { id: 'message-1', remoteJid: LID, fromMe: false },
        editedMessage: { conversation: 'Edited via protocol' },
        timestampMs: String(mutationMs),
      },
    }
    assert.equal((await f.sendEvent(edit)).status, 202)
    let message = f.local.store.page(LID, 1).items[0]!
    assert.equal(message.text, 'Edited via protocol')
    assert.equal(message.timestamp, 1700000001)
    // A late original is idempotent and cannot undo the edit.
    assert.equal((await f.sendEvent(f.event)).status, 202)
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, 'Edited via protocol')
    const status = {
      event: 'messages.update',
      instance: 'funix_comercial',
      date_time: '2026-11-01T00:00:10.000Z',
      data: {
        keyId: 'message-1',
        remoteJid: LID,
        fromMe: false,
        status: 'READ',
        instanceId: INSTANCE,
      },
    }
    assert.equal((await f.sendEvent(status)).status, 202)
    assert(f.local.store.page(LID, 1).items[0]!.statuses.includes('READ'))
    const removed = {
      event: 'messages.delete',
      instance: 'funix_comercial',
      date_time: '2026-11-01T00:00:15.000Z',
      data: { id: 'message-1', remoteJid: LID, fromMe: false, status: 'DELETED' },
    }
    assert.equal((await f.sendEvent(removed)).status, 202)
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, null)
    assert.equal(
      (
        await f.sendEvent({
          ...edit,
          data: { ...edit.data, timestampMs: String(mutationMs + 60000) },
        })
      ).status,
      202,
    )
    assert.equal(f.local.store.page(LID, 1).items[0]!.text, null)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n), 1)
  } finally {
    f.db.close()
  }
})

test('observed webhook without provider database row ID passes normalization and signed HTTP persistence', async () => {
  const f = await fixture()
  try {
    assert.equal('id' in observedEvolutionUpsert.data, false)
    const normalized = await normalizeEvolutionUpsert(observedEvolutionUpsert, {
      instance: 'funix_comercial',
      instanceId: INSTANCE,
    })
    assert.equal(normalized.message.messageId, 'observed-synthetic-id')
    assert.equal(normalized.message.text, 'Mensagem sintética recebida')
    assert(!JSON.stringify(normalized).includes('webhook:'))
    const res = await f.sendEvent(observedEvolutionUpsert)
    assert.equal(res.status, 202)
    assert.equal((await res.json()).disposition, 'pending')
    assert.equal(
      f.local.store.page('observed-synthetic@lid', 1).items[0]?.text,
      'Mensagem sintética recebida',
    )
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n), 0)
  } finally {
    f.db.close()
  }
})


test('autonomous signed raw Evolution inbound creates shared registration, exposes same identity and history without Coda',async()=>{
 const f=await fixture(true)
 try{
  const raw={...observedEvolutionUpsert,data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,
    key:{...observedEvolutionUpsert.data.key,remoteJid:'5531999990555@s.whatsapp.net',remoteJidAlt:null,id:'autonomous-synthetic'}}}
  assert.equal((await f.sendEvent(raw,true)).status,401)
  const delivered=await f.sendEvent(raw)
  assert.equal(delivered.status,202)
  assert.deepEqual(await (await f.sendEvent(raw)).json(),await delivered.json())
  const repo=new AtendimentoRepository(f.db),customers=new CustomerRepository(f.db)
  assert.equal(repo.list().total,1)
  const at=repo.get(repo.list().items[0]!.id,true)
  const entity=at.references!.person[0]!,contact=at.references!.contact[0]!
  assert.ok(entity.id);assert.ok(contact.id)
  assert.equal(customers.record(contact.id!).entityId,entity.id)
  assert.equal(at.name,'Cliente Sintético');assert.equal(at.phone,'+5531999990555')
  const id=f.local.authority!.rememberProviderConversation(raw.data.key.remoteJid)
  assert.equal(f.local.authority!.resolveIdentityActive(raw.data.key.remoteJid),at.id)
  const shown=await (await f.request('/api/atendimentos/'+at.id+'?conversa='+id,'GET',undefined,f.browser)).json()
  assert.deepEqual(shown.chatIdentity,{name:at.name,phone:at.phone,conversationId:id})
  const history=await (await f.request('/api/atendimentos/'+at.id+'/evolution-conversations/'+id+'/messages','GET',undefined,f.browser)).json()
  assert.equal(history.items[0]?.text,raw.data.message.conversation)
  assert.equal(f.reads,0);assert.equal(f.sends,0)
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM coda_sync_atendimentos').get()!.n,0)
 }finally{f.db.close()}
})


test('signed live-format upsert with redundant identical PN or LID is accepted; distinct same-domain alias remains rejected', async () => {
  const f = await fixture(true)
  try {
    const raw = {
      ...observedEvolutionUpsert,
      data: { ...observedEvolutionUpsert.data, instanceId: INSTANCE,
        key: { ...observedEvolutionUpsert.data.key, id: 'duplicate-pn-synthetic',
          remoteJid: '5531999990555@s.whatsapp.net', remoteJidAlt: '5531999990555@s.whatsapp.net' } },
    }
    const expected = { instance: 'funix_comercial', instanceId: INSTANCE }
    const normalized = await normalizeEvolutionUpsert(raw, expected)
    assert.equal(normalized.message.remoteJidAlt, null)
    const response = await f.sendEvent(raw)
    assert.equal(response.status, 202)
    const receipt = await response.json()
    assert.deepEqual(await (await f.sendEvent(raw)).json(), receipt)
    const repo = new AtendimentoRepository(f.db), customers = new CustomerRepository(f.db)
    assert.equal(repo.list().total, 1)
    const at = repo.get(repo.list().items[0]!.id, true)
    assert.equal(customers.record(at.references!.contact[0]!.id!).entityId, at.references!.person[0]!.id)
    assert.equal(at.phone, '+5531999990555')
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM chat_provider_alias_evidence').get()!.n, 0)
    const lid = { ...raw, data: { ...raw.data, key: { ...raw.data.key, id: 'duplicate-lid-synthetic',
      remoteJid: LID, remoteJidAlt: LID } } }
    assert.equal((await normalizeEvolutionUpsert(lid, expected)).message.remoteJidAlt, null)
    assert.equal((await f.sendEvent(lid)).status, 202)
    const conflict = { ...raw, data: { ...raw.data, key: { ...raw.data.key, id: 'conflict-synthetic',
      remoteJidAlt: '5531999990666@s.whatsapp.net' } } }
    await assert.rejects(normalizeEvolutionUpsert(conflict, expected))
    assert.equal((await f.sendEvent(conflict)).status, 422)
    assert.equal(repo.list().total, 2)
  } finally { f.db.close() }
})


test('linked history and media require the exact Atendimento link and grant no send capability',async()=>{
 const f=await fixture(true,true)
 const previous=process.env.FUNIX_EVOLUTION_MEDIA_ENABLED
 process.env.FUNIX_EVOLUTION_MEDIA_ENABLED='true'
 try{
  const jid='5531999990789@s.whatsapp.net',messageId='synthetic-linked-media'
  f.local.store.ingest(JSON.stringify({schemaVersion:2,instance:'funix_comercial',eventId:messageId,type:'message.upsert',occurredAt:'2026-01-01T00:00:00.000Z',message:{
   remoteJid:jid,remoteJidAlt:null,messageId,timestamp:1767225600,fromMe:false,kind:'image',text:null,media:null,statuses:[],
  }}))
  const repo=new AtendimentoRepository(f.db),original=repo.list().items[0]!
  const selected=repo.create({name:'Outro Atendimento vinculado'})
  const outsider=repo.create({name:'Atendimento sem vínculo'})
  const authority=f.local.authority!,cid=authority.rememberProviderConversation(jid)
  const links=new V20AssociationRepository(f.db)
  links.link({conversationId:cid,atendimentoId:selected.id,expectedRevision:1,requestId:randomUUID(),reason:'Vínculo sintético'})
  links.selectAtendimento(cid,links.listActive(cid).items.find(link=>link.atendimentoId===original.id)!.linkId)
  const path=(id:string)=>'/api/atendimentos/'+id+'/evolution-conversations/'+cid+'/messages'
  const linked=await f.request(path(selected.id)+'?scope=linked','GET',undefined,f.browser)
  assert.equal(linked.status,200)
  const payload=await linked.json()
  assert.equal(payload.mediaReadAvailable,true)
  assert.equal(payload.sendTextAvailable,undefined)
  assert.equal(payload.mediaSendAvailable,undefined)
  assert.equal(payload.contextToken,undefined)
  assert.equal((await f.request(path(selected.id)+'/'+messageId+'/media?scope=linked','GET',undefined,f.browser)).status,200)
  assert.equal((await f.request(path(outsider.id)+'/'+messageId+'/media?scope=linked','GET',undefined,f.browser)).status,404)
  assert.equal((await f.request(path(outsider.id)+'?scope=linked','GET',undefined,f.browser)).status,404)
  assert.equal(authority.resolveIdentityActive(jid),original.id)
  assert.equal(f.sends,0)
 }finally{
  if(previous===undefined)delete process.env.FUNIX_EVOLUTION_MEDIA_ENABLED
  else process.env.FUNIX_EVOLUTION_MEDIA_ENABLED=previous
  f.db.close()
 }
})

test('existing linked Atendimento can read Evolution history with local reading disabled or an empty local cache', async t => {
  for (const localRead of [false, true]) await t.test(`local reading ${localRead ? 'enabled' : 'disabled'}`, async () => {
    const f = await fixture(true)
    try {
      f.local.read = localRead
      const jid = '5531999990789@s.whatsapp.net'
      const cid = f.local.authority!.rememberProviderConversation(jid)
      const repo = new AtendimentoRepository(f.db)
      const linked = repo.create({ name: 'Atendimento vinculado existente' })
      const unlinked = repo.create({ name: 'Atendimento de outro contato' })
      const links = new V20AssociationRepository(f.db)
      const link=links.link({conversationId:cid,atendimentoId:linked.id,expectedRevision:0,requestId:randomUUID(),reason:'Vínculo sintético'})
      // The previous release allowed an explicit selection from the linked list.
      // A current reader may open the same ficha with only a historical link.
      links.selectAtendimento(cid, null)
      const listed = await f.request(`/api/chat/conversations/${cid}/atendimentos`, 'GET', undefined, f.browser)
      assert.equal(listed.status, 200)
      const list = await listed.json()
      assert.deepEqual(list.items.map((item: { atendimentoId: string }) => item.atendimentoId), [linked.id])
      assert.equal(list.sendAtendimentoId, null)
      const messageId = 'existing-provider-history'
      const providerPage:MessagePage={items:[{recordId:'synthetic',instanceId:INSTANCE,remoteJid:jid,remoteJidAlt:null,
        messageId,timestamp:1767225600,fromMe:false,origin:'unknown',kind:'text',text:'Histórico original',media:null,
        statuses:[]}],currentPage:1,reportedTotal:1,reportedPages:1,nextPage:null,consistency:'offset-not-snapshot'}
      f.setProviderHistory(providerPage)
      const path = (id: string) => `/api/atendimentos/${id}/evolution-conversations/${cid}/messages?scope=linked`
      assert.equal((await f.request(path(unlinked.id), 'GET', undefined, f.browser)).status, 404)
      assert.equal(f.reads, 0)
      const response = await f.request(path(linked.id), 'GET', undefined, f.browser)
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.items[0]?.messageId, messageId)
      assert.equal(body.sendTextAvailable, undefined)
      assert.equal(body.mediaSendAvailable, undefined)
      assert.equal(body.contextToken, undefined)
      assert.equal(f.reads, 1)
      assert.equal(f.sends, 0)
      assert.equal(f.local.authority!.resolveIdentityActive(jid), null)
      if(localRead){
        f.setProviderHistory(undefined)
        const cached=await f.request(path(linked.id),'GET',undefined,f.browser)
        assert.equal((await cached.json()).items[0]?.messageId,messageId)
        assert.equal(f.reads,1)
      }else{
        f.setProviderHistory(async()=>{
          links.unlink({conversationId:cid,linkId:link.linkId,expectedRevision:link.revision,requestId:randomUUID(),reason:'Vínculo revogado durante a leitura'})
          return providerPage
        })
        const revoked=await f.request(path(linked.id),'GET',undefined,f.browser)
        assert.equal(revoked.status,404)
        assert.doesNotMatch(await revoked.text(),/Histórico original/)
        assert.equal(links.listActive(cid).items.length,0)
      }
    } finally {
      f.db.close()
    }
  })
})


test('signed first outgoing message reuses manual owner and opens one Atendimento after cutover',async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const customers=new CustomerRepository(f.db),repo=new AtendimentoRepository(f.db)
  const owner=customers.save({kind:'entity',text:'Titular manual',contacts:[{text:'(31) 99999-0555'},{text:'5531999990556'}]})
  const contacts=customers.contacts(owner.id)
  const raw=(number:string,id:string,fromMe=true)=>({...observedEvolutionUpsert,sender:'5531999990888@s.whatsapp.net',
    data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,messageTimestamp:1767225601,
      key:{remoteJid:number+'@s.whatsapp.net',remoteJidAlt:null,id,fromMe}}})
  const commercial=commercialFixture(f.db)
  const original=repo.update(commercial.at.id,{revision:repo.get(commercial.at.id).revision,
    references:{...customers.references(commercial.at.id),person:[{id:owner.id,text:owner.text}],contact:[{id:null,text:'(31) 99999-0555'}]}},true,true)
  const budgets=new BudgetRepository(f.db)
  const input={scenarioId:commercial.scenario.id,negotiation:{mode:'none'} as const}
  const quote=await budgets.emit(original.id,{...input,previewToken:budgets.preview(original.id,input).token,idempotencyKey:randomUUID()})
  issueProductionOrder(f.db,original.id,quote.id)
  const snapshot=()=>['atendimentos','atendimento_references','scenarios','budget_versions','budget_document_identity','work_orders','production_experiences']
    .map(table=>f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())
  const before=snapshot()
  assert.equal(repo.list().total,1)
  const first=raw('5531999990555','synthetic-outgoing')
  assert.equal((await f.sendEvent(first,true)).status,401)
  const accepted=await Promise.all([f.sendEvent(first),f.sendEvent(first)])
  assert.ok(accepted.every(response=>response.status===202))
  assert.deepEqual(await accepted[0]!.json(),await accepted[1]!.json())
  assert.equal((await f.sendEvent(raw('5531999990555','synthetic-reply',false))).status,202)
  assert.equal((await f.sendEvent(raw('5531999990555','synthetic-outgoing-next'))).status,202)
  assert.equal(repo.list().total,1)
  assert.deepEqual(snapshot(),before)
  const jid=first.data.key.remoteJid
  assert.equal(f.local.authority!.resolveIdentityActive(jid),original.id)
  assert.deepEqual(f.local.authority!.links(jid).map(link=>link.atendimento_id),[original.id])
  assert.equal(f.local.store.page(jid,1).items.length,3)
  const atendimento=repo.get(original.id,true)
  assert.equal(atendimento.references!.person[0]!.id,owner.id)
  assert.equal(atendimento.references!.contact[0]!.id,contacts.find(contact=>contact.text.startsWith('('))!.id)
  assert.equal(customers.contacts(owner.id).length,2)
  assert.equal((await f.sendEvent(raw('5531999990556','synthetic-other-known-number'))).status,202)
  assert.equal(repo.list().total,2)
  assert.equal((await f.sendEvent(raw('5531999990557','synthetic-new-number'))).status,202)
  assert.equal(repo.list().total,3)
  const old=raw('5531999990558','synthetic-old')
  old.data.messageTimestamp=1767225599
  assert.equal((await f.sendEvent(old)).status,202)
  assert.equal(repo.list().total,3)
  const self=raw('5531999990888','synthetic-self')
  assert.equal((await f.sendEvent(self)).status,202)
  assert.equal(repo.list().total,3)
  const group=raw('5531999990555','synthetic-group')
  group.data.key.remoteJid='123456@g.us'
  assert.equal((await f.sendEvent(group)).status,422)
  const lid=raw('5531999990555','synthetic-lid-only')
  lid.data.key.remoteJid='standalone-289@lid'
  assert.equal((await f.sendEvent(lid)).status,202)
  assert.equal(repo.list().total,4)
  const provisional=repo.list().items.find(item=>!item.phone)
  assert.ok(provisional)
  const conflict=raw('5531999990555','synthetic-lid-conflict')
  conflict.data.key.remoteJid='standalone-289@lid'
  const withAlias={...conflict,data:{...conflict.data,key:{...conflict.data.key,remoteJidAlt:'5531999990555@s.whatsapp.net'}}}
  assert.equal((await f.sendEvent(withAlias)).status,202)
  assert.equal(repo.list().total,4)
  assert.equal(f.local.authority!.resolveIdentityActive(lid.data.key.remoteJid),null)
  assert.equal(f.sends,0)
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.db.close()}
})

test('snapshot-only outgoing history is readable without a link and an explicit link reconciles the manual Contact',async()=>{
 const f=await fixture(true,true)
 const mediaFlag=process.env.FUNIX_EVOLUTION_MEDIA_ENABLED
 process.env.FUNIX_EVOLUTION_MEDIA_ENABLED='true'
 try{
  const customers=new CustomerRepository(f.db),at=new AtendimentoRepository(f.db)
  const owner=customers.save({kind:'entity',text:'Titular manual',contacts:[{text:'+5531999990777'}]})
  const contact=customers.contacts(owner.id)[0]!
  const jid='5531999990777@s.whatsapp.net',cid=f.local.authority!.rememberProviderConversation(jid)
  f.setProviderHistory({items:[{recordId:'synthetic',instanceId:INSTANCE,remoteJid:jid,remoteJidAlt:null,
    messageId:'snapshot-outgoing',timestamp:1767225600,fromMe:true,origin:'unknown',kind:'text',text:'Histórico sintético',media:null,statuses:[]},{recordId:'synthetic-image',instanceId:INSTANCE,remoteJid:jid,remoteJidAlt:null,
    messageId:'snapshot-image',timestamp:1767225599,fromMe:true,origin:'unknown',kind:'image',text:null,
    media:{reference:'synthetic',mimeType:'image/png',bytes:4,available:false},statuses:[]}],currentPage:1,reportedTotal:2,reportedPages:1,nextPage:null,consistency:'offset-not-snapshot'})
  const path='/api/chat/conversations/'+cid+'/messages?scope=technical'
  assert.equal((await f.request(path)).status,401)
  const history=await f.request(path,'GET',undefined,f.browser)
  assert.equal(history.status,200)
  assert.equal(f.reads,1)
  f.setProviderHistory(undefined)
  const payload=await history.json()
  assert.ok(payload.items.some((item:{messageId:string})=>item.messageId==='snapshot-outgoing'))
  assert.equal(payload.sendTextAvailable,undefined)
  assert.equal(payload.mediaReadAvailable,true)
  const mediaPath='/api/chat/conversations/'+cid+'/messages/snapshot-image/media?page=1'
  assert.equal((await f.request(mediaPath,'GET',undefined,f.browser)).status,200)
  assert.equal(at.list().total,0)
  const saved=at.create({references:{person:[{id:owner.id,text:owner.text}],contact:[{id:contact.id,text:contact.text}],vehicle:[],payer:[]}})
  const suggestions=await f.request('/api/chat/conversations/'+cid+'/atendimentos','GET',undefined,f.browser)
  assert.equal(suggestions.status,200)
  const proposed=await suggestions.json()
  assert.deepEqual(proposed.items,[])
  assert.deepEqual(proposed.suggestedAtendimentos.map((item:{id:string})=>item.id),[saved.id])
  assert.equal(f.local.authority!.resolveIdentityActive(jid),null)
  const link=await f.request('/api/chat/conversations/'+cid+'/atendimentos','POST',
    {expectedRevision:0,requestId:randomUUID(),atendimentoId:saved.id,reason:'Confirmação sintética'},f.browser)
  assert.equal(link.status,201)
  assert.equal(at.list().total,1)
  assert.ok(at.get(saved.id,true).references!.contact.some(item=>item.id===contact.id))
  assert.equal(customers.record(contact.id).entityId,owner.id)
  assert.ok((await (await f.request(path,'GET',undefined,f.browser)).json()).items.some((item:{messageId:string})=>item.messageId==='snapshot-outgoing'))
  f.db.prepare("INSERT INTO chat_local_context_holds VALUES(?,'autonomous_contact_conflict')").run(cid)
  const conflict=await f.request(path,'GET',undefined,f.browser)
  assert.equal(conflict.status,409)
  assert.equal((await conflict.json()).error.code,'CHAT_IDENTITY_CONFLICT')
  assert.equal((await f.request(mediaPath,'GET',undefined,f.browser)).status,409)
  const unavailableId=f.local.authority!.rememberProviderConversation('5531999990778@s.whatsapp.net')
  const unavailable=await f.request('/api/chat/conversations/'+unavailableId+'/messages?scope=technical','GET',undefined,f.browser)
  assert.equal(unavailable.status,503)
  assert.equal((await unavailable.json()).error.code,'CHAT_PROVIDER_UNAVAILABLE')
  assert.equal(f.sends,0)
 }finally{
  if(mediaFlag===undefined)delete process.env.FUNIX_EVOLUTION_MEDIA_ENABLED
  else process.env.FUNIX_EVOLUTION_MEDIA_ENABLED=mediaFlag
  f.db.close()
 }
})

test('operator can recover snapshot history into one linked triage without selecting send context',async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const at=new AtendimentoRepository(f.db),customers=new CustomerRepository(f.db)
  const jid='5531999990671@s.whatsapp.net',authority=f.local.authority!
  const cid=authority.rememberProviderConversation(jid),base='/api/chat/conversations/'+cid
  const triage=()=>f.request(base+'/atendimentos/triagem','POST',{},f.browser)
  const providerMessage={recordId:'synthetic',instanceId:INSTANCE,remoteJid:jid,remoteJidAlt:null,
    messageId:'old-snapshot-triage',timestamp:1767225599,fromMe:true,origin:'unknown' as const,
    kind:'text' as const,text:'Histórico sintético para triagem',media:null,statuses:[]}
  f.setProviderHistory({items:[providerMessage],currentPage:1,reportedTotal:1,reportedPages:1,nextPage:null,consistency:'offset-not-snapshot'})
  const missingHistory=await triage()
  assert.equal(missingHistory.status,409)
  assert.equal((await missingHistory.json()).error.code,'CHAT_TRIAGE_HISTORY_REQUIRED')
  assert.equal((await f.request(base+'/messages?scope=technical','GET',undefined,f.browser)).status,200)
  assert.equal(at.list().total,0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM chat_events').get()!.n,0)
  const model=await (await f.request(base+'/atendimentos','GET',undefined,f.browser)).json()
  assert.equal(model.canCreateTriage,true)
  const responses=await Promise.all([triage(),triage()])
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,201])
  const first=await responses[0]!.json()
  assert.deepEqual(await responses[1]!.json(),first)
  assert.equal(at.list().total,1)
  assert.equal(at.get(first.atendimentoId,true).purpose,'unclassified')
  const matches=customers.phoneMatches('+5531999990671')
  assert.equal(matches.length,1)
  assert.ok(customers.channelOwnerIsProvisional(matches[0]!.entityId!))
  assert.deepEqual(authority.links(jid).map(link=>[link.atendimento_id,link.linked_by]),[[first.atendimentoId,'operator']])
  assert.equal(authority.resolveIdentityActive(jid),null)
  const linked=await (await f.request(base+'/atendimentos','GET',undefined,f.browser)).json()
  assert.equal(linked.sendAtendimentoId,null)
  assert.equal(linked.activeAtendimentoId,null)
  assert.equal((await f.request('/api/atendimentos/'+first.atendimentoId+'/evolution-conversations/'+cid+'/messages?scope=linked',
    'GET',undefined,f.browser)).status,200)
  const webhook={...observedEvolutionUpsert,data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,
    messageTimestamp:Math.floor(Date.now()/1000),key:{remoteJid:jid,remoteJidAlt:null,id:'triage-first-webhook',fromMe:false}}}
  assert.equal((await f.sendEvent(webhook)).status,202)
  assert.equal(at.list().total,1)
  assert.equal(authority.resolveIdentityActive(jid),null)
  assert.equal(f.local.store.page(jid,1).items.length,2)
  const select=await f.request(base+'/context','POST',{linkId:linked.items[0].linkId},f.browser)
  assert.equal(select.status,200)
  assert.equal((await select.json()).activeAtendimentoId,first.atendimentoId)
  assert.equal(authority.resolveIdentityActive(jid),first.atendimentoId)
  assert.equal(f.sends,0)
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.db.close()}
})

test('triage rechecks Atendimento candidates and prior links after the eligibility preview',async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const at=new AtendimentoRepository(f.db),authority=f.local.authority!
  const jid='5531999990672@s.whatsapp.net',cid=authority.rememberProviderConversation(jid)
  const base='/api/chat/conversations/'+cid+'/atendimentos'
  f.local.store.observePage(jid,[{recordId:'synthetic',instanceId:INSTANCE,remoteJid:jid,remoteJidAlt:null,
    messageId:'stale-triage',timestamp:1767225599,fromMe:true,origin:'unknown',kind:'text',text:'Histórico sintético',media:null,statuses:[]}],1)
  const list=()=>f.request(base,'GET',undefined,f.browser).then(result=>result.json())
  assert.equal((await list()).canCreateTriage,true)
  const existing=at.create({name:'Ficha presencial concorrente',phone:'(31) 99999-0672'})
  const triage=()=>f.request(base+'/triagem','POST',{},f.browser)
  const conflict=await triage()
  assert.equal(conflict.status,409)
  assert.equal((await conflict.json()).error.code,'CHAT_TRIAGE_REVIEW_REQUIRED')
  const current=await list()
  assert.equal(current.canCreateTriage,false)
  assert.deepEqual(current.suggestedAtendimentos.map((row:{id:string})=>row.id),[existing.id])
  const link=await f.request(base,'POST',{expectedRevision:current.revision,requestId:randomUUID(),
    atendimentoId:existing.id,reason:'Vínculo explícito à ficha existente'},f.browser)
  assert.equal(link.status,201)
  assert.equal((await triage()).status,409)
  assert.equal(at.list().total,1)
  assert.equal(f.sends,0)
 }finally{f.db.close()}
})

test('triage requires PN evidence and refuses a positively identified self-chat',async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const authority=f.local.authority!
  const raw={...observedEvolutionUpsert,sender:'5531999990673@s.whatsapp.net',
    data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,messageTimestamp:1767225601}}
  for(const [jid,id] of [[raw.sender,'synthetic-known-self'],['synthetic-no-pn@lid','synthetic-no-pn']]){
   const cid=authority.rememberProviderConversation(jid!)
   const base='/api/chat/conversations/'+cid
   const event={...raw,data:{...raw.data,key:{remoteJid:jid,remoteJidAlt:null,id,fromMe:true}}}
   assert.equal((await f.sendEvent(event)).status,202)
   assert.equal((await f.request(base+'/messages?scope=technical','GET',undefined,f.browser)).status,200)
   const links=await (await f.request(base+'/atendimentos','GET',undefined,f.browser)).json()
   assert.ok(!links.canCreateTriage)
   assert.equal((await f.request(base+'/atendimentos/triagem','POST',{},f.browser)).status,409)
  }
  assert.equal(f.sends,0)
 }finally{f.db.close()}
})

test('first outgoing interaction preserves ambiguity, revocation and closed-case behavior',async()=>{
 for(const situation of ['ambiguous','legacy','conflict','revoked','closed'] as const){
  const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
  try{
   const at=new AtendimentoRepository(f.db),customers=new CustomerRepository(f.db)
   const jid='5531999990777@s.whatsapp.net'
   const owner=customers.save({kind:'entity',text:'Titular sintético',contacts:[{text:'(31) 99999-0777'}]})
   const contact=customers.contacts(owner.id)[0]!
   const ref={person:[{id:owner.id,text:owner.text}],contact:[{id:contact.id,text:contact.text}],vehicle:[],payer:[]}
   const legacy=situation==='legacy'||situation==='conflict'
   const original=legacy?at.create({name:'Ficha legada',phone:'5531999990777'}):at.create({references:ref,closed:situation==='closed'})
   if(situation==='conflict'){
    const other=customers.save({kind:'entity',text:'Outro titular'})
    f.db.prepare("INSERT INTO atendimento_references VALUES(?,'person',0,?,?)")
      .run(original.id,other.id,JSON.stringify({id:other.id,text:other.text}))
   }
   if(situation==='ambiguous')at.create({references:ref})
   const authority=f.local.authority!,cid=authority.rememberProviderConversation(jid),links=new V20AssociationRepository(f.db)
   if(situation==='revoked'){
    links.link({conversationId:cid,atendimentoId:original.id,expectedRevision:0,requestId:randomUUID(),reason:'Vínculo sintético'})
    links.selectAtendimento(cid,null)
   }
   const raw={...observedEvolutionUpsert,data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,
     messageTimestamp:Math.floor(Date.now()/1000)+2,key:{remoteJid:jid,remoteJidAlt:null,id:'outgoing-'+situation,fromMe:true}}}
   assert.equal((await f.sendEvent(raw)).status,202)
   assert.equal(at.list().total,['ambiguous','closed'].includes(situation)?2:1)
   assert.equal(f.local.store.page(jid,1).items.length,1)
   if(situation==='ambiguous'||situation==='conflict'){
    assert.equal(authority.resolveIdentityActive(jid),null)
    const result=await f.request('/api/chat/conversations/'+cid+'/atendimentos','GET',undefined,f.browser)
    const model=await result.json()
    assert.deepEqual(model.items,[])
    assert.equal(model.suggestedAtendimentos.length,situation==='ambiguous'?2:0)
    assert.equal(model.atendimentoConflict,situation==='conflict')
    if(situation==='ambiguous'){
     await f.sendEvent({...raw,data:{...raw.data,key:{...raw.data.key,id:'outgoing-before-choice'}}})
     assert.equal(at.list().total,2)
     const link=links.link({conversationId:cid,atendimentoId:original.id,expectedRevision:0,requestId:randomUUID(),reason:'Escolha explícita'})
     assert.equal(authority.resolveIdentityActive(jid),null)
     links.selectAtendimento(cid,link.linkId)
     assert.equal(authority.resolveIdentityActive(jid),original.id)
    }
   }
   if(situation==='legacy')assert.equal(authority.resolveIdentityActive(jid),original.id)
   if(situation==='revoked')assert.equal(authority.resolveIdentityActive(jid),null)
   if(situation==='closed'){
    assert.ok(at.get(original.id).closedAt)
    assert.notEqual(authority.resolveIdentityActive(jid),original.id)
    assert.ok(authority.resolveIdentityActive(jid))
   }
   assert.equal(f.sends,0)
  }finally{f.db.close()}
 }
})

test('first authenticated outgoing message reconciles a unique textual Atendimento by exact phone',async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const at=new AtendimentoRepository(f.db)
  // No Entidade or Contato record exists when the presencial ficha was saved.
  const commercial=commercialFixture(f.db)
  const original=at.update(commercial.at.id,{revision:at.get(commercial.at.id).revision,
    name:'Pessoa da ficha textual',phone:'(31) 99999-0666'})
  const budgets=new BudgetRepository(f.db)
  const input={scenarioId:commercial.scenario.id,negotiation:{mode:'none'} as const}
  const quote=await budgets.emit(original.id,{...input,previewToken:budgets.preview(original.id,input).token,idempotencyKey:randomUUID()})
  issueProductionOrder(f.db,original.id,quote.id)
  const commercialSnapshot=()=>['scenarios','budget_versions','budget_document_identity','work_orders','production_experiences']
    .map(table=>f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())
  const before=commercialSnapshot()
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM customer_records').get()!.n,0)
  const jid='5531999990666@s.whatsapp.net'
  const raw={...observedEvolutionUpsert,data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,
    messageTimestamp:Math.floor(Date.now()/1000)+2,
    key:{remoteJid:jid,remoteJidAlt:null,id:'first-text-only-outgoing',fromMe:true}}}
  const first=await f.sendEvent(raw)
  const replay=await f.sendEvent(raw)
  assert.equal(first.status,202)
  assert.equal(replay.status,202)
  assert.deepEqual(await replay.json(),await first.json())
  assert.equal(at.list().total,1)
  const authority=f.local.authority!,cid=authority.rememberProviderConversation(jid)
  assert.equal(authority.resolveIdentityActive(jid),original.id)
  const answer=await f.request('/api/chat/conversations/'+cid+'/atendimentos','GET',undefined,f.browser)
  assert.equal(answer.status,200)
  const model=await answer.json()
  assert.deepEqual(model.items.map((row:{atendimentoId:string})=>row.atendimentoId),[original.id])
  assert.equal((await f.request(`/api/atendimentos/${original.id}/evolution-conversations/${cid}/messages?scope=linked`,'GET',undefined,f.browser)).status,200)
  assert.equal(at.get(original.id).name,'Pessoa da ficha textual')
  const after=at.get(original.id,true)
  const [participant]=after.references!.person
  const [contact]=after.references!.contact
  assert.equal(after.references!.person.length,1)
  assert.equal(after.references!.contact.length,1)
  assert.ok(participant?.id&&contact?.id)
  assert.equal(new CustomerRepository(f.db).record(contact.id).entityId,participant.id)
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM customer_records WHERE kind='contact'").get()!.n,1)
  assert.equal((await f.sendEvent({...raw,data:{...raw.data,
    key:{...raw.data.key,id:'second-text-only-outgoing'}}})).status,202)
  assert.equal(at.list().total,1)
  assert.equal(f.local.store.page(jid,1).items.length,2)
  assert.deepEqual(commercialSnapshot(),before)
  assert.equal(f.sends,0)
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.db.close()}
})

test('short Brazilian WhatsApp identifier reuses its unique textual ficha',async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const at=new AtendimentoRepository(f.db)
  const original=at.create({name:'Ficha com número completo',phone:'(31) 99999-0680'})
  const jid='553199990680@s.whatsapp.net'
  const event={...observedEvolutionUpsert,data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,messageTimestamp:1767225601,
    key:{remoteJid:jid,remoteJidAlt:null,id:'outgoing-short-identifier',fromMe:true}}}
  assert.equal((await f.sendEvent(event)).status,202)
  assert.equal(at.list().total,1)
  assert.equal(f.local.authority!.links(jid).length,1)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()!.n,1)
  assert.equal(f.sends,0)
  const cid=f.local.authority!.rememberProviderConversation(jid)
  const linked=at.get(original.id,true)
  assert.equal(linked.id,original.id)
  assert.equal(linked.references!.person.length,1)
  assert.equal(linked.references!.contact.length,1)
  const saved=new CustomerRepository(f.db).record(linked.references!.contact[0]!.id!)
  assert.equal(saved.text,'+5531999990680')
  assert.equal(saved.entityId,linked.references!.person[0]!.id)
  assert.equal(saved.conversationId,cid)
  assert.equal(at.list().total,1)
 }finally{f.db.close()}
})

test('explicit short number review preserves the existing Contact, records the reason and only authorizes historical reading', async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const repo=new AtendimentoRepository(f.db),customers=new CustomerRepository(f.db),authority=f.local.authority!
  const owner=customers.save({kind:'entity',text:'Titular sintético confirmado',contacts:[{text:'(31) 99888-0717'}]})
  const contact=customers.contacts(owner.id)[0]!,at=repo.create({references:{person:[{id:owner.id,text:owner.text}],
    contact:[{id:contact.id,text:contact.text}],vehicle:[],payer:[]}})
  const jid='553198880717@s.whatsapp.net',cid=authority.rememberProviderConversation(jid),base='/api/chat/conversations/'+cid
  const route=base+'/atendimentos/'+at.id+'/numeracao'
  assert.equal((await f.request(route,'GET',undefined,f.browser)).status,409)
  const event={...observedEvolutionUpsert,data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,messageTimestamp:1767225601,
    key:{remoteJid:jid,remoteJidAlt:null,id:'inbound-need-number-review',fromMe:false}}}
  assert.equal((await f.sendEvent(event)).status,202)
  assert.equal(repo.list().total,1)
  assert.equal(authority.links(jid).length,1)
  assert.equal((await f.request(route)).status,401)
  const saved={linkId:String(authority.links(jid)[0]!.id)}
  assert.equal(customers.contacts(owner.id).length,1)
  const reviewed=customers.record(contact.id)
  assert.equal(reviewed.conversationId,cid)
  assert.equal(reviewed.entityId,owner.id)
  assert.equal(reviewed.text,contact.text)
  const associations=await (await f.request(base+'/atendimentos','GET',undefined,f.browser)).json()
  assert.equal(associations.historyOnly,true)
  assert.equal(associations.sendAtendimentoId,null)
  assert.equal(associations.items[0]?.atendimentoId,at.id)
  const context=await f.request(base+'/context','POST',{linkId:saved.linkId},f.browser)
  assert.equal(context.status,409)
  assert.equal((await context.json()).error.code,'CHAT_NUMBER_HISTORY_ONLY')
  assert.throws(()=>f.db.prepare('INSERT INTO v20_active_context VALUES(?,?)').run(cid,saved.linkId),/cannot authorize sending/)
  assert.equal(authority.canonicalChannelSendAllowed(jid),false)
  const historyPath=`/api/atendimentos/${at.id}/evolution-conversations/${cid}/messages?scope=linked`
  const history=await f.request(historyPath,'GET',undefined,f.browser)
  assert.equal(history.status,200)
  const messages=await history.json()
  assert.equal(messages.items[0]?.messageId,'inbound-need-number-review')
  assert.equal(messages.sendTextAvailable,undefined)
  assert.equal(f.sends,0)
  const unlink={expectedRevision:associations.revision,requestId:randomUUID(),reason:'Revogação explicitamente solicitada'}
  assert.equal((await f.request(base+'/atendimentos/'+saved.linkId,'DELETE',unlink,f.browser)).status,200)
  assert.equal((await f.request(historyPath,'GET',undefined,f.browser)).status,409)
  assert.equal(authority.links(jid).length,0)
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.db.close()}
})

test('a company channel with its linked owner and unnumbered Contact can read history while its conflict hold remains',async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const authority=f.local.authority!,customers=new CustomerRepository(f.db),at=new AtendimentoRepository(f.db)
  const jid='553189076449@s.whatsapp.net',cid=authority.rememberProviderConversation(jid)
  const {person,contact}=customers.createUnnumberedChannelContact('FUNIX',cid)
  const ficha=at.create({name:'FUNIX'})
  f.db.prepare("INSERT INTO atendimento_references VALUES(?,'person',0,?,?)").run(ficha.id,person.id,JSON.stringify({id:person.id,text:person.text}))
  f.db.prepare("INSERT INTO atendimento_references VALUES(?,'contact',0,?,?)").run(ficha.id,contact.id,JSON.stringify({id:contact.id,text:contact.text}))
  removeV25FixtureSchema(f.db)
  f.db.prepare(`INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason)
    VALUES(?,?,?,?,?,?)`).run(randomUUID(),cid,ficha.id,'2026-01-01T00:00:00.000Z','operator','Legacy company channel')
  migrate(f.db)
  f.db.prepare("INSERT INTO chat_local_context_holds VALUES(?,'autonomous_contact_conflict')").run(cid)
  assert.equal(authority.technicalHistoryJid(cid),jid)
  assert.equal(authority.linkedHistoryJid(ficha.id,cid),jid)
  assert.equal(authority.canonicalChannelSendAllowed(jid),false)
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM chat_local_context_holds WHERE conversation_id=?').get(cid)!.n,1)
 }finally{f.db.close()}
})

test('new interaction with only a short mobile number creates one read-only triage without guessing a civil phone',async t=>{
 for(const alternate of [null,'short-number-synthetic@lid'])await t.test(alternate?'with provider LID':'with PN only',async()=>{
  const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
  try{
   const repo=new AtendimentoRepository(f.db),customers=new CustomerRepository(f.db),authority=f.local.authority!
   const jid='553198880718@s.whatsapp.net'
   const event={...observedEvolutionUpsert,data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,messageTimestamp:1767225601,
     key:{remoteJid:jid,remoteJidAlt:alternate,id:'inbound-short-number-new-triage',fromMe:false}}}
   const first=await f.sendEvent(event)
   assert.equal(first.status,202)
   assert.deepEqual(await (await f.sendEvent(event)).json(),await first.json())
   const [item]=repo.list().items
   assert.equal(repo.list().total,1)
   assert.equal(item?.purpose,'unclassified')
   const ficha=repo.get(item!.id,true),[person]=ficha.references!.person,[reference]=ficha.references!.contact
   assert.ok(person?.id&&reference?.id)
   const contact=customers.record(reference.id),cid=authority.rememberProviderConversation(jid)
   assert.equal(contact.text,'')
   assert.equal(contact.entityId,person.id)
   assert.equal(contact.conversationId,cid)
   assert.equal(authority.canonicalChannelSendAllowed(jid),false)
   const base='/api/chat/conversations/'+cid
   const links=await (await f.request(base+'/atendimentos','GET',undefined,f.browser)).json()
   assert.equal(links.historyOnly,true)
   assert.equal(links.sendAtendimentoId,null)
   assert.equal(links.items[0]?.atendimentoId,ficha.id)
   assert.equal((await f.request(base+'/context','POST',{linkId:links.items[0]?.linkId},f.browser)).status,409)
   const history=await f.request(`/api/atendimentos/${ficha.id}/evolution-conversations/${cid}/messages?scope=linked`,'GET',undefined,f.browser)
   assert.equal(history.status,200)
   assert.equal((await history.json()).items[0]?.messageId,'inbound-short-number-new-triage')
   const closed=repo.update(ficha.id,{revision:ficha.revision,closed:true})
   const next={...event,data:{...event.data,messageTimestamp:Math.floor(Date.parse(closed.closedAt!)/1000)+2,
     key:{...event.data.key,id:'inbound-short-number-after-close'}}}
   assert.equal((await f.sendEvent(next)).status,202)
   assert.equal((await f.sendEvent(next)).status,202)
   assert.equal(repo.list().total,2)
   assert.equal(customers.contacts(person.id).length,1)
   assert.equal(authority.resolveIdentityActive(jid),null)
   assert.equal(f.sends,0)
  }finally{f.db.close()}
 })
})

test('historical short number can start triage only after an explicit action and observed messages',async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const at=new AtendimentoRepository(f.db),authority=f.local.authority!
  const jid='553198880719@s.whatsapp.net',cid=authority.rememberProviderConversation(jid)
  const base='/api/chat/conversations/'+cid
  const triage=()=>f.request(base+'/atendimentos/triagem','POST',{},f.browser)
  assert.equal((await triage()).status,409)
  f.setProviderHistory({items:[{recordId:'synthetic',instanceId:INSTANCE,remoteJid:jid,remoteJidAlt:null,
    messageId:'old-short-triage',timestamp:1767225599,fromMe:false,origin:'unknown',kind:'text',text:'Histórico sintético',media:null,statuses:[]}],
    currentPage:1,reportedTotal:1,reportedPages:1,nextPage:null,consistency:'offset-not-snapshot'})
  assert.equal((await f.request(base+'/messages?scope=technical','GET',undefined,f.browser)).status,200)
  assert.equal(at.list().total,0)
  assert.equal((await (await f.request(base+'/atendimentos','GET',undefined,f.browser)).json()).canCreateTriage,true)
  const choices=await Promise.all([triage(),triage()])
  assert.deepEqual(choices.map(response=>response.status).sort(),[200,201])
  assert.deepEqual(await choices[0]!.json(),await choices[1]!.json())
  assert.equal(at.list().total,1)
  assert.equal(at.list().items[0]?.phone,'')
  assert.equal(authority.resolveIdentityActive(jid),null)
  assert.equal(f.sends,0)
 }finally{f.db.close()}
})

test('existing V24 links recover short-number history only after review of the same ficha and customer',async t=>{
 for(const bound of [false,true])await t.test(bound?'same Contact already has the handle':'previous link without a bound Contact',async()=>{
  const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
  try{
   const customers=new CustomerRepository(f.db),atendimentos=new AtendimentoRepository(f.db),authority=f.local.authority!
   const owner=customers.save({kind:'entity',text:'Titular sintético já vinculado',contacts:[{text:'(31) 99888-0717'}]})
   const contact=customers.contacts(owner.id)[0]!,references={person:[{id:owner.id,text:owner.text}],
    contact:[{id:contact.id,text:contact.text}],vehicle:[],payer:[]}
   const original=atendimentos.create({references}),other=atendimentos.create({references})
   const jid='553198880717@s.whatsapp.net',cid=authority.rememberProviderConversation(jid)
   const links=new V20AssociationRepository(f.db)
   removeV25FixtureSchema(f.db)
   if(bound)f.db.prepare('UPDATE customer_records SET conversation_id=? WHERE id=?').run(cid,contact.id)
   const legacy=links.link({conversationId:cid,atendimentoId:original.id,expectedRevision:0,requestId:randomUUID(),reason:'Vínculo histórico V24'})
   links.selectAtendimento(cid,legacy.linkId)
   const originalLink=f.db.prepare('SELECT * FROM v20_associations WHERE id=?').get(legacy.linkId)
   migrate(f.db)
   const event={...observedEvolutionUpsert,data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,messageTimestamp:1767225601,
    key:{remoteJid:jid,remoteJidAlt:null,id:'existing-short-link-history',fromMe:false}}}
   assert.equal((await f.sendEvent(event)).status,202)
   const base=`/api/chat/conversations/${cid}`,review=(id:string)=>`${base}/atendimentos/${id}/numeracao`
   const history=`/api/atendimentos/${original.id}/evolution-conversations/${cid}/messages?scope=linked`
   assert.equal((await f.request(history,'GET',undefined,f.browser)).status,409)
   const list=await (await f.request(`${base}/atendimentos`,'GET',undefined,f.browser)).json()
   assert.equal(list.numberReviewAvailable,true)
   assert.equal(list.readIdentityBlocked,true)
   assert.equal(list.items[0]?.linkId,legacy.linkId)
   assert.equal((await f.request(review(other.id),'GET',undefined,f.browser)).status,409)
   const preview=await f.request(review(original.id),'GET',undefined,f.browser)
   assert.equal(preview.status,200)
   const {token,contactId}=await preview.json()
   assert.equal(contactId,contact.id)
   const input={token,requestId:randomUUID(),reason:'Revisão do vínculo histórico já existente'}
   const response=await f.request(review(original.id),'POST',input,f.browser)
   assert.equal(response.status,200)
   const repaired=await response.json()
   assert.equal(repaired.linkId,legacy.linkId)
   assert.deepEqual(await (await f.request(review(original.id),'POST',input,f.browser)).json(),repaired)
   assert.deepEqual(f.db.prepare('SELECT * FROM v20_associations WHERE id=?').get(legacy.linkId),originalLink)
   assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM v20_associations').get()!.n,1)
   assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM v20_active_context').get()!.n,0)
   assert.equal((await f.request(`${base}/context`,'POST',{linkId:legacy.linkId},f.browser)).status,409)
   const saved=customers.record(contact.id)
   assert.equal(saved.entityId,owner.id)
   assert.equal(saved.text,contact.text)
   assert.equal(saved.conversationId,cid)
   const restored=await f.request(history,'GET',undefined,f.browser)
   assert.equal(restored.status,200)
   const content=await restored.json()
   assert.equal(content.items[0]?.messageId,'existing-short-link-history')
   assert.equal(content.sendTextAvailable,undefined)
   assert.equal(f.sends,0)
   assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
  }finally{f.db.close()}
 })
})

test('a textual candidate and a ficha of another owner never resolve silently',async()=>{
 const f=await fixture(true,false,'2026-01-01T00:00:00.000Z')
 try{
  const at=new AtendimentoRepository(f.db),customers=new CustomerRepository(f.db),authority=f.local.authority!
  const other=customers.save({kind:'entity',text:'Outro titular sintético'})
  const original=at.create({name:'Ficha exclusivamente textual',phone:'(31) 99999-0674'})
  const incompatible=at.create({references:{person:[{id:other.id,text:other.text}],contact:[],vehicle:[],payer:[]}})
  const owner=customers.save({kind:'entity',text:'Titular do número sintético',contacts:[{text:'(31) 99999-0674'}]})
  const contact=customers.contacts(owner.id)[0]!
  // Represent older contradictory evidence that the current manual editor rejects.
  f.db.prepare("INSERT INTO atendimento_references VALUES(?,'contact',0,NULL,?)")
    .run(incompatible.id,JSON.stringify({id:null,text:'+5531999990674'}))
  const saved=at.get(incompatible.id,true)
  const jid='5531999990674@s.whatsapp.net'
  const event={...observedEvolutionUpsert,data:{...observedEvolutionUpsert.data,instanceId:INSTANCE,messageTimestamp:1767225601,
    key:{remoteJid:jid,remoteJidAlt:null,id:'textual-conflict-first-outgoing',fromMe:true}}}
  assert.equal((await f.sendEvent(event)).status,202)
  const cid=authority.rememberProviderConversation(jid),base='/api/chat/conversations/'+cid
  assert.equal(at.list().total,2)
  assert.equal(authority.resolveIdentityActive(jid),null)
  const model=await (await f.request(base+'/atendimentos','GET',undefined,f.browser)).json()
  assert.deepEqual(model.items,[])
  assert.equal(model.atendimentoConflict,true)
  assert.deepEqual(model.suggestedAtendimentos.map((row:{id:string})=>row.id),[original.id])
  const link=await f.request(base+'/atendimentos','POST',{atendimentoId:original.id,expectedRevision:model.revision,
    requestId:randomUUID(),reason:'Escolha explícita após conferência dos titulares'},f.browser)
  assert.equal(link.status,201)
  assert.equal(authority.resolveIdentityActive(jid),null)
  assert.equal((await f.request(base+'/context','POST',{linkId:(await link.json()).linkId},f.browser)).status,200)
  assert.equal((await f.sendEvent({...event,data:{...event.data,key:{...event.data.key,id:'textual-conflict-follow-up',fromMe:false}}})).status,202)
  assert.equal(authority.resolveIdentityActive(jid),original.id)
  assert.equal(at.list().total,2)
  assert.deepEqual(at.get(incompatible.id,true),saved)
  assert.equal(customers.record(contact.id).entityId,owner.id)
  assert.equal(f.sends,0)
 }finally{f.db.close()}
})
