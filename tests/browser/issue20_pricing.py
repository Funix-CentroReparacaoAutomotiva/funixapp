"""Issue20: real local API + V7 SQLite, admin flags and V20 financial flow. Synthetic data only."""
import asyncio,json,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/issue20'

async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db);const svc=f.commercial.saveCatalog({kind:'servico',name:'Serviço QA protegido'}),dim=f.commercial.saveCatalog({kind:'dimensao',name:'Dimensão QA protegida',serviceId:svc.id});const cfg=structuredClone(f.config);cfg.services[0].base='100';cfg.colors[0].factor='1.5';cfg.risks[0].factor='2';cfg.resaleMultipliers[0].factor='2';cfg.tables=[['standard','1'],['partner','0.8'],['team','0.6'],['rework','0']].map(([id,factor])=>({id,name:'Tabela QA '+id,factor}));cfg.services.push({serviceId:svc.id,base:'50',colorFactorEnabled:true,discountable:true,billable:true,dimensions:[{...cfg.services[0].dimensions[0],dimensionId:dim.id}]});f.pricing.save({revision:f.pricing.get().revision,config:cfg});const item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1'},{serviceId:svc.id,dimensionId:dim.id,quantity:'1'}]});f.pricing.saveSettings(f.at.id,{revision:f.pricing.settings(f.at.id).revision,tableId:'standard'});const part=(await import('./server/components.ts')).ComponentRepository;new part(db).save(f.at.id,{pieceId:item.id,name:'Componente QA MR global',quantity:'1',manualPrice:'10',notes:''});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,protected:svc.id}),{mode:0o600});db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());path='/api/atendimentos/'+ids['at']
  await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'vite');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile',accept_downloads=True);await h.watch(ctx)
  page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN+'/configuracoes');await h.login(page)
  await page.get_by_role('navigation',name='Seções de Configurações').get_by_role('button',name='Precificação',exact=True).click()
  section=page.locator('.config-section').filter(has=page.get_by_role('heading',name='Serviço QA protegido',exact=True))
  await section.get_by_label('Aplicar FC neste serviço',exact=True).select_option('false')
  await section.get_by_label('Serviço descontável',exact=True).uncheck()
  await section.get_by_label('Serviço faturável',exact=True).select_option('false')
  await section.scroll_into_view_if_needed();await page.screenshot(path=str(ARTIFACTS/f'{device}-flags.png'))
  await page.get_by_role('button',name='Salvar configuração comercial',exact=True).click()
  await expect(page.get_by_role('button',name='Salvar configuração comercial',exact=True)).to_be_disabled()
  await page.reload();await page.get_by_role('navigation',name='Seções de Configurações').get_by_role('button',name='Precificação',exact=True).click()
  section=page.locator('.config-section').filter(has=page.get_by_role('heading',name='Serviço QA protegido',exact=True))
  await expect(section.get_by_label('Aplicar FC neste serviço',exact=True)).to_have_value('false');await expect(section.get_by_label('Serviço descontável',exact=True)).not_to_be_checked()
  h.mark(device+': admin saves FC off, discount off and independent billable flag; reload confirms V7 persistence')
  async def get(p):
   r=await ctx.request.get(ORIGIN+p);assert r.ok,await r.text();return await r.json()
  async def write(p,data,method='post'):
   r=await getattr(ctx.request,method)(ORIGIN+p,headers={'Origin':ORIGIN},data=data);assert r.ok,await r.text();return await r.json()
  cfg=await get('/api/precificacao');protected=next(s for s in cfg['config']['services'] if s['serviceId']==ids['protected']);assert protected['billable'] is False
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await page.locator('.diagnosis-open').first.click()
  editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True);finance=page.get_by_role('region',name='Painel financeiro',exact=True)
  await expect(editor.locator('.calculated strong').nth(0)).to_have_text('R$ 300,00');await expect(editor.locator('.calculated strong').nth(1)).to_have_text('R$ 100,00')
  if not await finance.get_by_label('Tabela',exact=True).is_visible():await finance.locator('.summary').click()
  for table_id,total in [('partner','340'),('team','260'),('rework','20'),('standard','420')]:
   await finance.get_by_label('Tabela',exact=True).select_option(table_id)
   for _ in range(60):
    w=await get(path+'/cenarios')
    if w['settings']['tableId']==table_id and w['calculations'][0]['total']==total:break
    await asyncio.sleep(.1)
   else:raise AssertionError('FV total not persisted')
   assert w['calculations'][0]['componentSubtotal']=='20';assert w['calculations'][0]['energy']=='10'
   await expect(finance.get_by_label('Tabela',exact=True)).to_be_enabled()
  h.mark(device+': four FV including zero use existing UI; FC only eligible service, FR both, MR component unchanged, energy independent')
  await finance.locator('.neg-head').click();amount=finance.get_by_label('Valor em reais',exact=True);await amount.fill('300,01');await amount.blur()
  await finance.get_by_role('button',name='Emitir orçamento',exact=True).click()
  review=page.get_by_role('dialog',name='Conferência do orçamento',exact=True)
  await expect(review).to_contain_text('descontáveis');await expect(review.get_by_role('button',name='Confirmar emissão',exact=True)).to_be_disabled()
  await review.get_by_role('button',name='Fechar conferência',exact=True).click();await amount.fill('100');await amount.blur()
  await finance.get_by_role('button',name='Emitir orçamento',exact=True).click();await expect(review).to_be_visible()
  await review.get_by_label('Conferi o escopo, as condições e o total efetivo.',exact=True).check();await review.get_by_role('button',name='Confirmar emissão',exact=True).click()
  await expect(review).to_contain_text('Orçamento A emitido')
  versions=await get(path+'/orcamentos');assert len(versions)==1;v=await get(path+'/orcamentos/'+versions[0]['id']);c=v['snapshot']['calculation']
  assert c['total']=='320' and c['discountEligibleSubtotal']=='300' and c['componentSubtotal']=='20'
  assert [l['total'] for l in c['lines'] if l['kind']=='service']==['300','100']
  pdf=await ctx.request.get(ORIGIN+path+'/orcamentos/'+v['id']+'/pdf');assert pdf.ok and (await pdf.body()).startswith(b'%PDF')
  await review.get_by_role('button',name='Fechar conferência',exact=True).click();await page.screenshot(path=str(ARTIFACTS/f'{device}-diagnostico.png'))
  h.mark(device+': discount above eligible subtotal cannot emit; permitted mixed-service discount emits immutable budget/PDF with protected line and MR unchanged')
  assert h.external==[] and h.page_errors==[],(h.external,h.page_errors)
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
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   try:
    for device,viewport in [('desktop',{'width':1440,'height':960}),('mobile',{'width':390,'height':844})]:results+=await device_case(browser,device,viewport)
   finally:await browser.close()
 except Exception:error=traceback.format_exc();print(error,flush=True)
 (ARTIFACTS/'resultados.json').write_text(json.dumps({'pass':error is None,'results':results,'error':error},ensure_ascii=False,indent=2)+'\n')
 if error:raise RuntimeError(error)
if __name__=='__main__':asyncio.run(run())
