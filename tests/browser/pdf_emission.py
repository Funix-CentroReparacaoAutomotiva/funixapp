"""PR39: local API + authenticated fake jsreport HTTP + disposable SQLite. No production data."""
import asyncio,base64,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/pr39-pdf'
async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{BudgetRepository}from'./server/tests/fixtures/budget-renderer.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db);f.atendimentos.update(f.at.id,{revision:f.at.revision,plate:'QUM7553'});f.pricing.save({revision:f.pricing.get().revision,config:{...f.config,services:f.config.services.map(s=>({...s,base:'200'}))}});const b=new BudgetRepository(db),req={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,req),v=await b.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:'pr39-existing-synthetic'}),scene=f.scenarios.list(f.at.id)[0],two=f.scenarios.create(f.at.id,{name:'Outro cenário',duplicateFrom:scene.id,sourceRevision:scene.revision});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,piece:f.item.id,one:scene.id,two:two.id,old:v.id,snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop',accept_downloads=True);await h.watch(ctx);page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN);await h.login(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios?scenarioId='+ids['one'])
  async def idle():await expect(page.locator('.scenario-trigger')).to_be_enabled();await expect(page.locator('.form-error')).to_have_count(0)
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')),animations='disabled')
  async def calls():return(await(await ctx.request.get('http://127.0.0.1:8788/__test/stats')).json())['calls']
  async def control(mode='normal',delay=0):
   r=await ctx.request.post('http://127.0.0.1:8788/__test/control',headers={'Authorization':'Basic '+base64.b64encode(('synthetic:'+h.password).encode()).decode()},data={'mode':mode,'delayMs':delay});assert r.ok
  async def poll(check):
   for _ in range(120):
    if await check():return
    await asyncio.sleep(.05)
   raise AssertionError('Persisted state did not match expected value')
  async def deadline(scene,mode,value):
   w=await ws();return next(s for s in w['scenarios']if s['id']==scene)['deadline']=={'mode':mode,'manualDays':value}
  async def switch(n):
   await page.locator('.scenario-trigger').click();await page.get_by_role('menuitemradio',name='Cenário '+str(n),exact=True).click();await idle()
  original_pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['old']+'/pdf');old_hash=hashlib.sha256(await original_pdf.body()).hexdigest()
  await page.goto(ORIGIN+'/configuracoes');await page.get_by_role('button',name='Parcelamento',exact=True).click();rates=page.get_by_role('region',name='Parcelamento global');await expect(rates.get_by_label('Acréscimo 3x (%)')).to_have_value('6');await rates.get_by_label('Acréscimo 3x (%)').fill('7,25');await rates.get_by_role('button',name='Salvar parcelamento',exact=True).click();await expect(rates.get_by_role('button',name='Salvar parcelamento',exact=True)).to_be_disabled();assert(await get('/api/parcelamento'))['rates']['tres']=='7.25';await shot('parcelamento-global');await page.reload();await page.get_by_role('button',name='Parcelamento',exact=True).click();await expect(rates.get_by_label('Acréscimo 3x (%)')).to_have_value('7.25')
  h.mark(device+': only global Settings exposes rates, approved defaults edit/reload with exact decimal value; no per-Attendimento rate controls')
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await idle();await expect(page.get_by_label('Acréscimo 3x (%)')).to_have_count(0);finance=page.get_by_role('region',name='Painel financeiro');await finance.locator('.summary').click();deadline_ui=page.get_by_role('region',name='Prazo de execução',exact=True);auto=deadline_ui.get_by_role('button',name='Cálculo automático',exact=True);manual=deadline_ui.get_by_label('Prazo manual em dias úteis',exact=True)
  await expect(auto).to_have_attribute('aria-pressed','true');await expect(deadline_ui).to_contain_text('4 dias úteis');await auto.click();await poll(lambda:deadline(ids['one'],'manual',4));await manual.fill('2');await poll(lambda:deadline(ids['one'],'manual',2));await idle();await shot('prazo-manual');await expect(page.get_by_role('button',name='Salvar',exact=True)).to_have_count(0)
  conf=await get('/api/precificacao');r=await ctx.request.patch(ORIGIN+'/api/precificacao',headers={'Origin':ORIGIN},data={'revision':conf['revision'],'config':{**conf['config'],'capacity':'1'}});assert r.ok;await page.reload();await idle();await finance.locator('.summary').click();await expect(manual).to_have_value('2');assert(await ws())['calculations'][0]['days']=='15'
  await switch(2);await expect(auto).to_have_attribute('aria-pressed','true');await expect(deadline_ui).to_contain_text('15 dias úteis');await auto.click();await poll(lambda:deadline(ids['two'],'manual',15));await manual.fill('7');await poll(lambda:deadline(ids['two'],'manual',7));await switch(1);await expect(manual).to_have_value('2')
  await page.locator('.scenario-trigger').click();await page.get_by_role('menuitem',name='+ Nova variação',exact=True).click();await idle();await expect(auto).to_have_attribute('aria-pressed','true');w=await ws();assert w['scenarios'][-1]['deadline']=={'mode':'automatic','manualDays':None};await switch(1)
  h.mark(device+': manual days seed from technical suggestion, stay fixed after capacity change/reload and differ by scenario; duplicates reset to automatic')
  await auto.click();await poll(lambda:deadline(ids['one'],'automatic',None));await expect(deadline_ui).to_contain_text('15 dias úteis');await auto.click();await poll(lambda:deadline(ids['one'],'manual',15));await manual.fill('0');await expect(deadline_ui).to_contain_text('inteiros positivos');await expect(finance.get_by_role('button',name='Emitir orçamento',exact=True)).to_be_disabled();assert await deadline(ids['one'],'manual',15);await manual.fill('2');await poll(lambda:deadline(ids['one'],'manual',2));await idle()
  h.mark(device+': returning to automatic clears override; zero is never silently saved/promised and invalid draft blocks emission until corrected')
  # Lost scenario acknowledgement recovers by read before any new write.
  lost=[]
  async def lose_deadline(route):
   if route.request.method=='PATCH'and'deadline'in(route.request.post_data_json or{}):lost.append(1);await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**/cenarios/*',lose_deadline);await manual.fill('3');await expect(deadline_ui.get_by_role('alert')).to_be_visible();await page.unroute('**/cenarios/*',lose_deadline);await expect(manual).to_have_value('3');await deadline_ui.get_by_role('button',name='Atualizar prazo',exact=True).click();await expect(deadline_ui.get_by_role('alert')).to_have_count(0);assert len(lost)==1;assert await deadline(ids['one'],'manual',3);await manual.fill('2');await poll(lambda:deadline(ids['one'],'manual',2));await idle()
  h.mark(device+': lost committed deadline PATCH preserves draft, read-first recovery confirms without duplicate or blind replay')
  competing=[]
  async def compete_deadline(route):
   if route.request.method=='PATCH'and'deadline'in(route.request.post_data_json or{})and not competing:
    competing.append(1);w=await ws();scene=w['scenarios'][0];r=await ctx.request.patch(ORIGIN+base+'/cenarios/'+ids['one'],headers={'Origin':ORIGIN},data={'revision':scene['revision'],'deadline':{'mode':'manual','manualDays':8}});assert r.ok
   await route.continue_()
  await page.route('**/cenarios/*',compete_deadline);await manual.fill('5');await expect(deadline_ui.get_by_role('alert')).to_be_visible();await page.unroute('**/cenarios/*',compete_deadline);await expect(manual).to_have_value('5');assert await deadline(ids['one'],'manual',8);await deadline_ui.get_by_role('button',name='Atualizar prazo',exact=True).click();await expect(manual).to_have_value('5');assert await deadline(ids['one'],'manual',8);await deadline_ui.get_by_role('button',name='Salvar meu prazo',exact=True).click();await poll(lambda:deadline(ids['one'],'manual',5));await expect(deadline_ui.get_by_role('alert')).to_have_count(0)
  await page.route('**/cenarios/*',compete_deadline);competing.clear();await manual.fill('6');await expect(deadline_ui.get_by_role('alert')).to_be_visible();await page.unroute('**/cenarios/*',compete_deadline);await deadline_ui.get_by_role('button',name='Carregar prazo salvo',exact=True).click();await expect(manual).to_have_value('8');await expect(deadline_ui.get_by_role('alert')).to_have_count(0);await manual.fill('2');await poll(lambda:deadline(ids['one'],'manual',2));await idle()
  h.mark(device+': genuine deadline conflict preserves local draft and concurrent saved value; explicit keep uses fresh revision, load-saved actually reads the server')
  review=page.get_by_role('dialog',name='Conferência do orçamento');confirm=review.get_by_role('button',name='Confirmar emissão',exact=True)
  async def begin():
   await finance.get_by_role('button',name='Emitir orçamento',exact=True).click();await expect(review).to_be_visible();await expect(review).to_contain_text('menor que a sugestão técnica');await review.get_by_role('checkbox').check()
  async def download(action):
   async with page.expect_download()as d:await action()
   downloaded=await d.value;path=await downloaded.path();return downloaded.suggested_filename,path.read_bytes()
  await control('fail');await begin();await confirm.click();await expect(review.get_by_role('alert')).to_contain_text('recusou');assert len(await get(base+'/orcamentos'))==1;await shot('falha-renderizador');await control('normal',200)
  name,content=await download(lambda:confirm.click());assert name=='QUM7553 - Orçamento FUNIX - 2.pdf';assert content.startswith(b'%PDF-')and b'%%EOF'in content[-1024:];await expect(review).to_contain_text('OR-000002');versions=await get(base+'/orcamentos');issued=await get(base+'/orcamentos/'+versions[0]['id']);assert issued['snapshot']['installments']['rates']['tres']=='7.25';assert issued['snapshot']['document']['data']['parcelamento']['tres']['total']=='R$ 643,50';assert issued['snapshot']['executionDeadline']['effectiveDays']==2;assert issued['snapshot']['document']['data']['condicoes']['prazo']=='2';assert content==await(await ctx.request.get(ORIGIN+base+'/orcamentos/'+issued['id']+'/pdf')).body();await shot('emissao-confirmada');await review.get_by_role('button',name='Fechar conferência',exact=True).click()
  h.mark(device+': real API→authenticated mock HTTP renderer→atomic SQLite→automatic named download; failed render creates no history and retry keeps reserved OR identity')
  # Lost API response after persistence: same key replays original version, renderer not called again.
  count=await calls();lost=[]
  async def lose_issue(route):
   if route.request.method=='POST':lost.append(1);await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await begin();await page.route('**/orcamentos',lose_issue);await confirm.click();await expect(review.get_by_role('alert')).to_be_visible();await page.unroute('**/orcamentos',lose_issue);assert len(await get(base+'/orcamentos'))==3;assert await calls()==count+1
  name,_=await download(lambda:confirm.click());assert name.endswith(' - 3.pdf');assert await calls()==count+1 and len(lost)==1 and len(await get(base+'/orcamentos'))==3;await review.get_by_role('button',name='Fechar conferência',exact=True).click()
  h.mark(device+': lost successful emission response repeats same key/OR/PDF without duplicate renderer call or version')
  # Download failure occurs after issuance; retry downloads only the stored bytes.
  async def fail_download(route):await route.fulfill(status=503,content_type='application/json',body='{}')
  await begin();await page.route('**/orcamentos/*/pdf',fail_download);await confirm.click();await expect(review.get_by_role('alert')).to_contain_text('baixar');await expect(review).to_contain_text('OR-000004');assert len(await get(base+'/orcamentos'))==4;count=await calls();await page.unroute('**/orcamentos/*/pdf',fail_download);name,_=await download(lambda:review.get_by_role('button',name='Baixar PDF',exact=True).click());assert name.endswith(' - 4.pdf')and await calls()==count;await review.get_by_role('button',name='Fechar conferência',exact=True).click()
  h.mark(device+': PDF download failure retains completed document; explicit retry fetches stored file without emission/render repetition')
  # Global change invalidates a reviewed token; no silent use of a newer rate.
  await begin();rates_cfg=await get('/api/parcelamento');r=await ctx.request.patch(ORIGIN+'/api/parcelamento',headers={'Origin':ORIGIN},data={'revision':rates_cfg['revision'],'rates':{**rates_cfg['rates'],'tres':'8'}});assert r.ok;count=await calls();await confirm.click();await expect(review.get_by_role('alert')).to_be_visible();assert await calls()==count and len(await get(base+'/orcamentos'))==4;await review.get_by_role('button',name='Fechar conferência',exact=True).click()
  await finance.get_by_role('button',name='Orçamentos emitidos',exact=True).click();history=page.get_by_role('region',name='Orçamentos emitidos',exact=True);await expect(history.locator('.catalog-row')).to_have_count(4);name,old_content=await download(lambda:history.locator('.catalog-row').last.click());assert name.endswith(' - 1.pdf')and hashlib.sha256(old_content).hexdigest()==old_hash;assert await calls()==count;await shot('historico-download')
  assert(await get(base+'/orcamentos/'+ids['old']))['snapshot']==ids['snapshot'];assert(await get(base+'/orcamentos/'+issued['id']))['snapshot']==issued['snapshot']
  h.mark(device+': rates changed after review invalidate token; historical list downloads original frozen PDF directly and never renumbers or regenerates it')
  await h.restart_api();await page.reload();await h.login(page);await expect(history.locator('.catalog-row')).to_have_count(4);assert await deadline(ids['one'],'manual',2);assert await deadline(ids['two'],'manual',7);assert(await get('/api/parcelamento'))['rates']['tres']=='8';assert(await get(base+'/orcamentos/'+issued['id']))['snapshot']==issued['snapshot']
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos&tela=orcamentos&versao='+ids['old']);await expect(page.locator('.detail-header h1')).to_have_text('Orçamento OR-000001');name,deep_pdf=await download(lambda:page.get_by_role('button',name='Baixar PDF OR-000001',exact=True).click());assert hashlib.sha256(deep_pdf).hexdigest()==old_hash;await page.get_by_role('button',name='Voltar à tela anterior',exact=True).click();await expect(page.locator('.detail-header h1')).to_have_text('Orçamentos emitidos')
  h.mark(device+': previously stored version links stay accessible with commercial identity and original PDF, including contextual return to list')
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:
   assert db.execute('SELECT MAX(version)FROM schema_migrations').fetchone()[0]==12;assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not db.execute('PRAGMA foreign_key_check').fetchall();assert db.execute('SELECT COUNT(*)FROM budget_versions').fetchone()[0]==4
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not h.external and not h.page_errors,(h.external,h.page_errors)
  h.mark(device+': restart persists global rates/manual deadlines/documents; SQLite V12 integrity/FKs, immutable snapshots/PDFs and 1440/390/320 layouts verified; no production access or JS errors')
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
