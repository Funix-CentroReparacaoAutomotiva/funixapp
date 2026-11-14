// Isolated Chromium QA for the Updates approval queue. Synthetic records only.
import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {chromium} from 'playwright'
import {openDatabase} from '../server/database.ts'
import {commercialFixture} from '../server/tests/fixtures/commercial.ts'
import {createUpdatePackageSchema} from '../server/update-packages-schema.ts'
import {UpdatePackageRepository} from '../server/update-packages.ts'
import {createGmailIntakeSchema} from '../server/gmail-intake-schema.ts'
import {GmailIntakeRepository} from '../server/gmail-intake.ts'
import {createApp} from '../server/app.ts'

const origin='http://127.0.0.1:5173'
const password='synthetic-updates-browser-password-0123'
const artifacts='artifacts/updates-browser'
mkdirSync(artifacts,{recursive:true})
const oldEnv=Object.fromEntries(['FUNIX_UPDATES_STORAGE_ENABLED','FUNIX_UPDATES_DECISIONS_ENABLED',
 'FUNIX_UPDATES_CLARIFICATIONS_ENABLED','FUNIX_UPDATES_INGEST_ENABLED',
 'FUNIX_GMAIL_INTAKE_STORAGE_ENABLED','FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED'].map(key=>[key,process.env[key]]))
Object.assign(process.env,{FUNIX_UPDATES_STORAGE_ENABLED:'true',FUNIX_UPDATES_DECISIONS_ENABLED:'true',
 FUNIX_UPDATES_CLARIFICATIONS_ENABLED:'true',FUNIX_UPDATES_INGEST_ENABLED:'false',
 FUNIX_GMAIL_INTAKE_STORAGE_ENABLED:'true',FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED:'false'})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1',
 '--port','5173','--strictPort'],{stdio:'pipe'})
