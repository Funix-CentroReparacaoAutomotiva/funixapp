import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../database.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../chat/coda-sync.ts'
import { createEvolutionChatBridge } from '../chat/evolution-bridge.ts'
import { EvolutionReadError, EvolutionReadPoc, type ReadChat } from '../experimental/evolution-read/client.ts'
import { envelope, syntheticMessage, INSTANCE } from './fixtures/evolution-read.ts'

const PN = '000000000001@s.whatsapp.net', PN2 = '000000000002@s.whatsapp.net'
const LID = 'synthetic-fabio@lid', LID2 = 'synthetic-drico@lid'
const row = (remoteJid = LID, remoteJidAlt: string | null = PN): ReadChat => ({
  remoteJid, remoteJidAlt, displayName: 'Contato sintético', phoneNumber: null, updatedAt: null, unreadCount: null,
})
function fixture(path = ':memory:') {
  const db = openDatabase(path)
  createCodaEventSchema(db)
  const repo = new CodaEventSyncRepository(db)
  let rows = [row()], error: Error | null = null, delayed: (() => void) | null = null
  let clock = 0
  const reads: string[] = [], sends: string[] = []
  let records = [syntheticMessage(1, { key: { id: 'msg-1', remoteJid: LID, remoteJidAlt: PN, fromMe: false } })]
  const provider = new EvolutionReadPoc({ instance: 'funix_comercial', instanceId: INSTANCE,
    transport: async request => {
      reads.push(String((request.body.where as {key:{remoteJid:string}}).key.remoteJid))
      delayed?.()
      if (error) throw error
      return { status: 200, body: envelope(records) }
    },
  })
  const bridge = () => createEvolutionChatBridge({
    findChatsPage: async () => ({ items: rows, sourceCount: rows.length }),
    findMessages: provider.findMessages.bind(provider),
  }, () => clock, undefined, repo, async recipient => { sends.push(recipient); return { messageId: 'sent-1' } })
  const event = (codaRowId = 'i-SYNTH_A', remoteJid = PN, occurredAt = 100, eventId = `${codaRowId}:${remoteJid.split('@')[0]}:${occurredAt}`) => ({
    version: 1, source: 'coda', eventId, codaRowId, instance: 'funix_comercial',
    remoteJid, phoneE164: null, displayName: 'Contato sintético', occurredAt,
  })
  return { db, repo, bridge, event, reads, sends,
    rows: (next: ReadChat[]) => { rows = next },
    records: (next: typeof records) => { records = next },
    fail: (next: Error | null) => { error = next },
    during: (callback: () => void) => { delayed = callback },
    expire: () => { clock += 31 * 60 * 1000 },
  }
}

test('durable identity: exact PN, no phone required for authorization', async () => {
  const f = fixture()
  try {
    f.rows([row(PN, null)])
    f.records([syntheticMessage(1)])
    const id = f.repo.sync(f.event()).atendimentoId, bridge = f.bridge()
    const listed = (await bridge.list(0)).items[0]!
    assert.equal(listed.atendimentoId, id)
    assert.equal((await bridge.messagesForAtendimento(id,listed.conversationId,1))?.items.length,1)
    assert.deepEqual(await bridge.sendTextForAtendimento(id,listed.conversationId,'Teste sintético'), {state:'accepted',receipt:{messageId:'sent-1'}})
    assert.deepEqual(f.sends,[PN])
  } finally { f.db.close() }
})

test('durable identity: Norte Sul Fabio shape, late Coda event, Funil and list use same LID history', async () => {
  const f = fixture()
  try {
    const bridge = f.bridge(), listed = (await bridge.list(0)).items[0]!
    assert.equal(listed.atendimentoId,null)
    const id = f.repo.sync(f.event()).atendimentoId
    assert.equal(bridge.activeAtendimentoForConversation(listed.conversationId),id)
    assert.equal(f.db.prepare('SELECT phone FROM atendimentos WHERE id=?').get(id)!.phone,'')
    assert.deepEqual(bridge.conversationForAtendimento(id),{conversationId:listed.conversationId})
    assert.equal((await bridge.messagesForAtendimento(id,listed.conversationId,1))?.items[0]?.text,'Synthetic 1')
    assert.deepEqual(f.reads,[LID])
    await bridge.sendTextForAtendimento(id,listed.conversationId,'Texto sintético')
    assert.deepEqual(f.sends,[PN])
  } finally { f.db.close() }
})

