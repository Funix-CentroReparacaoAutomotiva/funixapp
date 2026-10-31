"""Same synthetic datasets before/after; built frontend, local API, explicit response delay.
Usage: python tests/browser/issue22_performance.py NEW_OUTPUT.json
No production endpoints, credentials or app databases. Five samples: p95 is descriptive.
"""
import asyncio,json,subprocess,time,statistics,sys,re
from pathlib import Path
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN

async def run(output):
 results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  try:
   for dataset in ['small','medium','stress']:
    h=Harness()
    try:
     h.check_ports()
     setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{performanceCases,performanceFixture}from'./server/tests/fixtures/performance.ts';const db=openDatabase(process.argv[1]),f=performanceFixture(db,performanceCases.find(s=>s.name===process.argv[3]));writeFileSync(process.argv[2],JSON.stringify({at:f.at.id}));db.close()"""
     subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json'),dataset],cwd=ROOT,check=True)
     at=json.loads((h.folder/'ids.json').read_text())['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
     for device,viewport in [('desktop',{'width':1440,'height':960}),('mobile',{'width':390,'height':844})]:
      ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile');page=await ctx.new_page()
      try:
       await page.goto(ORIGIN);await h.login(page);await page.goto(ORIGIN+'/atendimentos/'+at+'?aba=diagnosticos');await page.locator('.diagnosis-open').first.click()
       editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True);await expect(editor).to_have_attribute('data-save-state','confirmed')
       for latency in [0,150]:
        async def delayed(route):
         response=await route.fetch();await asyncio.sleep(latency/1000);await route.fulfill(response=response)
        await page.route('**/api/**',delayed)
        for operation in ['service-toggle','component-toggle','three-component-edit']:
         samples=[];counts=[];sizes=[];chains=[]
         for n in range(5):
          requests=[];responses=[];tasks=[]
          def capture(r):
           if '/api/' in r.url:requests.append({'method':r.method,'path':re.sub(r'/api/atendimentos/[^/]+','/api/atendimentos/:id',r.url.split(ORIGIN)[-1].split('?')[0]),'ms':round((time.perf_counter()-start)*1000,1)})
          async def response(r):
           if '/api/' in r.url:
            try:responses.append(len(await r.body()))
            except Exception:pass
          def on_response(r):tasks.append(asyncio.create_task(response(r)))
          page.on('request',capture);page.on('response',on_response);start=time.perf_counter()
          await editor.evaluate("""(root,eventName)=>{
           window.__saveLatency=new Promise(resolve=>{
            let started=null,changed=false;
            const begin=()=>{started=performance.now();root.removeEventListener(eventName,begin,true)};
            root.addEventListener(eventName,begin,true);
            const observer=new MutationObserver(()=>{
             if(started===null)return;
             const saved=root.dataset.saveState==='confirmed';if(!saved)changed=true;
             if(changed&&saved){observer.disconnect();resolve(performance.now()-started)}
            });observer.observe(root,{attributes:true,attributeFilter:['data-save-state']});
           });
          }""",'input' if operation=='three-component-edit' else 'click')
          if operation=='three-component-edit':
           for i in range(3):await editor.get_by_label('Descrição do componente',exact=True).nth(i).fill(f'QA {device} {latency} {n} componente {i}')
          else:
           button=editor.get_by_role('button',name='Habilitar serviço neste cenário' if operation=='service-toggle' else 'Habilitar componente neste cenário',exact=True).first
           old=await button.get_attribute('aria-pressed');await button.click();await expect(button).to_have_attribute('aria-pressed','false' if old=='true' else 'true')
          elapsed=await asyncio.wait_for(page.evaluate('window.__saveLatency'),30)
          await expect(editor).to_have_attribute('data-save-state','confirmed')
          page.remove_listener('request',capture);page.remove_listener('response',on_response);await asyncio.gather(*tasks)
          samples.append(round(elapsed,1));counts.append(len(requests));sizes.append(sum(responses));chains.append(requests);await page.wait_for_timeout(70)
         result={'dataset':dataset,'device':device,'response_delay_ms':latency,'operation':operation,'samples_ms':samples,'p50_ms':round(statistics.median(samples),1),'p95_ms':sorted(samples)[-1],'requests_per_sample':counts,'response_bytes_per_sample':sizes,'last_request_chain':chains[-1]}
         results.append(result);print(json.dumps({k:v for k,v in result.items()if k not in ['last_request_chain','response_bytes_per_sample']}),flush=True)
        await page.unroute('**/api/**',delayed)
      finally:await ctx.close()
    finally:h.cleanup()
  finally:await browser.close()
 with open(output,'x')as f:json.dump({'samples':5,'method':'DOM event to confirmed editor data-save-state via MutationObserver (no polling in timing); production frontend build, local API/SQLite; artificial delay per response, no bandwidth or CPU throttling','results':results},f,indent=2)
if __name__=='__main__':asyncio.run(run(sys.argv[1]))
