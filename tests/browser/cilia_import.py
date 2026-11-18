"""Real FunixApp + SQLite + Chromium. Only synthetic Cilia fixture, no live credentials."""
from __future__ import annotations
import asyncio
import json
import os
import sqlite3
import subprocess
from pathlib import Path
from playwright.async_api import async_playwright, expect
from m1_atendimentos import Harness, ROOT, ORIGIN

ARTIFACTS = ROOT / "docs/evidencias/cilia-browser"

class CiliaHarness(Harness):
    def __init__(self):
        super().__init__()
        self.write_enabled = True

    def start(self, args, label):
        # Explicit allowlist: never inherit production endpoints, keys or flags.
        env = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL") if k in os.environ}
        env.update({
            "NODE_ENV": "development", "FUNIX_API_HOST": "127.0.0.1",
            "FUNIX_API_PORT": "8787", "FUNIX_APP_ORIGIN": ORIGIN,
            "FUNIX_DATABASE_PATH": str(self.folder / "atendimentos.sqlite"),
            "FUNIX_OPERATOR_PASSWORD": self.password,
            "FUNIX_CILIA_PREVIEW_ENABLED": "true",
            "FUNIX_CILIA_WRITE_ENABLED": str(self.write_enabled).lower(),
            "FUNIX_JSREPORT_ENDPOINT": "http://127.0.0.1:8788/api/report",
            "FUNIX_JSREPORT_USERNAME": "synthetic", "FUNIX_JSREPORT_PASSWORD": self.password,
        })
        log = open(self.folder / f"{label}-{len(self.logs)}.log", "w+")
        self.logs.append(log)
        process = subprocess.Popen(args, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        self.processes.append(process)
        return process

async def case(browser, width):
    h = CiliaHarness()
    ctx = page = None
    dbfile = h.folder / "atendimentos.sqlite"
    try:
        h.check_ports()
        seed = """
import {writeFileSync} from 'node:fs'
import {openDatabase} from './server/database.ts'
import {setupCiliaFixture,xml} from './server/tests/fixtures/cilia.ts'
const db=openDatabase(process.argv[1]),x=setupCiliaFixture(db)
writeFileSync(process.argv[2],JSON.stringify({id:x.at.id,service:x.f.service.id,dimension:x.f.dimension.id,piece:x.raw.review.pieces[0].pieceId,request:x.raw}))
writeFileSync(process.argv[3],xml())
db.close()
"""
        env = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL") if k in os.environ}
        subprocess.run(["node","--input-type=module","-e",seed,str(dbfile),str(h.folder/"ids.json"),str(h.folder/"qa.xml")],cwd=ROOT,env=env,check=True,timeout=60)
        ids = json.loads((h.folder/"ids.json").read_text())
        await h.start_api()
        vite = h.start(["node","node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port","5173","--strictPort"],"preview")
        await h.ready(ORIGIN,vite)
        ctx = await browser.new_context(viewport={"width":width,"height":850},is_mobile=width<600,has_touch=width<600)
        await h.watch(ctx)
        page = await ctx.new_page()
        await h.attach(page)
        url = ORIGIN + "/atendimentos/" + ids["id"] + "?aba=diagnosticos&tela=orcamentos"
        endpoint = ORIGIN + "/api/atendimentos/" + ids["id"] + "/importar-cilia"
        await page.goto(url)
        await h.login(page)
        panel = page.get_by_role("region",name="Importação Cilia")
        await panel.get_by_role("button",name="Importar orçamento · Cilia").click()
        await panel.get_by_label("Arquivo XML").set_input_files(str(h.folder/"qa.xml"))
        await panel.get_by_label("Posição do volante").select_option("left")
        await panel.get_by_role("button",name="Consultar XML").click()
        editor = panel.get_by_role("region",name="Revisão de escopo Cilia")
        await expect(editor).to_be_visible()
        await expect(panel.get_by_text("Totais de origem conciliados",exact=True)).to_be_visible()
        await editor.locator("fieldset").nth(0).locator("select").first.select_option(ids["piece"])
        await editor.locator("fieldset").nth(2).locator("summary").click()
        await editor.get_by_label("Justificativa técnica").fill("Serviço sintético equivalente no ensaio")
        await editor.get_by_role("button",name="Adicionar alternativa técnica").click()
        service = editor.get_by_role("combobox",name="Serviço",exact=True)
        await expect(service).to_be_visible()
        await service.select_option(ids["service"])
        await expect(service).to_have_value(ids["service"])
        dimension = editor.get_by_role("combobox",name="Dimensão",exact=True)
        await dimension.select_option(ids["dimension"])
        await expect(dimension).to_have_value(ids["dimension"])
        h.mark("Alternativa de serviço e dimensão selecionada",width=width)
        await editor.get_by_label("Revisei todas as peças",exact=False).check()
        await editor.get_by_role("button",name="Comparar com o motor FUNIX").click()
        await expect(editor.get_by_role("heading",name="Valores conciliados")).to_be_visible()
        h.mark("Comparação financeira via interface",width=width)
        await editor.get_by_role("button",name="Preparar criação do cenário").click()
        confirm = editor.get_by_role("button",name="Confirmar e criar cenário")
        await expect(confirm).to_be_disabled()
        await editor.get_by_label("Conferi a identidade",exact=False).check()
        await editor.get_by_label("Conferi o escopo final",exact=False).check()
        await editor.get_by_label("Verifiquei a autorização",exact=False).check()
        await expect(confirm).to_be_disabled()
        await editor.get_by_label("Referência da autorização",exact=False).fill("QA autorização sintética")
        await expect(confirm).to_be_enabled()
        await page.screenshot(path=str(ARTIFACTS/f"{width}-confirmar.png"),animations="disabled")
        assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth+1"), "Horizontal overflow"
        async with page.expect_response(lambda r:r.url.endswith("/importar-cilia/confirmar") and r.request.method=="POST") as response:
            await confirm.click()
        saved = await response.value
        assert saved.status==200, await saved.text()
        input = saved.request.post_data_json
        result = await saved.json()
        assert result["state"]=="created", result
        await expect(editor.get_by_text("Cenário registrado.",exact=False)).to_be_visible()
        h.mark("Confirmação via interface concluída",width=width)
        replay = await ctx.request.post(endpoint+"/confirmar",headers={"Origin":ORIGIN},data=input)
        assert replay.status==200 and (await replay.json())["state"]=="existing"
        with sqlite3.connect(dbfile) as db:
            assert db.execute("SELECT count(*) FROM scenarios WHERE atendimento_id=?", (ids["id"],)).fetchone()[0]==2
            assert db.execute("SELECT count(*) FROM component_items WHERE atendimento_id=?", (ids["id"],)).fetchone()[0]==0
            assert db.execute("SELECT count(*) FROM budget_versions").fetchone()[0]==0
            assert db.execute("SELECT count(*) FROM work_orders").fetchone()[0]==0
            assert db.execute("SELECT count(*) FROM cilia_import_events").fetchone()[0]==1
            assert db.execute("PRAGMA foreign_key_check").fetchall()==[]
        # Reopen with write OFF: receipt remains accessible, no duplicate mutation.
        h.write_enabled=False
        await h.restart_api()
        await page.goto(url)
        await h.login(page)
        await panel.get_by_role("button",name="Importar orçamento · Cilia").click()
        await panel.get_by_text("Histórico de importações Cilia",exact=True).click()
        await expect(panel.get_by_role("heading",name="QA-CILIA · revisão 1")).to_be_visible()
        receipts=await ctx.request.get(endpoint+"/recibos")
        rows=await receipts.json()
        assert len(rows)==1 and rows[0]["partnerComponents"][0]["total"]=="300"
        assert rows[0]["result"]["total"]=="100"
        assert (await ctx.request.post(endpoint+"/confirmar",headers={"Origin":ORIGIN},data=input)).status==503
        await page.screenshot(path=str(ARTIFACTS/f"{width}-historico.png"),animations="disabled")
        assert not h.external and not h.page_errors,(h.external,h.page_errors)
        h.mark("Cilia: revisão, comparação, confirmação, replay e histórico após restart com escrita OFF",width=width)
    finally:
        (ARTIFACTS/f"{width}-resultados.json").write_text(json.dumps({"synthetic":True,"results":h.results,"external":h.external,"pageErrors":h.page_errors},ensure_ascii=False,indent=2))
        if page and not any("restart" in x["name"] for x in h.results):
            try:
                await page.screenshot(path=str(ARTIFACTS/f"{width}-falha.png"),timeout=3000)
            except Exception:
                pass
        if ctx:
            await ctx.close()
        h.cleanup()

async def run():
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,args=["--no-sandbox"])
        try:
            for width in (320,390,1440):
                await case(browser,width)
        finally:
            await browser.close()

if __name__=="__main__":
    asyncio.run(run())
