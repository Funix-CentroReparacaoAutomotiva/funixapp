"""Fase3 local synthetic API/SQLite: intensity, source-rule query and approved header."""
import asyncio,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/fase3'
async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{ComponentRepository}from'./server/components.ts';import{BudgetRepository}from'./server/tests/fixtures/budget-renderer.ts';import{recommendationsFixture}from'./server/tests/fixtures/recommendations.ts';import{planRecommendations,applyRecommendations}from'./server/diagnosis-recommendations.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db);f.pricing.saveSettings(f.at.id,{revision:f.pricing.settings(f.at.id).revision,mrPercent:'20'});const d=f.commercial.saveCatalog({kind:'diagnostico',name:'Dano QA sintético'}),d2=f.commercial.saveCatalog({kind:'diagnostico',name:'Outro dano QA sintético'}),item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId:d.id,notes:'QA preservar observação',services:f.item.services});new ComponentRepository(db).save(f.at.id,{pieceId:item.id,name:'Componente QA',manualPrice:'10.01',quantity:'0.25',notes:'QA preservar componente'});let one=f.scenarios.list(f.at.id)[0],two=f.scenarios.create(f.at.id,{name:'Outro',duplicateFrom:one.id,sourceRevision:one.revision});f.scenarios.update(f.at.id,two.id,{revision:two.revision,pieceFlags:{[item.id]:false}});const rules=recommendationsFixture(db),plan=planRecommendations(db,rules.source);applyRecommendations(db,rules.source,plan.planHash);const budgets=new BudgetRepository(db),request={scenarioId:one.id,negotiation:{mode:'none'}},p=budgets.preview(f.at.id,request),v=(await budgets.emit(f.at.id,{...request,previewToken:p.token,idempotencyKey:'fase3-before-snapshot'}));writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,piece:item.id,one:one.id,two:two.id,damage:d.id,otherDamage:d2.id,ruleDiagnosis:rules.diagnosisId,budget:v.id,snapshot:v.snapshot}));db.close();"
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws(scene=None):return await get(base+'/cenarios?scenarioId='+str(scene or ids['one']))
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  await page.goto(ORIGIN);await h.login(page);await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await page.locator('.diagnosis-open').first.click();editor=page.get_by_role('region',name='Editor de diagnóstico');intensity=editor.get_by_label('Intensidade do diagnóstico',exact=True)
  async def saved(value=None):
   await expect(editor).to_have_attribute('data-save-state','confirmed')
   if value is not None:
    for _ in range(100):
     if(await ws())['items'][0].get('intensity')==value:break
     await asyncio.sleep(.03)
    else:raise AssertionError('Intensity not confirmed')
  await saved();await expect(intensity).to_have_value('');assert await intensity.locator('option').all_text_contents()==['Selecionar…','Leve','Moderado','Severo']
  note=page.get_by_role('button',name='Observação da peça',exact=True);head=page.locator('.detail-header h1');hb=await head.bounding_box();nb=await note.bounding_box();assert abs((hb['y']+hb['height']/2)-(nb['y']+nb['height']/2))<2;assert hb['x']+hb['width']<=nb['x'];assert nb['width']>=44 and nb['height']>=44
  controls=[editor.get_by_role('button',name='Habilitar peça neste cenário'),editor.get_by_label('Diagnóstico da peça'),intensity];boxes=[await c.bounding_box()for c in controls];assert max(b['y']+b['height']/2 for b in boxes)-min(b['y']+b['height']/2 for b in boxes)<2;assert all(boxes[i]['x']+boxes[i]['width']<=boxes[i+1]['x']for i in range(2));assert all(b['width']>=36 for b in boxes);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');await shot('cabecalho-vazio')
  h.mark(device+': approved first row title/annotation and second row toggle/diagnosis/intensity, empty default, four options, keyboard labels and measured non-overlap',boxes=boxes)
  original=await ws();pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['budget']+'/pdf');pdf_hash=hashlib.sha256(await pdf.body()).hexdigest();writes=[];record=lambda r:writes.append(r.post_data_json)if r.method=='PATCH'and'/diagnosticos/'in r.url else None;page.on('request',record)
  for v in ['leve','moderado','severo']:
   n=len(writes);await intensity.select_option(v);await saved(v);assert len(writes)==n+1;w=await ws();assert w['items'][0]['services']==original['items'][0]['services'];assert w['components']==original['components'];assert w['settings']==original['settings'];assert w['calculations'][0]['total']==original['calculations'][0]['total'];assert[(s['pieceFlags'],s['serviceFlags'],s['componentFlags'])for s in w['scenarios']]==[(s['pieceFlags'],s['serviceFlags'],s['componentFlags'])for s in original['scenarios']]
  page.remove_listener('request',record);await intensity.focus();await intensity.press('ArrowUp');await saved('moderado');await intensity.press('ArrowDown');await saved('severo');await intensity.select_option('');await saved();assert(await ws())['items'][0]['intensity']is None;await intensity.select_option('severo');await saved('severo');await shot('cabecalho-severo');h.mark(device+': each intensity saves once, preserves services, quantities, components, notes, MR, flags and official totals')
  await editor.get_by_label('Diagnóstico da peça').select_option(ids['otherDamage']);await saved();assert(await ws())['items'][0]['services']==original['items'][0]['services'];await expect(intensity).to_have_value('severo');await note.click();await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('QA observação preservada com intensidade');await saved();await page.reload();await saved('severo');await expect(intensity).to_have_value('severo');h.mark(device+': diagnosis changes retain manual services/components and intensity; annotation and intensity persist after reload')
  # Two scenarios share intensity but have independent masks.
  await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click();await page.locator('.scenario-trigger').click();await page.get_by_role('menuitemradio',name='Cenário 2',exact=True).click();await page.locator('.diagnosis-open').first.click();await saved();await expect(intensity).to_have_value('severo');await expect(editor.get_by_role('button',name='Habilitar peça neste cenário')).to_have_attribute('aria-pressed','false');await intensity.select_option('leve');await saved('leve');w=await ws();assert w['scenarios'][0]['pieceFlags'][ids['piece']]and not w['scenarios'][1]['pieceFlags'][ids['piece']];assert(await ws(ids['two']))['items'][0]['intensity']=='leve';h.mark(device+': shared master intensity is independent of active/inactive scenario flags')
  gate=asyncio.Event();started=asyncio.Event();calls=[]
  async def delay(route):
   if route.request.method=='PATCH':calls.append(route.request.post_data_json);started.set();await gate.wait()
   await route.continue_()
  await page.route('**/diagnosticos/*',delay);await intensity.select_option('moderado');await asyncio.wait_for(started.wait(),10);await intensity.select_option('severo');gate.set();await saved('severo');await page.unroute('**/diagnosticos/*',delay);assert len(calls)==2;assert(await ws())['items'][0]['services']==original['items'][0]['services'];h.mark(device+': consecutive choices during in-flight save keep the latest intensity without duplicate lines or stale overwrite')
  lost=[]
  async def lose(route):
   if route.request.method=='PATCH':lost.append(1);await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**/diagnosticos/*',lose);await intensity.select_option('leve');await expect(editor.get_by_role('alert')).to_be_visible();await expect(intensity).to_have_value('leve');await page.unroute('**/diagnosticos/*',lose);await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await saved('leve');assert len(lost)==1;h.mark(device+': committed lost response reconciles by read without replay, preserving the intensity draft')
  raced=[]
  async def conflict(route):
   if route.request.method=='PATCH'and not raced:
    raced.append(1);w=await ws(ids['two']);p=w['items'][0];r=await ctx.request.patch(ORIGIN+base+'/diagnosticos/'+ids['piece'],headers={'Origin':ORIGIN},data={'revision':p['revision'],'intensity':'severo'});assert r.ok
   await route.continue_()
  await page.route('**/diagnosticos/*',conflict);await intensity.select_option('moderado');await expect(editor.get_by_role('alert')).to_be_visible();await page.unroute('**/diagnosticos/*',conflict);await expect(intensity).to_have_value('moderado');assert(await ws())['items'][0]['intensity']=='severo';await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await expect(editor.get_by_role('alert')).to_contain_text('salvos mudaram');await shot('conflito-preservado');await editor.get_by_role('button',name='Carregar versão salva',exact=True).click();await saved();await expect(intensity).to_have_value('severo');h.mark(device+': real revision conflict preserves local and newer server values; explicit saved-version loading recovers without silent overwrite')
  recommendations=await get('/api/recomendacoes?diagnosisId='+ids['ruleDiagnosis']+'&intensity=moderado');assert len(recommendations['items'])==1 and recommendations['items'][0]['selectedByDefault']is False;assert(await ws())['items'][0]['services']==original['items'][0]['services'];assert await page.get_by_text('Recomendações',exact=True).count()==0;h.mark(device+': backend returns matching non-default rule, excludes incompatible links and never adds services or suggestion UI')
  await h.restart_api();await page.reload();await h.login(page);await saved('severo');assert(await get(base+'/orcamentos/'+ids['budget']))['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['budget']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('PRAGMA foreign_key_check').fetchall()==[];assert db.execute('SELECT MAX(version)FROM schema_migrations').fetchone()[0]==12
  assert not h.external and not h.page_errors;await shot('persistencia-historico');h.mark(device+': restart/relogin persistence, V9 integrity/FKs, immutable snapshot/PDF and no external calls, JS errors or horizontal overflow')
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
