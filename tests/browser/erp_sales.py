"""Exercise the Sales workflow in Chromium with a synthetic SQLite database."""

import asyncio
import re
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
        if Path("/usr/bin/chromium").exists():
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
            await page.reload()
            await page.get_by_role("button", name="Vendas QA", exact=False).click()
            await page.get_by_label("Etapa comercial", exact=True).select_option("em-negociacao")
            await page.get_by_role("button", name="Alterar etapa").click()
            await expect(page.get_by_text("Etapa alterada para Em negociação")).to_be_visible()
            await page.get_by_label("Nome do autor").fill("Operador QA")
            await page.get_by_label("Comentário", exact=True).fill("Confirmar orçamento complementar.")
            await page.get_by_role("button", name="Registrar comentário").click()
            await expect(page.get_by_text("Confirmar orçamento complementar.", exact=True)).to_be_visible()
            await page.get_by_label("Responsável", exact=True).fill("Vendedor QA")
            await page.get_by_label("Canal de aquisição", exact=True).select_option("WhatsApp")
            await page.get_by_label("Retorno (horário de São Paulo)").fill("2025-01-20T14:45")
            await page.get_by_role("button", name="Salvar acompanhamento").click()
            await expect(page.get_by_text(re.compile(r"Retorno vencido · 20/01/2025,? 14:45"))).to_be_visible()
            await page.get_by_role("button", name="Fechar detalhes").click()
            await page.get_by_role("button", name="Tabela", exact=True).click()
            await expect(page.get_by_role("table")).to_contain_text("Vendas QA")
            assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            await page.goto(ORIGIN + "/vendas/desempenho")
            await expect(page.get_by_role("heading", name="Prioridades do dia")).to_be_visible()
            await expect(page.get_by_role("heading", name="Valor aprovado")).to_be_visible()
            await expect(page.get_by_role("heading", name="Valor recebido")).to_be_visible()
            assert not harness.external and not harness.page_errors, (harness.external, harness.page_errors)
            await browser.close()
            harness.mark("Vendas mobile: atualização de etapa, comentário, retorno vencido, tabela e Desempenho")
    finally:
        harness.cleanup()


if __name__ == "__main__":
    asyncio.run(run())
