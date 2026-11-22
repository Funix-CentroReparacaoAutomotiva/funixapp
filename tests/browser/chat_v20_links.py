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
C = "33333333-3333-4333-8333-333333333333"
AT1 = "aaaa1111-1111-4111-8111-111111111111"
AT2 = "aaaa2222-2222-4222-8222-222222222222"
L1 = "bbbb1111-1111-4111-8111-111111111111"
L2 = "bbbb2222-2222-4222-8222-222222222222"
L3 = "bbbb3333-3333-4333-8333-333333333333"
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
        "triage": None, "review_atendimento": None, "number_linked": False, "linked_review": False,
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
        await expect(page.get_by_text("Canal ainda não habilitado", exact=True)).to_be_visible()

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
                        {"conversationId": C, "displayName": "Contato Sintético Gama",
                         "phoneNumber": "553199990003", "updatedAt": None, "unreadCount": 0},
                    ],
                }))
            if path in [f"/api/chat/conversations/{A}/active-atendimento",
                        f"/api/chat/conversations/{B}/active-atendimento"] and method == "GET":
                return await route.fulfill(**response(200, {"atendimentoId": None}))
            if path == "/api/atendimentos" and method == "GET":
                if state["fail_search"]:
                    return await route.fulfill(**response(503, {"error": {"code": "SYNTHETIC_TEMPORARY_ERROR"}}))
                parameters = parse_qs(parsed.query)
                if parameters.get("limit") == ["100"]:
                    # Navigation fallback looks for real existing records by phone;
                    # these synthetic manual-link records have no matching PN.
                    return await route.fulfill(**response(200, {
                        "items": [], "total": 0, "nextOffset": None, "stages": [],
                    }))
                assert parameters.get("limit") == ["20"]
                if parameters.get("q") == ["Ficha para revisão"]:
                    items = [{"id": state["review_atendimento"], "name": "Ficha para revisão", "vehicle": "", "plate": ""}]
                    return await route.fulfill(**response(200, {"items": items, "total": 1}))
                return await route.fulfill(**response(200, {
                    "items": RECORDS, "total": 2, "nextOffset": None, "stages": [],
                }))
            linked_history = state["triage"] and path == f"/api/atendimentos/{state['triage']}/evolution-conversations/{B}/messages"
            if linked_history or path in [f"/api/chat/conversations/{A}/messages", f"/api/chat/conversations/{B}/messages"]:
                assert method == "GET"
                if linked_history:
                    assert parse_qs(parsed.query)["scope"] == ["linked"]
                body = ("Mensagem sintética A preservada" if A in path else "Mensagem sintética B separada")
                return await route.fulfill(**response(200, {
                    "source": "evolution", "conversationId": A if A in path else B,
                    "items": [{"messageId": "synthetic-msg", "timestamp": 1794045600,
                               "fromMe": False, "kind": "text", "text": body}],
                    "page": 1, "nextPage": None, "reportedTotal": 1,
                    "consistency": "offset-not-snapshot", "historyComplete": "unknown",
                }))
            if path == f"/api/chat/conversations/{B}/atendimentos" and method == "GET":
                linked = [{"linkId": L3, "atendimentoId": state["triage"], "linkedAt": "2026-11-08T12:00:00.000Z",
                           "name": "Triagem sintética Beta", "vehicle": "", "plate": ""}] if state["triage"] else []
                return await route.fulfill(**response(200, {"revision": len(linked), "items": linked,
                    "activeAtendimentoId": None, "sendAtendimentoId": None, "canCreateTriage": not linked}))
            if path == f"/api/chat/conversations/{B}/atendimentos/triagem" and method == "POST":
                assert request.post_data_json == {} and state["triage"] is None
                created = await ctx.request.post(ORIGIN + "/api/atendimentos", headers={"Origin": ORIGIN},
                    data={"name": "Triagem sintética Beta", "phone": "+5531999990002", "purpose": "unclassified"})
                assert created.status == 201
                state["triage"] = (await created.json())["id"]
                state["writes"].append(["triage", {}])
                return await route.fulfill(**response(201, {"atendimentoId": state["triage"]}))
            if path == f"/api/chat/conversations/{C}/atendimentos" and method == "GET":
                return await route.fulfill(**response(200, {
                    "revision": int(state["number_linked"]), "activeAtendimentoId": None, "sendAtendimentoId": None,
                    "items": [{"linkId": L3, "atendimentoId": state["review_atendimento"], "name": "Ficha para revisão", "vehicle": "", "plate": ""}] if state["number_linked"] else [],
                    "numberReviewAvailable": not state["number_linked"] or state["linked_review"],
                    "historyOnly": state["number_linked"] and not state["linked_review"],
                    "readIdentityBlocked": state["linked_review"],
                }))
            if path == f"/api/chat/conversations/{C}/atendimentos/{state['review_atendimento']}/numeracao":
                if method == "GET":
                    return await route.fulfill(**response(200, {"token": "synthetic-preview-token", "entityName": "Ficha para revisão",
                        "registeredPhone": "+5531999990003", "observedPhone": "+553199990003"}))
                assert method == "POST" and (not state["number_linked"] or state["linked_review"])
                data = request.post_data_json
                assert data["token"] == "synthetic-preview-token" and len(data["requestId"]) == 36
                assert data["reason"] == "Revisão sintética de identidade"
                state["number_linked"] = True
                state["linked_review"] = False
                state["writes"].append(["number_review", data])
                return await route.fulfill(**response(201, {"linkId": L3, "revision": 1}))
            if path == f"/api/atendimentos/{state['review_atendimento']}/evolution-conversations/{C}/messages":
                assert method == "GET" and parse_qs(parsed.query)["scope"] == ["linked"] and state["number_linked"]
                return await route.fulfill(**response(200, {"source": "evolution", "conversationId": C,
                    "items": [{"messageId": "synthetic-number-review", "timestamp": 1794045600,
                               "fromMe": True, "kind": "text", "text": "Histórico revisado"}],
                    "page": 1, "nextPage": None, "reportedTotal": 1,
                    "consistency": "offset-not-snapshot", "historyComplete": "unknown"}))
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
            if method == "GET" and path.endswith("/identity"):
                return await route.fulfill(**response(200, {"phone": None, "blocked": False, "targets": [], "owner": None}))
            if method == "GET" and path.endswith("/messages"):
                return await route.fulfill(**response(200, {"conversationId": path.split("/")[-2], "items": [], "page": 1, "nextPage": None}))
            raise AssertionError(f"Unexpected API call {method} {path}")

        await ctx.route("**/api/chat/conversations**", mock)
        await ctx.route("**/api/atendimentos?*", mock)
        await ctx.route(f"**/api/atendimentos/*/evolution-conversations/{B}/messages?*", mock)
        await ctx.route(f"**/api/atendimentos/*/evolution-conversations/{C}/messages?*", mock)
        await page.goto(ORIGIN + "/conversas")
        await page.get_by_role("button", name="Abrir conversa: Contato Sintético Alfa", exact=True).click()
        panel = page.get_by_role("region", name="Vínculos com Atendimentos")
        await expect(panel).to_be_visible()
        await expect(panel.get_by_text("Nenhum Atendimento vinculado.")).to_be_visible()
        await expect(page.get_by_role("dialog").get_by_role("button", name="Criar Atendimento de triagem")).to_have_count(0)
        await page.get_by_role("button", name="Fechar detalhes").click()
        await page.locator(".conversation-row").filter(has_text="Contato Sintético Alfa").get_by_role("button", name="Detalhes: 0 Atendimentos").click()
        await expect(panel).to_be_visible()
        await page.screenshot(path=str(ARTIFACTS / f"{width}-vazio.png"))
        h.mark(f"{width}px: opted-in UI, empty links, no duplicate chat history")

        await panel.get_by_role("searchbox", name="Localizar Atendimento existente").fill("Caso")
        await panel.get_by_role("button", name="Buscar").click()
        await expect(panel.get_by_text("Oficina Exemplo A", exact=False)).to_be_visible()
        await expect(panel.get_by_text("Oficina Exemplo B", exact=False)).to_be_visible()
        assert not await panel.get_by_role("button", name="Vincular", exact=True).first.is_enabled()
        await panel.get_by_role("textbox", name="Motivo para vincular ou desvincular").fill("Associação manual de teste")
        await panel.get_by_role("button", name="Vincular", exact=True).first.click()
        await expect(panel.get_by_role("button", name="Usar contexto")).to_have_count(1)
        assert state["revision"] == 1
        h.mark(f"{width}px: search, reason required, manual link, no parallel chat view")

        await panel.get_by_role("searchbox", name="Localizar Atendimento existente").fill("Caso")
        await panel.get_by_role("button", name="Buscar").click()
        await panel.get_by_role("textbox", name="Motivo para vincular ou desvincular").fill("Segundo Atendimento")
        state["fail_next_link"] = True
        await panel.get_by_role("button", name="Vincular", exact=True).click()
        await expect(panel.get_by_role("alert")).to_be_visible()
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
        await page.screenshot(path=str(ARTIFACTS / f"{width}-dois-vinculos.png"))
        h.mark(f"{width}px: switch active Atendimento context while no nested chat exists")

        await panel.get_by_role("button", name="Desvincular").last.click()
        await expect(panel.get_by_role("button", name="Confirmar desvínculo")).to_be_visible()
        await panel.get_by_role("button", name="Cancelar").click()
        assert len(state["links"]) == 2
        await panel.get_by_role("textbox", name="Motivo para vincular ou desvincular").fill("Fim do vínculo")
        await panel.get_by_role("button", name="Desvincular").last.click()
        await panel.get_by_role("button", name="Confirmar desvínculo").click()
        await expect(panel.get_by_role("button", name="Usar contexto")).to_have_count(1)
        assert state["active"] is None and len(state["links"]) == 1
        h.mark(f"{width}px: cancel/confirm unlink and reset context")

        await page.get_by_role("button", name="Fechar detalhes").click()
        await page.get_by_role("button", name="Abrir conversa: Contato Sintético Beta", exact=True).click()
        await expect(panel.get_by_text("Nenhum Atendimento vinculado.")).to_be_visible()
        await expect(page.get_by_text("Mensagem sintética B separada")).to_be_visible()
        await page.get_by_role("dialog").get_by_role("button", name="Criar Atendimento de triagem").click()
        await page.wait_for_url(lambda url: urlparse(url).path == f"/atendimentos/{state['triage']}")
        assert parse_qs(urlparse(page.url).query) == {"aba": ["chat"], "conversa": [B], "leitura": ["1"]}
        assert urlparse(page.url).path == f"/atendimentos/{state['triage']}"
        await expect(page.get_by_text("Mensagem sintética B separada")).to_be_visible()
        await expect(page.get_by_role("button", name="Enviar", exact=True)).to_have_count(0)
        await page.get_by_role("button", name="Voltar à visão anterior").click()
        await expect(page.get_by_role("button", name="Abrir conversa: Contato Sintético Beta", exact=True)).to_be_visible()
        h.mark(f"{width}px: historical triage opens linked read-only Atendimento and returns to Conversas")
        h.mark(f"{width}px: conversation switch isolates manual association panels")

        created = await ctx.request.post(ORIGIN + "/api/atendimentos", headers={"Origin": ORIGIN},
            data={"name": "Ficha para revisão", "phone": "+5531999990003", "purpose": "unclassified"})
        assert created.status == 201
        state["review_atendimento"] = (await created.json())["id"]
        await page.get_by_role("button", name="Abrir conversa: Contato Sintético Gama", exact=True).click()
        await panel.get_by_role("searchbox", name="Localizar Atendimento existente").fill("Ficha para revisão")
        await panel.get_by_role("button", name="Buscar", exact=True).click()
        await panel.get_by_role("button", name="Revisar numeração", exact=True).click()
        review = panel.get_by_role("group", name="Confirmar número do WhatsApp")
        await expect(review.get_by_text("+553199990003", exact=True)).to_be_visible()
        await expect(review.get_by_text("+5531999990003", exact=True)).to_be_visible()
        submit = review.get_by_role("button", name="Confirmar e vincular histórico")
        await expect(submit).to_be_disabled()
        await panel.get_by_role("textbox", name="Motivo para vincular ou desvincular").fill("Revisão sintética de identidade")
        await expect(submit).to_be_disabled()
        await review.get_by_role("checkbox").check()
        await submit.click()
        await page.wait_for_url(lambda url: urlparse(url).path == f"/atendimentos/{state['review_atendimento']}")
        await expect(page.get_by_text("Histórico revisado", exact=True)).to_be_visible()
        await expect(page.get_by_role("button", name="Enviar", exact=True)).to_have_count(0)
        await page.get_by_role("button", name="Voltar à visão anterior").click()
        await expect(page.get_by_role("button", name="Abrir conversa: Contato Sintético Gama", exact=True)).to_be_visible()
        h.mark(f"{width}px: explicit number review opens the existing Atendimento in read-only mode")

        state["linked_review"] = True
        await page.get_by_role("button", name="Abrir conversa: Contato Sintético Gama", exact=True).click()
        await expect(panel.get_by_text("Ficha para revisão", exact=True)).to_be_visible()
        await expect(panel.get_by_role("button", name="Usar contexto")).to_have_count(0)
        await panel.get_by_role("button", name="Revisar numeração", exact=True).click()
        await panel.get_by_role("textbox", name="Motivo para vincular ou desvincular").fill("Revisão sintética de identidade")
        await review.get_by_role("checkbox").check()
        await review.get_by_role("button", name="Confirmar e recuperar histórico").click()
        await page.wait_for_url(lambda url: urlparse(url).path == f"/atendimentos/{state['review_atendimento']}")
        await expect(page.get_by_text("Histórico revisado", exact=True)).to_be_visible()
        await page.get_by_role("button", name="Voltar à visão anterior").click()
        await expect(page.get_by_role("button", name="Abrir conversa: Contato Sintético Gama", exact=True)).to_be_visible()
        h.mark(f"{width}px: blocked history can be reviewed without removing the existing link")

        assert await page.evaluate("w => document.documentElement.scrollWidth <= w + 1", width)
        assert not h.external and not h.page_errors, (h.external, h.page_errors)
        assert all("@" not in p for _, p in state["requests"])
        assert all(kind in ["link", "unlink", "context", "triage", "number_review"] for kind, _ in state["writes"])
        h.mark(f"{width}px: no horizontal overflow, no external network, no JS exceptions")

        state["enabled"] = False
        await page.get_by_role("button", name="Atualizar", exact=True).click()
        await page.get_by_role("button", name="Abrir conversa: Contato Sintético Alfa", exact=True).click()
        assert await page.get_by_role("region", name="Vínculos com Atendimentos").count() == 0
        h.mark(f"{width}px: link feature OFF hides writes and never opens a second chat")
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
