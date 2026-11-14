"""PDF UX: local API + authenticated fake jsreport HTTP + disposable SQLite. No production data."""
import asyncio,base64,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/orcamento-experiencia'
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
  async def idle():
   await expect(page.locator('.scenario-trigger')).to_be_enabled();await expect(page.locator('.form-error')).to_have_count(0);await expect(page.locator('.approved-finance .emit')).to_be_enabled();await expect(page.locator('.execution-deadline')).to_have_attribute('aria-busy','false')
  async def shot(name):
   if name=='previa-pdf':await asyncio.sleep(1)
   await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')),animations='disabled')
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
  await auto.click();await poll(lambda:deadline(ids['one'],'automatic',None));await expect(deadline_ui).to_contain_text('15 dias úteis');await auto.click();await poll(lambda:deadline(ids['one'],'manual',15));await manual.fill('0');await expect(deadline_ui).to_contain_text('inteiros positivos');await expect(finance.locator('.summary .deadline span')).to_have_text('—');await expect(finance.get_by_role('button',name='Emitir',exact=True)).to_be_disabled();assert await deadline(ids['one'],'manual',15);await manual.fill('2');await poll(lambda:deadline(ids['one'],'manual',2));await idle()
  h.mark(device+': returning to automatic clears override; zero is never silently saved/promised and invalid draft blocks emission until corrected')
  # Lost scenario acknowledgement recovers by read before any new write.
  lost=[]
  async def lose_deadline(route):
   if route.request.method=='PATCH'and'deadline'in(route.request.post_data_json or{}):lost.append(route.request.post_data_json);await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**/cenarios/*',lose_deadline);await manual.fill('3');await expect(deadline_ui.get_by_role('alert')).to_be_visible();await page.unroute('**/cenarios/*',lose_deadline);await expect(manual).to_have_value('3');await deadline_ui.get_by_role('button',name='Atualizar prazo',exact=True).click();await expect(deadline_ui.get_by_role('alert')).to_have_count(0);assert len(lost)==1,lost;assert await deadline(ids['one'],'manual',3);await manual.fill('2');await poll(lambda:deadline(ids['one'],'manual',2));await idle()
  h.mark(device+': lost committed deadline PATCH preserves draft, read-first recovery confirms without duplicate or blind replay')
  competing=[]
  async def compete_deadline(route):
   if route.request.method=='PATCH'and'deadline'in(route.request.post_data_json or{})and not competing:
    competing.append(1);w=await ws();scene=w['scenarios'][0];r=await ctx.request.patch(ORIGIN+base+'/cenarios/'+ids['one'],headers={'Origin':ORIGIN},data={'revision':scene['revision'],'deadline':{'mode':'manual','manualDays':8}});assert r.ok
   await route.continue_()
  await page.route('**/cenarios/*',compete_deadline);await manual.fill('5');await expect(deadline_ui.get_by_role('alert')).to_be_visible();await page.unroute('**/cenarios/*',compete_deadline);await expect(manual).to_have_value('5');assert await deadline(ids['one'],'manual',8);await deadline_ui.get_by_role('button',name='Atualizar prazo',exact=True).click();await expect(manual).to_have_value('5');assert await deadline(ids['one'],'manual',8);await deadline_ui.get_by_role('button',name='Salvar meu prazo',exact=True).click();await poll(lambda:deadline(ids['one'],'manual',5));await expect(deadline_ui.get_by_role('alert')).to_have_count(0)
  await page.route('**/cenarios/*',compete_deadline);competing.clear();await manual.fill('6');await expect(deadline_ui.get_by_role('alert')).to_be_visible();await page.unroute('**/cenarios/*',compete_deadline);await deadline_ui.get_by_role('button',name='Carregar prazo salvo',exact=True).click();await expect(manual).to_have_value('8');await expect(deadline_ui.get_by_role('alert')).to_have_count(0);await manual.fill('2');await poll(lambda:deadline(ids['one'],'manual',2));await idle()
  h.mark(device+': genuine deadline conflict preserves local draft and concurrent saved value; explicit keep uses fresh revision, load-saved actually reads the server')
  review=page.get_by_role('dialog',name='Prévia PDF do orçamento');confirm=review.get_by_role('button',name='Confirmar',exact=True)
  downloads=[];page.on('download',lambda d:downloads.append(d.suggested_filename))
  confirmations=[];page.on('request',lambda r:confirmations.append(r.post_data_json)if r.method=='POST'and r.url==ORIGIN+base+'/orcamentos'else None)
  await page.evaluate("()=>{window.revoked=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.revoked.push(url);revoke(url)}}")
  async def begin():
   await finance.get_by_role('button',name='Emitir',exact=True).click()
   await expect(review).to_be_visible()
   if device=='desktop':await expect(review.locator('iframe')).to_be_visible()
   else:
    await expect(review.locator('iframe')).to_have_count(0)
    await expect(review.get_by_text('Prévia pronta.')).to_be_visible()
   await expect(review.get_by_role('checkbox')).to_have_count(0)
  async def download(action):
   async with page.expect_download()as d:await action()
   downloaded=await d.value;path=await downloaded.path();return downloaded.suggested_filename,path.read_bytes()
  async def sql(query):
   with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:return db.execute(query).fetchone()[0]
  before=(await sql('SELECT COUNT(*)FROM budget_emission_attempts'),await sql('SELECT MAX(serial)FROM budget_emission_attempts'))
  await begin();assert not downloads;preview_url=await review.get_by_role('link',name='abrir prévia em outra aba').get_attribute('href');assert preview_url.startswith('blob:')
  await shot('previa-pdf');assert len(await get(base+'/orcamentos'))==1
  if device=='desktop':
   async with page.expect_popup()as popup_event:await review.get_by_role('link',name='abrir prévia em outra aba').click()
   popup=await popup_event.value;await popup.wait_for_url('blob:**');await popup.close();assert not downloads
  else:
   name,pdf_bytes=await download(lambda:review.get_by_role('link',name='Baixar prévia PDF').click())
   assert name=='FUNIX - Prévia do orçamento.pdf'
   assert pdf_bytes.startswith(b'%PDF-')and b'%%EOF'in pdf_bytes[-1024:]
   assert len(downloads)==1
   downloads.clear() # Subsequent assertions count only actual issued-budget downloads
  assert len(await get(base+'/orcamentos'))==1
  h.mark(device+': explicit desktop viewer or mobile preview download does not emit or reserve a quote')
  await review.get_by_role('button',name='Voltar',exact=True).click();await expect(review).not_to_be_visible();assert len(await get(base+'/orcamentos'))==1
  assert (await sql('SELECT COUNT(*)FROM budget_emission_attempts'),await sql('SELECT MAX(serial)FROM budget_emission_attempts'))==before
  if device=='desktop':await page.wait_for_function('(url)=>window.revoked.includes(url)',arg=preview_url)
  h.mark(device+': mobile tab or desktop modal PDF preview does not issue a document; Back retains draft')
  # Lost temporary-PDF response never creates a commercial reservation.
  async def lose_preview(route):await route.abort('failed')
  await page.route('**/previa-pdf',lose_preview);await finance.get_by_role('button',name='Emitir',exact=True).click();await expect(finance.get_by_role('alert')).to_contain_text('Tente Emitir novamente');await page.unroute('**/previa-pdf',lose_preview);assert len(await get(base+'/orcamentos'))==1 and await sql('SELECT MAX(serial)FROM budget_emission_attempts')==1 and not downloads
  h.mark(device+': preview network failure is explicit and retryable, with no number, download or document')
  # Failed preview has no number or durable history.
  await control('fail');await finance.get_by_role('button',name='Emitir',exact=True).click();await expect(finance.get_by_role('alert')).to_contain_text('recusou');assert await sql('SELECT MAX(serial)FROM budget_emission_attempts')==1;await shot('falha-previa');await control('normal')
  await begin();await control('fail');await confirm.click();await expect(review.get_by_role('alert')).to_contain_text('O orçamento não foi emitido.');await expect(review.get_by_role('alert')).to_contain_text('recusou');await expect(review.get_by_role('button',name='Voltar',exact=True)).to_be_enabled();await expect(confirm).to_be_enabled();assert len(await get(base+'/orcamentos'))==1 and not downloads;assert await sql("SELECT COUNT(*)FROM budget_emission_attempts WHERE state='failed'")==1;await shot('falha-renderizador')
  first_confirmation=confirmations[-1]
  await control('truncate');await confirm.click();await expect(review.get_by_role('alert')).to_contain_text('O orçamento não foi emitido.');await expect(review.get_by_role('alert')).to_contain_text('inválido');await expect(review.get_by_role('button',name='Voltar',exact=True)).to_be_enabled();assert confirmations[-1]==first_confirmation;assert await sql('SELECT MAX(serial)FROM budget_emission_attempts')==2 and len(await get(base+'/orcamentos'))==1 and not downloads;await control('normal',200)
  h.mark(device+': refused renderer and invalid PDF are known not-issued results; Back/Confirm enabled, no history/download, same key and reserved OR retained')
  name,content=await download(lambda:confirm.dblclick(delay=25));assert name=='QUM7553 - Orçamento FUNIX - 2.pdf';assert content.startswith(b'%PDF-')and b'%%EOF'in content[-1024:];await expect(review).not_to_be_visible();versions=await get(base+'/orcamentos');issued=await get(base+'/orcamentos/'+versions[0]['id']);assert issued['snapshot']['installments']['rates']['tres']=='7.25';assert issued['snapshot']['document']['data']['parcelamento']['tres']['total']=='R$ 643,50';assert issued['snapshot']['executionDeadline']['effectiveDays']==2;assert issued['snapshot']['document']['data']['condicoes']['prazo']=='2';assert content==await(await ctx.request.get(ORIGIN+base+'/orcamentos/'+issued['id']+'/pdf')).body();await shot('emissao-confirmada');assert len(downloads)==1;assert confirmations[-1]==first_confirmation
  h.mark(device+': failed definitive render preserves reserved identity; double confirmation emits once and automatically downloads one stored PDF')
  # Lost successful response: repeat the exact key, with no second render.
  lost=[]
  async def lose_issue(route):
   if route.request.method=='POST':lost.append(route.request.post_data_json);await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await begin();count=await calls();await page.route('**/orcamentos',lose_issue);await confirm.click();await expect(review.get_by_role('alert')).to_be_visible();await page.unroute('**/orcamentos',lose_issue);assert len(await get(base+'/orcamentos'))==3;assert await calls()==count+1
  await expect(review.get_by_role('button',name='Voltar',exact=True)).to_be_disabled()
  # A proxy failure or unreadable 2xx cannot assert whether the original POST committed.
  for status,body in [(502,'Bad gateway'),(503,'Unavailable'),(500,json.dumps({'error':{'code':'INTERNAL_ERROR'}})),(201,'truncated')]:
   async def ambiguous(route):await route.fulfill(status=status,content_type='application/json',body=body)
   await page.route('**/orcamentos',ambiguous);await confirm.click();await expect(review.get_by_role('alert')).to_be_visible();await expect(review.get_by_role('button',name='Voltar',exact=True)).to_be_disabled();assert confirmations[-1]==lost[0];assert len(await get(base+'/orcamentos'))==3 and await calls()==count+1;await page.unroute('**/orcamentos',ambiguous)
  h.mark(device+': generic 502/503, INTERNAL_ERROR and unreadable success stay uncertain and keep the original key without new render/history/download')
  async def in_progress(route):await route.fulfill(status=409,content_type='application/json',body=json.dumps({'error':{'code':'PDF_RENDER_IN_PROGRESS','message':'Emissão ainda em processamento.'}}))
  await page.route('**/orcamentos',in_progress);await confirm.click();await expect(review.get_by_role('alert')).to_contain_text('processamento');await expect(review.get_by_role('button',name='Voltar',exact=True)).to_be_disabled();await page.unroute('**/orcamentos',in_progress)
  name,_=await download(lambda:confirm.click());assert name.endswith(' - 3.pdf');assert await calls()==count+1 and len(lost)==1 and len(await get(base+'/orcamentos'))==3 and confirmations[-1]==lost[0];await expect(review).not_to_be_visible()
  h.mark(device+': lost committed response retains exact idempotency key; retry recovers original OR without second rendering, uncertain close blocked')
  async def fail_download(route):await route.fulfill(status=503,content_type='application/json',body='{}')
  await begin();await page.route('**/orcamentos/*/pdf',fail_download);await confirm.click();await expect(review.get_by_role('alert')).to_contain_text('emitido');await expect(review).to_contain_text('OR-000004');assert len(await get(base+'/orcamentos'))==4;count=await calls();requests_before_download=len(confirmations);await expect(confirm).to_have_count(0);await expect(review.get_by_role('button',name='Voltar',exact=True)).to_be_enabled();await page.unroute('**/orcamentos/*/pdf',fail_download);name,_=await download(lambda:review.get_by_role('button',name='Baixar novamente',exact=True).click());assert name.endswith(' - 4.pdf')and await calls()==count and len(confirmations)==requests_before_download;await expect(review).not_to_be_visible()
  h.mark(device+': post-commit download failure retains issued PDF; explicit retry never repeats emission')
  await begin();rates_cfg=await get('/api/parcelamento');r=await ctx.request.patch(ORIGIN+'/api/parcelamento',headers={'Origin':ORIGIN},data={'revision':rates_cfg['revision'],'rates':{**rates_cfg['rates'],'tres':'8'}});assert r.ok;count=await calls();await confirm.click();await expect(review.get_by_role('alert')).to_be_visible();assert await calls()==count and len(await get(base+'/orcamentos'))==4;await review.get_by_role('button',name='Voltar',exact=True).click()
  h.mark(device+': changed installment revision blocks stale preview before reserving another number')
  # Interleave scenario emissions; historical presentation letters must restart per frozen ID.
  for scene in [ids['two'],ids['one'],ids['two']]:
   body={'scenarioId':scene,'negotiation':{'mode':'none'}};p=await(await ctx.request.post(ORIGIN+base+'/orcamentos/previa',headers={'Origin':ORIGIN},data=body)).json();r=await ctx.request.post(ORIGIN+base+'/orcamentos',headers={'Origin':ORIGIN},data={**body,'previewToken':p['token'],'idempotencyKey':'history-'+__import__('uuid').uuid4().hex});assert r.ok,await r.text()
  total_count=7
  await finance.get_by_role('button',name='Orçamentos emitidos',exact=True).click();history=page.get_by_role('region',name='Orçamentos emitidos',exact=True);await expect(history.locator('.budget-history-row')).to_have_count(total_count)
  assert await history.locator('.budget-history-group h2').all_text_contents()==['Cenário 1','Cenário 2']
  assert await history.locator('.budget-history-group').nth(0).locator('.budget-history-letter').all_text_contents()==['A','B','C','D','E']
  assert await history.locator('.budget-history-group').nth(1).locator('.budget-history-letter').all_text_contents()==['A','B']
  for row in await history.locator('.budget-history-row').all():
   letter=await row.locator('.budget-history-letter').bounding_box();identity=await row.locator('.budget-history-identity').bounding_box();amount=await row.locator('.budget-history-total').bounding_box();icon=await row.locator('.budget-history-download').bounding_box();assert letter['x']<identity['x']<amount['x']<icon['x'];assert amount['x']+amount['width']<=icon['x']+1
  count=await calls();name,old_content=await download(lambda:history.get_by_role('button',name='Baixar orçamento OR-000001',exact=True).click());assert name.endswith(' - 1.pdf')and hashlib.sha256(old_content).hexdigest()==old_hash;assert await calls()==count;await shot('historico-por-cenario')
  assert(await get(base+'/orcamentos/'+ids['old']))['snapshot']==ids['snapshot'];assert(await get(base+'/orcamentos/'+issued['id']))['snapshot']==issued['snapshot']
  h.mark(device+': compact scenario groups ordered 1/2, A–E/A–B independent of global sequence, totals before download icons; original hashes/snapshots unchanged')
  await h.restart_api();await page.reload();await h.login(page);await expect(history.locator('.budget-history-row')).to_have_count(total_count);assert await deadline(ids['one'],'manual',2);assert await deadline(ids['two'],'manual',7);assert(await get('/api/parcelamento'))['rates']['tres']=='8'
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos&tela=orcamentos&versao='+ids['old']);await expect(page.locator('.detail-header h1')).to_have_text('Orçamento OR-000001');name,deep_pdf=await download(lambda:page.get_by_role('button',name='Baixar PDF OR-000001',exact=True).click());assert hashlib.sha256(deep_pdf).hexdigest()==old_hash;await page.get_by_role('button',name='Voltar à tela anterior',exact=True).click();await expect(page.locator('.detail-header h1')).to_have_text('Orçamentos emitidos')
  h.mark(device+': restart retains SQLite documents and deep links with original stored PDF; reopening never downloads automatically')
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await idle();summary=finance.locator('.summary');await expect(summary.locator('.deadline span')).to_have_text('2');await switch(2);await expect(summary.locator('.deadline span')).to_have_text('7');await shot('prazo-barra');await switch(1)
  boxes=[await metric.bounding_box()for metric in await summary.locator('.metric').all()];assert len(boxes)==5;assert all(boxes[i]['x']+boxes[i]['width']<=boxes[i+1]['x']+.5 for i in range(4));assert max(b['y']for b in boxes)-min(b['y']for b in boxes)<2
  h.mark(device+': all five summary metrics stay in one row, deadline after total, with no collisions')
  # Tabs retain actual horizontal spatial order and reduced-motion disables native transitions.
  await page.get_by_role('button',name='Mapa',exact=True).click();await expect(page.locator('.interactive-map')).to_be_visible();await asyncio.sleep(.35);await shot('mapa')
  async def gesture(locator,dx,dy=0):
   await locator.evaluate("(el,p)=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,t=new Touch({identifier:1,target:el,clientX:x,clientY:y});el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[t],changedTouches:[t]}));const end=new Touch({identifier:1,target:el,clientX:x+p.dx,clientY:y+p.dy});el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[],changedTouches:[end]}))}",{'dx':dx,'dy':dy});await asyncio.sleep(.35)
  map_region=page.locator('.interactive-map [data-region]').first
  await gesture(map_region,90);await expect(page.get_by_role('button',name='Diagnósticos',exact=True)).to_have_attribute('aria-current','page');assert not await page.locator('.piece-dialog[open]').count();assert await page.locator('html').get_attribute('data-tab-direction')=='back'
  await gesture(page.locator('.diagnostics-body'),90);await expect(page.get_by_role('button',name='Chat',exact=True)).to_have_attribute('aria-current','page')
  await gesture(page.locator('.chat-channel-state'),90);await expect(page.get_by_role('button',name='Chat',exact=True)).to_have_attribute('aria-current','page')
  await gesture(page.locator('.chat-channel-state'),-90);await expect(page.get_by_role('button',name='Diagnósticos',exact=True)).to_have_attribute('aria-current','page');assert await page.locator('html').get_attribute('data-tab-direction')=='forward'
  await gesture(page.locator('.diagnostics-body'),-90);await expect(page.get_by_role('button',name='Mapa',exact=True)).to_have_attribute('aria-current','page')
  await gesture(map_region,0,100);await expect(page.get_by_role('button',name='Mapa',exact=True)).to_have_attribute('aria-current','page');await gesture(map_region,-90);await expect(page.get_by_role('button',name='Mapa',exact=True)).to_have_attribute('aria-current','page')
  await map_region.click(force=True);await expect(page.locator('.disc-wrap')).to_be_visible();await page.keyboard.press('Escape');await expect(page.locator('.disc-wrap')).not_to_be_visible()
  await page.emulate_media(reduced_motion='reduce');await page.evaluate("()=>{window.transitionCalls=0;const transition=document.startViewTransition.bind(document);document.startViewTransition=(...args)=>{window.transitionCalls++;return transition(...args)}}")
  await page.get_by_role('button',name='Diagnósticos',exact=True).click();assert await page.evaluate('window.transitionCalls')==0;await page.emulate_media(reduced_motion='no-preference');await page.get_by_role('button',name='Chat',exact=True).click();await asyncio.sleep(.35);assert await page.evaluate('window.transitionCalls')==1;await shot('chat');await page.get_by_role('button',name='Diagnósticos',exact=True).click();await asyncio.sleep(.35);await shot('diagnosticos')
  h.mark(device+': swipe all directions including map SVG controls, no wrap or vertical false positive; map tap and native forward/back transitions preserved, reduced motion has zero transitions')
  await page.get_by_role('button',name='Chat',exact=True).click();await page.evaluate('async()=>{await document.activeViewTransition?.finished}')
  await page.evaluate("()=>{const tabs=document.querySelectorAll('.view-tab');tabs[1].click();tabs[0].click()}");await page.evaluate('async()=>{await document.activeViewTransition?.finished}');await expect(page.get_by_role('button',name='Chat',exact=True)).to_have_attribute('aria-current','page');assert 'aba=chat'in page.url
  h.mark(device+': rapid competing tab requests keep the last route, never applying an old transition callback')
  # Known failure can be abandoned safely, while its failed reservation is never reused.
  await begin();await control('fail');count_before=len(downloads);await confirm.click();await expect(review.get_by_role('alert')).to_contain_text('O orçamento não foi emitido.');await expect(review.get_by_role('button',name='Voltar',exact=True)).to_be_enabled();await review.get_by_role('button',name='Voltar',exact=True).click();await expect(review).not_to_be_visible();await control('normal');await expect(finance.get_by_role('button',name='Emitir',exact=True)).to_be_enabled();await expect(finance.get_by_role('button',name='Orçamentos emitidos',exact=True)).to_be_enabled();assert len(await get(base+'/orcamentos'))==total_count and len(downloads)==count_before;assert await sql("SELECT COUNT(*)FROM budget_emission_attempts WHERE state='failed'")==1;assert await sql('SELECT MAX(serial)FROM budget_emission_attempts')==8
  await page.get_by_role('button',name='Diagnósticos',exact=True).click();await expect(page.get_by_role('button',name='Diagnósticos',exact=True)).to_have_attribute('aria-current','page');await expect(page.locator('.diagnosis-open').first).to_be_enabled();await shot('voltar-apos-falha-conhecida')
  h.mark(device+': Back after known error closes cleanly, unlocks editing/navigation/emission, preserves failed reservation and never downloads or emits')
  conf=await get('/api/precificacao');r=await ctx.request.patch(ORIGIN+'/api/precificacao',headers={'Origin':ORIGIN},data={'revision':conf['revision'],'config':{**conf['config'],'capacity':None}});assert r.ok
  await page.reload();await expect(page.locator('.scenario-trigger')).to_be_enabled();await page.locator('.scenario-trigger').click();await page.get_by_role('menuitemradio',name='Cenário 3',exact=True).click();await expect(finance.locator('.summary .deadline span')).to_have_text('—');await shot('prazo-indisponivel')
  h.mark(device+': an automatic deadline with missing capacity displays an em dash, never zero or a stale promise')
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:
   assert db.execute('SELECT MAX(version)FROM schema_migrations').fetchone()[0]==17;assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not db.execute('PRAGMA foreign_key_check').fetchall();assert db.execute('SELECT COUNT(*)FROM budget_versions').fetchone()[0]==total_count
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not h.external and not h.page_errors,(h.external,h.page_errors)
  h.mark(device+': V15 unchanged, integrity/FKs, no external network/JS errors or horizontal overflow, all synthetic at '+str(viewport['width'])+'px')
 except Exception as error:
  if page:
   try:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')),timeout=3000)
   except Exception:pass
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
