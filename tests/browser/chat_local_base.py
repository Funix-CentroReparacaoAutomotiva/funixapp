"""Smoke of the existing UI with the new local schema; no Chat UI activation.

python tests/browser/chat_local_base.py
Uses temporary SQLite, local processes and synthetic records only.
"""
import asyncio
import json
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN, API


async def run():
    harness = Harness()
    browser = None
    artifacts = ROOT / '.runtime/chat-local-browser'
    artifacts.mkdir(parents=True, exist_ok=True)
    try:
        harness.check_ports()
        metadata = harness.folder / 'metadata.json'
        # Test-only runner: the normal application never seeds/registers Chat.
        runner = harness.folder / 'chat-fixture.mjs'
        modules = {name: (ROOT / path).as_uri() for name, path in {
            'database': 'server/database.ts', 'atendimentos': 'server/atendimentos.ts',
            'chat': 'server/chat/repository.ts', 'app': 'server/app.ts',
        }.items()}
        runner.write_text(f"""
import {{writeFileSync}} from 'node:fs';
import {{openDatabase}} from {json.dumps(modules['database'])};
import {{AtendimentoRepository}} from {json.dumps(modules['atendimentos'])};
import {{ChatRepository}} from {json.dumps(modules['chat'])};
import {{createApp}} from {json.dumps(modules['app'])};
const db=openDatabase(process.env.FUNIX_DATABASE_PATH),repo=new AtendimentoRepository(db);
const a=repo.create({{phone:'000000001',name:'QA Atendimento A'}}),b=repo.create({{phone:'000000002',name:'QA Atendimento B'}});
const now='2026-11-05T13:00:00.000Z',chat=new ChatRepository(db,()=>now);
chat.registerInstance('synthetic-browser','2026-11-05T12:00:00.000Z');
chat.ingest(JSON.stringify({{schemaVersion:1,instance:'synthetic-browser',eventId:'browser-event',occurredAt:now,type:'message.upsert',message:{{remoteJid:'browser@lid',messageId:'browser-message',fromMe:false,origin:'unknown',kind:'text',text:'CHAT_PRIVATE_SYNTHETIC_CONTENT',media:null}}}}));
chat.link({{conversationId:chat.pending()[0].conversationId,atendimentoId:a.id,revision:0,requestId:'browser-link',actor:'qa',reason:'Vínculo sintético explícito',pendingMessageIds:['browser-message']}});
writeFileSync({json.dumps(str(metadata))},JSON.stringify({{a,b}}));
createApp({{atendimentos:repo,origin:process.env.FUNIX_APP_ORIGIN,password:process.env.FUNIX_OPERATOR_PASSWORD,voiceProvider:null}}).listen(8787,'127.0.0.1');
""")
        api = harness.start(['node', str(runner)], 'chat-synthetic-api')
        await harness.ready(API + '/api/ready', api)
        vite = harness.start(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 'chat-vite')
        await harness.ready(ORIGIN, vite)
        records = json.loads(metadata.read_text())
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            for width, height in [(320, 740), (390, 844), (1440, 900)]:
                context = await browser.new_context(viewport={'width': width, 'height': height})
                await harness.watch(context)
                response = await context.request.get(ORIGIN + '/api/chat/conversations')
                assert response.status == 401
                response = await context.request.post(ORIGIN + '/api/session', headers={'Origin': ORIGIN}, data={'password': harness.password})
                assert response.status == 200
                health = await (await context.request.get(ORIGIN + '/api/health')).json()
                assert health['capabilities']['messages'] is False
                for path in ['/api/chat/conversations', '/api/integrations/whatsapp/events', f"/api/atendimentos/{records['a']['id']}/messages"]:
                    response = await context.request.get(ORIGIN + path)
                    assert response.status == 404
                response = await context.request.post(ORIGIN + '/api/integrations/whatsapp/events', headers={'Origin': ORIGIN}, data={'synthetic': True})
                assert response.status == 405
                page = await context.new_page()
                await harness.attach(page)
                for key in ['a', 'b', 'a']:
                    await harness.goto_record(page, records[key])
                    await expect(page.get_by_text('Chat WhatsApp ainda indisponível', exact=True)).to_be_visible()
                    await expect(page.get_by_label('Mensagem ao cliente', exact=True)).to_be_disabled()
                    assert 'CHAT_PRIVATE_SYNTHETIC_CONTENT' not in await page.locator('body').inner_text()
                    for tab in ['Diagnósticos', 'Mapa', 'Chat']:
                        await page.get_by_role('button', name=tab, exact=True).click()
                        await expect(page.get_by_role('button', name=tab, exact=True)).to_have_attribute('aria-current', 'page')
                    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                await page.screenshot(path=str(artifacts / f'chat-disabled-{width}.png'))
                harness.mark(f'Chromium {width}px: two Atendimentos, tabs, no content exposure, no HTTP ingestion/send')
                await context.close()
            assert not harness.external
            assert not harness.page_errors
            await browser.close()
            browser = None
        (artifacts / 'results.json').write_text(json.dumps({'results': harness.results, 'externalRequests': 0, 'pageErrors': 0}, ensure_ascii=False, indent=2) + '\n')
    finally:
        if browser:
            await browser.close()
        harness.cleanup()


if __name__ == '__main__':
    asyncio.run(run())
