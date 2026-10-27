"""Issue15 real UI/API/SQLite; synthetic fixtures and local-only transport faults."""
import asyncio, hashlib, json, traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN

ARTIFACTS=ROOT/'docs/evidencias/issue15'

from scenario_ui import menu,select_scenario,add_scenario,compare

async def run():
 h=Harness();browser=None;error=None;ARTIFACTS.mkdir(parents=True,exist_ok=True)
 try:
  h.check_ports();await h.start_api()
  vite=h.start(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'vite');await h.ready(ORIGIN,vite)
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   for device,viewport in [('desktop',{'width':1440,'height':960}),('mobile',{'width':390,'height':844})]:
    ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile');await h.watch(ctx)
    page=await ctx.new_page();await h.attach(page)
    await page.goto(ORIGIN+'/funil');await h.login(page)
    async def get(url):
     r=await ctx.request.get(ORIGIN+url);assert r.ok,await r.text();return await r.json()
    async def write(url,data,method='post'):
     r=await getattr(ctx.request,method)(ORIGIN+url,headers={'Origin':ORIGIN},data=data);assert r.ok,await r.text();return await r.json()
    at=await write('/api/atendimentos',{'phone':'123456','name':f'QA Issue15 {device} — SINTÉTICO','plate':'QA00000','vehicle':'Veículo de teste'})
    path='/api/atendimentos/'+at['id']
    svc=await write('/api/catalogos',{'kind':'servico','name':'Serviço QA '+device})
    dim=await write('/api/catalogos',{'kind':'dimensao','name':'Dimensão QA '+device,'serviceId':svc['id']})
    diag=await write('/api/catalogos',{'kind':'diagnostico','name':'Dano QA '+device})
    own=await write('/api/catalogos',{'kind':'peca','name':'Retrovisor · motorista','code':'qa-issue15-'+device})
    items=await write(path+'/diagnosticos',{'pieceCodes':['capo',own['code']]})
    hood=next(i for i in items if i['pieceId']!=own['id']);mirror=next(i for i in items if i['pieceId']==own['id'])
    hood=await write(path+'/diagnosticos/'+hood['id'],{'revision':hood['revision'],'diagnosisId':diag['id'],'services':[{'serviceId':svc['id'],'dimensionId':dim['id'],'quantity':'3'}]},'patch')
    priced_part=await write(path+'/componentes',{'pieceId':hood['id'],'name':'Componente QA','quantity':'0.25','manualPrice':'40','fct':'2','notes':''})
    zero=await write(path+'/componentes',{'pieceId':mirror['id'],'name':'Zero explícito QA','quantity':'1','manualPrice':'0','fct':'1','notes':''})
    config=await get('/api/precificacao')
    qa={'tables':[{'id':'qa-table','name':'Tabela QA','factor':'1'}],'colors':[{'id':'qa-color','name':'Cor QA','factor':'1'}],'risks':[{'id':'qa-risk','name':'Risco QA','factor':'1'}],'capacity':'4','conditions':'Dados sintéticos de teste.','services':[{'serviceId':svc['id'],'base':'100.01','dimensions':[{'dimensionId':dim['id'],'fd':'1','stages':[{'id':'qa-step','name':'Etapa QA','dimension':'QA','baseEnergy':'2','dimensionEnergy':'3'}]}]}],'specialPrices':[]}
    await write('/api/precificacao',{'revision':config['revision'],'config':qa},'patch')
    w=await get(path+'/cenarios');await write(path+'/parametros',{'revision':w['revision'],'tableId':'qa-table','colorId':'qa-color','riskId':'qa-risk'},'patch')
    await page.goto(ORIGIN+'/atendimentos/'+at['id']+'?aba=chat')
    await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 1')
    assert await page.locator('.scenario-controls').count()==0
    await add_scenario(page);await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 2')
    await add_scenario(page);await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 3')
    w=await get(path+'/cenarios');assert len(w['items'])==2 and len(w['scenarios'])==3
    assert w['scenarios'][0]['pieceFlags']==w['scenarios'][1]['pieceFlags']==w['scenarios'][2]['pieceFlags']
    await page.screenshot(path=str(ARTIFACTS/f'{device}-chat.png'))
    await menu(page);await page.screenshot(path=str(ARTIFACTS/f'{device}-menu-cenarios.png'));await page.keyboard.press('Escape')
    await page.get_by_role('button',name='Mapa',exact=True).click();await expect(page.locator('.interactive-map')).to_be_visible()
    await select_scenario(page,2)
    await page.locator('[data-region="frente"]').first.click();await expect(page.get_by_role('dialog')).to_be_visible()
    await page.screenshot(path=str(ARTIFACTS/f'{device}-mapa.png'));await page.get_by_role('button',name='Fechar seleção',exact=True).click()
    await page.get_by_role('button',name='Chat',exact=True).click();await compare(page)
    await expect(page.get_by_role('region',name='Matriz de cenários')).to_be_visible()
    await compare(page)
    h.mark(device+': scenario menu works in Chat/Map/Diagnostics; variations clone flags only; comparison opens from Chat; circular map unchanged')

    row=page.locator('.diagnosis-row').filter(has_text='Capô')
    await expect(row.locator('.piece-total')).to_have_text('R$ 320,15')
    mirror_row=page.locator('.diagnosis-row').filter(has_text='Retrovisor motorista:')
    await expect(mirror_row.locator('.piece-total')).to_have_text('R$ 0,00')
    assert await row.locator('.diagnosis-open svg').count()==2
    assert await row.get_by_role('button',name='Remover item').count()==0
    await expect(page.locator('.negotiation-disclosure')).not_to_have_attribute('open','')
    await page.screenshot(path=str(ARTIFACTS/f'{device}-diagnosticos.png'))
    # Real immutable emission tied to scenario 2, later deleted.
    await page.get_by_role('button',name='Orçamento e componentes',exact=True).click()
    await page.get_by_role('button',name='Preparar emissão do cenário',exact=True).click()
    await page.get_by_role('button',name='Preparar prévia de emissão',exact=True).click()
    await expect(page.get_by_role('button',name='Emitir versão imutável',exact=True)).to_be_enabled()
    await page.get_by_role('button',name='Emitir versão imutável',exact=True).click()
    await expect(page.get_by_role('heading',name='Orçamento A · versão 1',exact=True)).to_be_visible()
    versions=await get(path+'/orcamentos');v=await get(path+'/orcamentos/'+versions[0]['id'])
    pdf=await ctx.request.get(ORIGIN+path+'/orcamentos/'+v['id']+'/pdf');digest=hashlib.sha256(await pdf.body()).hexdigest()
    await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click()
    # Toggle only scenario 2; displayed piece value becomes a real zero without clearing children.
    cb=page.get_by_label('Incluir peça Capô neste cenário',exact=True);await cb.click();await expect(cb).not_to_be_checked()
    await expect(row.locator('.piece-total')).to_have_text('R$ 0,00')
    await select_scenario(page,1);await expect(cb).to_be_checked();await expect(row.locator('.piece-total')).to_have_text('R$ 320,15')
    w=await get(path+'/cenarios');assert w['scenarios'][1]['serviceFlags'][hood['services'][0]['id']]
    await select_scenario(page,2)
    await (await menu(page)).get_by_role('button',name='Excluir Cenário 2',exact=True).click()
    await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 1')
    assert [s['position'] for s in (await get(path+'/cenarios'))['scenarios']]==[1,3]
    assert await get(path+'/orcamentos/'+v['id'])==v
    r=await ctx.request.get(ORIGIN+path+'/orcamentos/'+v['id']+'/pdf');assert hashlib.sha256(await r.body()).hexdigest()==digest
    await add_scenario(page);await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 4')
    await select_scenario(page,1)
    h.mark(device+': compact piece totals use actual included lines; legitimate zero; parent preserves children; delete active scenario preserves master, stable numbering, emitted snapshot and exact PDF bytes')

    # Negotiate in Diagnostics, carry the same draft and preview through Chat/Map and emission.
    disclosure=page.locator('.negotiation-disclosure');await disclosure.locator('summary').click()
    await page.get_by_label('Modalidade de negociação',exact=True).select_option('discount')
    await page.get_by_label('Desconto em serviços (R$)',exact=True).fill('10,00')
    await expect(page.locator('.commercial-final strong')).to_have_text('Pendente')
    assert len(await get(path+'/orcamentos'))==1
    await page.get_by_role('button',name='Atualizar prévia',exact=True).click()
    await expect(page.locator('.commercial-final strong')).to_have_text('R$ 310,15')
    await page.get_by_role('button',name='Chat',exact=True).click();await page.get_by_role('button',name='Mapa',exact=True).click();await page.get_by_role('button',name='Diagnósticos',exact=True).click()
    await page.locator('.negotiation-disclosure summary').click()
    await expect(page.get_by_label('Desconto em serviços (R$)',exact=True)).to_have_value('10,00')
    await expect(page.locator('.commercial-final strong')).to_have_text('R$ 310,15')
    await page.get_by_role('button',name='Orçamento e componentes',exact=True).click();await page.get_by_role('button',name='Preparar emissão do cenário',exact=True).click()
    await page.locator('.negotiation-disclosure summary').click()
    await expect(page.get_by_label('Desconto em serviços (R$)',exact=True)).to_have_value('10,00')
    await expect(page.get_by_role('button',name='Emitir versão imutável',exact=True)).to_be_enabled()
    await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click()
    await page.locator('.negotiation-disclosure summary').click()
    await page.get_by_label('Modalidade de negociação',exact=True).select_option('adjust')
    await page.get_by_label('Total final desejado (R$)',exact=True).fill('300')
    await page.get_by_role('button',name='Atualizar prévia',exact=True).click();await expect(page.locator('.commercial-final strong')).to_have_text('R$ 300,00')
    await page.get_by_label('Total final desejado (R$)',exact=True).fill('380')
    await page.get_by_role('button',name='Atualizar prévia',exact=True).click();await expect(page.locator('.commercial-final strong')).to_have_text('R$ 380,00')
    w=await get(path+'/cenarios');assert w['calculations'][0]['componentSubtotal']=='20' and w['calculations'][0]['total']=='320.15'
    await expect(row.locator('.piece-total')).to_have_text('R$ 320,15')
    await page.screenshot(path=str(ARTIFACTS/f'{device}-negociacao.png'))
    await page.get_by_label('Total final desejado (R$)',exact=True).fill('19.99');await page.get_by_role('button',name='Atualizar prévia',exact=True).click()
    await expect(page.get_by_role('alert')).to_contain_text('inferior ao subtotal dos componentes')
    await expect(page.get_by_label('Total final desejado (R$)',exact=True)).to_have_value('19.99')
    await expect(page.locator('.commercial-final strong')).to_have_text('Pendente')
    await page.get_by_label('Total final desejado (R$)',exact=True).fill('381.03');await page.get_by_role('button',name='Atualizar prévia',exact=True).click()
    await expect(page.locator('.negotiation-residual')).to_contain_text('Diferença residual')
    await expect(page.locator('.commercial-final strong')).not_to_have_text('R$ 381,03')
    await page.screenshot(path=str(ARTIFACTS/f'{device}-residual.png'))
    ack=page.get_by_role('checkbox',name='Estou ciente da diferença residual informada e do total efetivo a emitir.',exact=True)
    await ack.check();await page.get_by_role('button',name='Atualizar prévia',exact=True).click()
    await expect(ack).to_be_checked()
    assert len(await get(path+'/orcamentos'))==1
    h.mark(device+': absolute discount and whole-budget targets below/above original use real preview; components intact; negotiation survives tabs and emission entry; impossible target rejected; residual and consent shown; typing emits nothing')

    # A changed component invalidates consent even if the requested total text is unchanged.
    await write(path+'/componentes/'+priced_part['id'],{'revision':priced_part['revision'],'pieceId':hood['id'],'name':priced_part['name'],'quantity':'0.25','manualPrice':'46','fct':'2','notes':''},'patch')
    await page.get_by_role('button',name='Atualizar prévia',exact=True).click()
    await expect(ack).not_to_be_checked();await expect(page.locator('.commercial-final strong')).to_have_text('Pendente')
    await page.get_by_role('button',name='Orçamento e componentes',exact=True).click();await page.get_by_role('button',name='Preparar emissão do cenário',exact=True).click()
    await expect(page.get_by_role('button',name='Emitir versão imutável',exact=True)).to_be_disabled()
    await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click();await page.locator('.negotiation-disclosure summary').click()
    await ack.check();await page.get_by_role('button',name='Atualizar prévia',exact=True).click();await expect(ack).to_be_checked()
    h.mark(device+': concurrent component edit refreshes backend context, invalidates old residual consent and blocks emission until review of the new preview')

    # Failure recovery keeps the monetary field and the effective total uncertain until recalculated.
    await page.get_by_label('Total final desejado (R$)',exact=True).fill('380')
    async def fail_preview(route): await route.abort('failed')
    await page.route('**/orcamentos/previa',fail_preview)
    await page.get_by_role('button',name='Atualizar prévia',exact=True).click()
    await expect(page.get_by_role('alert')).to_be_visible();await expect(page.get_by_label('Total final desejado (R$)',exact=True)).to_have_value('380')
    await expect(page.get_by_role('button',name='Atualizar prévia',exact=True)).to_be_enabled()
    await page.unroute('**/orcamentos/previa',fail_preview)
    await page.get_by_role('button',name='Atualizar prévia',exact=True).click();await expect(page.locator('.commercial-final strong')).to_have_text('R$ 380,00')
    # Guard field loss when choosing another scenario.
    h.accept_dialogs=False
    await (await menu(page)).get_by_role('menuitemradio',name='Cenário 3',exact=True).click()
    await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 1')
    await page.keyboard.press('Escape');await expect(page.get_by_label('Total final desejado (R$)',exact=True)).to_have_value('380')
    h.accept_dialogs=True
    await page.get_by_label('Modalidade de negociação',exact=True).select_option('none')
    await row.locator('.diagnosis-open').click();await page.get_by_label('Observações do diagnóstico',exact=True).fill('Rascunho QA não salvo')
    h.accept_dialogs=False
    await (await menu(page)).get_by_role('menuitemradio',name='Cenário 3',exact=True).click();await page.keyboard.press('Escape')
    await expect(page.get_by_label('Observações do diagnóstico',exact=True)).to_have_value('Rascunho QA não salvo')
    h.accept_dialogs=True
    await page.get_by_role('button',name='Salvar diagnóstico',exact=True).click();await expect(page.get_by_role('status')).to_contain_text('Diagnóstico salvo')
    await page.get_by_role('button',name='Voltar à lista',exact=True).click()
    # Pending piece total vs explicit zero.
    await page.get_by_role('button',name='+ Adicionar peça',exact=True).click();await page.get_by_label('Buscar peça em todas as vistas').fill('para-choque dianteiro')
    await page.locator('.piece-options button').filter(has=page.get_by_text('Para-choque dianteiro',exact=True)).click()
    pending=page.locator('.diagnosis-row').filter(has_text='Para-choque dianteiro:');await expect(pending.locator('.piece-total')).to_have_text('—')
    await expect(page.locator('.commercial-final strong')).to_have_text('Pendente')
    await pending.locator('.diagnosis-open').click();await expect(page.get_by_role('button',name='Excluir peça de todos os cenários',exact=True)).to_be_visible()
    await page.get_by_role('button',name='Excluir peça de todos os cenários',exact=True).click();await expect(pending).to_have_count(0)
    assert len((await get(path+'/cenarios'))['items'])==2
    h.mark(device+': failed preview recovers without losing input; cancelled scenario switches preserve diagnosis/negotiation drafts; pending piece uses em dash and deletion exists only in editor with all-scenarios confirmation')

    # Scenario removed by another session while editing. GET fallback cannot silently rebase a local form.
    await select_scenario(page,3)
    await row.locator('.diagnosis-open').click();await page.get_by_label('Observações do diagnóstico',exact=True).fill('Preservar após exclusão concorrente')
    w=await get(path+'/cenarios');three=next(s for s in w['scenarios'] if s['position']==3)
    await write(path+'/cenarios/'+three['id'],{'revision':three['revision']},'delete')
    await page.get_by_role('button',name='Salvar diagnóstico',exact=True).click();await expect(page.get_by_role('alert')).to_be_visible()
    await page.get_by_role('button',name='Atualizar dados',exact=True).click()
    await expect(page.get_by_role('button',name='Salvar diagnóstico',exact=True)).to_be_disabled()
    await expect(page.get_by_label('Observações do diagnóstico',exact=True)).to_have_value('Preservar após exclusão concorrente')
    await select_scenario(page,1);await expect(page.get_by_role('form',name='Editar item de diagnóstico')).to_have_count(0)
    deletes=[]
    async def lose_delete(route):
     if route.request.method=='DELETE':
      deletes.append(route.request.url);response=await route.fetch();assert response.ok;await route.abort('failed')
     else:await route.continue_()
    await page.route('**/cenarios/*',lose_delete)
    await (await menu(page)).get_by_role('button',name='Excluir Cenário 4',exact=True).click()
    await expect(page.get_by_role('alert')).to_be_visible()
    await page.unroute('**/cenarios/*',lose_delete)
    await page.get_by_role('button',name='Chat',exact=True).click()
    await page.get_by_role('button',name='Atualizar dados',exact=True).click()
    await expect(page.locator('.scenario-trigger')).to_be_enabled()
    await page.get_by_role('button',name='Diagnósticos',exact=True).click()
    assert len(deletes)==1 and len((await get(path+'/cenarios'))['scenarios'])==1
    h.mark(device+': lost DELETE response after real commit reconciles via GET without repeating deletion or changing master composition')
    await menu(page);await expect(page.get_by_role('button',name='Excluir Cenário 1',exact=True)).to_be_disabled();await page.keyboard.press('Escape')
    assert len((await get(path+'/cenarios'))['scenarios'])==1
    await h.restart_api();await page.reload();await h.login(page)
    r=await ctx.request.get(ORIGIN+path+'/orcamentos/'+v['id']+'/pdf');assert hashlib.sha256(await r.body()).hexdigest()==digest
    await expect(page.locator('.diagnosis-row')).to_have_count(2)
    await page.screenshot(path=str(ARTIFACTS/f'{device}-apos-reinicio.png'))
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    await page.locator('.negotiation-disclosure summary').click();await page.get_by_label('Modalidade de negociação',exact=True).select_option('discount');await page.get_by_label('Desconto em serviços (R$)',exact=True).fill('5')
    dialogs_before=len(h.dialogs)
    await page.get_by_role('button',name='Voltar à visão anterior',exact=True).click();await page.wait_for_url('**/funil')
    assert len(h.dialogs)==dialogs_before+1
    h.mark(device+': concurrent scenario deletion preserves unsaved local fields and blocks wrong-scenario save; explicit selection recovers; last deletion blocked; restart preserves data/PDF; leaving unsaved negotiation asks exactly once')
    await ctx.close()
   assert not h.external and not h.page_errors,(h.external,h.page_errors)
   await browser.close();browser=None
 except Exception as cause:
  error=str(cause) or type(cause).__name__;traceback.print_exc()
 finally:
  if browser: await browser.close()
  h.cleanup();(ARTIFACTS/'resultados.json').write_text(json.dumps({'synthetic':True,'assertions':h.results,'error':error,'external_hosts':h.external,'page_errors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
 if error:raise SystemExit(1)
 print(f'{len(h.results)} Issue15 browser groups passed')

if __name__=='__main__':asyncio.run(run())
