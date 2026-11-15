import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CustomerRepository} from '../customers.ts'
import {loadConversationRuntime} from '../chat/conversation-runtime.ts'
import {V20AssociationRepository} from '../chat/v20-associations.ts'
import {createEvolutionChatBridge} from '../chat/evolution-bridge.ts'
const PN='5531999990101@s.whatsapp.net',LID='review-secondary@lid',OTHER='5531999990202@s.whatsapp.net'
const env={FUNIX_CHAT_LOCAL_ENABLED:'true',FUNIX_CHAT_LOCAL_READ_ENABLED:'true'}
function setup(path=':memory:'){
 const db=openDatabase(path),runtime=loadConversationRuntime(env,db)!,authority=runtime.authority!,at=new AtendimentoRepository(db),customers=new CustomerRepository(db),links=new V20AssociationRepository(db)
 let sends=0,reads=0
 const bridge=createEvolutionChatBridge({findChatsPage:async()=>({items:[],sourceCount:0}),findMessages:async()=>{reads++;throw Error('No provider access expected')}},Date.now,links,authority,async()=>{sends++;return {messageId:'synthetic-send'}},undefined,runtime)
 function receive(id:string,jid:string,alt:string|null=null,receipt=id){return runtime.store.ingest(JSON.stringify({schemaVersion:2,instance:'funix_comercial',eventId:'review-'+receipt,type:'message.upsert',occurredAt:'2026-01-01T00:00:00.000Z',displayName:'Nome de origem',message:{remoteJid:jid,remoteJidAlt:alt,messageId:id,timestamp:1767225600,fromMe:false,kind:'text',text:'Mensagem '+id,media:null}}))}
 function nickname(jid:string,value:string){const id=authority.projection(jid).contactId!,record=customers.record(id);return customers.save({text:record.text,revision:record.revision,nickname:value},id)}
 function select(cid:string,atId:string){const scope=authority.associationScope(cid),l=links.listActive(cid,scope).items.find(l=>l.atendimentoId===atId)!;links.selectAtendimento(cid,l.linkId,scope)}
 return {db,runtime,authority,at,customers,links,bridge,receive,nickname,select,sideEffects:()=>({sends,reads})}
}

test('verified PN/LID uses the seller nickname and read marks from either exact handle, including after restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-alias-review-')),path=join(dir,'synthetic.sqlite')
 let f=setup(path)
 try{
  f.receive('pn-first',PN);f.receive('lid-first',LID)
  const saved=f.nickname(LID,'Dona Maria'),before=f.db.prepare('SELECT id,phone,name FROM atendimentos ORDER BY id').all()
  f.authority.markRead(LID,['lid-first']);assert.equal(f.authority.projection(LID).unreadCount,0)
  f.receive('alias-confirmed',PN,LID)
  const pn=f.authority.projection(PN),lid=f.authority.projection(LID)
  assert.deepEqual(pn,lid);assert.deepEqual(pn.names,[{name:'Dona Maria',entityId:null}]);assert.equal(pn.contactId,saved.id)
  assert.equal(pn.unreadCount,2);assert.equal(pn.atendimentoCount,2);assert.equal(pn.phoneNumber,PN.split('@')[0])
  f.authority.markRead(LID,['pn-first','alias-confirmed']);assert.equal(f.authority.projection(PN).unreadCount,0)
  assert.deepEqual(f.db.prepare('SELECT id,phone,name FROM atendimentos ORDER BY id').all(),before)
  f.db.close();f=setup(path)
  assert.deepEqual(f.authority.projection(PN),f.authority.projection(LID));assert.equal(f.authority.projection(LID).unreadCount,0);assert.equal(f.customers.record(saved.id).nickname,'Dona Maria')
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.db.close();rmSync(dir,{recursive:true,force:true})}
})

test('batch list deduplicates a verified conversation and shared message reads without exposing identity conflicts',async()=>{
 const f=setup();try{
  f.receive('same-message',PN);f.receive('same-message',LID,null,'lid-receipt')
  f.authority.markRead(LID,['same-message']);f.nickname(LID,'Apelido preservado')
  f.authority.rememberProviderAliases([{remoteJid:PN,remoteJidAlt:LID}],false,'webhook')
  const list=await f.bridge.list(0)
  assert.equal(list.items.length,1);assert.equal(f.authority.projection(PN).unreadCount,0)
  assert.deepEqual(f.authority.projection(PN),f.authority.projection(LID))
  f.authority.rememberProviderAliases([{remoteJid:OTHER,remoteJidAlt:LID}],false,'webhook')
  for(const jid of [PN,LID,OTHER]){
   assert.equal(f.authority.identityState(jid),'identity_conflict')
   const projection=f.authority.projection(jid);assert.equal(projection.preview,null);assert.equal(projection.phoneNumber,null)
   assert.equal(f.authority.resolveIdentityActive(jid),null);assert.equal(f.authority.contextToken(jid),null)
  }
  assert.deepEqual(f.sideEffects(),{sends:0,reads:0})
 }finally{f.db.close()}
})

