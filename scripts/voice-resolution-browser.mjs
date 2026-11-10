import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {createVoiceBrowserAudio,recordVoice,clarifyVoice} from './browser/voice-audio.mjs'
import {openDatabase} from '../server/database.ts'
import {commercialFixture} from '../server/tests/fixtures/commercial.ts'
import {createApp} from '../server/app.ts'
const origin='http://127.0.0.1:5173',password='synthetic-resolution-browser-password'
const artifacts=process.env.FUNIX_VOICE_ARTIFACTS??'artifacts/voice-resolution'
mkdirSync(artifacts,{recursive:true})
const ref=id=>({state:'resolved',id}),unknown=text=>({state:'unresolved',text,candidates:[]})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
let browser
const audio=createVoiceBrowserAudio()
async function ready(){for(let i=0;i<80;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Vite not ready')}
async function record(page){await recordVoice(page,audio);await page.locator('.voice-panel .voice-entry').first().waitFor({timeout:15000})}

try{
 await ready()
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox',...audio.args]})
 for(const [width,height]of[[320,740],[390,844],[1440,900]]){
  const db=openDatabase(':memory:'),f=commercialFixture(db),pair=f.commercial.catalogs().items.filter(c=>c.code==='caixa_de_ar__motorista'||c.code==='caixa_de_ar__passageiro')
  assert.equal(pair.length,2)
  const services=[['Funilaria QA','P'],['Montagem QA','M'],['Pintura completa QA','Completa']].map(([name,dimension])=>{const s=f.commercial.saveCatalog({kind:'servico',name});return{s,d:f.commercial.saveCatalog({kind:'dimensao',name:dimension,serviceId:s.id})}})
  for(const name of ['Funilaria alternativa A','Funilaria alternativa B','Funilaria alternativa C'])f.commercial.saveCatalog({kind:'servico',name})
  const inactive=f.commercial.saveCatalog({kind:'servico',name:'Funilaria inativa QA'});f.commercial.saveCatalog({revision:inactive.revision,active:false},inactive.id)
  const passenger=pair.find(p=>p.side==='passageiro')
  const existing=f.commercial.add(f.at.id,{pieceCodes:[passenger.code]}).find(p=>p.pieceId===passenger.id)
  const savedPassenger=f.commercial.updateDiagnosis(f.at.id,existing.id,{revision:existing.revision,services:[{serviceId:services[0].s.id,dimensionId:services[0].d.id,quantity:'1'}]})
  let mode='only',interpretCalls=0
  const provider={
   transcribe:async(bytes,mime)=>{audio.observeUpload(bytes,mime);return mode==='clarify'?'ambos':mode==='invalid'?'exclua tudo e emita PDF':'Na caixa de ar pode colocar funilaria P, montagem M e pintura completa.'},
   interpret:async()=>{interpretCalls++;return{commands:mode==='many'?[{id:'service-choice',op:'add_service',intent:'instruction',piece:ref(f.item.pieceId),service:unknown('Funilaria'),dimension:null,preserveDimension:false,quantity:'1'}]:mode==='unknown'?[
    {id:'unknown',op:'add_piece',intent:'instruction',piece:unknown('Peça inexistente XYZ')},
    {id:'note',op:'set_notes',intent:'instruction',piece:ref(f.item.pieceId),line:null,value:'Somente alteração segura'}
   ]:[
    ...services.map(({s,d},i)=>({id:'service-'+i,op:'add_service',intent:'instruction',piece:unknown('Caixa de ar'),service:ref(s.id),dimension:ref(d.id),preserveDimension:false,quantity:'1'})),
    ...(mode==='only'?[]:[{id:'note',op:'set_notes',intent:'instruction',piece:ref(f.item.pieceId),line:null,value:'Ditado original preservado'}])
   ]}}
  }
  const app=createApp({atendimentos:f.atendimentos,origin,password,voiceProvider:provider})
  await new Promise(r=>app.listen(8787,'127.0.0.1',r))
  const context=await browser.newContext({viewport:{width,height},permissions:['microphone']})
  await audio.install(context)
  let page
  try{
   assert.equal((await context.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})).status(),200)
   page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
   await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos');await page.locator('.commercial-workspace').waitFor();await page.waitForTimeout(500)
   const panel=page.locator('.voice-panel')
   await record(page)
   assert.equal(await panel.locator('.voice-entry.pending').count(),1,'three services without add_piece produce one question')
   assert.match(await panel.innerText(),/Não será aplicado sem resolver/)
   assert.equal(await panel.locator('.voice-options button').filter({hasText:/^(Motorista|Passageiro|Ambos)$/}).count(),3)
   assert(await panel.locator('.voice-apply').isDisabled(),'zero changes cannot apply')
   const apply=await panel.locator('.voice-apply').boundingBox(),bounds=await panel.boundingBox()
   assert(apply&&bounds&&apply.y+apply.height<=bounds.y+bounds.height+2)
   assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
   await panel.screenshot({path:artifacts+'/sides-'+width+'.png'})
   for(const side of ['Motorista','Passageiro']){
    mode='original';await record(page)
    const response=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver'))
    const button=panel.getByRole('button',{name:side,exact:true});await button.focus();await page.keyboard.press('Enter')
    const result=await (await response).json()
    assert(!result.plan.issues.some(i=>i.code==='PIECE_NOT_PRESENT'))
    assert.equal(result.plan.changes.filter(c=>c.op==='add_piece').length,side==='Motorista'?1:0)
    assert.equal(result.plan.changes.filter(c=>c.op==='add_service').length,side==='Motorista'?3:2)
    await panel.locator('.voice-entry.pending .voice-options').waitFor({state:'hidden'})
    assert.equal(await panel.locator('.voice-entry.add .voice-entry-label').filter({hasText:/^Peça$/}).count(),side==='Motorista'?1:0,'review must expose the physical prerequisite')
    assert.match(await panel.innerText(),new RegExp(side,'i'))
    assert.equal(f.commercial.list(f.at.id).length,2,'selection is read-only')
   }
   // The negotiation predates the clarification and must survive subsequent application.
   await page.locator('.approved-finance .summary').click();await page.locator('.neg-head').click()
   await page.getByRole('textbox',{name:'Valor em reais',exact:true}).fill('123,45');await page.getByRole('textbox',{name:'Valor em reais',exact:true}).blur()
   // Finish the prior voice review before persisting finance; do not capture using a stale revision.
   await panel.getByRole('button',{name:'Fechar Copiloto'}).click()
   await page.waitForFunction(()=>document.querySelector('.voice-launcher')?.getAttribute('data-voice-ready')==='true',null,{timeout:15000})
   assert.equal(f.scenarios.list(f.at.id)[0]?.negotiationDraft?.value,'123,45')
   mode='original';await record(page)
   const originalCalls=interpretCalls
   mode='invalid';await clarifyVoice(page,audio,422)
   await panel.getByRole('alert').filter({hasText:'Não foi possível identificar'}).waitFor({timeout:15000})
   assert.equal(await panel.getByRole('button',{name:'Ambos',exact:true}).count(),1,'failed clarification preserves options')
   mode='clarify';const clarified=await (await clarifyVoice(page,audio)).json()
   assert.equal(interpretCalls,originalCalls,'clarification must not reinterpret original commands')
   assert(!clarified.plan.issues.some(i=>i.code==='PIECE_NOT_PRESENT'))
   assert.equal(clarified.plan.changes.filter(c=>c.op==='add_piece').length,1)
   assert.equal(clarified.plan.changes.filter(c=>c.op==='add_service').length,5)
   assert.equal(clarified.transcription,'Na caixa de ar pode colocar funilaria P, montagem M e pintura completa.')
   await panel.locator('.voice-entry.pending .voice-options').waitFor({state:'hidden'})
   const prerequisite=panel.locator('.voice-entry.add').filter({has:page.locator('.voice-entry-label').filter({hasText:/^Peça$/})})
   assert.equal(await prerequisite.count(),1,'Ambos must visibly propose only the absent physical piece')
   await prerequisite.scrollIntoViewIfNeeded()
   await panel.screenshot({path:artifacts+'/both-review-'+width+'.png'})
   const applied=page.waitForResponse(r=>r.url().endsWith('/copiloto/aplicar')&&r.status()===200)
   await panel.locator('.voice-apply').click();await applied;await panel.waitFor({state:'hidden'})
   assert.equal(f.commercial.list(f.at.id).length,3)
   assert.equal(f.commercial.list(f.at.id).find(p=>p.id===savedPassenger.id).services[0].id,savedPassenger.services[0].id)
   for(const item of f.commercial.list(f.at.id).filter(p=>pair.some(c=>c.id===p.pieceId)))assert.equal(item.services.length,3)
   assert.equal(f.commercial.list(f.at.id).find(p=>p.id===f.item.id).notes,'Ditado original preservado')
   assert.match(await page.getByRole('textbox',{name:'Valor em reais',exact:true}).inputValue(),/123,45/)
   mode='unknown';await record(page)
   assert.equal(await panel.locator('.voice-options button').count(),1,'no guesses when no real alternatives; Falar only')
   assert.match(await panel.locator('.voice-apply').innerText(),/Aplicar assim mesmo/)
   await panel.screenshot({path:artifacts+'/no-options-'+width+'.png'})
   const partial=page.waitForResponse(r=>r.url().endsWith('/copiloto/aplicar')&&r.status()===200)
   await panel.locator('.voice-apply').click();await partial;await panel.waitFor({state:'hidden'})
   assert.equal(f.commercial.list(f.at.id).length,3);assert.equal(f.commercial.list(f.at.id).find(p=>p.id===f.item.id).notes,'Somente alteração segura')
   mode='many';await record(page)
   assert.equal(await panel.locator('.voice-options button').filter({hasText:/^Funilaria/}).count(),3,'at most three direct alternatives')
   await panel.getByRole('button',{name:'Mais opções',exact:true}).click()
   assert.equal(await panel.locator('.voice-options button').filter({hasText:/^Funilaria/}).count(),4)
   assert.equal(await panel.getByRole('button',{name:'Funilaria inativa QA',exact:true}).count(),0)
   const serviceResponse=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver')&&r.status()===200)
   await panel.getByRole('button',{name:'Funilaria QA',exact:true}).click();await serviceResponse
   const dimension=panel.getByRole('button',{name:'P',exact:true});await dimension.waitFor()
   const dimensionResponse=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver')&&r.status()===200)
   await dimension.click();const final=await (await dimensionResponse).json()
   assert.equal(final.plan.changes.filter(c=>c.op==='add_service').length,1)
   assert.equal(f.commercial.list(f.at.id).find(p=>p.id===f.item.id).services.length,1,'service/dimension selection is still read-only')
   assert.deepEqual(errors,[])
   console.log('PASS '+width+': sides, one question, readonly replan, keyboard, safe Falar, original intent, both, R$ 123,45 and apply anyway')
  }catch(error){if(page){console.log('VISIBLE',await page.locator('body').innerText());await page.screenshot({path:artifacts+'/failure-'+width+'.png'})}throw error}
  finally{await context.close();app.closeAllConnections();await new Promise(r=>app.close(r));db.close()}
 }
}finally{await browser?.close();vite.kill('SIGTERM');audio.dispose()}
