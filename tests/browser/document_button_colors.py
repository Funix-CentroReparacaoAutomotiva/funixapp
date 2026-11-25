"""Production-bundle color regression, using FunixApp + real API + temporary SQLite."""
import base64
import json
import re
import sqlite3
import subprocess
from playwright.async_api import expect
from m1_atendimentos import Harness, ROOT, ORIGIN

COLORS = {
    "issued": ("rgb(20, 109, 56)", [20, 109, 56]),
    "cancelled": ("rgb(160, 35, 61)", [160, 35, 61]),
    "unavailable": ("rgb(102, 117, 138)", [102, 117, 138]),
}
ARTIFACTS = ROOT / "docs/evidencias/os-browser"


async def color_case(browser, label, viewport, artifacts=ARTIFACTS):
    artifacts.mkdir(parents=True, exist_ok=True)
    h = Harness()
    ctx = None
    results = []
    try:
        h.check_ports()
        script = r"""
import {writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {openDatabase} from './server/database.ts'
import {commercialFixture} from './server/tests/fixtures/commercial.ts'
import {BudgetRepository} from './server/tests/fixtures/budget-renderer.ts'
import {issueProductionOrder} from './server/tests/fixtures/production.ts'
import {BudgetCancellationRepository} from './server/budget-cancellations.ts'
const db=openDatabase(process.argv[1]), f=commercialFixture(db), b=new BudgetRepository(db), versions=[]
for(let n=0;n<4;n++){
 const input={scenarioId:f.scenario.id,negotiation:{mode:'none'}}, p=b.preview(f.at.id,input)
 versions.push(await b.emit(f.at.id,{...input,previewToken:p.token,idempotencyKey:randomUUID()}))
}
for(const i of [1,2])issueProductionOrder(db,f.at.id,versions[i].id)
new BudgetCancellationRepository(db).cancel(f.at.id,versions[2].id,{})
writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,versions:versions.map(v=>({id:v.id,number:v.documentNumber}))}))
db.close()
"""
        subprocess.run(["node", "--input-type=module", "-e", script,
                        str(h.folder / "atendimentos.sqlite"), str(h.folder / "ids.json")],
                       cwd=ROOT, check=True, timeout=60)
        ids = json.loads((h.folder / "ids.json").read_text())
        def originals():
            with sqlite3.connect(h.folder / "atendimentos.sqlite") as db:
                return db.execute("SELECT id,snapshot,pdf FROM budget_versions ORDER BY id").fetchall()
        frozen = originals()
        await h.start_api()
        preview = h.start(["node", "node_modules/vite/bin/vite.js", "preview", "--host",
                           "127.0.0.1", "--port", "5173", "--strictPort"], "preview-colors")
        await h.ready(ORIGIN, preview)
        ctx = await browser.new_context(viewport=viewport, has_touch=viewport["width"] < 500)
        await h.watch(ctx)
        page = await ctx.new_page()
        await h.attach(page)
        console_errors = []
        page.on("console", lambda msg: console_errors.append({'text':msg.text,'url':msg.location.get('url','')}) if msg.type == "error" else None)
        browse = ORIGIN + "/atendimentos/" + ids["at"] + "?aba=diagnosticos&tela=orcamentos"
        await page.goto(browse)
        await h.login(page)
        await expect(page.locator(".budget-history-row")).to_have_count(4)
        def row(v):
            return page.locator(".budget-history-row").filter(has=page.locator('.budget-action-or[href*="' + v["id"] + '"]'))
        # Exercise the actual cancellation UI for D, with no OS and no reason prompt.
        last = row(ids["versions"][3])
        dialog_types = []
        page.on("dialog", lambda d: dialog_types.append(d.type))
        async with page.expect_response(lambda response: response.request.method == "POST" and response.url.endswith("/cancelamento")) as event:
            await last.locator(".budget-action-cancel").click()
        assert (await event.value).status == 200
        await expect(last.locator(".budget-action-os")).to_be_disabled()
        assert dialog_types == ["confirm"], dialog_types
        assert originals() == frozen, "Cancellation must preserve frozen snapshot and original PDF"
        async def button(locator, state, marker):
            css, rgb = COLORS[state]
            await expect(locator).to_have_class(re.compile('budget-action-' + state))
            actual = await locator.evaluate("""el => {
                const s=getComputedStyle(el), b=el.querySelector('.budget-action-badge');
                return {backgroundColor:s.backgroundColor,borderColor:s.borderColor,color:s.color,
                    opacity:s.opacity,backgroundImage:s.backgroundImage,
                    marker:b?{className:b.className,color:getComputedStyle(b).color,
                        backgroundColor:getComputedStyle(b).backgroundColor,html:b.innerHTML}:null};
            }""")
            assert actual["backgroundColor"] == css, actual
            assert actual["borderColor"] == css, actual
            assert actual["color"] == "rgb(255, 255, 255)", actual
            assert actual["opacity"] == "1" and actual["backgroundImage"] == "none", actual
            if marker:
                badge = actual["marker"]
                assert badge and "badge-" + marker in badge["className"], actual
                assert badge["backgroundColor"] == "rgb(255, 255, 255)", actual
                assert badge["color"] == "rgb(33, 102, 199)", actual
                assert "<circle" in badge["html"], actual
            else:
                assert actual["marker"] is None
            # Screenshot pixels, not just classes or CSS: the expected fill must occupy
            # a majority of the rendered control, even if an overlay/opacity regresses.
            png = base64.b64encode(await locator.screenshot()).decode()
            ratio = await page.evaluate("""async ({png,rgb}) => {
                const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();
                const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
                const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
                const data=ctx.getImageData(0,0,img.width,img.height).data;let count=0;
                for(let i=0;i<data.length;i+=4)if(rgb.every((v,j)=>data[i+j]===v))count++;
                return count/(img.width*img.height);
            }""", {"png": png, "rgb": rgb})
            assert ratio > 0.60, (state, ratio)
            return {"state": state, **actual, "fillPixelRatio": ratio}
        expected = [("issued", "unavailable"), ("issued", "issued"),
                    ("cancelled", "cancelled"), ("cancelled", "unavailable")]
        async def validate(v, states, scope):
            values = [await button(scope.locator('.budget-action-or'), states[0], "view"),
                      await button(scope.locator('.budget-action-os'), states[1],
                                   None if states[1] == "unavailable" else "view")]
            cancelled = states[0] == "cancelled"
            assert await scope.locator('.budget-action-cancel').is_disabled() == cancelled
            assert await scope.locator('a.budget-action-or').count() == 1
            assert await scope.locator('a.budget-action-os').count() == (states[1] in ["issued", "cancelled"])
            controls = await scope.locator('.budget-history-open,.budget-action').evaluate_all("""els=>els.map(el=>{
                const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})""")
            for i,a in enumerate(controls):
                assert a['x'] >= 0 and a['x'] + a['w'] <= viewport['width'] + 1, controls
                for b in controls[i+1:]:
                    assert min(a['x']+a['w'],b['x']+b['w']) <= max(a['x'],b['x']) or min(a['y']+a['h'],b['y']+b['h']) <= max(a['y'],b['y']), controls
            assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            return values
        for reload in [False, True]:
            if reload:
                await h.restart_api()
                await page.reload()
                await h.login(page)
                await expect(page.locator('.budget-history-row')).to_have_count(4)
            for i, (v, states) in enumerate(zip(ids["versions"], expected)):
                r = row(v)
                values = await validate(v, states, r)
                if i >= 2:
                    colors = await r.locator('.budget-history-letter,.budget-history-identity strong,.budget-history-total,time').evaluate_all('els=>els.map(el=>getComputedStyle(el).color)')
                    assert colors == ['rgb(135, 147, 162)'] * 4, colors
                    assert await r.locator('strong').evaluate("el=>getComputedStyle(el).textDecorationLine") == 'none'
                    assert await r.locator('.budget-history-letter').evaluate("el=>getComputedStyle(el,'::after').transform") != 'none'
                if reload:
                    results.append({"scenario": "ABCD"[i], "number": v["number"], "buttons": values})
                    await r.screenshot(path=str(artifacts / f'{label}-scenario-{ "ABCD"[i] }.png'))
            await page.screenshot(path=str(artifacts / f'{label}-four-colors.png'))
        # Detail route must use the same real DocumentButton colors as history.
        for v, states in zip(ids['versions'], expected):
            await page.goto(browse + '&versao=' + v['id'])
            details = page.locator('.budget-detail-actions')
            await expect(details.locator('.budget-action-os')).to_be_visible()
            await validate(v, states, details)
        # API remains authoritative: bypassing the disabled UI still cannot create D's OS.
        response = await ctx.request.post(ORIGIN + '/api/atendimentos/' + ids['at'] + '/orcamentos/' + ids['versions'][3]['id'] + '/os', headers={'Origin':ORIGIN}, data={'authorized': True})
        assert response.status == 409, (response.status, await response.text())
        assert originals() == frozen
        assert not h.page_errors and not console_errors and not h.external, (h.page_errors, console_errors, h.external)
        h.mark(label + ': A/B/C/D computed colors, predominant pixels, markers, history/detail, reload + API restart, immutable originals and OS block passed')
    finally:
        try:
            (artifacts / f'{label}-computed-colors.json').write_text(json.dumps({'viewport':viewport,'results':results,'checks':h.results},ensure_ascii=False,indent=2)+'\n')
        finally:
            try:
                if ctx:
                    await ctx.close()
            finally:
                h.cleanup()
