"""Final commercial curation: local real API, synthetic SQLite only; no private exports."""
import asyncio,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
from scenario_ui import add_scenario,select_named_scenario
ARTIFACTS=ROOT/'docs/evidencias/curadoria-final'
async def device_case(browser,device,viewport):
 h=Harness();h.check_ports();ctx=None;page=None
 try:
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{curationFixture}from'./server/tests/fixtures/curation.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=curationFixture(db);for(let n=0;n<16;n++)f.commercial.saveCatalog({kind:'diagnostico',name:n===15?'Cuidados operacionais QA':'Diagnóstico QA '+n});const b=new BudgetRepository(db),r={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'curation-frozen-synthetic-budget'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,piece:f.item.id,ids:f.ids,dimensions:f.dimensions,version:v.id,snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop',accept_downloads=True);await h.watch(ctx);page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN);await h.login(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios')
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  async def saved():await expect(page.locator('.approved-editor')).to_have_attribute('data-save-state','confirmed')
  async def open_editor():
   await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos&tela=peca&peca='+ids['piece']);await expect(page.locator('.approved-editor')).to_be_visible();await saved()
  await open_editor();editor=page.locator('.approved-editor');finance=page.locator('.approved-finance');frozen=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');frozen_hash=hashlib.sha256(await frozen.body()).hexdigest()
  choices=editor.get_by_label('Serviço',exact=True).first
  for key in ['hidden','legacy','technical','inspection']:assert await choices.locator('option[value="'+ids['ids'][key]+'"]').count()==0
  grouped=choices.locator('option[value="activity:technical-assessment"]');assert await grouped.count()==1;assert await grouped.evaluate("o=>o.disabled") is True;assert await editor.get_by_label('Diagnóstico da peça').locator('option').count()==17;await shot('catalogo-grupo-bloqueado')
  h.mark(device+': hidden items absent from new selector, 16 diagnoses available, two technical identities shown as one blocked offer without canonical selection')
  async def add_line(key):
   await editor.get_by_role('button',name='Adicionar serviço',exact=True).click();row=editor.locator('.service').last;await row.get_by_label('Serviço',exact=True).select_option(ids['ids'][key]);await row.get_by_label('Dimensão',exact=True).select_option(ids['dimensions'][key]);await saved();return row
  free=await add_line('free');await free.get_by_label('Quantidade do serviço').fill('0.25');await saved();await expect(free.locator('.calculated strong')).to_have_text('Sem cobrança');w=await ws();calc=w['calculations'][0];line=next(l for l in calc['lines']if l.get('billing')=='not_billed');assert line['unit']is None and line['total']is None and calc['total']=='300.15'and calc['energy']=='16.25';await shot('misto-sem-cobranca')
  h.mark(device+': mixed priced/not-billed lines autosave exact fractional quantities, no free unit price, charged total unchanged and technical energy included')
  third=await add_line('third');checkbox=third.get_by_role('checkbox',name='Execução e contratação confirmadas neste cenário');await expect(checkbox).not_to_be_checked();await checkbox.click();await expect(checkbox).to_be_checked();w=await ws();assert not w['calculations'][0]['errors'];await shot('terceiro-confirmado')
  await add_scenario(page);await expect(page.get_by_role('button',name='Cenários: Cenário 2',exact=True)).to_be_visible();await page.locator('.diagnosis-open').filter(has_text='Capô').click();await saved();third=editor.locator('.service').nth(2);checkbox=third.get_by_role('checkbox');await expect(checkbox).not_to_be_checked();w=await ws();assert not w['scenarios'][1].get('serviceConfirmations');assert any('terceiro'in e for e in w['calculations'][1]['errors']);assert not w['calculations'][0]['errors'];await shot('copia-sem-herdar-confirmacao')
  h.mark(device+': explicit confirmation persists on original scenario/line; copying masks does not authorize external execution in the new scenario')
  await select_named_scenario(page,'Cenário 1');await page.locator('.diagnosis-open').filter(has_text='Capô').click();await saved();third=editor.locator('.service').nth(2);checkbox=third.get_by_role('checkbox');await expect(checkbox).to_be_checked();await third.get_by_label('Quantidade do serviço').fill('2');await saved();await expect(checkbox).not_to_be_checked();w=await ws();assert all(not s.get('serviceConfirmations')for s in w['scenarios'])
  calls=[]
  async def lost(route):calls.append(route.request.post_data_json);await route.fetch();await route.abort('failed')
  await page.route('**/confirmacao',lost);await checkbox.click();await expect(editor.get_by_role('alert')).to_contain_text('Confirmação não verificada');await page.unroute('**/confirmacao',lost);w=await ws();assert w['scenarios'][0].get('serviceConfirmations');await editor.get_by_role('button',name='Atualizar confirmação salva').click();await expect(checkbox).to_be_checked();assert len(calls)==1;await shot('confirmacao-recuperada')
  h.mark(device+': scope change revokes approvals; committed lost confirmation response is recovered by GET before retry, without blind PATCH replay or duplicate lines')
  await h.restart_api();await page.reload();await h.login(page);await open_editor();checkbox=editor.locator('.service').nth(2).get_by_role('checkbox');await expect(checkbox).to_be_checked()
  h.mark(device+': real API restart/relogin preserves scenario-scoped confirmation and committed service data')
  w=await ws();scenario=w['scenarios'][0];item=w['items'][0];flags={l['id']:l['serviceId']==ids['ids']['free']for l in item['services']};r=await ctx.request.patch(ORIGIN+base+'/cenarios/'+scenario['id'],headers={'Origin':ORIGIN},data={'revision':scenario['revision'],'serviceFlags':flags});assert r.ok;await page.reload();await saved();await expect(finance.locator('.metric.final span')).to_have_text('Sem cobrança');await finance.get_by_role('button',name='Emitir orçamento',exact=True).click();review=page.get_by_role('dialog',name='Conferência do orçamento');await expect(review).to_be_visible();await review.get_by_role('checkbox').check();requests=[]
  async def lose_emission(route):
   requests.append(route.request.post_data_json)
   if len(requests)==1:await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**'+base+'/orcamentos',lose_emission);await review.get_by_role('button',name='Confirmar emissão',exact=True).click();await expect(review.get_by_role('alert')).to_be_visible();await review.get_by_role('button',name='Confirmar emissão',exact=True).click();await expect(review.get_by_role('heading',name='Orçamento B emitido',exact=True)).to_be_visible();await page.unroute('**'+base+'/orcamentos',lose_emission);assert len(requests)==2 and requests[0]==requests[1];versions=await get(base+'/orcamentos');assert len(versions)==2;new=await get(base+'/orcamentos/'+versions[0]['id']);c=new['snapshot']['calculation'];assert c['nonBillableOnly']and c['total']=='0'and c['energy']=='1.25';assert all(l['unit']is None and l['total']is None for l in c['lines']if l['included']);await shot('orcamento-so-atividades');pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+versions[0]['id']+'/pdf');assert(await pdf.body()).startswith(b'%PDF');await review.get_by_role('button',name='Fechar conferência').click()
  h.mark(device+': only not-billed activities emit approved zero-total budget/PDF with null unit prices, positive real energy and idempotent lost-response recovery')
  cfg=await get('/api/precificacao');next(s for s in cfg['config']['services']if s['serviceId']==ids['ids']['free'])['dimensions'][0]['stages']=[];r=await ctx.request.patch(ORIGIN+'/api/precificacao',headers={'Origin':ORIGIN},data={'revision':cfg['revision'],'config':cfg['config']});assert r.ok,await r.text();await page.reload();await saved();await finance.get_by_role('button',name='Emitir orçamento',exact=True).click();await expect(review).to_be_visible();await review.get_by_role('checkbox').check();await expect(review.get_by_role('button',name='Confirmar emissão',exact=True)).to_be_disabled();await shot('energia-pendente-bloqueia');assert len(await get(base+'/orcamentos'))==2
  assert(await get(base+'/orcamentos/'+ids['version']))['snapshot']==ids['snapshot'];oldpdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert hashlib.sha256(await oldpdf.body()).hexdigest()==frozen_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('PRAGMA foreign_key_check').fetchall()==[];assert db.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0]==9
  assert not h.external and not h.page_errors,(h.external,h.page_errors);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  h.mark(device+': missing technical stages block free-only emission without fake energy; historical snapshot/PDF immutable, SQLite V8 integrity/FKs and no overflow/external calls')
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
   for device,v in [('desktop',{'width':1440,'height':1000}),('mobile390',{'width':390,'height':844}),('mobile320',{'width':320,'height':568})]:await device_case(browser,device,v)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
