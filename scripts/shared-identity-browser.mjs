import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {chromium} from 'playwright'
import {entityContactsFixture} from '../server/tests/fixtures/entity-contacts.ts'
import {createApp} from '../server/app.ts'

const origin='http://127.0.0.1:5173', password='synthetic-shared-identity'
const out=process.env.FUNIX_IDENTITY_EVIDENCE??'artifacts/shared-identity'
const before=process.argv.includes('--before')
mkdirSync(out,{recursive:true})
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'pipe'})
let browser
try {
  for(let i=0;i<80;i++){
    try{if((await fetch(origin)).ok)break}catch{}
    await new Promise(r=>setTimeout(r,100))
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':'/usr/bin/google-chrome'),args:['--no-sandbox']})
  for(const width of before?[390]:[320,390,1440]){
    const f=entityContactsFixture({unnamed:true})
    const linked=['5531999990101','5531999990202','5531999990303'].map((pn,index)=>{
      const jid=pn+'@s.whatsapp.net'
      const entity=index===1?f.customers.save({kind:'entity',text:'Pessoa cadastrada'}):null
      const at=f.at.create(index===0?{name:'Pessoa de referência sintética'}:{references:{
        person:entity?[{id:entity.id,text:entity.text}]:[{id:null,text:'Pessoa sintética A'},{id:null,text:'Pessoa sintética B'}],contact:[],vehicle:[],payer:[],
      }})
      const cid=f.channels.identities.rememberProviderConversation(jid)
      f.links.link({conversationId:cid,atendimentoId:at.id,expectedRevision:0,requestId:randomUUID(),reason:'Vínculo sintético existente'})
      f.rows.push(jid)
      f.histories.set(jid,'Histórico independente '+(index+1))
      return {pn,cid,at}
    })
    const app=createApp({atendimentos:f.at,evolutionChat:f.bridge,v20Associations:f.links,origin,password,voiceProvider:null})
    await new Promise(r=>app.listen(8787,'127.0.0.1',r))
    const ctx=await browser.newContext({viewport:{width,height:900}})
    try{
      assert.equal((await ctx.request.post(origin+'/api/session',{headers:{Origin:origin},data:{password}})).status(),200)
      const page=await ctx.newPage()
      const errors=[]
      page.on('pageerror',error=>errors.push(error.message))
      await page.goto(origin+'/conversas')
      const row=page.locator('.conversation-row').filter({hasText:'+'+linked[0].pn})
      await row.waitFor()
      if(before){
        assert.match(await row.innerText(),/Sem nome/)
        await page.screenshot({path:out+'/antes-conversas-390.png'})
        await page.goto(origin+'/atendimentos/'+linked[0].at.id+'?aba=chat')
        await page.locator('.detail-contact').getByText('Pessoa de referência sintética').waitFor()
        assert.equal(await page.locator('.detail-phone').innerText(),'Não informado')
        await page.screenshot({path:out+'/antes-atendimento-390.png'})
        console.log('Reprodução em API/SQLite com nome legado, participante já cadastrado e múltiplas pessoas.')
        continue
      }

      // Open conversation → confirm the proposed legacy identity → open the existing Atendimento.
      await row.getByRole('button',{name:'Detalhes: 1 Atendimentos'}).click()
      const chat=page.getByRole('dialog',{name:'Detalhes da conversa'})
      await chat.getByText('Histórico independente 1',{exact:true}).waitFor()
      await chat.getByRole('textbox',{name:'Pessoa deste número'}).waitFor()
      assert.equal(await chat.getByRole('textbox',{name:'Pessoa deste número'}).inputValue(),'Pessoa de referência sintética')
      await page.screenshot({path:out+'/identificar-'+width+'.png'})
      const sent=page.waitForRequest(request=>request.method()==='POST'&&request.url().endsWith('/identity'))
      await chat.getByRole('button',{name:'Identificar pessoa',exact:true}).click()
      const operation=(await sent).postDataJSON()
      await chat.getByText('Pessoa confirmada nesta conversa.',{exact:true}).waitFor()
      assert.equal((await ctx.request.post(origin+'/api/chat/conversations/'+linked[0].cid+'/identity',{headers:{Origin:origin},data:operation})).status(),200)
      const first=f.at.get(linked[0].at.id,true)
      assert.equal(first.name,'Pessoa de referência sintética')
      assert.equal(first.phone,'+'+linked[0].pn)
      assert.equal(f.customers.search('entity','Pessoa de referência sintética').length,1)
      await chat.getByRole('button',{name:/Abrir Atendimento/}).click()
      await page.locator('.detail-contact').getByText(first.name).waitFor()
      assert.equal(await page.locator('.detail-phone').innerText(),first.phone)
      await page.getByText('Histórico independente 1',{exact:true}).waitFor()
      assert.equal(await page.getByText('Falha ao consultar conversa vinculada',{exact:true}).count(),0)
      await page.screenshot({path:out+'/atendimento-'+width+'.png'})
      await page.getByRole('button',{name:'Editar Atendimento',exact:true}).click()
      const editor=page.getByRole('dialog',{name:'Editar Atendimento',exact:true})
      await editor.getByRole('region',{name:'Pessoas',exact:true}).getByText(first.phone,{exact:true}).waitFor()
      assert.equal(await editor.getByRole('region',{name:'Contatos',exact:true}).isVisible(),true)
      await page.screenshot({path:out+'/pessoa-e-telefone-'+width+'.png'})
      await editor.getByRole('region',{name:'Pessoas',exact:true}).getByRole('button',{name:'Editar cadastro selecionado'}).click()
      const registration=page.getByRole('dialog',{name:'Editar cadastro selecionado'})
      await registration.getByRole('textbox',{name:'Nome da Entidade'}).fill('Pessoa com nome atualizado')
      await registration.getByRole('button',{name:'Salvar pessoa e telefones'}).click()
      await editor.getByText('Pessoa com nome atualizado',{exact:true}).waitFor()
      await editor.getByText('Salvo automaticamente',{exact:true}).waitFor()

      await page.goto(origin+'/conversas')
      await page.getByRole('button',{name:'Abrir conversa: Pessoa com nome atualizado'}).waitFor()
      await page.screenshot({path:out+'/conversas-'+width+'.png'})
      await page.locator('.conversation-row').filter({hasText:'+'+linked[1].pn}).getByRole('button',{name:'Detalhes: 1 Atendimentos'}).click()
      assert.equal(await chat.getByRole('textbox',{name:'Pessoa deste número'}).inputValue(),'Pessoa cadastrada')
      await chat.getByText('Histórico independente 2',{exact:true}).waitFor()
      assert.equal(await chat.getByText('Histórico independente 1',{exact:true}).count(),0)
      await chat.getByRole('button',{name:'Confirmar pessoa',exact:true}).click()
      await chat.getByText('Pessoa confirmada nesta conversa.').waitFor()
      assert.equal(f.customers.search('entity','Pessoa cadastrada').length,1)
      assert.equal(f.at.get(linked[1].at.id,true).phone,'+'+linked[1].pn)
      await chat.getByRole('button',{name:'Fechar detalhes'}).click()

      await page.locator('.conversation-row').filter({hasText:'+'+linked[2].pn}).getByRole('button',{name:'Detalhes: 1 Atendimentos'}).click()
      const person=chat.getByLabel('Pessoa da ficha',{exact:true})
      await person.waitFor()
      assert.equal(await person.inputValue(),'')
      assert.equal(await chat.getByRole('textbox',{name:'Pessoa deste número'}).inputValue(),'')
      assert.equal(await chat.getByRole('button',{name:'Identificar pessoa',exact:true}).isEnabled(),false)
      await person.selectOption('1')
      await chat.getByRole('button',{name:'Identificar pessoa',exact:true}).click()
      await chat.getByText('Pessoa confirmada nesta conversa.').waitFor()
      const ambiguous=f.at.get(linked[2].at.id,true)
      assert.deepEqual(ambiguous.references.person.map(person=>person.text),['Pessoa sintética A','Pessoa sintética B'])
      assert.equal(ambiguous.references.person[0].id,null)
      assert.ok(ambiguous.references.person[1].id)
      await chat.getByRole('button',{name:/Abrir Atendimento/}).click()
      await page.locator('.detail-contact').getByText('Pessoa sintética B',{exact:true}).waitFor()
      assert.equal(await page.locator('.detail-phone').innerText(),'+'+linked[2].pn)
      await page.getByText('Histórico independente 3',{exact:true}).waitFor()
      assert.equal(await page.getByText('Histórico independente 1',{exact:true}).count(),0)
      assert.equal(f.at.list().total,3)
      assert.equal(f.sends(),0)
      assert.equal(f.mediaSent.length,0)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      assert.deepEqual(errors,[])
      console.log(JSON.stringify({width,clicks:3,legacy:true,existingEntity:true,explicitAmbiguity:true,independentHistories:true,atendimentos:3,realSends:0}))
    } finally {await ctx.close();await new Promise(r=>app.close(r));f.db.close()}
  }
} finally {await browser?.close();vite.kill()}
