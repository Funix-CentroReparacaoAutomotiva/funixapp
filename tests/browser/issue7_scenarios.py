"""Issue #7 phase 1 real API/SQLite/browser, synthetic data only."""
import asyncio,json,re,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN

from scenario_ui import menu,active_scenario,select_named_scenario,add_scenario,compare

ARTIFACTS=ROOT/'docs/evidencias/issue7'

async def run():
 h=Harness(); browser=None; error=None
 artifacts=ARTIFACTS;artifacts.mkdir(parents=True,exist_ok=True)
 try:
  h.check_ports();await h.start_api()
  vite=h.start(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'vite');await h.ready(ORIGIN,vite)
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   ctx=await browser.new_context(viewport={'width':1440,'height':960});await h.watch(ctx)
   page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN+'/funil');await h.login(page)
   async def write(path,data,method='post'):
    r=await getattr(ctx.request,method)(ORIGIN+path,headers={'Origin':ORIGIN},data=data);assert r.ok,await r.text();return await r.json()
   at=await write('/api/atendimentos',{'phone':'123','name':'QA CENÁRIOS — SINTÉTICO'})
   catalogs=await (await ctx.request.get(ORIGIN+'/api/catalogos')).json()
   piece=next(i for i in catalogs['items'] if i['code']=='capo')
   await write('/api/catalogos/'+piece['id'],{'revision':piece['revision'],'status':'validado'},'patch')
   service=await write('/api/catalogos',{'kind':'servico','name':'Serviço QA repetido','status':'validado'})
   path='/api/atendimentos/'+at['id']
   item=(await write(path+'/diagnosticos',{'pieceCodes':['capo']}))[0]
   item=await write(path+'/diagnosticos/'+item['id'],{'revision':item['revision'],'services':[{'serviceId':service['id'],'quantity':'0.25'},{'serviceId':service['id'],'quantity':'2'}]},'patch')
   await page.goto(ORIGIN+'/atendimentos/'+at['id']+'?aba=diagnosticos')
   await expect(active_scenario(page,'Cenário 1')).to_be_visible()
   await add_scenario(page)
   await expect(active_scenario(page,'Cenário 2')).to_be_visible()
   await compare(page)
   matrix=page.get_by_role('region',name='Matriz de cenários')
   await expect(matrix.locator('tbody tr')).to_have_count(3)
   await matrix.get_by_label('Cenário 2: incluir serviço '+item['services'][0]['id'],exact=True).click()
   await expect(matrix.get_by_label('Cenário 2: incluir serviço '+item['services'][0]['id'],exact=True)).not_to_be_checked()
   await expect(matrix.get_by_label('Cenário 1: incluir serviço '+item['services'][0]['id'],exact=True)).to_be_checked()
   await page.get_by_label('Só diferenças',exact=True).check()
   await expect(matrix.locator('tbody tr')).to_have_count(2)
   await matrix.get_by_label('Cenário 2: incluir peça Capô',exact=True).click()
   await expect(matrix.locator('tbody tr')).to_have_count(3)
   await matrix.get_by_label('Cenário 2: incluir peça Capô',exact=True).click()
   await expect(matrix.locator('tbody tr')).to_have_count(2)
   await page.screenshot(path=str(artifacts/'cenarios-desktop.png'))
   h.mark('duplicate scenario copies only flags; repeated service rows have independent checkboxes; parent restores flags; differences keeps context')
   await compare(page)
   await page.get_by_role('button',name='Diagnósticos',exact=True).click()
   await page.locator('.diagnosis-open').first.click()
   await page.get_by_role('button',name='Observação da peça',exact=True).click()
   await page.get_by_role('textbox',name='Observação da peça',exact=True).fill('Edição global QA')
   await expect(page.locator('.approved-editor').get_by_role('status')).to_contain_text('Salvo')
   await page.get_by_role('button',name='Voltar aos Diagnósticos',exact=True).click()
   await select_named_scenario(page,'Cenário 1')
   await page.locator('.diagnosis-open').first.click()
   await page.get_by_role('button',name='Observação da peça',exact=True).click()
   await expect(page.get_by_role('textbox',name='Observação da peça',exact=True)).to_have_value('Edição global QA')
   h.mark('editing master attributes in one scenario changes the same line in the other scenario')
   await h.restart_api();await ctx.close()
   ctx=await browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);await h.watch(ctx)
   page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN+'/atendimentos/'+at['id']+'?aba=diagnosticos');await h.login(page)
   await compare(page)
   matrix=page.get_by_role('region',name='Matriz de cenários')
   await expect(matrix.locator('tbody tr')).to_have_count(3)
   assert await matrix.evaluate('(el)=>el.scrollWidth>el.clientWidth')
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   await expect(matrix.get_by_label('Cenário 2: incluir serviço '+item['services'][0]['id'],exact=True)).not_to_be_checked()
   await page.screenshot(path=str(artifacts/'cenarios-mobile.png'))
   h.mark('fresh mobile browser after API restart preserves scenarios and masks; matrix scrolls horizontally inside V20')
   assert not h.external and not h.page_errors,(h.external,h.page_errors)
   await browser.close();browser=None
 except Exception as e:error=str(e) or type(e).__name__;traceback.print_exc()
 finally:
  if browser:
   try:await browser.close()
   except Exception:pass
  h.cleanup();(artifacts/'cenarios-resultados.json').write_text(json.dumps({'assertions':h.results,'error':error,'external_hosts':h.external,'page_errors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
 if error:raise SystemExit(1)

if __name__=='__main__':asyncio.run(run())
