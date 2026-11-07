import assert from'node:assert/strict'
import{existsSync,mkdirSync,writeFileSync}from'node:fs'
import{spawn}from'node:child_process'
import{chromium}from'playwright'
import{createVoiceBrowserAudio,recordVoice}from'./browser/voice-audio.mjs'
import{openDatabase}from'../server/database.ts'
import{commercialFixture}from'../server/tests/fixtures/commercial.ts'
import{createApp}from'../server/app.ts'
import{createQuoteService}from'../server/component-quote-service.ts'
import{validateQuoteResponse}from'../server/component-quote-provider.ts'
import{quoteFixtureQuery,quoteFixtureResponse,quoteFixtureUrl}from'../server/tests/fixtures/component-quote.ts'
const origin='http://127.0.0.1:5173',password='synthetic-quote-browser-password',artifacts=process.env.FUNIX_QUOTE_ARTIFACTS??'docs/evidencias/issue70/browser'
mkdirSync(artifacts,{recursive:true})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'}),audio=createVoiceBrowserAudio();let browser
const results=[]
async function ready(){for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Vite not ready')}
try{
 await ready();browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox',...audio.args]})
 for(const[width,height]of[[320,740],[390,844],[1440,900]]){
  const db=openDatabase(':memory:'),f=commercialFixture(db)
  f.atendimentos.update(f.at.id,{revision:f.at.revision,brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019'})
  const front=f.commercial.catalogs().items.find(p=>p.code==='para_choque_dianteiro')
  f.commercial.add(f.at.id,{pieceCodes:[front.code]})
  let quotes=0,voiceCalls=0
  const voiceProvider={transcribe:async(bytes,mime)=>{audio.observeUpload(bytes,mime);return'No para-choque dianteiro adiciona o farol dianteiro esquerdo.'},interpret:async()=>{voiceCalls++;return{commands:[{id:'quote-component',op:'add_component',intent:'instruction',piece:{state:'resolved',id:front.id},name:'farol dianteiro esquerdo',quantity:'1',manualPrice:'0'}]}}}
  const quotePilot=createQuoteService({search:async(query)=>{quotes++;assert.deepEqual(query,quoteFixtureQuery);return validateQuoteResponse(quoteFixtureResponse(),query)}})
  const app=createApp({atendimentos:f.atendimentos,origin,password,voiceProvider,quotePilot});await new Promise(r=>app.listen(8787,'127.0.0.1',r))
  const context=await browser.newContext({viewport:{width,height},permissions:['microphone','clipboard-read','clipboard-write']});await audio.install(context)
  try{
   await context.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
   const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')requests.push(new URL(r.url()).pathname)})
   await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos');await page.locator('.commercial-workspace').waitFor()
   await recordVoice(page,audio)
   const panel=page.locator('.voice-panel'),quote=panel.getByRole('button',{name:'Cotar componente',exact:true}),price=panel.getByRole('textbox',{name:'Preço unitário do componente',exact:true})
   await quote.waitFor();assert.equal(quotes,0);assert.equal(voiceCalls,1);assert(await quote.isEnabled())
   const writes=db.prepare('SELECT total_changes() n').get().n
   await quote.focus();await page.keyboard.press('Enter')
   const selected=panel.getByRole('button',{name:'Original nova, R$ 39,90',exact:true});await selected.waitFor();assert(await selected.isEnabled());assert.equal(quotes,1)
   assert.equal(await panel.locator('.component-quote-options button').count(),3)
   assert(await panel.getByRole('button',{name:'Econômica, não encontrado nesta consulta',exact:true}).isDisabled())
   assert.equal(await panel.getByRole('link',{name:'Abrir anúncio de origem: Original nova'}).getAttribute('href'),quoteFixtureUrl)
   const optionText=await panel.locator('.component-quote-options').innerText();assert(!/Econômica|Equilibrada|Original nova|aproximado|referência de mercado/.test(optionText))
   const geometry=await panel.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth,rows:[...el.querySelectorAll('.voice-component-line>*')].map(x=>{const b=x.getBoundingClientRect();return{x:b.x,width:b.width,y:b.bottom}})}))
   assert(geometry.scroll<=geometry.client+1);assert(geometry.width<=width);assert(Math.max(...geometry.rows.map(x=>x.y))-Math.min(...geometry.rows.map(x=>x.y))<=1)
   await panel.screenshot({path:artifacts+'/offers-'+width+'.png'})
   const revise=page.waitForResponse(r=>r.url().endsWith('/copiloto/revisar'));await selected.focus();await page.keyboard.press('Enter');assert.equal((await revise).status(),200)
   await page.waitForFunction(()=>document.querySelector('.voice-panel input[aria-label="Preço unitário do componente"]')?.value==='39,90');assert.equal(await price.inputValue(),'39,90')
   assert.equal(requests.filter(p=>p.endsWith('/copiloto/revisar')).length,1);assert.equal(requests.filter(p=>p.endsWith('/copiloto/aplicar')).length,0)
   assert.equal(db.prepare('SELECT total_changes() n').get().n,writes)
   await price.fill('57,25');assert.equal(await price.inputValue(),'57,25');assert(await panel.locator('.voice-apply').isDisabled())
   // Hold only the browser response, then edit. Aborting/epochs must prevent a
   // cached response from repopulating offers or overwriting the manual price.
   let release;const gate=new Promise(r=>{release=r});let held=false
   await page.route('**/copiloto/cotar',async route=>{const r=await route.fetch();held=true;await gate;try{await route.fulfill({response:r})}catch{}})
   await quote.click();await page.waitForFunction(()=>true);for(let i=0;i<50&&!held;i++)await new Promise(r=>setTimeout(r,10));assert(held)
   await price.fill('61,50');release();await page.waitForTimeout(80)
   assert.equal(await price.inputValue(),'61,50');assert.equal(await panel.locator('.component-quote-options').count(),0);await page.unroute('**/copiloto/cotar')
   assert.equal(quotes,1) // per-session normalized query cache, not another tool call
   const manual=page.waitForResponse(r=>r.url().endsWith('/copiloto/revisar'));await panel.getByRole('button',{name:'Revisar valores',exact:true}).click();assert.equal((await manual).status(),200)
   await panel.getByRole('button',{name:'Revisar valores',exact:true}).waitFor({state:'hidden'});assert.equal(await price.inputValue(),'61,50')
   assert.equal(db.prepare('SELECT total_changes() n').get().n,writes)
   // Quotation and excerpts do not enter clipboard diagnostics.
   await panel.getByRole('button',{name:'Mostrar transcrição',exact:true}).click();await panel.getByRole('button',{name:'Copiar diagnóstico',exact:true}).click()
   const copied=await page.evaluate(()=>navigator.clipboard.readText());assert(!/39[,.]90|61[,.]50|MLB-0000000000|volkswagen|Loja oficial/i.test(copied))
   await panel.getByRole('button',{name:'Mostrar transcrição',exact:true}).click()
   const applied=page.waitForResponse(r=>r.url().endsWith('/copiloto/aplicar'));await panel.locator('.voice-apply').click();assert.equal((await applied).status(),200)
   assert.equal(db.prepare('SELECT manual_price FROM component_items').get().manual_price,'61.5')
   assert.equal(requests.filter(p=>p.endsWith('/copiloto/aplicar')).length,1)
   assert.equal(await page.evaluate(()=>window.__quoteXSS),undefined);assert.deepEqual(errors,[])
   results.push({width,geometry,synthetic:true,quoteProviderCalls:quotes,voiceCalls,singleSelectionRevision:true,manualEditPreserved:true,finalExplicitApply:true,clipboardPrivate:true,errors})
  }finally{await context.close();app.closeAllConnections();await new Promise(r=>app.close(r));db.close()}
 }
 writeFileSync(artifacts+'/results.json',JSON.stringify(results,null,2)+'\n')
}finally{await browser?.close();vite.kill('SIGTERM');audio.dispose()}
