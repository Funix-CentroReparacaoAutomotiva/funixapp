import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {AtendimentoRepository} from '../atendimentos.ts'
import {loadConversationRuntime} from '../chat/conversation-runtime.ts'
import {openDatabase} from '../database.ts'

const cutoff='2026-01-01T00:00:00.000Z'
const entrypoint=new URL('../recover-short-chats.ts',import.meta.url)
const environment={FUNIX_CHAT_LOCAL_ENABLED:'true',FUNIX_CHAT_AUTONOMOUS_ENABLED:'true',FUNIX_CHAT_AUTONOMOUS_SINCE:cutoff}

test('short chat recovery previews and writes only evidenced orphan triage with a verified backup',()=>{
  const folder=mkdtempSync(join(tmpdir(),'funix-short-recovery-')),path=join(folder,'fixture.sqlite'),backup=join(folder,'backup.sqlite')
  try{
    const db=openDatabase(path)
    const runtime=loadConversationRuntime(environment,db)!
    const authority=runtime.authority!
    const at=new AtendimentoRepository(db)
    const saved=at.create({name:'Ficha sintética existente',phone:'(31) 99999-0912'})
    const legacy=at.create({name:'Ficha legada sintética'})
    db.prepare('UPDATE atendimentos SET phone=? WHERE id=?').run('(31) 9999-0918',legacy.id)
    const jids=['553199990911','553199990912','553199990913','553199990914',
      '553199990915','553199990916','553199990917','553199990918'].map(pn=>pn+'@s.whatsapp.net')
    for(const [index,jid] of jids.entries()){
      const cid=authority.rememberProviderConversation(jid)
      db.prepare('INSERT INTO chat_local_context_holds VALUES(?,?)').run(cid,'autonomous_contact_conflict')
      if(index===2)db.prepare('UPDATE v20_conversations SET context_revision=1 WHERE id=?').run(cid)
      if(index!==3)runtime.store.ingest(JSON.stringify({schemaVersion:2,instance:'funix_comercial',eventId:'synthetic-recovery-'+index,
        type:'message.upsert',occurredAt:'2026-01-02T00:00:00.000Z',displayName:'Pessoa sintética',message:{remoteJid:jid,remoteJidAlt:null,
          messageId:'message-'+index,timestamp:1767312000,fromMe:index>=4,kind:'text',text:'Fixture sintética',media:null,statuses:[]}}))
      else runtime.store.observePage(jid,[{recordId:'synthetic',instanceId:'synthetic',remoteJid:jid,remoteJidAlt:null,
        messageId:'snapshot-only',timestamp:1767312000,fromMe:false,origin:'unknown',kind:'text',text:'Histórico sintético',media:null,statuses:[]}],1)
      // These messages were persisted, but the current data has no automatic hold.
      if(index>=4)db.prepare('DELETE FROM chat_local_context_holds WHERE conversation_id=?').run(cid)
      if(index===5)db.prepare('INSERT INTO conversation_initialization VALUES(?,?,?,?,?,?)')
        .run(cid,null,'synthetic-closed','2026-01-02T00:00:00.000Z','{}','closed')
      if(index===6)db.prepare('INSERT INTO chat_local_context_holds VALUES(?,?)').run(cid,'ambiguous_atendimento_candidates')
    }
    assert.equal(at.list().total,2)
    db.close()
    const cli=(...args:string[])=>JSON.parse(execFileSync(process.execPath,[entrypoint.pathname,path,...args],{
      env:{...process.env,FUNIX_CHAT_AUTONOMOUS_SINCE:cutoff},encoding:'utf8',stdio:['ignore','pipe','pipe'],
    }))
    const plan=cli('--preview')
    assert.equal(plan.eligible,2)
    assert.equal(plan.existingOrRevoked,2)
    assert.equal(plan.needsIdentityReview,3)
    assert.equal(plan.noAuthenticatedMessage,1)
    assert.throws(()=>cli('--apply','0'.repeat(64),backup))
    assert.equal(cli('--apply',plan.digest,backup).applied,2)
    assert.equal(cli('--preview').eligible,0)
    const live=openDatabase(path),snapshot=openDatabase(backup)
    try{
      assert.equal(new AtendimentoRepository(snapshot).list().total,2)
      const records=new AtendimentoRepository(live)
      assert.equal(records.list().total,4)
      assert.deepEqual(records.get(saved.id),saved)
      assert.equal(live.prepare('SELECT count(*) AS n FROM chat_messages').get()?.n,8)
      assert.equal(live.prepare('SELECT count(*) AS n FROM v20_active_context').get()?.n,0)
      assert.equal(live.prepare('SELECT count(*) AS n FROM v20_associations').get()?.n,2)
      assert.deepEqual(live.prepare(`SELECT v.remote_jid FROM v20_associations a JOIN v20_conversations v ON v.id=a.conversation_id
        ORDER BY v.remote_jid`).all().map(row=>row.remote_jid),[jids[0],jids[4]])
      assert.deepEqual(live.prepare('PRAGMA foreign_key_check').all(),[])
    }finally{live.close();snapshot.close()}
  }finally{rmSync(folder,{recursive:true,force:true})}
})
