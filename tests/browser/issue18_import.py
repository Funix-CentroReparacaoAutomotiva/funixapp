"""Offline import into isolated V7, then real API/UI on desktop/mobile. Synthetic rows only."""
import asyncio,json,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/issue18'

async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import {openDatabase} from './server/database.ts';import{planImport,applyImport}from'./server/coda-import.ts';import{codaFixture}from'./server/tests/fixtures/coda-import.ts';const db=openDatabase(process.argv[1]);const source=codaFixture(),plan=planImport(db,source);if(plan.report.conflicts.length)throw Error('Unexpected conflicts');applyImport(db,source,plan.planHash);const repeat=planImport(db,source);if(repeat.report.inserts)throw Error('Not idempotent');db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite')],cwd=ROOT,check=True)
  await h.start_api()
  vite=h.start(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'vite');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile');await h.watch(ctx)
  page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN+'/configuracoes');await h.login(page)
  catalog=page.get_by_role('region',name='Manutenção de catálogos')
  for kind,name in [('servico','Serviço sintético de QA'),('dimensao','Dimensão sintética QA'),('diagnostico','Dano sintético QA')]:
   await catalog.get_by_label('Tipo de catálogo',exact=True).select_option(kind);await expect(catalog).to_contain_text(name)
  await page.screenshot(path=str(ARTIFACTS/f'{device}-catalogos.png'))
  await page.get_by_role('navigation',name='Seções de Configurações').get_by_role('button',name='Precificação',exact=True).click()
  await expect(page.get_by_label('Preço base não dimensionado',exact=True)).to_have_value('100.01')
  await expect(page.get_by_label('FD da dimensão',exact=True)).to_have_value('1')
  await expect(page.get_by_label('Energia base',exact=True)).to_have_value('2')
  await expect(page.get_by_label('Energia dimensional',exact=True)).to_have_value('3')
  await expect(page.get_by_label('Nome MR 1',exact=True)).to_have_value('Padrão')
  await expect(page.get_by_label('Fator MR 1',exact=True)).to_have_value('1.2')
  await page.screenshot(path=str(ARTIFACTS/f'{device}-precificacao.png'))
  h.mark(device+': imported catalogs and service/dimension/energy editable via existing settings; approved MR Padrão 1.2 is present')
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def write(path,data,method='post'):
   r=await getattr(ctx.request,method)(ORIGIN+path,headers={'Origin':ORIGIN},data=data);assert r.ok,await r.text();return await r.json()
  at=await write('/api/atendimentos',{'phone':'123','name':'QA IMPORTAÇÃO SINTÉTICA '+device});path='/api/atendimentos/'+at['id']
  await write(path+'/diagnosticos',{'pieceCodes':['capo']})
  await page.goto(ORIGIN+'/atendimentos/'+at['id']+'?aba=diagnosticos');await page.locator('.diagnosis-open').first.click()
  editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True)
  await editor.get_by_label('Diagnóstico da peça',exact=True).select_option(label='Dano sintético QA')
  await editor.get_by_role('button',name='Adicionar serviço',exact=True).click()
  await editor.get_by_label('Serviço',exact=True).select_option(label='Serviço sintético de QA')
  await editor.get_by_label('Dimensão',exact=True).select_option(label='Dimensão sintética QA')
  await expect(editor.get_by_role('status')).to_contain_text('Salvo')
  finance=page.get_by_role('region',name='Painel financeiro',exact=True)
  if not await finance.get_by_label('Tabela',exact=True).is_visible():await finance.locator('.summary').click()
  for label,name in [('Tabela','Tabela QA sintética'),('FC','1,00'),('FR','1,00')]:
   await finance.get_by_label(label,exact=True).select_option(label=name)
   await expect(finance.get_by_label(label,exact=True)).to_be_enabled()
   # Wait for the actual settings write/refresh, not a browser-local value.
   key={'Tabela':'tableId','FC':'colorId','FR':'riskId'}[label]
   for _ in range(50):
    if (await get(path+'/parametros'))['settings'][key]:break
    await asyncio.sleep(.1)
   else:raise AssertionError('Parameter was not persisted')
  await expect(editor.locator('.calculated strong')).to_have_text('R$ 100,05')
  assert await finance.get_by_label('MR',exact=True).locator('option').count()==2
  await expect(finance.get_by_label('MR',exact=True)).to_have_value('')
  assert not (await get(path+'/parametros'))['settings'].get('mrId')
  w=await get(path+'/cenarios');assert w['calculations'][0]['energy']=='5';assert w['calculations'][0]['days']=='2';assert w['calculations'][0]['errors']==[]
  await page.screenshot(path=str(ARTIFACTS/f'{device}-diagnostico.png'))
  await page.reload();await page.locator('.diagnosis-open').first.click()
  await expect(page.get_by_label('Serviço',exact=True)).to_have_value(w['items'][0]['services'][0]['serviceId'])
  h.mark(device+': real UI selects imported diagnosis/service/dimension/table/FC/FR; autosave, exact total, energy, days and reload confirmed; MR is registered but not automatically selected')
  # The approved direction option is imported, never inferred from Coda's curator factor.
  cfg=await get('/api/precificacao');mr=next(m for m in cfg['config']['resaleMultipliers'] if m['name']=='Padrão')
  assert mr['factor']=='1.2'
  finance=page.get_by_role('region',name='Painel financeiro',exact=True)
  editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True)
  await editor.get_by_role('button',name='Adicionar componente',exact=True).click()
  await editor.get_by_label('Descrição do componente',exact=True).fill('Componente QA sintético')
  await editor.get_by_label('Preço unitário do componente',exact=True).fill('100')
  await expect(editor.get_by_role('status')).to_contain_text('Salvo')
  current=await get(path+'/cenarios');request={'scenarioId':current['selectedId'],'negotiation':{'mode':'none'}}
  pending=await write(path+'/orcamentos/previa',request);assert pending['canEmit'] is False
  assert any('MR do Atendimento' in e for e in pending['snapshot']['calculation']['errors'])
  if not await finance.get_by_label('MR',exact=True).is_visible():await finance.locator('.summary').click()
  await finance.get_by_label('MR',exact=True).select_option(mr['id'])
  for _ in range(50):
   if (await get(path+'/parametros'))['settings'].get('mrId')==mr['id']:break
   await asyncio.sleep(.1)
  else:raise AssertionError('Approved MR selection not saved')
  preview=await write(path+'/orcamentos/previa',request)
  assert preview['canEmit'] is True and preview['snapshot']['calculation']['componentSubtotal']=='120'
  assert preview['snapshot']['calculation']['serviceSubtotal']=='100.05' and preview['snapshot']['calculation']['total']=='220.05'
  await page.screenshot(path=str(ARTIFACTS/f'{device}-mr-aprovado.png'))
  await page.reload();finance=page.get_by_role('region',name='Painel financeiro',exact=True)
  if not await finance.get_by_label('MR',exact=True).is_visible():await finance.locator('.summary').click()
  await expect(finance.get_by_label('MR',exact=True)).to_have_value(mr['id'])
  h.mark(device+': imported Padrão MR selected manually, persists on reload, prices component 100 as 120 and leaves service unchanged')
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
