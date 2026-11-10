import assert from 'node:assert/strict'
import {existsSync,mkdirSync,writeFileSync} from 'node:fs'
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
  f.commercial.saveCatalog({revision:front.revision,name:'PARA-CHOQUE DIANTEIRO'},front.id)
  const parents=f.commercial.add(f.at.id,{pieceCodes:[front.code,passenger.code]}),frontItem=parents.find(p=>p.pieceId===front.id)
  const current=f.scenarios.list(f.at.id)[0],other=f.scenarios.create(f.at.id,{name:'Outro QA',duplicateFrom:current.id,sourceRevision:current.revision})
  const privateName='Suporte <img src=x onerror="window.__componentXSS=1"> ANA_SINTETICA 11988776655 ABC1D23 TOKEN_COMPONENTE_QA'
  let mode='front',calls=0
  const provider={transcribe:async(bytes,mime)=>{audio.observeUpload(bytes,mime);return mode==='clarify'?'ambos':'No para-choque dianteiro adiciona o guia dianteiro esquerdo.'},interpret:async()=>{
   calls++;const pair=mode==='pair',piece=pair?unknown('Caixa de ar'):ref(front.id)
   return {commands:[{id:'part',op:'add_component',intent:'instruction',piece,name:mode==='parentOff'?'SUPORTE LED H4':mode==='zero'?'PARAFUSO FIXADOR':mode==='privacy'?privateName:pair?'Grampo lateral':'GUIA DIANTEIRO ESQUERDO',quantity:'1',manualPrice:mode==='privacy'?'9876.54321':'0'},...(pair?[{id:'service',op:'add_service',intent:'instruction',piece,service:ref(f.service.id),dimension:ref(f.dimension.id),preserveDimension:false,quantity:null}]:[])]}
  }}
  const app=createApp({atendimentos:f.atendimentos,origin,password,voiceProvider:provider});await new Promise(r=>app.listen(8787,'127.0.0.1',r))
  const context=await browser.newContext({viewport:{width,height},permissions:['microphone','clipboard-read','clipboard-write']});await audio.install(context);let page
  try{
   await context.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
   page=await context.newPage();const errors=[],componentPosts=[],revisionPosts=[],switchTransitions=[]
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/componentes'))componentPosts.push(r.url());if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/copiloto/revisar'))revisionPosts.push(r.postDataJSON())})
   await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos');await page.locator('.commercial-workspace').waitFor()
   await page.locator('.approved-finance .summary').click();await page.locator('.neg-head').click()
   const money=page.getByRole('textbox',{name:'Valor em reais',exact:true});await money.fill('123,45');await money.blur();await page.locator('.approved-finance .summary').click()
   await page.waitForFunction(()=>document.querySelector('.voice-launcher')?.getAttribute('data-voice-ready')==='true',null,{timeout:15000})
   assert.equal(f.scenarios.list(f.at.id)[0]?.negotiationDraft?.value,'123,45')
   const panel=page.locator('.voice-panel')
   const response=await recordVoice(page,audio),root=await response.json();assert.equal(root.plan.changes[0].values.manualPrice,'0')
   let row=panel.locator('.voice-component-values').first();await row.waitFor()
   assert.equal(await row.getByRole('textbox',{name:'Quantidade do componente',exact:true}).inputValue(),'1');assert.equal(await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).inputValue(),'0,00')
   async function compactRow(row){
    const line=row.locator('.voice-component-line'),controls=line.locator('button,input')
    assert.equal(await controls.count(),3)
    const boxes=await controls.evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}}))
    assert(boxes.every(b=>b.height>=44));assert(boxes.every(b=>Math.abs(b.bottom-boxes[0].bottom)<1));assert(boxes.every((b,i)=>!i||b.x>=boxes[i-1].x+boxes[i-1].width))
    assert(await line.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
    assert.equal(await row.getByRole('button',{name:'Cotar componente',exact:true}).count(),0)
    const links=row.locator('.component-search-links')
    await links.waitFor()
    assert.equal(await links.locator('.component-search-link-cell').count(),3)
    assert.deepEqual(await links.locator('.component-search-link-cell').allTextContents(),['Geral','Original','Oficial'])
    assert.equal(await links.locator('a[href*="/cotar"]').count(),0,'no quotation API links')
   }
   async function toggleComponent(row,expected,keyboard=false){
    const control=row.getByRole('switch'),before=revisionPosts.length
    await row.locator('button[role="switch"]:enabled').waitFor({state:'visible',timeout:3000})
    assert.equal(await control.getAttribute('aria-checked'),String(!expected))
    // Status is asserted after receiving the response: do not hide 4xx/5xx by
    // filtering only successful replies, and do not confuse HTTP with rendering.
    const pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/copiloto/revisar'))
    if(keyboard){await control.focus();assert(await control.evaluate(el=>el===document.activeElement));await page.keyboard.press('Space')}
    else await control.click()
    const response=await pending;assert.equal(response.status(),200)
    const request=response.request().postDataJSON(),revised=await response.json()
    assert.equal(request.enabled,expected)
    const command=revised.reviewGroups.flatMap(g=>g.entries).find(e=>e.component?.commandId===request.commandId)?.component
    assert(command,'server response must include the revised component')
    assert.equal(command.enabled,expected)
    const change=revised.plan.changes.find(c=>c.op==='add_component'&&c.origins.presence?.commandId===request.commandId)
    assert(change,'server plan must include the component command')
    assert.equal(change.flags[f.scenario.id],expected)
    assert.equal(revised.applied,false)
    // A locator re-resolves after the component remounts on a new resolution.
    await row.getByRole('switch',{checked:expected}).waitFor({state:'visible',timeout:3000})
    await row.locator('button[role="switch"]:enabled').waitFor({state:'visible',timeout:3000})
    assert.equal(await control.getAttribute('aria-checked'),String(expected))
    assert.equal(revisionPosts.length-before,1,'one switch activation must issue one revision')
    switchTransitions.push({trigger:keyboard?'Space':'click',expected,requestEnabled:request.enabled,serverEnabled:command.enabled,serverFlag:change.flags[f.scenario.id],domChecked:await control.getAttribute('aria-checked'),revisionPosts:revisionPosts.length-before,status:response.status()})
    return revised
   }
   assert.equal(await panel.locator('.voice-piece h3').first().innerText(),'Para-choque dianteiro');writeFileSync(artifacts+'/accessibility-'+width+'.txt',await row.ariaSnapshot())
   await compactRow(row);assert.equal(await row.getByRole('switch').getAttribute('aria-checked'),'true')
   assert(!(await panel.innerText()).includes('Dados compartilhados; habilitação por cenário.'));assert(!(await panel.innerText()).includes('Confira as alterações antes de aplicar.'))
   const writes=db.prepare('SELECT total_changes() n').get().n
   await row.getByRole('textbox',{name:'Quantidade do componente',exact:true}).fill('2');await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).fill('-1')
   assert(await panel.locator('.voice-apply').isDisabled())
   const invalid=page.waitForResponse(r=>r.url().endsWith('/copiloto/revisar'));await row.getByRole('button',{name:'Revisar valores',exact:true}).click();assert.equal((await invalid).status(),400)
   await panel.getByRole('alert').filter({hasText:'quantidade positiva'}).waitFor()
   assert.equal(await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).inputValue(),'-1')
   await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).fill('35,90')
   const revised=await toggleComponent(row,false)
   assert.equal(revised.plan.changes[0].flags[f.scenario.id],false);assert.equal(revised.plan.changes[0].values.quantity,'2');assert.equal(revised.plan.changes[0].values.manualPrice,'35.9');assert.equal(db.prepare('SELECT total_changes() n').get().n,writes)
   assert.equal(components.list(f.at.id).length,0);await panel.getByRole('button',{name:'Revisar valores',exact:true}).waitFor({state:'hidden'})
   await toggleComponent(row,true,true);await compactRow(row)
   await panel.screenshot({path:artifacts+'/edited-'+width+'.png'})
   async function apply(){const refreshed=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.endsWith('/cenarios')&&r.status()===200),applied=page.waitForResponse(r=>r.url().endsWith('/copiloto/aplicar')&&r.status()===200);await panel.locator('.voice-apply').click();await applied;await panel.waitFor({state:'hidden'});return (await refreshed).json()}
   const workspace=await apply(),guide=components.list(f.at.id)[0]
   assert.equal(f.commercial.catalogs().items.find(p=>p.id===front.id).name,'PARA-CHOQUE DIANTEIRO');assert.equal(guide.name,'GUIA DIANTEIRO ESQUERDO');assert.equal(guide.pieceId,frontItem.id);assert.equal(guide.quantity,'2');assert.equal(guide.manualPrice,'35.9')
   assert.equal(workspace.calculations.find(c=>c.scenarioId===f.scenario.id).componentSubtotal,'143.6')
   assert.equal(f.scenarios.list(f.at.id).find(s=>s.id===other.id).componentFlags[guide.id],false)
   await page.locator('.approved-finance .summary').click();assert.match(await money.inputValue(),/123,45/);await page.locator('.approved-finance .summary').click()
   mode='zero';await recordVoice(page,audio);assert.equal(await panel.locator('.voice-entry-label').first().innerText(),'Parafuso fixador')
   await toggleComponent(panel.locator('.voice-component-values').first(),false);await compactRow(panel.locator('.voice-component-values').first());await panel.screenshot({path:artifacts+'/off-'+width+'.png'});await apply();const zero=components.list(f.at.id)[1];assert.equal(zero.manualPrice,'0');assert.equal(zero.name,'PARAFUSO FIXADOR');assert.equal(f.scenarios.list(f.at.id).find(s=>s.id===f.scenario.id).componentFlags[zero.id],false)
   for(const label of ['Motorista','Passageiro']){
    mode='pair';await recordVoice(page,audio);const selected=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver'))
    await panel.getByRole('button',{name:label,exact:true}).click();const result=await (await selected).json()
    assert.equal(result.plan.changes.filter(c=>c.op==='add_piece').length,label==='Motorista'?1:0);assert.equal(result.plan.changes.filter(c=>c.op==='add_component').length,1);assert.equal(components.list(f.at.id).length,2)
   }
   mode='pair';await recordVoice(page,audio);const originalCalls=calls;mode='clarify';const both=await (await clarifyVoice(page,audio)).json();assert.equal(calls,originalCalls)
   assert.equal(both.plan.changes.filter(c=>c.op==='add_component').length,2);assert.equal(both.plan.changes.filter(c=>c.op==='add_piece').length,1)
   for(let index=0;index<2;index++){
    row=panel.locator('.voice-component-values').nth(index);await row.getByRole('textbox',{name:'Quantidade do componente',exact:true}).fill(String(index+2));await row.getByRole('textbox',{name:'Preço unitário do componente',exact:true}).fill(String((index+1)*10))
    if(index===1)await toggleComponent(row,false);else{const saved=page.waitForResponse(r=>r.url().endsWith('/copiloto/revisar'));await row.getByRole('button',{name:'Revisar valores',exact:true}).click();assert.equal((await saved).status(),200)}await compactRow(row);await panel.getByRole('button',{name:'Revisar valores',exact:true}).waitFor({state:'hidden'})
   }
   await panel.screenshot({path:artifacts+'/both-'+width+'.png'});await apply();assert.equal(components.list(f.at.id).length,4)
   const additions=components.list(f.at.id).slice(2);assert.equal(additions.filter(c=>f.scenarios.list(f.at.id).find(s=>s.id===f.scenario.id).componentFlags[c.id]).length,1);assert.equal(new Set(additions.map(c=>c.pieceId)).size,2);for(const c of additions)assert.equal(f.scenarios.list(f.at.id).find(s=>s.id===other.id).componentFlags[c.id],false)
   mode='front';await recordVoice(page,audio);assert(await panel.locator('.voice-apply').isDisabled());assert.match(await panel.innerText(),/Guia dianteiro esquerdo/);assert.match(await panel.innerText(),/Já cadastrado/);assert(!(await panel.innerText()).includes('GUIA DIANTEIRO ESQUERDO'));await panel.screenshot({path:artifacts+'/duplicate-'+width+'.png'});let chosen=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver'));await panel.getByRole('button',{name:'Manter existente',exact:true}).click();await chosen;assert(await panel.locator('.voice-apply').isDisabled());assert.equal(components.list(f.at.id).length,4)
   await recordVoice(page,audio);chosen=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver'));await panel.getByRole('button',{name:'Adicionar outro',exact:true}).click();await chosen;assert.equal(components.list(f.at.id).length,4);await apply();assert.equal(components.list(f.at.id).length,5);assert.deepEqual(components.list(f.at.id).find(c=>c.id===guide.id),guide)
   mode='privacy';await recordVoice(page,audio);assert.equal(await panel.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.__componentXSS),undefined)
   await panel.getByRole('button',{name:'Mostrar transcrição',exact:true}).click();const diagnostic=panel.locator('.voice-diagnostic');assert.match(await diagnostic.innerText(),/ANA_SINTETICA/)
   await panel.getByRole('button',{name:'Copiar diagnóstico',exact:true}).focus();await page.keyboard.press('Enter');await panel.getByText('Diagnóstico copiado sem transcrição ou dados pessoais.',{exact:true}).waitFor()
   const copied=await page.evaluate(()=>navigator.clipboard.readText());for(const privateValue of ['ANA_SINTETICA','11988776655','ABC1D23','TOKEN_COMPONENTE_QA','9876.54321','manualPrice',privateName])assert(!copied.includes(privateValue),privateValue)
   assert.match(copied,/add_component/);await panel.locator('.copilot-feed').evaluate(el=>{el.scrollTop=0});await panel.screenshot({path:artifacts+'/diagnostic-'+width+'.png'})
   await page.locator('.approved-finance .summary').click();assert.match(await money.inputValue(),/123,45/);await page.locator('.approved-finance .summary').click()
   const scene=f.scenarios.list(f.at.id).find(s=>s.id===f.scenario.id);f.scenarios.update(f.at.id,scene.id,{revision:scene.revision,pieceFlags:{...scene.pieceFlags,[frontItem.id]:false}})
   await page.reload();await page.locator('.commercial-workspace').waitFor();mode='parentOff';await recordVoice(page,audio)
   assert.equal(await panel.getByRole('switch').getAttribute('aria-checked'),'false');assert(await panel.getByRole('switch').isDisabled());assert.match(await panel.innerText(),/fora do cálculo/);assert.equal(await panel.locator('.voice-entry-label').first().innerText(),'Suporte LED H4');await compactRow(panel.locator('.voice-component-values').first());await panel.screenshot({path:artifacts+'/parent-off-'+width+'.png'})
   assert.equal(f.commercial.list(f.at.id).find(p=>p.id===f.item.id).services[0].id,f.item.services[0].id)
   assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.deepEqual(componentPosts,[]);assert.deepEqual(errors,[])
   writeFileSync(artifacts+'/switch-sync-'+width+'.json',JSON.stringify({width,switchTransitions},null,2)+'\n')
   console.log('PASS Issue66 '+width+ ' compact three controls and search links, real switch, keyboard, off and disabled parent; Issue64: editable component, zero price, sides/Both/Falar, duplicate decisions, same Apply, MR, R$ 123,45, XSS and private clipboard')
  }catch(error){if(page){console.log('VISIBLE',await page.locator('body').innerText());await page.screenshot({path:artifacts+'/failure-'+width+'.png'})}throw error}
  finally{await context.close();app.closeAllConnections();await new Promise(r=>app.close(r));db.close()}
 }
}finally{await browser?.close();vite.kill('SIGTERM');audio.dispose()}
