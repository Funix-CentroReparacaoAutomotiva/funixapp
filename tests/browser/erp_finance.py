"""Run against a synthetic FunixApp API and Web instance."""
import os
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

ORIGIN = os.environ.get("FUNIX_BROWSER_ORIGIN", "http://127.0.0.1:5187")
PASSWORD = os.environ.get("FUNIX_BROWSER_PASSWORD", "sintetico-financeiro-qa")
ARTIFACTS = Path(os.environ.get("FUNIX_BROWSER_ARTIFACTS", "/tmp/funix-browser-finance"))


def create_title(page, label, amount, payable=False):
    page.get_by_role("button", name="Novo título").click()
    page.get_by_label("Contraparte", exact=True).fill("Parceiro QA")
    page.get_by_label("Descrição", exact=True).fill(label)
    page.get_by_label("Valor (R$)", exact=True).fill(amount)
    page.locator("input[name=competence]").fill("2026-01-03")
    page.locator("select[name=expectedPaymentMethod]").select_option("pix")
    if payable:
        page.get_by_label("Classificação gerencial").fill("Manutenção")
    page.get_by_role("button", name="Lançar título").click()
    expect(page.get_by_role("status").filter(has_text="Título lançado.")).to_be_visible()
    expect(page.get_by_role("button", name=label, exact=True)).to_be_visible()


def run(browser):
    token = uuid4().hex[:8]
    desktop = browser.new_context(viewport={"width": 1366, "height": 768})
    login = desktop.request.post(
        f"{ORIGIN}/api/session", data={"password": PASSWORD}, headers={"Origin": ORIGIN}
    )
    assert login.ok, f"HTTP {login.status} na sessão sintética"
    page = desktop.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"{ORIGIN}/financeiro/contas-a-receber")
    expect(page.get_by_role("heading", name="Contas a receber", exact=True)).to_be_visible()
    first, second = f"Reparo {token}", f"Complemento {token}"
    create_title(page, first, "80,00")
    create_title(page, second, "20,00")
    page.get_by_role("checkbox", name=f"Selecionar {first}", exact=True).check()
    page.get_by_role("checkbox", name=f"Selecionar {second}", exact=True).check()
    page.get_by_role("button", name="Registrar baixa em grupo (2)").click()
    form = page.get_by_role("form", name="Baixa em grupo")
    form.get_by_label("Forma de pagamento").select_option("pix")
    form.get_by_label(first, exact=False).fill("30,00")
    form.get_by_role("button", name="Confirmar transação").click()
    expect(page.get_by_role("status").filter(has_text="Transação registrada")).to_be_visible()
    expect(page.get_by_role("row").filter(has_text=first)).to_contain_text("R$ 50,00")
    expect(page.get_by_role("row").filter(has_text=second)).to_contain_text("Quitado")
    page.get_by_role("checkbox", name="Agrupar por pagador").check()
    expect(page.get_by_role("heading", name="Parceiro QA", exact=True)).to_be_visible()
    page.screenshot(path=ARTIFACTS / "financeiro-contas-receber-1366.png", full_page=True)

    page.goto(f"{ORIGIN}/financeiro/contas-a-pagar")
    expect(page.get_by_role("heading", name="Contas a pagar", exact=True)).to_be_visible()
    create_title(page, f"Despesa {token}", "10,00", payable=True)

    mobile = browser.new_context(viewport={"width": 390, "height": 844},
                                 storage_state=desktop.storage_state(), is_mobile=True, has_touch=True)
    try:
        page = mobile.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{ORIGIN}/financeiro/fluxo-de-caixa")
        expect(page.get_by_role("heading", name="Fluxo de caixa", exact=True)).to_be_visible()
        realized = page.get_by_label("Saldos do caixa").get_by_text("Saldo realizado", exact=True).locator("..")
        expect(realized).to_contain_text("R$ 50,00")
        page.get_by_role("button", name="Registrar transferência interna").click()
        page.get_by_label("Conta de origem").fill("Caixa QA")
        page.get_by_label("Conta de destino").fill("Banco QA")
        page.get_by_label("Valor (R$)", exact=True).fill("5,00")
        page.get_by_role("button", name="Registrar", exact=True).click()
        expect(page.get_by_role("status").filter(has_text="Transferência interna registrada.")).to_be_visible()
        expect(page.get_by_text("Caixa QA → Banco QA", exact=True)).to_be_visible()
        expect(realized).to_contain_text("R$ 50,00")
        expect(page.get_by_label("Saldos do caixa").get_by_text("Saldo projetado", exact=True).locator("..")).to_contain_text("R$ 90,00")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.screenshot(path=ARTIFACTS / "financeiro-fluxo-caixa-390.png", full_page=True)
    finally:
        mobile.close()
        desktop.close()
    assert not errors, errors


if __name__ == "__main__":
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get("CHROME_PATH", "/usr/bin/chromium"), args=["--no-sandbox"]
        )
        try:
            run(browser)
        finally:
            browser.close()
