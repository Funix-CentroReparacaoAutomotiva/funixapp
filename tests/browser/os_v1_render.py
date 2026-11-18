"""Official FUNIX OS V1: synthetic WorkOrder -> Chromium PDF regression (no production)."""
from __future__ import annotations
import json
import re
import subprocess
import statistics
import time
from pathlib import Path
from tempfile import TemporaryDirectory
import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
def payload(count:int, stress:bool=False)->dict:
    return json.loads(subprocess.check_output(
        ["node","tests/browser/fixtures/os_v1_data.ts",str(count), "stress" if stress else "normal"],
        cwd=ROOT,text=True))

# The approved V1 master remains unchanged and acts as visual-reference CSS.
MASTER=(ROOT/"server/templates/FUNIX_OS_V1.html").read_text(encoding="utf-8")
REFERENCE_MATCH=re.search(r"<style>([\s\S]*?)</style>",MASTER)
assert REFERENCE_MATCH is not None, "CSS do mestre V1 não encontrado"
REFERENCE_CSS=REFERENCE_MATCH.group(1)
def without_page_rules(css):
    output=[]
    cursor=0
    for match in re.finditer(r"@page[^{}]*\{",css):
        if match.start()<cursor:
            continue
        output.append(css[cursor:match.start()])
        depth=1
        end=match.end()
        while depth and end<len(css):
            depth+=(css[end]=="{")-(css[end]=="}")
            end+=1
        assert depth==0
        cursor=end
    return "".join(output)+css[cursor:]

def reference(data):
    keys={"content":("@page plan{size:A4 landscape;margin:23mm 5mm 15mm 5mm}",REFERENCE_CSS),
          "headerTemplate":("html,body{height:auto!important;width:auto!important;overflow:visible!important",without_page_rules(REFERENCE_CSS)),
          "footerTemplate":("html,body{height:auto!important;width:auto!important;overflow:visible!important",without_page_rules(REFERENCE_CSS))}
    result={}
    for key,(marker,legacy) in keys.items():
        markup=data[key]
        start=markup.index("<style>")+len("<style>")
        end=markup.index("</style>",start)
        override=markup.rindex(marker,start,end)
        result[key]=markup[:start]+legacy+markup[override:]
    return result

def render(page,data,output):
    page.set_content(data["content"],wait_until="load")
    page.pdf(path=str(output),format="A4",landscape=True,print_background=True,
        display_header_footer=True,header_template=data["headerTemplate"],
        footer_template=data["footerTemplate"],
        margin={"top":"23mm","right":"5mm","bottom":"15mm","left":"5mm"})

def assert_geometry(pdf):
    # Significant word-box intersections detect collisions while tolerating
    # small font-metric/kerning overlaps between adjacent glyphs.
    for n,p in enumerate(pdf):
        words=p.get_text("words")
        rects=[(fitz.Rect(w[:4]),w[4]) for w in words]
        for i,(a,word) in enumerate(rects):
            assert p.rect.contains(a),(n,"outside page",word,a)
            for b,other in rects[i+1:]:
                if a.y0>=b.y1 or b.y0>=a.y1 or a.x0>=b.x1 or b.x0>=a.x1:
                    continue
                intersection=a & b
                if intersection.width>1.5 and intersection.height>2:
                    ratio=intersection.get_area()/min(a.get_area(),b.get_area())
                    assert ratio<0.20,(n,"word collision",word,other,a,b,ratio)

def compare_reference(page,data,doc,output):
    render(page,reference(data),output)
    with fitz.open(str(output)) as ref:
        assert len(ref)==len(doc),("pagination changed",len(ref),len(doc))
        for i,(old,new) in enumerate(zip(ref,doc)):
            assert old.get_text()==new.get_text(),("text changed",i)
            a,b=old.get_pixmap(),new.get_pixmap()
            assert (a.width,a.height)==(b.width,b.height)
            assert a.samples==b.samples,("visual regression",i)

