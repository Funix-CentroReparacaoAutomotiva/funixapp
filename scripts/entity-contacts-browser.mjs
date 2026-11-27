import assert from 'node:assert/strict'
import {mkdirSync,existsSync,writeFileSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {entityContactsFixture} from '../server/tests/fixtures/entity-contacts.ts'
import {createApp} from '../server/app.ts'
const origin='http://127.0.0.1:5173',out='artifacts/customer-experience/entities',password='synthetic-entity-browser'
mkdirSync(out,{recursive:true})
// Explicit synthetic harness only. The sender injected below records calls and cannot reach WhatsApp.
process.env.FUNIX_EVOLUTION_SEND_ENABLED='true'
process.env.FUNIX_EVOLUTION_MEDIA_ENABLED='true'
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
let browser
try{
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready)
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox']})
 const results=[]
 for(const width of [320,390,1440]){
  const f=entityContactsFixture(),pn1='5531999990101',pn2='5531999990202',pn3='5531999990303'
  f.histories.set(pn1+'@s.whatsapp.net','Histórico sintético do primeiro número')
  f.histories.set(pn2+'@s.whatsapp.net','Histórico sintético do segundo número')
  f.rows.push(pn1+'@s.whatsapp.net',pn2+'@s.whatsapp.net');f.answers.set(pn3,'unavailable')
  const app=createApp({atendimentos:f.at,evolutionChat:f.bridge,v20Associations:f.links,origin,password,voiceProvider:null})
  await new Promise(r=>app.listen(8787,'127.0.0.1',r))
  const ctx=await browser.newContext({viewport:{width,height:width===1440?1000:844}})
  try{
   assert.equal((await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})).status(),200)
   const page=await ctx.newPage(),errors=[],external=[]
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('data:'))external.push(new URL(r.url()).origin)})
   await page.goto(origin+'/conversas');assert.equal(await page.getByRole('button',{name:'Pessoas e telefones',exact:true}).count(),0);await page.goto(origin+'/biblioteca/historico');await page.getByRole('button',{name:'Pessoas e telefones',exact:true}).click()
   await page.getByRole('button',{name:'Nova pessoa ou organização'}).click()
   await page.getByRole('textbox',{name:'Nome da Entidade',exact:true}).fill('Pessoa Sintética Alfa')
   for(const [i,p] of [pn1,pn2,pn3].entries()){await page.getByRole('button',{name:'Adicionar telefone',exact:true}).click();await page.getByRole('textbox',{name:'Telefone da Entidade '+(i+1),exact:true}).fill('+'+p)}
   assert.equal(f.checks.length,0);assert.equal(f.sends(),0)
   await page.getByRole('button',{name:'Salvar pessoa e telefones',exact:true}).click()
   await page.getByRole('button',{name:'Abrir WhatsApp +'+pn1,exact:true}).waitFor()
   assert.equal(await page.getByText('Sem WhatsApp',{exact:true}).count(),1)
   const entity=f.customers.search('entity','Pessoa Sintética Alfa')[0],contacts=f.channels.entity(entity.id).contacts
   assert.equal(contacts.length,3);assert.equal(f.checks.length,3);assert.equal(f.sends(),0)
   assert.equal(f.at.list().total,0)
   await page.screenshot({path:out+'/entity-'+width+'.png',fullPage:true})
   await page.getByRole('button',{name:'Abrir WhatsApp +'+pn1,exact:true}).click()
   const chat=page.getByRole('dialog',{name:'WhatsApp do Contato'}),draft=chat.getByRole('textbox',{name:'Mensagem de texto para o cliente'})
   await chat.getByText('Histórico sintético do primeiro número',{exact:true}).waitFor()
   assert.equal(await chat.getByText('Histórico sintético do segundo número',{exact:true}).count(),0)
   await draft.fill('Rascunho sintético A')
   await chat.getByRole('combobox',{name:'Número da conversa'}).selectOption(contacts[1].id)
   await chat.getByText('Histórico sintético do segundo número',{exact:true}).waitFor();assert.equal(await draft.inputValue(),'')
   await draft.fill('Rascunho sintético B')
   await chat.getByRole('combobox',{name:'Número da conversa'}).selectOption(contacts[0].id)
   await chat.getByText('Histórico sintético do primeiro número',{exact:true}).waitFor();assert.equal(await draft.inputValue(),'Rascunho sintético A')
   page.once('dialog',d=>d.dismiss());await chat.getByRole('button',{name:'Enviar mensagem',exact:true}).click();assert.equal(f.sends(),0);assert.equal(f.at.list().total,0)
   page.once('dialog',d=>d.accept());await chat.getByRole('button',{name:'Enviar mensagem',exact:true}).click()
   await chat.getByText('Mensagem aceita pelo WhatsApp. Confira o histórico antes de enviar novamente.').waitFor();assert.equal(f.sends(),1);assert.deepEqual(f.sent,[pn1+'@s.whatsapp.net']);assert.equal(f.at.list().total,1);assert.equal(f.at.list().items[0].purpose,'unclassified')
   await chat.getByLabel('Escolher foto, vídeo ou áudio').setInputFiles({name:'foto-sintetica.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,0])})
   page.once('dialog',d=>d.dismiss());await chat.getByRole('button',{name:'Enviar mídia',exact:true}).click();assert.equal(f.mediaSent.length,0)
   page.once('dialog',d=>d.accept());await chat.getByRole('button',{name:'Enviar mídia',exact:true}).click()
   await chat.getByText('Arquivo aceito pela Evolution. Confira no WhatsApp antes de reenviar.').waitFor();assert.deepEqual(f.mediaSent,[pn1+'@s.whatsapp.net']);assert.equal(f.at.list().total,1)
   await chat.getByText('Atendimentos desta conversa',{exact:true}).first().click()
   await chat.getByRole('region',{name:'Vínculos com Atendimentos'}).getByText('Pessoa Sintética Alfa',{exact:true}).waitFor()
   await chat.getByText('Atendimentos desta conversa',{exact:true}).first().click()
   await page.screenshot({path:out+'/chat-'+width+'.png',fullPage:true})
   assert.equal(await chat.evaluate(e=>e.scrollWidth>e.clientWidth),false)
   await chat.getByRole('button',{name:'Fechar Chat do Contato'}).click()
   await page.getByRole('button',{name:'Fechar cadastro',exact:true}).click()
   await page.getByRole('button',{name:'Fechar pessoas e telefones',exact:true}).click()
   await page.goto(origin+'/conversas');await page.getByRole('button',{name:'Atualizar',exact:true}).click()
   await page.waitForFunction(()=>[...document.querySelectorAll('.conversation-names')].filter(e=>e.textContent.includes('Pessoa Sintética Alfa')).length===2)
   assert.equal(await page.locator('.entity-seal').count(),2)
   const interaction=f.at.list().items[0]
   await page.goto(origin+'/vendas/funil')
   await page.getByRole('button',{name:/Pessoa Sintética Alfa/}).click()
   await page.getByLabel('Canal de aquisição',{exact:true}).selectOption('non_commercial')
   await page.getByText('Salvo automaticamente',{exact:true}).waitFor()
   assert.equal(f.at.get(interaction.id,true).channel,'WhatsApp')
   await page.goto(origin+'/atendimentos/'+interaction.id)
   await page.getByRole('button',{name:'Dados',exact:true}).click()
   const triage=page.getByRole('form',{name:'Editar Atendimento'})
   await triage.getByLabel('Atendimento encerrado',{exact:true}).check()
   await triage.getByText('Salvo automaticamente',{exact:false}).waitFor()
   assert.equal(f.at.get(interaction.id).purpose,'non_commercial')
   assert.ok(f.at.get(interaction.id).closedAt)
   assert.equal(f.at.get(interaction.id).explicitRefusal,false)
   // Selecting an entity alone neither pulls in its phones nor links channels.
   // Explicit contact references maintain each phone under the selected owner.
   const second=f.customers.save({kind:'entity',text:'Pessoa Sintética Beta',contacts:[{text:'+5531999990404'}]});await f.channels.verifyEntity(second.id)
   const references={person:[{id:entity.id,text:entity.text},{id:second.id,text:second.text}],contact:[],vehicle:[],payer:[]}
   const unbound=f.at.create({references})
   assert.ok(f.at.get(unbound.id,true).references.contact.every(contact=>!contact.id&&!contact.text))
   const referenceContacts=[...contacts,...f.channels.entity(second.id).contacts].map(({id,text,entityId})=>({id,text,entityId}))
   const at=f.at.create({references:{...references,contact:referenceContacts}})
   await page.goto(origin+'/atendimentos/'+at.id+'?aba=diagnosticos')
   await page.getByRole('button',{name:'Dados',exact:true}).click()
   const form=page.getByRole('form',{name:'Editar Atendimento'})
   const alpha=form.getByRole('group',{name:'Pessoa 1',exact:true}),beta=form.getByRole('group',{name:'Pessoa 2',exact:true})
   const message={name:'Escrever mensagem opcional',exact:true}
   await beta.getByText('+5531999990404',{exact:true}).waitFor()
   assert.equal(await alpha.getByRole('button',message).count(),3)
   assert.equal(await beta.getByRole('button',message).count(),1)
   assert.ok(await beta.getByRole('button',message).isEnabled())
   assert.match(await form.innerText(),/Pessoa Sintética Alfa/);assert.match(await form.innerText(),/Pessoa Sintética Beta/)
   await page.screenshot({path:out+'/responsibles-'+width+'.png',fullPage:true})
   const linkCount=f.db.prepare('SELECT count(*) n FROM v20_associations WHERE atendimento_id=? AND unlinked_at IS NULL')
   assert.equal(linkCount.get(interaction.id).n,1)
   assert.equal(linkCount.get(unbound.id).n,0)
   const explicitLinks=f.db.prepare('SELECT link_reason FROM v20_associations WHERE atendimento_id=? AND unlinked_at IS NULL').all(at.id)
   assert.equal(explicitLinks.length,3)
   assert.ok(explicitLinks.every(link=>link.link_reason==='explicit_contact_reference'))
   assert.equal(f.db.prepare('SELECT count(*) n FROM chat_messages').get().n,0)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   assert.deepEqual(errors,[]);assert.deepEqual(external,[])
   results.push({width,realBackend:true,realFrontend:true,provider:'synthetic-only',phones:3,verified:2,noWhatsapp:1,independentHistories:true,draftsPreserved:true,cancelledSendCalls:0,confirmedSyntheticTextCalls:1,confirmedSyntheticMediaCalls:1,realSends:0,multipleResponsibles:true,implicitLinks:0,explicitReferenceLinks:3,confirmedInteractionLinks:1,nonCommercialClosure:true,overflow:false,consoleErrors:0})
  }finally{await ctx.close();await new Promise(r=>app.close(r));f.db.close()}
 }
 writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results))
}finally{await browser?.close();vite.kill()}
