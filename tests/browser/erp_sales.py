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
                                                 data={"name": "Vendas QA", "phone": "31999990109", "purpose": "commercial", "plate": "QAQ1A09"},
                                                 headers={"Origin": ORIGIN})
            assert record.ok, await record.text()
            triage = await context.request.post(ORIGIN + "/api/atendimentos",
                data={"name":"Classificação QA","phone":"31999990110","purpose":"unclassified","plate":"QAQ1A10"},
                headers={"Origin": ORIGIN})
            assert triage.ok, await triage.text()
            triage_id = (await triage.json())["id"]
            await page.reload()
            selector = page.get_by_role("group", name="Etapas comerciais")
            await expect(selector.get_by_role("button")).to_have_count(6)
            await expect(page.locator(".erp-funnel-board")).to_have_count(0)
            assert await selector.locator("button span").all_text_contents() == [
                "Novo contato", "Aguardando dados", "Em negociação", "Morno", "Frio", "Orçamento rejeitado"]
            search = page.get_by_role("searchbox", name="Pesquisar")
            submit = page.get_by_role("button", name="Pesquisar", exact=True)
            filters = page.locator(".erp-sales-more-filters")
            assert not await filters.evaluate("(details) => details.open")
            assert (await submit.bounding_box())["x"] > (await search.bounding_box())["x"]
            assert (await filters.bounding_box())["y"] > (await search.bounding_box())["y"]
            await page.get_by_role("button", name="Quadro completo").click()
            board = page.get_by_role("list", name="Fluxo comercial")
            await expect(board.locator(".erp-funnel-step")).to_have_count(6)
            await expect(board.locator(".erp-funnel-arrow")).to_have_count(5)
            steps = board.locator(".erp-funnel-step")
            first, second = steps.nth(0), steps.nth(1)
            assert (await second.bounding_box())["y"] > (await first.bounding_box())["y"]
            await expect(first.get_by_role("button", name=re.compile(r"^QAQ1A(?:09|10)"))).to_have_count(2)
            await expect(first.get_by_role("button", name=re.compile(r"^QAQ1A10"))).to_have_text("QAQ1A10")
            await search.fill("QAQ1A09")
            await submit.click()
            await expect(board.get_by_role("button")).to_have_count(1)
            await search.fill("")
            await submit.click()
            await page.get_by_role("button", name="Lista", exact=True).click()
            await selector.get_by_role("button", name="Novo contato", exact=False).click()
            await expect(selector.get_by_role("button", name="Novo contato", exact=False)).to_have_attribute("aria-pressed", "true")
            await expect(page.get_by_role("link", name="Triagem", exact=True)).to_have_count(0)
            await expect(page.get_by_role("button", name="Tabela", exact=True)).to_have_count(0)
            await expect(page.get_by_role("button", name="Quadro", exact=True)).to_have_count(0)
            await expect(page.get_by_text("Retornos prioritários", exact=False)).to_have_count(0)
            first_lane = page.locator(".erp-sales-mobile-list")
            candidate = first_lane.get_by_role("button", name="Classificação QA", exact=False)
            await expect(candidate).to_contain_text("A classificar")
            await candidate.click()
            await expect(page.get_by_role("navigation", name="Ações do Atendimento")).to_be_visible()
            assert await page.locator(".workspace-record-pages button span").all_text_contents() == ["Dados", "WhatsApp", "Diagnóstico", "Confirmação", "Emitir"]
            await expect(page.get_by_role("button", name="Diário", exact=True)).to_have_count(0)
            await expect(page.get_by_role("button", name="Editar Atendimento", exact=True)).to_have_count(0)
            await expect(page.get_by_label("Próxima ação", exact=True)).to_have_count(0)
            await expect(page.locator(".workspace-header,.workspace-sidebar,.workspace-pages")).to_have_count(0)
            await expect(page.locator(".erp-sales-mobile-list")).to_have_count(0)
            await page.get_by_label("Canal de aquisição", exact=True).select_option("non_commercial")
            await expect(page.get_by_role("form", name="Editar Atendimento")).to_have_attribute("data-save-state", "saved")
            await page.get_by_role("button", name="Voltar à visão anterior").click()
            await expect(candidate).to_have_count(0)
            await page.locator(".erp-sales-more-filters summary").click()
            await page.get_by_label("Classificação do filtro").select_option("non-commercial")
            await page.get_by_role("button", name="Pesquisar", exact=True).click()
            await page.get_by_role("button", name="Classificação QA", exact=False).click()
            await page.get_by_label("Canal de aquisição", exact=True).select_option("WhatsApp")
            await expect(page.get_by_role("form", name="Editar Atendimento")).to_have_attribute("data-save-state", "saved")
            await page.get_by_role("button", name="Voltar à visão anterior").click()
            await expect(page.get_by_role("button", name="Classificação QA", exact=False)).to_have_count(0)
            record_after = await context.request.get(ORIGIN + "/api/atendimentos/" + triage_id)
            assert record_after.ok and (await record_after.json())["purpose"] == "commercial"
            await page.get_by_role("button", name="Ver todos", exact=True).click()
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
            await expect(page.locator(".erp-sales-mobile-list")).to_contain_text("Vendas QA")
            await expect(page.locator(".erp-sales-mobile-list")).not_to_contain_text("Classificação QA")
            assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            await page.set_viewport_size({"width":1280,"height":900})
            await page.goto(ORIGIN + "/vendas/funil")
            await expect(board.locator(".erp-funnel-arrow")).to_have_count(5)
            await expect(board.get_by_role("region", name="Em negociação")).to_contain_text("QAQ1A09")
            assert not await filters.evaluate("(details) => details.open")
            assert (await submit.bounding_box())["x"] > (await search.bounding_box())["x"]
            await board.get_by_role("button", name=re.compile(r"^QAQ1A09")).click()
            await expect(page.get_by_role("navigation", name="Ações do Atendimento")).to_be_visible()
            await page.goto(ORIGIN + "/vendas/desempenho")
            await expect(page.get_by_role("heading", name="Prioridades do dia")).to_be_visible()
            await expect(page.get_by_role("heading", name="Valor aprovado")).to_be_visible()
            await expect(page.get_by_role("heading", name="Valor recebido")).to_be_visible()
            assert not harness.external and not harness.page_errors, (harness.external, harness.page_errors)
            await browser.close()
            harness.mark("Vendas mobile: atualização de etapa, comentário, retorno vencido, classificação no seletor de seis etapas e Desempenho")
    finally:
        harness.cleanup()


if __name__ == "__main__":
    asyncio.run(run())
