// Synthetic end-to-end check of optional vehicle suggestions and legacy edits.
import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {openDatabase} from '../server/database.ts'
import {commercialFixture} from '../server/tests/fixtures/commercial.ts'
import {createApp} from '../server/app.ts'

const origin='http://127.0.0.1:5173',password='synthetic-vehicle-form-password'
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
const artifacts='artifacts/vehicle-form';mkdirSync(artifacts,{recursive:true})
let browser
async function ready(){for(let i=0;i<80;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Vite unavailable')}
try{
 await ready()
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox']})
 for(const [width,height] of [[320,740],[390,844],[1440,900]]){
  const db=openDatabase(':memory:'),fixture=commercialFixture(db)
  const app=createApp({atendimentos:fixture.atendimentos,origin,password,voiceProvider:null})
  await new Promise(resolve=>app.listen(8787,'127.0.0.1',resolve))
  const ctx=await browser.newContext({viewport:{width,height}});let page
  try{
   const response=await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
   assert.equal(response.status(),200)
   page=await ctx.newPage()
   const errors=[];page.on('pageerror',e=>errors.push(e.message))
   await page.goto(origin+'/funil')
   await page.getByRole('button',{name:/Novo Atendimento/}).click()
   const dialog=page.getByRole('dialog',{name:'Novo Atendimento'});await dialog.waitFor()
   assert.equal(await dialog.getByText('Veículo informado').count(),0)
   assert.equal(await dialog.getByText('Marca', {exact:true}).count(),0)
   const vehicle=dialog.getByRole('textbox',{name:'Marca e modelo',exact:true})
   const fabrication=dialog.getByRole('textbox',{name:'Ano de fabricação'})
   const modelYear=dialog.getByRole('textbox',{name:'Ano do modelo'})
   await vehicle.fill('Fiat Punto')
   await fabrication.fill('2019')
   await modelYear.fill('2020')
   assert.equal(await dialog.getByRole('textbox',{name:'Pessoa de referência',exact:true}).getAttribute('required'),null)
   assert.equal(await dialog.getByRole('textbox',{name:'Telefone',exact:true}).getAttribute('required'),null)
   await dialog.getByRole('textbox',{name:'Telefone',exact:true}).fill('31999990000')
   await dialog.getByRole('textbox',{name:'Pessoa de referência',exact:true}).fill('Contato Sintético')
   await dialog.getByRole('button',{name:'Criar Atendimento'}).click()
   await dialog.waitFor({state:'hidden',timeout:6000})
   const list=fixture.atendimentos.list({q:'31999990000'});assert.equal(list.total,1)
   const record=list.items[0]
   assert.equal(record.brand,'')
   assert.equal(record.model,'Fiat Punto')
   assert.equal(record.vehicle,'Fiat Punto')
   assert.equal(record.fabricationYear,'2019')
   assert.equal(record.modelYear,'2020')
   const phoneLine=page.locator('.detail-header .detail-contact-lines .detail-phone')
   await phoneLine.waitFor()
   assert.equal((await phoneLine.innerText()).trim(),'31999990000')
   for(const tab of ['Diagnóstico','Mapa','Chat']){
    await page.getByRole('button',{name:tab,exact:true}).click()
    assert.equal(await phoneLine.isVisible(),true,`${width}px: telefone oculto na aba ${tab}`)
    assert.equal((await phoneLine.innerText()).trim(),'31999990000')
   }
   assert.equal(await phoneLine.evaluate(el=>el.scrollWidth<=el.clientWidth+2),true,`${width}px: telefone transborda`)
   assert.equal(await page.locator('.detail-contact-lines strong').evaluate(el=>getComputedStyle(el).fontWeight),'800')
   assert.equal(await phoneLine.evaluate(el=>getComputedStyle(el).fontWeight),'400')
   assert.equal(await page.locator('.detail-header').count(),1)
   assert.equal(await page.locator('.detail-viewport>.detail-phone').count(),0)
   console.log('PASS telefone',width,'visível nas três abas')
   await page.getByRole('button',{name:'Editar Atendimento'}).click()
   const edit=page.getByRole('dialog',{name:'Editar Atendimento'});await edit.waitFor()
   assert.equal(await edit.getByRole('textbox',{name:'Marca e modelo',exact:true}).inputValue(),'Fiat Punto')
   assert.equal(await edit.getByRole('textbox',{name:'Ano de fabricação'}).inputValue(),'2019')
   assert.equal(await edit.getByRole('textbox',{name:'Ano do modelo'}).inputValue(),'2020')
   await edit.getByRole('textbox',{name:'Marca e modelo',exact:true}).fill('Modelo Livre QA')
   await edit.getByRole('textbox',{name:'Ano de fabricação'}).fill('2018')
   await edit.getByRole('textbox',{name:'Ano do modelo'}).fill('2020')
   // Issue #164: autosave após pausa, sem clique manual.
   await edit.getByText('Salvo automaticamente').waitFor({timeout:10000})
   const edited=fixture.atendimentos.get(record.id)
   assert.equal(edited.brand,'')
   assert.equal(edited.model,'Modelo Livre QA')
   assert.equal(edited.vehicle,'Modelo Livre QA')
   assert.equal(edited.fabricationYear,'2018')
   assert.equal(edited.modelYear,'2020')
   let unsavedPrompt=false
   const rejectUnsaved=async prompt=>{unsavedPrompt=true;await prompt.dismiss()}
   page.on('dialog',rejectUnsaved)
   await edit.getByRole('button',{name:'Fechar formulário'}).click()
   await edit.waitFor({state:'hidden'})
   assert.equal(unsavedPrompt,false,'autosave confirmado não deve abrir alerta de descarte')
   page.off('dialog',rejectUnsaved)
   page.on('dialog',async prompt=>{if(prompt.type()==='beforeunload')await prompt.accept();else await prompt.dismiss()})
   await page.getByRole('button',{name:'Editar Atendimento'}).click()
   const editAgain=page.getByRole('dialog',{name:'Editar Atendimento'})
   await editAgain.waitFor()
   assert.equal(await editAgain.getByRole('textbox',{name:'Ano de fabricação'}).inputValue(),'2018')
   assert.equal(await editAgain.getByRole('textbox',{name:'Ano do modelo'}).inputValue(),'2020')
   await editAgain.getByRole('button',{name:'Fechar formulário'}).click()
   // Issue #121: commercial draft is saved per scenario, confirmed by API and restored on reload.
   await page.getByRole('button',{name:'Diagnóstico',exact:true}).click()
   const finance=page.getByRole('region',{name:'Painel financeiro'})
   await finance.locator('.summary').click()
   await finance.getByRole('button',{name:/Negociação comercial/}).click()
   const moneyInput=finance.getByRole('textbox',{name:'Valor em reais'})
   await moneyInput.fill('125')
   await moneyInput.blur()
   let savedDeal=false
   for(let retry=0;retry<80;retry++){
    const stored=fixture.scenarios.list(record.id)[0]?.negotiationDraft
    if(stored?.mode==='discount'&&stored.value==='125'){savedDeal=true;break}
    await page.waitForTimeout(100)
   }
   assert.equal(savedDeal,true,'negotiation autosave was not confirmed')
   await page.reload()
   const restored=page.getByRole('region',{name:'Painel financeiro'})
   await restored.locator('.summary').click()
   await restored.getByRole('button',{name:/Negociação comercial/}).click()
   assert.match(await restored.getByRole('textbox',{name:'Valor em reais'}).inputValue(),/125/)
   console.log('PASS financial draft',width,'scenario autosave and reload')
   // LID-only / missing phone is displayed as absent, never inferred.
   db.prepare("UPDATE atendimentos SET phone='',phone_normalized=NULL WHERE id=?").run(record.id)
   db.prepare("DELETE FROM atendimento_references WHERE atendimento_id=? AND kind='contact'").run(record.id)
   await page.reload();await phoneLine.waitFor()
   assert.equal((await phoneLine.innerText()).trim(),'Não informado')
   assert.equal((await phoneLine.innerText()).includes('31999990000'),false)
   console.log('PASS sem telefone',width)

   assert.deepEqual(errors,[])
   await page.screenshot({path:artifacts+'/vehicle-'+width+'.png'})
   console.log('PASS vehicle form',width,'suggestions, free text, years and read-after-save')
  }catch(e){if(page)await page.screenshot({path:artifacts+'/failure-'+width+'.png'});throw e}
  finally{await ctx.close();app.closeAllConnections();await new Promise(resolve=>app.close(resolve));db.close()}
 }
}finally{await browser?.close();vite.kill('SIGTERM')}
