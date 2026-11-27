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
    ("/oficina/patio", "Pátio"), ("/oficina/planejamento", "Planejamento da produção"),
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
import {commercialFixture} from './server/tests/fixtures/commercial.ts'
import {identifyForProduction,scheduleInput} from './server/tests/fixtures/production.ts'
import {BudgetRepository} from './server/tests/fixtures/budget-renderer.ts'
import {ProductionRepository} from './server/production.ts'
import {handleWorkshop} from './server/erp/workshop.ts'
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
const fixture=commercialFixture(db)
identifyForProduction(db,fixture.at.id)
const budgets=new BudgetRepository(db)
const input={scenarioId:fixture.scenario.id,negotiation:{mode:'none'}}
const version=await budgets.emit(fixture.at.id,{...input,previewToken:budgets.preview(fixture.at.id,input).token,idempotencyKey:randomUUID()})
const production=new ProductionRepository(db)
production.schedule(fixture.at.id,scheduleInput(db,fixture.at.id,[version.id]))
production.authorize(fixture.at.id,version.id,{confirmed:true})
const call=(path,body,query='')=>handleWorkshop({db,path,method:body?'POST':'GET',query:new URLSearchParams(query),body,now:()=>Date.now()})
const source=call('/planning').sources[0]
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const monday=new Date(Date.parse(today+'T00:00:00Z')-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)*86400000).toISOString().slice(0,10)
const wednesday=new Date(Date.parse(monday)+2*86400000).toISOString().slice(0,10)
call('/planning/setup',{action:'mapping',stageId:source.stageId,phase:'preparation'})
call('/planning/setup',{action:'resource',id:'resource',name:'Preparação QA',dailyEnergy:'4',exclusive:false})
call('/planning/segment',{sourceId:source.id,resourceId:'resource',start:monday,end:wednesday,priority:100,revision:0})
db.close()
"""], "seed-erp")
        assert await asyncio.to_thread(seed.wait, 12) == 0
        vite = harness.start(["node", "node_modules/vite/bin/vite.js", "--port", "5173", "--strictPort"], "vite")
        await harness.ready(ORIGIN, vite)
        async with async_playwright() as playwright:
            options = {"args": ["--no-sandbox"], "headless": True}
            if os.environ.get("FUNIX_CHROMIUM"):
                options["executable_path"] = os.environ["FUNIX_CHROMIUM"]
            elif Path("/usr/bin/chromium").exists():
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
            assert len(yard["vehicles"]) == 16
            vehicle = next(v for v in yard["vehicles"] if v["plate"] == "QAQ1A00")
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
                    if path == "/oficina/planejamento":
                        dates = page.locator(".planning-dates .workshop-grid-date")
                        await expect(dates).to_have_count(5)
                        await expect(page.locator(".planning-timeline .workshop-segment")).to_have_count(1)
                        loads = page.locator(".planning-capacity-row .workshop-load")
                        await expect(loads).to_have_count(5)
                        for idx in range(5):
                            day_box = await dates.nth(idx).bounding_box()
                            load_box = await loads.nth(idx).bounding_box()
                            assert abs(day_box["x"] - load_box["x"]) <= 2, (day_box, load_box)
                        await expect(loads.first).to_have_attribute("data-load", "over")
                        await page.locator(".planning-timeline .workshop-segment").click()
                        await expect(page.get_by_role("button", name="Salvar programação")).to_be_visible()
                        await page.get_by_role("button", name="Fechar detalhes").click()
                    assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), path
                    if evidence:
                        await page.screenshot(path=str(evidence / f"{path.strip('/').replace('/', '-')}-{width}.png"))
                harness.mark("Rotas ERP e layout adaptável", width=width, height=height)

            await page.goto(ORIGIN + "/atendimentos/" + vehicle["atendimentoId"])
            await page.get_by_role("button", name="Dados", exact=True).click()
            await expect(page.get_by_role("heading", name="Comentários", exact=True)).to_be_visible()
            await expect(page.get_by_role("button", name="Diário", exact=True)).to_have_count(0)
            await expect(page.locator(".sales-comments")).not_to_contain_text("Impedimento sintético")
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
