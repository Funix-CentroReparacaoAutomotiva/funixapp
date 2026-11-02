"""PR17 audit decisions: global settings, truthful pending values, MR-only PDFs/schema.
Every device uses its own temporary file-backed database and owned API/Vite.
"""
import asyncio,json,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/pr17-ajustes/auditoria'

async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports();await h.start_api()
  vite=h.start(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'vite');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile',accept_downloads=True);await h.watch(ctx)
  page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN+'/configuracoes')
  await expect(page.get_by_label('Senha de acesso')).to_be_visible()
  r=await ctx.request.get(ORIGIN+'/api/catalogos');assert r.status==401
  await h.login(page)
  await expect(page.get_by_role('region',name='Configurações globais')).to_be_visible()
  await expect(page.get_by_role('navigation',name='Áreas da FUNIX').get_by_role('button',name='Configurações',exact=True)).to_have_attribute('aria-current','page')
  assert not any('/api/atendimentos' in r['path'] for r in h.api_requests)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def write(path,data,method='post'):
   r=await getattr(ctx.request,method)(ORIGIN+path,headers={'Origin':ORIGIN},data=data);assert r.ok,await r.text();return await r.json()
  global_area=page.get_by_role('navigation',name='Áreas da FUNIX')
  sections=page.get_by_role('navigation',name='Seções de Configurações')
  catalog=page.get_by_role('region',name='Manutenção de catálogos')
  # New piece + dirty guards on both global navigation and internal section.
  await catalog.get_by_role('button',name='+ Novo cadastro',exact=True).click()
  await page.get_by_label('Nome do catálogo',exact=True).fill('Peça QA '+device)
  await page.get_by_label('Código da peça',exact=False).fill('qa-audit-'+device)
  h.accept_dialogs=False
  await global_area.get_by_role('button',name='Funil',exact=True).click();assert page.url.endswith('/configuracoes')
  await sections.get_by_role('button',name='Precificação',exact=True).click()
  await expect(page.get_by_role('form',name='Editar catálogo')).to_be_visible();assert len(h.dialogs)==2
  h.accept_dialogs=True
  await page.get_by_role('button',name='Salvar catálogo',exact=True).click();await expect(page.get_by_role('form',name='Editar catálogo')).to_have_count(0)
  async def add_catalog(kind,name,service=None):
   await catalog.get_by_label('Tipo de catálogo',exact=True).select_option(kind)
   await catalog.get_by_role('button',name='+ Novo cadastro',exact=True).click()
   await page.get_by_label('Nome do catálogo',exact=True).fill(name)
   if service:await page.get_by_label('Serviço da dimensão',exact=True).select_option(label=service)
   await page.get_by_role('button',name='Salvar catálogo',exact=True).click();await expect(page.get_by_role('form',name='Editar catálogo')).to_have_count(0)
  await add_catalog('servico','Serviço QA '+device)
  await add_catalog('dimensao','Média QA','Serviço QA '+device)
  await add_catalog('diagnostico','Dano QA')
  await catalog.get_by_label('Tipo de catálogo',exact=True).select_option('peca')
  await catalog.get_by_label('Buscar no catálogo',exact=True).fill('qa-audit-'+device)
  await catalog.locator('.catalog-row').first.click();await page.get_by_label('Ativo para novas seleções',exact=True).uncheck()
  await page.get_by_role('button',name='Salvar catálogo',exact=True).click();await expect(catalog.locator('.catalog-row').first).to_contain_text('Inativo')
  await catalog.locator('.catalog-row').first.click();await page.get_by_role('button',name='Ver histórico de alterações',exact=True).click();await expect(catalog).to_contain_text('Revisão 2')
  await page.get_by_label('Ativo para novas seleções',exact=True).check();await page.get_by_role('button',name='Salvar catálogo',exact=True).click();await expect(catalog.locator('.catalog-row').first).to_contain_text('Ativo')
  await page.screenshot(path=str(ARTIFACTS/f'{device}-configuracoes-catalogos.png'))
  h.mark(device+': authenticated global settings without Atendimento; CRUD catalogs, history/inactivation and dirty navigation guards reuse existing managers')
  await sections.get_by_role('button',name='Precificação',exact=True).click();pricing=page.get_by_role('form',name='Configuração comercial',exact=True)
  await expect(pricing.get_by_role('button',name='Salvar configuração comercial',exact=True)).to_be_disabled()
  async def factor(group,name,value,index=1):
   await pricing.get_by_role('button',name='+ Adicionar '+group,exact=True).click()
   await pricing.get_by_label(f'Nome {group} {index}',exact=True).fill(name);await pricing.get_by_label(f'Fator {group} {index}',exact=True).fill(value)
  await factor('Tabelas comerciais','A','1');await factor('Cores','FC QA','1');await factor('Riscos','FR QA','1');await factor('MR','MR QA','1.2');await factor('MR','MR2 QA','2',2)
  await pricing.get_by_label('Capacidade diária global',exact=True).fill('4')
  await pricing.get_by_label('Adicionar serviço à configuração',exact=True).select_option(label='Serviço QA '+device)
  await pricing.get_by_label('Aplicar FC neste serviço',exact=True).select_option('true')
  await pricing.get_by_label('Serviço descontável',exact=True).check()
  await pricing.get_by_label('Preço base não dimensionado',exact=True).fill('889')
  await pricing.get_by_label('Adicionar dimensão ao serviço',exact=True).select_option(label='Média QA')
  await pricing.get_by_label('FD da dimensão',exact=True).fill('1')
  await pricing.get_by_role('button',name='+ Etapa técnica',exact=True).click()
  for label,value in [('Etapa técnica','Etapa QA'),('Dimensão técnica','Técnica QA'),('Energia base','2'),('Energia dimensional','3')]:await pricing.get_by_label(label,exact=True).fill(value)
  await pricing.get_by_label('Condições e ressalvas comerciais',exact=True).fill('SINTÉTICO — auditoria local, não executar serviço.')
  h.accept_dialogs=False
  await global_area.get_by_role('button',name='Conversas',exact=True).click();assert page.url.endswith('/configuracoes')
  await sections.get_by_role('button',name='Catálogos',exact=True).click();await expect(pricing.get_by_label('Preço base não dimensionado')).to_have_value('889')
  h.accept_dialogs=True
  await pricing.get_by_role('button',name='Salvar configuração comercial',exact=True).click();await expect(pricing.get_by_role('button',name='Salvar configuração comercial',exact=True)).to_be_disabled()
  await page.evaluate('document.querySelector(".app-viewport").scrollTop=0');await page.screenshot(path=str(ARTIFACTS/f'{device}-configuracoes-precificacao.png'))
  c=await get('/api/precificacao');assert c['config']['resaleMultipliers'][0]['factor']=='1.2'
  await page.reload();await page.get_by_role('navigation',name='Seções de Configurações').get_by_role('button',name='Precificação',exact=True).click()
  await expect(page.get_by_label('Preço base não dimensionado')).to_have_value('889')
  h.mark(device+': global pricing/factors/MR/energy/capacity/conditions saved and reloaded; no invented runtime defaults; dirty pricing remains protected')
  cats=(await get('/api/catalogos'))['items'];svc=next(x for x in cats if x['name']=='Serviço QA '+device);dim=next(x for x in cats if x['kind']=='dimensao');piece=next(x for x in cats if x['code']=='qa-audit-'+device)
  at=await write('/api/atendimentos',{'phone':'123456','name':'QA Auditoria '+device+' — SINTÉTICO'});path='/api/atendimentos/'+at['id']
  item=(await write(path+'/diagnosticos',{'pieceCodes':[piece['code']]}))[0]
  item=await write(path+'/diagnosticos/'+item['id'],{'revision':item['revision'],'services':[{'serviceId':svc['id'],'dimensionId':dim['id'],'quantity':q} for q in ['1','2']]},'patch')
  await write(path+'/componentes',{'pieceId':item['id'],'name':'Componente QA','quantity':'1','manualPrice':'375','notes':''})
  w=await get(path+'/cenarios');cfg=c['config']
  await write(path+'/parametros',{'revision':w['revision'],'tableId':cfg['tables'][0]['id'],'colorId':cfg['colors'][0]['id'],'riskId':cfg['risks'][0]['id'],'mrId':cfg['resaleMultipliers'][0]['id']},'patch')
  await page.goto(ORIGIN+'/atendimentos/'+at['id']+'?aba=diagnosticos');await page.locator('.diagnosis-open').first.click()
  editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True);first=editor.locator('.service').nth(0);second=editor.locator('.service').nth(1)
  finance=page.get_by_role('region',name='Painel financeiro',exact=True)
  await expect(first.locator('.calculated')).to_contain_text('889,00');await expect(second.locator('.calculated')).to_contain_text('1.778,00')
  # Delay the actual PATCH, then separately delay the post-commit GET. Old values must stay hidden in both phases.
  patch_wait=asyncio.Event();allow_patch=asyncio.Event();committed=asyncio.Event();get_wait=asyncio.Event();allow_get=asyncio.Event();held=False
  async def hold_patch(route):
   if route.request.method=='PATCH':
    patch_wait.set();await allow_patch.wait();response=await route.fetch();committed.set();await route.fulfill(response=response)
   else:await route.continue_()
  async def hold_get(route):
   nonlocal held
   if route.request.method=='GET' and committed.is_set() and not held:
    held=True;response=await route.fetch();get_wait.set();await allow_get.wait();await route.fulfill(response=response)
   else:await route.continue_()
  await page.route('**'+path+'/diagnosticos/'+item['id'],hold_patch);await page.route('**'+path+'/cenarios*',hold_get)
  await first.get_by_label('Quantidade do serviço').fill('0,5')
  await expect(first.locator('.calculated strong')).to_have_text('Calculando…');await expect(second.locator('.calculated strong')).to_have_text('R$ 1.778,00')
  await expect(finance.locator('.metric.final')).to_contain_text('Calculando…');await expect(second.get_by_label('Quantidade do serviço')).to_be_enabled()
  await asyncio.wait_for(patch_wait.wait(),10);await page.screenshot(path=str(ARTIFACTS/f'{device}-autosave-calculando.png'))
  allow_patch.set();await asyncio.wait_for(get_wait.wait(),10)
  await expect(first.locator('.calculated strong')).to_have_text('Calculando…');await expect(finance.locator('.metric.final')).to_contain_text('Calculando…')
  allow_get.set();await expect(editor).to_have_attribute('data-save-state','confirmed')
  await expect(first.locator('.calculated strong')).to_have_text('R$ 444,50');await page.unroute('**'+path+'/diagnosticos/'+item['id'],hold_patch);await page.unroute('**'+path+'/cenarios*',hold_get)
  h.mark(device+': only changed service says Calculando through debounce/PATCH and post-commit recalculation GET; unaffected row and editing remain available; totals never claim stale confirmation')
  async def unavailable(route):
   if route.request.method=='PATCH':await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'code':'QA','message':'Falha temporária QA'}}))
   else:await route.continue_()
  await page.route('**'+path+'/diagnosticos/'+item['id'],unavailable)
  await first.get_by_label('Quantidade do serviço').fill('0,75');await expect(editor.get_by_role('alert')).to_be_visible()
  await expect(first.locator('.calculated strong')).to_have_text('Valor não atualizado');await expect(second.locator('.calculated strong')).to_have_text('R$ 1.778,00')
  await expect(finance.locator('.metric.final')).to_contain_text('Não atualizado');await expect(first.get_by_label('Quantidade do serviço')).to_have_value('0,75')
  await page.screenshot(path=str(ARTIFACTS/f'{device}-autosave-erro.png'))
  await page.unroute('**'+path+'/diagnosticos/'+item['id'],unavailable);await editor.get_by_role('button',name='Tentar novamente',exact=True).click()
  await expect(editor).to_have_attribute('data-save-state','confirmed');await expect(first.locator('.calculated strong')).to_have_text('R$ 666,75')
  await first.get_by_label('Dimensão',exact=True).select_option('');await expect(editor).to_have_attribute('data-save-state','confirmed');await expect(first.locator('.calculated strong')).to_have_text('Rascunho incompleto')
  await first.get_by_label('Dimensão',exact=True).select_option(dim['id']);await expect(editor).to_have_attribute('data-save-state','confirmed');await expect(first.locator('.calculated strong')).to_have_text('R$ 666,75')
  await finance.locator('.summary').click()
  for label in ['Tabela','FC','FR','MR']:await expect(finance.get_by_label(label,exact=True)).to_be_visible()
  param_wait=asyncio.Event();allow_param=asyncio.Event()
  async def hold_param(route):
   if route.request.method=='PATCH':param_wait.set();await allow_param.wait()
   await route.continue_()
  await page.route('**'+path+'/parametros',hold_param)
  await finance.get_by_label('MR',exact=True).select_option(cfg['resaleMultipliers'][1]['id']);await asyncio.wait_for(param_wait.wait(),10)
  await expect(finance.locator('.metric.final')).to_contain_text('Calculando…');await expect(first.locator('.calculated strong')).to_have_text('Calculando…')
  allow_param.set();await expect(finance.locator('.metric').nth(1)).to_contain_text('750,00');await expect(first.locator('.calculated strong')).to_have_text('R$ 666,75');await page.unroute('**'+path+'/parametros',hold_param)
  await page.route('**'+path+'/parametros',unavailable)
  await finance.get_by_label('MR',exact=True).select_option(cfg['resaleMultipliers'][0]['id']);await expect(finance.get_by_role('alert')).to_be_visible()
  await expect(finance.locator('.metric.final')).to_contain_text('Não atualizado');await expect(finance.get_by_role('button',name='Emitir orçamento',exact=True)).to_be_disabled()
  await page.unroute('**'+path+'/parametros',unavailable);await finance.get_by_role('button',name='Atualizar valores',exact=True).click();await expect(finance.locator('.metric').nth(1)).to_contain_text('750,00')
  await finance.get_by_label('MR',exact=True).select_option(cfg['resaleMultipliers'][0]['id']);await expect(finance.locator('.metric').nth(1)).to_contain_text('450,00')
  await finance.get_by_role('button',name='Emitir orçamento',exact=True).click();review=page.get_by_role('dialog',name='Conferência do orçamento')
  await review.get_by_role('checkbox').check();await review.get_by_role('button',name='Confirmar emissão',exact=True).click();await expect(review.get_by_role('heading',name='Orçamento A emitido')).to_be_visible()
  async with page.expect_download() as pending:await review.get_by_role('button',name='Baixar PDF',exact=True).click()
  download=await pending.value;file=ARTIFACTS/f'{device}-orcamento-mr.pdf';await download.save_as(str(file))
  text_file=file.with_suffix('.txt');subprocess.run(['pdftotext','-layout',str(file),str(text_file)],check=True)
  text=text_file.read_text();assert 'MR do Atendimento: 1.2' in text and 'FCT' not in text and 'undefined' not in text,text
  assert 'manual' in text and '375,00' in text and '450,00' in text
  data=await get(path+'/componentes');assert all('fct' not in x for x in data)
  h.mark(device+': error stops pending indication, keeps inputs and recovers; dimension changes use backend; per-Atendimento selectors and direct issue remain; PDF has manual input plus MR and no FCT/undefined')
  assert not h.external,h.external;assert not h.page_errors,h.page_errors;assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
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
