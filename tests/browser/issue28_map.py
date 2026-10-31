"""Issue28: canonical navigation, 23 real pairs, 163 leaves, unchanged masks/recovery; synthetic SQLite only."""
import asyncio,json,csv,subprocess,traceback,hashlib,sqlite3
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/issue28'
REGIONS={'Frente':'frente','Estrutura dianteira':'estrutura-dianteira','Motorista':'motorista','Passageiro':'passageiro','Traseira':'traseira','Estrutura traseira':'estrutura-traseira','Topo':'teto'}

def reference():
 with(ROOT/'docs/referencias/issue28/FUNIX_MATRIZ_163_PROPOSTA.csv').open(encoding='utf-8-sig')as f:rows=list(csv.DictReader(f,delimiter=';'))
 with(ROOT/'docs/referencias/issue28/FUNIX_AMBOS_PROPOSTOS.csv').open(encoding='utf-8-sig')as f:pairs=list(csv.DictReader(f,delimiter=';'))
 for row in rows:
  path=row['caminho_canonico_proposto'].split(' > ')
  if row['codigo'].startswith('coluna_generica__'):path=[row['regiao_proposta'],'Estrutura lateral','Colunas','Coluna (posição não especificada)']
  if row['codigo'].startswith('caixa_roda_generica__'):path=[row['regiao_proposta'],'Caixa de roda','Posição não especificada']
  row['path']=path
 return rows,pairs

