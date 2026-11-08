// Synthetic Chromium QA: opt-in quote in the persisted Diagnosis editor.
// Never contacts OpenAI or production. Uses a disposable in-memory SQLite.
import assert from'node:assert/strict'
import{existsSync,mkdirSync}from'node:fs'
import{spawn}from'node:child_process'
import{chromium}from'playwright'
import{openDatabase}from'../server/database.ts'
import{commercialFixture}from'../server/tests/fixtures/commercial.ts'
import{ComponentRepository}from'../server/components.ts'
import{createQuoteService}from'../server/component-quote-service.ts'
import{validateQuoteResponse}from'../server/component-quote-provider.ts'
import{quoteFixtureQuery,quoteFixtureResponse}from'../server/tests/fixtures/component-quote.ts'
import{createApp}from'../server/app.ts'

const origin='http://127.0.0.1:5173'
const password='synthetic-diagnosis-quote-password'
const dir='artifacts/diagnosis-quote'
mkdirSync(dir,{recursive:true})
process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED='true'
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
let browser
async function ready(){for(let n=0;n<80;n++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Vite failed to start')}
try{
 await ready()
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox']})
 for(const [width,height]of [[320,740],[390,844],[1440,900]]){
  const db=openDatabase(':memory:'),f=commercialFixture(db),components=new ComponentRepository(db)
  const vehicle=f.atendimentos.get(f.at.id)
  f.atendimentos.update(vehicle.id,{revision:vehicle.revision,brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019'})
  const catalog=f.commercial.catalogs().items.find(x=>x.code==='para_choque_dianteiro')
  const piece=f.commercial.add(f.at.id,{pieceCodes:[catalog.code]})[0]
  const saved=components.save(f.at.id,{pieceId:piece.id,name:'farol dianteiro esquerdo',quantity:'2',manualPrice:'10',notes:'',scenarioId:f.scenario.id,scenarioRevision:f.scenarios.list(f.at.id)[0].revision})
  let searches=0
  const quotePilot=createQuoteService({search:async query=>{
   searches++
   assert.deepEqual(query,quoteFixtureQuery)
   return validateQuoteResponse(quoteFixtureResponse(),query)
  }})
  const app=createApp({atendimentos:f.atendimentos,origin,password,quotePilot,voiceProvider:null})
  await new Promise(resolve=>app.listen(8787,'127.0.0.1',resolve))
  const ctx=await browser.newContext({viewport:{width,height}});let page
  try{
   const login=await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
   assert.equal(login.status(),200)
   page=await ctx.newPage();const errors=[]
   page.on('pageerror',e=>errors.push(e.message))
   await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos')
   await page.locator('.diagnosis-open').first().click()
   const editor=page.locator('.approved-editor')
   await editor.waitFor()
   const component=editor.locator('[data-component-id="'+saved.id+'"]')
   await component.waitFor()
   await page.waitForFunction(()=>document.querySelector('.approved-editor')?.getAttribute('data-save-state')==='confirmed')
   const button=component.getByRole('button',{name:'Pesquisar preço do componente'})
   await button.waitFor({state:'visible'})
   assert(await button.isEnabled())
   assert.equal(searches,0,'must not search on page load')
   assert.equal(await component.getByRole('textbox',{name:'Preço unitário do componente'}).inputValue(),'10,00')
   const mr=await component.getByRole('note',{name:'MR do componente'}).boundingBox()
   const b=await button.boundingBox()
   assert(mr&&b&&b.x>mr.x,'button must follow MR')
   await button.click()
   await component.locator('.diagnosis-quote-option').last().getByRole('button',{name:/R\$ 39,90/}).waitFor()
   assert.equal(searches,1)
   assert.equal(await component.locator('.diagnosis-quote-option').count(),3)
   assert.equal(await component.locator('.diagnosis-quote-option button:disabled').count(),2)
   assert.equal(components.list(f.at.id).find(x=>x.id===saved.id).manualPrice,'10','search must be read-only')
   await component.locator('.diagnosis-quote-option button:not(:disabled)').click()
   await page.waitForFunction(id=>{
    const editor=document.querySelector('.approved-editor')
    const input=editor?.querySelector('[data-component-id="'+id+'"] input[aria-label="Preço unitário do componente"]')
    return editor?.getAttribute('data-save-state')==='confirmed'&&input?.value==='39,90'
   },saved.id)
   // Debounced autosave is independent from quotation; wait for confirmed data.
   for(let i=0;i<35&&components.list(f.at.id).find(x=>x.id===saved.id).manualPrice!=='39.9';i++)await new Promise(r=>setTimeout(r,100))
   assert.equal(components.list(f.at.id).find(x=>x.id===saved.id).manualPrice,'39.9')
   assert.equal(components.list(f.at.id).find(x=>x.id===saved.id).quantity,'2')
   assert.equal(searches,1,'selection must not run another search')
   const noOverflow=await component.evaluate(el=>el.scrollWidth<=el.clientWidth+2)
   assert(noOverflow,'component must not overflow viewport '+width)
   assert.deepEqual(errors,[])
   await component.screenshot({path:dir+'/component-'+width+'.png'})
   console.log('PASS diagnosis quote '+width+' : after MR, three choices, one explicit apply, autosave and no overflow')
  }catch(error){
   if(page)await page.screenshot({path:dir+'/failure-'+width+'.png'})
   throw error
  }finally{
   await ctx.close();app.closeAllConnections();await new Promise(r=>app.close(r));db.close()
  }
 }
}finally{await browser?.close();vite.kill('SIGTERM')}
