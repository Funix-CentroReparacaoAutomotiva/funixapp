"""Etapa C: real API/file SQLite, synthetic records, delayed/failed responses and touch viewports."""
import asyncio,json,subprocess,traceback,sqlite3,hashlib
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
from issue28_map import reference
ARTIFACTS=ROOT/'docs/evidencias/etapa-c'

async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{performanceCases,performanceFixture}from'./server/tests/fixtures/performance.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=performanceFixture(db,performanceCases[1]),b=new BudgetRepository(db),r={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'etapa-c-snapshot'});for(const s of f.scenarios.list(f.at.id))f.scenarios.update(f.at.id,s.id,{revision:s.revision,pieceFlags:Object.fromEntries(f.commercial.list(f.at.id).map(p=>[p.id,false]))});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,version:v.id,snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api()
  vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,(r.status,path);return await r.json()
  async def ws():return await get(base+'/cenarios')
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  async def idle():await expect(page.locator('#piece-selection-status')).to_be_empty()
  async def main(tab):await page.get_by_role('navigation',name='Visões do Atendimento').get_by_role('button',name=tab,exact=True).click()
  async def settled_flags(expected):
   await idle();w=await ws();s=w['scenarios'][0]
   for id,on in expected.items():assert bool(s['pieceFlags'].get(id))==on
   # Independent file read, not merely the rendered state or workspace response.
   with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:
    rows=db.execute('SELECT piece_id,enabled FROM scenario_piece_flags WHERE scenario_id=?',(s['id'],)).fetchall()
    stored=dict(rows)
    for id,on in expected.items():assert bool(stored.get(id))==on
   return w
  await page.goto(ORIGIN+'/funil');await h.login(page);await page.locator('.fh-card').first.click();await main('Diagnósticos')
  await expect(page.locator('.diagnosis-row')).to_have_count(20)
  initial=await ws();initial_components=initial['components'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert pdf.ok;pdf_hash=hashlib.sha256(await pdf.body()).hexdigest();old_services={p['id']:p['services']for p in initial['items']};others=[s['pieceFlags']for s in initial['scenarios'][1:]];item_ids=[p['id']for p in initial['items'][:4]]
  switches=page.locator('.diagnosis-row').get_by_role('switch')
  # Gate every PATCH before delivery; all taps below occur before first acknowledgement.
  entered=asyncio.Event();release=asyncio.Event();requests=[]
  async def delayed(route):
   if route.request.method=='PATCH':requests.append(route.request.post_data_json);entered.set();await release.wait()
   await route.continue_()
  await page.route('**/cenarios/*',delayed)
  await switches.nth(0).click();await entered.wait()
  for i in [1,2,3,0,1,1]:await switches.nth(i).click()
  for i,on in enumerate([False,True,True,True]):await expect(switches.nth(i)).to_have_attribute('aria-checked',str(on).lower())
  await expect(page.locator('#piece-selection-status')).to_have_text('Salvando seleções…');pending_url=page.url;await page.evaluate('history.back()');await page.wait_for_timeout(120);await expect(page).to_have_url(pending_url);await shot('selecoes-pendentes')
  release.set();w=await settled_flags(dict(zip(item_ids,[False,True,True,True])))
  await page.unroute('**/cenarios/*',delayed)
  assert len(requests)==2,len(requests);assert [s['pieceFlags']for s in w['scenarios'][1:]]==others
  assert {p['id']:p['services']for p in w['items']}==old_services
  h.mark(device+': four rapid pieces, reversals and interleaving stay interactive; last intentions match file SQLite, two serial PATCHes, other scenarios/services unchanged')
  # Keyboard remains usable; no success toast per change.
  await switches.nth(0).focus();await page.keyboard.press('Space');await settled_flags({item_ids[0]:True})
  assert await page.locator('.at-save-success').count()==0;await shot('toggles-confirmados')
  h.mark(device+': accessible switches support keyboard and do not emit repetitive green confirmations')
  # HTTP before write, then lost response after committed PATCH. Recovery always reads first.
  for fault in ['http','lost-patch']:
   before=await ws();id=item_ids[0];desired=not before['scenarios'][0]['pieceFlags'][id];writes=[]
   async def broken(route):
    if route.request.method!='PATCH':await route.continue_();return
    writes.append(route.request.post_data_json)
    if fault=='http':await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':'QA indisponível'}))
    else:await route.fetch();await route.abort('failed')
   await page.route('**/cenarios/*',broken);await switches.nth(0).click();await expect(page.get_by_role('alert')).to_be_visible()
   await expect(switches.nth(1)).to_be_disabled();await expect(switches.nth(0)).to_have_attribute('aria-checked',str(desired).lower());await shot(fault)
   actual=await ws();assert bool(actual['scenarios'][0]['pieceFlags'].get(id))==(not desired if fault=='http'else desired)
   await page.unroute('**/cenarios/*',broken);await page.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await settled_flags({id:desired})
   assert len(writes)==1
   h.mark(device+': '+fault+' blocks uncertain writes; explicit recovery reconciles actual persisted state without losing intention or duplicate records')
  # Picker has functional groups and retains search. Both APIs share exact catalog IDs.
  catalog_response=await get('/api/catalogos');catalog=catalog_response['items'];await page.get_by_role('button',name='+ Adicionar peça',exact=True).click()
  picker=page.get_by_role('region',name='Selecionar peça');await expect(picker.get_by_role('button',name='Lataria',exact=True)).to_have_attribute('data-selection-state','partial')
  for group in ['Lataria','Estrutura','Vidros','Acessórios','Interior','Outros']:await expect(picker.get_by_role('button',name=group,exact=True)).to_be_visible()
  await picker.scroll_into_view_if_needed();await shot('classificacao-funcional');await picker.get_by_role('button',name='Acessórios',exact=True).click()
  search=picker.get_by_role('textbox');await search.fill('retrovisor__motorista');await expect(picker.locator('.piece-options button')).to_have_count(1)
  entry=next(c for c in catalog if c.get('code')=='retrovisor__motorista')
  async def lost_post(route):
   if route.request.method=='POST':await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**/diagnosticos',lost_post);await picker.locator('.piece-options button').click();await expect(page.get_by_role('alert')).to_be_visible()
  actual=await ws();created=next(p for p in actual['items']if p['pieceId']==entry['id']);await page.unroute('**/diagnosticos',lost_post)
  await page.get_by_role('button',name='Atualizar dados e retomar seleções',exact=True).click();await idle()
  assert sum(p['pieceId']==entry['id']for p in(await ws())['items'])==1
  h.mark(device+': functional classification and unified search use original identities; lost committed POST recovered with one master row')
  await page.get_by_role('button',name='Fechar seleção',exact=True).click();await main('Mapa')
  await expect(page.get_by_role('button',name='Buscar peça',exact=True)).to_have_count(0)
  assert 'Toque em uma região para selecionar peças'not in await page.locator('body').inner_text();await shot('mapa-estados')
  async def region(key):await page.locator('[data-region="'+key+'"]').first.click();return page.get_by_role('dialog')
  async def radial_button(dialog,name):
   for _ in range(10):
    b=dialog.locator('.piece-options').get_by_role('button',name=name,exact=True)
    if await b.count():return b
    more=dialog.get_by_role('button',name='Ver mais opções',exact=True)
    assert await more.count(),name
    await more.click()
   raise AssertionError(name)
  for key,pairname in [('frente','Farol'),('traseira','Lanterna traseira')]:
   dialog=await region(key)
   canonical,_=reference();code='farol__motorista'if key=='frente'else'lanterna_traseira__motorista'
   steps=next(r['path'][1:-1]for r in canonical if r['codigo']==code)
   for step in steps:await(await radial_button(dialog,step)).click()
   both=dialog.get_by_role('button',name='Ambos',exact=True);driver=dialog.get_by_role('button',name='Motorista',exact=True);passenger=dialog.get_by_role('button',name='Passageiro',exact=True)
   bb,bd,bp=[await n.bounding_box()for n in [both,driver,passenger]];assert bb['y']<bd['y']and bb['y']<bp['y']and bd['x']<bp['x']
   await shot(key+'-ambos-lados');await both.click();await idle();await expect(both).to_have_attribute('aria-pressed','true')
   await dialog.get_by_role('button',name='Fechar seleção',exact=True).click()
  h.mark(device+': front/rear keep real radial pairs with Ambos centered above Motorista/Passageiro; selection creates only existing codes')
  for key in ['motorista','passageiro']:
   dialog=await region(key)
   canonical,_=reference();steps=next(r['path'][1:]for r in canonical if r['codigo']=='retrovisor__'+key)
   for i,step in enumerate(steps):
    labels=await dialog.locator('.piece-options button').evaluate_all('(bs)=>bs.map(b=>b.getAttribute("aria-label"))')
    assert 'Ambos'not in labels and 'Motorista'not in labels and 'Passageiro'not in labels
    b=await radial_button(dialog,step)
    if i==len(steps)-1:
     await expect(b).to_have_attribute('aria-pressed','true'if key=='motorista'else'false')
     await b.click();await idle();await expect(b).to_have_attribute('aria-pressed','false'if key=='motorista'else'true')
    else:await b.click()
   await shot(key+'-contextual');await dialog.get_by_role('button',name='Fechar seleção',exact=True).click()
  final=await ws();assert len({p['pieceId']for p in final['items']})==len(final['items']);assert next(p for p in final['items']if p['pieceId']==entry['id'])['id']==created['id'];assert final['scenarios'][0]['pieceFlags'][created['id']]==False
  h.mark(device+': contextual sides remove opposite/Ambos/redundant choice; Map and functional selection retain same master IDs without duplicates')
  # Full/empty states on a real tiny group, and persistence after restart.
  await main('Diagnósticos');await page.get_by_role('button',name='+ Adicionar peça',exact=True).click();picker=page.get_by_role('region',name='Selecionar peça');group=picker.get_by_role('button',name='Vidros',exact=True);await expect(group).to_have_attribute('data-selection-state','none');await group.click()
  leaves=picker.locator('.piece-options button:not([disabled])');n=await leaves.count()
  for i in range(n):await leaves.nth(i).click()
  await idle();await picker.get_by_role('button',name='← Voltar nível',exact=True).click();await expect(picker.get_by_role('button',name='Vidros',exact=True)).to_have_attribute('data-selection-state','all');await picker.scroll_into_view_if_needed();await shot('grupo-todas')
  h.mark(device+': group states none/partial/all reflect unique selectable codes and pending intentions')
  pre=await ws();await h.restart_api();await page.reload();await h.login(page);await expect(page.locator('.diagnosis-list')).to_be_visible();post=await ws();assert pre['scenarios']==post['scenarios']and pre['items']==post['items']
  version=await get(base+'/orcamentos/'+ids['version']);assert version['snapshot']==ids['snapshot'];assert post['components']==initial_components
  pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert pdf.ok and hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:
   duplicates=db.execute('SELECT piece_id, COUNT(*) FROM diagnosis_items WHERE atendimento_id=? GROUP BY piece_id HAVING COUNT(*)>1',(ids['at'],)).fetchall();assert duplicates==[]
  assert not h.external and not h.page_errors,(h.external,h.page_errors)
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  h.mark(device+': file SQLite survives API restart/reload with stable records, no duplicates or external calls; issued snapshot unchanged')
 except Exception as error:
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
  h.results.append({'name':device+': failure','pass':False,'error':str(error),'traceback':traceback.format_exc()});raise
 finally:
  (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'device':device,'results':h.results,'external':h.external,'pageErrors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
  if ctx:await ctx.close()
  h.cleanup()

async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True)
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  try:
   for device,viewport in [('desktop',{'width':1440,'height':1000}),('mobile',{'width':390,'height':844})]:await device_case(browser,device,viewport)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
