"""Issue31 Etapa4: canonical map, all pairs and measured radial targets. Synthetic local DB only."""
import asyncio,json,subprocess,traceback,hashlib,sqlite3
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/etapa4'
async def device_case(browser,device,viewport):
 h=Harness();h.check_ports();ctx=None;page=None;geometry=[];pairs=[];visible_codes=[]
 try:
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{BudgetRepository}from'./server/budgets.ts';import{mapTree,mapSpecification}from'./src/map-navigation.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db),b=new BudgetRepository(db),r={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'stage4-immutable-budget'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,tree:mapTree(f.commercial.catalogs().items),pairs:mapSpecification.pairs,version:v.id,snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop');await h.watch(ctx);page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN);await h.login(page);await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=mapa');await expect(page.locator('.interactive-map')).to_be_visible()
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios')
  async def idle():await expect(page.locator('#piece-selection-status')).to_be_empty()
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  dialog=page.get_by_role('dialog',name='Selecionar peça no mapa');before=await ws();pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');pdf_hash=hashlib.sha256(await pdf.body()).hexdigest()
  assert await page.locator('.interactive-map [data-region]').count()==7;assert await page.locator('.map-region-state,.map-region-count circle').count()==0;assert await page.locator('tspan.map-region-count').count()==7;await shot('carro-contagens')
  async def open_region(root):await page.locator('[data-region="'+root['id']+'"]').click();await expect(dialog).to_be_visible()
  async def back():await dialog.get_by_role('button',name='Voltar ao nível anterior',exact=True).click()
  async def verify(node,path):
   expected=node['itens'];await expect(dialog.locator('.disc-node')).to_have_count(len(expected));assert await dialog.locator('.disc-node').evaluate_all('(es)=>es.map(e=>e.dataset.nodeId)')==[c['id']for c in expected];assert await dialog.locator('.disc-node:disabled').count()==0;visible_codes.extend(c['codigo_peca']for c in expected if c['tipo']=='peca');assert await dialog.get_by_role('textbox').count()==0;assert 'Seleção de peças'not in await dialog.inner_text();assert await dialog.locator('.disc-more').count()==0
   measure=await dialog.evaluate('''d=>{const ring=d.querySelector('.disc-ring'),b=ring.getBoundingClientRect();const controls=[...d.querySelectorAll('.disc-node,.disc-center')];return{circle:{width:b.width,height:b.height,radius:getComputedStyle(ring).borderRadius},buttons:controls.map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.nodeId||'center',text:e.innerText,x:r.x,y:r.y,width:r.width,height:r.height,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,font:getComputedStyle(e).fontSize}})}}''')
   assert abs(measure['circle']['width']-measure['circle']['height'])<1,measure
   for b in measure['buttons']:
    assert b['width']>=44 and b['height']>=44,(path,b)
    assert b['x']>=-1 and b['x']+b['width']<=viewport['width']+1,(path,b)
    assert b['scrollWidth']<=b['clientWidth']+1 and b['scrollHeight']<=b['clientHeight']+1,('label overflow',path,b)
   for i,a in enumerate(measure['buttons']):
    for b in measure['buttons'][i+1:]:assert not(min(a['x']+a['width'],b['x']+b['width'])-max(a['x'],b['x'])>0.05 and min(a['y']+a['height'],b['y']+b['height'])-max(a['y'],b['y'])>0.05),('collision',path,a,b)
   geometry.append({'path':path,'measure':measure})
   if len(path)==1:await shot(node['id']+'-primeiro-nivel')
   for child in expected:
    if child['tipo']in ['grupo','grupo_lados']:
     await dialog.locator('[data-node-id="'+child['id']+'"]').click();await verify(child,path+[child['nome']]);await back()
  for root in ids['tree']:
   await open_region(root);await verify(root,[root['nome']]);await dialog.get_by_role('button',name='Fechar seleção',exact=True).click()
  assert len(visible_codes)==163 and len(set(visible_codes))==163
  h.mark(device+': every canonical layer stays circular; 13 lateral entries direct, no pagination/search/redundant title; measured labels, >=44px targets and zero collisions')
  # Each pair changes active-scenario flags; shared identities are retained.
  for index,pair in enumerate(ids['pairs']):
   root=next(r for r in ids['tree']if r['nome']==pair['path'][0]);await open_region(root)
   for name in pair['path'][1:]:await dialog.get_by_role('button',name=name,exact=True).click()
   buttons=dialog.locator('.disc-node');ambos=dialog.get_by_role('button',name='Ambos',exact=True);await expect(ambos).to_be_enabled();positions={}
   for name in ['Ambos','Motorista','Passageiro','Dianteiro','Traseiro']:
    button=dialog.get_by_role('button',name=name,exact=True)
    if await button.count():positions[name]=await button.bounding_box()
   if pair['axis']=='Lado':assert positions['Ambos']['y']<positions['Motorista']['y']and positions['Motorista']['x']<positions['Passageiro']['x']
   else:assert positions['Dianteiro']['y']<positions['Ambos']['y']<positions['Traseiro']['y']and (positions['Ambos']['x']>positions['Dianteiro']['x']if root['id']=='motorista'else positions['Ambos']['x']<positions['Dianteiro']['x'])
   old=await ws();old_ids={p['id']for p in old['items']};await ambos.click();await idle();new=await ws();catalog=await get('/api/catalogos');code_by_id={p['id']:p['code']for p in catalog['items']};selected=[p for p in new['items']if code_by_id[p['pieceId']]in pair['codes']];assert sorted(code_by_id[p['pieceId']]for p in selected)==sorted(pair['codes']);assert all(new['scenarios'][0]['pieceFlags'][p['id']]for p in selected)
   assert len({p['pieceId']for p in new['items']})==len(new['items'])
   if index in [0,15,19]:await shot('ambos-'+str(index))
   await ambos.click();await idle();disabled=await ws();assert {p['id']for p in disabled['items']}=={p['id']for p in new['items']};assert all(not disabled['scenarios'][0]['pieceFlags'][p['id']]for p in selected);assert all(disabled['scenarios'][0]['pieceFlags'][p['id']]==old['scenarios'][0]['pieceFlags'][p['id']]for p in old['items']if code_by_id[p['pieceId']]not in pair['codes']);pairs.append({'path':pair['path'],'codes':pair['codes'],'geometry':positions,'pass':True})
   await dialog.get_by_role('button',name='Fechar seleção',exact=True).click()
  h.mark(device+': all 23 exact pairs (15 side and 8 axle) enable/disable precisely two real identities without removing shared masters; direction geometry, uniqueness and other pieces preserved')
  # Real content removal still needs consent; Cancel has no API calls. Existing Capo fixture is protected.
  await page.get_by_role('button',name='Diagnósticos',exact=True).click();await page.locator('.diagnosis-row').filter(has=page.locator('.diagnosis-title strong',has_text='Capô')).locator('.piece-delete').click();confirm=page.get_by_role('dialog',name='Confirmar remoção da composição');await expect(confirm).to_be_visible();requests=[];record=lambda r:requests.append(r.url)if'/api/'in r.url else None;page.on('request',record);await confirm.get_by_role('button',name='Cancelar',exact=True).click();await page.wait_for_timeout(100);page.remove_listener('request',record);assert requests==[];assert any(p['id']==before['items'][0]['id']for p in(await ws())['items']);await shot('confirmacao-preservada');await page.get_by_role('button',name='Mapa',exact=True).click()
  # Keyboard open, containment, Escape and region focus restore.
  opener=page.locator('[data-region="motorista"]');await opener.focus();await page.keyboard.press('Enter');await expect(dialog).to_be_visible();await expect(dialog.locator('.disc-center')).to_be_focused();close=dialog.get_by_role('button',name='Fechar seleção',exact=True);await close.focus();await page.keyboard.press('Shift+Tab');assert await dialog.evaluate('(d)=>d.contains(document.activeElement)');await page.keyboard.press('Escape');await expect(dialog).to_have_count(0);await expect(opener).to_be_focused()
  assert(await get(base+'/orcamentos/'+ids['version']))['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
  assert not h.external and not h.page_errors,(h.external,h.page_errors)
  h.mark(device+': configured global removal confirmation/Cancel, keyboard, focus, Escape, immutable snapshot/PDF and SQLite integrity preserved; no external calls/page errors')
 except Exception as error:
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
  h.results.append({'name':device+': failure','pass':False,'error':str(error),'traceback':traceback.format_exc()});raise
 finally:
  (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'device':device,'synthetic':True,'results':h.results,'geometry':geometry,'visibleCodes':visible_codes,'pairs':pairs,'external':h.external,'pageErrors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
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
