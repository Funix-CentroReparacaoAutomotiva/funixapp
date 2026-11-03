"""Render the supplied HTML locally with synthetic adapter data. Not jsreport/VPS homologation."""
import asyncio,json,re,subprocess
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
INPUT=ROOT/'.runtime/pr39-template-render'
OUTPUT=ROOT/'docs/evidencias/pr39-template'
async def run():
 OUTPUT.mkdir(parents=True,exist_ok=True)
 rendered=json.loads((INPUT/'results.json').read_text());results=[];external=[]
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':816,'height':1123},device_scale_factor=1)
  async def intercept(route):
   if route.request.url=='https://funix.com.br/assets/logo-header.svg':
    # Only a test placeholder; the real logo/network are deliberately not requested.
    await route.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="140" height="25"><text x="0" y="20" fill="#0A1F44" font-family="Arial" font-weight="bold" font-size="23">FUNIX QA</text></svg>')
   else:external.append(route.request.url);await route.abort()
  await context.route('**/*',intercept)
  for case in rendered['results']:
   name=case['case'];data=json.loads((INPUT/(name+'.json')).read_text());page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.set_content((INPUT/(name+'.html')).read_text(),wait_until='networkidle');await page.evaluate('document.fonts.ready')
   text=await page.locator('body').inner_text();assert data['meta']['id']in text;assert data['financeiro']['totalVista']in text
   assert not re.search(r'undefined|NaN|{{',text);assert not errors
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   assert await page.get_by_text('Investimento e condições',exact=True).count()==1
   # Browser corrects the omitted </td> in the supplied reference without changing the file.
   row=page.get_by_text(data['diagnosticos'][0]['nome'],exact=True).first.locator('xpath=ancestor::tr[1]');assert await row.locator(':scope > td').count()==2
   if name=='empty-details':assert text.count('Não informado')==2
   if name=='free':assert 'Sem cobrança'in text
   if name=='discount':assert '- R$ 50,00'in text;assert 'R$ 250,15'in text;assert 'R$ 450,15'in text
   if name=='normal':assert '- R$ 0,00'not in text;assert 'alert(1)'in text;assert await page.locator('script').count()==0;assert await page.locator('b').count()==0
   for value in data['parcelamento'].values():assert value['valorParcela']in text and value['total']in text
   if name in ['discount','free','long','components']:
    await page.screenshot(path=str(OUTPUT/(name+'-template.png')),full_page=True)
   pdf=INPUT/(name+'.pdf');await page.pdf(path=str(pdf),format='A4',print_background=True)
   content=subprocess.check_output(['pdftotext','-raw',str(pdf),'-'],text=True)
   assert data['meta']['id']in content and data['financeiro']['totalVista']in content
   assert 'Sobre este Orçamento'in content and 'FUNIX Centro de Reparação Automotiva LTDA'in content
   assert all(plan['total']in content and plan['valorParcela']in content for plan in data['parcelamento'].values())
   info=subprocess.check_output(['pdfinfo',str(pdf)],text=True);pages=int(re.search(r'^Pages:\s+(\d+)',info,re.M)[1]);assert pages>=1
   if name=='long':assert pages>1;assert all(re.sub(r'\s+','',d['nome'])in re.sub(r'\s+','',content)for d in data['diagnosticos'])
   results.append({'case':name,'pass':True,'pages':pages,'pieces':len(data['diagnosticos']),'displayedSumDifferenceCents':case['displayedSumDifferenceCents']})
   print('PASS',name,': local Handlebars + Chromium A4,',pages,'pages, contract/escaped data/terms/finance/PDF text',flush=True);await page.close()
  assert not external
  await context.close();await browser.close()
 (OUTPUT/'resultados.json').write_text(json.dumps({'synthetic':True,'realJsreport':False,'logo':'Local synthetic placeholder; no network access','handlebars':rendered['handlebars'],'templateSha256':rendered['templateSha256'],'externalRequests':external,'results':results},ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':asyncio.run(run())
