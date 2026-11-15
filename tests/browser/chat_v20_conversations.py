"""Chromium: Conversas is an entry to the canonical Atendimento, not a second Chat.

Only synthetic records and local 127.0.0.1 mocks. Never contacts real Evolution.
"""
import asyncio
import json
import base64
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN

ARTIFACTS = ROOT / "docs/evidencias/issue71-chat-v20-browser"
A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"
C = "33333333-3333-4333-8333-333333333333"
D = "44444444-4444-4444-8444-444444444444"


def messages_payload(conversation):
    return {"source": "evolution", "conversationId": conversation,
            "items": [
                {"messageId": "synthetic-A-1", "timestamp": 1794045600,
                 "fromMe": False, "kind": "text", "text": "Mensagem sintética A"},
                {"messageId": "synthetic-photo-1", "timestamp": 1794045601,
                 "fromMe": False, "kind": "image", "text": None},
                {"messageId": "synthetic-video-1", "timestamp": 1794045602,
                 "fromMe": False, "kind": "video", "text": None},
                {"messageId": "synthetic-audio-1", "timestamp": 1794045603,
                 "fromMe": False, "kind": "audio", "text": None}],
            "page": 1, "nextPage": None, "reportedTotal": 4,
            "consistency": "offset-not-snapshot", "historyComplete": "unknown"}


