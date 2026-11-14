import assert from 'node:assert/strict'
import {mkdirSync,existsSync,writeFileSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {openDatabase} from '../server/database.ts'
import {AtendimentoRepository} from '../server/atendimentos.ts'
import {CustomerRepository} from '../server/customers.ts'
import {loadConversationRuntime} from '../server/chat/conversation-runtime.ts'
import {createEvolutionChatBridge} from '../server/chat/evolution-bridge.ts'
import {V20AssociationRepository} from '../server/chat/v20-associations.ts'
import {createApp} from '../server/app.ts'
import {randomUUID} from 'node:crypto'
const origin='http://127.0.0.1:5173',password='synthetic-customer-experience',artifacts='artifacts/customer-experience'
mkdirSync(artifacts,{recursive:true})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
let browser
const results=[]
try{
 for(let i=0;i<80;i++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox']})
 for(const width of [320,390,1440]){
  const db=openDatabase(':memory:'),at=new AtendimentoRepository(db),customers=new CustomerRepository(db),runtime=loadConversationRuntime({FUNIX_CHAT_LOCAL_ENABLED:'true',FUNIX_CHAT_LOCAL_READ_ENABLED:'true'},db),associations=new V20AssociationRepository(db)
  const inbound=(i,name)=>{const jid='5531999990'+String(i).padStart(3,'0')+'@s.whatsapp.net',value={schemaVersion:2,instance:'funix_comercial',eventId:'fixture-'+i,type:'message.upsert',occurredAt:'2026-01-01T00:00:00.000Z',...(name?{displayName:name}:{}),message:{remoteJid:jid,remoteJidAlt:null,messageId:'fixture-'+i,timestamp:1767225600,fromMe:false,kind:'text',text:'Mensagem sintética '+i,media:null}};runtime.store.ingest(JSON.stringify(value));return {jid,id:runtime.authority.rememberProviderConversation(jid),at:at.list().items.find(a=>a.phone==='+'+jid.split('@')[0])}}
  const maria=inbound(1,'Maria'),unknown=inbound(2),many=inbound(3,'Ana Souza')
  const contact=customers.record(runtime.authority.projection(maria.jid).contactId)
  customers.save({text:contact.text,revision:contact.revision,nickname:'Dona Maria'},contact.id)
  const pedro=customers.save({kind:'entity',text:'Pedro'}),refs=at.get(maria.at.id,true).references
  refs.person=[{id:pedro.id,text:'Pedro'}];at.update(maria.at.id,{revision:maria.at.revision,name:'Pedro',references:refs})
  for(let i=0;i<19;i++){const entity=i%2?customers.save({kind:'entity',text:'Pessoa '+i+' Sobrenome'}):null;const a=at.create({name:'Pessoa '+i+' Sobrenome',...(entity?{references:{person:[{id:entity.id,text:entity.text}],contact:[],vehicle:[],payer:[]}}:{})});associations.link({conversationId:many.id,atendimentoId:a.id,expectedRevision:i+1,requestId:randomUUID(),reason:'Synthetic multiple contexts'})}
  let sends=0
  const provider={findChatsPage:async()=>{throw Error('synthetic offline provider')},findMessages:async()=>{throw Error('no external access')}}
  const bridge=createEvolutionChatBridge(provider,Date.now,associations,runtime.authority,async()=>{sends++;return {messageId:'synthetic-send-'+sends}},undefined,runtime)
  const prior=process.env.FUNIX_EVOLUTION_SEND_ENABLED;process.env.FUNIX_EVOLUTION_SEND_ENABLED='true'
  const app=createApp({atendimentos:at,origin,password,voiceProvider:null,evolutionChat:bridge,conversationRuntime:runtime,v20Associations:associations})
  await new Promise(r=>app.listen(8787,'127.0.0.1',r))
  const ctx=await browser.newContext({viewport:{width,height:width===1440?1000:844}})
  try{
   const login=await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}});assert.equal(login.status(),200)
   const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
   await page.goto(origin+'/conversas');await page.locator('.conversation-row').first().waitFor()
   assert.equal(await page.locator('.conversation-row').count(),3)
   assert.equal(await page.getByRole('navigation',{name:'Áreas da FUNIX'}).getByRole('button').count(),2)
   assert.equal(await page.locator('.conversation-unread').count(),3)
   assert.equal(await page.getByRole('button',{name:'Detalhes: 20 Atendimentos'}).count(),1)
   assert.equal(await page.getByRole('button',{name:'Detalhes: 1 Atendimentos'}).count(),2)
   await page.getByRole('button',{name:'Detalhes: 20 Atendimentos'}).click()
   const details=page.getByRole('dialog',{name:'Detalhes da conversa'});await details.waitFor();assert.equal(await details.locator('ul>li').count(),20)
   await page.getByRole('button',{name:'Fechar detalhes'}).click()
   assert.equal(await page.locator('.conversation-names').filter({hasText:'Dona Maria'}).count(),1)
   assert.equal(await page.locator('.conversation-names').filter({hasText:'Sem nome'}).count(),1)
   const oneLine=await page.locator('.conversation-names').filter({hasText:'Ana Souza'}).evaluate(el=>({whiteSpace:getComputedStyle(el).whiteSpace,truncated:el.scrollWidth>el.clientWidth}));assert.equal(oneLine.whiteSpace,'nowrap');assert.ok(oneLine.truncated)
   await page.screenshot({path:artifacts+'/conversas-'+width+'.png',fullPage:true})
   await page.getByRole('button',{name:'Abrir conversa: Dona Maria',exact:true}).click()
   await page.getByText('Mensagem sintética 1',{exact:true}).waitFor()
   await page.waitForFunction(()=>document.querySelector('.detail-contact strong')?.textContent==='Pedro')
   assert.equal(sends,0)
   const composer=page.getByRole('textbox',{name:'Mensagem de texto para o cliente'});await composer.fill('Resposta sintética autorizada')
   page.once('dialog',d=>d.dismiss());await page.locator('.chat-send-text button[type=submit]').click();assert.equal(sends,0)
   page.once('dialog',d=>d.accept());await page.locator('.chat-send-text button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#chat-whatsapp-text')?.value);assert.equal(sends,1)
   await page.screenshot({path:artifacts+'/chat-'+width+'.png',fullPage:true})
   await page.getByRole('button',{name:'Editar Atendimento',exact:true}).click()
   const editor=page.getByRole('dialog',{name:'Editar Atendimento',exact:true});await editor.waitFor();assert.equal(await editor.locator('.smart-locked').filter({hasText:'Pedro'}).count(),1)
   assert.equal(await editor.getByRole('textbox',{name:'Pessoa de referência',exact:true}).count(),0)
   await page.screenshot({path:artifacts+'/edicao-'+width+'.png',fullPage:true})
   const years=await editor.locator('.smart-years').first().evaluate(el=>({width:el.clientWidth,children:[...el.children].map(x=>x.getBoundingClientRect().top)}));assert.equal(years.children[0],years.children[1])
   await page.getByRole('button',{name:'Fechar formulário'}).click()
   await page.getByRole('button',{name:'Diagnóstico',exact:true}).click();await page.locator('.commercial-page').waitFor()
   await page.getByRole('button',{name:'Mapa',exact:true}).click();await page.locator('.map-page').waitFor()
   await page.goto(origin+'/funil');await page.locator('.fh-card').first().waitFor();assert.equal(await page.locator('[aria-label="Encerrados"]').count(),1)
   await page.screenshot({path:artifacts+'/funil-'+width+'.png',fullPage:true})
   await page.getByRole('button',{name:/Novo Atendimento/}).click()
   const create=page.getByRole('dialog',{name:'Novo Atendimento',exact:true});await create.waitFor();await create.getByRole('button',{name:'Criar Atendimento',exact:true}).click()
   await create.waitFor({state:'detached'});assert.equal(at.list().total,23)
   await page.goto(origin+`/atendimentos/${many.at.id}?aba=chat`)
   const contactChoice=page.getByRole('combobox',{name:'Contato da conversa'});await contactChoice.waitFor();await contactChoice.selectOption(many.id)
   await page.getByText('Mensagem sintética 3',{exact:true}).waitFor()
   const nextAt=associations.listActive(many.id).items.find(l=>l.atendimentoId!==many.at.id)
   await page.getByRole('combobox',{name:'Contexto do Atendimento'}).selectOption(nextAt.atendimentoId)
   await page.waitForURL('**/atendimentos/'+nextAt.atendimentoId+'?aba=chat&conversa='+many.id)
   await page.waitForFunction(name=>document.querySelector('.detail-contact strong')?.textContent===name,nextAt.name)
   await page.getByText('Mensagem sintética 3',{exact:true}).waitFor()
   await page.waitForFunction(()=>document.querySelectorAll('.chat-message').length===1)
   assert.equal(await page.locator('.chat-message').count(),1)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   assert.deepEqual(errors,[])
   results.push({width,conversations:3,namesInDetails:20,sends,manualPartial:true,contextSwitch:true,chat:true,diagnosis:true,map:true,overflow:false})
  }finally{await ctx.close();await new Promise(r=>app.close(r));db.close();if(prior===undefined)delete process.env.FUNIX_EVOLUTION_SEND_ENABLED;else process.env.FUNIX_EVOLUTION_SEND_ENABLED=prior}
 }
 writeFileSync(artifacts+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results))
}finally{await browser?.close();vite.kill('SIGTERM')}
