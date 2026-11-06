import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {createVoiceBrowserAudio,recordVoice,clarifyVoice,recordNewDictation} from './browser/voice-audio.mjs'
import {openDatabase} from '../server/database.ts'
import {commercialFixture} from '../server/tests/fixtures/commercial.ts'
import {createApp} from '../server/app.ts'
const origin='http://127.0.0.1:5173',password='synthetic-issue58-browser',artifacts=process.env.FUNIX_VOICE_ARTIFACTS??'artifacts/voice-clarification'
mkdirSync(artifacts,{recursive:true})
const ref=id=>({state:'resolved',id}),unknown=text=>({state:'unresolved',text,candidates:[]})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
const audio=createVoiceBrowserAudio();let browser
async function ready(){for(let i=0;i<80;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Vite not ready')}
try{
 await ready();browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox',...audio.args]})
 for(const [width,height]of [[320,740],[390,844],[1440,900]]){
  const db=openDatabase(':memory:'),f=commercialFixture(db)
  const service=f.commercial.saveCatalog({kind:'servico',name:'Funilaria'}),p=f.commercial.saveCatalog({kind:'dimensao',name:'P',serviceId:service.id}),m=f.commercial.saveCatalog({kind:'dimensao',name:'M',serviceId:service.id})
  const paint=f.commercial.saveCatalog({kind:'servico',name:'Pintura'}),complete=f.commercial.saveCatalog({kind:'dimensao',name:'Completa',serviceId:paint.id})
  const physical=f.commercial.catalogs().items.find(p=>p.code==='para_lama_dianteiro__passageiro'),piece=f.commercial.add(f.at.id,{pieceCodes:[physical.code]}).find(p=>p.pieceId===physical.id)
  const before=f.commercial.updateDiagnosis(f.at.id,piece.id,{revision:piece.revision,services:[{serviceId:service.id,dimensionId:p.id,quantity:'3',notes:'NOTA_PRIVADA_SINTETICA'}]})
  const side=f.commercial.catalogs().items.find(p=>p.code==='caixa_de_ar__passageiro'),sidePiece=f.commercial.add(f.at.id,{pieceCodes:[side.code]}).find(p=>p.pieceId===side.id)
  f.commercial.updateDiagnosis(f.at.id,sidePiece.id,{revision:sidePiece.revision,services:[{serviceId:service.id,dimensionId:m.id,quantity:'4'}]})
  let mode='body',speech='Funilaria P',calls=0
  const transcript='Para-lama dianteiro, funilaria P e pintura completa. PII_QA 11999999999 ABC1D23 token=segredo'
  const provider={transcribe:async(bytes,mime)=>{audio.observeUpload(bytes,mime);return mode==='speech'?speech:transcript},interpret:async()=>{
   calls++
   if(mode==='blocked')return {commands:[{id:'blocked',op:'set_notes',intent:'instruction',piece:ref('catalogo-inexistente'),line:null,value:'NOTA_PRIVADA_SINTETICA'}]}
   if(mode==='unsupported')return {commands:[{id:'unsupported',op:'set_diagnosis',intent:'instruction',piece:ref(physical.id),setDiagnosis:true,diagnosis:null,setIntensity:true,intensity:null,additionalDamage:true}]}
   const isSide=mode==='side'
   return {commands:[
    {id:'body',op:'add_service',intent:'instruction',piece:unknown(isSide?'Caixa de ar':'Para-lama dianteiro'),service:ref(service.id),dimension:ref(isSide?p.id:m.id),preserveDimension:false,quantity:null},
    {id:'paint',op:'add_service',intent:'instruction',piece:unknown(isSide?'Caixa de ar':'Para-lama dianteiro'),service:ref(paint.id),dimension:ref(complete.id),preserveDimension:false,quantity:null}
   ]}
  }}
  const app=createApp({atendimentos:f.atendimentos,origin,password,voiceProvider:provider});await new Promise(r=>app.listen(8787,'127.0.0.1',r))
  const ctx=await browser.newContext({viewport:{width,height},permissions:['microphone','clipboard-read','clipboard-write']});await audio.install(ctx)
  let page
  try{
   await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
   page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
   await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos');await page.locator('.commercial-workspace').waitFor()
   const panel=page.locator('.voice-panel')
   await recordVoice(page,audio)
   const selectedResponse=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver'))
   await panel.getByRole('button',{name:'Passageiro',exact:true}).click();const selected=await (await selectedResponse).json()
   assert.equal(selected.outcome.pending,0);assert(selected.plan.changes.some(c=>c.op==='update_service'&&c.patch.dimensionId===m.id))
   await panel.locator('.voice-entry.change').filter({hasText:'Funilaria'}).waitFor()
   assert.match(await panel.innerText(),/P.*→.*M/s);assert(await panel.locator('.voice-apply').isEnabled())
   assert.equal(f.commercial.list(f.at.id).find(p=>p.id===before.id).services[0].dimensionId,p.id,'replan is read-only')
   await panel.getByRole('button',{name:'Mostrar transcrição'}).click()
   const diagnostic=panel.locator('.voice-diagnostic');assert.match(await diagnostic.innerText(),/PII_QA/)
   assert.match(await diagnostic.innerText(),/IA interpretou.*Funilaria.*M/);assert.match(await diagnostic.innerText(),/Já cadastrado.*Funilaria.*P/)
   await panel.getByRole('button',{name:'Copiar diagnóstico',exact:true}).focus();await page.keyboard.press('Enter');await panel.getByText('Diagnóstico copiado sem transcrição ou dados pessoais.',{exact:true}).waitFor()
   let copied=await page.evaluate(()=>navigator.clipboard.readText());for(const secret of ['PII_QA','11999999999','ABC1D23','segredo','NOTA_PRIVADA',f.at.id])assert(!copied.includes(secret),secret)
   assert(copied.indexOf('Captura iniciada')<copied.indexOf('IA interpretou'));assert(copied.indexOf('IA interpretou')<copied.indexOf('Opção escolhida: Passageiro'))
   await panel.locator('.copilot-feed').evaluate(el=>{el.scrollTop=0})
   await panel.screenshot({path:artifacts+'/diagnostic-'+width+'.png'})
   await panel.getByRole('button',{name:'Mostrar transcrição'}).click()
   mode='speech';speech='Funilaria P exclua a peça';await clarifyVoice(page,audio,422)
   await panel.getByRole('alert').filter({hasText:'Não foi possível identificar'}).waitFor()
   speech='corrige funilaria para P';await clarifyVoice(page,audio)
   assert.equal(calls,1);await panel.locator('.voice-entry.noop').waitFor()
   assert.match(await panel.innerText(),/Já está assim/)
   await panel.screenshot({path:artifacts+'/corrected-'+width+'.png'})
   const applied=page.waitForResponse(r=>r.url().endsWith('/copiloto/aplicar')&&r.status()===200)
   await panel.locator('.voice-apply').click();await applied;await panel.waitFor({state:'hidden'})
   const saved=f.commercial.list(f.at.id).find(p=>p.id===before.id);assert.equal(saved.services.length,2);assert.equal(saved.services[0].id,before.services[0].id);assert.equal(saved.services[0].quantity,'3');assert.equal(saved.services[0].dimensionId,p.id)
   // Successful Apply remains available in the ephemeral panel when reopened.
   await page.getByRole('button',{name:'Abrir Copiloto FUNIX',exact:true}).click();await panel.waitFor()
   await panel.getByRole('button',{name:'Mostrar transcrição'}).click();assert.match(await diagnostic.innerText(),/Apply confirmado pelo servidor/)
   await panel.getByRole('button',{name:'Copiar diagnóstico',exact:true}).click();copied=await page.evaluate(()=>navigator.clipboard.readText());assert.match(copied,/VOICE_CLARIFICATION_PENDING.*422/)
   assert(!copied.includes('PII_QA'));assert(!copied.includes('NOTA_PRIVADA'))
   mode='side';await recordVoice(page,audio)
   const bothResponse=page.waitForResponse(r=>r.url().endsWith('/copiloto/resolver'));await panel.getByRole('button',{name:'Ambos',exact:true}).click();const both=await (await bothResponse).json()
   assert.equal(both.plan.changes.filter(c=>c.op==='add_piece').length,1);assert.equal(both.plan.changes.filter(c=>c.op==='update_service').length,1)
   assert.match(await panel.innerText(),/M.*→.*P/s)
   const sideApply=page.waitForResponse(r=>r.url().endsWith('/copiloto/aplicar')&&r.status()===200);await panel.locator('.voice-apply').click();await sideApply;await panel.waitFor({state:'hidden'})
   mode='unsupported';await recordVoice(page,audio)
   assert.equal(await panel.getByRole('button',{name:'Falar',exact:true}).count(),0,'no question means no inert Falar')
   assert.match(await panel.innerText(),/Nenhuma alteração segura/);assert(await panel.locator('.voice-apply').isDisabled())
   await panel.screenshot({path:artifacts+'/no-safe-changes-'+width+'.png'})
   // Novo ditado really opens a fresh recorder; do not fake the follow-up request.
   mode='body';await recordNewDictation(page,audio)
   await panel.locator('.voice-entry').first().waitFor()
   assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.deepEqual(errors,[])
   console.log('PASS Issue58 '+width+': existing line correction, directed speech, read-only replan, sanitized clipboard, Apply, Ambos and working new dictation')
  }catch(error){if(page){console.log('VISIBLE',await page.locator('body').innerText());await page.screenshot({path:artifacts+'/failure-'+width+'.png'})}throw error}
  finally{await ctx.close();app.closeAllConnections();await new Promise(r=>app.close(r));db.close()}
 }
}finally{await browser?.close();vite.kill('SIGTERM');audio.dispose()}
