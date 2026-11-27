"""Vendas: contextual primary action, compact navigation and mobile geometry."""
import asyncio
from pathlib import Path
import os

from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ORIGIN

PAGES = [("desempenho", "Desempenho"), ("funil", "Funil"), ("acompanhamento", "Acompanhamento")]

async def run():
    harness = Harness()
    evidence = os.environ.get("FUNIX_SALES_EVIDENCE")
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
            for width, height in [(320, 740), (390, 844), (1366, 768)]:
                context = await browser.new_context(viewport={"width": width, "height": height})
                await harness.watch(context)
                page = await context.new_page()
                await harness.attach(page)
                await page.goto(ORIGIN + "/vendas/funil")
                await harness.login(page)
                nav = page.get_by_role("navigation", name="Páginas de Vendas")
                assert await nav.get_by_role("link").all_text_contents() == [name for _, name in PAGES] + ["Conversas"]
                fab = page.get_by_role("button", name="+ Novo Atendimento", exact=True)
                copilot = page.get_by_role("button", name="Abrir Copiloto FUNIX")
                await expect(page.locator(".workspace-task-count")).to_have_count(0)
                for href, name in PAGES + [("conversas", "Conversas")]:
                    await nav.get_by_role("link", name=name, exact=True).click()
                    await expect(fab).to_be_visible()
                    await expect(copilot).to_have_count(0)
                    await expect(page.get_by_role("button", name="Sair", exact=True)).to_have_count(0)
                    if href == "desempenho":
                        await page.get_by_role("button", name="Aplicar", exact=True).wait_for()
                        cards = page.locator(".erp-sales-dashboard-cards").first
                        await expect(cards.locator("> section")).not_to_have_count(0)
                        if width < 761:
                            columns = await cards.evaluate("el => getComputedStyle(el).gridTemplateColumns")
                            assert len(columns.split()) == 2, columns
                        first = cards.locator("> section").first
                        await expect(first.locator("> strong")).to_be_visible()
                        await expect(first.locator("details > p")).not_to_be_visible()
                        await first.locator("summary").click()
                        await expect(first.locator("details > p")).to_be_visible()
                        await first.locator("summary").click()
                    if width < 761:
                        box = await fab.bounding_box()
                        bottom = await nav.bounding_box()
                        assert box["y"] + box["height"] <= bottom["y"]
                        assert box["x"] + box["width"] <= width
                    for control in await page.locator(".erp-sales-filters input, .erp-sales-filters select").all():
                        assert await control.evaluate("""el => {
                          const bounds = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect()
                          return bounds.right <= parent.right + 1 && bounds.left >= parent.left - 1
                        }""")
                    await fab.click()
                    await expect(page.get_by_role("form", name="Novo Atendimento")).to_be_visible()
                    await expect(fab).to_have_count(0)
                    await page.get_by_role("button", name="Fechar formulário").click()
                    if evidence and width == 390:
                        Path(evidence).mkdir(parents=True, exist_ok=True)
                        await page.screenshot(path=str(Path(evidence) / (href + ".png")))
                await expect(page.locator(".workspace-header").get_by_role("button", name="Minha conta")).to_have_count(0)
                if width < 761:
                    await expect(page.get_by_role("button", name="Minha conta")).to_have_count(0)
                    await page.get_by_role("button", name="Selecionar módulo").click()
                    menu = page.get_by_role("dialog", name="Selecionar módulo")
                    await menu.get_by_role("button", name="Minha conta").click()
                    await expect(menu).to_have_count(0)
                else:
                    await page.get_by_role("button", name="Recolher menu lateral").click()
                    await page.locator(".workspace-sidebar").get_by_role("button", name="Minha conta").click()
                account = page.get_by_role("dialog", name="Minha conta")
                await expect(account.get_by_role("button", name="Sair", exact=True)).to_be_visible()
                await account.get_by_role("button", name="Fechar conta").click()
                if width > 760:
                    await page.get_by_role("button", name="Expandir menu lateral").click()
                await page.goto(ORIGIN + "/oficina/patio")
                await expect(fab).to_have_count(0)
                await expect(copilot).to_have_count(0)
                await page.goto(ORIGIN + "/financeiro/contas-a-receber")
                await expect(fab).to_have_count(0)
                await expect(copilot).to_have_count(0)
                created = await context.request.post(ORIGIN + "/api/atendimentos",
                    data={"name": f"Cliente QA {width}", "phone": f"3199999{width:04d}"}, headers={"Origin": ORIGIN})
                assert created.ok, await created.text()
                await page.goto(ORIGIN + "/atendimentos/" + (await created.json())["id"])
                await expect(copilot).to_be_visible()
                await expect(fab).to_have_count(0)
                await context.close()
                harness.mark(f"Vendas: navegação, atalhos, formulários e geometria {width}×{height}")
            await browser.close()
            assert not harness.external and not harness.page_errors, (harness.external, harness.page_errors)
    finally:
        harness.cleanup()

if __name__ == "__main__":
    asyncio.run(run())
