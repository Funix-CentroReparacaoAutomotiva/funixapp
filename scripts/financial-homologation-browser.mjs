// Synthetic end-to-end regression for homologation #158/#177. No real customers or emitted documents.
import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {openDatabase} from '../server/database.ts'
import {fase4Fixture} from '../server/tests/fixtures/fase4.ts'
import {BudgetRepository} from '../server/budgets.ts'
import {createApp} from '../server/app.ts'

const origin='http://127.0.0.1:5173',password='synthetic-commercial-homologation'
const artifacts='artifacts/financial-homologation'
mkdirSync(artifacts,{recursive:true})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
let browser
async function ready(){for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Vite unavailable')}
try{
 await ready()
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox']})
 for(const [width,height] of [[390,844],[1440,900]]){
  const db=openDatabase(':memory:'),f=fase4Fixture(db),third=f.entries[5],ordinary=f.entries[1],paint=f.entries[2]
  let item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[
   {serviceId:third.serviceId,dimensionId:third.dimensionId,quantity:'1'},
   {serviceId:ordinary.serviceId,dimensionId:ordinary.dimensionId,quantity:'1'},
   {serviceId:paint.serviceId,dimensionId:paint.dimensionId,quantity:'1'}
  ]})
  const thirdLine=item.services.find(s=>s.serviceId===third.serviceId)
  const paintLine=item.services.find(s=>s.serviceId===paint.serviceId)
  assert(thirdLine&&paintLine)
  let scenario=f.scenarios.list(f.at.id)[0]
  scenario=f.scenarios.update(f.at.id,scenario.id,{revision:scenario.revision,serviceFlags:{
   ...Object.fromEntries(item.services.map(s=>[s.id,true])),[paintLine.id]:false
  }})
  const budget=new BudgetRepository(db),request={scenarioId:scenario.id,negotiation:{mode:'none'}}
  const noPaint=budget.preview(f.at.id,request)
  assert.equal(noPaint.snapshot.calculation.lines.find(l=>l.id===thirdLine.id)?.executionConfirmed,true)
  assert(!noPaint.snapshot.calculation.errors.some(s=>/confirma|contrata|terceir/i.test(s)))
  assert.equal(noPaint.snapshot.executionDeadline?.effectiveDays,Number(noPaint.snapshot.calculation.days))
  assert(noPaint.snapshot.executionDeadline.effectiveDays<5,'fixture must make no-paint regression visible')
  const app=createApp({atendimentos:f.atendimentos,origin,password,voiceProvider:null})
  await new Promise(resolve=>app.listen(8787,'127.0.0.1',resolve))
  const ctx=await browser.newContext({viewport:{width,height}});let page
  try{
   assert.equal((await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})).status(),200)
   page=await ctx.newPage()
   const errors=[];page.on('pageerror',e=>errors.push(e.message))
   await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos')
   await page.locator('.diagnosis-open').first().click()
   const editor=page.locator('.approved-editor');await editor.waitFor()
   assert.equal(await editor.getByRole('checkbox',{name:/Execução e contratação confirmadas/}).count(),0)
   assert.equal(await editor.locator('.third-confirmation').count(),0)
   assert.match(await editor.innerText(),/Terceirização selecionada neste cenário/)
   await page.getByRole('button',{name:'Voltar aos Diagnósticos'}).click()
   const panel=page.locator('.approved-finance')
   await panel.locator('.summary').click()
   const deadline=page.locator('.execution-deadline')
   await deadline.waitFor()
   await page.waitForFunction(()=>document.querySelector('.deadline-source')?.textContent?.includes('Pintura habilitada: não'))
   assert.match(await deadline.locator('.deadline-source').innerText(),/Origem: Cálculo técnico/)
   assert.match(await deadline.innerText(),new RegExp('Prazo técnico: '+noPaint.snapshot.calculation.days))
   assert.match(await deadline.innerText(),new RegExp(noPaint.snapshot.executionDeadline.effectiveDays+' dias úteis'))
   assert.deepEqual(errors,[])
   // Activate only the paint line, refresh the same scenario and verify the floor.
   const current=f.scenarios.list(f.at.id)[0]
   f.scenarios.update(f.at.id,current.id,{revision:current.revision,serviceFlags:{[paintLine.id]:true}})
   const painted=budget.preview(f.at.id,request)
   assert.equal(painted.snapshot.executionDeadline?.effectiveDays,5)
   await page.reload()
   await panel.locator('.summary').click()
   await page.waitForFunction(()=>document.querySelector('.deadline-source')?.textContent?.includes('Pintura habilitada: sim'))
   assert.match(await deadline.locator('.deadline-source').innerText(),/Piso de 5 dias úteis por Pintura/)
   assert.deepEqual(errors,[])
   await page.screenshot({path:artifacts+'/homologation-'+width+'.png',fullPage:true})
   console.log('PASS commercial homologation viewport '+width+': third-party no extra confirmation; technical deadline without paint; floor with paint')
  }catch(error){if(page)await page.screenshot({path:artifacts+'/failure-'+width+'.png',fullPage:true});throw error}
  finally{await ctx.close();app.closeAllConnections();await new Promise(resolve=>app.close(resolve));db.close()}
 }
}finally{await browser?.close();vite.kill('SIGTERM')}
