from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'FUNIX_Painel_Orquestracao_Funcional.html').read_text()

with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--no-zygote'])
  for width,height,name in [(1440,900,'desktop'),(390,844,'mobile'),(320,760,'small')]:
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.route('**/raw.githubusercontent.com/**', lambda route:route.abort())
    page.route('**/api.github.com/**', lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'number':int(route.request.url.split('/')[-1]),'state':'open','draft':True,'merged':False,'updated_at':'2026-11-22T00:00:00Z'})))
    page.set_content(HTML,wait_until='load',timeout=15000)
    page.wait_for_function("document.getElementById('kpi-fronts').textContent==='6'",timeout=15000)
    assert page.locator('.node').count()==6,('nodes',page.locator('.node').count(),errors)
    assert page.locator('#kpi-subfronts').inner_text()=='16'
    page.locator('.node').filter(has_text='WhatsApp').click()
    assert page.locator('#subgrid .sub-node').count()==3,(page.locator('#subgrid .sub-node').count(),errors)
    assert page.locator('#history-list .history-item').count()==4
    page.locator('button[data-filter="bug"]').click()
    assert page.locator('#history-list .history-item').count()>=1
    assert '/issues/289' in page.locator('#history-list .history-item').first.get_attribute('href')
    page.locator('button[data-filter="all"]').click()
    page.locator('#history-more').click()
    assert page.locator('#history-list .history-item').count()>4
    page.locator('#subgrid .sub-node').first.click()
    assert page.locator('.crumb').count()>=2
    page.locator('.crumb').first.click()
    assert page.locator('#detail-title').inner_text()=='WhatsApp'
    page.locator('#roles-toggle').click()
    assert page.locator('#roles-toggle').get_attribute('aria-pressed')=='true'
    page.wait_for_timeout(150)
    extent=page.evaluate('({vw:innerWidth,sw:document.documentElement.scrollWidth,wires:document.querySelectorAll("#wires path").length,subwires:document.querySelectorAll("#subwires path").length})')
    assert extent['sw']<=extent['vw']+1,extent
    assert extent['wires']==6,extent
    assert extent['subwires']==3,extent
    assert not errors,errors
    page.screenshot(path=str(ROOT/f'preview_{name}.png'),full_page=True,animations='disabled',timeout=12000)
    print(name,'PASS',extent,flush=True)
    page.close()
  # arbitrary CTO data: top node, nested multi level, bug link
  s=json.loads((ROOT/'snapshot.json').read_text());s['nodes']=[{'id':'projeto-x','parentId':None,'title':'Projeto especial','status':'planejado'},{'id':'parte-y','parentId':'projeto-x','title':'Grupo de trabalho','status':'em_execucao'},{'id':'atividade-z','parentId':'parte-y','title':'Entrega Z','status':'nao_verificado'}];s['records']=[{'nodeId':'atividade-z','kind':'bug','number':289,'title':'Problema Z','url':f'https://github.com/{s["repository"]}/issues/289'}];s['relations']=[]
  snippet=json.dumps(s,ensure_ascii=False).replace('<','\\u003c');altered=re.sub(r'(<script type="application/json" id="embedded-snapshot">).*?(</script>)',lambda m:m.group(1)+snippet+m.group(2),HTML,flags=re.S)
  page=browser.new_page(viewport={'width':390,'height':844});page.route('**/raw.githubusercontent.com/**',lambda route:route.abort());errs=[];page.on('pageerror',lambda e:errs.append(str(e)));page.set_content(altered);page.wait_for_function("document.getElementById('kpi-fronts').textContent==='1'")
  assert page.locator('.node').count()==1
  page.locator('.node').click();page.locator('.sub-node').click();assert page.locator('#subgrid .sub-node').count()==1
  page.locator('.sub-node').click();assert page.locator('#history-list .history-item').count()==1
  assert not errs,errs
  print('CUSTOM_DYNAMIC PASS')
  page.close()
  # zero fronts - explicit clean empty state
  s['nodes']=[];s['records']=[]
  snippet=json.dumps(s,ensure_ascii=False).replace('<','\\u003c');altered=re.sub(r'(<script type="application/json" id="embedded-snapshot">).*?(</script>)',lambda m:m.group(1)+snippet+m.group(2),HTML,flags=re.S)
  page=browser.new_page(viewport={'width':320,'height':720});page.route('**/raw.githubusercontent.com/**',lambda route:route.abort());page.set_content(altered);page.wait_for_function("document.getElementById('kpi-fronts').textContent==='0'");assert page.locator('#empty-map').is_visible();assert page.locator('#detail').is_hidden();print('EMPTY_STATE PASS');page.close()
  browser.close()