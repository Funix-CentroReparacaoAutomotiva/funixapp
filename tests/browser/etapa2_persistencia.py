"""Issue31 Stage2: real local API, temporary SQLite, synthetic data, desktop/390/320."""
import asyncio,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/etapa2'
async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 h.check_ports()
 try:
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{ComponentRepository}from'./server/components.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db),parts=new ComponentRepository(db),b=new BudgetRepository(db);const part=parts.save(f.at.id,{pieceId:f.item.id,name:'QA componente SINTETICO',quantity:'0.125',manualPrice:'10',notes:''});const initial=f.scenarios.list(f.at.id)[0],r={scenarioId:initial.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'stage2-browser-frozen'});const blank=f.commercial.catalogs().items.filter(p=>p.kind==='peca'&&p.code&&p.code!=='capo').slice(0,4);for(const p of blank)f.commercial.add(f.at.id,{pieceCodes:[p.code]});const s=f.scenarios.list(f.at.id)[0],two=f.scenarios.create(f.at.id,{name:'two'});f.scenarios.remove(f.at.id,two.id,{revision:two.revision});const three=f.scenarios.create(f.at.id,{name:'three',duplicateFrom:s.id,sourceRevision:s.revision});f.scenarios.update(f.at.id,three.id,{revision:three.revision,pieceFlags:Object.fromEntries(f.commercial.list(f.at.id).filter(p=>p.id!==f.item.id).map(p=>[p.id,false]))});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,piece:f.item.id,part:part.id,blank:blank.map(p=>({code:p.code,name:p.name})),version:v.id,snapshot:v.snapshot,capoName:f.commercial.item(f.item.pieceId).name}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios')
  async def idle():await expect(page.locator('.scenario-trigger')).to_be_enabled();await expect(page.locator('.form-error')).to_have_count(0)
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  def toggle(name):return page.get_by_role('switch',name='Selecionar peça '+name+' na composição compartilhada',exact=True)
  await page.goto(ORIGIN);await h.login(page);await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await expect(page.locator('.diagnosis-list')).to_be_visible();await idle()
  original=await ws();pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');pdf_hash=hashlib.sha256(await pdf.body()).hexdigest()
  # Editor enablement remains scenario-specific; selector presence remains global.
  await page.locator('.diagnosis-open').filter(has_text='Capô').click();editor=page.get_by_role('region',name='Editor de diagnóstico');await expect(editor).to_have_attribute('data-save-state','confirmed')
  await expect(page.get_by_role('button',name='Excluir peça de todos os cenários',exact=True)).to_have_count(0)
  await editor.get_by_role('button',name='Habilitar peça neste cenário',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed');w=await ws();assert not w['scenarios'][0]['pieceFlags'][ids['piece']]and w['scenarios'][1]['pieceFlags'][ids['piece']]
  await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click();await expect(toggle(ids['capoName'])).to_have_attribute('aria-checked','true')
  await page.locator('.diagnosis-open').filter(has_text='Capô').click();await editor.get_by_role('button',name='Habilitar peça neste cenário',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed');await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click()
  h.mark(device+': editor changes scenario flags only; disabled master stays globally selected; confirmed back has no discard dialog; redundant global trash absent')
  # Cancel must not even send a GET; exact persisted snapshot is unchanged.
  requests=[];record=lambda r:requests.append((r.method,r.url))if '/api/'in r.url else None;before=await ws();page.on('request',record)
  await toggle(ids['capoName']).click();dialog=page.get_by_role('dialog',name='Confirmar remoção da composição');await expect(dialog).to_contain_text('1, 3');await expect(dialog).to_contain_text('conteúdo');await shot('confirmacao-global');await dialog.get_by_role('button',name='Cancelar',exact=True).click();await page.wait_for_timeout(100);page.remove_listener('request',record);assert requests==[],requests;assert await ws()==before;await expect(toggle(ids['capoName'])).to_have_attribute('aria-checked','true')
  h.mark(device+': compact confirmation lists actual scenario positions 1 and 3 and configured content; Cancel sends zero requests and changes no identities/revisions/flags')
  # Four empty masters can be removed consecutively; no layout-changing normal status.
  gate=asyncio.Event();deletes=[]
  async def delayed(route):
   if route.request.method!='DELETE':await route.continue_();return
   deletes.append(route.request.post_data_json);await gate.wait();await route.continue_()
  await page.route('**/diagnosticos',delayed)
  for p in ids['blank']:await toggle(p['name']).click()
  status_box=await page.locator('#piece-selection-status').bounding_box();assert status_box['width']<=1 and status_box['height']<=1;gate.set();await idle();await expect(page.locator('.diagnosis-row')).to_have_count(1);await page.unroute('**/diagnosticos',delayed)
  assert len(deletes)<=3,len(deletes);w=await ws();assert len(w['items'])==1 and w['items'][0]['services']==original['items'][0]['services'];assert w['components']==original['components']
  h.mark(device+': four consecutive global removals serialize without blocking other toggles; remaining IDs/services/fractional components preserved; routine status outside layout')
  # Concurrent component edit after dialog opens must invalidate deletion even if piece revision is unchanged.
  await toggle(ids['capoName']).click();await expect(dialog).to_be_visible();w=await ws();part=w['components'][0];r=await ctx.request.patch(ORIGIN+base+'/componentes/'+part['id'],headers={'Origin':ORIGIN},data={**{k:part[k]for k in ['revision','pieceId','quantity','manualPrice','notes']},'name':'QA editado durante confirmacao'});assert r.ok,await r.text()
  await dialog.get_by_role('button',name='Prosseguir',exact=True).click();await expect(page.get_by_role('alert').first).to_be_visible();assert len((await ws())['items'])==1
  await page.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await expect(dialog).to_be_visible();await dialog.get_by_role('button',name='Cancelar',exact=True).click();await idle();assert(await ws())['components'][0]['name']=='QA editado durante confirmacao';await shot('recuperacao-conflito')
  h.mark(device+': changed component invalidates confirmed removal transaction; explicit refresh reconfirms changed scope; cancellation retains concurrent content')
  # The delete is committed, but the response is lost. Recovery must read, never repeat DELETE.
  lost=[]
  async def lose(route):
   if route.request.method=='DELETE':lost.append(route.request.post_data_json);await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**/diagnosticos',lose);await toggle(ids['capoName']).click();await dialog.get_by_role('button',name='Prosseguir',exact=True).click();await expect(page.get_by_role('alert').first).to_be_visible();assert(await ws())['items']==[];assert(await ws())['components']==[];await page.unroute('**/diagnosticos',lose);await page.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await idle();assert len(lost)==1;await expect(page.locator('.diagnosis-row')).to_have_count(0)
  h.mark(device+': lost committed DELETE reconciles absence without replay; configured children and all draft scenario flags removed only after consent')
  # Unified picker still works, creates one fresh identity; 503 before delete preserves it until explicit retry.
  async def add_capo():
   await page.get_by_role('button',name='+ Adicionar peça',exact=True).click();picker=page.get_by_role('region',name='Selecionar peça');await picker.get_by_role('textbox').fill('capo');await picker.locator('.piece-options button').first.click();await idle();await page.get_by_role('button',name='Fechar seleção',exact=True).click();await expect(toggle(ids['capoName'])).to_be_visible()
  await add_capo();w=await ws();new_id=w['items'][0]['id'];assert new_id!=ids['piece'];assert w['items'][0]['services']==[];assert len(w['items'])==1
  async def fail(route):
   if route.request.method=='DELETE':await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'message':'QA transporte indisponivel'}}))
   else:await route.continue_()
  await page.route('**/diagnosticos',fail);await toggle(ids['capoName']).click();await expect(page.get_by_role('alert').first).to_be_visible();assert(await ws())['items'][0]['id']==new_id;await page.unroute('**/diagnosticos',fail);await page.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await idle();assert(await ws())['items']==[];await add_capo();before_restart=await ws();await h.restart_api();await page.reload();await h.login(page);await expect(page.locator('.diagnosis-list')).to_be_visible();assert await ws()==before_restart
  version=await get(base+'/orcamentos/'+ids['version']);assert version['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:
   assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('PRAGMA foreign_key_check').fetchall()==[];assert db.execute('SELECT COUNT(*) FROM diagnosis_items').fetchone()[0]==1
  assert not h.external and not h.page_errors,(h.external,h.page_errors);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');await shot('persistido-apos-reinicio')
  h.mark(device+': 503 recovery and re-add use stable unique current identity; SQLite survives restart; immutable budget/PDF and remaining scenarios intact; no external calls or page errors')
  # The existing radial uses global presence too. Ambos operates on its two real codes atomically.
  w=await ws();scene=w['scenarios'][0];r=await ctx.request.patch(ORIGIN+base+'/cenarios/'+scene['id'],headers={'Origin':ORIGIN},data={'revision':scene['revision'],'pieceFlags':{w['items'][0]['id']:False}});assert r.ok
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=mapa');await expect(page.locator('.interactive-map')).to_be_visible();await page.locator('[data-region="frente"]').first.click();radial=page.get_by_role('dialog',name='Selecionar peça no mapa');await expect(radial.get_by_role('button',name='Capô',exact=True)).to_have_attribute('aria-pressed','true');await radial.get_by_role('button',name='Capô',exact=True).click();await idle();assert(await ws())['items']==[]
  await radial.get_by_role('button',name='Grades e entradas de ar',exact=True).click();await radial.get_by_role('button',name='Grade inferior',exact=True).click();await radial.get_by_role('button',name='Ambos',exact=True).click();await idle();await expect(radial.get_by_role('button',name='Ambos',exact=True)).to_have_attribute('aria-pressed','true');await shot('radial-ambos-preservado')
  w=await ws();catalog=(await get('/api/catalogos'))['items'];codes={next(c['code']for c in catalog if c['id']==p['pieceId'])for p in w['items']};assert codes=={'grade_inferior__motorista','grade_inferior__passageiro'}
  await radial.get_by_role('button',name='Ambos',exact=True).click();await idle();assert(await ws())['items']==[];assert(await get(base+'/orcamentos/'+ids['version']))['snapshot']==ids['snapshot'];assert await radial.locator('.disc-ring').count()==1
  h.mark(device+': existing circular map is unchanged; disabled master still selected globally; real Ambos adds/removes exactly two codes with no duplicates and preserves issued history')

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
   for device,viewport in [('desktop',{'width':1440,'height':1000}),('mobile390',{'width':390,'height':844}),('mobile320',{'width':320,'height':568})]:await device_case(browser,device,viewport)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
