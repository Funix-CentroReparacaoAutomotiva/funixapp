"""Fase4 real local API with synthetic catalogs/rules only; no private import or external service."""
import asyncio,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/fase4'
async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{fase4Fixture}from'./server/tests/fixtures/fase4.ts';import{ComponentRepository}from'./server/components.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=fase4Fixture(db,false),b=new BudgetRepository(db),one=f.scenarios.list(f.at.id)[0],req={scenarioId:one.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,req),v=b.emit(f.at.id,{...req,previewToken:p.token,idempotencyKey:'fase4-frozen-history'});f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[]});const codes=f.commercial.catalogs().items.filter(c=>c.kind==='peca'&&c.code&&c.code!=='capo').slice(0,3);const extras=codes.map(c=>f.commercial.add(f.at.id,{pieceCodes:[c.code]}).find(p=>p.pieceId===c.id));let manual=extras[0];manual=f.commercial.updateDiagnosis(f.at.id,manual.id,{revision:manual.revision,services:[{serviceId:f.entries[2].serviceId,dimensionId:null,quantity:'0.25',enabled:false}]});const component=new ComponentRepository(db).save(f.at.id,{pieceId:extras[1].id,name:'Componente SINTÉTICO',manualPrice:'10.01',quantity:'0.25',notes:'Preservar'});let savedEmpty=extras[2];savedEmpty=f.commercial.updateDiagnosis(f.at.id,savedEmpty.id,{revision:savedEmpty.revision,diagnosisId:f.diagnosis.id,intensity:'severo'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,capo:f.item.id,manual:manual.id,componentPiece:extras[1].id,savedEmpty:savedEmpty.id,component:component.id,one:one.id,two:f.second.id,diagnosis:f.diagnosis.id,other:f.otherDiagnosis.id,entries:f.entries,budget:v.id,snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios?scenarioId='+ids['one'])
  def stored(w,piece):return next(p for p in w['items']if p['id']==piece)
  editor=page.get_by_role('region',name='Editor de diagnóstico');intensity=editor.get_by_label('Intensidade do diagnóstico',exact=True)
  async def saved():await expect(editor).to_have_attribute('data-save-state','confirmed')
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  async def open_piece(piece):
   await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos&tela=peca&peca='+piece);await expect(editor).to_be_visible();await saved()
  async def set_combo():await editor.get_by_label('Diagnóstico da peça').select_option(ids['diagnosis']);await saved();await intensity.select_option('leve');await saved()
  await page.goto(ORIGIN);await h.login(page);await open_piece(ids['capo']);initial=await ws();pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['budget']+'/pdf');pdf_hash=hashlib.sha256(await pdf.body()).hexdigest();calls=[]
  listener=lambda r:calls.append(r.post_data_json)if r.method=='POST'and r.url.endswith('/recomendacoes')else None;page.on('request',listener)
  await editor.get_by_label('Diagnóstico da peça').select_option(ids['diagnosis']);await saved();assert len(stored(await ws(),ids['capo'])['services'])==0
  gate=asyncio.Event();started=asyncio.Event()
  async def hold(route):
   if route.request.method=='PATCH'and route.request.post_data_json.get('intensity')=='leve':started.set();await gate.wait()
   await route.continue_()
  await page.route('**/diagnosticos/*',hold);await intensity.select_option('leve');await asyncio.wait_for(started.wait(),10);await intensity.select_option('moderado');await intensity.select_option('severo');gate.set();await expect(editor.locator('.service')).to_have_count(6);await saved();await page.unroute('**/diagnosticos/*',hold)
  assert len(calls)==1 and calls[0]['intensity']=='severo';w=await ws();piece=stored(w,ids['capo']);assert [s['serviceId']for s in piece['services']]==[e['serviceId']for e in ids['entries'][:6]];assert [s['enabled']for s in piece['services']]==[True,True,True,False,False,True];assert all(s['quantity']=='1'and s['recommendationRuleId']for s in piece['services']);assert all(not w['scenarios'][1]['serviceFlags'][s['id']]for s in piece['services']);assert w['scenarios'][0]['pieceFlags']==initial['scenarios'][0]['pieceFlags'];assert w['components']==initial['components'];await expect(editor.locator('.suggestion-origin')).to_have_count(6);await shot('automatico-opcionais')
  h.mark(device+': only latest persisted transition auto-applies one atomic batch, six ordered rules, two optional disabled, three curator blocks skipped, no pending-source rule, other flags/components preserved')
  # Editing a generated row must preserve its provenance and operator choices.
  service=editor.locator('.service').nth(1);await service.get_by_label('Dimensão',exact=True).select_option('');await saved();await service.get_by_label('Quantidade do serviço').fill('0,25');await saved();before=stored(await ws(),ids['capo'])['services'];await editor.get_by_label('Diagnóstico da peça').select_option(ids['other']);await saved();await intensity.select_option('moderado');await saved();assert stored(await ws(),ids['capo'])['services']==before;assert len(calls)==1;await shot('ajuste-manual-preservado');h.mark(device+': dimension/quantity edits keep source identity; changing diagnosis/intensity preserves all six adjusted lines without automatic replacement')
  # Delete an optional line; assisted re-add stays optional and never touches existing services.
  optional=editor.locator('.service').nth(3);await optional.get_by_role('button',name='Excluir serviço',exact=True).click();await saved();assert len(stored(await ws(),ids['capo'])['services'])==5
  await editor.get_by_role('button',name='Ver serviços sugeridos',exact=True).click();suggestions=editor.get_by_role('group',name='Serviços sugeridos');await expect(suggestions.get_by_role('checkbox')).to_have_count(6);await expect(suggestions).to_contain_text('3 sugestão(ões) indisponível(is)');await expect(suggestions.get_by_role('checkbox',name='Incluir sugestão Pintura SINTÉTICO / M QA',exact=True)).to_be_disabled();await suggestions.get_by_role('checkbox',name='Incluir sugestão Degradê SINTÉTICO / M QA',exact=True).check();kept=stored(await ws(),ids['capo'])['services'];await shot('assistido-opcional');await suggestions.get_by_role('button',name='Adicionar selecionados',exact=True).click();await saved();p=stored(await ws(),ids['capo']);assert p['services'][:5]==kept and len(p['services'])==6;assert p['services'][-1]['serviceId']==ids['entries'][3]['serviceId']and not p['services'][-1]['enabled'];h.mark(device+': assisted list marks already-present services, hides blocked choices, and re-adds only chosen missing optional disabled without reordering manual adjustments')
  # Existing manual service: different/null dimension never creates a duplicate.
  await open_piece(ids['manual']);writes=len(calls);original=stored(await ws(),ids['manual'])['services'];await set_combo();assert len(calls)==writes and stored(await ws(),ids['manual'])['services']==original
  await editor.get_by_role('button',name='Ver serviços sugeridos',exact=True).click();await expect(suggestions.get_by_role('checkbox',name='Incluir sugestão Pintura SINTÉTICO / M QA',exact=True)).to_be_disabled();await suggestions.get_by_role('button',name='Adicionar selecionados',exact=True).click();await saved();manual=stored(await ws(),ids['manual']);assert manual['services'][0]==original[0]and len(manual['services'])==4;await shot('servico-manual-preservado');h.mark(device+': existing manual painting/null dimension/fraction/disabled flag survives, no automatic insert or duplicate, existing manual row stays first')
  # Component-only master also requires explicit assistance.
  await open_piece(ids['componentPiece']);writes=len(calls);components=(await ws())['components'];await set_combo();assert len(calls)==writes and not stored(await ws(),ids['componentPiece'])['services'];await editor.get_by_role('button',name='Ver serviços sugeridos',exact=True).click();await expect(suggestions.get_by_role('checkbox')).to_have_count(6);await suggestions.get_by_role('button',name='Adicionar selecionados',exact=True).click();await saved();assert(await ws())['components']==components;assert len(stored(await ws(),ids['componentPiece'])['services'])==4;h.mark(device+': component-only piece never auto-applies; explicit batch preserves exact manual component cost, fractional quantity and MR')
  # Saved empty master: opening/reloading must never write.
  count=len(calls);await open_piece(ids['savedEmpty']);await page.reload();await saved();assert len(calls)==count and not stored(await ws(),ids['savedEmpty'])['services'];await expect(editor.get_by_role('button',name='Aplicar serviços sugeridos',exact=True)).to_be_enabled()
  lost=[]
  async def lose(route):
   if route.request.method=='POST':lost.append(route.request.post_data_json);await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**/recomendacoes',lose);await editor.get_by_role('button',name='Aplicar serviços sugeridos',exact=True).click();await expect(editor.get_by_role('alert')).to_be_visible();await expect(intensity).to_be_disabled();assert len(stored(await ws(),ids['savedEmpty'])['services'])==6;await page.unroute('**/recomendacoes',lose);await shot('resposta-perdida');await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await saved();assert len(stored(await ws(),ids['savedEmpty'])['services'])==6;assert calls[-1]==lost[0];await page.reload();await saved();assert len(stored(await ws(),ids['savedEmpty'])['services'])==6;h.mark(device+': saved empty piece needs explicit apply; lost committed response keeps controls protected, read-first retry reuses key/receipt without duplicates; reload never reapplies')
  # Connection failure before delivery is distinct from a committed response lost.
  async def clear_services():
   while await editor.locator('.service').count():await editor.locator('.service').last.get_by_role('button',name='Excluir serviço',exact=True).click();await saved()
  await clear_services();undelivered=[]
  async def fail_delivery(route):
   if route.request.method=='POST':undelivered.append(route.request.post_data_json);await route.abort('failed')
   else:await route.continue_()
  await page.route('**/recomendacoes',fail_delivery);await editor.get_by_role('button',name='Aplicar serviços sugeridos',exact=True).click();await expect(editor.get_by_role('alert')).to_be_visible();assert not stored(await ws(),ids['savedEmpty'])['services'];await page.unroute('**/recomendacoes',fail_delivery);await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await saved();assert len(stored(await ws(),ids['savedEmpty'])['services'])==6 and calls[-1]==undelivered[0];h.mark(device+': request lost before delivery creates no partial lines; explicit read-first retry with the same key commits one batch')
  # A writer after the operation ACK is detected before local adoption.
  await clear_services();changed_after_ack=[]
  async def race_after_ack(route):
   if route.request.method=='POST'and not changed_after_ack:
    changed_after_ack.append(1);response=await route.fetch();w=await ws();p=stored(w,ids['savedEmpty']);services=[{k:v for k,v in l.items()if k not in ['recommendationRuleId','executionConfirmed']}for l in p['services']];services[0]['quantity']='0.25';r=await ctx.request.patch(ORIGIN+base+'/diagnosticos/'+p['id'],headers={'Origin':ORIGIN},data={'revision':p['revision'],'services':services});assert r.ok;await route.fulfill(response=response)
   else:await route.continue_()
  await page.route('**/recomendacoes',race_after_ack);await editor.get_by_role('button',name='Aplicar serviços sugeridos',exact=True).click();await expect(editor.get_by_role('alert')).to_contain_text('composição mudou');await page.unroute('**/recomendacoes',race_after_ack);assert stored(await ws(),ids['savedEmpty'])['services'][0]['quantity']=='0.25';await editor.get_by_role('button',name='Carregar versão salva',exact=True).click();await saved();await expect(editor.locator('.service').first.get_by_label('Quantidade do serviço')).to_have_value('0.25');h.mark(device+': concurrent edit after POST acknowledgement is detected on confirmed workspace read; stale response never overwrites the operator change')
  # A real concurrent manual line invalidates the operation before any suggestions.
  await clear_services()
  raced=[]
  async def conflict(route):
   if route.request.method=='POST'and not raced:
    raced.append(1);w=await ws();p=stored(w,ids['savedEmpty']);r=await ctx.request.patch(ORIGIN+base+'/diagnosticos/'+p['id'],headers={'Origin':ORIGIN},data={'revision':p['revision'],'services':[{'serviceId':ids['entries'][2]['serviceId'],'dimensionId':ids['entries'][2]['dimensionId'],'quantity':'3','enabled':True}]});assert r.ok
   await route.continue_()
  await page.route('**/recomendacoes',conflict);await editor.get_by_role('button',name='Aplicar serviços sugeridos',exact=True).click();await expect(editor.get_by_role('alert')).to_be_visible();await page.unroute('**/recomendacoes',conflict);await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await expect(editor.get_by_role('alert')).to_be_visible();p=stored(await ws(),ids['savedEmpty']);assert len(p['services'])==1 and p['services'][0]['quantity']=='3';await editor.get_by_role('button',name='Carregar versão salva',exact=True).click();await saved();await expect(editor.locator('.service')).to_have_count(1);await shot('conflito-sem-sobrescrita');h.mark(device+': actual concurrent manual insertion yields 409 and no partial suggestion; explicit saved-version recovery preserves manual line and quantity')
  # Suggestion read failures are recoverable and do not change manual composition.
  async def unavailable(route):
   if route.request.method=='GET':await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'message':'QA consulta indisponível'}}))
   else:await route.continue_()
  await page.route('**/api/recomendacoes?*',unavailable);before=stored(await ws(),ids['savedEmpty']);await editor.get_by_role('button',name='Ver serviços sugeridos',exact=True).click();await expect(suggestions.get_by_role('alert')).to_be_visible();assert stored(await ws(),ids['savedEmpty'])==before;await page.unroute('**/api/recomendacoes?*',unavailable);await suggestions.get_by_role('button',name='Tentar consulta',exact=True).click();await expect(suggestions.get_by_role('checkbox')).to_have_count(6);h.mark(device+': failed read is distinct from uncertain write, retains every manual value and recovers without mutation')
  page.remove_listener('request',listener);persisted=await ws();await h.restart_api();await page.reload();await h.login(page);await saved();assert await ws()==persisted;assert(await get(base+'/orcamentos/'+ids['budget']))['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['budget']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('PRAGMA foreign_key_check').fetchall()==[];assert db.execute('SELECT MAX(version)FROM schema_migrations').fetchone()[0]==10
  assert not h.external and not h.page_errors;assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');await shot('persistencia-historico');h.mark(device+': API restart/relogin preserves master and provenance, V10 integrity/FKs and historical snapshot/PDF; no overflow, JS errors or external calls')
 except Exception as e:
  h.results.append({'name':device+': failure','pass':False,'error':str(e),'traceback':traceback.format_exc()})
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
  raise
 finally:
  (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'synthetic':True,'results':h.results,'external':h.external,'pageErrors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
  if ctx:await ctx.close()
  h.cleanup()
async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True)
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  try:
   for device,viewport in [('desktop',{'width':1440,'height':1000}),('mobile390',{'width':390,'height':844}),('mobile320',{'width':320,'height':740})]:await device_case(browser,device,viewport)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
