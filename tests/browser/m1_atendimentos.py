"""Independent M1 browser regression against the real API and temporary SQLite.

Requires Python Playwright and Chromium. Starts only owned loopback processes;
fails if ports are already occupied. No live Coda, WhatsApp or IA is contacted.
All records and screenshots are explicitly synthetic QA data.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tempfile
import time
import traceback
from urllib.parse import urlparse
from urllib.request import ProxyHandler, build_opener

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = "http://127.0.0.1:5173"
API = "http://127.0.0.1:8787"
ARTIFACTS = ROOT / "docs/evidencias"
REPORT = ARTIFACTS / "m1-browser-resultados.json"
STAGES = ["Novo lead", "Aguardando dados", "Em negociação (24h)", "Morno (3 dias)", "Frio (5 dias)", "Rejeitados"]


class Harness:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="funix-m1-browser-")
        self.folder = Path(self.temp.name)
        self.password = secrets.token_hex(20)
        self.processes: list[subprocess.Popen] = []
        self.logs = []
        self.api: subprocess.Popen | None = None
        self.results: list[dict] = []
        self.external: list[str] = []
        self.api_requests: list[dict] = []
        self.page_errors: list[str] = []
        self.dialogs: list[str] = []
        self.accept_dialogs = True

    def mark(self, name, **details):
        self.results.append({"name": name, "pass": True, **details})
        print("PASS", name, flush=True)

    def check_ports(self):
        for port in [5173, 8787]:
            with socket.socket() as sock:
                if sock.connect_ex(("127.0.0.1", port)) == 0:
                    raise RuntimeError(f"Port {port} is occupied; refusing to stop another process")

    def start(self, args, label):
        log = open(self.folder / f"{label}-{len(self.logs)}.log", "w+")
        self.logs.append(log)
        env = {key: value for key, value in os.environ.items() if not key.startswith(("CODA_", "FUNIX_CODA_"))}
        env.update({
            "NODE_ENV": "development", "FUNIX_API_HOST": "127.0.0.1", "FUNIX_API_PORT": "8787",
            "FUNIX_APP_ORIGIN": ORIGIN, "FUNIX_DATABASE_PATH": str(self.folder / "atendimentos.sqlite"),
            "FUNIX_OPERATOR_PASSWORD": self.password,
        })
        process = subprocess.Popen(args, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        self.processes.append(process)
        return process

    async def ready(self, url, process):
        opener = build_opener(ProxyHandler({}))
        until = time.monotonic() + 30
        while time.monotonic() < until:
            if process.poll() is not None:
                raise RuntimeError(f"Owned test process exited with {process.returncode}")
            try:
                with opener.open(url, timeout=1) as response:
                    if response.status == 200:
                        return
            except Exception:
                pass
            await asyncio.sleep(0.12)
        raise TimeoutError(f"Local test process did not become ready: {url}")

    async def start_api(self):
        self.api = self.start(["node", "server/index.ts"], "api")
        await self.ready(API + "/api/ready", self.api)

    @staticmethod
    def stop(process):
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)

    async def restart_api(self):
        self.stop(self.api)
        await self.start_api()

    def cleanup(self):
        for process in reversed(self.processes):
            self.stop(process)
        for log in self.logs:
            log.close()
        self.temp.cleanup()

    async def watch(self, context):
        async def restrict(route):
            parsed = urlparse(route.request.url)
            if parsed.scheme in ["http", "https"] and parsed.hostname not in ["127.0.0.1", "localhost"]:
                self.external.append(parsed.hostname or "unknown")
                await route.abort()
                return
            if parsed.path.startswith("/api/"):
                self.api_requests.append({"path": parsed.path, "method": route.request.method})
            await route.continue_()
        await context.route("**/*", restrict)

    async def attach(self, page):
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        async def dialog_handler(dialog):
            self.dialogs.append(dialog.message)
            if self.accept_dialogs:
                await dialog.accept(dialog.default_value if dialog.type == "prompt" else None)
            else:
                await dialog.dismiss()
        page.on("dialog", dialog_handler)

    async def login(self, page):
        field = page.get_by_label("Senha de acesso")
        await expect(field).to_be_visible()
        await field.fill(self.password)
        await page.get_by_role("button", name="Entrar", exact=True).click()
        await expect(field).not_to_be_visible()

    async def get_record(self, context, record_id):
        response = await context.request.get(ORIGIN + "/api/atendimentos/" + record_id)
        assert response.status == 200
        return await response.json()

    async def goto_record(self, page, record):
        await page.goto(ORIGIN + "/atendimentos/" + record["id"] + "?aba=chat")
        await expect(page.locator(".detail-header")).to_contain_text(record["name"] or record["phone"])
        if record["plate"]:
            await expect(page.locator(".detail-header")).to_contain_text(record["plate"])

    async def editor(self, page):
        await page.get_by_role("button", name=re.compile("Editar.*Atendimento", re.I)).click()
        await expect(page.get_by_role("form", name="Editar Atendimento")).to_be_visible()


async def run():
    h = Harness()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    browser = None
    failed = None
    try:
        h.check_ports()
        await h.start_api()
        vite = h.start(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], "vite")
        await h.ready(ORIGIN, vite)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
            context = await browser.new_context(viewport={"width": 1440, "height": 960})
            await h.watch(context)
            page = await context.new_page()
            await h.attach(page)
            await page.goto(ORIGIN + "/funil")
            await h.login(page)
            await expect(page.get_by_role("navigation", name="Áreas da FUNIX").get_by_role("button")).to_have_count(2)
            assert await page.get_by_role("button", name="Veículos", exact=True).count() == 0
            h.mark("desktop: only Conversas and Funil navigation; no Veículos")
            initial = await context.request.get(ORIGIN + "/api/atendimentos")
            assert initial.status == 200 and (await initial.json())["total"] == 0
            h.mark("real empty SQLite database is usable without Coda credentials")

            await page.get_by_role("button", name=re.compile("Novo Atendimento", re.I)).click()
            await expect(page.get_by_role("form", name="Novo Atendimento")).to_be_visible()
            await page.get_by_role("button", name="Criar Atendimento", exact=True).click()
            assert (await (await context.request.get(ORIGIN + "/api/atendimentos")).json())["total"] == 0
            await page.get_by_label("Telefone *", exact=True).fill("1")
            async with page.expect_response(lambda response: response.request.method == "POST" and response.url.endswith("/api/atendimentos")) as created:
                await page.get_by_role("button", name="Criar Atendimento", exact=True).click()
            created_response = await created.value
            assert created_response.status == 201
            alpha = await created_response.json()
            await expect(page.locator(".detail-header")).to_contain_text("1")
            assert alpha["name"] == alpha["plate"] == alpha["reason"] == ""
            h.mark("manual creation requires only a minimum phone; optional data stays empty")

            await h.editor(page)
            fields = {"Nome do contato": "QA Sintético Alfa", "Veículo informado": "Hatch de teste", "Marca": "Marca QA", "Modelo": "Modelo Alfa", "Placa": "QAT1A01", "Motivo / descrição do ocorrido": "Descrição sintética para teste de persistência", "Observações": "Dados de QA; não são clientes reais."}
            for label, value in fields.items():
                field = page.locator('#at-notes') if label == 'Observações' else page.locator('#at-reason') if label == 'Motivo / descrição do ocorrido' else page.get_by_label(label, exact=True)
                await field.fill(value)
            await page.locator("#at-stage").select_option("aguardando-dados")
            async with page.expect_response(lambda response: response.request.method == "PATCH" and alpha["id"] in response.url) as saved:
                await page.get_by_role("button", name="Salvar alterações", exact=True).click()
            assert (await saved.value).status == 200
            alpha = await h.get_record(context, alpha["id"])
            assert alpha["stage"] == "aguardando-dados" and alpha["plate"] == "QAT1A01"
            await expect(page.locator(".detail-header")).to_contain_text("QA Sintético Alfa")
            await expect(page.locator(".detail-header")).to_contain_text("QAT1A01")
            h.mark("optional fields and manual commercial phase persist; header updates to saved record")

            beta_response = await context.request.post(ORIGIN + "/api/atendimentos", headers={"Origin": ORIGIN}, data={"phone": "+55 11 99999-0002", "name": "QA Sintético Beta", "model": "Modelo Beta", "plate": "QAT2B02"})
            assert beta_response.status == 201
            beta = await beta_response.json()
            for term in ["Alfa", "QAT1A01", "1"]:
                await page.goto(ORIGIN + "/funil?modo=lista")
                search = page.get_by_role("textbox", name=re.compile("Buscar"))
                await search.fill(term)
                await expect(page.locator(".fh-board-list")).to_contain_text("QA Sintético Alfa")
            h.mark("search locates actual stored records by name, plate and phone")

            await page.goto(ORIGIN + "/funil?modo=lista&q=Alfa")
            await page.get_by_role("button", name=re.compile("QA Sintético Alfa")).click()
            await expect(page.locator(".detail-header")).to_contain_text("QAT1A01")
            await page.get_by_role("button", name="Voltar à visão anterior", exact=True).click()
            await expect(page.get_by_role("textbox", name=re.compile("Buscar"))).to_have_value("Alfa")
            h.mark("detail back preserves list and search context")

            await h.goto_record(page, beta)
            assert "QA Sintético Alfa" not in await page.locator(".detail-header").inner_text()
            await h.goto_record(page, alpha)
            assert "QAT2B02" not in await page.locator(".detail-header").inner_text()
            h.mark("switching records never combines another contact or plate in the header")

            await expect(page.get_by_role("textbox", name="Mensagem ao cliente", exact=True)).to_be_disabled()
            context_ai = page.locator('[aria-label="IA do Atendimento"]')
            await expect(context_ai).to_contain_text("IA ainda indisponível")
            # V20 restores the right rail; the channel and every action remain unavailable.
            for action in ["Sugestão indisponível", "Chat IA indisponível", "Áudio indisponível", "Fotos indisponível", "Orçamento indisponível", "Olá indisponível", "Mapa indisponível"]:
                await expect(context_ai.get_by_role("button", name=action, exact=True)).to_be_disabled()
            await page.get_by_role("button", name="Abrir Copiloto FUNIX", exact=True).click()
            await expect(page.get_by_role("region", name="Copiloto FUNIX")).to_contain_text(re.compile("indisponível|não disponível", re.I))
            await page.get_by_role("button", name="Recolher Copiloto", exact=True).click()
            h.mark("Chat and global/context IA stay unavailable without simulated integration")

            await h.editor(page)
            await page.locator("#at-notes").fill("Alteração não salva de QA")
            h.accept_dialogs = False
            await page.get_by_role("button", name=re.compile("Fechar.*edição|Cancelar|Fechar formulário", re.I)).first.click()
            await expect(page.locator("#at-notes")).to_have_value("Alteração não salva de QA")
            assert h.dialogs
            h.accept_dialogs = True
            await page.get_by_role("button", name=re.compile("Fechar.*edição|Cancelar|Fechar formulário", re.I)).first.click()
            h.mark("cancelling unsaved navigation keeps the form until explicit discard")

            # Deliberate local fault injection: no successful API is fabricated.
            await h.editor(page)
            await page.get_by_label("Nome do contato", exact=True).fill("QA Alteração com falha")
            async def fail_patch(route):
                if route.request.method == "PATCH":
                    await route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": {"code": "QA_FAILURE", "message": "Falha sintética de gravação", "requestId": "qa"}}))
                else:
                    await route.continue_()
            pattern = "**/api/atendimentos/" + alpha["id"]
            await page.route(pattern, fail_patch)
            await page.get_by_role("button", name="Salvar alterações", exact=True).click()
            await expect(page.get_by_role("alert")).to_contain_text("Falha sintética de gravação")
            await expect(page.get_by_label("Nome do contato", exact=True)).to_have_value("QA Alteração com falha")
            assert (await h.get_record(context, alpha["id"]))["name"] == "QA Sintético Alfa"
            await page.unroute(pattern, fail_patch)
            await page.get_by_role("button", name=re.compile("Fechar.*edição|Cancelar|Fechar formulário", re.I)).first.click()
            h.mark("injected save failure retains input and does not alter persisted data")

            await h.editor(page)
            await page.get_by_label("Nome do contato", exact=True).fill("QA Aba antiga")
            current = await h.get_record(context, alpha["id"])
            concurrent = await context.request.patch(ORIGIN + "/api/atendimentos/" + alpha["id"], headers={"Origin": ORIGIN}, data={"revision": current["revision"], "notes": "Atualização real por segunda sessão sintética"})
            assert concurrent.status == 200
            await page.get_by_role("button", name="Salvar alterações", exact=True).click()
            await expect(page.get_by_role("alert")).to_contain_text("outra aba")
            await expect(page.get_by_label("Nome do contato", exact=True)).to_have_value("QA Aba antiga")
            await page.get_by_role("button", name=re.compile("Fechar.*edição|Cancelar|Fechar formulário", re.I)).first.click()
            h.mark("real revision conflict preserves stale input and refuses silent overwrite")

            await h.goto_record(page, beta)
            await h.editor(page)
            await page.locator("#at-stage").select_option("rejeitados")
            await page.get_by_role("button", name="Salvar alterações", exact=True).click()
            assert (await h.get_record(context, beta["id"]))["stage"] == "novo-lead"
            await page.get_by_role("checkbox", name=re.compile("recusa explícita", re.I)).check()
            await page.get_by_label("Motivo da recusa", exact=True).fill("Recusa expressa sintética de QA")
            async with page.expect_response(lambda response: response.request.method == "PATCH" and beta["id"] in response.url):
                await page.get_by_role("button", name="Salvar alterações", exact=True).click()
            beta = await h.get_record(context, beta["id"])
            assert beta["stage"] == "rejeitados" and beta["explicitRefusal"] is True
            h.mark("Rejeitados requires explicit refusal and reason; no automatic loss")

            await page.goto(ORIGIN + "/funil")
            await expect(page.locator(".fh-lane")).to_have_count(6)
            labels = await page.locator(".fh-lane-title").all_text_contents()
            assert labels == STAGES, labels
            await page.get_by_role("button", name=re.compile("Aguardando dados")).first.click()
            await expect(page.get_by_role("region", name="Aguardando dados", exact=True)).to_have_class(re.compile("collapsed"))
            await page.get_by_role("button", name=re.compile("Aguardando dados")).first.click()
            h.mark("Kanban preserves six approved labels and collapsible lanes")
            await page.screenshot(path=str(ARTIFACTS / "m1-desktop-funil-sintetico.png"))

            # Start an old response, switch SPA route while it is pending, then release it.
            held = asyncio.Event()
            release = asyncio.Event()
            async def slow_record(route):
                if route.request.method == "GET":
                    response = await route.fetch()
                    held.set()
                    await release.wait()
                    try:
                        await route.fulfill(response=response)
                    except Exception:
                        pass  # Expected if the browser aborted the obsolete request.
                else:
                    await route.continue_()
            await page.route(pattern, slow_record)
            await page.evaluate("id => { history.pushState({}, '', '/atendimentos/'+id+'?aba=chat'); dispatchEvent(new PopStateEvent('popstate')); }", alpha["id"])
            await asyncio.wait_for(held.wait(), 5)
            await page.evaluate("id => { history.pushState({}, '', '/atendimentos/'+id+'?aba=chat'); dispatchEvent(new PopStateEvent('popstate')); }", beta["id"])
            await expect(page.locator(".detail-header")).to_contain_text("QA Sintético Beta")
            release.set()
            await page.wait_for_timeout(350)
            await expect(page.locator(".detail-header")).to_contain_text("QAT2B02")
            assert "QA Sintético Alfa" not in await page.locator(".detail-header").inner_text()
            await page.unroute(pattern, slow_record)
            h.mark("delayed response from another Atendimento cannot replace the active header")

            await h.goto_record(page, alpha)
            await page.reload()
            await expect(page.locator(".detail-header")).to_contain_text("QA Sintético Alfa")
            await h.restart_api()
            await browser.close()
            browser = await p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
            context = await browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            await h.watch(context)
            page = await context.new_page()
            await h.attach(page)
            await page.goto(ORIGIN + "/atendimentos/" + alpha["id"] + "?aba=chat")
            await h.login(page)
            await expect(page.locator(".detail-header")).to_contain_text("QA Sintético Alfa")
            alpha_after = await h.get_record(context, alpha["id"])
            assert alpha_after["plate"] == "QAT1A01" and alpha_after["stage"] == "aguardando-dados"
            assert alpha_after["notes"] == "Atualização real por segunda sessão sintética"
            assert (await (await context.request.get(ORIGIN + "/api/atendimentos")).json())["total"] == 2
            h.mark("same SQLite records survive API stop/restart and a completely new browser session")

            assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            h.mark("mobile: no body horizontal overflow")
            await page.screenshot(path=str(ARTIFACTS / "m1-mobile-atendimento-sintetico.png"))
            await h.editor(page)
            await expect(page.get_by_role("button", name="Salvar alterações", exact=True)).to_be_visible()
            await page.screenshot(path=str(ARTIFACTS / "m1-mobile-edicao-sintetica.png"))
            await page.locator("#at-notes").fill("Nota sintética editada no celular")
            async with page.expect_response(lambda response: response.request.method == "PATCH" and alpha["id"] in response.url) as mobile_saved:
                await page.get_by_role("button", name="Salvar alterações", exact=True).click()
            assert (await mobile_saved.value).status == 200
            await page.reload()
            await expect(page.locator(".record-summary")).to_contain_text("Nota sintética editada no celular")
            h.mark("mobile: editor scrolling/save is usable and edited data survives reload")

            for legacy in ["/veiculos", "/experiencias/i-qa"]:
                await page.goto(ORIGIN + legacy)
                assert await page.get_by_role("button", name="Veículos", exact=True).count() == 0
                assert "Finalização operacional" not in await page.locator("body").inner_text()
            h.mark("legacy vehicle/experience URLs cannot expose operational views")

            assert not h.external, h.external
            assert not any(entry["path"].startswith(("/api/workspace", "/api/experiencias")) for entry in h.api_requests), h.api_requests
            assert not h.page_errors, h.page_errors
            h.mark("no external providers, legacy Coda APIs, IA calls or uncaught page errors")
            await browser.close()
            browser = None
    except Exception as exc:
        failed = str(exc)
        h.results.append({"name": "browser regression completed", "pass": False, "error": failed})
        traceback.print_exc()
    finally:
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass
        REPORT.write_text(json.dumps({
            "suite": "M1 Atendimento — real local API and temporary SQLite",
            "data": "Synthetic QA only; no production data or provider calls",
            "fault_injection": "One PATCH 503 and one delayed GET; remaining requests use the real API",
            "assertions": h.results, "external_hosts": h.external,
        }, ensure_ascii=False, indent=2) + "\n")
        h.cleanup()
    if failed:
        raise SystemExit(1)
    print(f"{len(h.results)} browser scenario assertions passed; report: {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    asyncio.run(run())
