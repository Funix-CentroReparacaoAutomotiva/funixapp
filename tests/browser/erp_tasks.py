"""ERP task acceptance with a temporary SQLite database, local API and Chromium."""
import asyncio
import os
from pathlib import Path
from unittest.mock import patch

from playwright.async_api import async_playwright, expect

from m1_atendimentos import API, Harness, ORIGIN


async def create_task(page, title, priority, order):
    await page.get_by_role("button", name="Nova tarefa").click()
    dialog = page.get_by_role("dialog")
    await expect(dialog).to_be_visible()
    for label, value in [
        ("Tarefa", title), ("Dono / responsável", "Operador sintético"), ("Setor", "Oficina"),
        ("Trabalho", "Revisão"), ("Valor agregado", "Rastreabilidade"), ("Investimento (R$)", "25,30"),
        ("Esforço", "3"), ("Prioridade", priority), ("Ordem da prioridade", order), ("Prazo", "2026-11-30"),
    ]:
        await dialog.get_by_label(label, exact=True).fill(value)
    await dialog.get_by_label("Alcance").select_option("6")
    await dialog.get_by_label("Impacto").select_option("2")
    await dialog.get_by_label("Confiança").select_option("0.8")
    await dialog.get_by_role("button", name="Salvar tarefa").click()
    await expect(page.get_by_role("button", name=title)).to_be_visible()


async def navigate(page, title):
    nav = page.get_by_role("navigation", name="Operação FUNIX")
    await nav.get_by_text("Tarefas", exact=True).click()
    await nav.get_by_role("link", name=title, exact=True).click()
    await expect(page.get_by_role("heading", name=title, exact=True)).to_be_visible()


async def run():
    h = Harness()
    artifacts = os.environ.get("FUNIX_ERP_TASKS_ARTIFACTS")

    async def capture(page, name):
        if artifacts:
            folder = Path(artifacts)
            folder.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(folder / f"{name}.png"))

    try:
        h.check_ports()
        # Keep the application processes independent of credentials and integration
        # settings that may be present in the operator's shell.
        environment = {key: value for key, value in os.environ.items() if key in {"PATH", "HOME", "TMPDIR"}}
        with patch.dict(os.environ, environment, clear=True):
            await h.start_api()
            web = h.start(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1",
                           "--port", "5173", "--strictPort"], "web")
        await h.ready(ORIGIN, web)
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
            context = await browser.new_context(locale="pt-BR", timezone_id="America/Sao_Paulo",
                                                viewport={"width": 1366, "height": 768})
            await h.watch(context)
            page = await context.new_page()
            await h.attach(page)
            unauthenticated = await context.request.get(API + "/api/erp/tasks/items")
            assert unauthenticated.status == 401, await unauthenticated.text()
            await page.goto(ORIGIN + "/tarefas/catalogo")
            await h.login(page)
            await expect(page.get_by_text("Nenhuma tarefa cadastrada")).to_be_visible()
            await create_task(page, "Conferir revisão do lote sintético", "Alta", "2")
            await create_task(page, "Revisar instruções da bancada", "Média", "10")
            await expect(page.get_by_role("cell", name="3,2", exact=True)).to_have_count(2)
            await expect(page.locator("tbody tr").first).to_contain_text("Conferir revisão")
            await page.get_by_label("Prazo até").fill("2026-11-29")
            await expect(page.get_by_text("Nenhuma tarefa para estes filtros")).to_be_visible()
            await page.get_by_label("Prazo até").fill("")
            await page.get_by_label("Setor").select_option("Oficina")
            await expect(page.locator("tbody tr")).to_have_count(2)
            await capture(page, "catalogo-1366")
            h.mark("Catálogo, ordem, RICE e filtros usando a API local autenticada")

            await navigate(page, "Painel de tarefas")
            await page.get_by_role("button", name="Conferir revisão", exact=False).click()
            dialog = page.get_by_role("dialog")
            await dialog.get_by_label("Situação").select_option("in-progress")
            await dialog.get_by_role("button", name="Salvar tarefa").click()
            active = page.get_by_role("heading", name="Em progresso 1").locator("..")
            task = active.get_by_role("button", name="Conferir revisão", exact=False)
            await expect(task).to_be_visible()
            await page.get_by_label("Prioridade").select_option("Alta")
            await expect(page.get_by_role("button", name="Revisar instruções", exact=False)).to_have_count(0)
            await page.get_by_label("Prioridade").select_option("")
            await page.reload()
            await expect(task).to_be_visible()
            await capture(page, "painel-1366")

            for width, height in [(1920, 1080), (390, 844)]:
                await page.set_viewport_size({"width": width, "height": height})
                await expect(task).to_be_visible()
                assert await page.locator(".erp-view").evaluate("element => element.scrollWidth === element.clientWidth")
                await capture(page, f"painel-{width}")
            await page.get_by_role("button", name="Filtros", exact=True).click()
            await expect(page.get_by_label("Prazo até")).to_be_visible()
            await page.get_by_role("button", name="Filtros", exact=True).click()
            await task.click()
            await expect(dialog).to_be_visible()
            await capture(page, "edicao-390")
            await page.keyboard.press("Escape")
            await expect(dialog).to_have_count(0)
            assert not h.external and not h.page_errors, (h.external, h.page_errors)
            h.mark("Situação persiste no quadro; desktop 1366/1920 e mobile 390 sem overflow horizontal")
            await browser.close()
    finally:
        h.cleanup()


if __name__ == "__main__":
    asyncio.run(run())
