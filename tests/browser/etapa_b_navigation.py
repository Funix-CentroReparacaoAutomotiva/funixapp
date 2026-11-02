"""Etapa B: real local API, synthetic file SQLite, desktop and emulated touch viewport."""
import asyncio,json,subprocess,traceback,hashlib,unicodedata
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/etapa-b'

async def device_case(browser,device,viewport):
 h=Harness();ctx=None;page=None
 try:
  h.check_ports()
  setup="""import{writeFileSync}from'node:fs';import{createHash}from'node:crypto';import{openDatabase}from'./server/database.ts';import{performanceCases,performanceFixture}from'./server/tests/fixtures/performance.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=performanceFixture(db,performanceCases[1]);const b=new BudgetRepository(db),r={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'etapa-b-frozen-version'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,version:v.id,snapshot:v.snapshot,pdfHash:createHash('sha256').update(b.pdf(f.at.id,v.id)).digest('hex')}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api()
  vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device=='mobile',has_touch=device=='mobile');await h.watch(ctx);page=await ctx.new_page();await h.attach(page)
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok;return await r.json()
  async def menu():
   await page.locator('.scenario-trigger').click();return page.get_by_role('menu',name='Cenários do Atendimento')
  async def back():await page.locator('.detail-header .back-detail').click()
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+unicodedata.normalize('NFD',name).encode('ascii','ignore').decode()+'.png')))
  async def main(tab):await page.get_by_role('navigation',name='Visões do Atendimento').get_by_role('button',name=tab,exact=True).click()
  async def saved():await expect(page.get_by_role('region',name='Editor de diagnóstico')).to_have_attribute('data-save-state','confirmed')
  await page.goto(ORIGIN+'/funil');await h.login(page)
  await page.locator('.fh-card').first.click()
  await expect(page.get_by_role('navigation',name='Visões do Atendimento')).to_be_visible();await shot('chat')
  await main('Diagnósticos');await expect(page.locator('.diagnosis-card.diagnosis-row')).to_have_count(20);await shot('diagnosticos')
  requests=[]
  def capture(r):
   if '/api/'in r.url:requests.append((r.method,r.url.split('?')[0]))
  page.on('request',capture)
  body=page.locator('.diagnostics-body');await body.evaluate('(e)=>e.scrollTop=500');await page.wait_for_timeout(100);old_scroll=await body.evaluate('(e)=>e.scrollTop')
  target=page.locator('.diagnosis-open').nth(5);piece_text=await target.locator('.diagnosis-title strong').inner_text();await target.click()
  await expect(page.locator('.detail-header h1')).to_have_text(piece_text.rstrip(':'))
  await expect(page.get_by_role('navigation',name='Visões do Atendimento')).to_have_count(0)
  await expect(page.locator('.diagnosis-list')).to_have_count(0);await expect(page.locator('.editor-back')).to_have_count(0)
  await expect(page.get_by_role('region',name='Editor de diagnóstico')).to_be_visible();await shot('editor')
  # Header back restores list position; native forward/back restores the same inner route.
  piece_url=page.url;await back();await expect(page.locator('.diagnosis-list')).to_be_visible()
  assert abs(await body.evaluate('(e)=>e.scrollTop')-old_scroll)<3
  await page.go_forward();await expect(page).to_have_url(piece_url);await expect(page.locator('.detail-header h1')).to_have_text(piece_text.rstrip(':'))
  await page.go_back();await expect(page.locator('.diagnosis-list')).to_be_visible()
  assert not any(url.endswith(base)for _,url in requests)
  h.mark(device+': piece is a full contextual screen; single header back, native back/forward, list scroll and record identity preserved without Atendimento reload')

  m=await menu();radio=m.get_by_role('menuitemradio');assert [x.replace('✓','').strip()for x in await radio.all_inner_texts()]==['1','2','3']
  await m.get_by_role('menuitemradio',name='Cenário 2',exact=True).click();await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 2')
  selected=(await get(base+'/cenarios'))['scenarios'][1]
  m=await menu();await m.get_by_role('menuitem',name='+ Nova variação',exact=True).click();await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 4')
  w=await get(base+'/cenarios');created=w['scenarios'][-1]
  assert created['pieceFlags']==selected['pieceFlags']and created['serviceFlags']==selected['serviceFlags']and created['componentFlags']==selected['componentFlags']
  m=await menu();await m.get_by_role('button',name='Excluir Cenário 4',exact=True).click();await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 1')
  m=await menu();await m.get_by_role('menuitemradio',name='Cenário 2',exact=True).click();await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 2')
  h.mark(device+': numeric scenarios, accessible plus/matrix, copy of inclusions, selection and deletion preserve existing contracts')

  m=await menu();await m.get_by_role('menuitem',name='Comparação',exact=True).click();await expect(page.locator('.detail-header h1')).to_have_text('Comparação de cenários')
  matrix=page.get_by_role('region',name='Matriz de cenários',exact=True);await expect(matrix).to_be_visible();await expect(page.locator('.view-switch')).to_have_count(0)
  await page.get_by_label('Só diferenças',exact=True).check();await page.get_by_label('Só diferenças',exact=True).uncheck()
  check=matrix.get_by_role('checkbox').nth(0);value=await check.is_checked();await check.click();await expect(check).to_be_checked(checked=not value);await expect(check).to_be_enabled()
  assert (await get(base+'/cenarios'))['scenarios'][0]['pieceFlags']!=selected['pieceFlags']
  await matrix.evaluate('(e)=>e.scrollLeft=200')
  if device=='mobile':assert await matrix.evaluate('(e)=>e.scrollWidth>e.clientWidth')
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');await shot('comparacao');await page.go_back()
  await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 2')
  h.mark(device+': full comparison preserves differences filter, scenario flags, calculated cells, horizontal mobile scrolling and native return')

  m=await menu();await m.get_by_role('menuitem',name='Orçamentos emitidos',exact=True).click();await expect(page.locator('.detail-header h1')).to_have_text('Orçamentos emitidos');await expect(page.locator('.view-switch')).to_have_count(0);await shot('orcamentos')
  await page.get_by_role('button',name='Orçamento A ·',exact=False).click();await expect(page.locator('.detail-header h1')).to_have_text('Orçamento A')
  async with page.expect_download()as download:await page.get_by_role('button',name='Baixar PDF A',exact=True).click()
  path=await(await download.value).path();assert hashlib.sha256(path.read_bytes()).hexdigest()==ids['pdfHash']
  assert (await get(base+'/orcamentos/'+ids['version']))['snapshot']==ids['snapshot'];await shot('versao')
  await back();await expect(page.locator('.detail-header h1')).to_have_text('Orçamentos emitidos');await page.go_forward();await expect(page.locator('.detail-header h1')).to_have_text('Orçamento A');await page.go_back();await expect(page.locator('.detail-header h1')).to_have_text('Orçamentos emitidos');await back();await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-label','Cenários: Cenário 2')
  h.mark(device+': issued budgets and version are contextual screens, hierarchical back preserves scenario, immutable snapshot and original PDF hash')

  for label in ['Chat','Diagnósticos','Mapa']:
   await main(label);await expect(page.locator('.copilot-fixed')).to_be_visible()
   for expanded in [False,True]:
    finance=page.locator('.approved-finance');summary=finance.locator('.summary')
    if(await summary.get_attribute('aria-expanded')=='true')!=expanded:await summary.click()
    button=await page.locator('.copilot-fixed').bounding_box();shell=await page.locator('.app-shell').bounding_box();assert abs(button['y']+button['height']-shell['y']-shell['height'])<=2
    for action in ['Orçamentos emitidos','Emitir orçamento']:
     box=await finance.get_by_role('button',name=action,exact=True).bounding_box();assert box['x']+box['width']<=button['x']
   await summary.click()
   await page.get_by_role('button',name='Abrir Copiloto FUNIX',exact=True).click();await expect(page.get_by_role('region',name='Copiloto FUNIX',exact=True)).to_contain_text('IA ainda indisponível');await shot('copiloto-'+label.lower())
   await page.get_by_role('button',name='Recolher Copiloto',exact=True).click();await expect(page.get_by_role('region',name='Copiloto FUNIX',exact=True)).to_have_count(0)
   if label=='Mapa':await shot('mapa')
  await main('Diagnósticos');await page.get_by_role('button',name='+ Adicionar peça',exact=True).click();await expect(page.get_by_label('Buscar peça em todas as vistas')).to_be_visible()
  await page.get_by_role('button',name='Fechar seleção',exact=True).click();await main('Mapa');await expect(page.get_by_role('dialog',name='Selecionar peça no mapa')).to_have_count(0)
  h.mark(device+': main tab buttons preserve scenario and data; Copilot opens/closes in all three tabs without covering collapsed or expanded finance')

  await main('Chat');before=len([r for r in requests if r[1].endswith(base)])
  async def gesture(dx,dy=0,selector='.detail-page'):
   # DOM touch events exercise both touch viewports without moving a real browser edge.
   node=page.locator(selector).first
   await node.evaluate('''(e,delta)=>{const touch=(x,y)=>new Touch({identifier:1,target:e,clientX:x,clientY:y});e.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[touch(220,160)]}));e.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],changedTouches:[touch(220+delta[0],160+delta[1])]}))}''',[dx,dy])
  ignored_url=page.url;await gesture(-110,0,'.compose textarea');assert page.url==ignored_url
  m=await menu();await gesture(-110,0,'.scenario-dropdown');assert page.url==ignored_url;await page.keyboard.press('Escape')
  await gesture(-110);await expect(page.get_by_role('button',name='Diagnósticos',exact=True)).to_have_attribute('aria-current','page')
  await gesture(-110);await expect(page.get_by_role('button',name='Mapa',exact=True)).to_have_attribute('aria-current','page')
  await gesture(110);await expect(page.get_by_role('button',name='Diagnósticos',exact=True)).to_have_attribute('aria-current','page')
  current_url=page.url;await gesture(-80,160);assert page.url==current_url
  await gesture(-110,0,'.approved-finance');assert page.url==current_url
  m=await menu();await m.get_by_role('menuitem',name='Comparação',exact=True).click();internal_url=page.url;await gesture(-110,0,'.scenario-matrix');assert page.url==internal_url;await back()
  assert len([r for r in requests if r[1].endswith(base)])==before
  h.mark(device+': directional swipe follows Chat/Diagnósticos/Mapa, ignores vertical/finance/matrix gestures and issues no redundant Atendimento GET')
  if device=='mobile':
   cdp=await ctx.new_cdp_session(page)
   async def physical(x,y,dx,dy):
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    for i in range(1,6):
     await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*i/5,'y':y+dy*i/5}]});await asyncio.sleep(.025)
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
   await body.evaluate('(e)=>e.scrollTop=0');box=await page.locator('.diagnosis-heading').bounding_box()
   await physical(280,box['y']+8,-120,0);await expect(page.get_by_role('button',name='Mapa',exact=True)).to_have_attribute('aria-current','page')
   await main('Diagnósticos');await body.evaluate('(e)=>e.scrollTop=0');url=page.url
   await physical(200,500,0,-170);assert page.url==url;assert await body.evaluate('(e)=>e.scrollTop')>50
   await cdp.detach()
   await body.evaluate('''async e=>{let last=-1,stable=0;for(let i=0;i<120&&stable<8;i++){await new Promise(requestAnimationFrame);const top=e.scrollTop;stable=top===last?stable+1:0;last=top}}''')
   h.mark(device+': Chromium touch input performs horizontal tab swipe while native vertical scroll remains functional')


  # UI positions use the shell's existing cache, including a confirmed discard/remount.
  await body.evaluate('(e)=>e.scrollTop=300');await page.wait_for_timeout(80);before_discard_scroll=await body.evaluate('(e)=>e.scrollTop')
  await page.locator('.diagnosis-open').nth(6).evaluate("e=>e.addEventListener('click',()=>window.__discardScroll=e.closest('.diagnostics-body').scrollTop,{capture:true,once:true})")
  await page.locator('.diagnosis-open').nth(6).click();before_discard_scroll=await page.evaluate('window.__discardScroll');discard_editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True)
  await discard_editor.get_by_role('button',name='Observação da peça',exact=True).click()
  async def fail_discard(route):await route.abort('failed')
  await page.route('**/diagnosticos/*',fail_discard);await discard_editor.get_by_role('textbox',name='Observação da peça',exact=True).fill('QA descarte com posição preservada');await expect(discard_editor.get_by_role('alert')).to_be_visible()
  await page.unroute('**/diagnosticos/*',fail_discard);await back();await expect(page.locator('.diagnosis-list')).to_be_visible()
  restored_scroll=await body.evaluate('(e)=>e.scrollTop');assert abs(restored_scroll-before_discard_scroll)<3,(before_discard_scroll,restored_scroll)
  h.mark(device+': explicit discard remount retains the prior diagnosis list scroll position')

  await page.locator('.diagnosis-open').first.click();editor=page.get_by_role('region',name='Editor de diagnóstico',exact=True)
  await editor.get_by_role('button',name='Observação da peça',exact=True).click();field=editor.get_by_role('textbox',name='Observação da peça',exact=True)
  async def reject(route):await route.abort('failed')
  await page.route('**/diagnosticos/*',reject);await field.fill('QA ETAPA B — rascunho após falha');await expect(editor.get_by_role('alert')).to_be_visible()
  dirty_url=page.url;h.accept_dialogs=False;await page.evaluate('history.back()');await page.wait_for_timeout(150);await expect(page).to_have_url(dirty_url);await expect(field).to_have_value('QA ETAPA B — rascunho após falha')
  await back();await expect(page).to_have_url(dirty_url);await expect(field).to_have_value('QA ETAPA B — rascunho após falha')
  await page.unroute('**/diagnosticos/*',reject);h.accept_dialogs=True;await editor.get_by_role('button',name='Tentar novamente',exact=True).click();await saved()
  w=await get(base+'/cenarios');assert w['items'][0]['notes']=='QA ETAPA B — rascunho após falha';await back();await expect(page.locator('.diagnosis-list')).to_be_visible();await page.go_forward();await editor.get_by_role('button',name='Observação da peça',exact=True).click();await expect(field).to_have_value('QA ETAPA B — rascunho após falha')
  h.mark(device+': network failure preserves draft; canceling native/header back preserves route and forward history; explicit retry saves once and survives return')
  await page.route('**/diagnosticos/*',reject);await field.fill('QA DESCARTE EXPLÍCITO');await expect(editor.get_by_role('alert')).to_be_visible()
  await page.unroute('**/diagnosticos/*',reject);await page.evaluate('history.back()');await expect(page.locator('.diagnosis-list')).to_be_visible()
  await page.go_forward();await editor.get_by_role('button',name='Observação da peça',exact=True).click();await expect(field).to_have_value('QA ETAPA B — rascunho após falha')
  h.mark(device+': accepting explicit discard on native back reloads the confirmed version without persisting the discarded draft')


  gate=asyncio.Event();started=asyncio.Event()
  async def hold(route):started.set();await gate.wait();await route.continue_()
  await page.route('**/diagnosticos/*',hold);await field.fill('QA ETAPA B — gravação pendente');await asyncio.wait_for(started.wait(),10);await expect(page.get_by_role('button',name='Emitir orçamento',exact=True)).to_be_disabled();await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  url=page.url;await page.evaluate('history.back()');await page.wait_for_timeout(150);await expect(page).to_have_url(url);gate.set();await saved();await page.unroute('**/diagnosticos/*',hold)
  await back();await expect(page.locator('.diagnosis-list')).to_be_visible();await back();await expect(page).to_have_url(ORIGIN+'/funil')
  assert (await get(base+'/orcamentos/'+ids['version']))['snapshot']==ids['snapshot']
  h.mark(device+': in-flight write blocks native return until confirmed; final return reaches Funil; budget snapshot remains immutable')
  assert not h.external and not h.page_errors,(h.external,h.page_errors)
  return h.results
 except Exception:
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
  raise
 finally:
  if ctx:await ctx.close()
  h.cleanup()

async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True);results=[];error=None
 try:
  async with async_playwright()as p:
   browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   try:
    for device,viewport in [('desktop',{'width':1440,'height':960}),('mobile',{'width':390,'height':844})]:results+=await device_case(browser,device,viewport)
   finally:await browser.close()
 except Exception:error=traceback.format_exc();print(error,flush=True)
 (ARTIFACTS/'resultados.json').write_text(json.dumps({'pass':error is None,'synthetic':True,'results':results,'error':error},ensure_ascii=False,indent=2)+'\n')
 if error:raise SystemExit(1)
if __name__=='__main__':asyncio.run(run())
