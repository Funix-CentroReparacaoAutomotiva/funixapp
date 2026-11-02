from mr_percent import select_mr
"""Etapa D: official calculation/API, isolated synthetic file SQLite, desktop/mobile states."""
import asyncio,json,subprocess,traceback,sqlite3,hashlib
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
from scenario_ui import select_named_scenario
ARTIFACTS=ROOT/'docs/evidencias/etapa-d'

async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{performanceCases,performanceFixture}from'./server/tests/fixtures/performance.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=performanceFixture(db,performanceCases[0]);const cfg=f.pricing.get();cfg.config.resaleMultipliers=[{id:'m100',name:'Neutro QA',factor:'1'},{id:'m120',name:'Padrão QA',factor:'1.2'},{id:'m135',name:'QA 35',factor:'1.35'},{id:'m080',name:'QA redução',factor:'0.8'},{id:'mnull',name:'QA pendente',factor:null}];f.pricing.save({revision:cfg.revision,config:cfg.config});f.pricing.saveSettings(f.at.id,{revision:f.pricing.settings(f.at.id).revision,mrId:'m120'});let parts=f.components.list(f.at.id);for(const [i,p]of parts.entries())f.components.save(f.at.id,{revision:p.revision,pieceId:p.pieceId,name:p.name,notes:p.notes,manualPrice:i===0?'100.01':i===1?'10.01':'0',quantity:i===0?'2':i===1?'0.25':'3'},p.id);const s=f.scenarios.list(f.at.id)[0],other=f.scenarios.create(f.at.id,{name:'Outro cenário QA',duplicateFrom:s.id,sourceRevision:s.revision});f.scenarios.update(f.at.id,other.id,{revision:other.revision,componentFlags:{[parts[0].id]:false}});const b=new BudgetRepository(db),r={scenarioId:s.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'etapa-d-frozen-version'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,piece:f.item.id,parts:parts.map(p=>p.id),version:v.id,snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def write(path,data,method='patch'):
   r=await getattr(ctx.request,method)(ORIGIN+path,headers={'Origin':ORIGIN},data=data);assert r.ok,await r.text();return await r.json()
  async def ws():return await get(base+'/cenarios')
  def money(value):
   whole,_,fraction=value.partition('.');return 'R$ '+f'{int(whole):,}'.replace(',','.')+','+fraction.ljust(2,'0')
  await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await h.login(page);await page.locator('.diagnosis-open').first.click()
  editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True);finance=page.get_by_role('region',name='Painel financeiro',exact=True)
  async def saved():await expect(editor).to_have_attribute('data-save-state','confirmed')
  def row(i=0):return editor.locator('.component').nth(i)
  async def shot(name):
   await row().scroll_into_view_if_needed();await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  async def official(scenario=0):
   w=await ws();calc=w['calculations'][scenario]
   for part in w['components']:
    r=editor.locator('[data-component-id="'+part['id']+'"]');line=next(l for l in calc['lines']if l['kind']=='component'and l['id']==part['id'])
    out=r.get_by_label('Total do componente',exact=True)
    if not line['included']:await expect(out).to_have_text('Fora do orçamento')
    elif line['total']is not None:await expect(out).to_have_text(money(line['total']))
   return w
  await saved();await expect(row().get_by_label('MR do componente',exact=True)).to_have_text('+20%');w=await official()
  pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert pdf.ok;pdf_hash=hashlib.sha256(await pdf.body()).hexdigest()
  # Two rows, exact DOM/order and geometry. The MR is output, not an editable selector.
  first=row().locator('.component-first-line');second=row().locator('.component-values')
  boxes=[await n.bounding_box()for n in [first.get_by_role('button',name='Habilitar componente neste cenário'),first.get_by_label('Descrição do componente'),first.get_by_role('button',name='Excluir componente')]]
  assert boxes[0]['x']<boxes[1]['x']<boxes[2]['x']and max(b['y']+b['height']/2 for b in boxes)-min(b['y']+b['height']/2 for b in boxes)<5
  assert await second.locator(':scope > *').evaluate_all('(es)=>es.map(e=>e.innerText.split("\\n")[0])')==['Qtd.','Preço unitário (R$)','MR','Total']
  positions=[await second.locator(':scope > *').nth(i).bounding_box()for i in range(4)];assert max(p['y']for p in positions)-min(p['y']for p in positions)<3
  assert await row().get_by_role('combobox').count()==0 and await editor.locator('.bottom-label').count()==0
  assert 'Salvamento automático'not in await editor.inner_text();await expect(editor.get_by_role('status')).to_have_count(0);await shot('mr-total-confirmado')
  assert next(l for l in w['calculations'][0]['lines']if l['id']==ids['parts'][0])['total']=='240.1'
  assert next(l for l in w['calculations'][0]['lines']if l['id']==ids['parts'][1])['total']=='3.0125'
  await expect(row(2).get_by_label('Total do componente')).to_have_text('R$ 0,00')
  h.mark(device+': two compact ordered rows, read-only MR +20%, official unit ceiling before quantity, fractional cents and manual zero, no permanent autosave label')
  # Only one existing pricing-config GET, shared by finance and editor.
  config_gets=[r for r in h.api_requests if r['path']=='/api/precificacao'and r['method']=='GET'];assert len(config_gets)==1,config_gets
  await finance.locator('.summary').click()
  for mr,label in [('m100','0%'),('m135','+35%'),('m080','−20%'),('m120','+20%')]:
   await select_mr(finance,mr);await expect(row().get_by_label('MR do componente')).to_have_text(label);w=await official()
   if mr=='m080':assert w['settings']['mrId']==mr
   else:assert w['settings']['mrPercent']=={'m100':'0','m135':'35','m120':'20'}[mr]
   await expect(finance.locator('.metric').nth(1)).to_contain_text(money(w['calculations'][0]['componentSubtotal']))
  h.mark(device+': MR factors 1/1.35/0.8/1.2 selected only in finance, exact percentages and every component/subtotal match backend; one shared configuration GET')
  # Keep stale workspace response in flight after changing the global MR.
  started=asyncio.Event();release=asyncio.Event()
  async def hold_workspace(route):started.set();await release.wait();await route.continue_()
  await page.route('**/cenarios?*',hold_workspace);await select_mr(finance,'m135');await asyncio.wait_for(started.wait(),10)
  for i in range(3):await expect(row(i).get_by_label('Total do componente')).to_have_text('Calculando…')
  await finance.locator('.summary').click();await shot('mr-recalculando');release.set();await expect(row().get_by_label('MR do componente')).to_have_text('+35%');await official();await page.unroute('**/cenarios?*',hold_workspace)
  h.mark(device+': pending MR confirmation invalidates every component and finance; old totals are never presented as current')
  # Missing MR and missing price remain distinct from zero, persisted through real API.
  await finance.locator('.summary').click();await select_mr(finance,'');await expect(row().get_by_label('MR do componente')).to_have_text('Não configurado');await expect(row().get_by_label('Total do componente')).to_have_text('MR não configurado')
  await finance.locator('.summary').click();await shot('mr-pendente')
  await finance.locator('.summary').click();await select_mr(finance,'mnull');await expect(row().get_by_label('Total do componente')).to_have_text('MR não configurado')
  await select_mr(finance,'m120');await expect(row().get_by_label('MR do componente')).to_have_text('+20%');await finance.locator('.summary').click()
  await row().get_by_label('Preço unitário do componente',exact=True).fill('');await saved();await expect(row().get_by_label('Total do componente')).to_have_text('Preço não informado');assert(await ws())['components'][0]['manualPrice']is None
  await shot('preco-pendente');await row().get_by_label('Preço unitário do componente',exact=True).fill('0');await saved();await expect(row().get_by_label('Total do componente')).to_have_text('R$ 0,00')
  h.mark(device+': absent/null configured MR and absent manual price show pending states; explicit manual zero remains valid and persisted')
  # Rapid edits during actual in-flight save: latest name, quantity and price win.
  entered=asyncio.Event();release=asyncio.Event()
  async def hold_part(route):
   if route.request.method=='PATCH':entered.set();await release.wait()
   await route.continue_()
  await page.route('**/componentes/*',hold_part);await row().get_by_label('Preço unitário do componente').fill('100,01');await asyncio.wait_for(entered.wait(),10)
  await row().get_by_label('Quantidade do componente').fill('0,25');await row().get_by_label('Descrição do componente').fill('Componente QA final');await expect(row().get_by_label('Total do componente')).to_have_text('Calculando…');await shot('autosave-pendente')
  release.set();await saved();await page.unroute('**/componentes/*',hold_part);w=await official();part=w['components'][0];assert(part['name'],part['quantity'],part['manualPrice'])==('Componente QA final','0.25','100.01')
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:
   actual=db.execute('SELECT name,quantity,manual_price FROM component_items WHERE id=?',(part['id'],)).fetchone();assert actual==('Componente QA final','0.25','100.01')
  h.mark(device+': typing name/quantity/price during delayed autosave retains last input, stable IDs and official total; independent SQL confirms persisted values')
  # Recover transport errors, actual conflict and committed-but-lost response.
  for fault in ['http','lost-response','conflict']:
   before=await ws();part=before['components'][0];count=0
   if fault=='conflict':await write(base+'/componentes/'+part['id'],{**{k:part[k]for k in ['revision','pieceId','name','quantity','manualPrice','notes']},'name':'Outra edição QA'})
   async def fail(route):
    nonlocal count
    if route.request.method!='PATCH':await route.continue_();return
    count+=1
    if fault=='http':await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'message':'QA indisponível','code':'QA_FAILURE'}}))
    elif fault=='lost-response':await route.fetch();await route.abort('failed')
    else:await route.continue_()
   await page.route('**/componentes/*',fail);desired='Pendente QA '+fault;await row().get_by_label('Descrição do componente').fill(desired)
   await expect(editor.get_by_role('alert')).to_be_visible();await expect(row().get_by_label('Total do componente')).to_have_text('Valor não atualizado');await expect(row().get_by_label('Descrição do componente')).to_have_value(desired)
   if fault=='http':await shot('erro-preservado')
   await page.unroute('**/componentes/*',fail)
   if fault=='conflict':
    await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await expect(editor.get_by_role('alert')).to_contain_text('Campos locais preservados');await expect(row().get_by_label('Descrição do componente')).to_have_value(desired)
    await editor.get_by_role('button',name='Carregar versão salva',exact=True).click();await saved();await expect(row().get_by_label('Descrição do componente')).to_have_value('Outra edição QA')
   else:
    await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await saved();assert(await ws())['components'][0]['name']==desired
   assert count==1;await official()
  h.mark(device+': HTTP failure, real revision conflict and lost committed response preserve pending fields; explicit reconcile/reload recovers without duplicate writes')
  # Inclusion is scenario-specific; deletion is global and requires confirmation.
  await row().get_by_role('button',name='Habilitar componente neste cenário').click();await saved();await expect(row().get_by_label('Total do componente')).to_have_text('Fora do orçamento');await shot('fora-do-orcamento')
  w=await ws();assert w['scenarios'][0]['componentFlags'][ids['parts'][0]]==False and len(w['components'])==3
  await select_named_scenario(page,'Cenário 2');await page.locator('.diagnosis-open').first.click();await saved();await expect(row().get_by_label('Total do componente')).to_have_text('Fora do orçamento')
  await row().get_by_role('button',name='Habilitar componente neste cenário').click();await saved();w=await official(1);assert not w['scenarios'][0]['componentFlags'][ids['parts'][0]]and w['scenarios'][1]['componentFlags'][ids['parts'][0]]
  h.accept_dialogs=False;await row(1).get_by_role('button',name='Excluir componente').click();assert len((await ws())['components'])==3
  h.accept_dialogs=True;deleted=ids['parts'][1];await row(1).get_by_role('button',name='Excluir componente').click();await expect(editor.locator('.component')).to_have_count(2)
  w=await ws();assert len(w['components'])==2 and all(deleted not in s['componentFlags']for s in w['scenarios'])and any('TODOS os cenários'in d for d in h.dialogs)
  assert len({p['id']for p in w['components']})==len(w['components'])
  h.mark(device+': toggle changes only active-scenario mask; global trash cancel/confirm affects all scenarios, preserves remaining identities and does not duplicate rows')
  version=await get(base+'/orcamentos/'+ids['version']);assert version['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==pdf_hash
  for width in ([320,390]if device=='mobile'else[1440]):
   await page.set_viewport_size({'width':width,'height':viewport['height']});await row().scroll_into_view_if_needed();assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   sizes=await row().locator('.component-values input').evaluate_all('(es)=>es.map(e=>e.getBoundingClientRect().width)');assert min(sizes)>=50,sizes
   assert await editor.locator('.bottom-label').count()==0
   if width==320:await shot('estreito-320')
  assert not h.external and not h.page_errors,(h.external,h.page_errors)
  h.mark(device+': immutable issued snapshot/PDF survive changes/deletion; 390/320 responsive widths have legible inputs and no horizontal overflow; no external requests/page errors')
 except Exception as error:
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
  h.results.append({'name':device+': failure','pass':False,'error':str(error),'traceback':traceback.format_exc()});raise
 finally:
  (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'device':device,'synthetic':True,'results':h.results,'external':h.external,'pageErrors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
  if ctx:await ctx.close()
  h.cleanup()

async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True)
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  try:
   for device,viewport in [('desktop',{'width':1440,'height':1000}),('mobile',{'width':390,'height':844})]:await device_case(browser,device,viewport)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
