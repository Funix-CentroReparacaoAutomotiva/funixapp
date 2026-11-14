"""FUNIX OS browser acceptance: real local API, Chromium, synthetic SQLite only.

Checks the actual issued-budget screen, explicit authorization, persisted OS,
network uncertainty, re-open and PDF viewer on desktop and narrow touch screens.
Never contacts production, Coda, WhatsApp or an external service.
"""
import asyncio
import hashlib
import json
import sqlite3
import subprocess
import traceback
from pathlib import Path

from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN

ARTIFACTS = ROOT / "docs/evidencias/os-browser"


async def case(browser, label: str, viewport: dict):
    h = Harness()
    ctx = None
    page = None
    marks = []
    try:
        h.check_ports()
        script = r"""
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {openDatabase} from './server/database.ts'
import {commercialFixture} from './server/tests/fixtures/commercial.ts'
import {BudgetRepository} from './server/tests/fixtures/budget-renderer.ts'
const db=openDatabase(process.argv[1])
const f=commercialFixture(db)
const original=f.atendimentos.update(f.at.id,{revision:f.at.revision,vehicle:'Veículo sintético',plate:'QAO1S01'})
// A second unselected service must never turn into authorized work.
const added=f.commercial.add(f.at.id,{pieceCodes:['alma_para_choque_dianteiro']})
const targetPiece=f.commercial.catalogs().items.find(c=>c.code==='alma_para_choque_dianteiro')
const extra=added.find(d=>d.pieceId===targetPiece?.id)
if(!extra)throw new Error('Missing synthetic secondary piece')
const omittedService=f.commercial.saveCatalog({kind:'servico',name:'NÃO EXECUTAR',status:'validado'})
const omittedDimension=f.commercial.saveCatalog({kind:'dimensao',name:'Dimensão não autorizada',serviceId:omittedService.id,status:'validado'})
f.commercial.updateDiagnosis(f.at.id,extra.id,{revision:extra.revision,services:[
 {serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1',enabled:true},
 {serviceId:omittedService.id,dimensionId:omittedDimension.id,quantity:'1',enabled:false,notes:'NÃO EXECUTAR'}
]})
const b=new BudgetRepository(db)
const request={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
const preview=b.preview(f.at.id,request)
if(!preview.canEmit)throw new Error('Synthetic budget not emittable: '+JSON.stringify(preview.snapshot.calculation.errors))
const emitted=await b.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:'synthetic-os-browser-v1'})
const excluded=emitted.snapshot.calculation.lines.filter(l=>!l.included)
if(!excluded.length)throw new Error('The fixture must contain excluded work')
writeFileSync(process.argv[2],JSON.stringify({
 at:f.at.id,version:emitted.id,budgetNumber:emitted.documentNumber,
 originalCustomer:original.name,originalVehicle:original.vehicle,
 sourceSnapshot:emitted.snapshot,excludedIds:excluded.map(l=>l.id),
 includedIds:emitted.snapshot.calculation.lines.filter(l=>l.included).map(l=>l.id),
 originalPdfSha:createHash('sha256').update(b.pdf(f.at.id,emitted.id)).digest('hex')
}))
db.close()
"""
        subprocess.run(
            ["node", "--input-type=module", "-e", script,
             str(h.folder / "atendimentos.sqlite"), str(h.folder / "ids.json")],
            cwd=ROOT, check=True, timeout=60
        )
        ids = json.loads((h.folder / "ids.json").read_text())
        base = "/api/atendimentos/" + ids["at"] + "/orcamentos/" + ids["version"]
        browse = "/atendimentos/" + ids["at"] + "?aba=diagnosticos&tela=orcamentos"
        await h.start_api()
        vite = h.start(
            ["node", "node_modules/vite/bin/vite.js", "preview",
             "--host", "127.0.0.1", "--port", "5173", "--strictPort"], "preview"
        )
        await h.ready(ORIGIN, vite)
        ctx = await browser.new_context(
            viewport=viewport, is_mobile=label != "desktop",
            has_touch=label != "desktop", accept_downloads=True
        )
        await h.watch(ctx)
        page = await ctx.new_page()
        await h.attach(page)

        def count_orders():
            with sqlite3.connect(h.folder / "atendimentos.sqlite") as db:
                return db.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]

        async def get(path):
            r = await ctx.request.get(ORIGIN + path)
            assert r.status == 200, (path, r.status, await r.text())
            return await r.json()

        def mark(message):
            marks.append(message)
            h.mark(label + ": " + message)

        async def shot(name):
            await page.screenshot(
                path=str(ARTIFACTS / (label + "-" + name + ".png")),
                animations="disabled"
            )

        await page.goto(ORIGIN + browse)
        await h.login(page)
        history = page.get_by_role("region", name="Orçamentos emitidos")
        await expect(history.locator(".budget-history-row")).to_have_count(1)
        await expect(history.get_by_role("button", name="Criar OS")).to_be_visible()
        await expect(history.get_by_role("button", name="Baixar orçamento " + ids["budgetNumber"])).to_be_visible()
        await shot("01-lista-antes")
        mark("lista de orçamento emitido mostra Criar OS antes da autorização")

        # The initial list button selects the frozen budget version; no OS is created.
        await history.get_by_role("button", name="Criar OS").click()
        await expect(page).to_have_url(__import__("re").compile(r"versao=" + ids["version"]))
        await expect(history.get_by_role("button", name="Criar OS")).to_be_enabled()
        assert count_orders() == 0
        mark("seleção da versão preserva orçamento e não cria OS implicitamente")

        # Dismissing the explicit browser confirmation must not create work.
        h.accept_dialogs = False
        before_posts = sum(x["method"] == "POST" and x["path"] == base + "/os" for x in h.api_requests)
        await history.get_by_role("button", name="Criar OS").click()
        assert count_orders() == 0
        assert sum(x["method"] == "POST" and x["path"] == base + "/os" for x in h.api_requests) == before_posts
        assert h.dialogs and "autorizado" in h.dialogs[-1].lower()
        h.accept_dialogs = True
        mark("cancelar confirmação não dispara criação nem persiste OS")

        # Exercise ordinary success at two sizes and response lost AFTER SQLite commit at 390px.
        if label == "mobile390":
            seen = []
            async def lost_response(route):
                if route.request.method == "POST":
                    seen.append(route.request.post_data_json)
                    result = await route.fetch()
                    assert result.status == 201, (result.status, await result.text())
                    await route.abort("failed")
                else:
                    await route.continue_()
            await page.route("**/orcamentos/*/os", lost_response)
            await history.get_by_role("button", name="Criar OS").click()
            await expect(history.get_by_role("alert")).to_contain_text("Não foi possível comunicar")
            await page.unroute("**/orcamentos/*/os", lost_response)
            assert len(seen) == 1 and seen[0] == {"authorized": True}
            assert count_orders() == 1
            await page.reload()
            await expect(history.get_by_role("link", name="Ver OS / Imprimir")).to_be_visible()
            mark("resposta perdida após commit recupera OS original sem duplicar")
        else:
            async with page.expect_response(
                lambda r: r.request.method == "POST" and r.url.endswith(base + "/os")
            ) as created:
                await history.get_by_role("button", name="Criar OS").click()
            assert (await created.value).status == 201
            await expect(history.get_by_role("link", name="Ver OS / Imprimir")).to_be_visible()
            assert count_orders() == 1
            mark("confirmação cria exatamente uma OS persistida")

        order = await get(base + "/os")
        assert order["number"] == "OS-000001"
        assert order["budgetVersionId"] == ids["version"]
        assert order["authorization"]["operatorId"] is None
        assert order["scope"]["customer"]["name"] == ids["originalCustomer"]
        assert order["scope"]["vehicle"]["plate"] == "QAO1S01"
        assert [x["id"] for x in order["scope"]["lines"]] == ids["includedIds"]
        assert not set(ids["excludedIds"]) & {x["id"] for x in order["scope"]["lines"]}
        scope_text = json.dumps(order["scope"], ensure_ascii=False)
        for forbidden in ['"unit"', '"total"', '"discount"', '"finalUnit"', '"installments"', '"energy"', '"manualPrice"', "NÃO EXECUTAR"]:
            assert forbidden not in scope_text, forbidden
        assert order["scope"]["lines"][0]["stages"][0]["name"] == "Etapa sintética"
        mark("escopo imutável coincide com snapshot emitido, exclui serviços desmarcados e dados financeiros")

        pdf = await ctx.request.get(ORIGIN + base + "/os/pdf")
        assert pdf.status == 200
        assert "application/pdf" in pdf.headers["content-type"]
        assert "inline" in pdf.headers["content-disposition"]
        pdf_bytes = await pdf.body()
        assert pdf_bytes.startswith(b"%PDF-1.7")
        assert b"%%EOF" in pdf_bytes[-1024:]
        assert len(pdf_bytes) > 500
        pdf_sha = hashlib.sha256(pdf_bytes).hexdigest()
        await shot("02-detalhe-os")
        async with page.expect_popup() as popup_event:
            await history.get_by_role("link", name="Ver OS / Imprimir").click()
        popup = await popup_event.value
        await popup.wait_for_url("**/os/pdf", timeout=12000)
        await popup.close()
        mark("botão Ver OS abre PDF operacional na guia de visualização/impressão")

        # Return to history through actual UI and observe the alternate action.
        await page.get_by_role("button", name="Voltar à tela anterior", exact=True).click()
        await expect(history.locator(".budget-history-row")).to_have_count(1)
        await expect(history.get_by_role("link", name="Ver OS")).to_be_visible()
        await expect(history.get_by_role("button", name="Criar OS")).to_have_count(0)
        await shot("03-lista-depois")
        assert count_orders() == 1
        mark("histórico troca Criar OS por Ver OS e impede segundo clique de criação")

        # Change live Atendimento via the real API; neither order nor historical PDF changes.
        record = await get("/api/atendimentos/" + ids["at"])
        changed = await ctx.request.patch(
            ORIGIN + "/api/atendimentos/" + ids["at"],
            headers={"Origin": ORIGIN},
            data={"revision": record["revision"], "name": "Cliente sintético alterado"}
        )
        assert changed.status == 200, await changed.text()
        await page.reload()
        await expect(history.get_by_role("link", name="Ver OS")).to_be_visible()
        again = await get(base + "/os")
        assert again == order
        pdf_again = await ctx.request.get(ORIGIN + base + "/os/pdf")
        assert hashlib.sha256(await pdf_again.body()).hexdigest() == pdf_sha
        source_pdf = await ctx.request.get(ORIGIN + base + "/pdf")
        assert hashlib.sha256(await source_pdf.body()).hexdigest() == ids["originalPdfSha"]
        assert count_orders() == 1
        mark("reabrir Atendimento e mudar cliente não altera OS nem PDF comercial histórico")

        assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
            viewport, await page.evaluate("({scroll:document.documentElement.scrollWidth,width:innerWidth})")
        )
        row = history.locator(".budget-history-row").first
        bounds = [await item.bounding_box() for item in [
            row.locator(".budget-history-open"),
            row.locator(".budget-history-download"),
            row.locator(".budget-history-order")
        ]]
        assert all(b and b["width"] > 0 for b in bounds), bounds
        assert bounds[0]["x"] + bounds[0]["width"] <= bounds[1]["x"] + 1, bounds
        assert bounds[1]["x"] + bounds[1]["width"] <= bounds[2]["x"] + 1, bounds
        assert not h.external and not h.page_errors, (h.external, h.page_errors)
        mark("layout sem rolagem horizontal nem colisão dos controles; sem erros JS ou tráfego externo")

    except Exception as exc:
        if page:
            try:
                await page.screenshot(path=str(ARTIFACTS / (label + "-failure.png")), timeout=3000)
            except Exception:
                pass
        h.results.append({"name": label + ": FAIL", "pass": False, "error": str(exc),
                          "traceback": traceback.format_exc()})
        raise
    finally:
        (ARTIFACTS / (label + "-resultados.json")).write_text(
            json.dumps({"synthetic": True, "viewport": viewport, "results": h.results,
                        "external": h.external, "pageErrors": h.page_errors}, ensure_ascii=False, indent=2) + "\n"
        )
        if ctx:
            await ctx.close()
        h.cleanup()


async def run():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/chromium",
                                          headless=True, args=["--no-sandbox"])
        try:
            for label, viewport in [
                ("desktop", {"width": 1440, "height": 1000}),
                ("mobile390", {"width": 390, "height": 844}),
                ("mobile320", {"width": 320, "height": 844})
            ]:
                await case(browser, label, viewport)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(run())
