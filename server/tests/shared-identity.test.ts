import {removeV25FixtureSchema} from './fixtures/production.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {SharedConversationIdentity} from '../chat/shared-identity.ts'
import {entityContactsFixture} from './fixtures/entity-contacts.ts'

const phone='+5531999990101',pn=phone.slice(1)+'@s.whatsapp.net',lid='synthetic@lid'
function link(f:ReturnType<typeof entityContactsFixture>,jid:string,atendimentoId:string,expectedRevision=0){
  const id=f.channels.identities.rememberProviderConversation(jid)
  f.links.link({conversationId:id,atendimentoId,expectedRevision,requestId:randomUUID(),reason:'Vínculo sintético existente'})
  return id
}

test('reconciliation preserves separate people, other phones and Atendimento links and replays exactly once',async()=>{
 const f=entityContactsFixture()
 try{
  const other=f.customers.save({kind:'entity',text:'Outro participante',contacts:[{text:'+5531999990202'}]})
  const existing=f.customers.save({kind:'entity',text:'Pessoa conhecida'})
  const at=f.at.create({references:{
    person:[{id:other.id,text:other.text},{id:null,text:'Pessoa conhecida'}],
    contact:[{id:null,text:'+5531999990202'}],vehicle:[],payer:[],
  }})
  const second=f.at.create({name:'Outra demanda'})
  const cid=link(f,pn,at.id)
  link(f,pn,second.id,1)
  f.rows.push(pn)
  const service=new SharedConversationIdentity(f.db,f.bridge.observedConversation)
  assert.equal(service.preview(cid).phone,null)
  await f.bridge.list(0)
  const view=service.preview(cid)
  assert.equal(view.phone,phone)
  assert.equal(view.targets.length,2)
  const input={token:view.token,requestId:randomUUID(),atendimentoId:at.id,entityId:existing.id,legacyIndex:1}
  assert.throws(()=>service.confirm(cid,{...input,atendimentoId:null}),/Confirme/)
  const provisional=f.customers.phoneMatches(phone)[0]!
  const receipt=()=>f.db.prepare('SELECT result_json FROM v20_association_receipts WHERE conversation_id=? AND request_id=?')
    .get(cid,input.requestId)
  f.db.exec(`CREATE TEMP TRIGGER test_reject_owner_update BEFORE UPDATE OF entity_id ON customer_records
    BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END`)
  assert.throws(()=>service.confirm(cid,input),/synthetic rollback/)
  assert.equal(receipt(),undefined)
  assert.equal(f.customers.record(provisional.id).entityId,provisional.entityId)
  f.db.exec('DROP TRIGGER test_reject_owner_update')
  const result=service.confirm(cid,input)
  assert.equal(result.contactId,provisional.id)
  assert.deepEqual(JSON.parse(String(receipt()?.result_json)),{...result,previousEntityId:provisional.entityId})
  assert.deepEqual(service.confirm(cid,input),result)
  assert.throws(()=>service.confirm(cid,{...input,atendimentoId:second.id}),/outros dados/)
  assert.throws(()=>service.confirm(cid,{...input,requestId:randomUUID()}),/mudou/)
  const refs=f.customers.references(at.id)
  assert.deepEqual(refs.person.map(person=>person.id),[other.id,existing.id])
  assert.deepEqual(refs.contact.map(contact=>contact.text),['+5531999990202',phone])
  assert.equal(f.customers.contacts(existing.id)[0]!.id,result.contactId)
  assert.deepEqual(service.forAtendimento(cid,at.id),{name:existing.text,phone})
  assert.deepEqual(service.forAtendimento(cid,second.id),{name:existing.text,phone})
  const renamed=f.customers.save({text:'Nome corrigido',revision:existing.revision},existing.id)
  const afterRestart=new SharedConversationIdentity(f.db,()=>false)
  assert.equal(afterRestart.forAtendimento(cid,at.id)?.name,renamed.text)
  assert.equal((await f.bridge.list(0)).items[0]?.commercial?.names[0]?.name,renamed.text)
  assert.equal(f.at.list().total,2)
  assert.equal(f.links.listActive(cid).items.length,2)
  assert.equal(f.sends(),0)
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.db.close()}
})

