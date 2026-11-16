"""Browser-level regression of the exact WorkOrder -> jsreport Chrome payload.
Runs only on GitHub Actions, not against production or a running jsreport server.
"""
from __future__ import annotations
import json
import re
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import fitz
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
def template(count: int) -> dict:
    data = subprocess.check_output(
        ["node", "tests/browser/fixtures/os_v63_data.ts", str(count)],
        cwd=ROOT, text=True
    )
    return json.loads(data)

with TemporaryDirectory(prefix="funix-os-v63-") as tmp, sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    for count in (4, 19):
        data = template(count)
        assert "@page" not in data["headerTemplate"], "WeasyPrint page rules in Chromium header"
        assert "@page" not in data["footerTemplate"], "WeasyPrint page rules in Chromium footer"
        assert "background:transparent" in data["headerTemplate"]
        assert "pageNumber" in data["headerTemplate"]
        page.set_content(data["content"], wait_until="load")
        # Force the wider Arial fallback to reproduce the user's jsreport PDF.
        # The arrow tip ends at 82.8% of the five-cluster SVG.
        page.add_style_tag(content=(
            ".main-matrix .technical-band-label,"
            ".main-matrix .technical-band-label span"
            "{font-family:Arial,Helvetica,sans-serif!important;}"
        ))
        expected=["Preparação técnica","Correção estrutural","Pintura e acabamento",
                  "Serviços complementares","Estética e revitalização"]
        headings=page.locator(".technical-band-label").evaluate_all(
            "(nodes) => nodes.map(node => node.getAttribute('aria-label'))"
        )
        assert headings==expected, f"Ordem dos cabeçalhos inválida: {headings}"
        cells=page.locator(".main-matrix tbody tr:first-child td").evaluate_all(
            "(nodes) => nodes.map(node => node.getAttribute('data-cluster'))"
        )
        assert cells==expected, f"Ordem das colunas inválida: {cells}"
        # A legenda é um documento separado em Chrome header/footer, não parte do body.
        legend=re.findall(
            r'<span class="legend-item"[^>]*><svg aria-label="([^"]+)"',
            data["footerTemplate"]
        )
        assert legend==["Requer componentes",*expected], f"Ordem da legenda inválida: {legend}"
        # O título do quarto cluster não pode invadir o chevron da esquerda
        # nem o início da última coluna, mesmo com Arial.
        for viewport_width in (1000,1054):
            page.set_viewport_size({"width":viewport_width,"height":900})
            metrics=page.evaluate("""() => {
              const art=document.querySelector('.technical-band-art').getBoundingClientRect();
              const labels=[...document.querySelectorAll('.technical-band-label')];
              const service=labels[3].querySelector('span:last-child').getBoundingClientRect();
              const aesthetic=labels[4].querySelector('span:last-child').getBoundingClientRect();
              const line=getComputedStyle(document.querySelector('.main-matrix tbody tr:first-child td:nth-of-type(4)'));
              const headingLine=getComputedStyle(document.querySelector('.technical-band-labels'),'::after');
              const regular=getComputedStyle(document.querySelector('.main-matrix tbody tr:first-child td:nth-of-type(3)'));
              return {
                serviceGap:service.left-(art.left+art.width*.628),
                serviceRightSlack:art.left+art.width*.80-service.right,
                aestheticGap:aesthetic.left-(art.left+art.width*.828),
                aestheticRightSlack:art.right-aesthetic.right,
                separator:line.borderRightWidth,
                separatorStyle:line.borderRightStyle,
                separatorColor:line.borderRightColor,
                standardColor:regular.borderRightColor,
                headingPseudoContent:headingLine.content
              };
            }""")
            assert metrics["serviceGap"]>=3, f"Chevron sobre SERVIÇOS: {metrics}"
            assert metrics["serviceRightSlack"]>=3, f"SERVIÇOS invade 5ª coluna: {metrics}"
            assert metrics["aestheticGap"]>=3, f"Chevron sobre ESTÉTICA: {metrics}"
            assert metrics["aestheticRightSlack"]>=3, f"ESTÉTICA invade borda: {metrics}"
            assert metrics["separatorStyle"]=="solid" and float(metrics["separator"].replace("px",""))>=1, (
                f"Divisória original ausente: {metrics}"
            )
            assert metrics["separatorColor"]==metrics["standardColor"], (
                f"Divisória 4/5 deve ter a mesma cor cinza das demais: {metrics}"
            )
            assert metrics["headingPseudoContent"] in ("none","normal"), (
                f"Linha artificial sobre o cabeçalho: {metrics}"
            )
        page.set_viewport_size({"width":1280, "height":900})
        weights = page.locator(".main-matrix tbody td .stage-entry .stage-name").evaluate_all(
            "(elements) => [...new Set(elements.map(el => getComputedStyle(el).fontWeight))]"
        )
        assert weights == ["400"], f"Etapas devem ter peso normal: {weights}"
        assert "(Parcial)" not in data["content"], "Dimensões não devem aparecer na matriz"
        assert "(M)" not in data["content"], "Dimensões não devem aparecer na matriz"
        path = Path(tmp) / f"os-{count}.pdf"
        page.pdf(
            path=str(path), format="A4", landscape=True, print_background=True,
            display_header_footer=True, header_template=data["headerTemplate"],
            footer_template=data["footerTemplate"],
            margin={"top":"28mm","bottom":"18mm","left":"9mm","right":"9mm"}
        )
        doc=fitz.open(str(path))
        assert len(doc)>= (2 if count==19 else 1), f"Insufficient pages for {count} pieces: {len(doc)}"
        found=set()
        for index,p in enumerate(doc):
            text=p.get_text()
            # V63 reference has 5-mm side insets and precise vertical alignment.
            ink=(10/255,31/255,68/255)
            grey=(213/255,219/255,228/255)
            def matching_rects(target):
                return [d["rect"] for d in p.get_drawings()
                        if d.get("fill") and all(abs(a-b)<0.022 for a,b in zip(d["fill"],target))
                        and 810<d["rect"].width<819 and d["rect"].height>18]
            headers=[r for r in matching_rects(ink) if r.y0<55]
            footers=[r for r in matching_rects(grey) if r.y0>540]
            assert any(abs(r.x0-14.2)<2 and abs(r.y0-11.3)<3 for r in headers), f"Header not aligned: {headers}"
            assert any(abs(r.x0-14.2)<2 and abs(r.y0-562.0)<3 for r in footers), f"Footer not aligned: {footers}"
            assert "OS-000142" in text, f"Missing header on page {index+1}"
            assert "Legenda:" in text, f"Missing footer on page {index+1}"
            assert "(Parcial)" not in text and "(M)" not in text, f"Dimensões indevidas na página {index+1}"
            assert f"{index+1}/{len(doc)}" in text, f"Wrong page counter on page {index+1}"
            found.update(map(int,re.findall(r"Peça sintética\s+(\d+)",text)))
            # Detect white rectangle over the contents: PDF text extraction alone misses this.
            pix=p.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False)
            assert pix.n==3
            colored=total=0
            x0,x1=330,min(pix.width-20,740)
            y0,y1=100,min(pix.height-30,440)
            for y in range(y0,y1,5):
                for x in range(x0,x1,5):
                    k=(y*pix.width+x)*pix.n
                    r,g,b=pix.samples[k:k+3]
                    total+=1
                    if min(r,g,b)<225:
                        colored+=1
            assert colored/total>0.015, f"Content appears obscured on page {index+1}: {colored/total:.3%}"
        assert found==set(range(1,count+1)), f"Missing piece names: {set(range(1,count+1))-found}"
        print(f"PASS: OS V63 Chromium {count} pieces, {len(doc)} pages, header/footer/visible matrix")
    browser.close()
