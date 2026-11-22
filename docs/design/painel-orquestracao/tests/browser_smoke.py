"""Smoke test responsivo de uma estrutura qualquer; nenhum nome/quantidade de frente é imposto."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'FUNIX_Painel_Orquestracao_Funcional.html').read_text()
BASE=json.loads((ROOT/'snapshot.json').read_text())
fronts=[n for n in BASE['nodes'] if n.get('parentId') in (None,BASE['root']['id'])]

def html_with_snapshot(snapshot):
  literal=json.dumps(snapshot,ensure_ascii=False).replace('<','\\u003c')
  return re.sub(r'(<script type="application/json" id="embedded-snapshot">).*?(</script>)',lambda m:m.group(1)+literal+m.group(2),HTML,flags=re.S)

def configure(page):
  page.route('**/api.github.com/**',lambda route: route.fulfill(status=200,content_type='application/json',body=json.dumps({'number':int(route.request.url.split('/')[-1]),'state':'open','draft':True,'merged':False,'updated_at':'2026-11-22T00:00:00Z'})))

with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--no-zygote'])
  for width,height,name in [(1440,900,'desktop'),(390,844,'mobile'),(320,760,'small')]:
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    configure(page)
    page.set_content(HTML,wait_until='load',timeout=15000)
    page.wait_for_function('(n)=>document.getElementById("kpi-fronts").textContent===String(n)',arg=len(fronts),timeout=15000)
    assert page.locator('.node').count()==len(fronts)
    assert page.locator('#kpi-subfronts').inner_text()==str(len(BASE['nodes'])-len(fronts))
    if fronts:
      first=fronts[0]
      page.locator(f'.node[data-id="{first["id"]}"]').click()
      direct=sum(n.get('parentId')==first['id'] for n in BASE['nodes'])
      assert page.locator('#subgrid .sub-node').count()==direct
      page.locator('#roles-toggle').click()
      assert page.locator('#roles-toggle').get_attribute('aria-pressed')=='true'
      if direct:
        page.locator('#subgrid .sub-node').first.click()
        assert page.locator('.crumb').count()>=2
        page.locator('.crumb').first.click()
        assert page.locator('#detail-title').inner_text()==first['title']
      for value in ['pr','issue','bug','all']:
        page.locator(f'button[data-filter="{value}"]').click()
        assert page.locator(f'button[data-filter="{value}"]').get_attribute('aria-pressed')=='true'
    page.wait_for_timeout(130)
    extent=page.evaluate('({vw:innerWidth,sw:document.documentElement.scrollWidth,wires:document.querySelectorAll("#wires path").length})')
    assert extent['sw']<=extent['vw']+1,extent
    assert extent['wires']>=len(fronts),extent
    assert not errors,errors
    print(name,'PASS',extent,flush=True)
    page.close()
  # O CTO pode substituir tudo por três níveis personalizados, sem alterar a interface.
  custom=json.loads((ROOT/'snapshot.json').read_text())
  custom['nodes']=[{'id':'projeto-x','parentId':None,'title':'Projeto especial','status':'planejado'},{'id':'parte-y','parentId':'projeto-x','title':'Grupo de trabalho','status':'em_execucao','statusReason':'Teste sintético','updatedAt':'2026-11-22T00:00:00Z','evidence':[{'kind':'bug','number':289}]},{'id':'atividade-z','parentId':'parte-y','title':'Entrega Z','status':'nao_verificado'}]
  custom['records']=[{'nodeId':'atividade-z','kind':'bug','number':289,'title':'Problema Z','url':f'https://github.com/{custom["repository"]}/issues/289'}]
  custom['relations']=[]
  page=browser.new_page(viewport={'width':390,'height':844})
  configure(page)
  errs=[]
  page.on('pageerror',lambda e:errs.append(str(e)))
  page.set_content(html_with_snapshot(custom))
  page.wait_for_function('document.getElementById("kpi-fronts").textContent==="1"')
  assert page.locator('.node').count()==1
  page.locator('.node').click()
  page.locator('.sub-node').click()
  assert page.locator('#subgrid .sub-node').count()==1
  page.locator('.sub-node').click()
  page.locator('button[data-filter="bug"]').click()
  assert page.locator('#history-list .history-item').count()==1
  assert '/issues/289' in page.locator('#history-list .history-item').first.get_attribute('href')
  assert not errs,errs
  print('CUSTOM_DYNAMIC PASS')
  page.close()
  # O mapa vazio permanece um estado válido do produto.
  custom['nodes']=[]
  custom['records']=[]
  page=browser.new_page(viewport={'width':320,'height':720})
  page.set_content(html_with_snapshot(custom))
  page.wait_for_function('document.getElementById("kpi-fronts").textContent==="0"')
  assert page.locator('#empty-map').is_visible()
  assert page.locator('#detail').is_hidden()
  print('EMPTY_STATE PASS')
  page.close()
  browser.close()