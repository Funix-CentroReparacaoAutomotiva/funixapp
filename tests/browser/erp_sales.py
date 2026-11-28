"""Exercise the Sales workflow in Chromium with a synthetic SQLite database."""

import asyncio
import re
import os
from pathlib import Path

from playwright.async_api import async_playwright, expect

from m1_atendimentos import Harness, ORIGIN


async def run():
    harness = Harness()
    try:
        harness.check_ports()
        await harness.start_api()
        vite = harness.start(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], "vite")
        await harness.ready(ORIGIN, vite)
        options = {"headless": True, "args": ["--no-sandbox"]}
        if os.environ.get("FUNIX_CHROMIUM"):
            options["executable_path"] = os.environ["FUNIX_CHROMIUM"]
        elif Path("/usr/bin/chromium").exists():
            options["executable_path"] = "/usr/bin/chromium"
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(**options)
            context = await browser.new_context(viewport={"width": 390, "height": 844})
            await harness.watch(context)
            page = await context.new_page()
            page.set_default_timeout(8000)
            await harness.attach(page)
            await page.goto(ORIGIN + "/vendas/funil")
            await harness.login(page)
            record = await context.request.post(ORIGIN + "/api/atendimentos",
                                                 data={"name": "Vendas QA", "phone": "31999990109", "purpose": "commercial", "plate": "QAQ1A09", "brand": "Fiat", "model": "Punto"},
                                                 headers={"Origin": ORIGIN})
            assert record.ok, await record.text()
            triage = await context.request.post(ORIGIN + "/api/atendimentos",
                data={"name":"Classificação QA","phone":"31999990110","purpose":"unclassified","plate":"QAQ1A10"},
                headers={"Origin": ORIGIN})
            assert triage.ok, await triage.text()
            triage_id = (await triage.json())["id"]
            await page.reload()
            selector = page.get_by_role("group", name="Filtrar por etapa")
            await expect(selector.get_by_role("button")).to_have_count(6)
            assert await selector.locator("button").all_text_contents() == [
                "Todas", "Novo contato", "Aguardando dados", "Em negociação", "Morno", "Frio"]
            filters = page.get_by_role("button", name="Filtros", exact=True)
            await expect(filters).to_have_attribute("aria-expanded", "false")
            board = page.get_by_role("list", name="Fluxo comercial")
            await expect(board.locator(".erp-funnel-step")).to_have_count(6)
            await expect(board.locator(".erp-funnel-arrow")).to_have_count(5)
            steps = board.locator(".erp-funnel-step")
            first, second = steps.nth(0), steps.nth(1)
            assert (await second.bounding_box())["y"] > (await first.bounding_box())["y"]
            await expect(first.get_by_role("button", name=re.compile(r"^QAQ1A(?:09|10)"))).to_have_count(2)
            await expect(first.get_by_role("button", name=re.compile(r"^QAQ1A09")).locator("span")).to_have_text("Fiat Punto")
            await expect(page.get_by_role("button", name="Quadro completo")).to_have_count(0)
            await expect(page.get_by_role("button", name="Lista", exact=True)).to_have_count(0)
            launch = page.get_by_role("button", name="Abrir busca de Vendas")
            add = page.get_by_role("button", name="+ Novo Atendimento")
            assert (await launch.bounding_box())["y"] > (await add.bounding_box())["y"]
            await launch.click()
            search = page.get_by_role("searchbox", name="Pesquisar em Vendas")
            submit = page.get_by_role("button", name="Buscar", exact=True)
            assert (await submit.bounding_box())["x"] > (await search.bounding_box())["x"]
            assert (await search.bounding_box())["y"] > (await add.bounding_box())["y"]
            requests = []
            page.on("request", lambda req: requests.append(req.url) if "/api/erp/sales/" in req.url or "/api/chat/conversations?" in req.url else None)
            await search.fill("QAQ1A09")
            await submit.click()
            await expect(steps).to_have_count(1)
            await expect(steps.first.get_by_role("button", name=re.compile("Vendas QA"))).to_be_visible()
            assert len(requests) == 1 and "/sales/funnel?" in requests[0] and "q=QAQ1A09" in requests[0], requests
            nav = page.get_by_role("navigation", name="Páginas de Vendas")
            for tab, api_path in [("Acompanhamento","/sales/tracking?"), ("Desempenho","/sales/dashboard?"), ("Conversas","/chat/conversations?")]:
                requests.clear()
                async with page.expect_response(lambda response: api_path in response.url) as fetched:
                    await nav.get_by_role("link", name=tab, exact=True).click()
                assert "q=QAQ1A09" in (await fetched.value).url
                assert set(requests) == {(await fetched.value).url}, requests
                await expect(page.get_by_role("button", name="Editar busca: QAQ1A09")).to_be_visible()
                if tab == "Desempenho":
                    await expect(page.get_by_text("Desempenho filtrado · QAQ1A09")).to_be_visible()
                    await page.get_by_label("Início", exact=True).fill("2026-11-05")
                    await page.get_by_label("Fim", exact=True).fill("2026-11-12")
                    async with page.expect_response(lambda response: "/sales/dashboard?" in response.url and "from=2026-11-05" in response.url):
                        await page.get_by_role("button", name="Aplicar", exact=True).click()
            await nav.get_by_role("link", name="Desempenho", exact=True).click()
            await expect(page.get_by_label("Início", exact=True)).to_have_value("2026-11-05")
            await expect(page.get_by_label("Fim", exact=True)).to_have_value("2026-11-12")
            await nav.get_by_role("link", name="Funil", exact=True).click()
            await expect(steps).to_have_count(1)
            await page.get_by_role("button", name="Limpar busca").click()
            await expect(steps).to_have_count(6)
            await selector.get_by_role("button", name="Novo contato", exact=True).click()
            await expect(steps).to_have_count(1)
            await expect(selector.get_by_role("button", name="Novo contato", exact=True)).to_have_attribute("aria-pressed", "true")
            first_lane = board.get_by_role("region", name="Novo contato")
            candidate = first_lane.get_by_role("button", name="Classificação QA", exact=False)
            await expect(candidate).to_contain_text("A classificar")
            await candidate.click()
            await expect(page.get_by_role("navigation", name="Ações do Atendimento")).to_be_visible()
            assert await page.locator(".workspace-record-pages button span").all_text_contents() == ["Dados", "WhatsApp", "Diagnóstico", "Confirmação", "Emitir"]
            await expect(page.get_by_role("button", name="Diário", exact=True)).to_have_count(0)
            await expect(page.get_by_role("button", name="Editar Atendimento", exact=True)).to_have_count(0)
            await expect(page.get_by_label("Próxima ação", exact=True)).to_have_count(0)
            await expect(page.locator(".workspace-header,.workspace-sidebar,.workspace-pages")).to_have_count(0)
            await expect(board).to_have_count(0)
            await page.get_by_label("Canal de aquisição", exact=True).select_option("non_commercial")
            await expect(page.get_by_role("form", name="Editar Atendimento")).to_have_attribute("data-save-state", "saved")
            await page.get_by_role("button", name="Voltar à visão anterior").click()
            await expect(candidate).to_have_count(0)
            await filters.click()
            await page.get_by_label("Etapa", exact=True).select_option("non-commercial")
            await page.get_by_role("button", name="Aplicar filtros", exact=True).click()
            await page.get_by_role("button", name="Classificação QA", exact=False).click()
            await page.get_by_label("Canal de aquisição", exact=True).select_option("WhatsApp")
            await expect(page.get_by_role("form", name="Editar Atendimento")).to_have_attribute("data-save-state", "saved")
            await page.get_by_role("button", name="Voltar à visão anterior").click()
            await expect(page.get_by_role("button", name="Classificação QA", exact=False)).to_have_count(0)
            record_after = await context.request.get(ORIGIN + "/api/atendimentos/" + triage_id)
            assert record_after.ok and (await record_after.json())["purpose"] == "commercial"
            await selector.get_by_role("button", name="Novo contato", exact=True).click()
            await expect(first_lane.get_by_role("button", name="Classificação QA", exact=False)).to_be_visible()
            await expect(first_lane.get_by_role("button", name="Classificação QA", exact=False)).not_to_contain_text("A classificar")
            await page.get_by_role("button", name="Vendas QA", exact=False).click()
            await page.get_by_label("Etapa comercial", exact=True).select_option("em-negociacao")
            await expect(page.get_by_role("form", name="Editar Atendimento")).to_have_attribute("data-save-state", "saved")
            await expect(page.get_by_text("Etapa alterada para Em negociação")).to_have_count(0)
            await expect(page.get_by_label("Nome do autor")).to_have_count(0)
            await page.get_by_label("Anotação", exact=True).fill("Confirmar orçamento complementar.")
            await page.get_by_role("button", name="Registrar anotação").click()
            await expect(page.get_by_text("Confirmar orçamento complementar.", exact=True)).to_be_visible()
            await expect(page.get_by_label("Responsável", exact=True)).to_have_count(0)
            await page.get_by_label("Canal de aquisição", exact=True).select_option("WhatsApp")
            await page.get_by_label("Próximo contato").fill("2025-01-20T14:45")
            await expect(page.get_by_role("form", name="Editar Atendimento")).to_have_attribute("data-save-state", "saved")
            await page.get_by_role("button", name="Voltar à visão anterior").click()
            await selector.get_by_role("button", name="Em negociação", exact=False).click()
            await expect(board).to_contain_text("Vendas QA")
            await expect(board).not_to_contain_text("Classificação QA")
            assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            await page.set_viewport_size({"width":1280,"height":900})
            await page.goto(ORIGIN + "/vendas/funil")
            await expect(board.locator(".erp-funnel-arrow")).to_have_count(5)
            await expect(board.get_by_role("region", name="Em negociação")).to_contain_text("QAQ1A09")
            await expect(filters).to_have_attribute("aria-expanded", "false")
            await board.get_by_role("button", name=re.compile(r"^QAQ1A09")).click()
            await expect(page.get_by_role("navigation", name="Ações do Atendimento")).to_be_visible()
            await page.goto(ORIGIN + "/vendas/desempenho")
            await expect(page.get_by_role("heading", name="Prioridades do dia")).to_be_visible()
            await expect(page.get_by_role("heading", name="Valor aprovado")).to_be_visible()
            await expect(page.get_by_role("heading", name="Valor recebido")).to_be_visible()
            assert not harness.external and not harness.page_errors, (harness.external, harness.page_errors)
            await browser.close()
            harness.mark("Vendas: quadro responsivo, filtros, classificação e busca exclusiva na aba ativa")
    finally:
        harness.cleanup()


if __name__ == "__main__":
    asyncio.run(run())