async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{performanceCases,performanceFixture}from'./server/tests/fixtures/performance.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=performanceFixture(db,performanceCases[0]),s=f.scenarios.list(f.at.id)[0],other=f.scenarios.create(f.at.id,{name:'Outro cenário QA',duplicateFrom:s.id,sourceRevision:s.revision}),b=new BudgetRepository(db),r={scenarioId:s.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'issue28-frozen-budget'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,version:v.id,snapshot:v.snapshot,other:other.id}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios')
  async def idle():await expect(page.locator('#piece-selection-status')).to_be_empty()
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  async def close():await page.get_by_role('dialog').get_by_role('button',name='Fechar seleção',exact=True).click()
  rows,pairs=reference();expected={r['codigo']:r['path']for r in rows};pair_by_path={tuple(p['grupo'].split(' > ')):p for p in pairs}
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=mapa');await h.login(page);await expect(page.locator('.interactive-map')).to_be_visible()
  catalog=await get('/api/catalogos');before=await ws();piece_code={p['id']:p['code']for p in catalog['items']if p['kind']=='peca'}
  pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert pdf.ok;pdf_hash=hashlib.sha256(await pdf.body()).hexdigest()
  assert await page.locator('.interactive-map [data-region]').count()==7
  assert await page.locator('.map-region-state,.map-region-count circle').count()==0
  assert await page.locator('.interactive-map .map-selection-count').count()==7
  await shot('mapa-regioes')
  async def open_region(label):
   key=REGIONS[label];await page.locator('[data-region="'+key+'"]').click();dialog=page.get_by_role('dialog',name='Selecionar peça no mapa');await expect(dialog.locator('.map-selector-head strong')).to_have_text(label)
   assert await dialog.locator('input').count()==0;assert 'Seleção de peças'not in await dialog.inner_text()
   return dialog
  async def click_path(path):
   dialog=await open_region(path[0])
   for label in path[1:-1]:await dialog.get_by_role('button',name=label,exact=True).click();await expect(dialog.locator('.map-selector-head strong')).to_have_text(label)
   return dialog,dialog.get_by_role('button',name=path[-1],exact=True)
  seen={};selected_pairs=[]
  # Walk every actual rendered menu rather than trusting the static data alone.
  async def traverse(dialog,path):
   buttons=dialog.locator('.map-category-grid>button,.disc-ring>button');names=await buttons.evaluate_all('(bs)=>bs.map(b=>({label:b.getAttribute("aria-label"),kind:b.dataset.nodeKind,code:b.dataset.pieceCode}))')
   # Every rendered radial target remains separate, including the central return control.
   radial=dialog.locator('.disc-ring>button')
   if await radial.count():
    targets=dialog.locator('.disc-ring>button,.disc-center')
    boxes=await targets.evaluate_all('(bs)=>bs.map(b=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,label:b.getAttribute("aria-label")}})')
    for a in boxes:assert a['width']>=44 and a['height']>=44 and a['x']>=0 and a['right']<=viewport['width'],a
    for i,a in enumerate(boxes):
     for b in boxes[i+1:]:assert min(a['right'],b['right'])-max(a['x'],b['x'])<=.5 or min(a['bottom'],b['bottom'])-max(a['y'],b['y'])<=.5,(path,a,b)
   for entry in names:
    b=dialog.get_by_role('button',name=entry['label'],exact=True)
    if entry['kind']=='peca':
     assert entry['code']not in seen,(entry,path);seen[entry['code']]=path+[entry['label']];await expect(b).to_be_enabled()
    elif entry['kind']=='acao_ambos':
     pair=pair_by_path[tuple(path)];await b.click();await idle();await expect(b).to_have_attribute('aria-pressed','true');selected_pairs.append(pair)
     w=await ws();active=next(s for s in w['scenarios']if s['id']==w['selectedId'])
     for code in [pair['codigo_1'],pair['codigo_2']]:
      matches=[p for p in w['items']if piece_code[p['pieceId']]==code];assert len(matches)==1 and active['pieceFlags'][matches[0]['id']]
     if path==['Frente','Iluminação dianteira','Farol']:await shot('frente-ambos')
     if path==['Motorista','Roda']:await shot('motorista-posicoes')
     if path==['Passageiro','Caixa de roda']:await shot('passageiro-caixa-posicoes')
    else:
     await b.click();await expect(dialog.locator('.map-selector-head strong')).to_have_text(entry['label']);await traverse(dialog,path+[entry['label']]);await dialog.get_by_role('button',name='Voltar ao nível anterior',exact=True).click();await expect(dialog.locator('.map-selector-head strong')).to_have_text(path[-1])
  for region in REGIONS:
   dialog=await open_region(region)
   assert await dialog.get_by_role('button',name='Ver mais opções',exact=True).count()==0
   if region in ['Motorista','Passageiro']:
    nodes=dialog.locator('.map-category-grid>button');await expect(nodes).to_have_count(13)
    boxes=await nodes.evaluate_all('(bs)=>bs.map(b=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}})')
    for a in boxes:assert a['width']>=44 and a['height']>=44 and a['x']>=0 and a['right']<=viewport['width']
    for i,a in enumerate(boxes):
     for b in boxes[i+1:]:assert min(a['right'],b['right'])-max(a['x'],b['x'])<=.5 or min(a['bottom'],b['bottom'])-max(a['y'],b['y'])<=.5,(a,b)
    await nodes.last.scroll_into_view_if_needed();await expect(nodes.last).to_be_in_viewport();await nodes.first.scroll_into_view_if_needed();await shot(region.lower()+'-13-categorias')
   if region=='Estrutura dianteira'and device!='mobile320':await shot('estrutura-dianteira')
   await traverse(dialog,[region]);await close()
  assert seen==expected,(len(seen),set(expected)-set(seen));assert len(selected_pairs)==23
  h.mark(device+': 163/163 real rendered canonical paths match audited matrix plus D01/D02; all 23 Ambos actions save exact pairs through real API with no duplicates')
  h.mark(device+': seven distinct SVG hit areas, no state circles/search/redundant title; roots have no pagination; thirteen lateral targets >=44px remain accessible without overlap or hidden categories')
  # Provisional code is still the original catalog identity and name.
  generic=next(r for r in rows if r['codigo']=='coluna_generica__motorista');dialog,b=await click_path(generic['path']);await b.click();await idle()
  if device!='desktop':await shot('coluna-posicao-nao-especificada')
  await close();w=await ws();actual=next(p for p in w['items']if piece_code[p['pieceId']]==generic['codigo']);assert actual['pieceId']=='v2:'+generic['codigo']
  assert next(p for p in catalog['items']if p['id']==actual['pieceId'])['name']!=generic['path'][-1]
  h.mark(device+': provisional column keeps original catalog code/ID/name; unspecified wheel housing remains separate and outside Ambos')
  # Delay one flag acknowledgement and enqueue another piece without layout shifts.
  dialog,b=await click_path(expected['capo']);started=asyncio.Event();release=asyncio.Event()
  async def delay(route):
   if route.request.method=='PATCH':started.set();await release.wait()
   await route.continue_()
  await page.route('**/cenarios/*',delay);old_box=await dialog.locator('.map-category-grid,.disc-wrap').bounding_box();await b.click();await asyncio.wait_for(started.wait(),10)
  await dialog.get_by_role('button',name='Alma do para-choque dianteiro',exact=True).click();await expect(b).to_be_enabled()
  await expect(page.locator('#piece-selection-status')).to_have_text('Salvando seleções…');status_box=await page.locator('#piece-selection-status').bounding_box();assert status_box['width']<=1 and status_box['height']<=1
  pending_box=await dialog.locator('.map-category-grid,.disc-wrap').bounding_box();assert abs(old_box['y']-pending_box['y'])<1 and old_box['height']==pending_box['height']
  if device=='mobile390':await shot('selecao-pendente-sem-deslocamento')
  release.set();await idle();await page.unroute('**/cenarios/*',delay)
  w=await ws();capo=next(p for p in w['items']if piece_code[p['pieceId']]=='capo');active=w['scenarios'][0];other=next(s for s in w['scenarios']if s['id']==ids['other'])
  assert not active['pieceFlags'][capo['id']]and other['pieceFlags'][capo['id']]
  assert capo['services']==before['items'][0]['services']
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:
   assert db.execute('SELECT enabled FROM scenario_piece_flags WHERE scenario_id=? AND piece_id=?',(active['id'],capo['id'])).fetchone()==(0,)
   assert db.execute('SELECT COUNT(*) FROM diagnosis_items WHERE atendimento_id=? AND piece_id=?',(ids['at'],capo['pieceId'])).fetchone()==(1,)
  h.mark(device+': delayed consecutive selections remain interactive and do not move dialog; deselection still changes active mask only, preserves shared piece/children and other scenario, confirmed by independent SQLite read')
  # A real failed flag remains visible, explicit recovery uses existing queue behavior.
  async def fail(route):
   if route.request.method=='PATCH':await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'code':'QA_FAILURE','message':'Falha QA controlada'}}))
   else:await route.continue_()
  await page.route('**/cenarios/*',fail);await b.click();await expect(dialog.get_by_role('alert')).to_be_visible()
  if device=='mobile390':await shot('erro-recuperavel')
  await page.unroute('**/cenarios/*',fail);await dialog.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await idle();await expect(b).to_have_attribute('aria-pressed','true')
  await close();assert not await page.locator('dialog[open]').count()
  catalog_after=await get('/api/catalogos');assert catalog_after==catalog
  final=await ws();assert len(final['items'])==len({p['pieceId']for p in final['items']})
  assert (await get(base+'/orcamentos/'+ids['version']))['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  assert not h.external and not h.page_errors,(h.external,h.page_errors)
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  h.mark(device+': real HTTP failure still exposes recovery; existing queue resumes; catalog metadata, IDs, issued snapshot/PDF and external-call boundary unchanged')
  # Keyboard opening, contained focus, Escape and opener restoration.
  opener=page.locator('[data-region="motorista"]');await opener.focus();await page.keyboard.press('Enter');await expect(page.get_by_role('dialog')).to_be_visible();await page.keyboard.press('Tab');assert await page.evaluate('!!document.activeElement.closest("dialog[open]")')
  await page.keyboard.press('Escape');await expect(page.get_by_role('dialog')).not_to_be_visible();await expect(opener).to_be_focused()
  h.mark(device+': keyboard activation, dialog focus containment, Escape and return to the SVG region remain functional')
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
