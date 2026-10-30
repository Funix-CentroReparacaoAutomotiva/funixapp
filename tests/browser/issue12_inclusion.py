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
                # Etapa B closes the selector when opening a complete piece screen.
                if not await page.get_by_label('Buscar peça em todas as vistas').count():
                    await page.get_by_role('button',name='+ Adicionar peça',exact=True).click()
                await page.get_by_label('Buscar peça em todas as vistas').fill(entry['code'])
                return page.locator('.piece-options button').filter(has=page.get_by_text(entry['name'], exact=True)).first
            async def choose(entry, ready=True):
                target = await button(entry)
                async with page.expect_response(lambda r: r.request.method == 'POST' and r.url.endswith('/diagnosticos')) as pending:
                    await target.click()
                response = await pending.value
                if ready and response.ok: await expect(page.locator('#piece-selection-status')).to_be_empty()
                return response.status
            async def recover():
                await page.get_by_role('button',name=re.compile('^Atualizar dados')).click()
                await expect(page.locator('#piece-selection-status')).to_be_empty()
                await expect(page.get_by_role('alert')).to_have_count(0)

            assert [await choose(i) for i in pool[:3]] == [200, 200, 200]
            response = await a.request.get(ORIGIN + path + '/cenarios')
            assert response.headers['cache-control'] == 'no-store'
            h.mark('existing file-backed Atendimento after restart accepts sequential additions; GET is no-store; existing fractional service preserved')

            w = await get(path + '/cenarios'); s = w['scenarios'][0]
            await write(b, path + '/diagnosticos', {'pieceCodes': [pool[3]['code']], 'scenarioId': s['id'], 'scenarioRevision': s['revision']})
            n = post_count
            assert await choose(pool[4]) == 409
            await expect(page.get_by_role('alert')).to_contain_text('cenário mudou')
            assert post_count == n + 1  # never replays a mutation automatically
            await recover()
            w = await get(path + '/cenarios')
            assert len(w['items']) == 6 and len(w['scenarios']) == 2
            assert not w['scenarios'][1]['pieceFlags'][next(i['id'] for i in w['items'] if i['pieceId'] == pool[4]['id'])]
            h.mark('second session produces real 409; one GET reconciliation refreshes revision; next explicit attempt succeeds without POST replay or scenario clones')

            # Issue22: ordinary mutations no longer depend on a catalog GET.
            catalog_gets = 0
            async def abort_catalog(route):
                nonlocal catalog_gets
                catalog_gets += 1
                await route.abort('failed')
            await page.route('**/api/catalogos', abort_catalog)
            assert await choose(pool[5]) == 200
            assert catalog_gets == 0
            await expect(page.get_by_role('alert')).to_have_count(0)

            # Post-commit GET failure is uncertain: keep intention, no blind POST replay.
            async def abort_get(route): await route.abort('failed')
            await page.route('**/cenarios*',abort_get);n=post_count
            assert await choose(pool[6],ready=False)==200
            await expect(page.get_by_role('alert')).to_contain_text('seleções pendentes')
            await expect(await button(pool[6])).to_be_disabled()
            assert any(i['pieceId']==pool[6]['id']for i in await get(path+'/diagnosticos'))
            await page.get_by_text('Detalhes da falha',exact=True).click()
            details=await page.locator('details').filter(has=page.get_by_text('Detalhes da falha',exact=True)).inner_text()
            assert 'GET /api/atendimentos/:id/cenarios'in details and at['id']not in details
            await page.unroute('**/cenarios*',abort_get);await recover()
            assert catalog_gets==0 and post_count==n+1
            await page.unroute('**/api/catalogos',abort_catalog)
            h.mark('ordinary mutations and recovery use cached catalogs; failed post-commit GET keeps confirmed rows and resumes after explicit read without POST replay')

            # Before-delivery POST failure: no database write, no automatic retry.
            async def abort_post(route):
                if route.request.method == 'POST': await route.abort('failed')
                else: await route.continue_()
            await page.route('**/diagnosticos', abort_post)
            before = await get(path + '/diagnosticos'); n = post_count
            await (await button(pool[7])).click()
            await expect(page.get_by_role('alert')).to_contain_text('seleções pendentes')
            await expect(page.get_by_role('button', name=re.compile('^Atualizar dados'))).to_be_enabled()
            assert await get(path + '/diagnosticos') == before and post_count == n + 1
            await page.unroute('**/diagnosticos', abort_post); await recover()
            assert any(i['pieceId']==pool[7]['id']for i in await get(path+'/diagnosticos'))
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
            await expect(page.get_by_role('alert')).to_contain_text('seleções pendentes')
            saved = next(i for i in await get(path + '/diagnosticos') if i['pieceId'] == pool[8]['id'])
            assert post_count == n + 1
            await page.unroute('**/diagnosticos', lose_response); await recover()
            await (await button(pool[8])).click();await expect(page.locator('#piece-selection-status')).to_be_empty()
            assert [i['id']for i in await get(path+'/diagnosticos')if i['pieceId']==pool[8]['id']]==[saved['id']]
            h.mark('lost POST response after real commit is reconciled by GET; deliberate repeated selection preserves one physical identity and previous flags')

            async def truncated_response(route):
                if route.request.method == 'POST':
                    response = await route.fetch(); assert response.status == 200
                    await route.fulfill(response=response, body='truncated JSON')
                else: await route.continue_()
            await page.route('**/diagnosticos', truncated_response)
            await (await button(pool[9])).click()
            await expect(page.get_by_role('alert')).to_contain_text('seleções pendentes')
            await expect(page.locator('#piece-selection-status')).to_contain_text('Seleções pendentes')
            await expect(page.get_by_role('button', name=re.compile('^Atualizar dados'))).to_be_enabled()
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
            await expect(page.get_by_role('alert')).to_contain_text('campos foram preservados')
            await expect(field).to_have_value('QA rascunho a preservar')
            await page.get_by_role('button',name='Carregar versão salva',exact=True).click()
            await expect(field).to_have_value('Outro operador QA')
            await field.fill('QA rascunho a preservar')
            await expect(page.locator('.approved-editor')).to_have_attribute('data-save-state','confirmed')
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

            # Etapa B removes the redundant GET on returning from a complete piece screen.
            # Still exercise a stale workspace snapshot against a real second writer.
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
            await expect(page.locator('.diagnosis-list')).to_be_visible()
            await page.wait_for_timeout(150); assert not captured.is_set()
            await page.get_by_role('button', name='+ Adicionar peça', exact=True).click()
            assert await choose(pool[15], ready=False) == 200
            await asyncio.wait_for(captured.wait(), 10)
            fresh = await get(path + '/cenarios'); scene = fresh['scenarios'][0]
            await write(b, path + '/diagnosticos', {'pieceCodes':[pool[16]['code']], 'scenarioId':scene['id'], 'scenarioRevision':scene['revision']})
            release.set(); await expect(page.locator('#piece-selection-status')).to_be_empty()
            assert await choose(pool[16], ready=False) == 409
            await expect(page.get_by_role('alert')).to_contain_text('cenário mudou')
            await recover()
            rows=await get(path+'/diagnosticos');assert len([i for i in rows if i['pieceId']==pool[16]['id']])==1
            await page.unroute('**/cenarios*',hold_old_workspace)
            h.mark('full-screen return issues no redundant GET; delayed stale workspace versus second writer reconciles real 409 without losing or duplicating confirmed pieces')

            entered=asyncio.Event();release_post=asyncio.Event()
            async def hold_post(route):
                if route.request.method=='POST':
                    response=await route.fetch();assert response.status==200;entered.set();await release_post.wait();await route.fulfill(response=response)
                else:await route.continue_()
            await page.route('**/diagnosticos',hold_post);target=await button(pool[17]);n=post_count
            await target.click();await asyncio.wait_for(entered.wait(),10)
            await expect(target).to_be_enabled();await target.click()
            release_post.set();await expect(page.locator('#piece-selection-status')).to_be_empty();await page.unroute('**/diagnosticos',hold_post)
            rows=[i for i in await get(path+'/diagnosticos')if i['pieceId']==pool[17]['id']]
            assert len(rows)==1 and not rows[0]['enabled']and post_count==n+1
            h.mark('rapid on/off during committed POST remains interactive, one master row and one POST, final exclusion confirmed')

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
