"""Official FUNIX OS V1: synthetic WorkOrder -> Chromium PDF regression (no production)."""
from __future__ import annotations
import json
import re
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
def payload(count:int)->dict:
    return json.loads(subprocess.check_output(
        ["node","tests/browser/fixtures/os_v1_data.ts",str(count)],
        cwd=ROOT,text=True))
with TemporaryDirectory(prefix="funix-os-v1-") as tmp, sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    for count in (4,19):
        data=payload(count)
        assert "@page" not in data["headerTemplate"]
        assert "@page" not in data["footerTemplate"]
        assert 'class="running-header plan-header"' in data["headerTemplate"]
        assert 'class="pageNumber"' in data["headerTemplate"]
        assert 'class="totalPages"' in data["headerTemplate"]
        assert "Legenda:" in data["footerTemplate"]
        assert "OS-000142" in data["headerTemplate"]
        assert "R$ " not in data["content"]
        page=browser.new_page(viewport={"width":1122,"height":800})
        page.set_content(data["content"],wait_until="load")
        expected=["Preparação técnica","Correção estrutural","Pintura e acabamento",
                  "Serviços complementares","Estética e revitalização"]
        assert page.locator(".technical-band-label").evaluate_all(
            "(nodes)=>nodes.map(n=>n.getAttribute('aria-label'))")==expected
        assert page.locator(".main-matrix tbody tr:first-child td").evaluate_all(
            "(nodes)=>nodes.map(n=>n.getAttribute('data-cluster'))")==expected
        assert page.locator(".technical-band-label > span").evaluate_all(
            "els=>els.map(e=>getComputedStyle(e).letterSpacing)")==['-0.15px']*6+['-0.25px']*4
        assert page.locator(".main-matrix tbody tr").count()==count
        assert page.locator(".main-matrix tbody td .stage-name").evaluate_all(
            "(els)=>[...new Set(els.map(e=>getComputedStyle(e).fontWeight))]")==["400"]
        output=Path(tmp)/f"os-v1-{count}.pdf"
        page.pdf(path=str(output),format="A4",landscape=True,print_background=True,
            display_header_footer=True,
            header_template=data["headerTemplate"],footer_template=data["footerTemplate"],
            margin={"top":"23mm","right":"5mm","bottom":"15mm","left":"5mm"})
        doc=fitz.open(str(output))
        assert len(doc)>=(2 if count==19 else 1),len(doc)
        found=set()
        for index,p in enumerate(doc):
            text=p.get_text()
            assert "OS-000142 R01" in text,(count,index,"header")
            assert "19/11/2026" in text,(count,index,"delivery")
            spans=[s for b in p.get_text("dict")["blocks"] for l in b.get("lines",[]) for s in l["spans"]]
            vehicle=[s for s in spans if "Honda City EXL" in s["text"] or "Chevrolet Trailblazer Premier" in s["text"]]
            assert vehicle and abs(vehicle[0]["size"]-(16 if count==4 else 14))<0.3,(count,index,vehicle)
            assert vehicle[0]["bbox"][1]<55 and vehicle[0]["bbox"][2]<675,(count,index,vehicle)
            assert "Legenda:" in text,(count,index,"footer")
            assert f"{index+1}/{len(doc)}" in text,(count,index,"page count")
            assert "(Parcial)" not in text and "(M)" not in text
            found.update(map(int,re.findall(r"Peça sintética\s+(\d+)",text)))
            drawings=p.get_drawings()
            navy=(10/255,31/255,68/255)
            grey=(213/255,219/255,228/255)
            def filled_rects(color):
                return [d["rect"] for d in drawings if d.get("fill")
                    and all(abs(a-b)<.03 for a,b in zip(d["fill"],color))
                    and 810<d["rect"].width<820]
            head=[r for r in filled_rects(navy) if r.y0<60 and r.height>20]
            legend=[r for r in filled_rects(grey) if r.y0>540]
            assert head and abs(head[0].x0-14.2)<2 and abs(head[0].y0-11.3)<3,(count,index,head)
            assert legend and abs(legend[0].x0-14.2)<2 and abs(legend[0].y0-562.5)<3,(count,index,legend)
        assert found==set(range(1,count+1)),(count,len(doc),found)
        print(f"PASS: official OS V1, {count} synthetic pieces, {len(doc)} pages")
        page.close()
    browser.close()
