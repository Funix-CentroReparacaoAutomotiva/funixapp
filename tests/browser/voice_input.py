"""PR2: real browser MediaRecorder with Chromium fake device; real local API, provider mocks, synthetic SQLite."""
import asyncio,json,subprocess,sqlite3,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN,API
ARTIFACTS=ROOT/'docs/evidencias/voice-input'
async def device_case(browser,device,viewport):
 h=Harness();h.check_ports();ctx=None;page=None
 try:
  script="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db),two=f.scenarios.create(f.at.id,{name:'QA 2'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,two:two.id}));db.close()"""
  subprocess.run(['node','--input-type=module','-e',script,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text())
  api=h.start(['node','server/tests/fixtures/voice-browser.ts'],'voice-api');await h.ready(API+'/api/ready',api)
  vite=h.start(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'vite');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop',permissions=['microphone'])
  await h.watch(ctx)
  await ctx.add_init_script("""(()=>{
   window.voiceQA={delay:0,denied:false,streams:[]};
   const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   navigator.mediaDevices.getUserMedia=async constraints=>{
    if(window.voiceQA.denied)throw new DOMException('Synthetic denial','NotAllowedError');
    if(window.voiceQA.delay)await new Promise(r=>setTimeout(r,window.voiceQA.delay));
    const stream=await get(constraints);window.voiceQA.streams.push(stream);return stream;
   };
  })()""")
  page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN);await h.login(page)
  base='/atendimentos/'+ids['at'];await page.goto(ORIGIN+base+'?aba=diagnosticos')
  bot=page.get_by_role('button',name='Abrir Copiloto FUNIX',exact=True)
  await expect(page.locator('.scenario-trigger')).to_be_visible()
  await page.wait_for_timeout(200)
  await bot.click();panel=page.get_by_role('region',name='Copiloto FUNIX',exact=True);await expect(panel).to_be_visible();h.mark(device+': short tap opens existing panel')
  async def hold(duration=900):
   box=await bot.bounding_box();await page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);await page.mouse.down();await page.wait_for_timeout(duration)
  async def all_stopped():assert await page.evaluate("window.voiceQA.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))")
  writes_before=len([r for r in h.api_requests if r['method']not in ['GET','HEAD']])
  await hold();await expect(panel.get_by_role('status')).to_contain_text('Gravando');await page.screenshot(path=str(ARTIFACTS/(device+'-gravando.png')));await page.mouse.up()
  await expect(panel.get_by_role('status')).to_contain_text('Interpretação concluída',timeout=15000)
  await panel.locator('summary').first.click();await expect(panel).to_contain_text('Ditado sintético');await page.screenshot(path=str(ARTIFACTS/(device+'-interpretado.png')))
  await all_stopped();h.mark(device+': native WebM/Opus capture and release call real authenticated read-only API with deterministic provider mocks')
  # Native keyboard long press, empty/cancel protections are separately unit-tested.
  await bot.focus();await page.keyboard.down('Space');await page.wait_for_timeout(700);await expect(panel.get_by_role('status')).to_contain_text('Gravando');await page.keyboard.up('Space')
  await expect(panel.get_by_role('status')).to_contain_text('Interpretação concluída');await all_stopped()
  h.mark(device+': accessible keyboard press/release records and processes')
  # First permission resolves after the user has released: no hidden recording.
  await page.evaluate('window.voiceQA.delay=1100')
  before=len([r for r in h.api_requests if '/copiloto/interpretar'in r['path']])
  await hold(480);await page.mouse.up();await page.wait_for_timeout(1300)
  await expect(panel.get_by_role('status')).to_contain_text('Pressione e segure novamente');await all_stopped()
  assert len([r for r in h.api_requests if '/copiloto/interpretar'in r['path']])==before
  h.mark(device+': late permission frees tracks and never records or sends hidden audio')
  await page.evaluate('window.voiceQA.delay=0;window.voiceQA.denied=true')
  await hold(500);await page.mouse.up();await expect(panel.get_by_role('alert')).to_contain_text('Microfone não autorizado')
  await page.evaluate('window.voiceQA.denied=false')
  # pointercancel stops without submission.
  await hold(700);await bot.dispatch_event('pointercancel',{'pointerId':1});await page.mouse.up();await page.wait_for_timeout(150);await all_stopped()
  assert len([r for r in h.api_requests if '/copiloto/interpretar'in r['path']])==before
  h.mark(device+': denied permission and pointercancel preserve data and release resources')
  # Same-Atendimento tab navigation also cancels capture.
  await hold(700);await page.get_by_role('button',name='Chat',exact=True).evaluate('(b)=>b.click()');await page.mouse.up();await page.wait_for_timeout(250);await all_stopped()
  assert len([r for r in h.api_requests if '/copiloto/interpretar'in r['path']])==before
  h.mark(device+': React tab navigation cancels active recording without upload')
  await hold(700)
  # Switching scenario via the real UI invalidates captured context.
  await page.mouse.up()
  await page.locator('.scenario-trigger').click();await page.get_by_role('menuitemradio',name='Cenário 2',exact=True).click()
  await page.wait_for_timeout(300);await all_stopped()
  assert not await panel.get_by_text('Ditado sintético: manter o capô.',exact=True).count()
  h.mark(device+': scenario switch discards previous result')
  for tab in ['chat','diagnosticos','mapa']:
   await page.goto(ORIGIN+base+'?aba='+tab);await expect(bot).to_be_visible();await page.wait_for_timeout(180)
   await bot.click();await expect(panel).to_be_visible()
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   box=await bot.bounding_box();assert box['width']>=44 and box['height']>=44
   for control in [page.get_by_role('button',name='Emitir',exact=True),page.get_by_role('button',name='Orçamentos emitidos',exact=True)]:
    assert await control.count()==1
    if await control.count():
     b=await control.bounding_box();assert b['x']+b['width']<=box['x'] or b['y']+b['height']<=box['y']
   await page.screenshot(path=str(ARTIFACTS/(device+'-'+tab+'.png')))
   finance=page.get_by_role('region',name='Painel financeiro',exact=True)
   await finance.locator('.summary').click();await page.wait_for_timeout(100)
   cp=await panel.bounding_box();f=await finance.bounding_box();assert cp['y']+cp['height']<=f['y'] and cp['y']>=0,(device,tab,cp,f)
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   await page.screenshot(path=str(ARTIFACTS/(device+'-'+tab+'-financeiro-expandido.png')))
   await finance.locator('.summary').click()
  h.mark(device+': three tabs preserve launcher/footer geometry, no horizontal overflow at '+str(viewport['width'])+'px')
  # Navigation/unmount late result, not applied to other contexts.
  await hold(700);await page.goto(ORIGIN+'/funil');await page.wait_for_timeout(250);await all_stopped()
  h.mark(device+': navigation/unmount cancels capture')
  db=sqlite3.connect(h.folder/'atendimentos.sqlite')
  assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not db.execute('PRAGMA foreign_key_check').fetchall()
  assert db.execute('SELECT quantity FROM diagnosis_services LIMIT 1').fetchone()[0]=='3';db.close()
  writes=[r for r in h.api_requests if r['method']not in ['GET','HEAD']][writes_before:]
  assert all('/copiloto/interpretar'in r['path'] for r in writes),writes
  assert not h.external and not h.page_errors,(h.external,h.page_errors)
  h.mark(device+': no commercial write request, no external network, no JS errors; synthetic SQLite integrity and quantity unchanged')
 except Exception:
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
  raise
 finally:
  (ARTIFACTS/(device+'-results.json')).write_text(json.dumps({'synthetic':True,'mockProvider':True,'realSmartphone':False,'results':h.results,'pageErrors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
  if ctx:await ctx.close()
  h.cleanup()
async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True)
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
  try:
   for name,view in [('desktop',{'width':1440,'height':1000}),('mobile390',{'width':390,'height':844}),('mobile320',{'width':320,'height':568})]:await device_case(browser,name,view)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
