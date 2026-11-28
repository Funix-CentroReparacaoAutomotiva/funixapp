"""Synthetic acquisition flow through the same API and three ERP views."""
import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ORIGIN


async def run():
    harness = Harness()
    try:
        harness.check_ports()
        await harness.start_api()
        seed = harness.start(["node", "--input-type=module", "-e", """
import {randomUUID} from 'node:crypto'
import {openDatabase} from './server/database.ts'
import {commercialFixture} from './server/tests/fixtures/commercial.ts'
import {identifyForProduction,scheduleInput} from './server/tests/fixtures/production.ts'
import {BudgetRepository} from './server/tests/fixtures/budget-renderer.ts'
import {ComponentRepository} from './server/components.ts'
import {ProductionRepository} from './server/production.ts'
const db=openDatabase(process.env.FUNIX_DATABASE_PATH)
const f=commercialFixture(db)
new ComponentRepository(db).save(f.at.id,{pieceId:f.item.id,name:'Farol sintético QA',quantity:'1',manualPrice:'20',notes:''})
identifyForProduction(db,f.at.id)
const budgets=new BudgetRepository(db), production=new ProductionRepository(db)
const input={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
const version=await budgets.emit(f.at.id,{...input,previewToken:budgets.preview(f.at.id,input).token,idempotencyKey:randomUUID()})
production.schedule(f.at.id,scheduleInput(db,f.at.id,[version.id]))
production.authorize(f.at.id,version.id,{confirmed:true})
db.close()
"""], "seed-acquisition")
        assert await asyncio.to_thread(seed.wait, 12) == 0
        vite = harness.start(["node", "node_modules/vite/bin/vite.js", "--port", "5173", "--strictPort"], "vite")
        await harness.ready(ORIGIN, vite)
        async with async_playwright() as playwright:
            options={"headless":True,"args":["--no-sandbox"]}
            if os.environ.get("FUNIX_CHROMIUM"):
                options["executable_path"]=os.environ["FUNIX_CHROMIUM"]
            browser=await playwright.chromium.launch(**options)
            context=await browser.new_context(viewport={"width":390,"height":844},locale="pt-BR")
            await harness.watch(context)
            page=await context.new_page()
            await harness.attach(page)
            await page.goto(ORIGIN+"/estoque/componentes")
            await harness.login(page)
            row=page.locator(".acquisition-list>li").filter(has_text="Farol sintético QA")
            await expect(row).to_contain_text("A1")
            await expect(row).to_contain_text("Identificado")
            await row.get_by_role("button",name="Atualizar aquisição").click()
            await row.get_by_label("Origem",exact=True).select_option("Seguradora")
            await row.get_by_label("Status",exact=True).select_option("requested")
            await row.get_by_role("button",name="Confirmar",exact=True).click()
            await expect(row).to_contain_text("Solicitado")
            await row.get_by_role("button",name="Atualizar aquisição").click()
            await row.get_by_label("Status",exact=True).select_option("approved")
            await row.get_by_role("button",name="Confirmar",exact=True).click()
            await expect(row).to_contain_text("Aprovado")
            await row.get_by_role("button",name="Registrar recebimento").click()
            await expect(row).to_contain_text("Recebido")
            await expect(row).to_contain_text("Armazenado")
            for width in (320,390,1366):
                await page.set_viewport_size({"width":width,"height":844})
                rect=await row.bounding_box()
                assert rect and rect["x"]>=0 and rect["x"]+rect["width"]<=width+1, rect
                assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
                if os.environ.get("FUNIX_ERP_ACQUISITION_EVIDENCE"):
                    folder=Path(os.environ["FUNIX_ERP_ACQUISITION_EVIDENCE"])
                    folder.mkdir(parents=True,exist_ok=True)
                    await page.screenshot(path=str(folder/f"componentes-{width}.png"))
            await row.get_by_role("button",name="Registrar saída").click()
            await expect(row).to_contain_text("Saiu")
            await expect(row).to_contain_text("Recebido")
            await page.get_by_label("Situação física").select_option("stored")
            await expect(row).to_have_count(0)
            await page.get_by_label("Situação física").select_option("out")
            await expect(row).to_contain_text("Saiu")
            data=await (await context.request.get(ORIGIN+"/api/erp/acquisition/items")).json()
            item=data["items"][0]
            await page.goto(ORIGIN+"/atendimentos/"+item["atendimentoId"]+"?tela=experiencia")
            await expect(page.locator(".acquisition-list>li").filter(has_text="Farol sintético QA")).to_contain_text("Recebido")
            await page.goto(ORIGIN+"/oficina/patio")
            await page.get_by_role("button",name="QA-000",exact=False).first.click()
            await expect(page.locator(".acquisition-list>li").filter(has_text="Farol sintético QA")).to_contain_text("Recebido")
            assert not harness.external and not harness.page_errors,(harness.external,harness.page_errors)
            await browser.close()
            harness.mark("Componentes: aquisição, recebimento, saída, sincronização das três visões e 320/390/1366px")
    except Exception:
        for log in harness.logs:
            log.seek(0)
            print(log.read()[-3000:])
        raise
    finally:
        harness.cleanup()


if __name__=="__main__":
    asyncio.run(run())
