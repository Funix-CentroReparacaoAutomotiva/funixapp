"""Exercise the workspace shell, memory and global tasks on an isolated SQLite."""

import asyncio
import os
from pathlib import Path
import re

from playwright.async_api import async_playwright, expect

from m1_atendimentos import Harness, ORIGIN


async def exercise():
    harness = Harness()
    target = os.environ.get("FUNIX_ERP_WORKSPACE_EVIDENCE")
    evidence = Path(target) if target else None
    if evidence:
        evidence.mkdir(parents=True, exist_ok=True)
    try:
        harness.check_ports()
        await harness.start_api()
        web = harness.start(["node", "node_modules/vite/bin/vite.js", "--port", "5173", "--strictPort"], "vite")
        await harness.ready(ORIGIN, web)
        async with async_playwright() as playwright:
            options = {"headless": True, "args": ["--no-sandbox"]}
            if Path("/usr/bin/chromium").is_file():
                options["executable_path"] = "/usr/bin/chromium"
            browser = await playwright.chromium.launch(**options)
            for width, height in [(1366, 768), (390, 844)]:
                context = await browser.new_context(viewport={"width": width, "height": height})
                await harness.watch(context)
                page = await context.new_page()
                await harness.attach(page)
                await page.goto(ORIGIN + "/vendas/funil")
                await harness.login(page)
                await expect(page.get_by_role("navigation")).to_have_count(1)

                async def select(module, current):
                    if width > 760:
                        await page.get_by_label("Módulo", exact=True).select_option(label=module)
                    else:
                        menu = page.get_by_role("button", name="Selecionar módulo", exact=True)
                        task = page.get_by_role("button", name=re.compile("Central de tarefas")).first
                        assert (await task.bounding_box())["x"] < (await menu.bounding_box())["x"]
                        await menu.click()
                        mosaic = page.get_by_role("dialog", name="Selecionar módulo")
                        await expect(mosaic).to_be_visible()
                        assert len((await mosaic.locator(".workspace-mosaic").evaluate(
                            "el => getComputedStyle(el).gridTemplateColumns")).split()) == 2
                        await expect(mosaic.get_by_role("button", name=current, exact=True)).to_have_attribute("aria-pressed", "true")
                        await expect(mosaic.get_by_role("button", name="Tarefas", exact=True)).to_have_count(0)
                        if evidence:
                            await page.screenshot(path=str(evidence / "seletor-390.png"))
                        await mosaic.get_by_role("button", name=module, exact=True).click()
                        await expect(mosaic).not_to_be_visible()

                await select("Oficina", "Vendas")
                desk = page.get_by_role("navigation", name="Páginas de Oficina")
                await expect(desk.get_by_role("link")).to_have_count(2)
                await expect(desk.get_by_role("link", name="Pátio")).to_have_attribute("aria-current", "page")
                await desk.get_by_role("link", name="Planejamento").click()
                await select("Vendas", "Oficina")
                await expect(page.get_by_role("heading", name="Funil de vendas")).to_be_visible()
                await select("Oficina", "Vendas")
                await expect(page).to_have_url(ORIGIN + "/oficina/planejamento")
                await page.goto(ORIGIN + "/")
                await expect(page).to_have_url(ORIGIN + "/oficina/planejamento")
                if width > 760:
                    before = (await page.locator(".app-viewport").bounding_box())["width"]
                    await page.get_by_role("button", name="Recolher menu lateral").click()
                    assert (await page.locator(".app-viewport").bounding_box())["width"] > before
                    await expect(desk).not_to_be_visible()
                    await page.get_by_role("button", name="Expandir menu lateral").click()
                    await expect(desk).to_be_visible()
                else:
                    bottom = await desk.bounding_box()
                    assert bottom and bottom["y"] > height - 100 and bottom["y"] + bottom["height"] <= height + 1
                if evidence:
                    await page.screenshot(path=str(evidence / f"oficina-{width}.png"))

                await select("Vendas", "Oficina")
                search = page.get_by_role("searchbox", name="Pesquisar")
                await search.fill("Filtro preservado")
                await page.get_by_role("button", name="Filtrar").click()
                button = page.get_by_role("button", name=re.compile("^Central de tarefas"))
                await button.click()
                central = page.get_by_role("dialog", name="Central de tarefas")
                await central.get_by_role("button", name="Catálogo", exact=True).click()
                await expect(central.get_by_role("heading", name="Catálogo de tarefas")).to_be_visible()
                await central.get_by_role("button", name="Fechar central").click()
                await expect(search).to_have_value("Filtro preservado")
                await expect(page).to_have_url(ORIGIN + "/vendas/funil")

                created = await context.request.post(ORIGIN + "/api/atendimentos",
                    data={"name": f"Cliente sintético {width}"}, headers={"Origin": ORIGIN})
                assert created.ok
                record = (await created.json())["id"]
                await page.goto(ORIGIN + "/atendimentos/" + record)
                await page.locator(".detail-header").get_by_text(f"Cliente sintético {width}").wait_for()
                await button.click()
                await central.get_by_role("button", name="Nova tarefa").click()
                editor = page.get_by_role("dialog", name="Cadastrar tarefa")
                await editor.get_by_label("Tarefa", exact=True).fill(f"Tarefa prioritária {width}")
                await editor.get_by_label("Prioridade", exact=True).fill("Alta")
                await editor.get_by_label("Vincular ao Atendimento consultado").check()
                await editor.get_by_role("button", name="Salvar tarefa").click()
                await expect(central.get_by_text(f"Tarefa prioritária {width}", exact=True)).to_be_visible()
                response = await context.request.get(ORIGIN + "/api/erp/tasks/items")
                task = next(item for item in (await response.json())["items"] if item["title"] == f"Tarefa prioritária {width}")
                assert task["atendimentoId"] == record
                if evidence:
                    await page.screenshot(path=str(evidence / f"tarefas-{width}.png"))
                await central.get_by_role("button", name=f"Concluir Tarefa prioritária {width}").click()
                await expect(central.get_by_text(f"Tarefa prioritária {width}", exact=True)).to_have_count(0)
                await central.get_by_role("button", name="Painel", exact=True).click()
                await expect(central.get_by_role("heading", name="Painel de tarefas")).to_be_visible()
                await expect(central.get_by_text(f"Tarefa prioritária {width}", exact=True)).to_be_visible()
                await central.get_by_role("button", name="Fechar central").click()
                await expect(page).to_have_url(ORIGIN + "/atendimentos/" + record)
                await expect(button).to_have_attribute("aria-label", re.compile(r"0 prioritárias pendentes"))
                await page.goto(ORIGIN + "/oficina/patio")
                await select("Vendas", "Oficina")
                await expect(page).to_have_url(ORIGIN + "/vendas/funil")
                await page.go_back()
                await expect(page).to_have_url(ORIGIN + "/oficina/patio")
                await expect(page.get_by_role("navigation", name="Páginas de Oficina")).to_be_visible()
                await page.goto(ORIGIN + "/financeiro")
                await page.get_by_role("link", name="Ver movimentações").click()
                await expect(page).to_have_url(ORIGIN + "/financeiro#movimentacoes")
                await expect(page.locator("html")).to_be_visible()
                assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
                await context.close()
                harness.mark("Navegação, memória, tarefas e vínculo", width=width, height=height)
            assert not harness.external and not harness.page_errors, (harness.external, harness.page_errors)
            await browser.close()
    finally:
        harness.cleanup()


if __name__ == "__main__":
    asyncio.run(exercise())
