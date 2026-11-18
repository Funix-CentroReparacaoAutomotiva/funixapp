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
  const result=service.confirm(cid,input)
  assert.deepEqual(service.confirm(cid,input),result)
  assert.throws(()=>service.confirm(cid,{...input,atendimentoId:second.id}),/outros dados/)
  assert.throws(()=>service.confirm(cid,{...input,requestId:randomUUID()}),/mudou/)
  const refs=f.customers.references(at.id)
  assert.deepEqual(refs.person.map(person=>person.id),[other.id,existing.id])
  assert.deepEqual(refs.contact.map(contact=>contact.text),['+5531999990202',phone])
  assert.equal(f.customers.contacts(existing.id)[0]!.id,result.contactId)
  assert.deepEqual(service.forAtendimento(cid,at.id),{name:existing.text,phone})
  assert.equal(service.forAtendimento(cid,second.id),null)
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

test('LID without evidence, contradictory aliases, stale confirmations and ownership conflicts fail closed',async()=>{
 const f=entityContactsFixture()
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