with TemporaryDirectory(prefix="funix-os-v1-") as tmp, sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    for count in (1,4,10,19,40,80):
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
        assert len(doc)>=(2 if count>=19 else 1),len(doc)
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
        assert_geometry(doc)
        if count in (4,19):
            compare_reference(page,data,doc,Path(tmp)/f"reference-{count}.pdf")
        print(f"PASS: official OS V1, {count} synthetic pieces, {len(doc)} pages")
        doc.close()
        page.close()
    # Border regression in actual rendered print CSS, including the single-component case.
    data=json.loads(subprocess.check_output(
        ["node","tests/browser/fixtures/os_v1_data.ts","4","component-borders"],
        cwd=ROOT,text=True))
    page=browser.new_page(viewport={"width":1122,"height":800})
    page.emulate_media(media="print")
    page.set_content(data["content"],wait_until="load")
    rows=page.locator(".main-matrix tbody tr")
    assert rows.count()==4
    for index,expected in enumerate(([("A1",True,True,1,1)],
        [("B1",True,False,1,0),("B2",False,False,0,0),("B3",False,True,0,1)],
        [],[("D1",True,True,1,0)])):
        actual=rows.nth(index).locator(".piece-ladder-code").evaluate_all("""els=>els.map(e=>{
            const s=getComputedStyle(e);
            return [e.textContent,e.classList.contains('piece-ladder-code--first'),
                e.classList.contains('piece-ladder-code--last'),
                parseFloat(s.borderTopWidth),parseFloat(s.borderBottomWidth)]
        })""")
        assert actual==[list(x) for x in expected],("component borders",index,actual)
    marker=rows.nth(3).locator(".piece-ladder-comment-marker")
    assert marker.evaluate("e=>getComputedStyle(e).borderTopWidth")=="1px"
    output=Path(tmp)/"component-borders.pdf"
    render(page,data,output)
    with fitz.open(str(output)) as doc:
        assert_geometry(doc)
        text=" ".join(p.get_text() for p in doc)
        for token in ("A1","B1","B2","B3","D1"):
            assert re.search(r"\b"+token+r"\b",text),("missing code",token)
    print("PASS: component-code borders — single, multiple, none, and with notes")
    page.close()
    stress=payload(4,True)
    page=browser.new_page()
    output=Path(tmp)/"stress.pdf"
    render(page,stress,output)
    with fitz.open(str(output)) as doc:
        assert_geometry(doc)
        text=" ".join(p.get_text() for p in doc)
        for i in range(70):
            assert f"Nota{i:03d}" in text,("missing note",i)
        for i in range(20):
            assert f"QA{i:02d}" in text,("missing component",i)
        assert len(doc)>=2
    page.close()
    # Diagnostic benchmark: same browser, alternating order, warm-up excluded.
    # No timing threshold in shared CI; record measured distributions instead.
    for count in (4,19,80):
        candidate=payload(count)
        baseline=reference(candidate)
        variants={"V1 CSS":baseline,"V1.1 CSS":candidate}
        times={name:[] for name in variants}
        page=browser.new_page(viewport={"width":1122,"height":800})
        for name,data in variants.items():
            render(page,data,Path(tmp)/"benchmark-warmup.pdf")
        for repeat in range(5):
            order=list(variants) if repeat%2==0 else list(reversed(variants))
            for name in order:
                start=time.perf_counter()
                render(page,variants[name],Path(tmp)/"benchmark.pdf")
                times[name].append(round((time.perf_counter()-start)*1000,2))
        page.close()
        print("BENCHMARK_OS_CSS "+json.dumps({
            "pieces":count,"samples":5,
            "variants":{name:{
                "html_bytes":sum(len(value.encode("utf-8")) for value in data.values()),
                "median_ms":statistics.median(times[name]),
                "samples_ms":times[name]
            } for name,data in variants.items()}
        },ensure_ascii=False),flush=True)
    browser.close()