test('legacy LID without evidence and contradictory aliases fail closed',async()=>{
 const f=entityContactsFixture()
 removeV25FixtureSchema(f.db)
 try{
  const owner=f.customers.save({kind:'entity',text:'Titular',contacts:[{text:phone}]})
  const original=f.customers.contacts(owner.id)[0]!
  const at=f.at.create({name:'Pessoa da ficha'})
  const cid=link(f,lid,at.id)
  const service=new SharedConversationIdentity(f.db,()=>true)
  const input={requestId:randomUUID(),atendimentoId:at.id,entityId:null,name:'Pessoa da ficha',legacyIndex:0}
  const pending=service.preview(cid)
  assert.equal(pending.phone,null)
  assert.throws(()=>service.confirm(cid,{...input,token:pending.token}),/revisão/)
  f.channels.identities.rememberProviderAliases([{remoteJid:lid,remoteJidAlt:pn}])
  const view=service.preview(cid)
  assert.equal(view.phone,phone)
  assert.equal(view.owner?.id,owner.id)
  assert.throws(()=>service.confirm(cid,{...input,token:view.token}),/já pertence/)
  assert.equal(f.customers.record(original.id).conversationId,null)
  f.channels.identities.rememberProviderAliases([{remoteJid:lid,remoteJidAlt:'5531999990333@s.whatsapp.net'}])
  assert.equal(service.preview(cid).blocked,true)
  assert.equal(await f.bridge.messages(cid,1),null)
  assert.deepEqual(f.reads,[])
  assert.throws(()=>service.confirm(cid,{...input,token:view.token}),/mudou/)
  assert.equal(f.customers.search('entity','Pessoa da ficha').length,0)
  assert.equal(f.at.get(at.id).phone,'')
 }finally{f.db.close()}
})


test('provider-only V20 reads the selected Atendimento history without granting send or access after deselection',async()=>{
 const f=entityContactsFixture({unnamed:true})
 try{
  const at=f.at.create({name:'Pessoa da ficha'}),other=f.at.create({name:'Outra ficha'})
  const cid=link(f,pn,at.id)
  f.rows.push(pn);f.histories.set(pn,'Histórico preservado')
  await f.bridge.list(0)
  assert.equal(await f.bridge.messagesForAtendimento(at.id,cid,1),null)
  const active=f.links.listActive(cid).items[0]!
  f.links.selectAtendimento(cid,active.linkId)
  assert.equal(await f.bridge.messagesForAtendimento(other.id,cid,1),null)
  const history=await f.bridge.messagesForAtendimento(at.id,cid,1)
  assert.equal(history?.items[0]?.text,'Histórico preservado')
  assert.equal(history?.sendTextAvailable,false)
  assert.equal(history?.mediaSendAvailable,false)
  assert.equal(history?.mediaReadAvailable,false)
  f.links.selectAtendimento(cid,null)
  assert.equal(await f.bridge.messagesForAtendimento(at.id,cid,1),null)
  assert.equal(f.sends(),0)
 }finally{f.db.close()}
})

test('identity review alone clears a recovered identity hold after revalidating the exact owner',()=>{
 const f=entityContactsFixture()
 try{
  const owner=f.customers.save({kind:'entity',text:'Titular sintético',contacts:[{text:phone}]})
  const at=f.at.create({name:'Ficha sintética'})
  const cid=link(f,pn,at.id)
  f.db.prepare("INSERT INTO chat_local_context_holds VALUES(?,'autonomous_contact_conflict')").run(cid)
  const linkId=f.links.listActive(cid).items[0]!.linkId
  assert.throws(()=>f.links.selectAtendimento(cid,linkId),/identidade/)
  const identity=new SharedConversationIdentity(f.db,()=>true)
  const preview=identity.preview(cid)
  const input={requestId:randomUUID(),token:preview.token,entityId:owner.id,atendimentoId:at.id}
  const revision=Number(f.db.prepare('SELECT context_revision FROM v20_conversations WHERE id=?').get(cid)!.context_revision)
  const confirmed=identity.confirm(cid,input)
  assert.deepEqual(identity.confirm(cid,input),confirmed)
  assert.equal(f.db.prepare('SELECT context_revision FROM v20_conversations WHERE id=?').get(cid)!.context_revision,revision+1)
  assert.equal(f.db.prepare('SELECT reason FROM chat_local_context_holds WHERE conversation_id=?').get(cid),undefined)
  assert.equal(f.sends(),0)
 }finally{f.db.close()}
})