let browser
async function ready(){
 for(let i=0;i<100;i++){
  try{if((await fetch(origin)).ok)return}catch{}
  await new Promise(resolve=>setTimeout(resolve,100))
 }
 throw Error('Vite unavailable')
}
const proposal=(xp,plate,missingFields=[])=>({
 source:'gmail',sourceReference:'synthetic-browser-'+xp,experienceId:xp,plate,
 title:xp+' · '+plate,summary:'Pacote de teste; nenhuma gravação externa',
 actions:[{id:'drive:synthetic:'+xp,type:'drive_archive',title:'Arquivar foto sintética',
  detail:'Proposta sem executor real'}],missingFields
})
try {
 await ready()
 browser=await chromium.launch({headless:true,
   executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),
   args:['--no-sandbox']})
 for(const [width,height] of [[390,844],[1440,900]]){
  const db=openDatabase(':memory:'),fixture=commercialFixture(db)
  createUpdatePackageSchema(db)
  createGmailIntakeSchema(db)
  const gmailRepo=new GmailIntakeRepository(db)
  const gmailNotice=gmailRepo.ingest({
   messageId:'b'.repeat(16), title:'Mensagem Gmail Sintética',
   summary:'Solicitação fictícia de orçamento para pintura de um veículo de teste',
   relevance:'relevant',reason:'LEAD_SERVICE',plateHint:null,xpHint:null
  })
  const repo=new UpdatePackageRepository(db)
  const readyPackage=repo.createProposal(proposal('XP1234','ABC1D23'))
  const pendingPackage=repo.createProposal(proposal('XP2345','DEF2G34',[
   {key:'commercialReview',label:'Conferir autorização comercial',
    hint:'Consultar documento original antes de aprovar'}
  ]))
  const app=createApp({atendimentos:fixture.atendimentos,origin,password,voiceProvider:null})
  await new Promise(resolve=>app.listen(8787,'127.0.0.1',resolve))
  const ctx=await browser.newContext({viewport:{width,height}});let page
  try{
   const login=await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})
   assert.equal(login.status(),200)
   page=await ctx.newPage()
   const errors=[]
   page.on('pageerror',e=>errors.push(e.message))
   page.on('dialog',dialog=>void dialog.accept())
   await page.goto(origin+'/atualizacoes')
   await page.getByRole('group',{name:'Filtro de atualizações'}).getByRole('button',{name:'Pendentes'}).waitFor()
   await page.getByText('XP1234 · ABC1D23').waitFor()
   await page.getByText('XP2345 · DEF2G34').waitFor()
   assert.equal(await page.locator('.updates-card').count(),2)
   await page.getByRole('button',{name:/Mensagem Gmail Sintética/}).waitFor()
   assert.equal(await page.locator('.gmail-intake-card').count(),1)
   await page.getByRole('button',{name:/Mensagem Gmail Sintética/}).click()
   await page.getByText('Solicitação fictícia de orçamento para pintura de um veículo de teste').waitFor()
   assert.equal(await page.getByRole('button',{name:'Autorizar análise'}).isDisabled(),true)
   assert.equal(gmailRepo.get(gmailNotice.id).status,'awaiting_authorization')
   await page.getByRole('button',{name:/XP2345 · DEF2G34/}).click()
   assert.equal(await page.getByRole('button',{name:'Aprovar pacote'}).isDisabled(),true)
   await page.locator('.updates-missing li strong').getByText('Conferir autorização comercial',{exact:true}).waitFor()
   assert.equal(await page.locator('.gmail-intake-detail').count(),0)
   await page.getByRole('button',{name:/XP1234 · ABC1D23/}).click()
   await page.getByRole('button',{name:'Aprovar pacote'}).click()
   await page.getByText('Aprovação registrada. A execução ainda não começou.').waitFor()
   assert.equal(repo.get(readyPackage.id).status,'approved_pending_execution')
   assert.equal(repo.get(pendingPackage.id).status,'awaiting_review')
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM update_packages WHERE status='executed'").get().n,0)
   await page.getByRole('button',{name:/XP2345 · DEF2G34/}).click()
   await page.getByRole('button',{name:'Rejeitar'}).click()
   await page.getByText('Rejeição registrada.').waitFor()
   assert.equal(repo.get(pendingPackage.id).status,'rejected')
   await page.getByRole('group',{name:'Filtro de atualizações'}).getByRole('button',{name:'Todos'}).click()
   await page.getByText('XP2345 · DEF2G34').waitFor()
   assert.equal(await page.locator('.updates-card.is-rejected').count(),1)
   assert.equal(await page.getByText('XP1234 · ABC1D23').count(),1)
   assert.equal(await page.locator('.gmail-intake-card').count(),1)
   await page.getByRole('button',{name:/XP2345 · DEF2G34/}).click()
   assert.equal(await page.getByRole('button',{name:'Aprovar pacote'}).count(),0)
   const search=page.getByRole('textbox',{name:'Buscar atualizações por assunto, experiência, placa ou origem'})
   await search.fill('Mensagem Gmail Sintética')
   await page.getByText('1 atualização no histórico').waitFor()
   assert.equal(await page.locator('.updates-card').count(),0)
   assert.equal(await page.locator('.gmail-intake-card').count(),1)
   await page.getByRole('group',{name:'Filtro de atualizações'}).getByRole('button',{name:'Pendentes'}).click()
   await page.getByText('1 atualização pendente').waitFor()
   assert.equal(await page.locator('.gmail-intake-card').count(),1)
   assert.equal(gmailRepo.get(gmailNotice.id).status,'awaiting_authorization')
   await page.screenshot({path:artifacts+'/updates-'+width+'.png',fullPage:true})
   assert.deepEqual(errors,[])
   console.log('PASS updates browser',width,'cards, blocked approval, decision, pending/all filters, no execution')
  }catch(error){
   if(page)await page.screenshot({path:artifacts+'/failure-'+width+'.png',fullPage:true})
   throw error
  }finally{
   await ctx.close()
   app.closeAllConnections()
   await new Promise(resolve=>app.close(resolve))
   db.close()
  }
 }
}finally{
 await browser?.close()
 vite.kill('SIGTERM')
 for(const [key,value] of Object.entries(oldEnv)){
  if(value===undefined)delete process.env[key]
  else process.env[key]=value
 }
}
