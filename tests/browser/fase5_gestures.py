"""Fase 5: real Chromium input, local API and disposable synthetic SQLite V10 only."""
import asyncio,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/fase5'
async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{ComponentRepository}from'./server/components.ts';import{BudgetRepository}from'./server/tests/fixtures/budget-renderer.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db),parts=new ComponentRepository(db);parts.save(f.at.id,{pieceId:f.item.id,name:'Componente QA',quantity:'0.25',manualPrice:'10',notes:''});f.commercial.saveCatalog({kind:'diagnostico',name:'Risco superficial QA',status:'validado'});const b=new BudgetRepository(db),one=f.scenarios.list(f.at.id)[0],req={scenarioId:one.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,req),version=(await b.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:'fase5-frozen-history'}));const grade=f.commercial.add(f.at.id,{pieceCodes:['grade_dianteira']}).find(p=>p.pieceId===f.commercial.catalogs().items.find(c=>c.code==='grade_dianteira').id);let scene=f.scenarios.list(f.at.id)[0];const two=f.scenarios.create(f.at.id,{name:'Outro cenário QA',duplicateFrom:scene.id,sourceRevision:scene.revision});f.scenarios.update(f.at.id,scene.id,{revision:scene.revision,pieceFlags:{[grade.id]:false}});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,capo:f.item.id,grade:grade.id,one:scene.id,two:two.id,budget:version.id,snapshot:version.snapshot}));db.close();"
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=True);await h.watch(ctx);page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN);await h.login(page);await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=mapa');await expect(page.locator('.interactive-map')).to_be_visible();await expect(page.locator('.scenario-trigger')).to_be_enabled();cdp=await ctx.new_cdp_session(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios?scenarioId='+ids['one'])
  async def idle():await expect(page.locator('.scenario-trigger')).to_be_enabled();await expect(page.locator('.form-error')).to_have_count(0)
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')),animations='disabled')
  async def main(name):
   await page.get_by_role('button',name=name,exact=True).click();await page.evaluate('async()=>{await document.activeViewTransition?.finished}')
  dialog=page.get_by_role('dialog',name='Selecionar peça no mapa');editor=page.get_by_role('region',name='Editor de diagnóstico')
  async def region(name='frente'):
   await page.locator('[data-region="'+name+'"]').click();await expect(dialog).to_be_visible()
  async def touch(locator,dx=0,dy=0,hold=0,cancel=False):
   await page.evaluate('async()=>{await document.activeViewTransition?.finished}')
   await locator.scroll_into_view_if_needed();box=await locator.bounding_box();x=box['x']+min(box['width']/2,45);y=box['y']+box['height']/2
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
   if hold:await asyncio.sleep(hold)
   if dx or dy:
    for i in range(1,7):
     await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*i/6,'y':y+dy*i/6}]});await asyncio.sleep(.025)
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel'if cancel else'touchEnd','touchPoints':[]})
  async def back():await page.get_by_role('button',name='Voltar ao Mapa',exact=True).click();await expect(page.locator('.interactive-map')).to_be_visible()
  writes=[];page.on('request',lambda r:writes.append((r.method,r.url,r.post_data_json))if'/api/'in r.url and r.method in ['POST','PATCH','DELETE']else None)
  initial=await ws();pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['budget']+'/pdf');pdf_hash=hashlib.sha256(await pdf.body()).hexdigest()
  await main('Diagnósticos');await expect(page.locator('.diagnosis-row')).to_have_count(2);await shot('depois-lista');await main('Mapa')
  # Core radial geometry and the new two ways to dismiss.
  await region('motorista');await expect(dialog.locator('.disc-node')).to_have_count(13);await expect(dialog.locator('.map-group-cue')).to_have_count(8)
  await expect(dialog.get_by_role('button',name='Fechar seleção',exact=True)).to_have_count(0)
  await shot('depois-mapa');await dialog.get_by_role('button',name='Fechar seleção central',exact=True).click();await expect(dialog).to_have_count(0)
  await region();disc=await dialog.locator('.disc-wrap').bounding_box();outer=await dialog.bounding_box()
  assert disc and outer and disc['y']-outer['y']>=9
  await page.mouse.click(outer['x']+outer['width']/2,disc['y']-7);await expect(dialog).to_have_count(0)
  h.mark(device+': no upper X; central X and click outside circular disk close the selector')

  # Long press on an existing piece opens only a quick overlay, never navigates.
  await region();capo=dialog.get_by_role('button',name='Capô',exact=True);quick=dialog.get_by_role('dialog',name='Diagnóstico rápido');before=len(writes)
  await touch(capo,hold=.7);await expect(quick).to_be_visible();await expect(editor).to_have_count(0)
  assert len(writes)==before and page.url.endswith('aba=mapa')
  await quick.get_by_role('button',name='Cancelar',exact=True).click();await expect(quick).to_have_count(0)
  assert await ws()==initial and len(writes)==before
  await touch(capo,hold=.7);await expect(quick).to_be_visible()
  await quick.get_by_label('Diagnóstico rápido').select_option(label='Risco superficial QA')
  await quick.get_by_label('Intensidade rápida').select_option('moderado')
  await quick.get_by_role('button',name='Confirmar',exact=True).click();await expect(quick).to_have_count(0)
  await expect(dialog).to_be_visible();await expect(editor).to_have_count(0)
  current=await ws();saved=next(p for p in current['items'] if p['id']==ids['capo'])
  assert saved['diagnosisId'] and saved['intensity']=='moderado' and len(saved['services'])==len(next(p for p in initial['items'] if p['id']==ids['capo'])['services'])
  assert [r[0] for r in writes[before:]]==['PATCH']
  await touch(capo,hold=.7);await expect(quick.get_by_label('Intensidade rápida')).to_have_value('moderado')
  await quick.get_by_role('button',name='Cancelar',exact=True).click()
  await touch(capo);await expect(editor).to_be_visible();await back()
  h.mark(device+': long press edits only diagnosis/intensity; Cancel does not write; regular tap still opens editor')

  # For an absent item long press does NOT add until Confirm; no arbitrary dimension is invented.
  await region('estrutura_dianteira');panel=dialog.get_by_role('button',name='Painel dianteiro',exact=True);before=len(writes)
  await touch(panel,hold=.7);await expect(quick).to_be_visible()
  assert len(writes)==before
  await expect(quick.get_by_role('button',name='Confirmar',exact=True)).to_be_disabled()
  await quick.get_by_role('button',name='Cancelar',exact=True).click()
  assert len(writes)==before
  await touch(panel,hold=.7);await quick.get_by_label('Diagnóstico rápido').select_option(label='Risco superficial QA')
  await quick.get_by_label('Intensidade rápida').select_option('leve')
  await quick.get_by_role('button',name='Confirmar',exact=True).click();await expect(quick).to_have_count(0)
  await expect(dialog).to_be_visible();await expect(editor).to_have_count(0)
  current=await ws();added=next(p for p in current['items'] if p['id'] not in [ids['capo'],ids['grade']])
  assert added['diagnosisId'] and added['intensity']=='leve' and not current['scenarios'][1]['pieceFlags'].get(added['id'],False)
  requests=writes[before:]
  assert sum(method=='POST' and url.endswith('/diagnosticos') for method,url,_ in requests)==1
  assert sum(method=='PATCH' and url.endswith('/diagnosticos/'+added['id']) for method,url,_ in requests)==1
  assert not any(method=='DELETE' for method,_,_ in requests)
  h.mark(device+': missing master is created once only upon confirmation, and active scenario is unchanged elsewhere')

  # Group/Ambos remains additive. The center returns to parent groups.
  await dialog.get_by_role('button',name='Fechar seleção central',exact=True).click();await region()
  await dialog.get_by_role('button',name='Grades e entradas de ar',exact=True).click()
  await dialog.get_by_role('button',name='Grade inferior',exact=True).click()
  ambos=dialog.get_by_role('button',name='Ambos',exact=True);before=len(writes);old=await ws()
  await touch(ambos);await idle();now=await ws();assert len(now['items'])==len(old['items'])+2
  await touch(ambos,hold=.7);await expect(quick).to_have_count(0);assert len(writes)==before+1
  await dialog.get_by_role('button',name='Voltar ao nível anterior',exact=True).click()
  await dialog.get_by_role('button',name='Voltar ao nível anterior',exact=True).click()
  await dialog.get_by_role('button',name='Fechar seleção central',exact=True).click()
  h.mark(device+': bilateral groups add missing pieces without opening an arbitrary editor')

  await region();churr=dialog.get_by_role('button',name='Alma do para-choque dianteiro',exact=True);before=len(writes)
  await touch(churr,dx=22,hold=.15);await asyncio.sleep(.65);await expect(quick).to_have_count(0)
  await touch(churr,hold=.15,cancel=True);await asyncio.sleep(.65)
  assert len(writes)==before;await expect(quick).to_have_count(0)
  await dialog.get_by_role('button',name='Fechar seleção central',exact=True).click()
  h.mark(device+': drag/cancel do not open quick overlay or perform mutations')
  await main('Diagnósticos');await expect(page.locator('.diagnosis-list')).to_be_visible();capo=page.locator('.diagnosis-swipe-shell').filter(has=page.locator('.diagnosis-title strong',has_text='Capô'));open_button=capo.locator('.diagnosis-open');before=await ws();calls=len(writes);url=page.url;await touch(open_button,dx=100);await expect(capo).to_have_attribute('data-revealed','true');assert page.url==url and len(writes)==calls;await shot('swipe-revelado');revealed_box=await capo.locator('.swipe-delete').bounding_box();row_box=await capo.locator('.diagnosis-row').bounding_box();shell_box=await capo.bounding_box();assert row_box['x']>=revealed_box['x']+revealed_box['width']-1;assert row_box['x']+row_box['width']<=shell_box['x']+shell_box['width']+1;await capo.locator('.swipe-delete').click();consent=page.get_by_role('dialog',name='Confirmar remoção da composição');await expect(consent).to_contain_text('todos os cenários');await consent.get_by_role('button',name='Cancelar',exact=True).click();assert await ws()==before and len(writes)==calls;await expect(capo).to_have_attribute('data-revealed','false')
  h.mark(device+': physical right swipe reveals soft-red explicit action only, never navigates or writes; Cancel preserves both scenarios, children, flags and all revisions')
  await touch(open_button,dx=100);await expect(capo).to_have_attribute('data-revealed','true');await page.keyboard.press('Escape');await expect(capo).to_have_attribute('data-revealed','false');await expect(open_button).to_be_focused();await touch(open_button,dx=100);await main('Mapa');await main('Diagnósticos');await expect(capo).to_have_attribute('data-revealed','false');await touch(open_button,dx=100);await page.locator('.scenario-trigger').click();await page.get_by_role('menuitemradio',name='Cenário 2',exact=True).click();await expect(capo).to_have_attribute('data-revealed','false');await page.locator('.scenario-trigger').click();await page.get_by_role('menuitemradio',name='Cenário 1',exact=True).click();await idle()
  # The current quick-edit map flow leaves five masters, which fit desktop/mobile.
  # Add known real catalog codes to THIS disposable fixture so native scroll is testable.
  current=await ws();known={p['pieceId']for p in current['items']};catalog=(await get('/api/catalogos'))['items'];extra=[c['code']for c in catalog if c['kind']=='peca'and c['active']and c['code']and c['id']not in known][:10]
  for i in range(0,len(extra),2):
   scene=(await ws())['scenarios'][0];r=await ctx.request.post(ORIGIN+base+'/diagnosticos',headers={'Origin':ORIGIN},data={'scenarioId':ids['one'],'scenarioRevision':scene['revision'],'pieceCodes':extra[i:i+2]});assert r.ok
  await page.reload();await expect(page.locator('.diagnosis-row')).to_have_count(len(current['items'])+len(extra));await idle();assert await page.locator('.diagnostics-body').evaluate('(e)=>e.scrollHeight>e.clientHeight')
  # Real vertical gesture remains native scroll; slow/short/cancelled swipes reveal nothing.
  await touch(open_button,dx=100,hold=1.6);await expect(capo).to_have_attribute('data-revealed','false');await touch(open_button,dx=20);await expect(capo).to_have_attribute('data-revealed','false');await touch(open_button,dx=100,cancel=True);await expect(capo).to_have_attribute('data-revealed','false');await page.locator('.diagnostics-body').evaluate('(e)=>e.scrollTop=0');await touch(open_button,dy=-70);await asyncio.sleep(.15);assert await page.locator('.diagnostics-body').evaluate('(e)=>e.scrollTop')>0;assert page.url.endswith('?aba=diagnosticos')or'aba=diagnosticos'in page.url
  h.mark(device+': reveal closes on Escape, tab/scenario changes and cancellation; slow/short/vertical gestures do not delete or switch tabs')
  # Current tab swipe preserved away from controls; no wrapping and no vertical hijack.
  async def swipe(selector,dx,dy=0):
   await page.locator(selector).first.evaluate('''(e,d)=>{const t=(x,y)=>new Touch({identifier:1,target:e,clientX:x,clientY:y});e.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[t(180,260)]}));e.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],changedTouches:[t(180+d[0],260+d[1])]}))}''',[dx,dy])
  await main('Chat');await swipe('.detail-page',100);await expect(page.get_by_role('button',name='Chat',exact=True)).to_have_attribute('aria-current','page');await swipe('.detail-page',-100);await expect(page.get_by_role('button',name='Diagnósticos',exact=True)).to_have_attribute('aria-current','page');await swipe('.diagnosis-heading',-100);await expect(page.get_by_role('button',name='Mapa',exact=True)).to_have_attribute('aria-current','page');await swipe('.detail-page',-100);await expect(page.get_by_role('button',name='Mapa',exact=True)).to_have_attribute('aria-current','page');await region();url=page.url;await swipe('.disc-wrap',100);assert page.url==url;await dialog.get_by_role('button',name='Fechar seleção central',exact=True).click();await swipe('.detail-page',100,100);assert page.url==url;await swipe('.detail-page',100);await expect(page.get_by_role('button',name='Diagnósticos',exact=True)).to_have_attribute('aria-current','page')
  h.mark(device+': existing ordered tab swipe has no wrap; ignores vertical, radial dialog and row controls while normal buttons/history continue working')
  # Gesture and desktop trash both use exact same confirmation + global-delete transport.
  await touch(open_button,dx=100);await capo.locator('.swipe-delete').click();await consent.get_by_role('button',name='Prosseguir',exact=True).click();await idle();await expect(capo).to_have_count(0);w=await ws();assert all(ids['capo']not in s['pieceFlags']for s in w['scenarios']);assert not any(c['pieceId']==ids['capo']for c in w['components']);assert writes[-1][0]=='DELETE';await shot('exclusao-confirmada')
  h.mark(device+': explicit revealed action uses official DELETE once, removes master/children in drafts only, and preserves unrelated pieces and issued history')
  # Unchanged editor ergonomics and autosave error recovery, return remains guarded.
  await page.locator('.diagnosis-open').first.click();await expect(editor).to_be_visible()
  await page.get_by_role('button',name='Observação da peça',exact=True).click();field=editor.get_by_role('textbox',name='Observação da peça',exact=True)
  async def fail(route):await route.abort('failed')
  await page.route('**/diagnosticos/*',fail);await field.fill('Fase5 rascunho sintético preservado');await expect(editor.get_by_role('alert')).to_be_visible();h.accept_dialogs=False;url=page.url;await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click();await page.wait_for_timeout(150);await expect(page).to_have_url(url);await expect(field).to_have_value('Fase5 rascunho sintético preservado');await page.unroute('**/diagnosticos/*',fail);h.accept_dialogs=True;await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed');await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click()
  persisted=await ws();await h.restart_api();await page.reload();await h.login(page);await expect(page.locator('.diagnosis-list')).to_be_visible();await idle();assert await ws()==persisted;assert(await get(base+'/orcamentos/'+ids['budget']))['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['budget']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('SELECT MAX(version)FROM schema_migrations').fetchone()[0]==12;assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not db.execute('PRAGMA foreign_key_check').fetchall()
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not h.external and not h.page_errors,(h.external,h.page_errors)
  h.mark(device+': editor layout/fields unchanged, failed autosave draft and guarded back recovered; restart/V10 integrity/FKs/snapshot/PDF stable, no overflow/external calls/JS errors')
 except Exception as error:
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
  h.results.append({'name':device+': failure','pass':False,'error':str(error),'traceback':traceback.format_exc()});raise
 finally:
  (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'synthetic':True,'device':device,'results':h.results,'external':h.external,'pageErrors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
  if ctx:await ctx.close()
  h.cleanup()
async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True)
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  try:
   for device,v in [('desktop',{'width':1440,'height':1000}),('mobile390',{'width':390,'height':844}),('mobile320',{'width':320,'height':844})]:await device_case(browser,device,v)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
