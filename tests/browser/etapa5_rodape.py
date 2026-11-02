"""Stage5 F01-F06: shared footer, safe-area, consent/idempotency and history. Synthetic local SQLite only."""
import asyncio,json,hashlib,subprocess,traceback,sqlite3
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/etapa5'
def overlaps(a,b):return min(a['x']+a['width'],b['x']+b['width'])-max(a['x'],b['x'])>0.1 and min(a['y']+a['height'],b['y']+b['height'])-max(a['y'],b['y'])>0.1
async def device_case(browser,device,viewport):
 h=Harness();h.check_ports();ctx=None;page=None;geometry=[]
 try:
  setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';import{ComponentRepository}from'./server/components.ts';import{BudgetRepository}from'./server/budgets.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db);new ComponentRepository(db).save(f.at.id,{pieceId:f.item.id,name:'Componente QA',quantity:'0.25',manualPrice:'10',notes:''});const b=new BudgetRepository(db),r={scenarioId:f.scenario.id,negotiation:{mode:'none'}},p=b.preview(f.at.id,r),v=b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:'stage5-frozen-budget'});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,piece:f.item.id,version:v.id,snapshot:v.snapshot}));db.close();"""
  subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
  ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
  ctx=await browser.new_context(viewport=viewport,is_mobile=device!='desktop',has_touch=device!='desktop',accept_downloads=True);await h.watch(ctx);page=await ctx.new_page();await h.attach(page);await page.goto(ORIGIN);await h.login(page);await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=chat')
  async def get(path):
   r=await ctx.request.get(ORIGIN+path);assert r.ok,await r.text();return await r.json()
  async def shot(name):await page.screenshot(path=str(ARTIFACTS/(device+'-'+name+'.png')))
  finance=page.get_by_role('region',name='Painel financeiro',exact=True);summary=finance.locator('.summary');emit=finance.get_by_role('button',name='Emitir orçamento',exact=True);history=finance.get_by_role('button',name='Orçamentos emitidos',exact=True);bot=page.get_by_role('button',name='Abrir Copiloto FUNIX',exact=True);review=page.get_by_role('dialog',name='Conferência do orçamento');await expect(emit).to_be_visible()
  frozen_pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');frozen_hash=hashlib.sha256(await frozen_pdf.body()).hexdigest();anchor=None
  async def panel(opened):
   if(await summary.get_attribute('aria-expanded')=='true')!=opened:await summary.click()
  async def check_geometry(label,opened,safe=0,right=0):
   await expect(history).to_be_visible();await expect(emit).to_be_visible();assert await page.get_by_role('button',name='Conferir prévia',exact=True).count()==0
   shell=await page.locator('.app-shell').bounding_box();b=await bot.bounding_box();hist=await history.bounding_box();em=await emit.bounding_box();total=await finance.locator('.metric.final').bounding_box();actions=await finance.locator('.budget-actions').bounding_box();f=await finance.bounding_box()
   assert hist['x']<em['x'];assert abs(b['y']+b['height']-(shell['y']+shell['height']-safe-1))<=2,(label,shell,b);assert abs(b['x']+b['width']-(shell['x']+shell['width']-right-1))<=2
   for name,box in [('history',hist),('emit',em),('total',total)]:assert not overlaps(box,b),(label,name,box,b);assert box['x']>=-1 and box['x']+box['width']<=viewport['width']+1
   assert hist['height']>=44 and em['height']>=44;assert total['x']+total['width']<=b['x'],(label,total,b)
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   if opened:
    body=finance.locator('.body');await finance.locator('.total').scroll_into_view_if_needed();t=await finance.locator('.total strong').bounding_box();assert not overlaps(t,b);assert(await body.bounding_box())['y']+(await body.bounding_box())['height']<=actions['y']+1
   geometry.append({'case':label,'safeBottom':safe,'safeRight':right,'copilot':b,'finance':f,'history':hist,'emit':em,'total':total,'actions':actions})
   return b
  for tab in ['Chat','Diagnósticos','Mapa']:
   await page.get_by_role('navigation',name='Visões do Atendimento').get_by_role('button',name=tab,exact=True).click()
   for opened in [False,True]:
    await panel(opened);b=await check_geometry(tab+':'+str(opened),opened)
    if anchor is None:anchor=b
    else:assert abs(b['x']-anchor['x'])<1 and abs(b['y']-anchor['y'])<1,(anchor,b)
    await shot(tab.lower()+'-'+('aberto'if opened else'fechado'))
    await bot.click();copilot=page.get_by_role('region',name='Copiloto FUNIX',exact=True);await expect(copilot).to_contain_text('IA ainda indisponível');await page.wait_for_timeout(80);cp=await copilot.bounding_box();footer=await finance.bounding_box();assert cp['y']+cp['height']+18<=footer['y'],(tab,opened,cp,footer)
    nav=await page.get_by_role('navigation',name='Visões do Atendimento').bounding_box();assert cp['y']>=nav['y']+nav['height'];assert cp['x']>=0 and cp['y']+cp['height']<=viewport['height']+1
    if tab=='Mapa'and opened:await shot('copiloto-sem-sobreposicao')
    await copilot.get_by_role('button',name='Recolher Copiloto',exact=True).click()
  h.mark(device+': three tabs, expanded/collapsed footer and popup; stable base anchor, left history/right emit, total before reserved gutter, no footer overlap or horizontal overflow')
  # Simulate a device inset through the CSS variables whose defaults use native env().
  style=await page.add_style_tag(content='.app-shell{--funix-safe-bottom:20px;--funix-safe-right:12px}');await panel(False);await check_geometry('safe-area',False,20,12);await shot('safe-area');await style.evaluate('(e)=>e.remove()')
  h.mark(device+': synthetic 20px bottom/12px right safe-area respected by fixed launcher and footer actions; no hidden total/buttons')
  # Historical route from footer, native back and immutable old PDF.
  await history.click();await expect(page.locator('.detail-header h1')).to_have_text('Orçamentos emitidos');await page.get_by_role('button',name='Orçamento A ·',exact=False).click();await expect(page.locator('.detail-header h1')).to_have_text('Orçamento A');await shot('historico-versao')
  async with page.expect_download()as dl:await page.get_by_role('button',name='Baixar PDF A',exact=True).click()
  path=await(await dl.value).path();assert hashlib.sha256(path.read_bytes()).hexdigest()==frozen_hash;await page.get_by_role('button',name='Voltar à tela anterior',exact=True).click();await page.get_by_role('button',name='Voltar à tela anterior',exact=True).click();await expect(emit).to_be_visible();await expect(page.get_by_role('button',name='Mapa',exact=True)).to_have_attribute('aria-current','page')
  h.mark(device+': always-visible footer history opens existing list/version/PDF and returns to original tab/scenario; historical PDF unchanged')
  # Preview failure remains visible even when collapsed; explicit retry, no emission.
  async def fail_preview(route):await route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'message':'Prévia QA indisponível'}}))
  await page.route('**/orcamentos/previa',fail_preview);await emit.click();await expect(finance.get_by_role('alert')).to_contain_text('Prévia QA indisponível');await expect(summary).to_have_attribute('aria-expanded','false');assert len(await get(base+'/orcamentos'))==1;await shot('falha-previa-recolhido');await page.unroute('**/orcamentos/previa',fail_preview)
  h.mark(device+': failed technical preview leaves collapsed actions/error visible, creates no budget and allows explicit retry without manual preview control')
  # Lost committed emission response: same token/key on retry; immediate duplicate click cannot issue twice.
  await emit.click();await expect(review).to_be_visible();confirm=review.get_by_role('button',name='Confirmar emissão',exact=True);await expect(confirm).to_be_disabled();await review.get_by_role('checkbox').check();requests=[]
  async def lose(route):
   requests.append(route.request.post_data_json)
   if len(requests)==1:await route.fetch();await route.abort('failed')
   else:await route.continue_()
  await page.route('**'+base+'/orcamentos',lose);await confirm.click();await expect(review.get_by_role('alert')).to_be_visible();assert len(await get(base+'/orcamentos'))==2;await confirm.evaluate('(e)=>{e.click();e.click()}');await expect(review.get_by_role('heading',name='Orçamento B emitido',exact=True)).to_be_visible();await page.unroute('**'+base+'/orcamentos',lose)
  assert len(requests)==2 and requests[0]==requests[1],requests;assert len(requests[0]['previewToken'])==64 and len(requests[0]['idempotencyKey'])>=16;versions=await get(base+'/orcamentos');assert len(versions)==2;issued=await get(base+'/orcamentos/'+versions[0]['id']);assert issued['snapshot']['calculation']['total']=='305.15'
  await shot('emissao-idempotente');await review.get_by_role('button',name='Fechar conferência',exact=True).click()
  h.mark(device+': emit obtains preview/token internally, requires consent, lost committed response retries identical key/token and double click creates exactly one new version')
  # A real second writer invalidates the token; no blind replay, refresh followed by renewed consent.
  await emit.click();await expect(review).to_be_visible();w=await get(base+'/cenarios');piece=next(p for p in w['items']if p['id']==ids['piece']);r=await ctx.request.patch(ORIGIN+base+'/diagnosticos/'+piece['id'],headers={'Origin':ORIGIN},data={'revision':piece['revision'],'notes':'Concorrência QA','diagnosisId':piece['diagnosisId'],'services':piece['services']});assert r.ok,await r.text();await review.get_by_role('checkbox').check();await confirm.click();await expect(review.get_by_role('alert')).to_be_visible();assert len(await get(base+'/orcamentos'))==2;await review.get_by_role('button',name='Fechar conferência',exact=True).click();await emit.click();await expect(finance.get_by_role('alert')).to_contain_text('dados salvos mudaram');await emit.click();await expect(review).to_be_visible();await expect(confirm).to_be_disabled();await review.get_by_role('button',name='Fechar conferência',exact=True).click()
  assert(await get(base+'/orcamentos/'+ids['version']))['snapshot']==ids['snapshot'];pdf=await ctx.request.get(ORIGIN+base+'/orcamentos/'+ids['version']+'/pdf');assert hashlib.sha256(await pdf.body()).hexdigest()==frozen_hash
  with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
  assert not h.external and not h.page_errors,(h.external,h.page_errors)
  h.mark(device+': real revision conflict blocks emission; explicit refresh and renewed consent required; immutable snapshot/PDF, SQLite integrity and no external/AI calls')
 except Exception as error:
  if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
  h.results.append({'name':device+': failure','pass':False,'error':str(error),'traceback':traceback.format_exc()});raise
 finally:
  (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'device':device,'synthetic':True,'results':h.results,'geometry':geometry,'external':h.external,'pageErrors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
  if ctx:await ctx.close()
  h.cleanup()
async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True)
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  try:
   for device,viewport in [('desktop',{'width':1440,'height':1000}),('mobile390',{'width':390,'height':844}),('mobile320',{'width':320,'height':568})]:await device_case(browser,device,viewport)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
