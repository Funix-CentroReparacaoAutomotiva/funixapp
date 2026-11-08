"""Synthetic Chromium QA for the V20 reader. Evolution stays disabled.

Own loopback API/Vite and temporary SQLite; browser mocks just the two GET
endpoints. Never touches the VPS, n8n, WhatsApp or any production data.
"""
import asyncio
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN

ARTIFACTS = ROOT / "docs/evidencias/issue71-chat-v20-browser"
A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"
C = "33333333-3333-4333-8333-333333333333"
LIST = "/api/chat/conversations"
ROWS = [
    {"conversationId": A, "displayName": "João Sintético", "phoneNumber": "5531999990001",
     "updatedAt": "2026-11-07T12:00:00.000Z", "unreadCount": 1},
    {"conversationId": B, "displayName": None, "phoneNumber": "5531999990002",
     "updatedAt": "2026-11-07T11:00:00.000Z", "unreadCount": 0},
    {"conversationId": C, "displayName": None, "phoneNumber": None,
     "updatedAt": None, "unreadCount": None},
]


def message(n):
    return {"messageId": f"synthetic-A-{n}", "timestamp": 1794045600 + n,
            "fromMe": n % 2 == 0, "kind": "text", "text": f"Texto sintético A {n}"}


def messages_payload(conversation, page):
    if conversation == A:
        items = [message(n) for n in range(1, 51)] if page == 1 else [
            message(1), {"messageId": "synthetic-image", "timestamp": 1794045600,
                          "fromMe": False, "kind": "image", "text": None}]
        next_page = 2 if page == 1 else None
    elif conversation == B:
        items = [{"messageId": "synthetic-B-1", "timestamp": 1794045600,
                  "fromMe": False, "kind": "text", "text": "Mensagem sintética B"}]
        next_page = None
    else:
        items, next_page = [], None
    return {"source": "evolution", "conversationId": conversation, "items": items,
            "page": page, "nextPage": next_page, "reportedTotal": 51 if conversation == A else len(items),
            "consistency": "offset-not-snapshot", "historyComplete": "unknown"}


