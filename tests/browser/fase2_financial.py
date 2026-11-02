"""Fase2: real API, disposable synthetic SQLite and unchanged four-column geometry."""
import asyncio,hashlib,json,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/fase2'
async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{ComponentRepository}from'./server/components.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db),c=f.pricing.get();c.config.tables=[{id:'padrao',name:'Padrão',factor:'1'},{id:'outra',name:'Parceria',factor:'0.8'}];c.config.colors=[{id:'c0',name:'C0',factor:'0.91'},{id:'c1',name:'C1',factor:'1.01'},{id:'c2',name:'C2',factor:'1.21'}];c.config.risks=[{id:'r0',name:'R0',factor:'0.89'},{id:'r1',name:'R1',factor:'1.06'},{id:'r2',name:'R2',factor:'1.24'},{id:'r3',name:'R3',factor:'1.59'}];c.config.defaults={tableId:'padrao',colorId:'c1',riskId:'r1',mrPercent:'20'};f.pricing.save({revision:c.revision,config:c.config});const at=f.atendimentos.create({phone:'123',name:'QA Fase2 SINTETICO'}),p=f.commercial.add(at.id,{pieceCodes:['capo']})[0];f.commercial.updateDiagnosis(at.id,p.id,{revision:p.revision,services:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1'}]});const parts=new ComponentRepository(db);for(const [name,price,quantity]of[['QA A','100','1'],['QA B','200','1'],['QA fracionário','10.01','0.25'],['QA zero','0','1']])parts.save(at.id,{pieceId:p.id,name,manualPrice:price,quantity,notes:''});const scene=f.scenarios.list(at.id)[0],two=f.scenarios.create(at.id,{name:'Outro',duplicateFrom:scene.id,sourceRevision:scene.revision});writeFileSync(process.argv[2],JSON.stringify({at:at.id,piece:p.id,one:scene.id,two:two.id}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios?scenarioId='+ids['one'])
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  await page.goto(ORIGIN);await h.login(page);await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');finance=page.get_by_role('region',name='Painel financeiro');await finance.locator('.summary').click();mr=finance.get_by_label('MR',exact=True)
  await expect(mr).to_have_value('20');await expect(finance.get_by_label('Tabela',exact=True)).to_have_value('padrao');await expect(finance.get_by_label('FC',exact=True)).to_have_value('c1');await expect(finance.get_by_label('FR',exact=True)).to_have_value('r1')
  assert await finance.get_by_label('FC',exact=True).locator('option').all_text_contents()==['Selecionar…','C0','C1','C2'];assert await finance.get_by_label('FR',exact=True).locator('option').all_text_contents()==['Selecionar…','R0','R1','R2','R3'];assert await mr.evaluate('(e)=>e.tagName')=='INPUT'
  boxes=[await finance.get_by_label(label,exact=True).bounding_box() for label in ['Tabela','FC','FR','MR']];assert max(b['y']for b in boxes)-min(b['y']for b in boxes)<1;assert max(b['width']for b in boxes)-min(b['width']for b in boxes)<1;assert all(b['height']==37 for b in boxes);assert all(boxes[i]['x']+boxes[i]['width']<boxes[i+1]['x']for i in range(3));assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');await shot('padroes-quatro-colunas')
  h.mark(device+': persisted approved defaults, FC/FR names, four equal columns at original 37px, no overflow',boxes=boxes)
  await page.locator('.diagnosis-open').first.click();editor=page.get_by_role('region',name='Editor de diagnóstico');await expect(editor.get_by_label('MR do componente').first).to_have_text('+20%');await shot('editor-mr-compartilhado')
  async def enter(value,canonical):
   await expect(mr).to_be_enabled();await mr.fill(value);await expect(mr).to_have_value(value);await mr.press('Enter')
   for _ in range(150):
    s=await get(base+'/parametros')
    if s['settings'].get('mrPercent')==canonical and await finance.get_attribute('data-calculation-state')=='current':break
    await asyncio.sleep(.02)
   else:raise AssertionError('MR not confirmed '+value)
   await expect(mr).to_have_value(canonical)
  for value,canonical,subtotal in [('30','30','393.2625'),('0','0','302.5125'),('25,5','25.5','379.65'),('20','20','363.0125')]:
   await enter(value,canonical);await expect(editor.get_by_label('MR do componente').first).to_have_text(('+'if canonical!='0'else'')+canonical.replace('.',',')+'%');w=await ws();assert w['calculations'][0]['componentSubtotal']==subtotal,(value,w['calculations'][0]['componentSubtotal']);assert all(l['factors'].get('MRPercent')==canonical for l in w['calculations'][0]['lines']if l['kind']=='component');await shot('mr-'+canonical.replace('.','_'))
  h.mark(device+': free MR20/30/0/25.5, exact official totals and fractional quantities; explicit manual zero remains zero')
  before=await get(base+'/parametros');writes=[];listener=lambda r:writes.append(r.post_data_json)if r.method=='PATCH'and r.url.endswith('/parametros')else None;page.on('request',listener)
  for value in ['','-1','NaN','1e2','25,']:
   await mr.fill(value);await mr.press('Tab');await expect(finance).to_have_attribute('data-calculation-state','incomplete');await expect(editor.get_by_label('Total do componente').first).to_have_text('MR incompleto');assert await get(base+'/parametros')==before
  assert not writes;page.remove_listener('request',listener);await shot('mr-incompleto');await enter('20','20');h.mark(device+': raw incomplete/invalid MR never writes zero or replaces saved settings; emission blocked until corrected')
  for label,value in [('Tabela','outra'),('FC','c0'),('FR','r0')]:
   await finance.get_by_label(label,exact=True).select_option(value);await expect(finance).to_have_attribute('data-calculation-state','current')
  await enter('30','30');await page.reload();await expect(finance.locator('.summary')).to_be_visible();await finance.locator('.summary').click();await expect(mr).to_have_value('30');await expect(finance.get_by_label('FC',exact=True)).to_have_value('c0');await h.restart_api();await page.reload();await h.login(page);await finance.locator('.summary').click();await expect(mr).to_have_value('30')
  h.mark(device+': manual table/FC/FR/MR preserved across reload and API restart')
  # A committed response can be lost: read first, no blind repeat.
  async def lose(route):
   if route.request.method=='PATCH':await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**/parametros',lose);await mr.fill('25,5');await mr.press('Enter');await expect(finance.get_by_role('alert')).to_be_visible();await expect(mr).to_have_value('25,5');await page.unroute('**/parametros',lose);page.on('request',listener);await finance.get_by_role('button',name='Atualizar valores',exact=True).click();await expect(finance).to_have_attribute('data-calculation-state','current');assert not writes;page.remove_listener('request',listener);await expect(mr).to_have_value('25.5')
  h.mark(device+': lost committed MR response keeps draft and reconciles by read only without repeat write')
  # Real stale revision: no silent overwrite of concurrent MR.
  raced=[]
  async def conflict(route):
   if route.request.method=='PATCH'and not raced:
    raced.append(1);s=await get(base+'/parametros');r=await ctx.request.patch(ORIGIN+base+'/parametros',headers={'Origin':ORIGIN},data={'revision':s['revision'],'mrPercent':'40'});assert r.ok
   await route.continue_()
  await page.route('**/parametros',conflict);await mr.fill('35');await mr.press('Enter');await expect(finance.get_by_role('alert')).to_be_visible();await page.unroute('**/parametros',conflict);await finance.get_by_role('button',name='Atualizar valores',exact=True).click();await expect(finance).to_have_attribute('data-calculation-state','incomplete');assert(await get(base+'/parametros'))['settings']['mrPercent']=='40';await expect(mr).to_have_value('35');await enter('35','35');await shot('recuperacao-mr');h.mark(device+': concurrent MR retained until explicit read-first recovery and operator confirmation, no silent overwrite')
  # Stable names/IDs when global factors/defaults change; existing MR stays35.
  await page.goto(ORIGIN+'/configuracoes');await page.get_by_role('navigation',name='Seções de Configurações').get_by_role('button',name='Precificação',exact=True).click()
  await page.get_by_label('Fator Cores 2',exact=True).fill('1.05');await page.get_by_label('Fator Riscos 2',exact=True).fill('1.15');await page.get_by_label('MR padrão (%)',exact=True).fill('50');await page.get_by_label('FC padrão',exact=True).scroll_into_view_if_needed();await shot('configuracoes-padroes');await page.get_by_role('button',name='Salvar configuração comercial',exact=True).click();await expect(page.get_by_role('button',name='Salvar configuração comercial',exact=True)).to_be_disabled()
  r=await ctx.request.post(ORIGIN+'/api/atendimentos',headers={'Origin':ORIGIN},data={'phone':'456','name':'QA independente'});assert r.ok;other=await r.json();s=await get('/api/atendimentos/'+other['id']+'/parametros');assert s['settings']['mrPercent']=='50'and s['settings']['colorId']=='c1';assert(await get(base+'/parametros'))['settings']['mrPercent']=='35'
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await finance.locator('.summary').click();await expect(finance.get_by_label('FC',exact=True).locator('option[value="c1"]')).to_have_text('C1');await expect(mr).to_have_value('35');h.mark(device+': edited FC/FR values retain stable names/IDs; new global MR default applies only to future Atendimento')
  assert not h.external and not h.page_errors;(ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'synthetic':True,'results':h.results},ensure_ascii=False,indent=2)+'\n')
 except Exception as e:
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-falha.png')))
  (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'synthetic':True,'results':h.results,'error':str(e)},ensure_ascii=False,indent=2)+'\n');raise
 finally:
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
