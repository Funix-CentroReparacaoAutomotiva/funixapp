// Real browser + HTTP + SQLite + synthetic providers, with no external service calls.
import assert from 'node:assert/strict'
import {existsSync,mkdirSync,writeFileSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {analysisDemo,analysisDemoFlags} from './gmail-analysis-demo.ts'
import {analysisRecord} from '../server/tests/fixtures/gmail-analysis.ts'
const origin='http://127.0.0.1:5173',password='synthetic-mvp01-password-0123'
const artifacts='.runtime/gmail-analysis-browser';mkdirSync(artifacts,{recursive:true})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
let browser;const results=[]
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out')}
try{
 await until(async()=>{try{return(await fetch(origin)).ok}catch{return false}})
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),headless:true,args:['--no-sandbox']})
 for(const width of [320,390,1440]){
  analysisDemoFlags();const demo=analysisDemo()
  const {createApp}=await import('../server/app.ts')
  const app=createApp({atendimentos:demo.atendimentos,gmailAnalysis:demo.service,origin,password,voiceProvider:null})
  await new Promise(r=>app.listen(8787,'127.0.0.1',r))
  const context=await browser.newContext({viewport:{width,height:900}})
  try{
   const auth=await context.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}});assert.equal(auth.status(),200)
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept())
   await page.goto(origin+'/atualizacoes')
   await page.getByRole('button',{name:/Autorização sintética de reparo/}).click()
   await page.getByRole('button',{name:'Autorizar análise',exact:true}).click()
   await until(()=>demo.service.get(demo.notice.id)?.state==='ready')
   await page.getByRole('heading',{name:'Proposta pronta para revisão'}).waitFor()
   assert.equal(await page.locator('.gmail-intake-card').count(),1);assert.equal(await page.locator('.updates-card').count(),0)
   await page.getByText('Evidências e informações extraídas',{exact:true}).click()
   await page.getByText('Anexos (1)',{exact:true}).click()
   await page.getByText('Não identificado',{exact:false}).first().waitFor()
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)
   assert.equal(overflow,false,'horizontal overflow '+width)
   await page.locator('.app-viewport').evaluate(el=>{el.scrollTop=el.scrollHeight})
   const clearControls=await page.getByRole('button',{name:'Aprovar proposta',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})
   assert.equal(clearControls,true,'approval obscured '+width)
   await page.screenshot({path:`${artifacts}/review-${width}.png`,fullPage:true})
   await page.getByRole('button',{name:'Aprovar proposta',exact:true}).click()
   await page.getByRole('button',{name:'Todos',exact:true}).click()
   await page.getByRole('button',{name:/Proposta aprovada · sem execução/}).click()
   await page.getByText(/Decisão persistida em/).waitFor()
   assert.equal(demo.service.get(demo.notice.id).proposal.status,'approved_pending_execution')
   assert.deepEqual(demo.fixture.records,[analysisRecord()])
   await page.reload();await page.getByRole('button',{name:'Todos',exact:true}).click()
   await page.getByRole('button',{name:/Proposta aprovada · sem execução/}).waitFor()
   // A second synthetic message exercises ambiguity, revision and a failed context lookup.
   const second=structuredClone(demo.fixture.messages[0]);second.message.messageId='b'.repeat(16)
   demo.fixture.messages.push(second);demo.fixture.records.push(analysisRecord({rowId:'i-caseB',experienceId:'XP2345'}))
   const n=demo.notices.ingest({messageId:second.message.messageId,title:'Caso sintético ambíguo',summary:'Autorização para conferir dois candidatos.',relevance:'relevant',reason:'REPAIR_AUTHORIZATION',plateHint:null,xpHint:null})
   const lookup=demo.providers.lookup;demo.providers.lookup=async()=>{throw Error('synthetic unavailable')}
   await page.getByRole('button',{name:'Atualizar',exact:true}).click()
   await page.getByRole('button',{name:/Caso sintético ambíguo/}).click()
   await page.getByRole('button',{name:'Autorizar análise',exact:true}).click()
   await until(()=>demo.service.get(n.id)?.state==='failed')
   await page.getByRole('heading',{name:'Falha recuperável'}).waitFor()
   demo.providers.lookup=lookup
   await page.getByRole('button',{name:'Retomar análise',exact:true}).click()
   await page.getByText('Múltiplos candidatos: vínculo exige escolha humana',{exact:true}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Aprovar proposta',exact:true}).isDisabled(),true)
   await page.locator('.gmail-analysis select').selectOption('i-caseB')
   await page.getByRole('button',{name:'Enviar para conferência',exact:true}).click()
   await until(()=>demo.service.get(n.id)?.generation===2&&demo.service.get(n.id)?.state==='ready')
   await page.getByRole('heading',{name:'Proposta pronta para revisão'}).waitFor()
   await page.getByRole('button',{name:'Rejeitar proposta',exact:true}).click()
   await page.getByRole('heading',{name:'Proposta rejeitada'}).waitFor()
   assert.equal(demo.service.get(n.id).proposal.status,'rejected')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
   await page.screenshot({path:`${artifacts}/decision-${width}.png`,fullPage:true})
   assert.deepEqual(errors,[]);results.push({width,happyPath:'passed',recovery:'passed',ambiguityRevision:'passed',decisionReload:'passed',horizontalOverflow:false,pageErrors:errors})
  }catch(error){const pages=context.pages();if(pages[0]){await pages[0].screenshot({path:`${artifacts}/failure-${width}.png`,fullPage:true});writeFileSync(`${artifacts}/failure-${width}.txt`,await pages[0].locator('body').innerText())}throw error}finally{await demo.service.stop();await context.close();await new Promise(r=>app.close(r));demo.db.close()}
 }
 writeFileSync(`${artifacts}/results.json`,JSON.stringify({synthetic:true,browser:await browser.version(),results},null,2));console.log(JSON.stringify(results))
}finally{await browser?.close();vite.kill('SIGTERM')}
