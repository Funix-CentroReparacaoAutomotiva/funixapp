// Temporary investigation only: read-only searches using a synthetic component, no account and no purchases.
import {chromium} from 'playwright'
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome',args:['--no-sandbox']})
const targets=[
 ['montadora','https://pecas.vw.com.br/'],
 ['meli','https://www.mercadolivre.com.br/loja/volkswagen/pecas-e-acessorios']
]
try{
 for(const [name,url] of targets){
  const context=await browser.newContext({locale:'pt-BR',viewport:{width:1440,height:900}})
  const page=await context.newPage()
  const searches=[]
  page.on('request',r=>{if(/search|busca|pesquisa|query|solr|autocomplete/i.test(r.url())&&searches.length<8)searches.push(r.url().slice(0,260))})
  try{
   const res=await page.goto(url,{waitUntil:'domcontentloaded',timeout:28000})
   await page.waitForTimeout(2500)
   console.log('PROBE',name,'STATUS',res?.status(),'URL',page.url(),'TITLE',(await page.title()).slice(0,120))
   console.log('FIELDS',name,JSON.stringify((await page.locator('input').evaluateAll(nodes=>nodes.slice(0,20).map(n=>({type:n.type,name:n.name,placeholder:n.placeholder,aria:n.getAttribute('aria-label'),outer:n.outerHTML.slice(0,200)})))).slice(0,15)))
   let inputs=page.locator('input[type=search], input[name=q], input[placeholder*="Buscar" i], input[placeholder*="pesquis" i], input[placeholder*="Peça" i]')
   const count=await inputs.count()
   console.log('INPUT_MATCHES',name,count)
   if(count){
    const input=inputs.first()
    await input.fill('farol dianteiro esquerdo gol 2019',{timeout:5000})
    await input.press('Enter',{timeout:5000})
    await page.waitForTimeout(4500)
    console.log('AFTER',name,'URL',page.url(),'TITLE',(await page.title()).slice(0,120))
    console.log('HEAD',name,(await page.locator('body').innerText()).slice(0,500).replace(/\s+/g,' '))
    console.log('SEARCH_REQUESTS',name,JSON.stringify(searches))
   }
  }catch(e){console.log('PROBE_ERROR',name,String(e).slice(0,440))}
  finally{await context.close()}
 }
}finally{await browser.close()}
