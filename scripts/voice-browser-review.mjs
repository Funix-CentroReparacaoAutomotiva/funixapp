import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {openDatabase} from '../server/database.ts'
import {createApp} from '../server/app.ts'
import {commercialFixture} from '../server/tests/fixtures/commercial.ts'

const origin='http://127.0.0.1:5173'
const password='synthetic-browser-voice-password'
const db=openDatabase(':memory:'),f=commercialFixture(db)
let mode='quantity'
const ref=id=>({state:'resolved',id})
const line=f.item.services[0]
const provider={
 transcribe:async()=>mode==='remove'?'Exclua a peça do atendimento.':'Acrescente uma unidade no serviço.',
 interpret:async()=>({commands:mode==='remove'
  ?[{id:'delete',op:'remove_piece',intent:'instruction',piece:ref(f.item.pieceId)}]
  :[{id:'add-one',op:'set_quantity',intent:'instruction',piece:ref(f.item.pieceId),line:{kind:'id',id:line.id},mode:'increment',value:'1'}]})
}
const api=createApp({atendimentos:f.atendimentos,origin,password,voiceProvider:provider})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173'],{stdio:'pipe'})
let browser
const wait=async(url)=>{
 for(let i=0;i<80;i++){
  try{if((await fetch(url)).ok)return}catch{}
  await new Promise(r=>setTimeout(r,200))
 }
 throw Error('Local Vite did not start')
}
const screenshotDir='artifacts/voice-review'
mkdirSync(screenshotDir,{recursive:true})
async function record(page){
 const launcher=page.locator('button[aria-label="Abrir Copiloto FUNIX"]')
 await launcher.waitFor({state:'visible'})
 const box=await launcher.boundingBox()
 assert(box,'voice launcher has geometry')
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
 await page.mouse.down()
 await page.waitForTimeout(700)
 await page.mouse.up()
 await page.getByText('Revisão antes de salvar',{exact:false}).waitFor({timeout:20000})
}
try{
 await new Promise((resolve,reject)=>api.listen(8787,'127.0.0.1',error=>error?reject(error):resolve()))
 await wait(origin)
 const chrome=process.env.CHROME_PATH??(existsSync('/usr/bin/google-chrome')?'/usr/bin/google-chrome':existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)
 if(!chrome)throw Error('No Chrome installed on CI runner')
 browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})
 for(const [width,height] of [[1440,900],[320,700],[390,844]]){
  const context=await browser.newContext({viewport:{width,height},permissions:['microphone']})
  const auth=await context.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
  assert.equal(auth.status(),200,'synthetic browser login')
  const page=await context.newPage()
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos')
  await page.locator('.commercial-workspace').waitFor({timeout:20000})
  await page.waitForTimeout(450)
  await record(page)
  const panel=page.locator('.voice-panel')
  const review=panel.locator('.voice-review')
  assert.match(await review.innerText(),/quantidade: 4/)
  const button=panel.locator('.voice-apply')
  assert(await button.isEnabled())
  const measures=await panel.evaluate(element=>({
   scroll:element.scrollWidth,client:element.clientWidth,
   action:Array.from(element.querySelectorAll('button.voice-apply')).map(b=>b.getBoundingClientRect().height)
  }))
  assert(measures.scroll<=measures.client+2,'panel must not overflow horizontally')
  assert(measures.action[0]>=44,'apply target must be touch friendly')
  await panel.screenshot({path:screenshotDir+'/review-'+width+'.png'})
  assert.deepEqual(errors,[],'no browser runtime exceptions')
  if(width===390){
   await button.click()
   await page.getByText('Plano de voz aplicado ao Atendimento.').waitFor({timeout:15000})
   assert.equal(f.commercial.list(f.at.id,f.scenario.id)[0].services[0].quantity,'4')
   await page.waitForTimeout(350)
   mode='remove'
   await record(page)
   assert.match(await panel.locator('.voice-review').innerText(),/EXCLUIR peça/)
   await panel.screenshot({path:screenshotDir+'/global-removal-390.png'})
   page.once('dialog',dialog=>dialog.dismiss())
   await panel.locator('.voice-apply').click()
   assert.equal(f.commercial.list(f.at.id,f.scenario.id).length,1,'cancel must preserve piece')
   page.once('dialog',dialog=>dialog.accept())
   await panel.locator('.voice-apply').click()
   await page.getByText('Plano de voz aplicado ao Atendimento.').waitFor({timeout:15000})
   assert.equal(f.commercial.list(f.at.id,f.scenario.id).length,0,'confirmed global removal')
   mode='quantity'
  }
  await context.close()
  if(width===390)break // destructive confirmation is the final synthetic scenario
 }
 // Desktop geometry is checked separately in its own synthetic session after removal,
 // using the empty state; no mutable fixture is resurrected to simulate production.
 const desktop=await browser.newContext({viewport:{width:1440,height:900}})
 const auth=await desktop.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
 assert.equal(auth.status(),200)
 const page=await desktop.newPage()
 await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos')
 await page.locator('.commercial-workspace').waitFor({timeout:20000})
 const shell=await page.locator('.app-shell').boundingBox()
 assert(shell&&shell.width<=522,'desktop application maintains bounded shell')
 await page.screenshot({path:screenshotDir+'/desktop-shell-1440.png'})
 await desktop.close()
 console.log('Voice browser review: 320/390 visual, confirmation/cancel/global removal and 1440 desktop shell passed.')
}finally{
 await browser?.close().catch(()=>{})
 vite.kill('SIGTERM')
 api.closeAllConnections()
 await new Promise(resolve=>api.close(()=>resolve()))
 db.close()
}
