"""FUNIX OS browser acceptance: real local API, Chromium, synthetic SQLite only.

Checks the actual issued-budget screen, explicit authorization, persisted OS,
network uncertainty, re-open and PDF viewer on desktop and narrow touch screens.
Never contacts production, Coda, WhatsApp or an external service.
"""
import asyncio
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import traceback
from pathlib import Path

import fitz
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN
from document_button_colors import color_case

ARTIFACTS = Path(os.environ.get("FUNIX_OS_BROWSER_ARTIFACTS", ROOT / "docs/evidencias/os-browser"))


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
import {identifyForProduction} from './server/tests/fixtures/production.ts'
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
const rejected=await b.emit(f.at.id,{...request,previewToken:b.preview(f.at.id,request).token,idempotencyKey:'synthetic-os-browser-rejection'})
identifyForProduction(db,f.at.id)
const excluded=emitted.snapshot.calculation.lines.filter(l=>!l.included)
if(!excluded.length)throw new Error('The fixture must contain excluded work')
writeFileSync(process.argv[2],JSON.stringify({
 at:f.at.id,version:emitted.id,budgetNumber:emitted.documentNumber,rejectedNumber:rejected.documentNumber,
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
            has_touch=label != "desktop", accept_downloads=True,
            locale="pt-BR", timezone_id="America/Sao_Paulo"
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
        order_row = history.locator(".budget-history-row").filter(
            has=page.get_by_role("link", name="Visualizar orçamento " + ids["budgetNumber"])
        )
        await expect(history.locator(".budget-history-row")).to_have_count(2)
        await expect(order_row.get_by_role("button", name="OS ainda não emitida")).to_be_disabled()
        await expect(order_row.locator(".budget-action-or")).to_have_class(re.compile("budget-action-issued"))
        original_url = page.url
        assert count_orders() == 0
        await history.get_by_role("button", name="Agendar", exact=True).click()
        production = page.get_by_role("region", name="Experiência do Atendimento")
        await production.get_by_role("button", name="Agendar Atendimento").click()
        schedule = production.get_by_role("form", name="Agendamento")
        for field in ["Cliente", "Veículo", "Pagador"]:
            await expect(schedule.get_by_role("combobox", name=field, exact=True)).to_have_count(0)
        await schedule.get_by_label("Data da entrada", exact=True).fill("2026-11-20")
        if label != "mobile390":
            await schedule.get_by_label("Horário da entrada", exact=False).fill("10:30")
        if label != "mobile390":
            await schedule.get_by_label("Entrega combinada", exact=False).fill("2026-12-02")
        await expect(schedule.get_by_role("button", name="Confirmar agendamento")).to_be_disabled()
        for number in [ids["budgetNumber"], ids["rejectedNumber"]]:
            await schedule.get_by_role("checkbox", name=re.compile(number)).check()
        assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert await schedule.evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        await shot("01-agendamento")
        await schedule.get_by_role("button", name="Confirmar agendamento").click()
        await expect(production.get_by_text("Agendamento confirmado.")).to_be_visible()
        overview_path = "/api/atendimentos/" + ids["at"] + "/experiencia"
        experience = (await get(overview_path))["experience"]
        experience_id = experience["id"]
        expected_entry = "2026-11-20" if label == "mobile390" else "2026-11-20T10:30"
        assert experience["scheduledEntry"] == expected_entry
        assert count_orders() == 0
        mark("agendamento cadastra uma Experiência e consente duas versões sem emitir OS")

        await production.get_by_role("button", name="Reagendar ou incluir orçamentos").click()
        await schedule.get_by_label("Data da entrada", exact=True).fill("2026-11-21")
        await schedule.get_by_label("Horário da entrada", exact=False).fill("11:30")
        await schedule.get_by_role("button", name="Confirmar agendamento").click()
        await expect(production.get_by_text("21/11/2026 às 11:30")).to_be_visible()
        assert (await get(overview_path))["experience"]["id"] == experience_id
        assert count_orders() == 0
        mark("reagendamento atualiza a mesma Experiência")

        def budget_card(number):
            return production.locator(".production-budget").filter(
                has=page.get_by_role("button", name=number, exact=True)
            )

        rejected = budget_card(ids["rejectedNumber"])
        await rejected.get_by_role("button", name="Rejeitar tecnicamente").click()
        await rejected.get_by_label("Motivo da rejeição técnica").fill("Escopo sintético inviável")
        await rejected.get_by_role("button", name="Confirmar rejeição").click()
        await expect(rejected.get_by_text("Rejeitado", exact=True)).to_be_visible()
        assert count_orders() == 0
        mark("rejeição técnica exige motivo e não gera OS")

        authorized = budget_card(ids["budgetNumber"])
        authorize = authorized.get_by_role("button", name="Autorizar e gerar OS")
        h.accept_dialogs = True
        if label == "mobile390":
            seen = []
            async def lost_response(route):
                seen.append(route.request.post_data_json)
                result = await route.fetch()
                assert result.status == 200, (result.status, await result.text())
                await route.abort("failed")
            await page.route("**/orcamentos/*/autorizacao-tecnica", lost_response)
            await authorize.click()
            await expect(production.get_by_role("alert")).to_contain_text("Não foi possível comunicar")
            await page.unroute("**/orcamentos/*/autorizacao-tecnica", lost_response)
            assert seen == [{"confirmed": True}]
            assert count_orders() == 1
            await authorize.click()
            mark("reenvio após resposta perdida retorna a OS do primeiro commit")
        else:
            await authorize.click()
        await expect(authorized.get_by_role("button", name="Consultar OS-000001")).to_be_visible()
        await expect(authorized.get_by_text("Autorizado", exact=True)).to_be_visible()
        assert count_orders() == 1
        assert await production.evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        await shot("01b-experiencia")
        await authorized.get_by_role("button", name="Consultar OS-000001").click()
        await expect(history.get_by_role("link", name="Visualizar OS", exact=True)).to_be_visible()
        await page.goto(original_url)
        await expect(order_row.locator(".budget-action-os")).to_have_class(re.compile("budget-action-issued"))
        mark("autorização técnica emite uma OS vinculada e permite consultá-la")
        order = await get(base + "/os")
        assert order["number"] == "OS-000001"
        assert order["experienceId"] == experience_id
        expected_date = None if label == "mobile390" else "2026-12-02"
        assert order["scope"]["deliveryDate"] == expected_date
        assert (await get("/api/atendimentos/" + ids["at"])).get("deliveryDate") == expected_date
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

        await history.get_by_role("button", name="Agendar", exact=True).click()
        in_operation = production.get_by_role("checkbox", name="Em operação", exact=True)
        await expect(in_operation).not_to_be_checked()
        async with page.expect_response(lambda r: r.url.endswith("/experiencia/operacao")) as switched_on:
            await in_operation.click()
        assert (await switched_on.value).status == 200
        await expect(in_operation).to_be_checked()
        await page.goto(ORIGIN + "/operacao")
        await expect(page.get_by_role("heading", name="Em operação", exact=True)).to_be_visible()
        operation_link = page.get_by_role("link", name=re.compile("Veículo sintético"))
        await expect(operation_link).to_be_visible()
        assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        await operation_link.click()
        await expect(in_operation).to_be_checked()
        await expect(production.get_by_role("button", name="Gerar título do restante")).to_be_visible()
        await page.goto(ORIGIN + "/financeiro?nova=receber&experiencia=" + experience_id)
        await expect(page.get_by_label("Experiência (opcional)")).to_have_value(experience_id)
        await expect(page.get_by_label("Contraparte")).to_have_value("Pagador sintético")
        await page.get_by_label("Descrição", exact=True).fill("Reparo sintético")
        await page.get_by_label("Valor (R$)", exact=True).fill("175,49")
        await page.get_by_label("Vencimento", exact=True).fill("2020-01-01")
        await page.get_by_role("button", name="Lançar título").click()
        receivable = page.locator(".fin-title").filter(has=page.get_by_role("heading", name="Reparo sintético"))
        await expect(receivable.get_by_text("Vencido", exact=True)).to_be_visible()
        await receivable.get_by_role("button", name="Registrar recebimento").click()
        await expect(receivable.get_by_label("Valor da baixa (R$)")).to_have_value("175,49")
        today = await page.evaluate("new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date())")
        await expect(receivable.get_by_label("Data da baixa")).to_have_value(today)
        await receivable.get_by_label("Valor da baixa (R$)").fill("25,49")
        await receivable.get_by_label("Forma de pagamento").select_option("pix")
        await receivable.get_by_role("button", name="Confirmar baixa").click()
        await expect(receivable.locator(".fin-value strong")).to_have_text("R$ 150,00 pendente")
        await receivable.get_by_role("button", name="Registrar recebimento").click()
        await expect(receivable.get_by_label("Valor da baixa (R$)")).to_have_value("150,00")
        await receivable.get_by_label("Forma de pagamento").select_option("pix")
        await receivable.get_by_role("button", name="Confirmar baixa").click()
        await expect(receivable.get_by_text("Quitado", exact=True)).to_be_visible()
        await receivable.get_by_text("Histórico de baixas (2)", exact=True).click()
        partial = receivable.locator(".fin-history-item").filter(has_text="25,49")
        await partial.get_by_role("button", name="Desfazer baixa").click()
        await expect(partial.get_by_text(re.compile("Desfeita"))).to_be_visible()

        await page.goto(ORIGIN + "/financeiro")
        await page.get_by_role("button", name="+ Novo título").click()
        expense_form = page.locator(".fin-form").filter(has=page.get_by_role("heading", name="Novo título"))
        await expense_form.get_by_label("Tipo").select_option("payable")
        await expect(expense_form.get_by_label("Experiência (opcional)")).to_have_value("")
        await expense_form.get_by_label("Contraparte").fill("Fornecedor sintético")
        await expense_form.get_by_label("Descrição").fill("Despesa sintética avulsa")
        await expense_form.get_by_label("Valor (R$)").fill("77,33")
        await expense_form.get_by_role("button", name="Lançar título").click()
        payable = page.locator(".fin-title").filter(has=page.get_by_role("heading", name="Despesa sintética avulsa"))
        await payable.get_by_role("button", name="Registrar pagamento").click()
        await expect(payable.get_by_label("Valor da baixa (R$)")).to_have_value("77,33")
        await payable.get_by_label("Forma de pagamento").select_option("pix")
        await payable.get_by_role("button", name="Confirmar baixa").click()
        await expect(payable.get_by_text("Quitado", exact=True)).to_be_visible()
        await page.goto(ORIGIN + "/financeiro")
        await expect(receivable.locator(".fin-value strong")).to_have_text("R$ 25,49 pendente")
        await expect(payable.get_by_text("Quitado", exact=True)).to_be_visible()
        open_totals = page.get_by_role("region", name="Valores em aberto")
        await expect(open_totals.get_by_text("R$ 25,49", exact=True)).to_be_visible()
        movements = page.get_by_role("region", name="Movimentações registradas")
        await expect(movements.locator(".fin-metric").filter(has_text="Recebimentos")).to_contain_text("R$ 150,00")
        await expect(movements.locator(".fin-metric").filter(has_text="Pagamentos")).to_contain_text("R$ 77,33")
        recorded = await get("/api/financeiro")
        by_kind = {title["kind"]: title for title in recorded["titles"]}
        assert by_kind["receivable"]["experienceId"] == experience_id
        assert by_kind["receivable"]["balanceCents"] == 2549
        assert by_kind["payable"]["experienceId"] is None and by_kind["payable"]["balanceCents"] == 0
        tabs = page.get_by_role("navigation", name="Páginas de Financeiro")
        assert await tabs.get_by_role("link").evaluate_all(
            "buttons => buttons.every(button => button.scrollWidth <= button.clientWidth + 1)"
        )
        assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        await shot("01c-financeiro")
        mark("XP abre recebível preenchido, baixas parciais e estorno persistem, despesa avulsa pode ser quitada")

        await page.goto(ORIGIN + "/operacao")
        await operation_link.click()
        await expect(in_operation).to_be_checked()
        async with page.expect_response(lambda r: r.url.endswith("/experiencia/operacao")) as switched_off:
            await in_operation.click()
        assert (await switched_off.value).status == 200
        await page.goto(ORIGIN + "/operacao")
        await expect(page.get_by_role("heading", name="Agendados", exact=True)).to_be_visible()
        await expect(page.get_by_role("heading", name="Em operação", exact=True)).to_have_count(0)
        await expect(operation_link).to_be_visible()
        await page.goto(original_url)
        mark("operação aparece na lista global, persiste ao reabrir e pode ser desmarcada")

        pdf = await ctx.request.get(ORIGIN + base + "/os/pdf")
        assert pdf.status == 200
        assert "application/pdf" in pdf.headers["content-type"]
        assert "inline" in pdf.headers["content-disposition"]
        pdf_bytes = await pdf.body()
        assert pdf_bytes.startswith(b"%PDF-1.7")
        assert b"%%EOF" in pdf_bytes[-1024:]
        assert len(pdf_bytes) > 500
        pdf_sha = hashlib.sha256(pdf_bytes).hexdigest()
        # Preserve one real output for A4 render review, without embedding a fixture in git.
        if label == "desktop":
            (ARTIFACTS / "os-sintetica-a4.pdf").write_bytes(pdf_bytes)
            (ARTIFACTS / "os-sintetica-escopo.json").write_text(
                json.dumps(order, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8"
            )
        await shot("02-detalhe-os")
        async with page.expect_popup() as popup_event:
            await history.get_by_role("link", name="Visualizar OS-000001").click()
        popup = await popup_event.value
        await popup.wait_for_url("**/os/pdf", timeout=12000)
        await popup.close()
        mark("botão Ver OS abre PDF operacional na guia de visualização/impressão")

        # The commercial history links the approved OS without restoring direct creation.
        await expect(page).to_have_url(original_url)
        await expect(history.locator(".budget-history-row")).to_have_count(2)
        await expect(history.get_by_role("link", name="Visualizar OS-000001")).to_be_visible()
        await expect(history.get_by_role("button", name="Criar OS")).to_have_count(0)
        await shot("03-lista-depois")
        assert count_orders() == 1
        mark("lista oferece a visualização da OS após autorização técnica")

        # Change live Atendimento via the real API; neither order nor historical PDF changes.
        record = await get("/api/atendimentos/" + ids["at"])
        changed = await ctx.request.patch(
            ORIGIN + "/api/atendimentos/" + ids["at"],
            headers={"Origin": ORIGIN},
            data={"revision": record["revision"], "name": "Cliente sintético alterado"}
        )
        assert changed.status == 200, await changed.text()
        await page.reload()
        await expect(history.get_by_role("link", name="Visualizar OS-000001")).to_be_visible()
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
        row = order_row
        controls = [
            row.locator(".budget-history-open"),
            row.locator(".budget-action-or"),
            row.locator(".budget-action-os"),
            row.locator(".budget-action-cancel")
        ]
        bounds = [await item.bounding_box() for item in controls]
        assert all(b and b["width"] > 0 and b["height"] > 0 for b in bounds), bounds
        # On 320px the action group wraps below the document identity.
        for i, a in enumerate(bounds):
            assert a["x"] >= 0 and a["x"] + a["width"] <= viewport["width"] + 1, (i, a, viewport)
            for b in bounds[i + 1:]:
                overlap_x = min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"])
                overlap_y = min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"])
                assert overlap_x <= 1 or overlap_y <= 1, (a, b)
        assert not h.external and not h.page_errors, (h.external, h.page_errors)
        mark("layout sem rolagem horizontal nem colisão dos controles; sem erros JS ou tráfego externo")

        # Full revision workflow using the actual scheduling and issuance UI.
        at_url = "/api/atendimentos/" + ids["at"]

        async def change_delivery_in_schedule(value):
            current = await get(at_url)
            await page.goto(ORIGIN + browse)
            await history.get_by_role("button", name="Agendar", exact=True).click()
            await production.get_by_role("button", name="Reagendar ou incluir orçamentos").click()
            date_input = schedule.get_by_label("Entrega combinada (opcional)")
            await expect(date_input).to_have_value(current.get("deliveryDate") or "")
            await date_input.fill(value)
            async with page.expect_response(
                lambda r: r.request.method == "POST" and r.url.endswith(at_url + "/agendamento")
            ) as saved:
                await schedule.get_by_role("button", name="Confirmar agendamento").click()
            response = await saved.value
            assert response.status == 200, await response.text()
            assert (await response.json()).get("deliveryDate") == (value or None)
            assert (await get(at_url)).get("deliveryDate") == (value or None)
            await page.goto(ORIGIN + browse)
            await expect(history.get_by_text("OS: reemissão necessária", exact=True)).to_be_visible()
            await history.get_by_role("button", name="Consultar OS desatualizada").click()
            await expect(history.get_by_role("button", name="Emitir nova revisão")).to_be_enabled()
            await expect(history.get_by_role("link", name="Visualizar emissão anterior (desatualizada)")).to_be_visible()

        def pdf_text(data):
            with fitz.open(stream=data, filetype="pdf") as document:
                return " ".join(p.get_text() for p in document)

        if expected_date:
            assert "02/12/2026" in pdf_text(pdf_bytes)
        else:
            assert "02/12/2026" not in pdf_text(pdf_bytes)
        assert "R01" in pdf_text(pdf_bytes)

        await change_delivery_in_schedule("2026-12-08")
        await shot("04-reemissao-necessaria")
        async with page.expect_response(
            lambda r: r.request.method == "POST" and r.url.endswith(base + "/os/revisoes")
        ) as r2_result:
            await history.get_by_role("button", name="Emitir nova revisão").click()
        r2_response = await r2_result.value
        assert r2_response.status == 201, await r2_response.text()
        r2 = await r2_response.json()
        assert r2["id"] == order["id"] and r2["revision"] == 2
        assert r2["scope"] == {**order["scope"], "deliveryDate": "2026-12-08"}
        await expect(history.get_by_role("button", name="Emitir nova revisão")).to_have_count(0)
        await expect(history.get_by_role("link", name="Visualizar OS", exact=True)).to_have_attribute("href", base + "/os/revisoes/2/pdf")
        await history.get_by_text("Histórico de emissões da OS", exact=True).click()
        await expect(history.get_by_role("link", name=re.compile("^R01"))).to_be_visible()
        await expect(history.get_by_role("link", name=re.compile("^R02"))).to_be_visible()
        await expect(history.get_by_text("Substituída", exact=False)).to_be_visible()
        await shot("05-historico-r02")
        r2_pdf = await ctx.request.get(ORIGIN + base + "/os/revisoes/2/pdf")
        assert r2_pdf.status == 200
        r2_bytes = await r2_pdf.body()
        assert "08/12/2026" in pdf_text(r2_bytes) and "R02" in pdf_text(r2_bytes)
        assert hashlib.sha256(await (await ctx.request.get(ORIGIN + base + "/os/pdf")).body()).hexdigest() == pdf_sha
        assert (await get(base + "/os")) == order
        mark("alterar previsão pela interface exige reemissão; R02 congela nova data e R01 mantém mesmos bytes")

        await change_delivery_in_schedule("")
        async with page.expect_response(
            lambda r: r.request.method == "POST" and r.url.endswith(base + "/os/revisoes")
        ) as r3_result:
            await history.get_by_role("button", name="Emitir nova revisão").click()
            rev_dialog = page.get_by_role("dialog", name="Emitir nova revisão da OS")
            await expect(rev_dialog).to_be_visible()
            await expect(rev_dialog.get_by_role("button", name="Emitir com data")).to_be_disabled()
            await rev_dialog.get_by_role("button", name="Emitir sem data").click()
        r3_response = await r3_result.value
        assert r3_response.status == 201, await r3_response.text()
        r3 = await r3_response.json()
        assert r3["revision"] == 3 and r3["id"] == order["id"]
        assert r3["scope"] == {**order["scope"], "deliveryDate": None}
        await expect(history.get_by_role("button", name="Emitir nova revisão")).to_have_count(0)
        await history.get_by_text("Histórico de emissões da OS", exact=True).click()
        await expect(history.get_by_role("link", name=re.compile("^R03"))).to_be_visible()
        await shot("06-historico-r03")
        r3_pdf = await ctx.request.get(ORIGIN + base + "/os/revisoes/3/pdf")
        assert r3_pdf.status == 200
        r3_bytes = await r3_pdf.body()
        assert "R03" in pdf_text(r3_bytes)
        assert "08/12/2026" not in pdf_text(r3_bytes) and "02/12/2026" not in pdf_text(r3_bytes)
        assert (await (await ctx.request.get(ORIGIN + base + "/os/revisoes/2/pdf")).body()) == r2_bytes
        assert (await (await ctx.request.get(ORIGIN + base + "/os/pdf")).body()) == pdf_bytes
        assert [item.get("revision", 1) for item in await get(base + "/os/revisoes")] == [3, 2, 1]
        assert hashlib.sha256(await (await ctx.request.get(ORIGIN + base + "/pdf")).body()).hexdigest() == ids["originalPdfSha"]
        assert count_orders() == 1
        if label == "desktop":
            (ARTIFACTS / "os-sintetica-r02.pdf").write_bytes(r2_bytes)
            (ARTIFACTS / "os-sintetica-r03.pdf").write_bytes(r3_bytes)
        await page.goto(ORIGIN + browse)
        await expect(history.get_by_role("link", name="Visualizar OS-000001")).to_have_attribute("href", base + "/os/revisoes/3/pdf")
        assert not h.external and not h.page_errors, (h.external, h.page_errors)
        mark("limpar previsão permite R03 sem data; histórico R01/R02 preservado, uma única OS e orçamento intacto")

        # Cancel after all immutable-document checks; do not depend on external jsreport.
        async with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith(base + "/cancelamento")) as cancelled_response:
            await order_row.get_by_role("button", name="Cancelar orçamento e OS").click()
        assert (await cancelled_response.value).status == 200
        await expect(order_row).to_have_class(re.compile("is-cancelled"))
        await expect(order_row.locator(".budget-action-or")).to_have_class(re.compile("budget-action-cancelled"))
        await expect(order_row.locator(".budget-action-os")).to_have_class(re.compile("budget-action-cancelled"))
        assert (await get(base + "/os"))["cancellation"]["reason"] == "Cancelamento sem motivo informado"
        assert all(item.get("cancellation") for item in await get(base + "/os/revisoes"))
        await page.reload()
        await expect(order_row).to_have_class(re.compile("is-cancelled"))
        await expect(order_row.locator(".budget-action-or")).to_have_class(re.compile("budget-action-cancelled"))
        await expect(order_row.locator(".budget-action-os")).to_have_class(re.compile("budget-action-cancelled"))
        mark("cancelamento sem motivo solicitado, documentos vermelhos e linha cinza persistem após reload")

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
        browser = await p.chromium.launch(executable_path=os.environ.get("FUNIX_CHROMIUM", "/usr/bin/chromium"),
                                          headless=True, args=["--no-sandbox"])
        try:
            for label, viewport in [
                ("desktop", {"width": 1440, "height": 1000}),
                ("mobile390", {"width": 390, "height": 844}),
                ("mobile320", {"width": 320, "height": 844})
            ]:
                await case(browser, label, viewport)
                await color_case(browser, label, viewport, ARTIFACTS)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(run())
