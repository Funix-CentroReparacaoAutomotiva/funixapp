import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../database.ts'
import { createDevelopmentSourceLedgerSchema, DevelopmentSourceLedger } from '../chat/coda-source-storage-dev.ts'
import type { ImmutableWhatsAppSource } from '../chat/coda-source-ledger-dev.ts'

const now=1794150000000
const source=(id='evo:funix_comercial:message1'):ImmutableWhatsAppSource=>({
  eventId:id,remoteJid:'5531999990001@s.whatsapp.net',
  phoneE164:'+5531999990001',displayName:'Contato Sintético',
  occurredAt:1794144000,instance:'funix_comercial',source:'whatsapp',suppressed:false,
})
test('source storage: immutable retries, conflict detection, no manual/suppressed source',()=>{
  const db=openDatabase(':memory:')
  try{
    createDevelopmentSourceLedgerSchema(db)
    const ledger=new DevelopmentSourceLedger(db)
    assert.equal(ledger.append(source(),now),'created')
    assert.equal(ledger.append(source(),now),'existing')
    assert.throws(()=>ledger.append({...source(),displayName:'Outro'},now),/SOURCE_LEDGER_CONFLICT/)
    assert.throws(()=>ledger.append({...source(),suppressed:true as false},now),/SOURCE_LEDGER_INVALID/)
    assert.throws(()=>ledger.append({...source(),source:'manual' as 'whatsapp'},now),/SOURCE_LEDGER_INVALID/)
    assert.equal(ledger.readPage('',10).entries.length,1)
  }finally{db.close()}
})
test('source storage: survives SQLite restart and keyset pagination without duplicated events',()=>{
  const folder=mkdtempSync(join(tmpdir(),'funix-source-ledger-'))
  const path=join(folder,'source.sqlite')
  try{
    const db=openDatabase(path)
    try{
      createDevelopmentSourceLedgerSchema(db)
      const ledger=new DevelopmentSourceLedger(db)
      for(const id of ['evo:funix_comercial:message2','evo:funix_comercial:message1','evo:funix_comercial:message3'])
        assert.equal(ledger.append(source(id),now),'created')
    } finally{db.close()}
    const reopened=openDatabase(path)
    try{
      createDevelopmentSourceLedgerSchema(reopened)
      const ledger=new DevelopmentSourceLedger(reopened)
      const first=ledger.readPage('',2)
      assert.equal(first.entries.length,2)
      assert.equal(first.entries[0]?.eventId,'evo:funix_comercial:message1')
      assert.ok(first.nextCursor)
      const second=ledger.readPage(first.nextCursor!,2)
      assert.equal(second.entries.length,1)
      assert.equal(second.nextCursor,null)
      assert.equal(second.entries[0]?.eventId,'evo:funix_comercial:message3')
    } finally{reopened.close()}
  }finally{rmSync(folder,{recursive:true,force:true})}
})
test('source storage: original event timestamp, exact PN/JID and name restrictions',()=>{
  const db=openDatabase(':memory:')
  try{
    createDevelopmentSourceLedgerSchema(db)
    const ledger=new DevelopmentSourceLedger(db)
    assert.throws(()=>ledger.append({...source(),occurredAt:NaN},now),/SOURCE_LEDGER_INVALID/)
    assert.throws(()=>ledger.append({...source(),phoneE164:'+5531999990002'},now),/SOURCE_LEDGER_INVALID/)
    assert.throws(()=>ledger.append({...source(),remoteJid:'abc@lid'},now),/SOURCE_LEDGER_INVALID/)
    assert.throws(()=>ledger.append({...source(),displayName:'Name\nInjected'},now),/SOURCE_LEDGER_INVALID/)
    assert.deepEqual(ledger.readPage('',10).entries,[])
  }finally{db.close()}
})
