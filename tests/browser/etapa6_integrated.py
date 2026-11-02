"""Cross-stage journey with synthetic SQLite; no installed database or external writes."""
import asyncio,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/etapa6/integrated'
async def device_case(browser,device,viewport):
 h=Harness();h.check_ports();ctx=None;page=None
 try:
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db);const s=f.scenarios.list(f.at.id)[0];f.scenarios.create(f.at.id,{name:'Outro QA',duplicateFrom:s.id,sourceRevision:s.revision});const b=new BudgetRepository(db),r={scenarioId:s.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'stage6-original-frozen-budget'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,piece:f.item.id,version:v.id,snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop');await h.watch(ctx);page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN);await h.login(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok;return await r.json()
  async def ws():return await get(base+'/cenarios')
  async def saved():await expect(page.locator('.approved-editor')).to_have_attribute('data-save-state','confirmed')
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=chat');await expect(page.get_by_role('button',name='Emitir orçamento',exact=True)).to_be_visible();await shot('chat')
  pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');original_hash=hashlib.sha256(await pdf.body()).hexdigest()
  await page.get_by_role('button',name='Diagnósticos',exact=True).click();await page.locator('.diagnosis-open').filter(has_text='Capô').click();await saved();editor=page.locator('.approved-editor');before=await ws()
  await editor.get_by_role('button',name='Habilitar peça neste cenário').click();await saved();after=await ws();assert [(x['id'],x['pieceId'],x['revision'],x['notes'],[(s['id'],s['serviceId'],s['dimensionId'],s['quantity'])for s in x['services']])for x in after['items']]==[(x['id'],x['pieceId'],x['revision'],x['notes'],[(s['id'],s['serviceId'],s['dimensionId'],s['quantity'])for s in x['services']])for x in before['items']];assert not after['scenarios'][0]['pieceFlags'][ids['piece']]and after['scenarios'][1]['pieceFlags'][ids['piece']]
  await page.get_by_role('button',name='Observação da peça').click();await editor.get_by_role('textbox',name='Observação da peça').fill('Anotação integrada sintética');await saved();await shot('editor');dialogs=len(h.dialogs);await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click();assert len(h.dialogs)==dialogs
  h.mark(device+': scenario flag and confirmed autosave preserve shared composition, other scenario and safe Back without dirty prompt')
  await page.get_by_role('button',name='+ Adicionar peça',exact=True).click();sheet=page.get_by_role('dialog',name='Adicionar peça à composição');await sheet.get_by_role('textbox',name='Buscar peça em todas as vistas').fill('retrovisor__motorista');await sheet.locator('.piece-options button').click();await expect(page.locator('.scenario-trigger')).to_be_enabled();await sheet.get_by_role('button',name='Fechar seleção',exact=True).click();w=await ws();assert len(w['items'])==2 and len({x['pieceId']for x in w['items']})==2;await shot('diagnosticos')
  await page.get_by_role('button',name='Mapa',exact=True).click();await page.locator('[data-region="frente"]').first.click();radial=page.get_by_role('dialog',name='Selecionar peça no mapa');capo=radial.get_by_role('button',name='Capô',exact=True);await expect(capo).to_have_attribute('aria-pressed','false');await capo.click();await expect(page.locator('.scenario-trigger')).to_be_enabled();w=await ws();assert w['scenarios'][0]['pieceFlags'][ids['piece']];assert len(w['items'])==2;await shot('mapa');await radial.get_by_role('button',name='Fechar seleção',exact=True).click();await page.get_by_role('button',name='Diagnósticos',exact=True).click();trash=page.locator('.diagnosis-row').filter(has=page.locator('.diagnosis-title strong',has_text='Capô')).locator('.piece-delete');await trash.click();consent=page.get_by_role('dialog',name='Confirmar remoção da composição');untouched=await ws();await consent.get_by_role('button',name='Cancelar',exact=True).click();assert await ws()==untouched;await trash.click();await consent.get_by_role('button',name='Prosseguir',exact=True).click();await expect(page.locator('.scenario-trigger')).to_be_enabled();w=await ws();assert ids['piece']not in [x['id']for x in w['items']];assert all(ids['piece']not in s['pieceFlags']for s in w['scenarios'])
  h.mark(device+': sheet and circular Map share active-scenario flags; explicit trash deletes globally; Cancel is inert and confirmed removal affects draft composition globally')
  # Reload/restart is a real process restart, not a mocked persistence assertion.
  await page.get_by_role('button',name='Mapa',exact=True).click();persisted=await ws();await h.restart_api();await page.reload();await h.login(page);await expect(page.locator('.interactive-map')).to_be_visible();assert await ws()==persisted;assert(await get(base+'/orcamentos/'+ids['version']))['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==original_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
  assert not h.external and not h.page_errors;h.mark(device+': restart/reload preserves committed selection; historical snapshot/PDF unchanged; SQLite integrity/FKs valid and no external requests')
 except Exception as error:
  if page:await shot('failure')
  h.results.append({'name':device+': failure','pass':False,'error':str(error),'traceback':traceback.format_exc()});raise
 finally:
  (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'synthetic':True,'results':h.results},ensure_ascii=False,indent=2)+'\n')
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
