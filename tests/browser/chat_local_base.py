"""Real Chat GET/UI against temporary SQLite; synthetic data, no provider calls.

python tests/browser/chat_local_base.py
Supersedes the first increment's smoke that expected Chat to be unavailable.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN, API


async def run():
    harness = Harness()
    browser = None
    artifacts = ROOT / '.runtime/chat-readonly-browser'
    captures = ROOT / 'docs/evidencias/issue56-chat'
    artifacts.mkdir(parents=True, exist_ok=True)
    captures.mkdir(parents=True, exist_ok=True)
    initial_clock = 1793883600000
    try:
        harness.check_ports()
        metadata = harness.folder / 'metadata.json'
        clock = harness.folder / 'clock.txt'
        mode = harness.folder / 'mode.txt'
        clock.write_text(str(initial_clock))
        mode.write_text('normal')
        relay_key = secrets.token_bytes(32)
        relay_config = harness.folder / 'relay-keys.json'
        relay_config.write_text(json.dumps({'version': 1, 'keys': [{'keyId': 'synthetic-browser-relay', 'secretBase64': base64.b64encode(relay_key).decode(), 'instances': ['synthetic-browser']}]}))
        relay_config.chmod(0o600)
        runner = harness.folder / 'chat-fixture.mjs'
        modules = {name: (ROOT / path).as_uri() for name, path in {
            'database': 'server/database.ts', 'atendimentos': 'server/atendimentos.ts',
            'fixture': 'server/tests/fixtures/chat-readonly.ts', 'app': 'server/app.ts',
            'ingest_config': 'server/chat/ingest-config.ts',
        }.items()}
        runner.write_text(f"""
