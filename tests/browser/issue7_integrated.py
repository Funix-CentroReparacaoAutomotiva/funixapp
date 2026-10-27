"""Issue #7 integrated acceptance: real UI/API/SQLite and real immutable PDFs.
All names, catalogs and prices are explicitly synthetic QA data, never seeded in the app.
Requires local Chromium/Playwright and pdftotext for independent PDF verification.
"""
import asyncio,json,re,subprocess,traceback,uuid
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN

from scenario_ui import menu,active_scenario,select_named_scenario,add_scenario,compare

ARTIFACTS=ROOT/'docs/evidencias/issue7'

async def run():
 h=Harness();browser=None;error=None;ARTIFACTS.mkdir(parents=True,exist_ok=True)
 try:
  h.check_ports();await h.start_api()
  vite=h.start(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'vite');await h.ready(ORIGIN,vite)
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   ctx=await browser.new_context(viewport={'width':1440,'height':960});await h.watch(ctx)
   page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN+'/funil');await h.login(page)
   await page.get_by_role('button',name='+ Novo Atendimento',exact=True).click()
   await page.get_by_label('Telefone *',exact=True).fill('123456')
   await page.get_by_label('Nome do contato',exact=True).fill('QA João — ação, çãé — SINTÉTICO')
   await page.get_by_role('button',name='Criar Atendimento',exact=True).click()
   await expect(page.get_by_role('button',name='Editar Atendimento',exact=True)).to_be_visible()
   at_id=re.search('/atendimentos/([^?]+)',page.url).group(1);path='/api/atendimentos/'+at_id
   await page.get_by_role('button',name='Diagnósticos',exact=True).click()
   assert await page.get_by_role('button',name='Catálogos',exact=True).count()==0
   async def catalog(kind,name,service=None):
    data={'kind':kind,'name':name}
    if service:
     entries=(await(await ctx.request.get(ORIGIN+'/api/catalogos')).json())['items']
     data['serviceId']=next(i['id'] for i in entries if i['kind']=='servico' and i['name']==service)
    response=await ctx.request.post(ORIGIN+'/api/catalogos',headers={'Origin':ORIGIN},data=data)
    assert response.status==201,await response.text()
   await catalog('servico','Serviço QA sintético');await catalog('dimensao','Dimensão QA','Serviço QA sintético');await catalog('diagnostico','Dano QA');await catalog('diagnostico','Dano alternativo QA')
   await page.reload();await expect(active_scenario(page,'Cenário 1')).to_be_visible()
   await page.get_by_role('button',name='+ Adicionar peça',exact=True).click();await page.get_by_label('Buscar peça em todas as vistas').fill('capo')
   await page.locator('.piece-options button').filter(has=page.get_by_text('Capô',exact=True)).click()
   await expect(page.locator('.diagnosis-card')).to_have_count(1)
   # Repeated physical selection opens the existing item, never another piece.
   await page.locator('.piece-options button').filter(has=page.get_by_text('Capô',exact=True)).click()
   await expect(page.get_by_role('form',name='Editar item de diagnóstico')).to_be_visible()
   await page.get_by_label('Diagnóstico',exact=True).select_option(label='Dano QA')
   for number,quantity in [(1,'0.25'),(2,'1')]:
    await page.get_by_role('button',name='+ Adicionar serviço',exact=True).click()
    line=page.locator(f'[aria-label="Serviço {number}"]')
    await line.get_by_label('Serviço',exact=True).select_option(label='Serviço QA sintético');await line.get_by_label('Dimensão',exact=True).select_option(label='Dimensão QA')
    await line.get_by_label('Quantidade',exact=True).fill(quantity)
    await line.get_by_label('Observação do lançamento',exact=True).fill('Fracionário QA' if number==1 else 'Alternativo QA')
   await page.locator('[aria-label="Serviço 2"]').get_by_label('Diagnóstico do lançamento',exact=True).select_option(label='Dano alternativo QA')
   await page.locator('[aria-label="Serviço 2"]').get_by_label('Incluir serviço',exact=True).uncheck()
   await page.get_by_role('button',name='Salvar diagnóstico',exact=True).click();await expect(page.get_by_role('status')).to_contain_text('Diagnóstico salvo')
   await page.get_by_role('button',name='Voltar à lista',exact=True).click()
   await add_scenario(page)
   await expect(active_scenario(page,'Cenário 2')).to_be_visible()
   await page.locator('.diagnosis-open').first.click()
   await page.locator('[aria-label="Serviço 1"]').get_by_label('Incluir serviço',exact=True).uncheck()
   await page.locator('[aria-label="Serviço 2"]').get_by_label('Incluir serviço',exact=True).check()
   await page.get_by_role('button',name='Salvar diagnóstico',exact=True).click();await expect(page.get_by_role('status')).to_contain_text('Diagnóstico salvo')
   await page.get_by_role('button',name='Voltar à lista',exact=True).click()
   h.mark('operator creates Atendimento/piece/service lines via UI after explicit catalog API setup; variation copies flags only')

   await page.get_by_role('button',name='Orçamento e componentes',exact=True).click()
   await page.get_by_role('button',name='Preparar emissão do cenário',exact=True).click();await page.get_by_role('button',name='Preparar prévia de emissão',exact=True).click()
   await expect(page.get_by_role('button',name='Emitir versão imutável',exact=True)).to_be_disabled()
   await expect(page.get_by_role('region',name='Prévia de orçamento')).to_contain_text('não selecionada')
   await page.get_by_role('button',name='Voltar ao orçamento',exact=True).click()
   await page.get_by_role('button',name='Configuração comercial',exact=True).click()
   async def factor(label,name):
    await page.get_by_role('button',name='+ Adicionar '+label,exact=True).click()
    await page.get_by_label('Nome '+label+' 1',exact=True).fill(name);await page.get_by_label('Fator '+label+' 1',exact=True).fill('1')
   await factor('Tabelas comerciais','Tabela QA');await factor('Cores','Cor QA');await factor('Riscos','Risco QA')
   await page.get_by_label('Capacidade diária global',exact=True).fill('4')
   await page.get_by_label('Adicionar serviço à configuração',exact=True).select_option(label='Serviço QA sintético')
   await page.get_by_label('Preço base não dimensionado',exact=True).fill('100.01')
   await page.get_by_label('Adicionar dimensão ao serviço',exact=True).select_option(label='Dimensão QA')
   await page.get_by_label('FD da dimensão',exact=True).fill('1')
   await page.get_by_role('button',name='+ Etapa técnica',exact=True).click()
   await page.get_by_label('Etapa técnica',exact=True).fill('Etapa sintética QA');await page.get_by_label('Dimensão técnica',exact=True).fill('Técnica QA')
   await page.get_by_label('Energia base',exact=True).fill('2');await page.get_by_label('Energia dimensional',exact=True).fill('3')
   await page.get_by_label('Condições e ressalvas comerciais',exact=True).fill('SINTÉTICO — somente homologação. Não enviar ao cliente.')
   await page.get_by_role('button',name='Salvar configuração comercial',exact=True).click()
   await expect(page.get_by_role('form',name='Configuração comercial')).not_to_be_visible()
   await page.get_by_role('button',name='Parâmetros do Atendimento',exact=True).click()
   for label,name in [('Tabela comercial','Tabela QA'),('Cor','Cor QA'),('Risco','Risco QA')]:await page.get_by_label(label,exact=True).select_option(label=name)
   await page.get_by_role('button',name='Salvar parâmetros',exact=True).click();await expect(page.get_by_role('form',name='Parâmetros comerciais')).not_to_be_visible()
   h.mark('missing setup blocks emission without losing draft; operator configures prices, factors, stages, energy, capacity and common parameters via UI')

   async def component(name,price,fct,quantity='2'):
    await page.get_by_role('button',name='+ Componente monetário',exact=True).click();await page.get_by_label('Descrição do componente',exact=True).fill(name)
    await page.get_by_label('Quantidade do componente',exact=True).fill(quantity)
    if price is not None:await page.get_by_label('Preço manual unitário (R$)',exact=True).fill(price)
    if fct is not None:await page.get_by_label('FCT individual',exact=True).fill(fct)
    await page.get_by_role('button',name='Salvar componente',exact=True).click();await expect(page.get_by_role('form',name='Componente monetário')).not_to_be_visible()
   await component('Componente zero explícito QA','0','1.2')
   await component('Componente pendente QA',None,None)
   await expect(page.get_by_role('region',name='Orçamento e componentes')).to_contain_text('pendência')
   await page.locator('.diagnosis-card').filter(has_text='Componente pendente QA').get_by_role('button',name='Editar componente',exact=True).click()
   await page.get_by_label('Preço manual unitário (R$)',exact=True).fill('10.01');await page.get_by_label('FCT individual',exact=True).fill('1.2')
   await page.get_by_role('button',name='Salvar componente',exact=True).click();await expect(page.get_by_role('form',name='Componente monetário')).not_to_be_visible()
   await expect(page.get_by_role('region',name='Orçamento e componentes')).to_contain_text('124,15')
   await page.get_by_role('button',name='Voltar aos diagnósticos',exact=True).click();await compare(page)
   matrix=page.get_by_role('region',name='Matriz de cenários');await expect(matrix).to_contain_text('25,0125');await expect(matrix).to_contain_text('124,15')
   await page.get_by_label('Só diferenças',exact=True).check()
   await expect(matrix).to_contain_text('Componente zero explícito QA')
   await page.screenshot(path=str(ARTIFACTS/'integrado-matriz-desktop.png'))
   h.mark('exact fractional totals and manual zero/FCT components persist; matrix uses effective flags even when monetary totals are zero')
   await page.get_by_role('button',name='Orçamento e componentes',exact=True).click()
   await page.get_by_role('button',name='Preparar emissão do cenário',exact=True).click()
   await page.locator('.negotiation-disclosure summary').click();await page.get_by_label('Modalidade de negociação',exact=True).select_option('discount');await page.get_by_label('Desconto em serviços (R$)',exact=True).fill('0.05')
   await page.get_by_role('button',name='Preparar prévia de emissão',exact=True).click()
   await expect(page.get_by_role('button',name='Emitir versão imutável',exact=True)).to_be_enabled()
   await expect(page.get_by_role('region',name='Prévia de orçamento')).to_contain_text('124,10')
   await page.get_by_role('button',name='Emitir versão imutável',exact=True).click();await expect(page.get_by_role('heading',name='Orçamento A · versão 1',exact=True)).to_be_visible()
   async with page.expect_download() as dl:await page.get_by_role('button',name='Baixar PDF A',exact=True).click()
   downloaded=await dl.value;pdf_a=ARTIFACTS/'orcamento-A-sintetico.pdf';await downloaded.save_as(pdf_a)
   subprocess.run(['pdftotext','-layout',str(pdf_a),str(ARTIFACTS/'orcamento-A-texto.txt')],check=True)
   text=(ARTIFACTS/'orcamento-A-texto.txt').read_text()
   assert 'João' in text and 'ação' in text and 'çãé' in text,text
   assert '124,10' in text and '0,05' in text and 'Etapa sintética QA' in text,text
   await page.screenshot(path=str(ARTIFACTS/'integrado-emissao-A.png'))
   h.mark('manual UI emission A applies services-only discount; downloaded real PDF independently parsed with pdftotext including accented text and totals')

   # Change live configuration and Atendimento after A; immutable A must retain old values/text.
   await page.get_by_role('button',name='Voltar ao orçamento',exact=True).click();await page.get_by_role('button',name='Configuração comercial',exact=True).click()
   await page.get_by_label('Preço base não dimensionado',exact=True).fill('200.01');await page.get_by_role('button',name='Salvar configuração comercial',exact=True).click()
   await expect(page.get_by_role('form',name='Configuração comercial')).not_to_be_visible()
   await page.get_by_role('button',name='Editar Atendimento',exact=True).click();await page.get_by_label('Nome do contato',exact=True).fill('QA ALTERADO — SINTÉTICO')
   await page.get_by_role('button',name='Salvar alterações',exact=True).click();await expect(page.get_by_role('form',name='Editar Atendimento')).not_to_be_visible()
   # Parent refresh returns the commercial detail to diagnostics; open budget if needed.
   if await page.get_by_role('button',name='Orçamento e componentes',exact=True).count():await page.get_by_role('button',name='Orçamento e componentes',exact=True).click()
   versions=await (await ctx.request.get(ORIGIN+path+'/orcamentos')).json();assert len(versions)==1
   first=await (await ctx.request.get(ORIGIN+path+'/orcamentos/'+versions[0]['id'])).json();assert first['snapshot']['calculation']['total']=='124.1'
   same_pdf=await (await ctx.request.get(ORIGIN+path+'/orcamentos/'+versions[0]['id']+'/pdf')).body();assert same_pdf==pdf_a.read_bytes()
   workspace=await(await ctx.request.get(ORIGIN+path+'/cenarios')).json()
   selected=next(s for s in workspace['scenarios'] if s['position']==2)
   # Repeated explicit API emissions are isolated QA iterations to reach the UI 26/27 boundary.
   for sequence in range(2,26):
    data={'scenarioId':selected['id'],'negotiation':{'mode':'none'}}
    pview=await(await ctx.request.post(ORIGIN+path+'/orcamentos/previa',headers={'Origin':ORIGIN},data=data)).json();assert pview['canEmit'],pview
    response=await ctx.request.post(ORIGIN+path+'/orcamentos',headers={'Origin':ORIGIN},data={**data,'previewToken':pview['token'],'idempotencyKey':str(uuid.uuid4())})
    assert response.status==201,await response.text();issued=await response.json();assert issued['sequence']==sequence
    if sequence in (2,3):
     label='B' if sequence==2 else 'C'
     response_pdf=await ctx.request.get(ORIGIN+path+'/orcamentos/'+issued['id']+'/pdf');assert response_pdf.status==200
     pdf_file=ARTIFACTS/f'orcamento-{label}-sintetico.pdf';pdf_file.write_bytes(await response_pdf.body())
     text_file=ARTIFACTS/f'orcamento-{label}-texto.txt';subprocess.run(['pdftotext','-layout',str(pdf_file),str(text_file)],check=True)
     assert f'Orçamento {label}' in text_file.read_text() and 'Cenário: Cenário 2' in text_file.read_text()
     assert issued['snapshot']['calculation']['scenarioName']=='Cenário 2'

   # Fresh UI load to show all issued versions. Remaining 26th/27th are manual button flows.
   await page.reload()
   await expect(active_scenario(page,'Cenário 1')).to_be_visible();await select_named_scenario(page,'Cenário 2')
   await page.get_by_role('button',name='Orçamento e componentes',exact=True).click()
   for label,sequence in [('Z',26),('AA',27)]:
    await page.get_by_role('button',name='Preparar emissão do cenário',exact=True).click();await page.locator('.negotiation-disclosure summary').click();await page.get_by_label('Modalidade de negociação',exact=True).select_option('none')
    await page.get_by_role('button',name='Preparar prévia de emissão',exact=True).click();await page.get_by_role('button',name='Emitir versão imutável',exact=True).click()
    await expect(page.get_by_role('heading',name=f'Orçamento {label} · versão {sequence}',exact=True)).to_be_visible()
    if label=='AA':
     async with page.expect_download() as dl:await page.get_by_role('button',name='Baixar PDF AA',exact=True).click()
     await(await dl.value).save_as(ARTIFACTS/'orcamento-AA-sintetico.pdf')
     subprocess.run(['pdftotext','-layout',str(ARTIFACTS/'orcamento-AA-sintetico.pdf'),str(ARTIFACTS/'orcamento-AA-texto.txt')],check=True)
     txt=(ARTIFACTS/'orcamento-AA-texto.txt').read_text();assert '224,15' in txt and 'ALTERADO' in txt
    await page.get_by_role('button',name='Voltar ao orçamento',exact=True).click()
   h.mark('26 Z and 27 AA issued through UI; earlier A snapshot and PDF unchanged after live prices/Atendimento edits')
   await h.restart_api();await ctx.close()
   ctx=await browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);await h.watch(ctx)
   page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN+'/atendimentos/'+at_id+'?aba=diagnosticos');await h.login(page)
   await page.get_by_role('button',name='Orçamento e componentes',exact=True).click()
   await expect(page.get_by_role('heading',name='Versões emitidas · 27',exact=True)).to_be_visible()
   await page.get_by_role('button',name=re.compile(r'^Orçamento A ·')).click();await expect(page.get_by_role('heading',name='Orçamento A · versão 1',exact=True)).to_be_visible()
   await expect(page.get_by_role('region',name='Versão emitida')).to_contain_text('QA João')
   async with page.expect_download() as dl:await page.get_by_role('button',name='Baixar PDF A',exact=True).click()
   restored=await dl.value;await restored.save_as(h.folder/'restored.pdf');assert(h.folder/'restored.pdf').read_bytes()==pdf_a.read_bytes()
   await page.screenshot(path=str(ARTIFACTS/'integrado-versao-mobile.png'))
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   await page.get_by_role('button',name='Voltar aos diagnósticos',exact=True).click();await compare(page)
   await expect(page.get_by_role('region',name='Matriz de cenários')).to_contain_text('50,0125')
   assert await page.get_by_role('region',name='Matriz de cenários').evaluate('(el)=>el.scrollWidth>el.clientWidth')
   await page.screenshot(path=str(ARTIFACTS/'integrado-matriz-mobile.png'))
   h.mark('fresh mobile browser after restart recovers 27 immutable versions, identical A PDF, fractional live totals and horizontal matrix')
   assert not h.external and not h.page_errors,(h.external,h.page_errors)
   h.mark('no external provider requests or uncaught browser errors; all successful persistence and PDF responses are real')
   await browser.close();browser=None
 except Exception as e:error=str(e) or type(e).__name__;traceback.print_exc()
 finally:
  if browser:
   try:await browser.close()
   except Exception:pass
  h.cleanup();(ARTIFACTS/'integrado-resultados.json').write_text(json.dumps({'suite':'Issue 7 MVP Comercial integrado','data':'Synthetic QA only; no production seed or provider call','assertions':h.results,'error':error,'external_hosts':h.external,'page_errors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
 if error:raise SystemExit(1)

if __name__=='__main__':asyncio.run(run())
