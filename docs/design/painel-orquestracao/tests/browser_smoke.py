"""Smoke read-only de grupos dinâmicos, rotas e responsividade; GitHub simulado."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re,shutil

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'FUNIX_Painel_Orquestracao_Funcional.html').read_text()
BASE=json.loads((ROOT/'snapshot.json').read_text())

def html_with_snapshot(snapshot):
  literal=json.dumps(snapshot,ensure_ascii=False).replace('<','\u003c')
  return re.sub(r'(<script type="application/json" id="embedded-snapshot">).*?(</script>)',lambda m:m.group(1)+literal+m.group(2),HTML,flags=re.S)

def configure(page):
  page.route('**/api.github.com/**',lambda route: route.fulfill(status=200,content_type='application/json',body=json.dumps({'number':int(route.request.url.split('/')[-1]),'state':'open','draft':True,'merged':False,'updated_at':'2026-11-22T00:00:00Z'})))

with sync_playwright() as p:
  installed=shutil.which('chromium') or shutil.which('google-chrome')
  launch=dict(headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--no-zygote'])
  if installed: launch['executable_path']=installed
  browser=p.chromium.launch(**launch)
  for width,height,name in [(1440,900,'desktop'),(390,844,'mobile'),(320,760,'small')]:
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    configure(page)
    page.set_content(HTML,wait_until='load',timeout=15000)
    page.wait_for_function('document.querySelectorAll(".project-group").length===1',timeout=15000)
    assert page.locator('.project-group').count()==1
    assert page.locator('#detail').is_hidden()
    assert page.locator('.project-children .node').count()==6
    assert page.locator('#subgrid .sub-node').count()==6
    assert 'FunixApp' in page.locator('.project-name').inner_text()
    page.locator('.project-toggle').click()
    assert page.locator('.project-children').is_hidden()
    assert page.locator('.project-toggle').get_attribute('aria-expanded')=='false'
    page.locator('.project-toggle').click()
    assert page.locator('.project-children').is_visible()
    page.locator('.project-children > .tree-branch').first.locator('.branch-toggle').click()
    assert page.locator('.branch-children').first.is_visible()
    assert page.locator('.branch-children').first.locator('.node').count()==3
    page.locator('.project-children .node').first.click()
    assert page.locator('#detail').is_visible()
    assert page.locator('#detail-title').inner_text()=='Comercial'
    assert page.locator('#subgrid .sub-node').count()==3
    assert page.locator('.crumb').count()>=2
    page.locator('.crumb').first.click()
    assert page.locator('#detail-title').inner_text()=='FunixApp'
    for value in ['pr','issue','bug','all']:
      page.locator(f'button[data-filter="{value}"]').click()
      assert page.locator(f'button[data-filter="{value}"]').get_attribute('aria-pressed')=='true'
    page.locator('#detail-close').click()
    assert page.locator('#detail').is_hidden()
    page.wait_for_timeout(100)
    extent=page.evaluate('({vw:innerWidth,sw:document.documentElement.scrollWidth,wires:document.querySelectorAll("#wires path").length})')
    assert extent['sw']<=extent['vw']+1,extent
    assert extent['wires']>=1,extent
    assert not errors,errors
    page.screenshot(path=str(ROOT/f'agrupado_{name}.png'),full_page=True)
    print(name,'PASS',extent,flush=True)
    page.close()
  # Dois grupos, trabalho avulso e terceiro nível definidos pelo CTO.
  custom=json.loads((ROOT/'snapshot.json').read_text())
  custom['nodes']=[
    {'id':'projeto-x','parentId':None,'presentation':'group','type':'Programa','title':'Projeto especial','status':'planejado'},
    {'id':'projeto-y','parentId':None,'presentation':'group','title':'Projeto B','status':'planejado'},
    {'id':'parte-y','parentId':'projeto-x','title':'Grupo de trabalho','status':'em_execucao','statusReason':'Teste sintético','updatedAt':'2026-11-22T00:00:00Z','evidence':[{'kind':'bug','number':289}]},
    {'id':'atividade-z','parentId':'parte-y','title':'Entrega Z','status':'nao_verificado'},
    {'id':'avulso','parentId':None,'title':'Atividade independente','status':'planejado'}]
  custom['records']=[{'nodeId':'atividade-z','kind':'bug','number':289,'title':'Problema Z','url':f'https://github.com/{custom["repository"]}/issues/289'}]
  custom['relations']=[]
  page=browser.new_page(viewport={'width':390,'height':844})
  configure(page)
  errs=[]
  page.on('pageerror',lambda e:errs.append(str(e)))
  page.set_content(html_with_snapshot(custom))
  page.wait_for_function('document.querySelectorAll(".project-group").length===2')
  assert page.locator('.project-group').count()==2
  assert 'Projeto especial' in page.locator('.project-name').all_inner_texts()
  assert 'Projeto B' in page.locator('.project-name').all_inner_texts()
  assert page.locator('#detail').is_hidden()
  assert page.locator('#node-grid > .node').count()==1
  page.locator('.project-children .node').first.click()
  page.locator('.sub-node').click()
  page.locator('button[data-filter="bug"]').click()
  assert page.locator('#history-list .history-item').count()==1
  assert '/issues/289' in page.locator('#history-list .history-item').first.get_attribute('href')
  assert not errs,errs
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
  print('CUSTOM_DYNAMIC PASS')
  page.close()
  # Legado sem grupos ainda mostra cards avulsos.
  custom['nodes']=[{'id':'solto','title':'Frente livre','status':'planejado'}];custom['records']=[]
  page=browser.new_page(viewport={'width':390,'height':844})
  page.set_content(html_with_snapshot(custom));page.wait_for_function('document.querySelectorAll("#node-grid > .node").length===1')
  assert page.locator('.project-group').count()==0
  assert page.locator('#node-grid > .node').count()==1
  assert page.locator('#detail').is_hidden()
  page.close()
  # Mapa vazio não produz projeto/cargos fictícios.
  custom['nodes']=[];custom['records']=[]
  page=browser.new_page(viewport={'width':320,'height':720})
  page.set_content(html_with_snapshot(custom));page.wait_for_function('document.querySelectorAll("#node-grid > *").length===0')
  assert page.locator('#empty-map').is_visible()
  assert page.locator('#detail').is_hidden()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  print('EMPTY PASS')
  browser.close()