test('replacing a Contact retains explicit history but revokes its implicit context and stale send until deliberate reselection',async()=>{
 const f=setup();try{
  f.receive('old-channel',PN);f.receive('new-channel',OTHER)
  const oldId=f.authority.rememberProviderConversation(PN),newId=f.authority.rememberProviderConversation(OTHER),target=f.authority.resolveIdentityActive(PN)!
  f.select(oldId,target)
  const token=f.authority.contextToken(PN)!,before=f.db.prepare('SELECT * FROM chat_messages ORDER BY sequence').all(),record=f.at.get(target,true)
  const refs=record.references!;const newContact=f.authority.projection(OTHER).contactId!;refs.contact=[{id:newContact,text:'+5531999990202'}]
  f.at.update(target,{revision:record.revision,references:refs})
  assert.equal(f.authority.resolveIdentityActive(PN),null)
  assert.equal(await f.bridge.messagesForAtendimento(target,oldId,1),null)
  assert.equal((await f.bridge.sendTextForAtendimento(target,oldId,'Não enviar',{requestId:randomUUID(),contextToken:token})).state,'unlinked')
  assert.deepEqual(f.sideEffects(),{sends:0,reads:0})
  assert.equal(f.links.listActive(oldId).items.length,1);assert.deepEqual(f.db.prepare('SELECT * FROM chat_messages ORDER BY sequence').all(),before)
  f.select(newId,target);const current=await f.bridge.messagesForAtendimento(target,newId,1)
  assert.deepEqual(current!.items.map(m=>m.text),['Mensagem new-channel'])
  f.select(oldId,target);const historical=await f.bridge.messagesForAtendimento(target,oldId,1)
  assert.deepEqual(historical!.items.map(m=>m.text),['Mensagem old-channel']);assert.notEqual(f.authority.contextToken(PN),token)
  const list=f.links.listActive(oldId),link=list.items[0]!
  f.links.unlink({conversationId:oldId,linkId:link.linkId,expectedRevision:list.revision,requestId:randomUUID(),reason:'Desvinculação explícita sintética'})
  assert.equal(await f.bridge.messagesForAtendimento(target,oldId,1),null)
  const audit=f.db.prepare('SELECT unlinked_by,unlink_reason FROM v20_associations WHERE id=?').get(link.linkId)!
  assert.equal(audit.unlinked_by,'operator');assert.equal(audit.unlink_reason,'Desvinculação explícita sintética')
  assert.deepEqual(f.db.prepare('SELECT * FROM chat_messages ORDER BY sequence').all(),before)
 }finally{f.db.close()}
})

test('removing a Contact revokes both exact alias contexts and stale tokens; explicit reselection survives restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-contact-review-')),path=join(dir,'synthetic.sqlite');let f=setup(path)
 try{
  f.receive('original',LID);f.receive('confirmed',PN,LID)
  const cid=f.authority.rememberProviderConversation(PN),target=f.authority.resolveIdentityActive(PN)!
  f.select(cid,target);const token=f.authority.contextToken(PN),record=f.at.get(target,true)
  record.references!.contact=[];f.at.update(target,{revision:record.revision,references:record.references})
  for(const jid of [PN,LID])assert.equal(f.authority.contextToken(jid),null)
  assert.equal(f.links.listActive(cid,f.authority.associationScope(cid)).items.length,1)
  f.db.close();f=setup(path);assert.equal(f.authority.resolveIdentityActive(PN),null)
  f.select(cid,target);assert.equal(f.authority.resolveIdentityActive(LID),target);assert.notEqual(f.authority.contextToken(PN),token)
  assert.equal(f.runtime.store.page(LID,1).items.length,2)
  f.db.close();f=setup(path);assert.equal(f.authority.resolveIdentityActive(PN),target)
  assert.deepEqual(f.db.prepare('PRAGMA integrity_check').all().map(r=>r.integrity_check),['ok'])
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.db.close();rmSync(dir,{recursive:true,force:true})}
})

test('unrelated edits and unchanged scalar phone retain selected context and recognized Contact',()=>{
 const f=setup();try{
  f.receive('original',PN);const cid=f.authority.rememberProviderConversation(PN),target=f.authority.resolveIdentityActive(PN)!
  f.select(cid,target);const token=f.authority.contextToken(PN),before=f.at.get(target,true)
  f.at.update(target,{revision:before.revision,phone:before.phone,plate:'ABC1D23',notes:'Informação sem contato'})
  assert.equal(f.at.get(target,true).references!.contact[0]!.id,before.references!.contact[0]!.id)
  assert.equal(f.authority.contextToken(PN),token)
  const record=f.at.get(target,true);record.references!.payer=[{id:null,text:'Pagador informado'}]
  f.at.update(target,{revision:record.revision,references:record.references})
  assert.equal(f.authority.contextToken(PN),token)
  const current=f.at.get(target);f.at.update(target,{revision:current.revision,phone:'+5531999990202'})
  assert.equal(f.authority.resolveIdentityActive(PN),null)
 }finally{f.db.close()}
})

test('canonical nickname wins deterministically without deleting the secondary nickname or changing snapshots',()=>{
 const f=setup();try{
  f.receive('first',PN);f.receive('second',LID)
  const primary=f.nickname(PN,'Nome principal'),secondary=f.nickname(LID,'Nome secundário')
  const before=f.db.prepare('SELECT * FROM conversation_initialization ORDER BY conversation_id').all()
  f.authority.rememberProviderAliases([{remoteJid:PN,remoteJidAlt:LID}],false,'webhook')
  for(const jid of [PN,LID])assert.deepEqual(f.authority.projection(jid).names,[{name:'Nome principal',entityId:null}])
  assert.equal(f.authority.projection(LID).contactId,primary.id)
  assert.equal(f.customers.record(secondary.id).nickname,'Nome secundário')
  assert.deepEqual(f.db.prepare('SELECT * FROM conversation_initialization ORDER BY conversation_id').all(),before)
 }finally{f.db.close()}
})
