// Synthetic Chromium QA for three free search links; no paid or external search requests.
import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {openDatabase} from '../server/database.ts'
import {commercialFixture} from '../server/tests/fixtures/commercial.ts'
import {ComponentRepository} from '../server/components.ts'
import {money} from '../shared/format.ts'
import {createApp} from '../server/app.ts'

const origin='http://127.0.0.1:5173'
const password='synthetic-diagnosis-links-password'
const dir='artifacts/diagnosis-quote'
mkdirSync(dir,{recursive:true})
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
  const piece=f.commercial.add(f.at.id,{pieceCodes:[catalog.code]}).find(item=>item.pieceId===catalog.id)
  assert(piece)
  const saved=components.save(f.at.id,{pieceId:piece.id,name:'farol dianteiro esquerdo',quantity:'2',manualPrice:'10',notes:'',scenarioId:f.scenario.id,scenarioRevision:f.scenarios.list(f.at.id)[0].revision})
  const app=createApp({atendimentos:f.atendimentos,origin,password,voiceProvider:null})
  await new Promise(resolve=>app.listen(8787,'127.0.0.1',resolve))
  const ctx=await browser.newContext({viewport:{width,height}});let page
  try{
   const login=await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
   assert.equal(login.status(),200)
   page=await ctx.newPage();const errors=[],quoteCalls=[]
   page.on('pageerror',e=>errors.push(e.message))
   page.on('request',r=>{if(r.url().includes('/cotar')||r.url().includes('api.openai.com'))quoteCalls.push(r.url())})
   await page.goto(origin+'/atendimentos/'+f.at.id+'?aba=diagnosticos')
   await page.locator('.diagnosis-open').filter({hasText:catalog.name}).click()
   const editor=page.locator('.approved-editor');await editor.waitFor()
   const component=editor.locator('[data-component-id="'+saved.id+'"]');await component.waitFor()
   const serviceHeading=editor.locator('.piece-summary-bar').first(),componentHeading=editor.locator('.piece-summary-bar').nth(1)
   assert.match(await serviceHeading.innerText(),/Serviços\s+0\/0/)
   assert.match(await componentHeading.innerText(),/Componentes\s+[01]\/1/)
   await page.waitForFunction(()=>document.querySelector('.approved-editor')?.getAttribute('data-save-state')==='confirmed')
   const toggle=component.getByRole('button',{name:'Habilitar componente neste cenário'})
   if((await toggle.getAttribute('aria-pressed'))==='false'){
     await toggle.click()
     await page.waitForFunction(()=>document.querySelector('.approved-editor')?.getAttribute('data-save-state')==='confirmed')
   }
   // The values must come from the backend. The fixture has MR 2 and two units priced 10.
   const totals=await (await ctx.request.get(origin+'/api/atendimentos/'+f.at.id+'/cenarios?scenarioId='+f.scenario.id)).json()
   const official=totals.pieceCategoryTotals[f.scenario.id][piece.id]
   assert.equal(official.serviceTotal,'0')
   assert.equal(official.componentTotal,'40')
   await page.waitForFunction(expected=>document.querySelector('.piece-summary-bar.component-title .piece-category-amount')?.textContent===expected,money(official.componentTotal))
   assert.match(await componentHeading.innerText(),/Componentes\s+1\/1/)
   assert((await serviceHeading.innerText()).includes('R$ 0,00'))
   assert((await componentHeading.innerText()).includes(money(official.componentTotal)))
   assert(await serviceHeading.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'service header overflow at '+width)
   assert(await componentHeading.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'component header overflow at '+width)
   // #168: nome da peça vira um seletor direto, inclusive mobile, sem modal ou confirmação.
   const piecePicker=editor.getByRole('combobox',{name:'Peça',exact:true})
   assert.equal(await piecePicker.count(),1,'one inline piece selector at '+width)
   // #215: menus nativos podem abrir sobre fundo branco; garantir texto escuro nas opções.
   const popupColors=await piecePicker.evaluate(el=>{
     const option=el.options[0],style=getComputedStyle(option)
     const rgb=value=>[...value.matchAll(/[\\d.]+/g)].map(m=>Number(m[0])).slice(0,3)
     return {foreground:rgb(style.color),background:rgb(style.backgroundColor),scheme:getComputedStyle(el).colorScheme}
   })
   const brightness=rgb=>rgb.reduce((acc,v)=>acc+v,0)/3
   assert(popupColors.foreground.length===3&&popupColors.background.length===3,'explicit native option colors at '+width)
   assert(brightness(popupColors.foreground)<110&&brightness(popupColors.background)>225,'dark options on light menu at '+width)
   assert(popupColors.scheme.includes('light'),'native light dropdown color-scheme at '+width)

   assert.equal(await editor.getByRole('button',{name:'Trocar peça'}).count(),0,'old extra button removed')
   assert.equal(await editor.getByRole('button',{name:'Confirmar revisão técnica'}).count(),0,'no review confirmation')
   const target=f.commercial.catalogs().items.find(x=>x.code==='para_choque_traseiro')
   assert(target)
   let unexpectedDialogs=0
   page.on('dialog',dialog=>{unexpectedDialogs++;void dialog.dismiss()})
   await piecePicker.selectOption(target.id)
   try{await page.waitForFunction(id=>document.querySelector('.piece-name-select select')?.value===id,target.id,{timeout:9000})}
   catch(e){console.error('Piece selector diagnostic',await editor.evaluate(el=>({state:el.getAttribute('data-save-state'),value:el.querySelector('.piece-name-select select')?.value,alerts:[...el.querySelectorAll('[role=alert]')].map(a=>a.textContent),feedback:el.textContent?.slice(0,900)})),{dbPiece:f.commercial.list(f.at.id).find(x=>x.id===piece.id)?.pieceId,target:target.id});throw e}
   try{await page.waitForFunction(()=>document.querySelector('.approved-editor')?.getAttribute('data-save-state')==='confirmed',null,{timeout:10000})}
   catch(e){console.error('Piece swap diagnostic',await editor.evaluate(el=>({state:el.getAttribute('data-save-state'),selected:el.querySelector('.piece-name-select select')?.value,alerts:[...el.querySelectorAll('[role=alert]')].map(a=>a.textContent),status:el.textContent?.slice(0,500)})),{dbPiece:f.commercial.list(f.at.id).find(x=>x.id===piece.id)?.pieceId,expected:target.id});throw e}
   assert.equal(f.commercial.list(f.at.id).find(x=>x.id===piece.id)?.pieceId,target.id)
   assert.equal(components.list(f.at.id).find(x=>x.id===saved.id)?.manualPrice,'10')
   assert.equal(components.list(f.at.id).find(x=>x.id===saved.id)?.pieceId,piece.id)
   assert.equal(await editor.locator('.piece-replacement-notice').count(),0)
   const selectedStyle=await piecePicker.evaluate(el=>({height:el.getBoundingClientRect().height,overflow:el.scrollWidth>el.clientWidth+2}))
   assert(selectedStyle.height>=44&&!selectedStyle.overflow,'compact piece picker at '+width)
   await piecePicker.selectOption(catalog.id)
   await page.waitForFunction(id=>document.querySelector('.piece-name-select select')?.value===id,catalog.id)
   await page.waitForFunction(()=>document.querySelector('.approved-editor')?.getAttribute('data-save-state')==='confirmed')
   assert.equal(f.commercial.list(f.at.id).find(x=>x.id===piece.id)?.pieceId,catalog.id)
   assert.equal(unexpectedDialogs,0,'piece change must never open a confirmation')
   // Category totals must also be visible before opening the piece editor.
   await page.getByRole('button',{name:'Voltar aos Diagnósticos'}).click()
   const overview=page.locator('.diagnosis-card').filter({hasText:catalog.name})
   await overview.waitFor()
   await page.waitForFunction(pieceName=>[...document.querySelectorAll('.diagnosis-card')].some(card=>card.textContent?.includes(pieceName)&&card.querySelector('.diagnosis-category-summary')?.textContent?.includes('Componentes 1/1')),catalog.name)
   assert.match(await overview.locator('.diagnosis-category-summary').innerText(),/Serviços 0\/0/)
   assert.match(await overview.locator('.diagnosis-category-summary').innerText(),/Componentes 1\/1/)
   assert.match(await overview.locator('.diagnosis-category-summary').innerText(),/R\$ 40,00/)
   assert(await overview.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'overview overflow at '+width)
   await overview.locator('.diagnosis-open').click()
   await editor.waitFor()
   assert.equal(await component.getByRole('button',{name:'Pesquisar componente'}).count(),0,'no intermediate search button')
   const options=component.locator('.component-search-links')
   await options.waitFor()
   const anchors=options.locator('a')
    await anchors.nth(3).waitFor({state:'visible',timeout:10000})
   assert.deepEqual(await anchors.allTextContents(),['Geral','Original','Oficial','Montadora'])
   const general=new URL(await anchors.nth(0).getAttribute('href'))
   const original=new URL(await anchors.nth(1).getAttribute('href'))
   assert.equal(general.host,'www.google.com')
   assert.equal(general.searchParams.get('tbm'),'shop')
   const catalogPiece=catalog.name.replace(/\s*·\s*/g,' ')
   const pieceContext=[catalogPiece,catalog.side&&!catalogPiece.toLocaleLowerCase('pt-BR').includes(catalog.side.toLocaleLowerCase('pt-BR'))?catalog.side:null].filter(Boolean).join(' ')
   assert.equal(general.searchParams.get('q'),['Volkswagen','Gol',pieceContext,'farol dianteiro esquerdo'].join(' '))
   assert.equal(original.searchParams.get('q'),['Volkswagen','Gol',pieceContext,'farol dianteiro esquerdo','original'].join(' '))
   assert.equal(await anchors.nth(2).getAttribute('href'),'https://lista.mercadolivre.com.br/loja/volkswagen/'+['Gol',pieceContext,'farol dianteiro esquerdo'].join(' ').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')+'?sb=storefront_url')
   assert.equal(new URL(await anchors.nth(3).getAttribute('href')).searchParams.get('q'),['Gol',pieceContext,'farol dianteiro esquerdo'].join(' '))
   assert.equal(await component.getByRole('textbox',{name:'Preço unitário do componente'}).inputValue(),'10,00')
   assert.equal(components.list(f.at.id).find(x=>x.id===saved.id).manualPrice,'10')
   assert.equal(quoteCalls.length,0,'displaying links must not call quotation API')
   await toggle.click()
   assert.equal(await component.locator('.component-search-links').count(),0,'links must hide immediately when unselected')
   await page.waitForFunction(()=>document.querySelector('.piece-summary-bar.component-title .count')?.textContent==='0/1')
   await page.waitForFunction(()=>document.querySelector('.piece-summary-bar.component-title .piece-category-amount')?.textContent==='R$ 0,00')
   await page.waitForFunction(()=>document.querySelector('.approved-editor')?.getAttribute('data-save-state')==='confirmed')
   await toggle.click()
   await page.waitForFunction(()=>document.querySelector('.approved-editor')?.getAttribute('data-save-state')==='confirmed')
   await component.locator('.component-search-links').waitFor()
   assert.equal(await component.locator('.component-search-links').count(),1,'links reappear without extra click')
   await page.waitForFunction(()=>document.querySelector('.piece-summary-bar.component-title .count')?.textContent==='1/1')
   await page.waitForFunction(()=>document.querySelector('.piece-summary-bar.component-title .piece-category-amount')?.textContent==='R$ 40,00')
   const price=component.getByRole('textbox',{name:'Preço unitário do componente'})
   await price.fill('inválido')
   await page.waitForFunction(()=>document.querySelector('.piece-summary-bar.component-title .piece-category-amount')?.textContent==='Rascunho incompleto')
   await price.fill('10,00');await price.blur()
   await page.waitForFunction(()=>document.querySelector('.piece-summary-bar.component-title .piece-category-amount')?.textContent==='R$ 40,00',null,{timeout:12000})
   assert.equal(quoteCalls.length,0)
   assert(await component.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'horizontal overflow at '+width)
   assert.deepEqual(errors,[])
   // #119 — os botões continuam explícitos depois da primeira inclusão.
   assert.equal(await editor.getByRole('button',{name:'Adicionar primeiro serviço'}).count(),1)
   assert.equal(await editor.getByRole('button',{name:'Adicionar componente',exact:true}).count(),1)
   await editor.getByRole('button',{name:'Adicionar primeiro serviço'}).click()
   assert.equal(await editor.locator('section.service').count(),1,'one service after one click')
   const addServiceButton=editor.getByRole('button',{name:'Adicionar serviço',exact:true})
   assert.equal(await addServiceButton.count(),1,'service action remains visible')
   await addServiceButton.click()
   assert.equal(await editor.locator('section.service').count(),2,'second service added once')
   const addComponentButton=editor.getByRole('button',{name:'Adicionar componente',exact:true})
   await addComponentButton.click()
   assert.equal(await editor.locator('section.component').count(),2,'second component added once')
   assert.equal(await addComponentButton.count(),1,'component action remains visible')
   assert(await addServiceButton.isVisible()&&await addComponentButton.isVisible(),'actions visible at '+width)
   assert(await serviceHeading.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'service header action overflow at '+width)
   assert(await componentHeading.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'component header action overflow at '+width)
   await component.screenshot({path:dir+'/manual-links-'+width+'.png'})
   console.log('PASS manual search links '+width+' : correct conditional four-link order, technical query, selection guard, no billing')
  }catch(error){if(page)await page.screenshot({path:dir+'/manual-links-failure-'+width+'.png'});throw error}
  finally{await ctx.close();app.closeAllConnections();await new Promise(r=>app.close(r));db.close()}
 }
}finally{await browser?.close();vite.kill('SIGTERM')}
