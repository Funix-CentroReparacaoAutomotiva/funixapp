"""Issue12: real SQLite/API, two sessions, isolated transport fault injection."""
import asyncio, json, re, traceback
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN

from scenario_ui import menu,active_scenario,select_named_scenario,add_scenario,compare

ARTIFACTS = ROOT / 'docs/evidencias/issue12'


async def run():
    h = Harness(); browser = None; error = None; post_count = 0
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    try:
        h.check_ports(); await h.start_api()
        vite = h.start(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 'vite')
        await h.ready(ORIGIN, vite)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            a = await browser.new_context(viewport={'width': 1440, 'height': 960})
            b = await browser.new_context()
            async def auth(ctx):
                r = await ctx.request.post(ORIGIN + '/api/session', headers={'Origin': ORIGIN}, data={'password': h.password})
                assert r.status == 200
            async def get(url):
                r = await a.request.get(ORIGIN + url); assert r.ok, await r.text(); return await r.json()
            async def write(ctx, url, data, method='post'):
                r = await getattr(ctx.request, method)(ORIGIN + url, headers={'Origin': ORIGIN}, data=data)
                assert r.ok, await r.text(); return await r.json()
            await auth(a); await auth(b)
            at = await write(a, '/api/atendimentos', {'phone': '123', 'name': 'QA ISSUE12 SINTÉTICO'})
            path = '/api/atendimentos/' + at['id']
            entries = (await get('/api/catalogos'))['items']
            pool = [i for i in entries if i['kind'] == 'peca' and i['code'] != 'capo'][:20]
            item = (await write(a, path + '/diagnosticos', {'pieceCodes': ['capo']}))[0]
            service = await write(a, '/api/catalogos', {'kind': 'servico', 'name': 'Serviço QA preservado'})
            item = await write(a, path + '/diagnosticos/' + item['id'], {'revision': item['revision'], 'services': [{'serviceId': service['id'], 'quantity': '0.25'}]}, 'patch')
            original = (await get(path + '/cenarios'))['scenarios'][0]
            copy = await write(a, path + '/cenarios', {'name': 'Variação QA', 'duplicateFrom': original['id'], 'sourceRevision': original['revision']})
            await h.restart_api(); await auth(a); await auth(b)
            await h.watch(a); page = await a.new_page(); await h.attach(page)
            def requested(request):
                nonlocal post_count
                if request.method == 'POST' and request.url.endswith('/diagnosticos'): post_count += 1
            page.on('request', requested)
            await page.goto(ORIGIN + '/atendimentos/' + at['id'] + '?aba=diagnosticos')
            await expect(active_scenario(page,'Cenário 1')).to_be_visible()
            await page.get_by_role('button', name='+ Adicionar peça', exact=True).click()
            async def button(entry):
                await page.get_by_label('Buscar peça em todas as vistas').fill(entry['code'])
                return page.locator('.piece-options button').filter(has=page.get_by_text(entry['name'], exact=True)).first
            async def choose(entry, ready=True):
                target = await button(entry)
                async with page.expect_response(lambda r: r.request.method == 'POST' and r.url.endswith('/diagnosticos')) as pending:
                    await target.click()
                response = await pending.value
                if ready: await expect(target).to_be_enabled()
                return response.status
            async def recover():
                await page.get_by_role('button', name='Atualizar dados', exact=True).click()
                await expect(page.get_by_role('status')).to_contain_text('Dados atualizados')
                await expect(page.get_by_role('button', name='Atualizar dados', exact=True)).to_have_count(0)

            assert [await choose(i) for i in pool[:3]] == [200, 200, 200]
            response = await a.request.get(ORIGIN + path + '/cenarios')
            assert response.headers['cache-control'] == 'no-store'
            h.mark('existing file-backed Atendimento after restart accepts sequential additions; GET is no-store; existing fractional service preserved')

            w = await get(path + '/cenarios'); s = w['scenarios'][0]
            await write(b, path + '/diagnosticos', {'pieceCodes': [pool[3]['code']], 'scenarioId': s['id'], 'scenarioRevision': s['revision']})
            n = post_count
            assert await choose(pool[4]) == 409
            await expect(page.get_by_role('alert')).to_contain_text('foram atualizados')
            assert post_count == n + 1  # never replays a mutation automatically
            assert await choose(pool[4]) == 200
            w = await get(path + '/cenarios')
            assert len(w['items']) == 6 and len(w['scenarios']) == 2
            assert not w['scenarios'][1]['pieceFlags'][next(i['id'] for i in w['items'] if i['pieceId'] == pool[4]['id'])]
            h.mark('second session produces real 409; one GET reconciliation refreshes revision; next explicit attempt succeeds without POST replay or scenario clones')

            for index, route_pattern, expected_route in [(5, '**/api/catalogos', '/api/catalogos'), (6, '**/cenarios*', '/api/atendimentos/:id/cenarios')]:
                async def abort_get(route): await route.abort('failed')
                await page.route(route_pattern, abort_get)
                n = post_count
                assert await choose(pool[index], ready=False) == 200
                await expect(page.get_by_role('alert')).to_contain_text('A inclusão foi confirmada')
                await expect(page.get_by_role('status')).to_contain_text('salva')
                await expect(page.get_by_role('button', name='Atualizar dados', exact=True)).to_be_enabled()
                await page.locator('.approved-finance .summary').click()
                await expect(page.get_by_role('button', name='Emitir orçamento', exact=True)).to_be_disabled()
                await page.locator('.approved-finance .summary').click()
                await expect(await button(pool[index])).to_be_disabled()
                await page.get_by_text('Detalhes da falha', exact=True).click()
                details = await page.locator('details').filter(has=page.get_by_text('Detalhes da falha', exact=True)).inner_text()
                assert 'GET ' + expected_route in details and at['id'] not in details
                if index == 6: await page.screenshot(path=str(ARTIFACTS / 'confirmado-com-falha-get.png'))
                assert any(i['pieceId'] == pool[index]['id'] for i in await get(path + '/diagnosticos'))
                # A failed manual refresh remains recoverable and keeps confirmation.
                await page.get_by_role('button', name='Atualizar dados', exact=True).click()
                await expect(page.get_by_role('button', name='Atualizar dados', exact=True)).to_be_enabled()
                await expect(page.get_by_role('status')).to_contain_text('salva')
                assert post_count == n + 1
                await page.unroute(route_pattern, abort_get); await recover()
            h.mark('real POST200 plus catalog/workspace GET transport failure keeps confirmed rows, distinguishes GET phase, releases busy and recovers without resending')

            # Before-delivery POST failure: no database write, no automatic retry.
            async def abort_post(route):
                if route.request.method == 'POST': await route.abort('failed')
                else: await route.continue_()
            await page.route('**/diagnosticos', abort_post)
            before = await get(path + '/diagnosticos'); n = post_count
            await (await button(pool[7])).click()
            await expect(page.get_by_role('alert')).to_contain_text('Ela pode ter sido gravada')
            await expect(page.get_by_role('button', name='Atualizar dados', exact=True)).to_be_enabled()
            assert await get(path + '/diagnosticos') == before and post_count == n + 1
            await page.unroute('**/diagnosticos', abort_post); await recover()
            assert await choose(pool[7]) == 200
            h.mark('POST rejected before delivery is reported as unconfirmed; explicit refresh then retry saves once and does not freeze busy')

            # Actual commit followed by a lost response: transport outcome is ambiguous.
            async def lose_response(route):
                if route.request.method == 'POST':
                    response = await route.fetch(); assert response.status == 200
                    await route.abort('failed')
                else: await route.continue_()
            await page.route('**/diagnosticos', lose_response)
            n = post_count
            await (await button(pool[8])).click()
            await expect(page.get_by_role('alert')).to_contain_text('Ela pode ter sido gravada')
            saved = next(i for i in await get(path + '/diagnosticos') if i['pieceId'] == pool[8]['id'])
            assert post_count == n + 1
            await page.unroute('**/diagnosticos', lose_response); await recover()
            assert await choose(pool[8], ready=False) == 200
            await expect(page.get_by_role('region', name='Editor de diagnóstico', exact=True)).to_be_visible()
            assert [i['id'] for i in await get(path + '/diagnosticos') if i['pieceId'] == pool[8]['id']] == [saved['id']]
            await page.get_by_role('button', name='Voltar aos Diagnósticos', exact=True).click()
            h.mark('lost POST response after real commit is reconciled by GET; deliberate repeated selection preserves one physical identity and previous flags')

            async def truncated_response(route):
                if route.request.method == 'POST':
                    response = await route.fetch(); assert response.status == 200
                    await route.fulfill(response=response, body='truncated JSON')
                else: await route.continue_()
            await page.route('**/diagnosticos', truncated_response)
            await (await button(pool[9])).click()
            await expect(page.get_by_role('alert')).to_contain_text('Não foi possível confirmar se a peça foi gravada')
            await expect(page.get_by_role('status')).to_have_count(0)
            await expect(page.get_by_role('button', name='Atualizar dados', exact=True)).to_be_enabled()
            await page.unroute('**/diagnosticos', truncated_response); await recover()
            assert len([i for i in await get(path + '/diagnosticos') if i['pieceId'] == pool[9]['id']]) == 1
            h.mark('HTTP200 with unreadable body is uncertain, never falsely confirmed; GET recovers the actual saved row without another POST')

            # Autosave conflict keeps local input; an explicit saved-version recovery precedes new editing.
            await page.locator('.diagnosis-card').filter(has_text='Capô').get_by_role('button', name=re.compile('^Capô')).click()
            await page.get_by_role('button',name='Observação da peça',exact=True).click()
            current=next(i for i in await get(path+'/diagnosticos') if i['id']==item['id'])
            await write(b,path+'/diagnosticos/'+item['id'],{'revision':current['revision'],'services':current['services'],'notes':'Outro operador QA'},'patch')
            field=page.get_by_role('textbox',name='Observação da peça',exact=True)
            await field.fill('QA rascunho a preservar')
            await expect(page.get_by_role('alert')).to_contain_text('dados salvos mudaram')
            await expect(field).to_have_value('QA rascunho a preservar')
            await page.get_by_role('button',name='Carregar versão salva',exact=True).click()
            await expect(field).to_have_value('Outro operador QA')
            await field.fill('QA rascunho a preservar')
            await expect(page.locator('.approved-editor').get_by_role('status')).to_contain_text('Salvo')
            kept = next(i for i in await get(path + '/diagnosticos') if i['id'] == item['id'])
            assert kept['notes'] == 'QA rascunho a preservar' and kept['services'][0]['quantity'] == '0.25'
            await page.get_by_role('button', name='Voltar aos Diagnósticos', exact=True).click()
            h.mark('autosave conflict preserves unsaved notes/quantities; only explicit saved-version reload allows a new deliberate edit')

            # Initial GET outage: no mutation, useful retry and precise HTTP phase.
            async def unavailable(route):
                await route.fulfill(status=503, content_type='application/json', body=json.dumps({'error': {'code': 'QA_UNAVAILABLE', 'message': 'QA indisponibilidade temporária'}}))
            await page.route('**/api/catalogos', unavailable); await page.reload()
            await expect(page.get_by_role('alert')).to_contain_text('QA indisponibilidade')
            await page.get_by_text('Detalhes da falha', exact=True).click()
            await expect(page.locator('details').filter(has=page.get_by_text('Detalhes da falha', exact=True))).to_contain_text('HTTP 503')
            await page.unroute('**/api/catalogos', unavailable); await recover()
            await page.screenshot(path=str(ARTIFACTS / 'recuperado-desktop.png'))
            h.mark('initial GET503 differs from transport/POST errors and offers working manual recovery without resetting data')

            # A GET snapshot from before a write must not replace a newer revision.
            captured = asyncio.Event(); release = asyncio.Event(); delayed = False
            async def hold_old_workspace(route):
                nonlocal delayed
                if not delayed and route.request.method == 'GET':
                    delayed = True
                    old = await route.fetch(); captured.set()
                    await release.wait(); await route.fulfill(response=old)
                else: await route.continue_()
            await page.locator('.diagnosis-card').filter(has_text='Capô').get_by_role('button', name=re.compile('^Capô')).click()
            await page.route('**/cenarios*', hold_old_workspace)
            await page.get_by_role('button', name='Voltar aos Diagnósticos', exact=True).click()
            await asyncio.wait_for(captured.wait(), 10)
            await page.get_by_role('button', name='+ Adicionar peça', exact=True).click()
            assert await choose(pool[15]) == 200
            count = len(await get(path + '/diagnosticos'))
            release.set(); await page.wait_for_timeout(150)
            await expect(page.locator('.diagnosis-card')).to_have_count(count)
            assert await choose(pool[16]) == 200
            await page.unroute('**/cenarios*', hold_old_workspace)
            h.mark('single writer: delayed old GET after a newer POST/GET cannot regress rows or revision; next addition succeeds without conflict')

            entered = asyncio.Event(); release_post = asyncio.Event()
            async def hold_post(route):
                if route.request.method == 'POST':
                    response = await route.fetch(); assert response.status == 200
                    entered.set(); await release_post.wait(); await route.fulfill(response=response)
                else: await route.continue_()
            await page.route('**/diagnosticos', hold_post)
            target = await button(pool[17]); n = post_count
            await target.evaluate('(e)=>{e.click();e.click()}')
            await asyncio.wait_for(entered.wait(), 10)
            await expect(target).to_be_disabled(); assert post_count == n + 1
            release_post.set(); await expect(target).to_be_enabled()
            await page.unroute('**/diagnosticos', hold_post)
            assert len([i for i in await get(path + '/diagnosticos') if i['pieceId'] == pool[17]['id']]) == 1
            assert post_count == n + 1
            h.mark('rapid double click while real POST response is pending issues one POST, saves one row and releases busy after confirmation')

            expected = await get(path + '/diagnosticos')
            await h.restart_api(); await a.close(); await b.close()
            a = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            await h.watch(a); page = await a.new_page(); await h.attach(page)
            await page.goto(ORIGIN + '/atendimentos/' + at['id'] + '?aba=mapa'); await h.login(page)
            await expect(active_scenario(page,'Cenário 1')).to_be_visible()
            await expect(page.locator('.interactive-map')).to_be_visible()
            await page.get_by_role('button', name='Diagnósticos', exact=True).click()
            await expect(page.locator('.diagnosis-card')).to_have_count(len(expected))
            await page.get_by_role('button', name='Mapa', exact=True).click()
            after = await get(path + '/diagnosticos'); assert after == expected
            assert len({i['pieceId'] for i in after}) == len(after)
            await select_named_scenario(page,'Cenário 2')
            await expect(active_scenario(page,'Cenário 2')).to_be_visible()
            await page.screenshot(path=str(ARTIFACTS / 'recuperado-mobile.png'))
            h.mark('fresh mobile browser after API restart recovers every confirmed row, two scenarios, stable IDs and fractional quantities without duplicates')
            assert not h.external and not h.page_errors, (h.external, h.page_errors)
            await browser.close(); browser = None
    except Exception as cause:
        error = str(cause) or type(cause).__name__; traceback.print_exc()
    finally:
        if browser: await browser.close()
        h.cleanup()
        (ARTIFACTS / 'resultados.json').write_text(json.dumps({'suite': 'Issue12 inclusão e recuperação', 'synthetic': True, 'assertions': h.results, 'observed_ui_post_count': post_count, 'fault_injection': 'Controlled request aborts and lost/truncated responses; all successful writes use real API/SQLite', 'error': error, 'external_hosts': h.external, 'page_errors': h.page_errors}, ensure_ascii=False, indent=2) + '\n')
    if error: raise SystemExit(1)
    print(f'{len(h.results)} Issue12 browser groups passed')


if __name__ == '__main__': asyncio.run(run())
