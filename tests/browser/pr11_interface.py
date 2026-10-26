"""PR11 compact UI, real API/temporary SQLite, synthetic data only."""
import asyncio, json, re, time, traceback
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN

ARTIFACTS = ROOT / 'docs/evidencias/pr11-interface'


async def run():
    h = Harness(); browser = None; error = None; metrics = {}
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    try:
        h.check_ports(); await h.start_api()
        vite = h.start(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 'vite')
        await h.ready(ORIGIN, vite)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            ctx = await browser.new_context(viewport={'width': 1440, 'height': 960})
            await h.watch(ctx); page = await ctx.new_page(); await h.attach(page)
            await page.goto(ORIGIN + '/funil?modo=lista&q=QA')
            await h.login(page)
            await page.get_by_role('button', name='+ Novo Atendimento', exact=True).click()
            await page.get_by_label('Telefone *', exact=True).fill('123456')
            await page.get_by_label('Nome do contato', exact=True).fill('QA UI compacta — SINTÉTICO')
            await page.get_by_role('button', name='Criar Atendimento', exact=True).click()
            await expect(page.locator('.detail-header').get_by_role('button', name='Editar Atendimento')).to_be_visible()
            at = re.search('/atendimentos/([^?]+)', page.url).group(1)
            path = '/api/atendimentos/' + at
            async def get(url):
                r = await ctx.request.get(ORIGIN + url); assert r.ok, await r.text(); return await r.json()
            async def write(url, data, method='post'):
                r = await getattr(ctx.request, method)(ORIGIN + url, headers={'Origin': ORIGIN}, data=data)
                assert r.ok, await r.text(); return await r.json()

            entries = (await get('/api/catalogos'))['items']
            assert all(i['kind'] == 'peca' for i in entries)
            assert await page.locator('.at-detail-tools').count() == 0
            edit = page.locator('.detail-header').get_by_role('button', name='Editar Atendimento')
            await edit.focus(); await page.keyboard.press('Enter')
            await expect(page.get_by_role('dialog')).to_be_visible()
            await page.get_by_label('Nome do contato', exact=True).fill('QA edição preservada')
            h.accept_dialogs = False
            await page.get_by_role('button', name='Fechar formulário', exact=True).click()
            await expect(page.get_by_label('Nome do contato', exact=True)).to_have_value('QA edição preservada')
            h.accept_dialogs = True
            await page.get_by_role('button', name='Salvar alterações', exact=True).click()
            await expect(page.get_by_role('dialog')).to_have_count(0)
            await expect(page.locator('.detail-contact')).to_contain_text('QA edição preservada')
            h.mark('compact edit action in original header works with keyboard and unsaved guard; redundant tools bar absent')

            start = time.perf_counter(); before = len(h.api_requests)
            await page.get_by_role('button', name='Diagnósticos', exact=True).click()
            await expect(page.get_by_role('tab', name='Cenário 1', exact=True)).to_have_attribute('aria-selected', 'true')
            metrics['first_commercial_view_ms'] = round((time.perf_counter() - start) * 1000, 2)
            metrics['first_requests'] = h.api_requests[before:]
            await expect(page.get_by_role('button', name='Catálogos', exact=True)).to_have_count(0)
            assert await page.locator('.diagnostics-body > .commercial-toolbar').count() == 0
            before = len(h.api_requests); start = time.perf_counter()
            for _ in range(3):
                await page.get_by_role('button', name='Mapa', exact=True).click()
                await expect(page.locator('.interactive-map')).to_be_visible()
                await page.get_by_role('button', name='Diagnósticos', exact=True).click()
                await expect(page.locator('.interactive-map')).to_have_count(0)
            await page.wait_for_timeout(150)
            redundant = [r for r in h.api_requests[before:] if r['method'] == 'GET' and ('/api/catalogos' in r['path'] or '/cenarios' in r['path'])]
            assert not redundant, redundant
            metrics['six_tab_changes_ms'] = round((time.perf_counter() - start) * 1000, 2)
            metrics['redundant_commercial_requests_for_six_tab_changes'] = len(redundant)
            h.mark('same CommercialPanel across Diagnostics/Map: six tab switches make zero redundant catalog/workspace GETs', **metrics)

            await page.get_by_role('button', name='+ Adicionar peça', exact=True).click()
            search = page.get_by_label('Buscar peça em todas as vistas', exact=True)
            await search.fill('capo')
            await expect(page.locator('.piece-options button')).to_have_count(1)
            assert await page.locator('.piece-options small').count() == 0
            assert await page.locator('.piece-search svg').count() == 1
            await page.locator('.piece-options button').click()
            await page.locator('.diagnosis-open').first.click()
            await page.get_by_label('Observações do diagnóstico', exact=True).fill('Rascunho não salvo')
            h.accept_dialogs = False
            await page.locator('.detail-header').get_by_role('button', name='Editar Atendimento').click()
            await expect(page.get_by_role('dialog')).to_have_count(0)
            await expect(page.get_by_label('Observações do diagnóstico', exact=True)).to_have_value('Rascunho não salvo')
            await page.get_by_role('button', name='Mapa', exact=True).click()
            await expect(page.get_by_role('form', name='Editar item de diagnóstico')).to_be_visible()
            await page.get_by_role('button', name='Adicionar variação do cenário ativo', exact=True).click()
            assert len((await get(path + '/cenarios'))['scenarios']) == 1
            await expect(page.get_by_label('Observações do diagnóstico', exact=True)).to_have_value('Rascunho não salvo')
            h.accept_dialogs = True
            await page.get_by_role('button', name='Salvar diagnóstico', exact=True).click()
            await expect(page.get_by_role('button', name='Salvar diagnóstico', exact=True)).to_be_disabled()
            await page.get_by_role('button', name='Voltar à lista', exact=True).click()
            item = (await get(path + '/diagnosticos'))[0]
            h.mark('compact searchable picker has name-only rows and search icon; diagnosis unsaved guard blocks header edit and tab navigation')

            await page.get_by_role('button', name='Adicionar variação do cenário ativo', exact=True).click()
            await expect(page.get_by_role('tab', name='Cenário 2', exact=True)).to_have_attribute('aria-selected', 'true')
            workspace = await get(path + '/cenarios')
            one, two = workspace['scenarios']
            assert one['pieceFlags'] == two['pieceFlags'] and len(workspace['items']) == 1
            await page.get_by_role('button', name='Comparação', exact=True).click()
            checkbox = page.get_by_label('Cenário 2: incluir peça Capô', exact=True)
            await checkbox.click(); await expect(checkbox).not_to_be_checked()
            await page.get_by_role('button', name='Comparação', exact=True).click()
            await page.get_by_role('tab', name='Cenário 1', exact=True).click()
            for number in range(3, 10):
                await page.get_by_role('button', name='Adicionar variação do cenário ativo', exact=True).click()
                await expect(page.get_by_role('tab', name=f'Cenário {number}', exact=True)).to_have_attribute('aria-selected', 'true')
            workspace = await get(path + '/cenarios')
            assert len(workspace['scenarios']) == 9 and len(workspace['items']) == 1
            assert workspace['scenarios'][0]['name'] == 'Principal'  # no rename/migration
            assert workspace['scenarios'][2]['pieceFlags'][item['id']]
            assert not workspace['scenarios'][1]['pieceFlags'][item['id']]
            assert not any('Nome d' in m for m in h.dialogs)
            strip = page.locator('.scenario-tabs')
            await expect(page.get_by_role('button', name='Adicionar variação do cenário ativo')).to_be_in_viewport()
            await expect(page.get_by_role('button', name='Comparação', exact=True)).to_be_in_viewport()
            box = await page.locator('.scenario-controls').bounding_box(); assert box['height'] <= 42, box
            previous = page.get_by_role('button', name='Cenários anteriores', exact=True)
            for _ in range(10):
                if not await previous.is_enabled(): break
                await previous.click(); await page.wait_for_timeout(50)
            assert await strip.evaluate('(e)=>e.scrollLeft') < 2
            await page.get_by_role('tab', name='Cenário 1', exact=True).click()
            await expect(page.get_by_role('tab', name='Cenário 1', exact=True)).to_have_attribute('aria-selected', 'true')
            await expect(page.get_by_role('tab', name='Cenário 1', exact=True)).to_be_focused()
            await page.keyboard.press('End')
            await expect(page.get_by_role('tab', name='Cenário 9', exact=True)).to_have_attribute('aria-selected', 'true')
            await expect(page.get_by_role('tab', name='Cenário 9', exact=True)).to_be_focused()
            await page.keyboard.press('Home'); await expect(page.get_by_role('tab', name='Cenário 1', exact=True)).to_be_focused()
            await page.keyboard.press('ArrowRight'); await expect(page.get_by_role('tab', name='Cenário 2', exact=True)).to_be_focused()
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.screenshot(path=str(ARTIFACTS / 'desktop-compacto.png'))
            h.mark('nine numbered mini-tabs, overflow arrows, fixed add/compare, keyboard focus and real flag-only variation from selected scenario; no name prompts')

            await page.get_by_role('button', name='Comparação', exact=True).click()
            matrix = page.get_by_role('region', name='Matriz de cenários')
            for number in range(1, 10):
                await expect(matrix.get_by_role('columnheader', name=f'Cenário {number}', exact=True)).to_have_count(1)
            assert await matrix.evaluate('(e)=>e.scrollWidth>e.clientWidth')
            await page.get_by_role('button', name='Mapa', exact=True).click()
            await expect(page.get_by_role('tab', name='Cenário 2', exact=True)).to_have_attribute('aria-selected', 'true')
            await expect(page.locator('.interactive-map')).to_be_visible()
            await page.get_by_role('button', name='Chat', exact=True).click()
            await expect(page.locator('.detail-header').get_by_role('button', name='Editar Atendimento')).to_be_visible()
            await page.get_by_role('button', name='Diagnósticos', exact=True).click()
            await expect(page.get_by_role('tab', name='Cenário 2', exact=True)).to_have_attribute('aria-selected', 'true')
            await page.get_by_role('button', name='Voltar à visão anterior').click()
            await page.wait_for_url('**/funil?modo=lista&q=QA')
            h.mark('numeric comparison headers, scenario context across all tabs and original Funil return context preserved')

            await h.restart_api(); await ctx.close()
            ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            await h.watch(ctx); page = await ctx.new_page(); await h.attach(page)
            await page.goto(ORIGIN + '/atendimentos/' + at + '?aba=mapa'); await h.login(page)
            await expect(page.get_by_role('tab', name='Cenário 1', exact=True)).to_have_attribute('aria-selected', 'true')
            await expect(page.locator('.detail-header').get_by_role('button', name='Editar Atendimento')).to_be_visible()
            assert await page.locator('.scenario-tabs').evaluate('(e)=>e.scrollWidth>e.clientWidth')
            next_button = page.get_by_role('button', name='Próximos cenários', exact=True)
            for _ in range(10):
                if not await next_button.is_enabled(): break
                await next_button.click(); await page.wait_for_timeout(50)
            await page.get_by_role('tab', name='Cenário 9', exact=True).click()
            await expect(page.get_by_role('tab', name='Cenário 9', exact=True)).to_have_attribute('aria-selected', 'true')
            assert (await page.locator('.scenario-controls').bounding_box())['height'] <= 42
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.locator('[data-region="frente"]').first.click()
            await expect(page.get_by_role('button', name='Fechar seleção', exact=True)).to_be_visible()
            await page.screenshot(path=str(ARTIFACTS / 'mobile-compacto.png'))
            await page.get_by_role('button', name='Comparação', exact=True).click()
            await expect(page.get_by_role('region', name='Matriz de cenários')).to_be_visible()
            await page.screenshot(path=str(ARTIFACTS / 'mobile-comparacao.png'))
            h.mark('fresh mobile session after API restart recovers nine scenarios and diagnosis with compact header, arrow navigation and internal matrix scrolling')
            assert not h.external and not h.page_errors, (h.external, h.page_errors)
            await browser.close(); browser = None
    except Exception as cause:
        error = str(cause) or type(cause).__name__; traceback.print_exc()
    finally:
        if browser: await browser.close()
        h.cleanup()
        (ARTIFACTS / 'resultados.json').write_text(json.dumps({'suite': 'PR11 interface compacta', 'synthetic': True, 'assertions': h.results, 'metrics_local': metrics, 'error': error, 'external_hosts': h.external, 'page_errors': h.page_errors}, ensure_ascii=False, indent=2) + '\n')
    if error: raise SystemExit(1)
    print(f'{len(h.results)} compact UI browser groups passed')


if __name__ == '__main__': asyncio.run(run())
