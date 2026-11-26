"""Validate the integrated ERP with a synthetic SQLite database and Chromium."""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

from playwright.async_api import async_playwright, expect

from m1_atendimentos import Harness, ORIGIN

ROUTES = [
    ("/tarefas/painel", "Painel de tarefas"), ("/tarefas/catalogo", "Catálogo de tarefas"),
    ("/vendas/funil", "Funil de vendas"), ("/vendas/desempenho", "Desempenho"),
    ("/vendas/acompanhamento", "Acompanhamento de veículos"),
    ("/oficina/patio", "Pátio"), ("/oficina/planejamento", "Planejamento"),
    ("/estoque/insumos", "Insumos"), ("/estoque/tintas", "Tintas"), ("/estoque/movimentacoes", "Movimentações"),
    ("/financeiro/contas-a-receber", "Contas a receber"), ("/financeiro/contas-a-pagar", "Contas a pagar"),
    ("/financeiro/fluxo-de-caixa", "Fluxo de caixa"),
    ("/biblioteca/historico", "Histórico de experiências"), ("/gestao/sac", "SAC"),
]


async def run():
    harness = Harness()
    destination = os.environ.get("FUNIX_ERP_EVIDENCE")
    evidence = Path(destination) if destination else None
    if evidence:
        evidence.mkdir(parents=True, exist_ok=True)
    try:
        harness.check_ports()
        await harness.start_api()
        seed = harness.start(["node", "--input-type=module", "-e", """
import {randomUUID} from 'node:crypto'
import {openDatabase} from './server/database.ts'
import {AtendimentoRepository} from './server/atendimentos.ts'
const db = openDatabase(process.env.FUNIX_DATABASE_PATH)
const repo = new AtendimentoRepository(db)
const insert = db.prepare(`INSERT INTO production_experiences
  (id, atendimento_id, customer_json, vehicle_json, payer_json, scheduled_entry, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
const timestamp = new Date().toISOString()
for (let i = 0; i < 15; i++) {
  const name = 'Cliente sintético ' + i
  const model = 'Modelo QA ' + i
  const at = repo.create({name, vehicle: model, model, plate:'QAQ1A' + String(i).padStart(2,'0')})
  const ref = text => JSON.stringify({id:null, text})
  insert.run(randomUUID(), at.id, ref(name), ref(model), ref(name), timestamp.slice(0,10), timestamp, timestamp)
}
db.close()
"""], "seed-erp")
        assert await asyncio.to_thread(seed.wait, 12) == 0
        vite = harness.start(["node", "node_modules/vite/bin/vite.js", "--port", "5173", "--strictPort"], "vite")
        await harness.ready(ORIGIN, vite)
        async with async_playwright() as playwright:
            options = {"args": ["--no-sandbox"], "headless": True}
            if Path("/usr/bin/chromium").exists():
                options["executable_path"] = "/usr/bin/chromium"
            browser = await playwright.chromium.launch(**options)
            context = await browser.new_context(viewport={"width": 1366, "height": 768})
            await harness.watch(context)
            page = await context.new_page()
            await harness.attach(page)
            errors = []
            page.on("response", lambda response: errors.append((response.status, response.url))
                    if response.status >= 400 and "/api/erp/" in response.url else None)
            await page.goto(ORIGIN + "/oficina/patio")
            await harness.login(page)
            yard_url = ORIGIN + "/api/erp/workshop/yard"
            yard = await (await context.request.get(yard_url)).json()
            assert len(yard["vehicles"]) == 15
            vehicle = yard["vehicles"][0]
            for action, extra in [
                ("entry", {}), ("block", {"note": "Impedimento sintético"}),
                ("unblock", {"note": "Impedimento resolvido"}),
                ("phase", {"phase": "finished", "note": "Salto sintético justificado"}), ("departure", {}),
            ]:
                payload = {"experienceId": vehicle["experienceId"], "requestId": str(uuid4()),
                           "revision": vehicle["revision"], "action": action, "operator": "QA sintético", **extra}
                response = await context.request.post(ORIGIN + "/api/erp/workshop/movement",
                                                      headers={"Origin": ORIGIN}, data=payload)
                assert response.ok, await response.text()
                vehicle = await response.json()
            assert vehicle["phase"] == "departed" and not vehicle["present"] and not vehicle["commercialClosedAt"]

            for width, height in [(1366, 768), (1920, 1080), (390, 844)]:
                await page.set_viewport_size({"width": width, "height": height})
                for path, name in ROUTES:
                    await page.goto(ORIGIN + path)
                    await expect(page.get_by_role("heading", name=name, exact=True).first).to_be_visible()
                    await page.wait_for_load_state("networkidle")
                    if path == "/oficina/patio":
                        await expect(page.locator(".workshop-lane")).to_have_count(12)
                        await expect(page.get_by_role("button", name="Ver mais", exact=False).filter(visible=True).first).to_have_count(1)
                    assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), path
                    if evidence:
                        await page.screenshot(path=str(evidence / f"{path.strip('/').replace('/', '-')}-{width}.png"))
                harness.mark("Rotas ERP e layout adaptável", width=width, height=height)

            await page.goto(ORIGIN + "/atendimentos/" + vehicle["atendimentoId"])
            await page.get_by_role("button", name="Diário", exact=True).click()
            dialog = page.get_by_role("dialog", name="Diário da Experiência")
            await expect(dialog).to_contain_text("Impedimento sintético")
            await dialog.get_by_role("button", name="Fechar Diário").click()
            assert not errors, errors
            assert not harness.external and not harness.page_errors, (harness.external, harness.page_errors)
            await browser.close()
            harness.mark("Agendamento, Pátio, saída e Diário consultam a mesma Experiência")
    except Exception:
        for log in harness.logs:
            log.seek(0)
            print(log.read()[-3000:])
        raise
    finally:
        harness.cleanup()


if __name__ == "__main__":
    asyncio.run(run())