test('durable identity: Drico shape with provider PN evidence but no canonical event remains pending without duplicates', async () => {
  const f = fixture()
  try {
    f.rows([row(LID2,PN2)])
    const bridge=f.bridge(), listed=(await bridge.list(0)).items[0]!
    assert.equal(listed.atendimentoId,null)
    assert.equal(bridge.activeAtendimentoForConversation(listed.conversationId),null)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),0)
    assert.equal((await bridge.sendTextForAtendimento('wrong',listed.conversationId,'Teste')).state,'unlinked')
    assert.deepEqual(f.sends,[])
  } finally { f.db.close() }
})

test('durable identity: never-seen alternate is not inferred', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId
    f.rows([row(LID,null)])
    const bridge=f.bridge(), item=(await bridge.list(0)).items[0]!
    assert.equal(item.atendimentoId,null)
    assert.equal(await bridge.messagesForAtendimento(id,item.conversationId,1),null)
    assert.deepEqual(f.reads,[])
  } finally { f.db.close() }
})

test('durable identity: missing latest alternate and expired cache preserve established evidence', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId, bridge=f.bridge()
    const item=(await bridge.list(0)).items[0]!
    f.expire(); f.rows([row(LID,null)])
    assert.equal((await bridge.list(0)).items[0]!.conversationId,item.conversationId)
    assert.equal(bridge.activeAtendimentoForConversation(item.conversationId),id)
    assert.equal((await bridge.messagesForAtendimento(id,item.conversationId,1))?.items.length,1)
  } finally { f.db.close() }
})

test('durable identity: real SQLite close/reopen preserves opaque IDs, evidence and Funil resolution', async () => {
  const directory=mkdtempSync(join(tmpdir(),'funix-identity-')), path=join(directory,'test.sqlite')
  let f=fixture(path)
  try {
    const id=f.repo.sync(f.event()).atendimentoId
    const conversationId=(await f.bridge().list(0)).items[0]!.conversationId
    f.db.close(); f=fixture(path)
    const bridge=f.bridge()
    assert.deepEqual(bridge.conversationForAtendimento(id),{conversationId})
    assert.equal(bridge.activeAtendimentoForConversation(conversationId),id)
    assert.equal((await bridge.messagesForAtendimento(id,conversationId,1))?.items.length,1)
  } finally { f.db.close(); rmSync(directory,{recursive:true,force:true}) }
})

test('durable identity: changed alternate quarantines old/new PN and survives refresh/restart', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId, bridge=f.bridge()
    const item=(await bridge.list(0)).items[0]!
    f.rows([row(LID,PN2)]); await bridge.list(50)
    f.rows([row()]); await bridge.list(0)
    for (const jid of [PN,PN2,LID]) assert.equal(f.repo.identityJids(jid),null)
    assert.equal(f.bridge().conversationForAtendimento(id),null)
    assert.equal(await bridge.messagesForAtendimento(id,item.conversationId,1),null)
    assert.equal((await bridge.sendTextForAtendimento(id,item.conversationId,'Bloquear')).state,'unlinked')
    assert.deepEqual(f.reads,[]); assert.deepEqual(f.sends,[])
  } finally { f.db.close() }
})

test('durable identity: two LIDs sharing PN discovered on separate pages block BOTH including direct PN send', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId, bridge=f.bridge()
    const item=(await bridge.list(0)).items[0]!
    const direct=f.repo.rememberProviderConversation(PN)
    f.rows([row(LID2,PN)]); await bridge.list(50)
    assert.equal(bridge.activeAtendimentoForConversation(item.conversationId),null)
    assert.equal((await bridge.sendTextForAtendimento(id,direct,'Bloquear')).state,'unlinked')
    assert.deepEqual(f.sends,[])
  } finally { f.db.close() }
})

test('durable identity: duplicated/out-of-order events preserve newest context without reconciliation duplicates', async () => {
  const f=fixture()
  try {
    const first=f.repo.sync(f.event()).atendimentoId
    const latest=f.repo.sync(f.event('i-SYNTH_B',PN,200)).atendimentoId
    f.repo.sync(f.event()); f.repo.sync(f.event('i-SYNTH_A',PN,150))
    const bridge=f.bridge(), item=(await bridge.list(0)).items[0]!
    assert.equal(item.atendimentoId,latest)
    assert.equal(bridge.conversationForAtendimento(first),null)
    assert.equal(await bridge.messagesForAtendimento(first,item.conversationId,1),null)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),2)
    assert.equal((await bridge.messagesForAtendimento(latest,item.conversationId,1))?.items.length,1)
  } finally { f.db.close() }
})