async def device_case(browser, width, height):
    h = Harness()
    page = None
    context = None
    sent = []
    poll_calls = []
    added_messages = []
    outbound = []
    outbound_media = []
    history_error = None
    photo_bytes = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ub8AAAAASUVORK5CYII=')
    video_bytes = bytes.fromhex('000000186674797069736f6d00000000')
    audio_bytes = b'OggS' + bytes(15)
    try:
        h.check_ports()
        await h.start_api()
        vite = h.start(["node", "node_modules/vite/bin/vite.js", "--host",
                        "127.0.0.1", "--port", "5173", "--strictPort"], "vite")
        await h.ready(ORIGIN, vite)
        context = await browser.new_context(viewport={"width": width, "height": height})
        await h.watch(context)
        page = await context.new_page()
        # Install before React mounts so the recurring interval uses mocked time.
        await page.clock.install()
        await h.attach(page)
        await page.goto(ORIGIN + "/funil")
        await h.login(page)

        created = await context.request.post(ORIGIN + "/api/atendimentos",
                                             headers={"Origin": ORIGIN},
                                             data={"phone": "+5531999990001",
                                                   "name": "Atendimento Sintético"})
        assert created.status == 201
        atendimento_id = (await created.json())["id"]

        async def mock(route):
            parsed = urlparse(route.request.url)
            sent.append(parsed.path)
            if parsed.path == f"/api/atendimentos/{atendimento_id}/evolution-conversations/{A}/send-text":
                assert route.request.method == "POST"
                data = route.request.post_data_json
                assert set(data.keys()) == {"text"}
                outbound.append(data["text"])
                return await route.fulfill(status=200, json={"state": "accepted", "messageId": "SYNTHETIC-SEND-1"})
            if parsed.path == f"/api/atendimentos/{atendimento_id}/evolution-conversations/{A}/send-media":
                assert route.request.method == "POST"
                body = route.request.post_data_json
                assert set(body.keys()) <= {"kind", "mimeType", "base64", "caption"}
                outbound_media.append(body["kind"])
                return await route.fulfill(status=200, json={"state": "accepted", "messageId": "SYNTHETIC-MEDIA-SEND"})
            if parsed.path.startswith(f"/api/atendimentos/{atendimento_id}/evolution-conversations/{A}/messages/") and parsed.path.endswith("/media"):
                assert route.request.method == "GET"
                kind = {"synthetic-photo-1": ("image", "image/png", photo_bytes),
                        "synthetic-video-1": ("video", "video/mp4", video_bytes),
                        "synthetic-audio-1": ("audio", "audio/ogg", audio_bytes)}[parsed.path.split("/")[-2]]
                return await route.fulfill(status=200, json={"kind": kind[0], "mimeType": kind[1],
                    "base64": base64.b64encode(kind[2]).decode()})
            assert route.request.method == "GET"
            if parsed.path == "/api/chat/conversations":
                if parsed.query == "skip=3":
                    return await route.fulfill(status=200, json={"source": "evolution",
                        "items": [{"conversationId": D, "displayName": "Contato Página Dois",
                                   "phoneNumber": "5531966660004", "updatedAt": None,
                                   "unreadCount": 0, "atendimentoId": None}],
                        "nextSkip": None, "linksEnabled": False})
                assert parsed.query == "skip=0", parsed.query
                return await route.fulfill(status=200, json={"source": "evolution",
                    "items": [
                        {"conversationId": A, "displayName": "Contato Vinculado",
                         "phoneNumber": "5531999990001", "updatedAt": None,
                         "unreadCount": 0, "atendimentoId": atendimento_id},
                        {"conversationId": B, "displayName": "Contato Sem Vínculo",
                         "phoneNumber": "5531999990002", "updatedAt": None,
                         "unreadCount": 0, "atendimentoId": None},
                        {"conversationId": C, "displayName": "Atendimento Sintético",
                         "phoneNumber": None, "updatedAt": None,
                         "unreadCount": 0, "atendimentoId": None}],
                    "nextSkip": 3, "linksEnabled": False})
            if parsed.path == f"/api/atendimentos/{atendimento_id}/evolution-conversations/{A}/messages":
                poll_calls.append(parsed.query)
                if history_error:
                    return await route.fulfill(status=history_error[0], json={"error": {
                        "code": history_error[1], "message": "Resposta incompatível da Evolution.", "requestId": "synthetic-reference"}})
                payload = messages_payload(A)
                payload["items"].extend(added_messages)
                payload["reportedTotal"] = len(payload["items"])
                return await route.fulfill(status=200, json={**payload, "sendTextAvailable": True,
                    "mediaSendAvailable": True, "mediaReadAvailable": True})
            if parsed.path == f"/api/chat/conversations/{B}/active-atendimento":
                return await route.fulfill(status=200, json={"atendimentoId": None})
            if parsed.path == f"/api/chat/conversations/{C}/active-atendimento":
                return await route.fulfill(status=200, json={"atendimentoId": None})
            if parsed.path == f"/api/atendimentos/{atendimento_id}/evolution-conversation":
                return await route.fulfill(status=200, json={"conversationId": A})
            if parsed.path.startswith("/api/atendimentos/") and parsed.path.endswith("/evolution-conversation"):
                # An existing Funil record can be opened without a Coda/Evolution
                # association; its Chat must report that fact, not guess a JID.
                return await route.fulfill(status=404, json={"error": {
                    "code": "CHAT_NOT_LINKED", "message": "Sem vínculo canônico"}})
            raise AssertionError(f"Unexpected API request: {parsed.path}")

        await context.route("**/api/chat/conversations/*/active-atendimento", mock)
        await context.route("**/api/chat/conversations?*", mock)
        await context.route("**/api/atendimentos/*/evolution-conversation", mock)
        await context.route("**/api/atendimentos/*/evolution-conversations/*/messages*", mock)
        await context.route("**/api/atendimentos/*/evolution-conversations/*/messages/*/media*", mock)
        await context.route("**/api/atendimentos/*/evolution-conversations/*/send-text", mock)
        await context.route("**/api/atendimentos/*/evolution-conversations/*/send-media", mock)
        # List/name/N:N UX is covered against real local SQLite by customer-experience-browser.mjs.
        # This suite retains media, polling, send and authorization regressions in the existing Chat.
        await page.goto(ORIGIN + f"/atendimentos/{atendimento_id}?aba=chat&conversa={A}")
        await expect(page.get_by_role("region", name="Histórico Evolution deste Atendimento")).to_be_visible()
        # Capture the exact client state in CI when a provider fixture diverges.
        try:
            await expect(page.get_by_text("Mensagem sintética A", exact=True)).to_be_visible()
        except AssertionError:
            print("CHAT_DIAGNOSTIC", json.dumps({
                "history": (await page.locator(".chat-history").inner_text())[:1200],
                "paths": sent, "pageErrors": h.page_errors,
            }, ensure_ascii=False))
            raise
        assert await page.get_by_text("Chat · Evolution").count() == 0
        assert await page.get_by_text("Evolution · leitura somente, histórico possivelmente incompleto").count() == 0
        assert await page.get_by_text("Envio indisponível · somente leitura").count() == 0
        assert await page.locator(".chat-rail, .chat-page .record-summary, .chat-page .compose").count() == 0
        await expect(page.get_by_role("button", name="Atualizar mensagens")).to_be_visible()
        # The healthy 20s polling is quiet in the WhatsApp-like UI; behavior is checked below.
        assert await page.get_by_text("Atualização automática ativa").count() == 0
        assert await page.locator(".chat-evolution .chat-direction").count() == 0
        await expect(page.locator(".chat-evolution .chat-composer-row")).to_be_visible()
        # A compact composer retains reliable targets for touch and assistive tech.
        for action in [".chat-send-action", ".chat-file-chooser"]:
            box = await page.locator(".chat-evolution " + action).bounding_box()
            assert box and box["height"] >= 44 and box["width"] >= 44, (width, action, box)
        # Poll with a real browser clock; no artificial network or Evolution calls.
        # Preserve a draft through silent refresh, and do not duplicate existing rows.
        await page.get_by_label("Mensagem de texto para o cliente").fill("Rascunho preservado")
        initial_reads = len(poll_calls)
        added_messages.append({"messageId": "synthetic-new-1", "timestamp": 1794045604,
            "fromMe": False, "kind": "text", "text": "Mensagem nova automática"})
        await page.clock.fast_forward(20_000)
        await expect(page.get_by_text("Mensagem nova automática", exact=True)).to_be_visible()
        assert len(poll_calls) >= initial_reads + 1, poll_calls
        assert await page.get_by_text("Mensagem nova automática", exact=True).count() == 1
        assert await page.get_by_label("Mensagem de texto para o cliente").input_value() == "Rascunho preservado"
        h.mark(f"{width}px: new message appears without click and typed reply is preserved")
        # A hidden tab cannot continue polling, and resumes after visibility.
        await page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'})")
        await page.clock.fast_forward(40_000)
        hidden_reads = len(poll_calls)
        assert hidden_reads >= initial_reads + 1
        await page.clock.fast_forward(20_000)
        assert len(poll_calls) == hidden_reads, (hidden_reads, poll_calls)
        await page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}); document.dispatchEvent(new Event('visibilitychange'))")
        await page.clock.fast_forward(1_000)
        await page.get_by_label("Mensagem de texto para o cliente").fill("Resposta sintética, sem Evolution real")
        await page.get_by_role("button", name="Enviar mensagem").click()
        await expect(page.get_by_text("Mensagem aceita pelo WhatsApp.", exact=False)).to_be_visible()
        assert outbound == ["Resposta sintética, sem Evolution real"]
        assert await page.get_by_label("Mensagem de texto para o cliente").input_value() == ""
        await page.get_by_role("button", name="Abrir foto").click()
        await expect(page.get_by_role("button", name="Ampliar foto")).to_be_visible()
        await page.get_by_role("button", name="Ampliar foto").click()
        await expect(page.get_by_role("dialog", name="Foto ampliada")).to_be_visible()
        await page.get_by_role("button", name="Fechar foto").click()
        await page.get_by_role("button", name="Reproduzir vídeo").click()
        await expect(page.get_by_label("Vídeo do WhatsApp")).to_be_visible()
        await page.get_by_role("button", name="Ouvir áudio").click()
        await expect(page.get_by_label("Áudio do WhatsApp")).to_be_visible()
        h.mark(f"{width}px: received photo/video/audio open inside Atendimento")

        picker = page.get_by_label("Escolher foto, vídeo ou áudio")
        for name, mime, content_bytes, kind in [
            ("teste.png", "image/png", photo_bytes, "image"),
            ("teste.mp4", "video/mp4", video_bytes, "video"),
            ("teste.ogg", "audio/ogg", audio_bytes, "audio"),
        ]:
            await picker.set_input_files({"name": name, "mimeType": mime, "buffer": content_bytes})
            await page.get_by_role("button", name="Enviar mídia").click()
            await expect(page.get_by_text("Arquivo aceito pela Evolution.", exact=False)).to_be_visible()
        assert outbound_media == ["image", "video", "audio"], outbound_media
        h.mark(f"{width}px: sends one image/video/audio each with synthetic provider")
        await page.screenshot(path=str(ARTIFACTS / f"{width}-atendimento-chat.png"))
        # Fresh canonical resolver is expected for the unlinked card; no nested
        # provider-history route should be queried without an active link.
        assert not any(path.endswith("/messages") and
                       path.startswith("/api/chat/conversations/") for path in sent)
        assert not h.external and not h.page_errors, (h.external, h.page_errors)
        h.mark(f"{width}px: click routes directly to canonical Atendimento; no nested reader, inactive controls or duplicated card")

        # Provider response errors are distinct from empty history and permit a manual retry.
        history_error = (503, "CHAT_PROVIDER_RESPONSE")
        await page.get_by_role("button", name="Atualizar mensagens").click()
        await expect(page.get_by_text("Referência: synthetic-reference", exact=False)).to_be_visible()
        await expect(page.locator(".chat-composer-row")).to_have_count(0)
        history_error = None
        await page.get_by_role("button", name="Atualizar mensagens").click()
        await expect(page.get_by_text("Mensagem sintética A", exact=True)).to_be_visible()
        await expect(page.locator(".chat-composer-row")).to_be_visible()
        # Losing the active canonical context on a silent poll revokes displayed data and send rights.
        history_error = (404, "CHAT_NOT_LINKED")
        await page.clock.fast_forward(20_000)
        await expect(page.get_by_text("O vínculo entre conversa e Atendimento não foi confirmado.", exact=False)).to_be_visible()
        await expect(page.get_by_text("Mensagem sintética A", exact=True)).to_have_count(0)
        await expect(page.locator(".chat-composer-row")).to_have_count(0)
        history_error = None
        h.mark(f"{width}px: provider error reference/retry and silent context revocation clear history/composer")

        # Number-based navigation was removed by the autonomous commercial contract.
        # Unknown/ambiguous contacts are exercised by the integrated local browser suite.


    except Exception:
        if page:
            await page.screenshot(path=str(ARTIFACTS / f"{width}-failure.png"))
        raise
    finally:
        if context:
            await context.close()
        h.cleanup()
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        (ARTIFACTS / f"{width}-results.json").write_text(json.dumps(
            {"synthetic": True, "realEvolution": False, "width": width,
             "results": h.results, "pageErrors": h.page_errors, "external": h.external},
            ensure_ascii=False, indent=2) + "\n")


async def run():
    os.environ["FUNIX_EVOLUTION_READ_ENABLED"] = "false"
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        chrome = os.environ.get("CHROME_PATH") or (
            "/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else None)
        browser = await playwright.chromium.launch(executable_path=chrome, headless=True,
                                                   args=["--no-sandbox"])
        try:
            for width, height in [(320, 780), (390, 844), (1440, 900)]:
                await device_case(browser, width, height)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(run())
