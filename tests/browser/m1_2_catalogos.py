"""M1.2 browser QA: real Node/SQLite, synthetic data, no external hosts.
Reuses only the local-process harness from M1.1; never accesses the normal DB.
"""
import asyncio
import json
import re
import traceback
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN

ARTIFACTS = ROOT / 'docs/evidencias/m1-2'


async def run():
    h = Harness()
    browser = None
    failed = None
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    try:
        h.check_ports()
        await h.start_api()
        vite = h.start(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 'vite')
        await h.ready(ORIGIN, vite)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            context = await browser.new_context(viewport={'width': 1440, 'height': 960})
            await h.watch(context)
            page = await context.new_page()
            await h.attach(page)
            page.set_default_timeout(10000)
            await page.goto(ORIGIN + '/funil')
            await h.login(page)
            await page.get_by_role('button', name='+ Novo Atendimento', exact=True).click()
            await page.get_by_label('Telefone *', exact=True).fill('123456')
            await page.get_by_label('Nome do contato', exact=True).fill('QA M1.2 — SINTÉTICO')
            await page.get_by_role('button', name='Criar Atendimento', exact=True).click()
            await expect(page.get_by_role('button', name='Editar Atendimento', exact=True)).to_be_visible()
            at_id = re.search(r'/atendimentos/([^?]+)', page.url).group(1)
            path = f'/api/atendimentos/{at_id}/diagnosticos'
            await page.get_by_role('button', name='Diagnósticos', exact=True).click()
            await page.get_by_role('button', name='+ Adicionar peça', exact=True).click()
            await page.get_by_label('Buscar peça em todas as vistas').fill('capo')
            await expect(page.locator('.piece-options button').first).to_be_enabled()
            await page.get_by_label('Buscar peça em todas as vistas').fill('teto solar')
            await expect(page.locator('.piece-options button').first).to_be_enabled()
            await expect(page.locator('.piece-options')).not_to_contain_text('Sugestão V2')
            await page.get_by_label('Buscar peça em todas as vistas').fill('Veículo completo')
            await expect(page.locator('.piece-options button').first).to_be_disabled()
            h.mark('active coded pieces available immediately; missing-code leaves still blocked, without origin labels')

            await expect(page.get_by_role('button', name='Catálogos', exact=True)).to_have_count(0)
            async def create_catalog(kind, name, service_name=None, code=None):
                data = {'kind': kind, 'name': name}
                if code: data['code'] = code
                if service_name:
                    entries = (await (await context.request.get(ORIGIN + '/api/catalogos')).json())['items']
                    data['serviceId'] = next(i['id'] for i in entries if i['kind'] == 'servico' and i['name'] == service_name)
                response = await context.request.post(ORIGIN + '/api/catalogos', headers={'Origin': ORIGIN}, data=data)
                assert response.status == 201, await response.text()
                return await response.json()
            await create_catalog('servico', 'Serviço QA sintético')
            await create_catalog('diagnostico', 'Dano QA sintético')
            await create_catalog('dimensao', 'Dimensão QA sintética', 'Serviço QA sintético')
            await page.reload()
            h.mark('authenticated catalog API preserved without an operational maintenance button or approval gate')

            await page.get_by_role('button', name='Mapa', exact=True).click()
            await page.locator('[data-region="frente"]').first.click()
            await page.locator('.piece-options button').filter(has=page.get_by_text('Capô', exact=True)).click()
            await expect(page.locator('.diagnosis-card')).to_have_count(1)
            await page.locator('.piece-options button').filter(has=page.get_by_text('Para-lama', exact=True)).click()
            await page.locator('.piece-options button').filter(has=page.get_by_text('Ambos', exact=True)).click()
            await expect(page.locator('.diagnosis-card')).to_have_count(3)
            # Same codes from another region remain the same physical pieces.
            await page.locator('[data-region="motorista"]').click()
            await page.locator('.piece-options button').filter(has=page.get_by_text('Para-lama', exact=True)).click()
            await page.locator('.piece-options button').filter(has=page.get_by_text('Ambos', exact=True)).click()
            await expect(page.locator('.diagnosis-card')).to_have_count(3)
            await page.screenshot(path=str(ARTIFACTS / 'hierarquia-sintetica.png'))
            await page.locator('.diagnostics-body').evaluate('(node) => { node.scrollTop = 0 }')
            await page.screenshot(path=str(ARTIFACTS / 'mapa-sintetico.png'))
            h.mark('interactive original SVG, nested V2 selection, Ambos creates two pieces and cross-view selections deduplicate')

            await page.get_by_role('button', name='Diagnósticos', exact=True).click()
            await page.locator('.diagnosis-card').filter(has_text='Capô').get_by_role('button', name=re.compile('Capô')).click()
            await expect(page.get_by_role('form', name='Editar item de diagnóstico')).to_be_visible()
            await page.get_by_label('Diagnóstico', exact=True).select_option(label='Dano QA sintético')
            await page.get_by_label('Observações do diagnóstico').fill('Composição QA sem preços')
            await page.get_by_role('button', name='+ Adicionar serviço', exact=True).click()
            line = page.locator('[aria-label="Serviço 1"]')
            await line.get_by_label('Serviço', exact=True).select_option(label='Serviço QA sintético')
            await line.get_by_label('Dimensão', exact=True).select_option(label='Dimensão QA sintética')
            await line.get_by_label('Quantidade', exact=True).fill('0.25')
            await page.get_by_role('button', name='Salvar diagnóstico', exact=True).click()
            await expect(page.get_by_role('status')).to_contain_text('Diagnóstico salvo')
            persisted = await (await context.request.get(ORIGIN + path)).json()
            main = next(row for row in persisted if row['notes'] == 'Composição QA sem preços')
            assert main['services'][0]['quantity'] == '0.25'
            item_url = ORIGIN + path + '/' + main['id']
            h.mark('diagnosis/service/dimension selection and quantities persist through real API')

            # Only fault injection: one failed PATCH; every successful write is real.
            async def fail_patch(route):
                if route.request.method == 'PATCH':
                    await route.fulfill(status=503, content_type='application/json', body=json.dumps({'error': {'message': 'Falha sintética de gravação'}}))
                else:
                    await route.continue_()
            await page.route('**' + path + '/' + main['id'], fail_patch)
            await page.get_by_label('Observações do diagnóstico').fill('Texto mantido após falha')
            await page.get_by_role('button', name='Salvar diagnóstico', exact=True).click()
            await expect(page.get_by_role('alert')).to_contain_text('Falha sintética')
            await expect(page.get_by_label('Observações do diagnóstico')).to_have_value('Texto mantido após falha')
            await page.unroute('**' + path + '/' + main['id'], fail_patch)
            current = next(row for row in await (await context.request.get(ORIGIN + path)).json() if row['id'] == main['id'])
            assert current['notes'] == 'Composição QA sem preços'
            h.accept_dialogs = False
            await page.get_by_role('button', name='Editar Atendimento', exact=True).click()
            await expect(page.get_by_role('form', name='Editar item de diagnóstico')).to_be_visible()
            h.accept_dialogs = True
            # Real session expiration while editing must preserve the same draft.
            logout = await context.request.delete(ORIGIN + '/api/session', headers={'Origin': ORIGIN})
            assert logout.status == 200
            await page.get_by_role('button', name='Salvar diagnóstico', exact=True).click()
            await expect(page.get_by_label('Observações do diagnóstico')).to_have_value('Texto mantido após falha')
            await h.login(page)
            await expect(page.get_by_label('Observações do diagnóstico')).to_have_value('Texto mantido após falha')
            # Real competing revision -> 409.
            response = await context.request.patch(item_url, headers={'Origin': ORIGIN}, data={'revision': main['revision'], 'notes': 'Edição concorrente sintética'})
            assert response.status == 200
            await page.get_by_role('button', name='Salvar diagnóstico', exact=True).click()
            await expect(page.get_by_role('alert')).to_contain_text('outra edição')
            await expect(page.get_by_label('Observações do diagnóstico')).to_have_value('Texto mantido após falha')
            await page.get_by_role('button', name='Voltar à lista', exact=True).click()
            await page.locator('.diagnosis-card').filter(has_text='Capô').get_by_role('button', name=re.compile('Capô')).click()
            await expect(page.get_by_label('Observações do diagnóstico')).to_have_value('Edição concorrente sintética')
            await page.get_by_role('button', name='Voltar à lista', exact=True).click()
            h.mark('503, real 401/reauthentication and real 409 preserve unsaved form; navigation protects diagnosis draft')

            # Context isolation and file persistence across API restart and new browser context.
            other = await context.request.post(ORIGIN + '/api/atendimentos', headers={'Origin': ORIGIN}, data={'phone': '654321', 'name': 'QA M1.2 — OUTRO'})
            other_at = await other.json()
            await page.goto(ORIGIN + f'/atendimentos/{other_at["id"]}?aba=diagnosticos')
            await expect(page.get_by_role('heading', name='Itens do Atendimento · 0')).to_be_visible()
            await h.restart_api()
            await context.close()
            mobile = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            await h.watch(mobile)
            page = await mobile.new_page()
            await h.attach(page)
            await page.goto(ORIGIN + f'/atendimentos/{at_id}?aba=diagnosticos')
            await h.login(page)
            await expect(page.locator('.diagnosis-card')).to_have_count(3)
            await expect(page.locator('.detail-header')).to_contain_text('QA M1.2 — SINTÉTICO')
            assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            await page.locator('.diagnosis-card').filter(has_text='Capô').get_by_role('button', name=re.compile('Capô')).click()
            await expect(page.get_by_label('Observações do diagnóstico')).to_have_value('Edição concorrente sintética')
            await expect(page.get_by_label('Quantidade', exact=True)).to_have_value('0.25')
            await page.screenshot(path=str(ARTIFACTS / 'diagnostico-mobile-sintetico.png'))
            await page.get_by_role('button', name='Remover serviço 1', exact=True).click()
            await page.get_by_role('button', name='Salvar diagnóstico', exact=True).click()
            await expect(page.get_by_role('status')).to_contain_text('Diagnóstico salvo')
            await page.get_by_role('button', name='Voltar à lista', exact=True).click()
            await page.locator('.diagnosis-card').filter(has_text='Capô').get_by_role('button', name='Remover item', exact=True).click()
            await expect(page.locator('.diagnosis-card')).to_have_count(2)
            rows = await (await mobile.request.get(ORIGIN + path)).json()
            assert len(rows) == 2 and all(not row['services'] for row in rows)
            h.mark('API restart plus fresh mobile session recovers correct Atendimento, diagnosis and child services; deletion removes children')

            # Direction/API setup is explicit; no new administrative screen.
            context = mobile
            own = await create_catalog('peca', 'Peça QA unificada', code='qa-unified-piece')
            await page.reload()
            await page.get_by_role('button', name='+ Adicionar peça', exact=True).click()
            await page.get_by_label('Buscar peça em todas as vistas').fill('qa-unified-piece')
            await expect(page.locator('.piece-options button')).to_have_count(1)
            await expect(page.locator('.piece-options button')).to_be_enabled()
            await page.get_by_label('Buscar peça em todas as vistas').fill('Peça QA unificada')
            await expect(page.locator('.piece-options button')).to_have_count(1)
            for label in ['Proposta', 'Sugestão V2', 'Peças próprias fora da árvore V2']:
                await expect(page.get_by_text(label, exact=True)).to_have_count(0)
            await page.locator('.piece-options button').scroll_into_view_if_needed()
            await page.screenshot(path=str(ARTIFACTS / 'busca-unificada-mobile.png'))
            await page.locator('.piece-options button').click()
            await expect(page.locator('.diagnosis-card')).to_have_count(3)
            response = await mobile.request.patch(ORIGIN + '/api/catalogos/' + own['id'], headers={'Origin': ORIGIN}, data={'revision': own['revision'], 'active': False})
            assert response.status == 200
            await page.reload()
            await page.get_by_role('button', name='+ Adicionar peça', exact=True).click()
            await page.get_by_label('Buscar peça em todas as vistas').fill('qa-unified-piece')
            await expect(page.locator('.piece-options button')).to_be_disabled()
            await expect(page.locator('.diagnosis-card')).to_have_count(3)
            h.mark('new piece from explicit API setup joins unified name/code search; inactivation blocks new selection and preserves historical reference')

            assert not h.external, h.external
            assert not h.page_errors, h.page_errors
            assert not any('/api/experiencias' in r['path'] or '/api/workspace' in r['path'] for r in h.api_requests)
            await expect(page.get_by_role('button', name='Orçamento e componentes', exact=True)).to_be_enabled()
            h.mark('no external hosts, no Coda/legacy requests, no browser errors; Issue 7 budget entry is available without external integration')
            await browser.close()
            browser = None
    except Exception as error:
        failed = str(error) or type(error).__name__
        traceback.print_exc()
    finally:
        if browser:
            await browser.close()
        h.cleanup()
        (ARTIFACTS / 'resultados.json').write_text(json.dumps({'suite': 'M1.2 Catálogos e diagnósticos', 'synthetic': True, 'fault_injection': 'One PATCH 503; 409 is a real competing edit', 'assertions': h.results, 'external_hosts': h.external, 'page_errors': h.page_errors, 'error': failed}, ensure_ascii=False, indent=2) + '\n')
    if failed:
        raise SystemExit(1)
    print(f'{len(h.results)} M1.2 browser scenario groups passed')


if __name__ == '__main__':
    asyncio.run(run())
