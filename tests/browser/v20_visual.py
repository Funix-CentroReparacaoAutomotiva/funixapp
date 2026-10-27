"""V20 comparison + real UI/API regression. Temporary SQLite; synthetic records only."""
import asyncio, json, traceback
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN

ARTIFACTS = ROOT / 'docs/evidencias/revisao-v20'


async def run():
    h = Harness(); browser = None; error = None
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    try:
        h.check_ports(); await h.start_api()
        vite = h.start(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 'vite')
        await h.ready(ORIGIN, vite)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            for device, viewport in [('desktop', {'width':1440,'height':960}), ('mobile', {'width':390,'height':844})]:
                ctx = await browser.new_context(viewport=viewport, is_mobile=device == 'mobile', has_touch=device == 'mobile')
                await h.watch(ctx)
                # Original V20 is inspected as a standalone demo; never loaded into the application.
                reference = await ctx.new_page()
                await reference.set_content((ROOT/'docs/design/FUNIX_V20_Menu_Compacto_Kanban.html').read_text(), wait_until='domcontentloaded')
                await reference.locator('[data-fh-tab=funil]').click()
                await reference.locator('.fh-card').first.click()
                for tab, screen in [('chat', 'chat'), ('items', 'diagnosticos'), ('map', 'mapa')]:
                    await reference.locator('#tab-'+tab).click(); await reference.wait_for_timeout(350)
                    await reference.screenshot(path=str(ARTIFACTS/f'v20-{device}-{screen}.png'))
                await reference.locator('.car-zone[data-region="Frente"]').click()
                await reference.screenshot(path=str(ARTIFACTS/f'v20-{device}-selecao.png'))
                await reference.close()
                page = await ctx.new_page(); await h.attach(page)
                await page.goto(ORIGIN + '/funil'); await h.login(page)
                async def get(url):
                    r = await ctx.request.get(ORIGIN+url); assert r.ok, await r.text(); return await r.json()
                async def write(url, data, method='post'):
                    r = await getattr(ctx.request,method)(ORIGIN+url, headers={'Origin':ORIGIN},data=data)
                    assert r.ok, await r.text(); return await r.json()
                record = await write('/api/atendimentos', {'phone':'123456','name':f'QA V20 {device} — SINTÉTICO','plate':'QA00000','vehicle':'Veículo de teste','reason':'Avaliação visual, sem cliente real','notes':'Contexto preservado no Atendimento'})
                path = '/api/atendimentos/'+record['id']
                await page.reload()
                await expect(page.locator('.fh-card').filter(has_text=record['name'])).to_be_visible()
                await page.screenshot(path=str(ARTIFACTS/f'app-{device}-funil-quadro.png'))
                await page.get_by_title('Recolher Novo lead',exact=True).click()
                assert (await page.locator('.fh-lane.collapsed').bounding_box())['width'] <= 51
                await page.get_by_title('Expandir Novo lead',exact=True).click()
                await page.get_by_role('button',name='☷ Lista',exact=True).click()
                await page.screenshot(path=str(ARTIFACTS/f'app-{device}-funil-lista.png'))
                await page.locator('.fh-row').filter(has_text=record['name']).click()
                await expect(page.locator('.detail-header')).to_contain_text(record['name'])
                rail = page.locator('.chat-rail')
                assert await rail.locator('button').all_text_contents() == ['Sugestão','Chat IA','Áudio','Fotos','Orçamento','Olá','Mapa']
                for button in await rail.locator('button').all(): await expect(button).to_be_disabled()
                await expect(page.get_by_label('Mensagem ao cliente',exact=True)).to_be_disabled()
                await expect(page.locator('.record-summary')).to_contain_text('Contexto preservado')
                boxes = [await page.locator(s).bounding_box() for s in ['.chat-rail','.at-chat-scroll','.compose','.copilot-fixed','.detail-footer'][:4]]
                assert boxes[0]['x'] > boxes[1]['x'] + boxes[1]['width'] - 68
                assert boxes[0]['y'] + boxes[0]['height'] <= boxes[2]['y']
                await page.screenshot(path=str(ARTIFACTS/f'app-{device}-chat.png'))
                await page.get_by_role('button',name='Abrir Copiloto FUNIX',exact=True).click()
                await expect(page.get_by_role('region',name='Copiloto FUNIX')).to_contain_text('IA ainda indisponível')
                await page.get_by_role('button',name='Recolher Copiloto',exact=True).click()
                h.mark(device+': shell, correct Atendimento header, V20 right rail order, inactive channel/AI, composer and unobscured actions')

                await page.get_by_role('button',name='Mapa',exact=True).click()
                await expect(page.locator('.interactive-map')).to_be_visible()
                assert await page.locator('dialog').count() == 0
                assert await page.locator('.map-stage > .piece-picker').count() == 0
                await page.screenshot(path=str(ARTIFACTS/f'app-{device}-mapa.png'))
                region = page.locator('[data-region="frente"]').first
                await region.focus(); await page.keyboard.press('Enter')
                dialog = page.get_by_role('dialog',name='Selecionar peça no mapa',exact=True)
                await expect(dialog).to_be_visible()
                await expect(page.locator('.disc-center')).to_be_focused()
                # Keyboard focus is contained by the native dialog.
                await page.keyboard.press('Tab')
                assert await page.evaluate('document.querySelector("dialog").contains(document.activeElement)')
                await page.screenshot(path=str(ARTIFACTS/f'app-{device}-mapa-selecao.png'))
                posts_before = len([r for r in h.api_requests if r['method']=='POST' and r['path']==path+'/diagnosticos'])
                if device == 'mobile':
                    async def fail_workspace(route): await route.abort('failed')
                    await ctx.route('**/cenarios*', fail_workspace)
                await dialog.get_by_role('button',name='Capô',exact=True).click()
                await expect(dialog.get_by_role('status')).to_contain_text('Peça(s) salva(s)')
                if device == 'mobile':
                    await expect(dialog.get_by_role('alert')).to_contain_text('inclusão foi confirmada')
                    await expect(dialog.get_by_role('button',name='Capô',exact=True)).to_be_disabled()
                    await page.screenshot(path=str(ARTIFACTS/'app-mobile-mapa-recuperacao.png'))
                    await ctx.unroute('**/cenarios*', fail_workspace)
                    await dialog.get_by_role('button',name='Atualizar dados',exact=True).click()
                    await expect(dialog.get_by_role('status')).to_contain_text('Dados atualizados')
                    assert len([r for r in h.api_requests if r['method']=='POST' and r['path']==path+'/diagnosticos']) == posts_before + 1
                    h.mark('mobile: confirmed inclusion + failed GET remains recoverable inside radial dialog; manual refresh sends no second POST')
                await expect(dialog.get_by_role('button',name='Capô',exact=True)).to_have_attribute('aria-pressed','true')
                assert len((await get(path+'/cenarios'))['items']) == 1
                # Page the ring without manufacturing a different catalog or swallowing a node.
                await dialog.get_by_role('button',name='Ver mais opções',exact=True).click()
                await expect(dialog.get_by_role('button',name='Voltar ao início',exact=True)).to_be_visible()
                await dialog.get_by_role('button',name='Voltar ao início',exact=True).click()
                await dialog.get_by_role('button',name='Iluminação dianteira',exact=True).click()
                await expect(dialog.get_by_role('button',name='Voltar ao nível anterior',exact=True)).to_be_visible()
                await dialog.get_by_role('button',name='Voltar ao nível anterior',exact=True).click()
                await expect(page.locator('.disc-name')).to_have_text('Frente')
                await page.keyboard.press('Escape'); await expect(dialog).to_have_count(0)
                await expect(region).to_be_focused()
                assert await page.locator('.interactive-map [data-selected=true]').count() > 0
                h.mark(device+': regional radial overlay; real persisted selection and marker; paging, nested back, keyboard focus and Escape return')

                # One catalog: operator-defined pieces participate in exactly the same search.
                own = await write('/api/catalogos',{'kind':'peca','name':'Peça QA '+device,'code':'qa-v20-'+device})
                await page.reload(); await expect(page.locator('.interactive-map')).to_be_visible()
                await page.get_by_role('button',name='Buscar peça',exact=True).click()
                await dialog.get_by_label('Buscar peça em todas as vistas').fill(own['code'])
                await dialog.get_by_role('button',name=own['name'],exact=True).click()
                await expect(dialog.get_by_role('status')).to_contain_text('Peça(s) salva(s)')
                await dialog.get_by_role('button',name='Fechar seleção',exact=True).click()
                await page.get_by_role('button',name='Diagnósticos',exact=True).click()
                await expect(page.locator('.diagnosis-row')).to_have_count(2)
                await expect(page.locator('.diagnosis-heading')).to_contain_text('2 peças')
                await page.locator('.diagnosis-open').filter(has_text='Capô').click()
                await page.get_by_label('Observações do diagnóstico',exact=True).fill('Rascunho QA preservado')
                h.accept_dialogs = False
                await page.get_by_role('button',name='Mapa',exact=True).click()
                await expect(page.get_by_label('Observações do diagnóstico',exact=True)).to_have_value('Rascunho QA preservado')
                h.accept_dialogs = True
                await page.get_by_role('button',name='Salvar diagnóstico',exact=True).click()
                await expect(page.get_by_role('status')).to_contain_text('Diagnóstico salvo')
                await page.get_by_role('button',name='Voltar à lista',exact=True).click()
                await page.get_by_role('button',name='Adicionar variação do cenário ativo',exact=True).click()
                await expect(page.get_by_role('tab',name='Cenário 2',exact=True)).to_have_attribute('aria-selected','true')
                cb = page.get_by_label('Incluir peça Capô neste cenário',exact=True)
                await cb.click(); await expect(cb).not_to_be_checked()
                workspace = await get(path+'/cenarios'); hood = next(i for i in workspace['items'] if i['notes']=='Rascunho QA preservado')
                assert workspace['scenarios'][0]['pieceFlags'][hood['id']] and not workspace['scenarios'][1]['pieceFlags'][hood['id']]
                await page.get_by_role('tab',name='Cenário 1',exact=True).click()
                await expect(cb).to_be_checked()
                await page.screenshot(path=str(ARTIFACTS/f'app-{device}-diagnosticos.png'))
                assert (await page.locator('.diagnosis-row').first.bounding_box())['height'] < 125
                await page.get_by_role('button',name='Comparação',exact=True).click()
                await expect(page.get_by_role('region',name='Matriz de cenários')).to_be_visible()
                await page.screenshot(path=str(ARTIFACTS/f'app-{device}-comparacao.png'))
                await page.get_by_role('button',name='Comparação',exact=True).click()
                await page.get_by_role('button',name='Orçamento e componentes',exact=True).click()
                await expect(page.get_by_role('button',name='Configuração comercial',exact=True)).to_be_visible()
                await page.screenshot(path=str(ARTIFACTS/f'app-{device}-orcamento.png'))
                footer = await page.locator('.detail-footer .primary-btn').bounding_box(); copilot = await page.locator('.copilot-fixed').bounding_box()
                assert footer['x'] + footer['width'] < copilot['x']
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                await page.get_by_role('button',name='Voltar à visão anterior',exact=True).click()
                await page.wait_for_url('**/funil?modo=lista')
                h.mark(device+': unified search, compact diagnosis rows, preserved draft protection, scenario-only checkbox, comparison, budget/configuration and return context')
                await ctx.close()
                await h.restart_api()
            assert not h.external and not h.page_errors, (h.external,h.page_errors)
            await browser.close(); browser = None
    except Exception as cause:
        error = str(cause) or type(cause).__name__; traceback.print_exc()
    finally:
        if browser: await browser.close()
        h.cleanup()
        (ARTIFACTS/'resultados.json').write_text(json.dumps({'synthetic':True,'assertions':h.results,'error':error,'external_hosts':h.external,'page_errors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
    if error: raise SystemExit(1)
    print(f'{len(h.results)} V20 visual browser groups passed')


if __name__ == '__main__': asyncio.run(run())
