"""Fase 1: real local API/SQLite, synthetic data, no external services."""
import asyncio,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/fase1'
async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{ComponentRepository}from'./server/components.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db),parts=new ComponentRepository(db),b=new BudgetRepository(db);const diagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'QA dano SINTETICO'});const capo=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,notes:'QA preservar notas',diagnosisId:diagnosis.id,services:f.item.services});const gradeId=f.commercial.catalogs().items.find(c=>c.code==='grade_dianteira').id;const grade=f.commercial.add(f.at.id,{pieceCodes:['grade_dianteira']}).find(p=>p.pieceId===gradeId);f.commercial.updateDiagnosis(f.at.id,grade.id,{revision:grade.revision,services:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'0.5'}]});const part=parts.save(f.at.id,{pieceId:capo.id,name:'QA componente',quantity:'0.25',manualPrice:'10',notes:'QA preservar componente'});let scene=f.scenarios.list(f.at.id)[0];const req={scenarioId:scene.id,negotiation:{mode:'none'}},preview=b.preview(f.at.id,req),budget=b.emit(f.at.id,{...req,previewToken:preview.token,idempotencyKey:'fase1-frozen-0000000000000000'});const two=f.scenarios.create(f.at.id,{name:'second',duplicateFrom:scene.id,sourceRevision:scene.revision});f.scenarios.update(f.at.id,scene.id,{revision:scene.revision,pieceFlags:{[grade.id]:false}});f.scenarios.update(f.at.id,two.id,{revision:two.revision,pieceFlags:{[capo.id]:false}});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,capo:capo.id,grade:grade.id,part:part.id,one:scene.id,two:two.id,budget:budget.id,snapshot:budget.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws(scene=None):return await get(base+'/cenarios?scenarioId='+str(scene or ids['one']))
  async def idle():await expect(page.locator('.scenario-trigger')).to_be_enabled();await expect(page.locator('.form-error')).to_have_count(0)
  def row(name):return page.locator('.diagnosis-row').filter(has=page.locator('.diagnosis-title strong',has_text=name))
  def toggle(name):return row(name).get_by_role('switch')
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  async def switch(number):
   await page.locator('.scenario-trigger').click();await page.get_by_role('menuitemradio',name='Cenário '+str(number),exact=True).click();await idle()
  await page.goto(ORIGIN);await h.login(page);await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await expect(page.locator('.diagnosis-list')).to_be_visible();await idle()
  original=await ws();pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['budget']+'/pdf');pdf_hash=hashlib.sha256(await pdf.body()).hexdigest()
  await expect(page.locator('.diagnosis-row')).to_have_count(2);await expect(toggle('Capô')).to_have_attribute('aria-checked','true');await expect(toggle('Grade dianteira')).to_have_attribute('aria-checked','false')
  for name in ['Capô','Grade dianteira']:
   total=await row(name).locator('.piece-total').bounding_box();trash=await row(name).locator('.piece-delete').bounding_box();assert trash['x']>=total['x']+total['width'] and trash['width']>=32 and trash['height']>=44
  await shot('lista-cenario1');h.mark(device+': original rows retained, only rightmost trash added; two visible masters with inverse scenario flags and accessible controls')
  await switch(2);await expect(toggle('Capô')).to_have_attribute('aria-checked','false');await expect(toggle('Grade dianteira')).to_have_attribute('aria-checked','true');await shot('lista-cenario2');await page.reload();await expect(page.locator('.diagnosis-list')).to_be_visible();await idle()
  assert(await ws(ids['two']))['scenarios'][1]['pieceFlags'][ids['grade']];await switch(1)
  h.mark(device+': scenario switch and reload preserve both masters and independent flags')
  writes=[];listener=lambda r:writes.append((r.method,r.url))if '/api/'in r.url and r.method in ['PATCH','POST','DELETE']else None;page.on('request',listener)
  await toggle('Capô').click();await idle();w=await ws();assert len(w['items'])==2 and not w['scenarios'][0]['pieceFlags'][ids['capo']];assert w['scenarios'][1]==original['scenarios'][1];assert w['components']==original['components'];assert w['items'][0]['services']==original['items'][0]['services']
  await toggle('Capô').click();await idle();page.remove_listener('request',listener);assert all(method=='PATCH'and'/cenarios/'in url for method,url in writes),writes;assert(await ws())['items']==original['items']
  h.mark(device+': list enable/disable sends only scenario PATCH; IDs, diagnosis, notes, services, components and other scenario preserved')
  await row('Capô').locator('.diagnosis-open').click();editor=page.get_by_role('region',name='Editor de diagnóstico');await expect(editor).to_have_attribute('data-save-state','confirmed')
  await editor.get_by_role('button',name='Habilitar serviço neste cenário',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed');await editor.get_by_role('button',name='Habilitar componente neste cenário',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed')
  child_state=await ws();await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click();await toggle('Capô').click();await idle();await toggle('Capô').click();await idle();w=await ws();assert w['scenarios'][0]['serviceFlags']==child_state['scenarios'][0]['serviceFlags'];assert w['scenarios'][0]['componentFlags']==child_state['scenarios'][0]['componentFlags'];assert w['scenarios'][1]==original['scenarios'][1]
  h.mark(device+': parent off/on preserves individual service/component masks and shared content without editor redesign')
  await page.get_by_role('button',name='Mapa',exact=True).click();await page.locator('[data-region="frente"]').first.click();radial=page.get_by_role('dialog',name='Selecionar peça no mapa');await expect(radial.get_by_role('button',name='Capô',exact=True)).to_have_attribute('aria-pressed','true');before_map=await ws();await radial.get_by_role('button',name='Capô',exact=True).click();await expect(page.get_by_role('region',name='Editor de diagnóstico')).to_be_visible();assert await ws()==before_map;await page.get_by_role('button',name='Habilitar peça neste cenário',exact=True).click();await expect(page.get_by_role('region',name='Editor de diagnóstico')).to_have_attribute('data-save-state','confirmed');await page.get_by_role('button',name='Voltar ao Mapa',exact=True).click();await page.locator('[data-region="frente"]').click();await expect(radial.get_by_role('button',name='Capô',exact=True)).to_have_attribute('aria-pressed','false');assert len((await ws())['items'])==2
  await shot('mapa-cenario');await radial.get_by_role('button',name='Grades e entradas de ar',exact=True).click();await radial.get_by_role('button',name='Grade inferior',exact=True).click();await radial.get_by_role('button',name='Ambos',exact=True).click();await idle();first=await ws();assert len(first['items'])==4;stable={p['pieceId']:p['id']for p in first['items']}
  await radial.get_by_role('button',name='Ambos',exact=True).click();await idle();assert len((await ws())['items'])==4;await radial.get_by_role('button',name='Ambos',exact=True).click();await idle();assert{p['pieceId']:p['id']for p in(await ws())['items']}==stable;await shot('ambos-identidades');await page.get_by_role('button',name='Fechar seleção',exact=True).click()
  h.mark(device+': original circular map reflects active scenario; Ambos adds once and subsequent taps are inert, preserving all identities; explicit editor toggle retains scenario-only semantics')
  await page.get_by_role('button',name='Diagnósticos',exact=True).click();await idle();gate=asyncio.Event();patches=[]
  async def delay(route):
   if route.request.method=='PATCH'and'pieceFlags'in(route.request.post_data_json or{}):patches.append(route.request.post_data_json);await gate.wait()
   await route.continue_()
  await page.route('**/cenarios/*',delay);await toggle('Capô').click()
  for _ in range(100):
   if patches:break
   await asyncio.sleep(.02)
  assert patches;await toggle('Capô').click();await toggle('Capô').click();await toggle('Grade dianteira').click();await toggle('Grade dianteira').click();gate.set();await idle();await page.unroute('**/cenarios/*',delay);w=await ws();assert w['scenarios'][0]['pieceFlags'][ids['capo']];assert not w['scenarios'][0]['pieceFlags'][ids['grade']];assert len(w['items'])==4
  h.mark(device+': delayed acknowledgements and rapid toggles retain latest intentions with no accidental delete or duplicate')
  lost=[]
  async def lose_flag(route):
   if route.request.method=='PATCH'and'pieceFlags'in(route.request.post_data_json or{}):lost.append(1);await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**/cenarios/*',lose_flag);await toggle('Capô').click();await expect(page.get_by_role('alert').first).to_be_visible();await page.unroute('**/cenarios/*',lose_flag);await page.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await idle();assert len(lost)==1;assert len((await ws())['items'])==4;await expect(toggle('Capô')).to_have_attribute('aria-checked','false')
  h.mark(device+': lost committed flag response recovers by GET without replay, DELETE or POST')
  concurrent=[]
  async def conflict(route):
   if route.request.method=='PATCH'and not concurrent:
    concurrent.append(1);w=await ws();scene=w['scenarios'][0];r=await ctx.request.patch(ORIGIN+base+'/cenarios/'+ids['one'],headers={'Origin':ORIGIN},data={'revision':scene['revision'],'pieceFlags':{ids['grade']:True}});assert r.ok
   await route.continue_()
  await page.route('**/cenarios/*',conflict);await toggle('Capô').click();await expect(page.get_by_role('alert').first).to_be_visible();await page.unroute('**/cenarios/*',conflict);await page.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await idle();w=await ws();assert w['scenarios'][0]['pieceFlags'][ids['grade']]and w['scenarios'][0]['pieceFlags'][ids['capo']];await shot('recuperacao-concorrencia')
  h.mark(device+': genuine revision conflict blocks unsafe overwrite; explicit refresh preserves unrelated concurrent change and applies latest intention')
  competing=[];same_flag_writes=[]
  flag_listener=lambda r:same_flag_writes.append(r.post_data_json)if r.method=='PATCH'and'/cenarios/'in r.url else None
  async def same_flag_after_ack(route):
   if route.request.method=='GET'and not competing:
    competing.append(1);w=await ws();scene=w['scenarios'][0];r=await ctx.request.patch(ORIGIN+base+'/cenarios/'+ids['one'],headers={'Origin':ORIGIN},data={'revision':scene['revision'],'pieceFlags':{ids['capo']:True}});assert r.ok
   await route.continue_()
  page.on('request',flag_listener);await page.route('**/cenarios?*',same_flag_after_ack);await toggle('Capô').click();await expect(page.get_by_role('alert').first).to_be_visible();assert len(same_flag_writes)==1;assert(await ws())['scenarios'][0]['pieceFlags'][ids['capo']];await page.unroute('**/cenarios?*',same_flag_after_ack);await page.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await idle();page.remove_listener('request',flag_listener);assert len(same_flag_writes)==2;assert not(await ws())['scenarios'][0]['pieceFlags'][ids['capo']]
  h.mark(device+': another writer after PATCH ACK is detected on GET; no silent overwrite before explicit read-first recovery')
  before=await ws();requests=[];record=lambda r:requests.append(r.url)if '/api/'in r.url else None;page.on('request',record)
  await row('Capô').locator('.piece-delete').click();dialog=page.get_by_role('dialog',name='Confirmar remoção da composição');await expect(dialog).to_contain_text('todos os cenários');await shot('exclusao-confirmada');await dialog.get_by_role('button',name='Cancelar',exact=True).click();page.remove_listener('request',record);assert not requests;assert await ws()==before
  h.mark(device+': explicit trash reuses compact confirmation; Cancel sends zero requests and changes no state')
  deletes=[]
  async def lose_delete(route):
   if route.request.method=='DELETE':deletes.append(1);await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**/diagnosticos',lose_delete);await row('Capô').locator('.piece-delete').click();await dialog.get_by_role('button',name='Prosseguir',exact=True).click();await expect(page.get_by_role('alert').first).to_be_visible();await page.unroute('**/diagnosticos',lose_delete);await page.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await idle();w=await ws();assert len(deletes)==1 and len(w['items'])==3;assert all(ids['capo']not in s['pieceFlags']for s in w['scenarios']);assert all(c['pieceId']!=ids['capo']for c in w['components']);await expect(row('Capô')).to_have_count(0)
  h.mark(device+': only confirmed trash deletes shared piece/children; lost DELETE response reconciles once across both scenarios')
  catalog=(await get('/api/catalogos'))['items'];blank=next(c['name']for c in catalog if c['code']=='grade_inferior__motorista').replace(' · ',' ');await toggle(blank).click();await idle();await row(blank).locator('.piece-delete').click();await expect(dialog).to_be_visible();await expect(dialog).to_contain_text('todos os cenários');await dialog.get_by_role('button',name='Cancelar',exact=True).click();await expect(row(blank)).to_be_visible()
  h.mark(device+': even a blank disabled piece requires explicit confirmation for global deletion')
  persisted=await ws();await h.restart_api();await page.reload();await h.login(page);await expect(page.locator('.diagnosis-list')).to_be_visible();await idle();assert await ws()==persisted;assert(await get(base+'/orcamentos/'+ids['budget']))['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['budget']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
  assert not h.page_errors and not h.external,(h.page_errors,h.external);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');await shot('persistencia-historico');h.mark(device+': restart/reload persistence, SQLite integrity/FKs and immutable issued snapshot/PDF verified; no overflow, external requests or page errors')
 except Exception as error:
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
  h.results.append({'name':device+': failure','pass':False,'error':str(error),'traceback':traceback.format_exc()});raise
 finally:
  (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'device':device,'synthetic':True,'results':h.results,'external':h.external,'pageErrors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
  if ctx:await ctx.close()
  h.cleanup()
async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True)
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  try:
   for device,v in [('desktop',{'width':1440,'height':1000}),('mobile390',{'width':390,'height':844}),('mobile320',{'width':320,'height':568})]:await device_case(browser,device,v)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
