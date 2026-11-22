import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CustomerRepository} from '../customers.ts'
import {loadConversationRuntime} from '../chat/conversation-runtime.ts'
import {openDatabase} from '../database.ts'
import {migrate} from '../migrations.ts'
import {removeV25FixtureSchema} from './fixtures/production.ts'

const cutoff='2026-01-01T00:00:00.000Z'
const entrypoint=new URL('../recover-short-chats.ts',import.meta.url)
const environment={FUNIX_CHAT_LOCAL_ENABLED:'true',FUNIX_CHAT_AUTONOMOUS_ENABLED:'true',FUNIX_CHAT_AUTONOMOUS_SINCE:cutoff}

test('short chat recovery creates triage, reuses existing fichas and preserves prior links',()=>{
  const folder=mkdtempSync(join(tmpdir(),'funix-short-recovery-')),path=join(folder,'fixture.sqlite'),backup=join(folder,'backup.sqlite')
  try{
    const db=openDatabase(path)
    const runtime=loadConversationRuntime(environment,db)!
    const authority=runtime.authority!
    const at=new AtendimentoRepository(db)
    const saved=at.create({name:'Ficha sintética existente',phone:'(31) 99999-0912'})
    const legacy=at.create({name:'Ficha legada sintética'})
    db.prepare('UPDATE atendimentos SET phone=? WHERE id=?').run('(31) 9999-0918',legacy.id)
    const customers=new CustomerRepository(db)
    const makeReferences=(phone:string)=>{
      const owner=customers.save({kind:'entity',text:'Titular sintético '+phone,contacts:[{text:phone}]})
      const contact=customers.contacts(owner.id)[0]!
      return {person:[{id:owner.id,text:owner.text}],contact:[{id:contact.id,text:contact.text}],vehicle:[],payer:[]}
    }
    const existing=at.create({references:makeReferences('(31) 99999-0919')})
    const sharedRefs=makeReferences('(31) 99999-0920')
    at.create({references:sharedRefs})
    at.create({references:sharedRefs})
    const jids=['553199990911','553199990912','553199990913','553199990914',
      '553199990915','553199990916','553199990917','553199990918','553199990919','553199990920'].map(pn=>pn+'@s.whatsapp.net')
    const lid='short-recovery-fixture@lid'
    for(const [index,jid] of jids.entries()){
      const remote=index===4?lid:jid
      const cid=authority.rememberProviderConversation(remote)
      db.prepare('INSERT INTO chat_local_context_holds VALUES(?,?)').run(cid,'autonomous_contact_conflict')
      if(index===2)db.prepare('UPDATE v20_conversations SET context_revision=1 WHERE id=?').run(cid)
      if(index!==3)runtime.store.ingest(JSON.stringify({schemaVersion:2,instance:'funix_comercial',eventId:'synthetic-recovery-'+index,
        type:'message.upsert',occurredAt:'2026-01-02T00:00:00.000Z',displayName:'Pessoa sintética',message:{remoteJid:remote,remoteJidAlt:index===4?jid:null,
          messageId:'message-'+index,timestamp:1767312000,fromMe:index>=4,kind:'text',text:'Fixture sintética',media:null,statuses:[]}}))
      else runtime.store.observePage(jid,[{recordId:'synthetic',instanceId:'synthetic',remoteJid:jid,remoteJidAlt:null,
        messageId:'snapshot-only',timestamp:1767312000,fromMe:false,origin:'unknown',kind:'text',text:'Histórico sintético',media:null,statuses:[]}],1)
      // These messages were persisted, but the current data has no automatic hold.
      if(index>=4)db.prepare('DELETE FROM chat_local_context_holds WHERE conversation_id=?').run(cid)
      if(index===5)db.prepare('INSERT INTO conversation_initialization VALUES(?,?,?,?,?,?)')
        .run(cid,null,'synthetic-closed','2026-01-02T00:00:00.000Z','{}','closed')
      if(index===6)db.prepare('INSERT INTO chat_local_context_holds VALUES(?,?)').run(cid,'ambiguous_atendimento_candidates')
      if(index===8){
        removeV25FixtureSchema(db)
        db.prepare(`INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason)
          VALUES('synthetic-original-link',?,?,'2026-01-01T00:00:00.000Z','operator','legacy')`).run(cid,existing.id)
        migrate(db)
      }
    }
    assert.equal(at.list().total,5)
    db.close()
    const cli=(...args:string[])=>JSON.parse(execFileSync(process.execPath,[entrypoint.pathname,path,...args],{
      env:{...process.env,FUNIX_CHAT_AUTONOMOUS_SINCE:cutoff},encoding:'utf8',stdio:['ignore','pipe','pipe'],
    }))
    const plan=cli('--preview')
    assert.equal(plan.eligible,4)
    assert.equal(plan.createTriage,2)
    assert.equal(plan.reuseAtendimento,1)
    assert.equal(plan.restoreHistory,1)
    assert.equal(plan.existingOrRevoked,2)
    assert.equal(plan.needsIdentityReview,3)
    assert.equal(plan.noAuthenticatedMessage,1)
    assert.throws(()=>cli('--apply','0'.repeat(64),backup))
    assert.equal(cli('--apply',plan.digest,backup).applied,4)
    assert.equal(cli('--preview').eligible,0)
    const live=openDatabase(path),snapshot=openDatabase(backup)
    try{
      assert.equal(new AtendimentoRepository(snapshot).list().total,5)
      const records=new AtendimentoRepository(live)
      assert.equal(records.list().total,7)
      assert.equal(records.get(saved.id).name,saved.name)
      assert.equal(live.prepare('SELECT count(*) AS n FROM chat_messages').get()?.n,10)
      assert.equal(live.prepare('SELECT count(*) AS n FROM v20_active_context').get()?.n,0)
      assert.equal(live.prepare('SELECT count(*) AS n FROM v20_associations').get()?.n,4)
      assert.deepEqual(live.prepare(`SELECT v.remote_jid FROM v20_associations a JOIN v20_conversations v ON v.id=a.conversation_id
        ORDER BY v.remote_jid`).all().map(row=>row.remote_jid),[jids[0],jids[1],jids[8],lid])
      const recovered=loadConversationRuntime(environment,live)!.authority!
      assert.equal(recovered.linkedHistoryJid(existing.id,recovered.rememberProviderConversation(jids[8]!)),jids[8])
      assert.equal(recovered.linkedHistoryJid(saved.id,recovered.rememberProviderConversation(jids[1]!)),jids[1])
      assert.equal(recovered.canonicalChannelSendAllowed(jids[8]!),false)
      assert.equal(recovered.canonicalChannelSendAllowed(jids[1]!),false)
      const originalLink="SELECT * FROM v20_associations WHERE id='synthetic-original-link'"
      assert.deepEqual(live.prepare(originalLink).get(),snapshot.prepare(originalLink).get())
      assert.deepEqual(live.prepare('PRAGMA foreign_key_check').all(),[])
    }finally{live.close();snapshot.close()}
  }finally{rmSync(folder,{recursive:true,force:true})}
})
