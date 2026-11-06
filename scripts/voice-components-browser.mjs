import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {createVoiceBrowserAudio,recordVoice,clarifyVoice} from './browser/voice-audio.mjs'
import {openDatabase} from '../server/database.ts'
import {commercialFixture} from '../server/tests/fixtures/commercial.ts'
import {ComponentRepository} from '../server/components.ts'
import {createApp} from '../server/app.ts'
const origin='http://127.0.0.1:5173',password='synthetic-component-browser-password',artifacts=process.env.FUNIX_VOICE_ARTIFACTS??'artifacts/voice-components'
mkdirSync(artifacts,{recursive:true})
const ref=id=>({state:'resolved',id}),unknown=text=>({state:'unresolved',text,candidates:[]})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'}),audio=createVoiceBrowserAudio();let browser
async function ready(){for(let i=0;i<80;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Vite not ready')}
try{
 await ready();browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox',...audio.args]})
 for(const [width,height]of [[320,740],[390,844],[1440,900]]){
  const db=openDatabase(':memory:'),f=commercialFixture(db),components=new ComponentRepository(db)
  const catalog=f.commercial.catalogs().items,front=catalog.find(p=>p.code==='para_choque_dianteiro'),passenger=catalog.find(p=>p.code==='caixa_de_ar__passageiro')
  const parents=f.commercial.add(f.at.id,{pieceCodes:[front.code,passenger.code]}),frontItem=parents.find(p=>p.pieceId===front.id)
  const current=f.scenarios.list(f.at.id)[0],other=f.scenarios.create(f.at.id,{name:'Outro QA',duplicateFrom:current.id,sourceRevision:current.revision})
  const privateName='Suporte <img src=x onerror="window.__componentXSS=1"> ANA_SINTETICA 11988776655 ABC1D23 TOKEN_COMPONENTE_QA'
  let mode='front',calls=0
  const provider={transcribe:async(bytes,mime)=>{audio.observeUpload(bytes,mime);return mode==='clarify'?'ambos':'No para-choque dianteiro adiciona o guia dianteiro esquerdo.'},interpret:async()=>{
   calls++;const pair=mode==='pair',piece=pair?unknown('Caixa de ar'):ref(front.id)
   return {commands:[{id:'part',op:'add_component',intent:'instruction',piece,name:mode==='zero'?'Parafuso fixador':mode==='privacy'?privateName:pair?'Grampo lateral':'Guia dianteiro esquerdo',quantity:'1',manualPrice:mode==='privacy'?'9876.54321':'0'},...(pair?[{id:'service',op:'add_service',intent:'instruction',piece,service:ref(f.service.id),dimension:ref(f.dimension.id),preserveDimension:false,quantity:null}]:[])]}
  }}
  const app=createApp({atendimentos:f.atendimentos,origin,password,voiceProvider:provider});await new Promise(r=>app.listen(8787,'127.0.0.1',r))
  const context=await browser.newContext({viewport:{width,height},permissions:['microphone','clipboard-read','clipboard-write']});await audio.install(context);let page
  try{
   await context.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
   page=await context.newPage();const errors=[],componentPosts=[]
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/componentes'))componentPosts.push(r.url())})
   await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos');await page.locator('.commercial-workspace').waitFor()
   await page.locator('.approved-finance .summary').click();await page.locator('.neg-head').click()
   const money=page.getByRole('textbox',{name:'Valor em reais',exact:true});await money.fill('123,45');await money.blur();await page.locator('.approved-finance .summary').click()
   const panel=page.locator('.voice-panel')
   const response=await recordVoice(page,audio),root=await response.json();assert.equal(root.plan.changes[0].values.manualPrice,'0')
   let row=panel.locator('.voice-component-values').first();await row.waitFor()
   assert.equal(await row.getByRole('textbox',{name:'Quantidade do componente',exact:true}).inputValue(),'1');assert.equal(await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).inputValue(),'0,00')
   const writes=db.prepare('SELECT total_changes() n').get().n
   await row.getByRole('textbox',{name:'Quantidade do componente',exact:true}).fill('2');await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).fill('-1')
   assert(await panel.locator('.voice-apply').isDisabled())
   const invalid=page.waitForResponse(r=>r.url().endsWith('/copiloto/revisar'));await row.getByRole('button',{name:'Revisar valores',exact:true}).click();assert.equal((await invalid).status(),400)
   await panel.getByRole('alert').filter({hasText:'quantidade positiva'}).waitFor()
   assert.equal(await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).inputValue(),'-1')
   await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).fill('35,90')
   const revisedResponse=page.waitForResponse(r=>r.url().endsWith('/copiloto/revisar')&&r.status()===200);await row.getByRole('button',{name:'Revisar valores',exact:true}).click();const revised=await (await revisedResponse).json()
   assert.equal(revised.plan.changes[0].values.quantity,'2');assert.equal(revised.plan.changes[0].values.manualPrice,'35.9');assert.equal(db.prepare('SELECT total_changes() n').get().n,writes)
   assert.equal(components.list(f.at.id).length,0);await panel.getByRole('button',{name:'Revisar valores',exact:true}).waitFor({state:'hidden'})
   await panel.screenshot({path:artifacts+'/edited-'+width+'.png'})
   async function apply(){const refreshed=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.endsWith('/cenarios')&&r.status()===200),applied=page.waitForResponse(r=>r.url().endsWith('/copiloto/aplicar')&&r.status()===200);await panel.locator('.voice-apply').click();await applied;await panel.waitFor({state:'hidden'});return (await refreshed).json()}
   const workspace=await apply(),guide=components.list(f.at.id)[0]
   assert.equal(guide.pieceId,frontItem.id);assert.equal(guide.quantity,'2');assert.equal(guide.manualPrice,'35.9')
   assert.equal(workspace.calculations.find(c=>c.scenarioId===f.scenario.id).componentSubtotal,'143.6')
   assert.equal(f.scenarios.list(f.at.id).find(s=>s.id===other.id).componentFlags[guide.id],false)
   await page.locator('.approved-finance .summary').click();assert.match(await money.inputValue(),/123,45/);await page.locator('.approved-finance .summary').click()
   mode='zero';await recordVoice(page,audio);await apply();assert.equal(components.list(f.at.id)[1].manualPrice,'0')
   for(const label of ['Motorista','Passageiro']){
    mode='pair';await recordVoice(page,audio);const selected=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver'))
    await panel.getByRole('button',{name:label,exact:true}).click();const result=await (await selected).json()
    assert.equal(result.plan.changes.filter(c=>c.op==='add_piece').length,label==='Motorista'?1:0);assert.equal(result.plan.changes.filter(c=>c.op==='add_component').length,1);assert.equal(components.list(f.at.id).length,2)
   }
   mode='pair';await recordVoice(page,audio);const originalCalls=calls;mode='clarify';const both=await (await clarifyVoice(page,audio)).json();assert.equal(calls,originalCalls)
   assert.equal(both.plan.changes.filter(c=>c.op==='add_component').length,2);assert.equal(both.plan.changes.filter(c=>c.op==='add_piece').length,1)
   for(let index=0;index<2;index++){
    row=panel.locator('.voice-component-values').nth(index);await row.getByRole('textbox',{name:'Quantidade do componente',exact:true}).fill(String(index+2));await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).fill(String((index+1)*10))
    const saved=page.waitForResponse(r=>r.url().endsWith('/copiloto/revisar')&&r.status()===200);await row.getByRole('button',{name:'Revisar valores',exact:true}).click();await saved;await panel.getByRole('button',{name:'Revisar valores',exact:true}).waitFor({state:'hidden'})
   }
   await panel.screenshot({path:artifacts+'/both-'+width+'.png'});await apply();assert.equal(components.list(f.at.id).length,4)
   const additions=components.list(f.at.id).slice(2);assert.equal(new Set(additions.map(c=>c.pieceId)).size,2);for(const c of additions)assert.equal(f.scenarios.list(f.at.id).find(s=>s.id===other.id).componentFlags[c.id],false)
   mode='front';await recordVoice(page,audio);assert(await panel.locator('.voice-apply').isDisabled());assert.match(await panel.innerText(),/Guia dianteiro esquerdo/);assert.match(await panel.innerText(),/Já cadastrado/);await panel.screenshot({path:artifacts+'/duplicate-'+width+'.png'});let chosen=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver'));await panel.getByRole('button',{name:'Manter existente',exact:true}).click();await chosen;assert(await panel.locator('.voice-apply').isDisabled());assert.equal(components.list(f.at.id).length,4)
   await recordVoice(page,audio);chosen=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver'));await panel.getByRole('button',{name:'Adicionar outro',exact:true}).click();await chosen;assert.equal(components.list(f.at.id).length,4);await apply();assert.equal(components.list(f.at.id).length,5);assert.deepEqual(components.list(f.at.id).find(c=>c.id===guide.id),guide)
   mode='privacy';await recordVoice(page,audio);assert.equal(await panel.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.__componentXSS),undefined)
   await panel.getByRole('button',{name:'Mostrar transcrição',exact:true}).click();const diagnostic=panel.locator('.voice-diagnostic');assert.match(await diagnostic.innerText(),/ANA_SINTETICA/)
   await panel.getByRole('button',{name:'Copiar diagnóstico',exact:true}).focus();await page.keyboard.press('Enter');await panel.getByText('Diagnóstico copiado sem transcrição ou dados pessoais.',{exact:true}).waitFor()
   const copied=await page.evaluate(()=>navigator.clipboard.readText());for(const privateValue of ['ANA_SINTETICA','11988776655','ABC1D23','TOKEN_COMPONENTE_QA','9876.54321','manualPrice',privateName])assert(!copied.includes(privateValue),privateValue)
   assert.match(copied,/add_component/);await panel.locator('.copilot-feed').evaluate(el=>{el.scrollTop=0});await panel.screenshot({path:artifacts+'/diagnostic-'+width+'.png'})
   assert.equal(f.commercial.list(f.at.id).find(p=>p.id===f.item.id).services[0].id,f.item.services[0].id);await page.locator('.approved-finance .summary').click();assert.match(await money.inputValue(),/123,45/)
   assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.deepEqual(componentPosts,[]);assert.deepEqual(errors,[])
   console.log('PASS Issue64 '+width+': editable component, zero price, sides/Both/Falar, duplicate decisions, same Apply, MR, R$ 123,45, XSS and private clipboard')
  }catch(error){if(page){console.log('VISIBLE',await page.locator('body').innerText());await page.screenshot({path:artifacts+'/failure-'+width+'.png'})}throw error}
  finally{await context.close();app.closeAllConnections();await new Promise(r=>app.close(r));db.close()}
 }
}finally{await browser?.close();vite.kill('SIGTERM');audio.dispose()}
