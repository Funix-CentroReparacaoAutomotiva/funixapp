from mr_percent import select_mr
"""Approved HTML visual contract + real autosave/MR/emission; synthetic SQLite only."""
import asyncio,json,hashlib,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
from scenario_ui import menu,add_scenario,select_scenario,compare
ARTIFACTS=ROOT/'docs/evidencias/editor-financeiro'

async def run():
 h=Harness();browser=None;error=None;ARTIFACTS.mkdir(parents=True,exist_ok=True)
 try:
  h.check_ports();await h.start_api()
  vite=h.start(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'vite');await h.ready(ORIGIN,vite)
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   for device,viewport in [('desktop',{'width':1440,'height':960}),('mobile',{'width':390,'height':844})]:
    ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile',accept_downloads=True);await h.watch(ctx)
    page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN+'/funil');await h.login(page)
    async def get(url):
     r=await ctx.request.get(ORIGIN+url);assert r.ok,await r.text();return await r.json()
    async def write(url,data,method='post'):
     r=await getattr(ctx.request,method)(ORIGIN+url,headers={'Origin':ORIGIN},data=data);assert r.ok,await r.text();return await r.json()
    at=await write('/api/atendimentos',{'phone':'123456','name':'QA Editor '+device+' — SINTÉTICO'})
    path='/api/atendimentos/'+at['id']
    entries=[];dimensions=[]
    for name,dim in [('Pintura','Média'),('Reparação','Pequena')]:
     svc=await write('/api/catalogos',{'kind':'servico','name':name})
     d=await write('/api/catalogos',{'kind':'dimensao','name':dim,'serviceId':svc['id']});entries.append(svc);dimensions.append(d)
    diag=await write('/api/catalogos',{'kind':'diagnostico','name':'Quebrado'})
    piece=await write('/api/catalogos',{'kind':'peca','name':'retrovisor · motorista','code':'qa-mirror-'+device})
    item=(await write(path+'/diagnosticos',{'pieceCodes':[piece['code']]}))[0]
    item=await write(path+'/diagnosticos/'+item['id'],{'revision':item['revision'],'diagnosisId':diag['id'],'services':[{'serviceId':s['id'],'dimensionId':d['id'],'quantity':'1','notes':'Nota histórica QA','diagnosisId':diag['id']} for s,d in zip(entries,dimensions)]},'patch')
    part=await write(path+'/componentes',{'pieceId':item['id'],'name':'Capa do retrovisor','quantity':'1','manualPrice':'180','notes':'Legado QA'})
    c=await get('/api/precificacao')
    config={'tables':[{'id':'table','name':'A','factor':'1'}],'colors':[{'id':'color','name':'FC QA','factor':'1'}],'risks':[{'id':'risk','name':'FR QA','factor':'1'}],'resaleMultipliers':[{'id':'mr','name':'MR QA','factor':'1.2'},{'id':'mr2','name':'MR2 QA','factor':'2'}],'capacity':'4','conditions':'SINTÉTICO — teste local. Não executar serviço.','specialPrices':[],'services':[{'serviceId':s['id'],'colorFactorEnabled':True,'discountable':True,'base':base,'dimensions':[{'dimensionId':d['id'],'fd':'1','stages':[{'id':'step','name':'Etapa QA','dimension':'Técnica','baseEnergy':'2','dimensionEnergy':'3'}]}]} for s,d,base in zip(entries,dimensions,['889','620'])]}
    await write('/api/precificacao',{'revision':c['revision'],'config':config},'patch')
    w=await get(path+'/cenarios');await write(path+'/parametros',{'revision':w['revision'],'tableId':'table','colorId':'color','riskId':'risk','mrId':'mr'},'patch')
    await page.goto(ORIGIN+'/atendimentos/'+at['id']+'?aba=diagnosticos')
    await page.locator('.diagnosis-open').first.click();editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True)
    await expect(editor).to_be_visible();assert await page.get_by_role('button',name='Salvar diagnóstico',exact=True).count()==0
    await expect(editor.locator('.service').first.locator('.calculated')).to_contain_text('889,00')
    await editor.screenshot(path=str(ARTIFACTS/f'{device}-editor-recorte.png'))
    await page.screenshot(path=str(ARTIFACTS/f'{device}-editor.png'))
    # Original HTML at identical content width; Etapa B removes only its external frame.
    ref=await ctx.new_page();width=round((await editor.bounding_box())['width'])
    await ref.set_viewport_size(viewport);await ref.set_content((ROOT/'docs/referencias/editor-financeiro/01_EDITOR_DIAGNOSTICO_APROVADO.html').read_text());await ref.add_style_tag(content=f'body{{padding:0}}.editor{{width:{width}px;margin:0;border:0;border-radius:0;max-width:none}}')
    await ref.locator('.editor').screenshot(path=str(ARTIFACTS/f'{device}-editor-referencia.png'))
    for selector,properties in [('.head',['backgroundColor','padding']),('.piece-name',['fontSize','fontWeight']),('.top-select select',['height','backgroundColor','borderRadius']),('.field-line',['gridTemplateColumns','gap']),('.add',['height','width','borderRadius']),('.calculated strong',['fontSize','fontWeight'])]:
     async def styles(loc):return await loc.first.evaluate('(e,props)=>Object.fromEntries(props.map(p=>[p,getComputedStyle(e)[p]]))',properties)
     actual=await styles(editor.locator(selector));approved=await styles(ref.locator('.editor '+selector));assert actual==approved,(selector,actual,approved)
    await ref.close()

    first_ids=[s['id'] for s in item['services']]
    await page.get_by_role('button',name='Observação da peça',exact=True).click();await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Texto autosave QA '+device)
    await expect(editor).to_have_attribute('data-save-state','confirmed')
    saved=(await get(path+'/cenarios'))['items'][0]
    assert saved['notes']=='Texto autosave QA '+device and [s['id'] for s in saved['services']]==first_ids
    assert all(s['notes']=='Nota histórica QA' and s['diagnosisId']==diag['id'] for s in saved['services'])
    # New incomplete service is local; completing a repeated service receives a new stable ID.
    await editor.get_by_role('button',name='Adicionar serviço',exact=True).click();await asyncio.sleep(.7)
    assert len((await get(path+'/cenarios'))['items'][0]['services'])==2
    third=editor.locator('.service').nth(2);await third.get_by_label('Serviço',exact=True).select_option(entries[0]['id']);await third.get_by_label('Dimensão',exact=True).select_option(dimensions[0]['id']);await third.get_by_label('Quantidade do serviço').fill('0.25')
    await expect(editor).to_have_attribute('data-save-state','confirmed');saved=(await get(path+'/cenarios'))['items'][0]
    await expect(third.get_by_label('Quantidade do serviço')).to_be_focused()
    assert len(saved['services'])==3 and [s['id'] for s in saved['services'][:2]]==first_ids and saved['services'][2]['quantity']=='0.25'
    await third.get_by_role('button',name='Excluir serviço',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed')
    assert len((await get(path+'/cenarios'))['items'][0]['services'])==2
    h.mark(device+': real autosave, repeated services, fractional quantity, global delete and hidden legacy service fields preserved')
    # A genuine failed save keeps the input; a successful save during further typing cannot overwrite it.
    fail_path='**'+path+'/diagnosticos/'+item['id'];unavailable_once=True
    async def unavailable(route):
     nonlocal unavailable_once
     if route.request.method=='PATCH' and unavailable_once:
      unavailable_once=False;await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'code':'QA_UNAVAILABLE','message':'Falha sintética temporária'}}))
     else:await route.continue_()
    await page.route(fail_path,unavailable)
    await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Falha temporária QA')
    await expect(editor.get_by_role('alert')).to_contain_text('Falha sintética temporária')
    await expect(editor.get_by_role('textbox',name='Observação da peça',exact=True)).to_have_value('Falha temporária QA')
    await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed');await page.unroute(fail_path,unavailable)
    async def delayed(route):
     if route.request.method=='PATCH':await asyncio.sleep(.3)
     await route.continue_()
    await page.route(fail_path,delayed)
    async with page.expect_request(lambda r:r.method=='PATCH' and r.url.endswith('/diagnosticos/'+item['id'])):
     await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Digitação em andamento QA')
    await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Última digitação preservada QA')
    await expect(editor).to_have_attribute('data-save-state','confirmed')
    assert (await get(path+'/cenarios'))['items'][0]['notes']=='Última digitação preservada QA'
    await page.unroute(fail_path,delayed)
    h.mark(device+': 503 preserves edits and retries; typing during in-flight save persists the newest text without stale overwrite')
    await ctx.request.delete(ORIGIN+'/api/session',headers={'Origin':ORIGIN})
    await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Sessão recuperada QA')
    await expect(editor.get_by_role('alert')).to_be_visible();await h.login(page)
    await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed')
    assert (await get(path+'/cenarios'))['items'][0]['notes']=='Sessão recuperada QA'
    # Server committed PATCH but response was lost. Reconcile revision/content, no duplicate service.
    fail_path='**'+path+'/diagnosticos/'+item['id'];once=True
    async def lost(route):
     nonlocal once
     if route.request.method=='PATCH' and once:
      once=False;await route.fetch();await route.abort('failed')
     else:await route.continue_()
    await page.route(fail_path,lost)
    await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Resposta perdida QA')
    await expect(editor.get_by_role('alert')).to_be_visible();await expect(editor.get_by_role('textbox',name='Observação da peça',exact=True)).to_have_value('Resposta perdida QA')
    await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed');await page.unroute(fail_path,lost)
    assert len((await get(path+'/cenarios'))['items'][0]['services'])==2
    # Issue22 uses the atomic PATCH revision guard (409), rather than a preflight GET.
    # Remote values/local draft assertions below remain the acceptance criteria.
    saved=(await get(path+'/cenarios'))['items'][0]
    await write(path+'/diagnosticos/'+item['id'],{'revision':saved['revision'],'notes':'Servidor QA','services':saved['services']},'patch')
    await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Local preservado QA');await expect(editor.get_by_role('alert')).to_contain_text('campos foram preservados')
    assert (await get(path+'/cenarios'))['items'][0]['notes']=='Servidor QA'
    await expect(editor.get_by_role('textbox',name='Observação da peça',exact=True)).to_have_value('Local preservado QA')
    await editor.get_by_role('button',name='Carregar versão salva',exact=True).click();await expect(editor.get_by_role('textbox',name='Observação da peça',exact=True)).to_have_value('Servidor QA')
    h.mark(device+': lost PATCH response reconciled without duplication; conflict preserves local draft and newer saved data until explicit recovery')
    # Scenario-only flags have their own revision even if the master piece revision is unchanged.
    w=await get(path+'/cenarios');scenario=w['scenarios'][0]
    await write(path+'/cenarios/'+scenario['id'],{'revision':scenario['revision'],'serviceFlags':{first_ids[0]:False}},'patch')
    await editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('Preservar flags externas QA')
    await expect(editor.get_by_role('alert')).to_contain_text('campos foram preservados')
    assert not (await get(path+'/cenarios'))['scenarios'][0]['serviceFlags'][first_ids[0]]
    await editor.get_by_role('button',name='Carregar versão salva',exact=True).click()
    await editor.locator('.service').first.get_by_role('button',name='Habilitar serviço neste cenário',exact=True).click()
    await expect(editor).to_have_attribute('data-save-state','confirmed')

    # New component is local until complete; creation retry retains client identity.
    await editor.get_by_role('button',name='Adicionar componente',exact=True).click();row=editor.locator('.component').last
    await asyncio.sleep(.7);assert len((await get(path+'/cenarios'))['components'])==1
    lost_once=True
    async def lost_component(route):
     nonlocal lost_once
     if route.request.method=='POST' and lost_once:
      lost_once=False;await route.fetch();await route.abort('failed')
     else:await route.continue_()
    await page.route('**'+path+'/componentes',lost_component)
    await row.get_by_label('Descrição do componente').fill('Zero QA');await row.get_by_label('Preço unitário do componente').fill('0');await expect(editor.get_by_role('alert')).to_be_visible()
    await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await expect(editor).to_have_attribute('data-save-state','confirmed')
    await page.unroute('**'+path+'/componentes',lost_component);assert len((await get(path+'/cenarios'))['components'])==2
    assert all('fct' not in c for c in (await get(path+'/cenarios'))['components'])
    await row.get_by_label('Preço unitário do componente').fill('');await expect(editor).to_have_attribute('data-save-state','confirmed');assert (await get(path+'/cenarios'))['components'][-1]['manualPrice'] is None
    await row.get_by_label('Preço unitário do componente').fill('0');await expect(editor).to_have_attribute('data-save-state','confirmed')
    await row.get_by_role('button',name='Excluir componente',exact=True).click();await expect(editor.locator('.component')).to_have_count(1)
    h.mark(device+': incomplete component remains local; zero accepted, lost POST response retries idempotently; component notes retained; no individual multiplier')
    await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click()
    finance=page.get_by_role('region',name='Painel financeiro',exact=True)
    await finance.locator('.summary').click();await expect(finance.get_by_label('MR',exact=True)).to_have_value('20')
    await select_mr(finance,'mr2');await expect(finance.locator('.metric').nth(1)).to_contain_text('360,00')
    await select_mr(finance,'mr');await expect(finance.locator('.metric').nth(1)).to_contain_text('216,00')
    await add_scenario(page);await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 2')
    await expect(finance.get_by_label('MR',exact=True)).to_have_value('20')
    before_requests=len([r for r in h.api_requests if r['path'].endswith('/cenarios') and r['method']=='GET'])
    await page.get_by_role('button',name='Mapa',exact=True).click();await expect(page.locator('.interactive-map')).to_be_visible()
    await page.get_by_role('button',name='Diagnósticos',exact=True).click()
    assert len([r for r in h.api_requests if r['path'].endswith('/cenarios') and r['method']=='GET'])==before_requests
    await compare(page);await expect(page.get_by_role('region',name='Matriz de cenários')).to_be_visible();await compare(page)
    # Exact approved finance sample uses explicit synthetic values only.
    c=await get('/api/precificacao');config['services'][0]['base']='1880';await write('/api/precificacao',{'revision':c['revision'],'config':config},'patch')
    part=(await get(path+'/cenarios'))['components'][0];
    await write(path+'/componentes/'+part['id'],{'revision':part['revision'],'pieceId':part['pieceId'],'name':part['name'],'quantity':part['quantity'],'manualPrice':'375','notes':part['notes']},'patch')
    await page.reload();finance=page.get_by_role('region',name='Painel financeiro',exact=True);await finance.locator('.summary').click();await finance.locator('.neg-head').click()
    assert await finance.locator('.segments button').count()==2
    await finance.get_by_label('Valor em reais',exact=True).fill('250');await finance.get_by_label('Valor em reais',exact=True).blur()
    await expect(finance.locator('.total')).to_contain_text('2.700,00')
    await finance.screenshot(path=str(ARTIFACTS/f'{device}-financeiro-negociacao-recorte.png'));await page.screenshot(path=str(ARTIFACTS/f'{device}-financeiro-negociacao.png'))
    await finance.locator('.neg-head').click();await finance.screenshot(path=str(ARTIFACTS/f'{device}-financeiro-recorte.png'));await page.screenshot(path=str(ARTIFACTS/f'{device}-financeiro.png'))
    assert await finance.locator('.metric').nth(2).inner_text()=='Desconto\n− R$ 250,00'
    ref=await ctx.new_page();width=round((await finance.bounding_box())['width']);await ref.set_viewport_size(viewport);await ref.set_content((ROOT/'docs/referencias/editor-financeiro/02_PAINEL_FINANCEIRO_APROVADO.html').read_text());await ref.add_style_tag(content=f'body{{padding:0}}.finance{{width:{width}px;margin:0}}')
    await ref.locator('.finance').screenshot(path=str(ARTIFACTS/f'{device}-financeiro-referencia.png'))
    for selector,properties in [('.summary',['backgroundColor']),('.metric.final span',['fontWeight']),('.select-wrap select',['backgroundColor','color','borderRadius','height','textAlign']),('.total strong',['fontWeight'])]:
     async def styles(loc):return await loc.first.evaluate('(e,props)=>Object.fromEntries(props.map(p=>[p,getComputedStyle(e)[p]]))',properties)
     actual=await styles(finance.locator(selector));approved=await styles(ref.locator('.finance '+selector));assert actual==approved,(selector,actual,approved)
    await ref.close()
    h.mark(device+': computed colours, typography, pill controls, identity colours, typography and pill controls match supplied HTML; footer geometry follows F01-F06')

    # Emit starts its own preview; check consent and idempotent retry after lost committed emission response.
    await finance.get_by_role('button',name='Emitir orçamento',exact=True).click();review=page.get_by_role('dialog',name='Conferência do orçamento')
    await expect(review.get_by_role('button',name='Confirmar emissão',exact=True)).to_be_disabled();assert len(await get(path+'/orcamentos'))==0
    await review.get_by_role('checkbox').check()
    await ctx.request.delete(ORIGIN+'/api/session',headers={'Origin':ORIGIN})
    await review.get_by_role('button',name='Confirmar emissão',exact=True).click();await expect(review.get_by_label('Senha de acesso')).to_be_visible();await h.login(page)
    assert len(await get(path+'/orcamentos'))==0
    emit_once=True
    async def lost_emit(route):
     nonlocal emit_once
     if route.request.method=='POST' and emit_once:
      emit_once=False;await route.fetch();await route.abort('failed')
     else:await route.continue_()
    await page.route('**'+path+'/orcamentos',lost_emit)
    await review.get_by_role('button',name='Confirmar emissão',exact=True).click();await expect(review.get_by_role('alert')).to_be_visible()
    await review.get_by_role('button',name='Confirmar emissão',exact=True).click();await expect(review.get_by_role('heading',name='Orçamento A emitido')).to_be_visible();await page.unroute('**'+path+'/orcamentos',lost_emit)
    versions=await get(path+'/orcamentos');assert len(versions)==1
    v=await get(path+'/orcamentos/'+versions[0]['id']);assert v['snapshot']['calculation']['total']=='2700' and v['snapshot']['calculation']['componentSubtotal']=='450'
    pdf=await ctx.request.get(ORIGIN+path+'/orcamentos/'+v['id']+'/pdf');pdf_hash=hashlib.sha256(await pdf.body()).hexdigest()
    async with page.expect_download() as pending:await review.get_by_role('button',name='Baixar PDF',exact=True).click()
    download=await pending.value;await download.save_as(str(ARTIFACTS/f'{device}-orcamento-sintetico.pdf'))
    await review.get_by_role('button',name='Fechar conferência').click()
    await finance.locator('.neg-head').click();await finance.get_by_role('button',name='Negociação',exact=True).click()
    await expect(finance.locator('.total')).to_contain_text('2.950,00')
    await finance.get_by_label('Valor em reais',exact=True).fill('3000');await finance.get_by_label('Valor em reais',exact=True).blur()
    await finance.get_by_role('button',name='Emitir orçamento',exact=True).click();await expect(review).to_be_visible();assert len(await get(path+'/orcamentos'))==1
    await review.get_by_role('button',name='Fechar conferência').click()
    await finance.get_by_label('Valor em reais',exact=True).fill('0');await finance.get_by_label('Valor em reais',exact=True).blur();await expect(finance.locator('.total')).to_contain_text('2.950,00')
    # Discoverable history/configuration on the existing header menu; snapshot/PDF independent of current MR.
    await (await menu(page)).get_by_role('menuitem',name='Orçamentos emitidos',exact=True).click()
    await expect(page.get_by_role('heading',name='Orçamentos emitidos',exact=True)).to_be_visible()
    assert await page.get_by_role('button',name='Configuração comercial',exact=True).count()==0
    await page.locator('.detail-header .back-detail').click()
    await finance.locator('.summary').click();await select_mr(finance,'mr2');await expect(finance.locator('.metric').nth(1)).to_contain_text('750,00')
    assert await get(path+'/orcamentos/'+v['id'])==v
    pdf=await ctx.request.get(ORIGIN+path+'/orcamentos/'+v['id']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
    h.mark(device+': global MR and cached tabs/scenarios; two negotiation options/zero; direct issue with consent/token/idempotent retry; history reachable, no global configuration on Atendimento; immutable PDF')
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),device
    await page.locator('.piece-delete').first.click()
    await page.get_by_role('dialog',name='Confirmar remoção da composição').get_by_role('button',name='Prosseguir',exact=True).click()
    await expect(page.locator('.diagnosis-row')).to_have_count(0)
    assert not (await get(path+'/cenarios'))['items'] and not (await get(path+'/cenarios'))['components']
    assert (await get(path+'/orcamentos/'+v['id']))==v
    h.mark(device+': global piece removal uses explicit trash and preserves historical emission')
    before=await get(path+'/cenarios');await h.restart_api()
    await write('/api/session',{'password':h.password});after=await get(path+'/cenarios');assert before==after
    assert (await get(path+'/orcamentos/'+v['id']))==v
    h.mark(device+': temporary file-backed SQLite survives API restart with composition, MR, flags and emitted version intact')
    await ctx.close()
   await browser.close();browser=None
  assert not h.page_errors,h.page_errors;assert not h.external,h.external
  h.mark('no browser runtime errors or external requests; desktop/mobile no horizontal overflow')
 except Exception:
  error=traceback.format_exc();print(error,flush=True)
  if browser:
   try:
    for ctx in browser.contexts:
     for pg in ctx.pages:await pg.screenshot(path=str(ARTIFACTS/'failure.png'))
   except Exception:pass
 finally:
  if browser:await browser.close()
  (ARTIFACTS/'resultados.json').write_text(json.dumps({'pass':error is None,'results':h.results,'pageErrors':h.page_errors,'external':h.external,'failure':error},ensure_ascii=False,indent=2)+'\n');h.cleanup()
 if error:raise RuntimeError(error)

if __name__=='__main__':asyncio.run(run())
