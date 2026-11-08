// One-off synthetic, read-only investigation. Never purchases, logs in, or sends identifiers.
import {chromium} from 'playwright'
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome',args:['--no-sandbox']})
const sites=[
 ['Toyota','https://www.pecasredetoyota.com.br/'],
 ['Renault Peca','https://peca.renault.com.br/'],
 ['Renault Mecanico','https://www.mecanico.renault.com.br/loja-online']
]
try{
 for(const [label,url] of sites){
  const ctx=await browser.newContext({locale:'pt-BR',viewport:{width:1400,height:900}})
  const page=await ctx.newPage()
  try{
   const res=await page.goto(url,{waitUntil:'domcontentloaded',timeout:17000})
   await page.waitForTimeout(1500)
   const inputs=await page.locator('input').evaluateAll(nodes=>nodes.slice(0,18).map(x=>({type:x.type,name:x.name,id:x.id,placeholder:x.placeholder,aria:x.getAttribute('aria-label')})))
   console.log('PROBE',label,'HTTP',res?.status(),'URL',page.url(),'TITLE',(await page.title()).slice(0,100))
   console.log('INPUTS',label,JSON.stringify(inputs))
   const search=page.locator('input[type="search"], input[name="q"], input[placeholder*="peça" i], input[placeholder*="busca" i], input[placeholder*="pesqui" i]')
   if(await search.count()){
    const input=search.first()
    try{
     await input.fill('farol dianteiro direito',{timeout:5000})
     await input.press('Enter',{timeout:5000})
     await page.waitForTimeout(3500)
     console.log('SEARCH',label,'URL',page.url(),'HEAD',(await page.locator('body').innerText()).slice(0,240).replace(/\s+/g,' '))
    }catch(e){console.log('SEARCH_ERROR',label,String(e).slice(0,250))}
   }
  }catch(e){console.log('PROBE_ERROR',label,String(e).slice(0,350))}
  finally{await ctx.close()}
 }
}finally{await browser.close()}
