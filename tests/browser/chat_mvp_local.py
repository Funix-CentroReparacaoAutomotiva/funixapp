"""Real local API/SQLite and synthetic offline Evolution. No production services."""
import asyncio
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN, API

ARTIFACTS = ROOT / "work/chat-mvp-browser"

async def case(browser, width):
    h = Harness()
    context = None
    saved = dict(os.environ)
    try:
        h.check_ports()
        os.environ["CHAT_FIXTURE_METADATA_PATH"] = str(h.folder / "metadata.json")
        os.environ["FUNIX_EVOLUTION_SEND_ENABLED"] = "true"
        api = h.start(["node", "server/tests/fixtures/chat-local-runtime-server.ts"], "local-chat-api")
        await h.ready(API + "/api/ready", api)
        vite = h.start(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], "vite")
        await h.ready(ORIGIN, vite)
        meta = json.loads((h.folder / "metadata.json").read_text())
        context = await browser.new_context(viewport={"width": width, "height": 900})
        await h.watch(context)
        page = await context.new_page()
        await page.clock.install()
        await h.attach(page)
        await page.goto(ORIGIN + f"/atendimentos/{meta['atendimentoId']}?aba=chat&conversa={meta['conversationId']}")
        await h.login(page)
        await expect(page.get_by_text("Mensagem local 125", exact=True)).to_be_visible()
        assert await page.locator(".chat-message").count() == 50
        await page.get_by_role("button", name="Carregar mensagens anteriores", exact=True).click()
        await expect(page.get_by_text("Mensagem local 26", exact=True)).to_be_visible()
        assert await page.locator(".chat-message").count() == 100
        async with page.expect_response(lambda r: "/message-states" in r.url):
            await page.clock.fast_forward(21000)
        await page.get_by_role("button", name="Carregar mensagens anteriores", exact=True).click()
        await expect(page.get_by_text("Mensagem local 1", exact=True)).to_be_visible()
        assert await page.locator(".chat-message").count() == 125
        h.mark(f"{width}px: offline list and 125 local messages; silent refresh preserves older cursor")
        await page.get_by_role("button", name="Atualizar mensagens", exact=True).click()
        await expect(page.get_by_text("As mensagens já recebidas permanecem salvas.", exact=False)).to_be_visible()
        await expect(page.get_by_text("Mensagem local 1", exact=True)).to_be_visible()
        h.mark(f"{width}px: provider refresh failure preserves local messages")

        commands = []
        async def lose_first_ack(route):
            commands.append(route.request.post_data_json)
            response = await route.fetch()
            if len(commands) == 1:
                await route.abort()
            else:
                await route.fulfill(response=response)
        await context.route("**/send-text", lose_first_ack)
        await page.get_by_label("Mensagem de texto para o cliente").fill("Texto sintético com resposta perdida")
        await page.get_by_role("button", name="Enviar mensagem", exact=True).click()
        await expect(page.get_by_text("Envio não confirmado.", exact=False)).to_be_visible()
        await page.get_by_role("button", name="Enviar mensagem", exact=True).click()
        await expect(page.get_by_text("Mensagem aceita pelo WhatsApp.", exact=False)).to_be_visible()
        assert len(commands) == 2 and commands[0] == commands[1]
        replay = await context.request.post(ORIGIN + f"/api/atendimentos/{meta['atendimentoId']}/evolution-conversations/{meta['conversationId']}/send-text", headers={"Origin": ORIGIN}, data=commands[0])
        assert replay.status == 200 and (await replay.json())["messageId"] == "fixture-send-1"
        h.mark(f"{width}px: lost send response retries same operation and returns first receipt")

        async def receive_event(event):
            raw = json.dumps(event, separators=(",", ":"))
            stamp = str(int(time.time()))
            signature = hmac.new(bytes([1])*32, ("v1\nsynthetic\n" + stamp + "\n" + raw).encode(), hashlib.sha256).hexdigest()
            response = await context.request.post(ORIGIN + "/api/integrations/whatsapp/events", data=raw, headers={"Content-Type": "application/json", "x-funix-key-id": "synthetic", "x-funix-timestamp": stamp, "x-funix-signature": "sha256=" + signature})
            assert response.status == 202
        async def advance_until(assertion):
            # A poll already in flight may legitimately finish before the event;
            # let the next scheduled poll observe it instead of freezing at that race.
            for attempt in range(3):
                await page.clock.fast_forward(21000)
                try:
                    await assertion()
                    return
                except AssertionError:
                    if attempt == 2:
                        raise
        mutation = {"schemaVersion": 2, "instance": "funix_comercial", "eventId": "browser:older-edit", "occurredAt": "2026-11-13T00:00:00.000Z", "type": "message.edit", "message": {"remoteJid": "browser-synthetic@lid", "remoteJidAlt": "000000000001@s.whatsapp.net", "messageId": "fixture-1", "timestamp": 1700000001, "fromMe": False, "kind": "text", "text": "Mensagem antiga editada ao vivo", "media": None}}
        await receive_event(mutation)
        await advance_until(lambda: expect(page.get_by_text("Mensagem antiga editada ao vivo", exact=True)).to_be_visible(timeout=1500))
        mutation = {**mutation, "eventId": "browser:older-delete", "occurredAt": "2026-11-13T00:00:01.000Z", "type": "message.delete", "message": {"remoteJid": "browser-synthetic@lid", "remoteJidAlt": "000000000001@s.whatsapp.net", "messageId": "fixture-1"}}
        await receive_event(mutation)
        await advance_until(lambda: expect(page.get_by_text("Mensagem antiga editada ao vivo", exact=True)).to_have_count(0, timeout=1500))
        assert await page.locator(".chat-message").count() == 125
        h.mark(f"{width}px: edit/delete older than newest page updates already-rendered history")

        # A newer signed ERP event changes canonical context while the old Chat remains open.
        body = json.dumps({"version": 1, "source": "coda", "eventId": "browser:changed", "codaRowId": "i-BROWSER_NEXT", "instance": "funix_comercial", "remoteJid": "000000000001@s.whatsapp.net", "phoneE164": None, "displayName": "Outro Atendimento Sintético", "occurredAt": 200}, separators=(",", ":"))
        stamp = str(int(time.time()))
        signature = hmac.new(bytes([1])*32, ("coda-sync-v1\n" + stamp + "\n" + body).encode(), hashlib.sha256).hexdigest()
        response = await context.request.post(ORIGIN + "/api/integrations/coda/atendimentos", data=body, headers={"Content-Type": "application/json", "x-funix-timestamp": stamp, "x-funix-signature": "sha256=" + signature})
        assert response.status == 202
        await advance_until(lambda: expect(page.locator(".chat-message")).to_have_count(0, timeout=1500))
        await expect(page.locator(".chat-composer-row")).to_have_count(0)
        h.mark(f"{width}px: signed ERP context change removes cached history and composer")
        assert not h.external and not h.page_errors, (h.external, h.page_errors)
        await page.screenshot(path=str(ARTIFACTS / f"{width}-local-chat.png"))
    finally:
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        (ARTIFACTS / f"{width}-results.json").write_text(json.dumps({"synthetic": True, "results": h.results, "external": h.external, "pageErrors": h.page_errors}, indent=2))
        if context:
            await context.close()
        h.cleanup()
        os.environ.clear()
        os.environ.update(saved)

async def run():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        executable = os.environ.get("CHROMIUM_EXECUTABLE") or ("/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else None)
        browser = await p.chromium.launch(executable_path=executable, headless=True, args=["--no-sandbox"])
        try:
            for width in [320, 390, 1440]:
                await case(browser, width)
        finally:
            await browser.close()

asyncio.run(run())