async def device_case(browser, width, height):
    h = Harness()
    page = None
    context = None
    state = {"fail_b": True, "fail_list": False, "expire_c": True, "hold_a": width == 390}
    release_a = asyncio.Event()
    seen = []
    try:
        h.check_ports()
        await h.start_api()
        vite = h.start(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], "vite")
        await h.ready(ORIGIN, vite)
        context = await browser.new_context(viewport={"width": width, "height": height})
        await h.watch(context)
        page = await context.new_page()
        await h.attach(page)
        await page.goto(ORIGIN + "/conversas")
        await h.login(page)
        await expect(page.get_by_text("Chat WhatsApp ainda indisponível", exact=True)).to_be_visible()
        assert (await context.request.get(ORIGIN + LIST)).status == 404
        h.mark(f"{width}px: feature disabled by default, no provider access")

        async def mock(route):
            parsed = urlparse(route.request.url)
            path = parsed.path
            seen.append((route.request.method, path, parsed.query))
            headers = {"Cache-Control": "no-store", "Content-Type": "application/json"}
            assert route.request.method == "GET"
            if path == LIST:
                if state["fail_list"]:
                    return await route.fulfill(status=503, headers=headers,
                                               json={"error": {"code": "CHAT_PROVIDER_UNAVAILABLE"}})
                assert parse_qs(parsed.query).get("skip", ["0"]) == ["0"]
                return await route.fulfill(status=200, headers=headers,
                                           json={"source": "evolution", "items": ROWS, "nextSkip": None,
                                                 "hiddenField": "NEVER SHOW"})
            matched = re.fullmatch(r"/api/chat/conversations/([0-9a-f-]{36})/messages", path)
            assert matched is not None, path
            conversation = matched.group(1)
            assert conversation in [A, B, C]
            p = int(parse_qs(parsed.query).get("page", ["1"])[0])
            if conversation == A and p == 1 and state["hold_a"]:
                await release_a.wait()
            if conversation == B and state["fail_b"]:
                return await route.fulfill(status=503, headers=headers,
                                           json={"error": {"code": "CHAT_PROVIDER_UNAVAILABLE"}})
            if conversation == C and state["expire_c"]:
                return await route.fulfill(status=404, headers=headers,
                                           json={"error": {"code": "CHAT_NOT_FOUND"}})
            try:
                return await route.fulfill(status=200, headers=headers, json=messages_payload(conversation, p))
            except Exception:
                if conversation != A:
                    raise

        await context.route("**/api/chat/conversations**", mock)
        await page.goto(ORIGIN + "/funil")
        await page.goto(ORIGIN + "/conversas")
        await expect(page.get_by_text("João Sintético", exact=True)).to_be_visible()
        await expect(page.get_by_text("+5531999990002", exact=True)).to_be_visible()
        await expect(page.get_by_text("Contato não identificado", exact=True)).to_be_visible()
        assert await page.get_by_text("Conversa 1", exact=True).count() == 0
        assert "NEVER SHOW" not in await page.locator(".ev-reader").inner_text()
        assert await page.evaluate("width => document.documentElement.scrollWidth <= width + 1", width)
        await page.screenshot(path=str(ARTIFACTS / f"{width}-lista.png"))
        h.mark(f"{width}px: display name, phone, LID fallback, sanitized UI")

        first = page.locator(".ev-item").filter(has_text="João Sintético")
        second = page.locator(".ev-item").filter(has_text="+5531999990002")
        third = page.locator(".ev-item").filter(has_text="Contato não identificado")
        if state["hold_a"]:
            await first.click()
            await expect(page.get_by_text("Carregando mensagens…", exact=True)).to_be_visible()
            await second.click()
            await expect(page.get_by_text("A Evolution está indisponível ou não respondeu.", exact=False)).to_be_visible()
            state["hold_a"] = False
            release_a.set()
            await page.wait_for_timeout(120)
            assert "Texto sintético A" not in await page.locator(".ev-reader").inner_text()
            h.mark("390px: late request from conversation A cannot overwrite B")
        else:
            await second.click()
            await expect(page.get_by_text("A Evolution está indisponível ou não respondeu.", exact=False)).to_be_visible()
        state["fail_b"] = False
        await page.get_by_role("button", name="Atualizar mensagens").click()
        await expect(page.get_by_text("Mensagem sintética B", exact=True)).to_be_visible()
        assert "Texto sintético A" not in await page.locator(".ev-reader").inner_text()
        h.mark(f"{width}px: provider 503 is not empty history; manual recovery works")

        await third.click()
        await expect(page.get_by_text("Esta conversa temporária expirou.", exact=False)).to_be_visible()
        state["expire_c"] = False
        await page.get_by_role("button", name="Atualizar mensagens").click()
        await expect(page.get_by_text("Nenhuma mensagem retornada", exact=True)).to_be_visible()
        h.mark(f"{width}px: expired conversation differs from empty history")

        await first.click()
        await expect(page.get_by_role("navigation", name="Visões da conversa")).to_be_visible()
        await expect(page.get_by_role("button", name="Chat", exact=True)).to_have_attribute("aria-current", "page")
        await expect(page.get_by_role("button", name="Diagnósticos", exact=True)).to_be_disabled()
        await expect(page.get_by_role("button", name="Mapa", exact=True)).to_be_disabled()
        if width <= 760:
            assert await page.locator(".ev-conversations-pane").evaluate("(e) => getComputedStyle(e).display") == "none"
            assert await page.locator(".ev-conversation-detail").evaluate("(e) => getComputedStyle(e).display") != "none"
        else:
            assert await page.locator(".ev-conversations-pane").evaluate("(e) => getComputedStyle(e).display") != "none"
            assert await page.locator(".ev-conversation-detail").evaluate("(e) => getComputedStyle(e).display") != "none"
        await expect(page.locator(".ev-messages li")).to_have_count(50)
        assert await page.evaluate("width => document.documentElement.scrollWidth <= width + 1", width)
        await page.screenshot(path=str(ARTIFACTS / f"{width}-historico.png"))
        await page.get_by_role("button", name="Carregar página anterior").click()
        await expect(page.locator(".ev-messages li")).to_have_count(51)
        await expect(page.get_by_text("Imagem · conteúdo indisponível", exact=True)).to_be_visible()
        assert await page.locator(".ev-messages img, .ev-messages video, .ev-messages audio").count() == 0
        h.mark(f"{width}px: previous page merges without duplicate, media unavailable")

        if width <= 760:
            await page.get_by_role("button", name="Voltar às conversas").click()
            await expect(page.get_by_text("João Sintético", exact=True)).to_be_visible()
            assert await page.locator(".ev-conversation-detail").evaluate("(e) => getComputedStyle(e).display") == "none"
            h.mark(f"{width}px: opened Chat without scrolling and returned to conversation list")
        else:
            h.mark("1440px: selected conversation visible beside the list")
        state["fail_list"] = True
        await page.get_by_role("button", name="Atualizar lista").click()
        await expect(page.get_by_text("Falha na lista", exact=True)).to_be_visible()
        state["fail_list"] = False
        await page.get_by_role("button", name="Atualizar lista").click()
        await expect(page.get_by_text("João Sintético", exact=True)).to_be_visible()
        assert await page.locator(".ev-history").count() == 0
        assert all(method == "GET" for method, _, _ in seen)
        assert all("remoteJid" not in query and "@lid" not in path for _, path, query in seen)
        assert not h.external and not h.page_errors, (h.external, h.page_errors)
        h.mark(f"{width}px: 503 list recovery, no writes, no external calls, no JS exceptions")
    except Exception:
        if page:
            await page.screenshot(path=str(ARTIFACTS / f"{width}-failure.png"))
        raise
    finally:
        release_a.set()
        if context:
            await context.close()
        h.cleanup()
        (ARTIFACTS / f"{width}-results.json").write_text(json.dumps(
            {"synthetic": True, "realEvolution": False, "width": width,
             "results": h.results, "pageErrors": h.page_errors, "external": h.external},
            ensure_ascii=False, indent=2) + "\n")


async def run():
    os.environ["FUNIX_EVOLUTION_READ_ENABLED"] = "false"
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        chrome = os.environ.get("CHROME_PATH") or ("/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else None)
        browser = await playwright.chromium.launch(executable_path=chrome, headless=True, args=["--no-sandbox"])
        try:
            for width, height in [(320, 740), (390, 844), (1440, 900)]:
                await device_case(browser, width, height)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(run())