import {{writeFileSync,readFileSync}} from 'node:fs';
import {{createServer}} from 'node:http';
import {{setTimeout as pause}} from 'node:timers/promises';
import {{openDatabase}} from {json.dumps(modules['database'])};
import {{AtendimentoRepository}} from {json.dumps(modules['atendimentos'])};
import {{chatReadFixture}} from {json.dumps(modules['fixture'])};
import {{createRequestHandler}} from {json.dumps(modules['app'])};
import {{loadIngestOptions}} from {json.dumps(modules['ingest_config'])};
const db=openDatabase(process.env.FUNIX_DATABASE_PATH);
const fixture=chatReadFixture(db);
writeFileSync({json.dumps(str(metadata))},JSON.stringify(fixture));
const handle=createRequestHandler({{atendimentos:new AtendimentoRepository(db),origin:process.env.FUNIX_APP_ORIGIN,password:process.env.FUNIX_OPERATOR_PASSWORD,voiceProvider:null,now:()=>Number(readFileSync({json.dumps(str(clock))},'utf8')),whatsappIngest:loadIngestOptions({{FUNIX_WHATSAPP_INGEST_ENABLED:'true',FUNIX_WHATSAPP_INGEST_CONFIG_FILE:{json.dumps(str(relay_config))}}})}});
createServer(async(req,res)=>{{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/atendimentos/'+fixture.a.id+'/messages'){{
    const mode=()=>readFileSync({json.dumps(str(mode))},'utf8');
    if(mode()==='append-delay-more'){{fixture.appendEvents();writeFileSync({json.dumps(str(mode))},'delay-more');}}
    while(mode()==='delay'||mode()==='delay-more'&&url.searchParams.has('cursor'))await pause(20);
    if(res.destroyed)return;
    if(mode()==='fail-all'||mode()==='fail-more'&&url.searchParams.has('cursor')){{res.writeHead(503,{{'Content-Type':'application/json','Cache-Control':'no-store'}});res.end(JSON.stringify({{error:{{message:'Falha sintética'}}}}));return;}}
  }}
  await handle(req,res);
}}).listen(8787,'127.0.0.1');
""")
        api = harness.start(['node', str(runner)], 'chat-synthetic-api')
        await harness.ready(API + '/api/ready', api)
        vite = harness.start(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 'chat-vite')
        await harness.ready(ORIGIN, vite)
        records = json.loads(metadata.read_text())
        async with async_playwright() as playwright:
            executable = os.environ.get('CHROME_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
            browser = await playwright.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
            for width, height in [(320, 740), (390, 844), (1440, 900)]:
                clock.write_text(str(initial_clock))
                mode.write_text('normal')
                if width != 320:
                    harness.stop(api)
                    (harness.folder / 'atendimentos.sqlite').unlink()
                    api = harness.start(['node', str(runner)], 'chat-synthetic-api')
                    await harness.ready(API + '/api/ready', api)
                    records = json.loads(metadata.read_text())
                context = await browser.new_context(viewport={'width': width, 'height': height})
                async def block_external(route):
                    harness.external.append(urlparse(route.request.url).hostname)
                    await route.abort()
                await context.route(re.compile(r'^https?://(?!(?:127\.0\.0\.1|localhost)(?::\d+)?/)'), block_external)
                a_url = ORIGIN + f"/api/atendimentos/{records['a']['id']}/messages"
                assert (await context.request.get(a_url)).status == 401
                assert (await context.request.post(ORIGIN + '/api/session', headers={'Origin': ORIGIN}, data={'password': harness.password})).status == 200
                assert (await (await context.request.get(ORIGIN + '/api/health')).json())['capabilities']['messages'] is False
                ingest_url = ORIGIN + '/api/integrations/whatsapp/events'
                marker = 'EVENTO HTTP SINTÉTICO PENDENTE PRIVADO'
                event = {'schemaVersion': 1, 'instance': 'synthetic-browser', 'eventId': 'synthetic-http-event', 'occurredAt': '2026-11-05T13:45:00.000Z', 'type': 'message.upsert',
                         'message': {'remoteJid': 'http-unlinked-synthetic@lid', 'messageId': 'synthetic-http-message', 'fromMe': False, 'origin': 'unknown', 'kind': 'text', 'text': marker, 'media': None}}
                body = json.dumps(event, ensure_ascii=False).encode('utf-8')
                assert (await context.request.post(ingest_url, data=body, headers={'Content-Type': 'application/json'})).status == 401
                timestamp = str(initial_clock // 1000)
                signature = hmac.new(relay_key, ('v1\nsynthetic-browser-relay\n' + timestamp + '\n').encode() + body, hashlib.sha256).hexdigest()
                relay_headers = {'Content-Type': 'application/json', 'X-Funix-Key-Id': 'synthetic-browser-relay', 'X-Funix-Timestamp': timestamp, 'X-Funix-Signature': 'sha256=' + signature}
                received = await context.request.post(ingest_url, data=body, headers=relay_headers)
                assert received.status == 202
                receipt = await received.json()
                assert receipt['disposition'] == 'pending'
                assert (await (await context.request.post(ingest_url, data=body, headers=relay_headers)).json()) == receipt
                page = await context.new_page()
                await harness.attach(page)
                # Hold the first A response, then navigate through history to B.
                # A's late response must never replace B, even with the same phone.
                mode.write_text('delay')
                await page.goto(ORIGIN + f"/atendimentos/{records['a']['id']}?aba=chat")
                await expect(page.get_by_text('Carregando mensagens…', exact=True)).to_be_visible()
                await page.evaluate("url => { history.pushState({...history.state,funixIndex:(history.state?.funixIndex??0)+1},'',url); dispatchEvent(new PopStateEvent('popstate',{state:history.state})); }", f"/atendimentos/{records['b']['id']}?aba=chat")
                await expect(page.get_by_text(records['privateB'], exact=True)).to_be_visible()
                mode.write_text('normal')
                assert records['first'] not in await page.locator('.chat-history').inner_text()
                harness.mark(f'{width}px: signed HTTP replay stays private; late A response cannot overwrite B')

                for key in ['a', 'b', 'a']:
                    await harness.goto_record(page, records[key])
                    expected = records['last'] if key == 'a' else records['privateB']
                    await expect(page.get_by_text(expected, exact=True)).to_be_visible()
                    await expect(page.get_by_role('button', name='Abrir Copiloto FUNIX', exact=True)).to_have_count(1)
                    await page.get_by_role('button', name='Abrir Copiloto FUNIX', exact=True).click()
                    await expect(page.get_by_role('region', name='Copiloto FUNIX', exact=True)).to_be_visible()
                    await page.get_by_role('button', name='Fechar Copiloto', exact=True).click()
                    history = await page.locator('.chat-history').inner_text()
                    assert (records['privateB'] if key == 'a' else records['last']) not in history
                    assert 'PENDENTE PRIVADO' not in history
                    assert marker not in history
                    for tab in ['Diagnóstico', 'Mapa', 'Chat']:
                        await page.get_by_role('button', name=tab, exact=True).click()
                        await expect(page.get_by_role('button', name=tab, exact=True)).to_have_attribute('aria-current', 'page')
                    await expect(page.get_by_text(expected, exact=True)).to_be_visible()
                await expect(page.locator('.chat-message')).to_have_count(50)
                assert records['first'] not in await page.locator('.chat-history').inner_text()
                assert await page.locator('.chat-message').first.get_attribute('data-sequence') == '5'
                assert await page.locator('.chat-message').last.get_attribute('data-sequence') == '54'
                bounds = await page.locator('.at-chat-scroll').bounding_box()
                last = await page.locator('.chat-message').last.bounding_box()
                assert bounds and last and last['y'] >= bounds['y'] and last['y'] + last['height'] <= bounds['y'] + bounds['height'] + 1
                assert await page.locator('.chat-incoming').count() > 0
                assert await page.locator('.chat-outgoing').count() > 0
                for status in ['Aceita pelo provedor', 'Entregue', 'Lida', 'Falhou']:
                    await expect(page.get_by_text(status, exact=True)).to_be_visible()
                await expect(page.get_by_text('Mídia indisponível', exact=True)).to_have_count(4)
                assert await page.locator('.chat-messages img, .chat-messages audio, .chat-messages video, .chat-messages a').count() == 0
                assert await page.evaluate('window.chatInjection === undefined')
                assert await page.locator('.chat-message-status').count() == 4
                assert await page.locator('.chat-message time').count() == 50
                await expect(page.get_by_label('Mensagem ao cliente', exact=True)).to_be_disabled()
                assert await page.evaluate("async()=>{const r=await fetch('/api/integrations/whatsapp/events',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status}") == 403
                await expect(page.get_by_label('Enviar mensagem indisponível', exact=True)).to_be_disabled()
                assert await page.locator('.chat-rail button:enabled').count() == 0
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                assert await page.locator('.at-chat-scroll').evaluate('el => el.scrollWidth <= el.clientWidth + 1')
                await page.screenshot(path=str(captures / f'chat-{width}.png'))
                # Cursor pagination failure keeps the current 50 rows; retry is real GET.
                mode.write_text('fail-more')
                await page.get_by_role('button', name='Carregar mensagens anteriores', exact=True).click()
                await expect(page.get_by_text('Falha ao carregar mensagens', exact=True)).to_be_visible()
                await expect(page.locator('.chat-message')).to_have_count(50)
                if width == 390:
                    await page.get_by_text('Falha ao carregar mensagens', exact=True).scroll_into_view_if_needed()
                    await page.screenshot(path=str(captures / 'chat-error-390.png'))
                mode.write_text('append-delay-more')
                await page.get_by_role('button', name='Tentar novamente', exact=True).click()
                await expect(page.get_by_text('Carregando mensagens…', exact=True)).to_be_visible()
                for _ in range(500):
                    if mode.read_text() == 'delay-more':
                        break
                    await asyncio.sleep(0.01)
                assert mode.read_text() == 'delay-more'
                # Move while the request is pending: restore the position at the
                # time the prepend commits, not the position of the click.
                anchor = await page.locator('.at-chat-scroll').evaluate('''el => {
                  const target=el.querySelectorAll('.chat-message')[16];
                  el.scrollTop+=target.getBoundingClientRect().top-el.getBoundingClientRect().top-40;
                  const top=el.getBoundingClientRect().top;
                  const first=[...el.querySelectorAll('.chat-message')].find(m=>m.getBoundingClientRect().bottom>top);
                  return {sequence:first.dataset.sequence,offset:first.getBoundingClientRect().top-top};
                }''')
                mode.write_text('normal')
                await expect(page.locator('.chat-message')).to_have_count(records['count'])
                await expect(page.get_by_text(records['last'], exact=True)).to_be_visible()
                offset = await page.locator(f'.chat-message[data-sequence="{anchor["sequence"]}"]').evaluate('el=>el.getBoundingClientRect().top-document.querySelector(".at-chat-scroll").getBoundingClientRect().top')
                assert abs(offset - anchor['offset']) < 2, (width, anchor, offset)
                assert records['newMessage'] not in await page.locator('.chat-history').inner_text()
                assert records['lateMessage'] not in await page.locator('.chat-history').inner_text()
                assert await page.locator('.chat-message').evaluate_all('els => new Set(els.map(e=>e.dataset.sequence)).size === els.length')
                await page.get_by_role('button', name='Atualizar mensagens', exact=True).click()
                await expect(page.get_by_text(records['newMessage'], exact=True)).to_be_visible()
                await expect(page.locator('.chat-message')).to_have_count(50)
                last = await page.locator('.chat-message').last.bounding_box()
                bounds = await page.locator('.at-chat-scroll').bounding_box()
                assert last and bounds and last['y'] + last['height'] <= bounds['y'] + bounds['height'] + 1
                await page.get_by_role('button', name='Carregar mensagens anteriores', exact=True).click()
                await expect(page.locator('.chat-message')).to_have_count(records['count'] + 2)
                await expect(page.get_by_text(records['lateMessage'], exact=True)).to_be_visible()
                keys = await page.locator('.chat-message').evaluate_all('els=>els.map(el=>[el.querySelector("time").dateTime,Number(el.dataset.sequence)])')
                assert keys == sorted(keys) and len({sequence for _, sequence in keys}) == len(keys)
                await harness.goto_record(page, records['b'])
                await expect(page.get_by_text(records['privateB'], exact=True)).to_be_visible()
                assert records['newMessage'] not in await page.locator('.chat-history').inner_text()
                await harness.goto_record(page, records['a'])
                await expect(page.get_by_text(records['newMessage'], exact=True)).to_be_visible()
                await expect(page.locator('.chat-message')).to_have_count(50)
                mode.write_text('delay-more')
                await page.get_by_role('button', name='Carregar mensagens anteriores', exact=True).click()
                await expect(page.get_by_text('Carregando mensagens…', exact=True)).to_be_visible()
                await page.evaluate("url => { history.pushState({...history.state,funixIndex:(history.state?.funixIndex??0)+1},'',url); dispatchEvent(new PopStateEvent('popstate',{state:history.state})); }", f"/atendimentos/{records['b']['id']}?aba=chat")
                await expect(page.get_by_text(records['privateB'], exact=True)).to_be_visible()
                mode.write_text('normal')
                await expect(page.locator('.chat-message')).to_have_count(1)
                assert records['newMessage'] not in await page.locator('.chat-history').inner_text()
                await harness.goto_record(page, records['a'])
                await expect(page.get_by_text(records['newMessage'], exact=True)).to_be_visible()
                await expect(page.locator('.chat-message')).to_have_count(50)
                harness.mark(f'{width}px: latest 50, older prepend preserves reading position, refresh includes new/late events without duplicates')
                # Initial load failure has a genuine retry, followed by the empty state.
                mode.write_text('fail-all')
                await page.get_by_role('button', name='Atualizar mensagens', exact=True).click()
                await expect(page.get_by_text('Falha ao carregar mensagens', exact=True)).to_be_visible()
                await expect(page.locator('.chat-message')).to_have_count(0)
                mode.write_text('normal')
                await page.get_by_role('button', name='Tentar novamente', exact=True).click()
                await expect(page.get_by_text(records['newMessage'], exact=True)).to_be_visible()
                await harness.goto_record(page, records['empty'])
                await expect(page.get_by_text('Nenhuma mensagem disponível neste Atendimento', exact=True)).to_be_visible()
                await expect(page.locator('.chat-message')).to_have_count(0)
                if width == 390:
                    await page.screenshot(path=str(captures / 'chat-empty-390.png'))
                await expect(page.get_by_text('Recebimento WhatsApp ainda não conectado', exact=True).first).to_be_visible()
                # Expire the actual server-side session through the test-only clock.
                await harness.goto_record(page, records['a'])
                await expect(page.get_by_text(records['newMessage'], exact=True)).to_be_visible()
                clock.write_text(str(initial_clock + 8 * 60 * 60 * 1000 + 1))
                await page.get_by_role('button', name='Atualizar mensagens', exact=True).click()
                await expect(page.get_by_label('Senha de acesso', exact=True)).to_be_visible()
                assert records['first'] not in await page.locator('body').inner_text()
                assert records['newMessage'] not in await page.locator('body').inner_text()
                assert records['privateB'] not in await page.locator('body').inner_text()
                harness.mark(f'{width}px: loading/error/empty and expired session remove private content')
                await page.unroute_all(behavior='wait')
                await context.unroute_all(behavior='wait')
                await context.close()
            assert not harness.external
            assert not harness.page_errors
            await browser.close()
            browser = None
        report = {'results': harness.results, 'externalRequests': 0, 'pageErrors': 0, 'synthetic': True}
        (artifacts / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        (captures / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    finally:
        if browser:
            await browser.close()
        harness.cleanup()


if __name__ == '__main__':
    asyncio.run(run())
