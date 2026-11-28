import assert from 'node:assert/strict'
import {mkdirSync,existsSync,writeFileSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {conversationPhoneFixture} from '../server/tests/fixtures/conversation-phone-list.ts'
import {ConversationIdentities} from '../server/chat/conversation-identities.ts'
import {createApp} from '../server/app.ts'
const origin='http://127.0.0.1:5173',out='artifacts/customer-experience/phones',password='synthetic-phone-browser'
mkdirSync(out,{recursive:true})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
let browser
try{
 let ready=false
 for(let i=0;i<80;i++){try{if((await fetch(origin)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
 assert(ready,'Local Vite did not start')
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox']})
 const results=[]
 for(const width of [320,390,1440]){
  const f=conversationPhoneFixture(),a=f.addAt('+5531999990404'),b=f.addAt('+5531999990707'),empty=f.addAt('')
  f.addChat('primary-phone@lid','Contato principal');f.link('primary-phone@lid',a.id)
  f.addChat('5531999990505@s.whatsapp.net','PN divergente');f.link('5531999990505@s.whatsapp.net',b.id)
  f.addChat('missing-phone@lid','Sem número');f.link('missing-phone@lid',empty.id)
  f.addChat('ambiguous-phone@lid','Duas fichas');f.link('ambiguous-phone@lid',a.id);f.link('ambiguous-phone@lid',b.id)
  f.addChat('unlinked-phone@lid','Sem vínculo')
  f.addChat('verified-phone@lid','PN confirmado','5531999990808@s.whatsapp.net')
  new ConversationIdentities(f.db).rememberProviderAliases([{remoteJid:'conflicting-phone@lid',remoteJidAlt:'5531999990606@s.whatsapp.net'}])
  f.addChat('conflicting-phone@lid','Conflito','5531999990909@s.whatsapp.net');f.link('conflicting-phone@lid',a.id)
  const linksBefore=f.db.prepare('SELECT * FROM v20_associations ORDER BY id').all()
  const app=createApp({atendimentos:f.at,evolutionChat:f.bridge,v20Associations:f.links,origin,password,voiceProvider:null})
  await new Promise(r=>app.listen(8787,'127.0.0.1',r))
  const ctx=await browser.newContext({viewport:{width,height:width===1440?1000:844}})
  try{
   const login=await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}});assert.equal(login.status(),200)
   const page=await ctx.newPage(),errors=[],external=[]
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('data:'))external.push(new URL(r.url()).origin)})
   const response=page.waitForResponse(r=>r.url()===origin+'/api/chat/conversations?skip=0')
   await page.goto(origin+'/conversas');const wire=await(await response).json()
   await page.locator('.conversation-row').last().waitFor();assert.equal(await page.locator('.conversation-row').count(),7)
   const row=name=>page.locator('.conversation-row').filter({has:page.locator('.conversation-names').filter({hasText:name})})
   const expected={'Contato principal':'Ficha: +5531999990404','PN divergente':'+5531999990505','Sem número':'Telefone pendente','Duas fichas':'Telefone pendente','Sem vínculo':'Telefone pendente','PN confirmado':'+5531999990808','Conflito':'Telefone pendente'}
   for(const[name,text]of Object.entries(expected))assert.equal(await row(name).locator('.conversation-phone').innerText(),text)
   assert.equal(wire.source,'evolution');const dto=wire.items.find(r=>r.displayName==='Contato principal');assert.equal(dto.phoneNumber,null);assert.equal(dto.atendimentoPhone,'5531999990404')
   assert.equal(wire.items.find(r=>r.displayName==='PN divergente').atendimentoPhone,'5531999990707')
   const detail=await(await ctx.request.get(origin+'/api/atendimentos/'+a.id)).json();assert.equal(detail.phoneNormalized,'+'+dto.atendimentoPhone)
   await page.screenshot({path:out+'/list-'+width+'.png',fullPage:true})
   const expectedIds=names=>wire.items.filter(item=>names.includes(item.displayName)).map(item=>item.conversationId).sort()
   for(const [phone,names] of [
    ['5531999990404',['Contato principal','Duas fichas','Conflito']],
    ['5531999990707',['PN divergente','Duas fichas']],
   ]){
    const toggle=page.getByRole('button',{name:/Abrir busca de Vendas|Editar busca:/})
    await toggle.click()
    await page.getByRole('searchbox',{name:'Pesquisar em Vendas'}).fill(phone)
    const result=page.waitForResponse(r=>r.url().includes('/api/chat/conversations?')&&new URL(r.url()).searchParams.get('q')===phone)
    await page.getByRole('button',{name:'Buscar',exact:true}).click()
    const filtered=await(await result).json()
    assert.equal(filtered.source,'local')
    assert.deepEqual(filtered.items.map(item=>item.conversationId).sort(),expectedIds(names))
    await page.waitForFunction(count=>document.querySelectorAll('.conversation-row').length===count,names.length)
   }
   await page.goto(origin+'/atendimentos/'+a.id+'?aba=diagnosticos');await page.waitForFunction(()=>document.querySelector('.detail-phone')?.textContent==='+5531999990404')
   await page.goto(origin+'/conversas');await row('Contato principal').waitFor()
   assert.equal(await row('Contato principal').locator('.conversation-phone').innerText(),'Ficha: +5531999990404')
   await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.getByText('Carregando conversas…',{exact:true}).waitFor({state:'hidden'})
   assert.equal(await row('Contato principal').locator('.conversation-phone').innerText(),'Ficha: +5531999990404')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   assert.deepEqual(errors,[]);assert.deepEqual(external,[])
   assert.deepEqual(f.db.prepare('SELECT * FROM v20_associations ORDER BY id').all(),linksBefore)
   assert.deepEqual(f.sideEffects(),{sends:0,historyCalls:0})
   results.push({width,source:'evolution',realApi:true,providerTransport:'synthetic',scenarios:expected,linkedContactAgreesWithDetail:true,searchBothPhones:true,refresh:true,unchangedLinks:true,realSends:0,overflow:false})
  }finally{await ctx.close();await new Promise(r=>app.close(r));f.db.close()}
 }
 writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results))
}finally{await browser?.close();vite.kill()}
