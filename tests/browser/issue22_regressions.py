from mr_percent import select_mr
"""Autosave request budget and adversarial recovery. Local API/file SQLite; synthetic only."""
import asyncio,json,subprocess,traceback,hashlib
from pathlib import Path
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/issue22'

async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{createHash}from'node:crypto';import{openDatabase}from'./server/database.ts';import{performanceCases,performanceFixture}from'./server/tests/fixtures/performance.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=performanceFixture(db,performanceCases[0]);const b=new BudgetRepository(db),request={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,request),v=b.emit(f.at.id,{...request,previewToken:p.token,idempotencyKey:'issue22-frozen-baseline'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,piece:f.item.id,service:f.service.id,dimension:f.dimension.id,budget:v.id,pdfHash:createHash('sha256').update(b.pdf(f.at.id,v.id)).digest('hex'),snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'vite');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  await page.goto(ORIGIN);await h.login(page);await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await page.locator('.diagnosis-open').first.click()
  editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def write(path,data,method='patch'):
   r=await getattr(ctx.request,method)(ORIGIN+path,headers={'Origin':ORIGIN},data=data);assert r.ok,await r.text();return await r.json()
  async def saved():await expect(editor).to_have_attribute('data-save-state','confirmed')
  async def reload_saved():
   await editor.get_by_role('button',name='Carregar versão salva',exact=True).click();await saved();await page.wait_for_timeout(600)
  requests=[]
  def record(r):
   if '/api/' in r.url:requests.append((r.method,r.url.split('?')[0]))
  await saved();page.on('request',record);before=await get(base+'/cenarios');await editor.get_by_role('button',name='Habilitar serviço neste cenário',exact=True).first.click();await saved()
  assert len(requests)==2 and not any('/catalogos' in p or '/diagnosticos/' in p for _,p in requests),requests
  after=await get(base+'/cenarios');assert before['items'][0]['revision']==after['items'][0]['revision']
  requests.clear();part_before=after['components'][0]['revision'];await editor.get_by_role('button',name='Habilitar componente neste cenário',exact=True).first.click();await saved()
  assert len(requests)==2 and not any('/catalogos' in p or '/componentes/' in p or '/diagnosticos/' in p for _,p in requests),requests
  assert (await get(base+'/cenarios'))['components'][0]['revision']==part_before;page.remove_listener('request',record)
  h.mark(device+': mask toggles use 2 requests, no catalog/attribute writes, and keep row revisions')

  # A syntactically valid JSON acknowledgement without a revision is still unconfirmed.
  flag_count=0;lose_flag=True
  async def malformed_flag(route):
   nonlocal flag_count,lose_flag
   if route.request.method=='PATCH':
    flag_count+=1
    if lose_flag:
     lose_flag=False;response=await route.fetch();body=await response.json()
     await route.fulfill(status=200,content_type='application/json',body=json.dumps({'id':body['id']}));return
   await route.continue_()
  await page.route('**'+base+'/cenarios/*',malformed_flag)
  await editor.get_by_role('button',name='Habilitar componente neste cenário',exact=True).first.click();await expect(editor.get_by_role('alert')).to_be_visible()
  await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await saved();assert flag_count==1
  await page.unroute('**'+base+'/cenarios/*',malformed_flag)
  h.mark(device+': malformed JSON acknowledgement preserves inclusion intent and reconciles without replay')

  # Lost confirmation AFTER server commit of a component: stable client ID and GET reconciliation.
  post_count=0;lose=True
  async def lost_component(route):
   nonlocal post_count,lose
   if route.request.method=='POST':
    post_count+=1
    if lose:lose=False;await route.fetch();await route.fulfill(status=201,content_type='text/html',body='synthetic unreadable acknowledgement');return
   await route.continue_()
  await page.route('**'+base+'/componentes',lost_component)
  await editor.get_by_role('button',name='Adicionar componente',exact=True).click()
  await editor.get_by_label('Descrição do componente',exact=True).last.fill('QA confirmação perdida')
  await editor.get_by_label('Preço unitário do componente',exact=True).last.fill('20')
  await expect(editor.get_by_role('alert')).to_be_visible();assert len((await get(base+'/componentes')))==4
  await expect(editor.get_by_label('Descrição do componente',exact=True).last).to_have_value('QA confirmação perdida')
  await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await saved();assert post_count==1;assert len((await get(base+'/componentes')))==4
  await page.unroute('**'+base+'/componentes',lost_component)
  h.mark(device+': unreadable committed component POST is recovered without a duplicate or blind replay')

  # Lost response while creating a service; adopt acknowledged IDs, then keep incomplete rows separate.
  patch_count=0;lose=True
  async def lost_piece(route):
   nonlocal patch_count,lose
   if route.request.method=='PATCH':
    patch_count+=1
    if lose:lose=False;await route.fetch();await route.abort('failed');return
   await route.continue_()
  await page.route('**'+base+'/diagnosticos/'+ids['piece'],lost_piece)
  await editor.get_by_role('button',name='Adicionar serviço',exact=True).click();line=editor.locator('.service').last
  await line.get_by_label('Serviço',exact=True).select_option(ids['service']);await line.get_by_label('Dimensão',exact=True).select_option(ids['dimension'])
  await expect(editor.get_by_role('alert')).to_be_visible()
  await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await saved()
  w=await get(base+'/cenarios');assert len(w['items'][0]['services'])==3 and patch_count==2
  stable=w['items'][0]['services'][-1]['id'];await page.unroute('**'+base+'/diagnosticos/'+ids['piece'],lost_piece)
  await editor.get_by_role('button',name='Adicionar serviço',exact=True).click();await editor.get_by_role('button',name='Adicionar serviço',exact=True).click()
  line=editor.locator('.service').last;await line.get_by_label('Serviço',exact=True).select_option(ids['service']);await line.get_by_label('Dimensão',exact=True).select_option(ids['dimension']);await line.get_by_label('Quantidade do serviço',exact=True).fill('0.25')
  await expect(editor.get_by_role('status')).to_contain_text('Rascunho incompleto')
  w=await get(base+'/cenarios');assert len(w['items'][0]['services'])==4 and w['items'][0]['services'][2]['id']==stable
  await expect(editor.locator('.service').nth(3).get_by_label('Serviço',exact=True)).to_have_value('')
  blank=editor.locator('.service').nth(3);await blank.get_by_label('Serviço',exact=True).select_option(ids['service']);await blank.get_by_label('Dimensão',exact=True).select_option(ids['dimension']);await saved()
  w=await get(base+'/cenarios');assert len(w['items'][0]['services'])==5;assert len({s['id']for s in w['items'][0]['services']})==5
  requests.clear();page.on('request',record);await editor.get_by_role('button',name='Habilitar componente neste cenário',exact=True).first.click();await saved();page.remove_listener('request',record)
  assert len(requests)==2 and not any('/diagnosticos/' in path for _,path in requests),'completing an earlier blank row must not trigger later re-saves'
  h.mark(device+': lost service acknowledgement reconciles IDs; incomplete and fractional repeated services remain distinct')

  fail_refresh=False;part_writes=0
  async def saved_part(route):
   nonlocal fail_refresh,part_writes
   if route.request.method=='PATCH':
    part_writes+=1;response=await route.fetch();fail_refresh=True;await route.fulfill(response=response)
   else:await route.continue_()
  async def refresh_failure(route):
   nonlocal fail_refresh
   if route.request.method=='GET' and fail_refresh:
    fail_refresh=False;await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'message':'Falha sintética após gravação'}}))
   else:await route.continue_()
  await page.route('**'+base+'/componentes/*',saved_part);await page.route('**'+base+'/cenarios?*',refresh_failure)
  await editor.get_by_label('Descrição do componente',exact=True).first.fill('QA já gravado antes da falha de leitura')
  await expect(editor.get_by_role('alert')).to_contain_text('Falha sintética após gravação')
  await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await saved();assert part_writes==1
  assert any(c['name']=='QA já gravado antes da falha de leitura'for c in await get(base+'/componentes'))
  await page.unroute('**'+base+'/componentes/*',saved_part);await page.unroute('**'+base+'/cenarios?*',refresh_failure)
  h.mark(device+': failed refresh after acknowledged save preserves fields and retries reads without replaying the write')

  # Genuine revision conflict: keep remote data and local draft; retry never overwrites it.
  await editor.get_by_role('button',name='Observação da peça',exact=True).click()
  w=await get(base+'/cenarios');p=w['items'][0];s=w['scenarios'][0]
  await write(base+'/diagnosticos/'+p['id'],{'revision':p['revision'],'scenarioId':s['id'],'scenarioRevision':s['revision'],'notes':'Alteração remota QA'})
  await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Rascunho local QA')
  await expect(editor.get_by_role('alert')).to_be_visible();await editor.get_by_role('button',name='Tentar novamente',exact=True).click()
  await expect(editor.get_by_role('alert')).to_contain_text('preservados')
  assert (await get(base+'/cenarios'))['items'][0]['notes']=='Alteração remota QA'
  await expect(editor.get_by_role('textbox',name='Observação da peça',exact=True)).to_have_value('Rascunho local QA');await reload_saved()
  await expect(editor.get_by_role('textbox',name='Observação da peça',exact=True)).to_have_value('Alteração remota QA')
  # Scenario masks can change without touching diagnosis revision.
  w=await get(base+'/cenarios');s=w['scenarios'][0];services=w['items'][0]['services']
  await write(base+'/cenarios/'+s['id'],{'revision':s['revision'],'serviceFlags':{services[1]['id']:False}})
  await editor.get_by_role('button',name='Habilitar serviço neste cenário',exact=True).first.click();await expect(editor.get_by_role('alert')).to_be_visible()
  await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await expect(editor.get_by_role('alert')).to_contain_text('preservados')
  assert (await get(base+'/cenarios'))['scenarios'][0]['serviceFlags'][services[1]['id']] is False
  await reload_saved();h.mark(device+': content and mask conflicts block replay, preserve drafts and support explicit loading')

  # Real persisted parameters invalidate the scenario revision; next edit must remain usable.
  finance=page.get_by_role('region',name='Painel financeiro',exact=True)
  if not await finance.get_by_label('MR',exact=True).is_visible():await finance.locator('.summary').click()
  await finance.get_by_label('MR',exact=True).fill('0');await finance.get_by_label('MR',exact=True).press('Enter');await expect(finance).to_have_attribute('data-calculation-state','current')
  await expect(finance.get_by_label('MR',exact=True)).to_be_enabled();await select_mr(finance,'mr')
  await expect(finance.get_by_label('MR',exact=True)).to_be_enabled()
  await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Após parâmetros QA');await saved()
  assert (await get(base+'/cenarios'))['items'][0]['notes']=='Após parâmetros QA'
  await page.screenshot(path=str(ARTIFACTS/f'{device}-autosave.png'))
  frozen=await get(base+'/orcamentos/'+ids['budget']);assert frozen['snapshot']==ids['snapshot']
  pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['budget']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==ids['pdfHash']
  await page.reload();editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True);await expect(editor).to_be_visible()
  assert (await get(base+'/cenarios'))['items'][0]['notes']=='Após parâmetros QA';assert h.external==[] and h.page_errors==[]
  h.mark(device+': parameter changes, reload, persisted fractional data and immutable snapshot/PDF remain correct')
  return h.results
 except Exception:
  if page:await page.screenshot(path=str(ARTIFACTS/f'{device}-failure.png'))
  raise
 finally:
  if ctx:await ctx.close()
  h.cleanup()
async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True);results=[];error=None
 try:
  async with async_playwright()as p:
   b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   try:
    for device,viewport in [('desktop',{'width':1440,'height':960}),('mobile',{'width':390,'height':844})]:results+=await device_case(b,device,viewport)
   finally:await b.close()
 except Exception:error=traceback.format_exc();print(error,flush=True)
 (ARTIFACTS/'regressoes.json').write_text(json.dumps({'pass':error is None,'results':results,'error':error},indent=2,ensure_ascii=False))
 if error:raise SystemExit(1)
if __name__=='__main__':asyncio.run(run())
