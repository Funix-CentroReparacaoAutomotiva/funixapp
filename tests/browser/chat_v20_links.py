"""Synthetic Chromium QA of manual V20 conversation <-> Atendimento links.

Runs only owned 127.0.0.1 services and synthetic route mocks.
No production Evolution, n8n, WhatsApp, credentials, or real customer data.
"""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN

ARTIFACTS = ROOT / "docs/evidencias/issue98-chat-v20-links-browser"
A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"
AT1 = "aaaa1111-1111-4111-8111-111111111111"
AT2 = "aaaa2222-2222-4222-8222-222222222222"
L1 = "bbbb1111-1111-4111-8111-111111111111"
L2 = "bbbb2222-2222-4222-8222-222222222222"
RECORDS = [
    {"id": AT1, "name": "Oficina Exemplo A", "vehicle": "Hatch fictício", "plate": "SYN1A23"},
    {"id": AT2, "name": "Oficina Exemplo B", "vehicle": "Sedã fictício", "plate": "SYN2B34"},
]


def response(status, data):
    return {"status": status, "headers": {"Cache-Control": "no-store", "Content-Type": "application/json"}, "json": data}


async def device_case(browser, width, height):
    h = Harness()
    ctx = None
    page = None
    state = {
        "revision": 0, "links": [], "active": None, "enabled": True,
        "fail_next_link": False, "fail_search": False, "writes": [], "requests": [],
    }
    try:
        h.check_ports()
        await h.start_api()
        vite = h.start(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], "vite")
        await h.ready(ORIGIN, vite)
        ctx = await browser.new_context(viewport={"width": width, "height": height})
        await h.watch(ctx)
        page = await ctx.new_page()
        await h.attach(page)
        await page.goto(ORIGIN + "/conversas")
        await h.login(page)
        await expect(page.get_by_text("Chat WhatsApp ainda indisponível", exact=True)).to_be_visible()

        async def mock(route):
            request = route.request
            parsed = urlparse(request.url)
            path, method = parsed.path, request.method
            state["requests"].append([method, path])
            if path == "/api/chat/conversations" and method == "GET":
                return await route.fulfill(**response(200, {
                    "source": "evolution", "nextSkip": None,
                    "linksEnabled": state["enabled"],
                    "items": [
                        {"conversationId": A, "displayName": "Contato Sintético Alfa",
                         "phoneNumber": "5531999990001", "updatedAt": None, "unreadCount": 0},
                        {"conversationId": B, "displayName": "Contato Sintético Beta",
                         "phoneNumber": "5531999990002", "updatedAt": None, "unreadCount": 0},
                    ],
                }))
            if path == "/api/atendimentos" and method == "GET":
                if state["fail_search"]:
                    return await route.fulfill(**response(503, {"error": {"code": "SYNTHETIC_TEMPORARY_ERROR"}}))
                assert parse_qs(parsed.query).get("limit") == ["20"]
                return await route.fulfill(**response(200, {
                    "items": RECORDS, "total": 2, "nextOffset": None, "stages": [],
                }))
            if path in [f"/api/chat/conversations/{A}/messages", f"/api/chat/conversations/{B}/messages"]:
                assert method == "GET"
                body = ("Mensagem sintética A preservada" if A in path else "Mensagem sintética B separada")
                return await route.fulfill(**response(200, {
                    "source": "evolution", "conversationId": A if A in path else B,
                    "items": [{"messageId": "synthetic-msg", "timestamp": 1794045600,
                               "fromMe": False, "kind": "text", "text": body}],
                    "page": 1, "nextPage": None, "reportedTotal": 1,
                    "consistency": "offset-not-snapshot", "historyComplete": "unknown",
                }))
            if path == f"/api/chat/conversations/{B}/atendimentos" and method == "GET":
                return await route.fulfill(**response(200, {"revision": 0, "items": [], "activeAtendimentoId": None}))
            if path == f"/api/chat/conversations/{A}/atendimentos" and method == "GET":
                return await route.fulfill(**response(200, {
                    "revision": state["revision"], "items": list(state["links"]),
                    "activeAtendimentoId": state["active"],
                }))
            if path == f"/api/chat/conversations/{A}/atendimentos" and method == "POST":
                body = json.loads(request.post_data or "{}")
                state["writes"].append(["link", body])
                assert "remoteJid" not in body and "instance" not in body
                assert len(body["reason"].strip()) > 0 and len(body["requestId"]) == 36
                if state["fail_next_link"]:
                    state["fail_next_link"] = False
                    return await route.fulfill(**response(409, {"error": {"code": "V20_ASSOCIATION_CONFLICT"}}))
                assert body["expectedRevision"] == state["revision"]
                lookup = {AT1: (L1, RECORDS[0]), AT2: (L2, RECORDS[1])}
                lid, item = lookup[body["atendimentoId"]]
                assert not any(x["linkId"] == lid for x in state["links"])
                state["links"].append({
                    "linkId": lid, "atendimentoId": item["id"], "linkedAt": "2026-11-08T12:00:00.000Z",
                    "name": item["name"], "vehicle": item["vehicle"], "plate": item["plate"],
                })
                state["revision"] += 1
                return await route.fulfill(**response(201, {"linkId": lid, "revision": state["revision"]}))
            if path == f"/api/chat/conversations/{A}/context" and method == "POST":
                body = json.loads(request.post_data or "{}")
                state["writes"].append(["context", body])
                lid = body["linkId"]
                assert lid is None or any(x["linkId"] == lid for x in state["links"])
                state["active"] = next((x["atendimentoId"] for x in state["links"] if x["linkId"] == lid), None)
                return await route.fulfill(**response(200, {"activeAtendimentoId": state["active"]}))
            if path in [f"/api/chat/conversations/{A}/atendimentos/{L1}",
                        f"/api/chat/conversations/{A}/atendimentos/{L2}"] and method == "DELETE":
                body = json.loads(request.post_data or "{}")
                state["writes"].append(["unlink", body])
                assert body["expectedRevision"] == state["revision"] and body["reason"].strip()
                target = path.rsplit("/", 1)[-1]
                removed = next(x for x in state["links"] if x["linkId"] == target)
                state["links"] = [x for x in state["links"] if x["linkId"] != target]
                if state["active"] == removed["atendimentoId"]:
                    state["active"] = None
                state["revision"] += 1
                return await route.fulfill(**response(200, {"linkId": target, "revision": state["revision"]}))
            raise AssertionError(f"Unexpected API call {method} {path}")

        await ctx.route("**/api/chat/conversations**", mock)
        await ctx.route("**/api/atendimentos?*", mock)
        await page.goto(ORIGIN + "/conversas")
        await page.get_by_role("button", name="Contato Sintético Alfa").click()
        panel = page.get_by_role("region", name="Vínculos com Atendimentos")
        await expect(panel).to_be_visible()
        await expect(panel.get_by_text("Nenhum Atendimento vinculado.")).to_be_visible()
        await expect(page.get_by_text("Mensagem sintética A preservada")).to_be_visible()
        await page.screenshot(path=str(ARTIFACTS / f"{width}-vazio.png"))
        h.mark(f"{width}px: opted-in UI, empty links, independent history")

        await panel.get_by_role("searchbox", name="Localizar Atendimento existente").fill("Caso")
        await panel.get_by_role("button", name="Buscar").click()
        await expect(panel.get_by_text("Oficina Exemplo A", exact=False)).to_be_visible()
        await expect(panel.get_by_text("Oficina Exemplo B", exact=False)).to_be_visible()
        assert not await panel.get_by_role("button", name="Vincular", exact=True).first.is_enabled()
        await panel.get_by_role("textbox", name="Motivo para vincular ou desvincular").fill("Associação manual de teste")
        await panel.get_by_role("button", name="Vincular", exact=True).first.click()
        await expect(panel.get_by_role("button", name="Usar contexto")).to_have_count(1)
        assert state["revision"] == 1
        await expect(page.get_by_text("Mensagem sintética A preservada")).to_be_visible()
        h.mark(f"{width}px: search, reason required, manual link, timeline unchanged")

        await panel.get_by_role("searchbox", name="Localizar Atendimento existente").fill("Caso")
        await panel.get_by_role("button", name="Buscar").click()
        await panel.get_by_role("textbox", name="Motivo para vincular ou desvincular").fill("Segundo Atendimento")
        state["fail_next_link"] = True
        await panel.get_by_role("button", name="Vincular", exact=True).click()
        await expect(panel.get_by_role("alert")).to_contain_text("Vínculo alterado")
        assert state["revision"] == 1 and len(state["links"]) == 1
        await panel.get_by_role("button", name="Vincular", exact=True).click()
        await expect(panel.get_by_role("button", name="Usar contexto")).to_have_count(2)
        assert state["revision"] == 2
        h.mark(f"{width}px: 409 conflict displays warning and safe retry, N:N links")

        await panel.get_by_role("button", name="Usar contexto").first.click()
        await expect(panel.get_by_role("button", name="Contexto ativo ✓")).to_have_count(1)
        assert state["active"] == AT1
        await panel.get_by_role("button", name="Usar contexto").click()
        assert state["active"] == AT2
        await expect(page.get_by_text("Mensagem sintética A preservada")).to_be_visible()
        await page.screenshot(path=str(ARTIFACTS / f"{width}-dois-vinculos.png"))
        h.mark(f"{width}px: switch active Atendimento without changing WhatsApp messages")

        await panel.get_by_role("button", name="Desvincular").last.click()
        await expect(panel.get_by_role("button", name="Confirmar desvínculo")).to_be_visible()
        await panel.get_by_role("button", name="Cancelar").click()
        assert len(state["links"]) == 2
        await panel.get_by_role("textbox", name="Motivo para vincular ou desvincular").fill("Fim do vínculo")
        await panel.get_by_role("button", name="Desvincular").last.click()
        await panel.get_by_role("button", name="Confirmar desvínculo").click()
        await expect(panel.get_by_role("button", name="Usar contexto")).to_have_count(1)
        assert state["active"] is None and len(state["links"]) == 1
        await expect(page.get_by_text("Mensagem sintética A preservada")).to_be_visible()
        h.mark(f"{width}px: cancel/confirm unlink, context reset, message preserved")

        await page.get_by_role("button", name="Voltar às conversas").click()
        await page.get_by_role("button", name="Contato Sintético Beta").click()
        await expect(panel.get_by_text("Nenhum Atendimento vinculado.")).to_be_visible()
        await expect(page.get_by_text("Mensagem sintética B separada")).to_be_visible()
        assert await page.get_by_text("Mensagem sintética A preservada").count() == 0
        h.mark(f"{width}px: conversation switch isolates links and history")

        assert await page.evaluate("w => document.documentElement.scrollWidth <= w + 1", width)
        assert not h.external and not h.page_errors, (h.external, h.page_errors)
        assert all("@" not in p for _, p in state["requests"])
        assert all(kind in ["link", "unlink", "context"] for kind, _ in state["writes"])
        h.mark(f"{width}px: no horizontal overflow, no external network, no JS exceptions")

        state["enabled"] = False
        await page.get_by_role("button", name="Voltar às conversas").click()
        await page.get_by_role("button", name="Atualizar lista").click()
        await page.get_by_role("button", name="Contato Sintético Alfa").click()
        await expect(page.get_by_text("Mensagem sintética A preservada")).to_be_visible()
        assert await page.get_by_role("region", name="Vínculos com Atendimentos").count() == 0
        h.mark(f"{width}px: link feature OFF keeps Evolution reading and hides writes")
    except Exception:
        if page:
            await page.screenshot(path=str(ARTIFACTS / f"{width}-failure.png"))
        raise
    finally:
        if ctx:
            await ctx.close()
        h.cleanup()
        (ARTIFACTS / f"{width}-results.json").write_text(json.dumps({
            "synthetic": True, "productionAccess": False, "width": width,
            "results": h.results, "external": h.external, "pageErrors": h.page_errors,
        }, ensure_ascii=False, indent=2) + "\n")


async def run():
    os.environ["FUNIX_EVOLUTION_READ_ENABLED"] = "false"
    os.environ["FUNIX_CHAT_V20_LINKS_ENABLED"] = "false"
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