test('durable identity: divergent active Coda contexts on PN/LID block list, Funil and sending', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId
    f.repo.sync(f.event('i-SYNTH_B',LID,200))
    const bridge=f.bridge(), item=(await bridge.list(0)).items[0]!
    assert.equal(item.atendimentoId,null); assert.equal(bridge.conversationForAtendimento(id),null)
    assert.equal((await bridge.sendTextForAtendimento(id,item.conversationId,'Bloquear')).state,'unlinked')
    assert.deepEqual(f.sends,[])
  } finally { f.db.close() }
})

test('durable identity: confirmed Atendimento with provider failure throws; retry reads without duplicate links', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId, bridge=f.bridge(), item=(await bridge.list(0)).items[0]!
    f.fail(new Error('private provider exception'))
    await assert.rejects(bridge.messagesForAtendimento(id,item.conversationId,1), (e:unknown)=>e instanceof EvolutionReadError && e.code==='TRANSPORT')
    f.fail(null)
    assert.equal((await bridge.messagesForAtendimento(id,item.conversationId,1))?.items.length,1)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM coda_sync_conversation_links').get()!.n),1)
  } finally { f.db.close() }
})

test('durable identity: legitimate empty history returns an empty page, not an authorization/provider failure', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId, bridge=f.bridge(), item=(await bridge.list(0)).items[0]!
    f.records([])
    const result=await bridge.messagesForAtendimento(id,item.conversationId,1)
    assert.deepEqual(result?.items,[]); assert.equal(result?.reportedTotal,0); assert.equal(result?.nextPage,null)
  } finally { f.db.close() }
})

test('durable identity: active context changing during fetch withholds history and prevents old context sending', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId, bridge=f.bridge(), item=(await bridge.list(0)).items[0]!
    f.during(()=>f.repo.sync(f.event('i-SYNTH_B',PN,200)))
    assert.equal(await bridge.messagesForAtendimento(id,item.conversationId,1),null)
    assert.equal((await bridge.sendTextForAtendimento(id,item.conversationId,'Bloquear')).state,'unlinked')
    assert.deepEqual(f.sends,[])
  } finally { f.db.close() }
})

test('durable identity: another LID in history claiming the same PN is quarantined before disclosing messages', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId, bridge=f.bridge(), item=(await bridge.list(0)).items[0]!
    f.records([syntheticMessage(1,{key:{id:'bad',remoteJid:LID2,remoteJidAlt:PN,fromMe:false}})])
    await assert.rejects(bridge.messagesForAtendimento(id,item.conversationId,1), (e:unknown)=>e instanceof EvolutionReadError && e.code==='SCOPE')
  } finally { f.db.close() }
})

test('durable identity: conflict discovered within history cannot disclose or enable sending', async () => {
  const f=fixture()
  try {
    const id=f.repo.sync(f.event()).atendimentoId, bridge=f.bridge(), item=(await bridge.list(0)).items[0]!
    f.records([syntheticMessage(1,{key:{id:'bad',remoteJid:LID,remoteJidAlt:PN2,fromMe:false}})])
    assert.equal(await bridge.messagesForAtendimento(id,item.conversationId,1),null)
    assert.equal(bridge.conversationForAtendimento(id),null)
    assert.equal((await bridge.sendTextForAtendimento(id,item.conversationId,'Bloquear')).state,'unlinked')
    assert.deepEqual(f.sends,[])
  } finally { f.db.close() }
})

test('conflicting same-time ERP confirmation durably blocks prior context and generic read until newer confirmation', async () => {
  const f=fixture()
  try {
    const first=f.repo.sync(f.event()).atendimentoId, bridge=f.bridge()
    const item=(await bridge.list(0)).items[0]!
    assert.throws(()=>f.repo.sync(f.event('i-SYNTH_B',PN,100)), /inconsistente/)
    assert.equal(f.repo.resolveIdentityActive(PN),null)
    assert.equal(await bridge.messages(item.conversationId,1),null)
    assert.equal((await bridge.sendTextForAtendimento(first,item.conversationId,'Bloquear')).state,'unlinked')
    f.repo.sync(f.event()) // replay must not remove a known conflict
    assert.equal(f.repo.resolveIdentityActive(PN),null)
    const latest=f.repo.sync(f.event('i-SYNTH_A',PN,101)).atendimentoId
    assert.equal(f.repo.resolveIdentityActive(PN),latest)
    assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n),1)
  }finally{f.db.close()}
})

test('generic history cannot bypass PN/LID quarantine even with a known stable conversation handle', async()=>{
  const f=fixture()
  try{
    f.repo.sync(f.event());const bridge=f.bridge(),item=(await bridge.list(0)).items[0]!
    f.repo.rememberProviderAliases([row(LID2,PN)])
    assert.equal(await bridge.messages(item.conversationId,1),null)
    assert.deepEqual(f.reads,[])
  }finally{f.db.close()}
})
