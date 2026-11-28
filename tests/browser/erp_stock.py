"""Exercise inventory views against the local ERP with a synthetic SQLite database."""

import asyncio
import os
import socket
import subprocess
from pathlib import Path

from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT

FRONTEND_PORT = 5179
API_PORT = 8797
ORIGIN = f"http://127.0.0.1:{FRONTEND_PORT}"


async def run():
    harness = Harness()
    evidence = os.environ.get("FUNIX_ERP_STOCK_EVIDENCE")
    if evidence:
        Path(evidence).mkdir(parents=True, exist_ok=True)
    try:
        for port in (FRONTEND_PORT, API_PORT):
            with socket.socket() as check:
                if check.connect_ex(("127.0.0.1", port)) == 0:
                    raise RuntimeError(f"Porta {port} ocupada. O teste usa apenas processos próprios.")
        def start(command, label):
            log = (harness.folder / f"{label}.log").open("w+")
            harness.logs.append(log)
            environment = {
                "PATH": os.environ["PATH"],
                "NODE_ENV": "development",
                "FUNIX_API_HOST": "127.0.0.1",
                "FUNIX_API_PORT": str(API_PORT),
                "FUNIX_APP_ORIGIN": ORIGIN,
                "FUNIX_DATABASE_PATH": str(harness.folder / "stock.sqlite"),
                "FUNIX_OPERATOR_PASSWORD": harness.password,
            }
            process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT)
            harness.processes.append(process)
            return process

        backend = start(["node", "server/index.ts"], "api")
        await harness.ready(f"http://127.0.0.1:{API_PORT}/api/ready", backend)
        vite = start(["node", "--input-type=module", "-e", f"""
            import {{ createServer }} from 'vite'
            const server = await createServer({{server: {{
              port: {FRONTEND_PORT}, strictPort: true,
              proxy: {{'/api': {{ target: 'http://127.0.0.1:{API_PORT}', changeOrigin: false }}}}
            }}}})
            await server.listen()
        """], "vite")
        await harness.ready(ORIGIN, vite)
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"]
            )
            context = await browser.new_context(viewport={"width": 1366, "height": 768}, locale="pt-BR")
            await harness.watch(context)
            page = await context.new_page()
            await harness.attach(page)
            page.set_default_timeout(8000)
            await page.goto(ORIGIN + "/estoque/insumos")
            await harness.login(page)

            async def material(code, name, unit):
                await page.get_by_role("button", name="Cadastrar material").click()
                await page.get_by_label("Código", exact=True).fill(code)
                await page.get_by_label("Nome", exact=True).fill(name)
                await page.get_by_label("Unidade", exact=True).fill(unit)
                await page.get_by_label("Estoque mínimo", exact=True).fill("0,5")
                await page.get_by_label("Custo unitário (R$)").fill("2,25")
                await page.get_by_role("button", name="Salvar material").click()
                await expect(page.get_by_role("row", name=name, exact=False)).to_contain_text("Repor")

            async def movement(name, movement_type, quantity, reason=""):
                await page.get_by_role("button", name=f"Movimentar {name}").click()
                await page.get_by_label("Tipo de movimentação", exact=True).select_option(movement_type)
                await page.get_by_label("Quantidade", exact=False).fill(quantity)
                await page.get_by_label("Responsável").fill("Pessoa de teste")
                if reason:
                    await page.get_by_label("Justificativa").fill(reason)
                await page.get_by_role("button", name="Registrar movimentação", exact=True).click()
                await expect(page.get_by_text("Movimentação registrada.", exact=True)).to_be_visible()

            await material("QA-INS-1", "Insumo sintético", "un")
            await movement("Insumo sintético", "entry", "1,00")
            await movement("Insumo sintético", "exit", "0,40")
            await movement("Insumo sintético", "adjustment", "-0,20", "Contagem sintética")
            await expect(page.get_by_role("row", name="Insumo sintético", exact=False)).to_contain_text("R$ 0,90")
            await page.get_by_label("Abaixo do estoque mínimo").check()
            await expect(page.get_by_role("row", name="Insumo sintético", exact=False)).to_be_visible()

            await page.goto(ORIGIN + "/estoque/tintas")
            await material("QA-TIN-1", "Tinta sintética", "L")
            await expect(page.get_by_text("Insumo sintético", exact=True)).to_have_count(0)

            await page.goto(ORIGIN + "/estoque/movimentacoes")
            await page.get_by_label("Filtrar por tipo", exact=True).select_option("adjustment")
            await expect(page.get_by_role("row", name="Contagem sintética", exact=False)).to_contain_text("-0,2")
            await expect(page.get_by_role("row", name="Insumo sintético", exact=False)).to_have_count(1)
            await page.get_by_role("button", name="Necessidade de reposição").click()
            await expect(page.get_by_role("region", name="Materiais para reposição")).to_contain_text("Tinta sintética")

            for width, height in [(1366, 768), (1920, 1080), (390, 844)]:
                await page.set_viewport_size({"width": width, "height": height})
                await expect(page.get_by_role("heading", name="Movimentações", exact=True)).to_be_visible()
                table = page.get_by_role("region", name="Histórico de movimentações")
                box = await table.bounding_box()
                assert box and box["x"] >= 0 and box["x"] + box["width"] <= width + 1, box
                if evidence:
                    await page.screenshot(path=str(Path(evidence) / f"estoque-{width}x{height}.png"))
            assert not harness.external, harness.external
            assert not harness.page_errors, harness.page_errors
            await browser.close()
            harness.mark("Estoque integrado: cadastro, lançamento, ajuste, reposição, filtros e três tamanhos de tela")
    except Exception:
        for log in harness.logs:
            log.seek(0)
            print(log.read())
        raise
    finally:
        harness.cleanup()


if __name__ == "__main__":
    asyncio.run(run())
