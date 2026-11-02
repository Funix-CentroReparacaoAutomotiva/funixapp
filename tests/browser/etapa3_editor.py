"""Stage3 E01-E09/C05-C06, real local API/file SQLite; synthetic data only."""
import asyncio,hashlib,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/etapa3'
async def device_case(browser,device,viewport):
 h=Harness();h.check_ports();ctx=None;page=None
 try:
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{ComponentRepository}from'./server/components.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db),parts=new ComponentRepository(db);parts.save(f.at.id,{pieceId:f.item.id,name:'Componente QA',quantity:'0.25',manualPrice:'10',notes:''});const damage=f.commercial.saveCatalog({kind:'diagnostico',name:'Diagnóstico QA'}),b=new BudgetRepository(db),r={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'stage3-browser-frozen-budget'});const s=f.scenarios.list(f.at.id)[0],other=f.scenarios.create(f.at.id,{name:'Outro QA',duplicateFrom:s.id,sourceRevision:s.revision});const empty=f.commercial.add(f.at.id,{pieceCodes:['retrovisor__motorista']}).find(p=>p.id!==f.item.id);writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,piece:f.item.id,empty:empty.id,service:f.service.id,dimension:f.dimension.id,damage:damage.id,other:other.id,version:v.id,snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios')
  async def write(path,data):
   r=await ctx.request.patch(ORIGIN+path,headers={'Origin':ORIGIN},data=data);assert r.ok,await r.text();return await r.json()
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  async def saved():await expect(page.locator('.approved-editor')).to_have_attribute('data-save-state','confirmed')
  async def back():await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click();await expect(page.locator('.diagnosis-list')).to_be_visible()
  async def open_piece(id):
   await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos&tela=peca&peca='+id);await expect(page.locator('.approved-editor')).to_be_visible();await saved()
  await page.goto(ORIGIN);await h.login(page);await open_piece(ids['piece']);editor=page.locator('.approved-editor');finance=page.locator('.approved-finance');original=await ws();pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');pdf_hash=hashlib.sha256(await pdf.body()).hexdigest()
  # One control row; filled/unfilled circles and no decorative capsule.
  row=editor.locator('.diagnosis-actions');controls=[row.get_by_role('button',name='Habilitar peça neste cenário'),row.get_by_label('Diagnóstico da peça'),row.get_by_role('button',name='Observação da peça')];boxes=[await c.bounding_box()for c in controls];assert max(b['y']+b['height']/2 for b in boxes)-min(b['y']+b['height']/2 for b in boxes)<2;assert boxes[0]['x']+boxes[0]['width']<=boxes[1]['x']and boxes[1]['x']+boxes[1]['width']<=boxes[2]['x']
  switch=editor.get_by_role('button',name='Habilitar serviço neste cenário').first;await expect(switch.locator('circle')).to_have_attribute('fill','currentColor');await switch.focus();await page.keyboard.press('Space');await saved();await expect(switch.locator('circle')).to_have_attribute('fill','none');w=await ws();assert w['scenarios'][1]['serviceFlags']==original['scenarios'][1]['serviceFlags'];await switch.click();await saved()
  arrow=page.locator('.back-detail');a=await arrow.bounding_box();svg=await arrow.locator('svg').bounding_box();assert abs((a['x']+a['width']/2)-(svg['x']+svg['width']/2))<1 and abs((a['y']+a['height']/2)-(svg['y']+svg['height']/2))<1
  assert await switch.evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)';await row.get_by_label('Diagnóstico da peça').select_option(ids['damage']);await saved();await shot('editor-preenchido')
  h.mark(device+': single toggle/select/notes row, filled/unfilled knob without halo, keyboard toggles, centered back, scenario masks and official values preserved')
  # Existing incomplete quantity is local, not a failed/never-ending request; valid correction autosaves.
  qty=editor.get_by_label('Quantidade do serviço').first;requests=[];record=lambda r:requests.append((r.method,r.url))if '/api/'in r.url else None;page.on('request',record);await qty.fill('0');await expect(editor).to_have_attribute('data-save-state','incomplete');await expect(finance.locator('.metric.final span')).to_have_text('Incompleto');await page.wait_for_timeout(650);page.remove_listener('request',record);assert requests==[],requests;assert next(p for p in(await ws())['items']if p['id']==ids['piece'])['services'][0]['quantity']=='3';await shot('rascunho-incompleto')
  await qty.fill('0,25');await saved();assert next(p for p in(await ws())['items']if p['id']==ids['piece'])['services'][0]['quantity']=='0.25';await back();assert not any('alterações não salvas'in s.lower()for s in h.dialogs)
  h.mark(device+': invalid existing quantity sends no request, summary ends in Incompleto, corrected fraction autosaves and confirmed back has no false discard warning')
  # Empty cards invoke existing add actions and focus real fields, without fabricating catalog entries/prices.
  await open_piece(ids['empty']);await expect(editor.get_by_role('button',name='Adicionar primeiro serviço')).to_have_css('border-top-style','dashed');await expect(editor.get_by_role('button',name='Adicionar primeiro componente')).to_be_visible();await shot('cards-vazios')
  await editor.get_by_role('button',name='Adicionar primeiro serviço').click();await expect(editor.get_by_label('Serviço',exact=True)).to_be_focused();await expect(editor).to_have_attribute('data-save-state','incomplete');await expect(finance.locator('.metric.final span')).to_have_text('Incompleto');await expect(editor.get_by_role('button',name='Adicionar primeiro serviço')).to_have_count(0)
  await editor.get_by_label('Serviço',exact=True).select_option(ids['service']);await saved();await expect(finance.locator('.metric.final span')).to_have_text('Incompleto');await expect(editor.locator('.calculated strong')).to_have_text('Rascunho incompleto');await editor.get_by_label('Dimensão',exact=True).select_option(ids['dimension']);await saved()
  await editor.get_by_role('button',name='Adicionar primeiro componente').click();await expect(editor.get_by_label('Descrição do componente')).to_be_focused();await expect(editor).to_have_attribute('data-save-state','incomplete');await expect(finance.locator('.metric.final span')).to_have_text('Incompleto');await editor.get_by_label('Descrição do componente').fill('Componente sem preço QA');await saved();await expect(editor.get_by_label('Total do componente')).to_have_text('Preço não informado');await expect(finance.locator('.metric.final')).not_to_contain_text('Calculando')
  await editor.get_by_label('Preço unitário do componente').fill('0');await saved();await expect(editor.get_by_label('Total do componente')).to_have_text('R$ 0,00');await shot('campos-completos')
  h.mark(device+': dashed empty cards add/focus inputs and disappear; blank service/component stops in incomplete state; saved missing dimension/price is explicit, zero stays a real zero')
  # Missing table/MR are configuration states, not loading. Options remain usable to resolve them.
  w=await ws();await write(base+'/parametros',{'revision':w['revision'],'tableId':None,'mrId':None});await page.reload();await saved();await expect(finance).to_have_attribute('data-calculation-state','missing');await finance.locator('.summary').click();await expect(finance.locator('.notice')).to_contain_text('Configuração pendente');await expect(finance.get_by_label('Tabela',exact=True)).to_be_enabled();await expect(editor.locator('.calculated strong')).to_have_text('Configuração pendente');await expect(editor.get_by_label('Total do componente')).to_have_text('MR não configurado');await shot('configuracao-pendente')
  await finance.get_by_label('Tabela',exact=True).select_option('table');await saved();await expect(finance.get_by_label('MR',exact=True)).to_be_enabled();await finance.get_by_label('MR',exact=True).select_option('mr');await expect(editor.get_by_label('Total do componente')).to_have_text('R$ 0,00');await finance.locator('.summary').click()
  h.mark(device+': missing table/MR shows configuration reasons without fake zeros/loading; existing explicit selectors resolve it without changing factor or engine rules')
  # Slow real write: saving is not confirmation; normal status does not move layout or focus.
  await editor.get_by_role('button',name='Observação da peça').click();note=editor.get_by_role('textbox',name='Observação da peça');gate=asyncio.Event();started=asyncio.Event()
  async def delayed(route):
   if route.request.method=='PATCH':started.set();await gate.wait()
   await route.continue_()
  await page.route('**/diagnosticos/*',delayed);await note.fill('Anotação QA pendente');await asyncio.wait_for(started.wait(),10);await expect(editor).to_have_attribute('data-save-state','saving');assert next(p for p in(await ws())['items']if p['id']==ids['empty'])['notes']=='';await note.fill('Última anotação QA');await expect(note).to_be_focused();status=await editor.locator('.unsaved').bounding_box();assert status['width']<=1 and status['height']<=1;await shot('salvando-sem-deslocamento');pending_url=page.url;dialogs=len(h.dialogs);await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click();assert page.url==pending_url and len(h.dialogs)==dialogs;await expect(editor).to_be_visible();gate.set();await saved();await page.unroute('**/diagnosticos/*',delayed);assert next(p for p in(await ws())['items']if p['id']==ids['empty'])['notes']=='Última anotação QA'
  h.mark(device+': delayed save does not claim confirmed, preserves focus/newest typing, normal status stays outside layout and ack establishes actual persistence')
  # Native sheet keeps functional search/global queue and nested destructive confirmation/recovery.
  await back();opener=page.get_by_role('button',name='+ Adicionar peça',exact=True);await opener.click();sheet=page.get_by_role('dialog',name='Adicionar peça à composição');search=sheet.get_by_role('textbox',name='Buscar peça em todas as vistas');await expect(search).to_be_focused();close=sheet.get_by_role('button',name='Fechar seleção',exact=True);await close.focus();await page.keyboard.press('Shift+Tab');assert await sheet.evaluate('(e)=>e.contains(document.activeElement)');await page.keyboard.press('Tab');await expect(close).to_be_focused();await page.keyboard.press('Tab');await expect(search).to_be_focused();box=await sheet.bounding_box();assert abs(box['y']+box['height']-viewport['height'])<2;assert box['x']>=0 and box['x']+box['width']<=viewport['width']+1;await search.fill('retrovisor__motorista');await shot('bottom-sheet-busca')
  await sheet.locator('.piece-options button').click();confirm=page.get_by_role('dialog',name='Confirmar remoção da composição');await expect(confirm).to_contain_text('conteúdo');await confirm.get_by_role('button',name='Cancelar').click();await expect(sheet).to_be_visible();assert any(p['id']==ids['empty']for p in(await ws())['items']);await page.keyboard.press('Escape');await expect(sheet).to_have_count(0);await expect(opener).to_be_focused()
  await opener.click();await search.fill('capo');await sheet.get_by_role('button',name='Fechar seleção',exact=True).click();await expect(opener).to_be_focused()
  h.mark(device+': bottom sheet anchored to viewport/safe-area, unified search and global removal confirmation preserved, Cancel/Escape/close restore focus without mutation')
  # Transport failure preserves draft and explicit recovery, followed by reopen and immutable history.
  await open_piece(ids['empty']);await editor.get_by_role('button',name='Observação da peça').click();note=editor.get_by_role('textbox',name='Observação da peça')
  async def fail(route):await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'message':'QA indisponivel'}}))
  await page.route('**/diagnosticos/*',fail);await note.fill('Rascunho QA em falha');await expect(editor.get_by_role('alert')).to_contain_text('QA indisponivel');await expect(editor).to_have_attribute('data-save-state','error');await expect(note).to_have_value('Rascunho QA em falha');await shot('erro-recuperavel');await page.unroute('**/diagnosticos/*',fail);await editor.get_by_role('button',name='Tentar novamente').click();await saved();await back();await open_piece(ids['empty']);await editor.get_by_role('button',name='Observação da peça').click();await expect(editor.get_by_role('textbox',name='Observação da peça')).to_have_value('Rascunho QA em falha')
  assert(await get(base+'/orcamentos/'+ids['version']))['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
  assert not h.external and not h.page_errors,(h.external,h.page_errors);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  h.mark(device+': real HTTP error keeps fields/dirty state and explicit retry persists before reopening; immutable snapshot/PDF, SQLite integrity, no overflow/external calls/page errors')
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
