"""Stage-category persistence, explicit PDF pending state and recovery in synthetic local browsers."""
import asyncio,json,sqlite3,subprocess,traceback
from playwright.async_api import async_playwright,expect
from m1_atendimentos import Harness,ROOT,ORIGIN
ARTIFACTS=ROOT/'docs/evidencias/pr39-stage-clusters/interface'
async def run():
 ARTIFACTS.mkdir(parents=True,exist_ok=True)
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  for device,width in [('desktop',1440),('mobile390',390),('mobile320',320)]:
   h=Harness();context=None;page=None
   try:
    h.check_ports()
    setup="""import{writeFileSync}from'node:fs';import{openDatabase}from'./server/database.ts';import{commercialFixture}from'./server/tests/fixtures/commercial.ts';const db=openDatabase(process.argv[1]),f=commercialFixture(db),cfg=f.pricing.get(),original=cfg.config.services[0].dimensions[0].stages[0];cfg.config.services[0].dimensions[0].stages=[{...original,id:'qa-prep',name:'Preparação QA',baseEnergy:'2',dimensionEnergy:'0',presentation:{stageId:'qa-prep',stageDimensionId:null,clusterId:null,cluster:null,order:1}},{...original,id:'qa-paint',name:'Pintura QA',baseEnergy:'3',dimensionEnergy:'0',presentation:{stageId:'qa-paint',stageDimensionId:null,clusterId:null,cluster:'Pintura e acabamento',order:2}}];f.pricing.save({revision:cfg.revision,config:cfg.config});writeFileSync(process.argv[2],JSON.stringify({at:f.at.id,scenario:f.scenario.id}));db.close();"""
    subprocess.run(['node','--input-type=module','-e',setup,str(h.folder/'atendimentos.sqlite'),str(h.folder/'ids.json')],cwd=ROOT,check=True)
    ids=json.loads((h.folder/'ids.json').read_text());base='/api/atendimentos/'+ids['at'];await h.start_api();vite=h.start(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'preview');await h.ready(ORIGIN,vite)
    context=await browser.new_context(viewport={'width':width,'height':960 if width>400 else 844},is_mobile=width<400,has_touch=width<400,accept_downloads=True);await h.watch(context);page=await context.new_page();await h.attach(page);await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await h.login(page);await expect(page.locator('.scenario-trigger')).to_be_enabled()
    await page.get_by_role('button',name='Emitir orçamento',exact=True).click();review=page.get_by_role('dialog',name='Conferência do orçamento');await expect(review).to_be_visible();await expect(review.locator('.form-error')).to_contain_text('categoria ausente');await review.get_by_role('checkbox').check();await expect(review.get_by_role('button',name='Confirmar emissão',exact=True)).to_be_disabled()
    r=await context.request.post(ORIGIN+base+'/orcamentos/previa',headers={'Origin':ORIGIN},data={'scenarioId':ids['scenario'],'negotiation':{'mode':'none'}});data=await r.json();assert not data['canEmit']and data['snapshot']['calculation']['total']=='300.15'and data['snapshot']['pdfPresentation']['errors']
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');await page.screenshot(path=str(ARTIFACTS/(device+'-categoria-pendente.png')))
    with sqlite3.connect(h.folder/'atendimentos.sqlite')as db:assert db.execute('SELECT COUNT(*)FROM budget_versions').fetchone()[0]==0;assert db.execute('SELECT COUNT(*)FROM budget_emission_attempts').fetchone()[0]==0
    h.mark(device+': missing category is explicit in review, prices remain calculable, confirm is blocked and no PDF/identity is reserved')
    await review.get_by_role('button',name='Fechar conferência').click();await page.goto(ORIGIN+'/configuracoes');await page.get_by_role('button',name='Precificação',exact=True).click();selects=page.get_by_label('Categoria da etapa no PDF',exact=True);await expect(selects).to_have_count(2);await expect(selects.first).to_have_value('');await expect(selects.nth(1)).to_have_value('Pintura e acabamento');await selects.first.select_option('Preparação técnica');await page.get_by_role('button',name='Salvar configuração comercial',exact=True).click();await expect(page.get_by_role('button',name='Salvar configuração comercial',exact=True)).to_be_disabled();await page.reload();await page.get_by_role('button',name='Precificação',exact=True).click();await expect(selects.first).to_have_value('Preparação técnica');await expect(selects.nth(1)).to_have_value('Pintura e acabamento');assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    h.mark(device+': operator can explicitly classify a stage in existing Settings; both categories persist after reload without inferred defaults')
    await page.goto(ORIGIN+'/atendimentos/'+ids['at']+'?aba=diagnosticos');await expect(page.locator('.scenario-trigger')).to_be_enabled();await page.get_by_role('button',name='Emitir orçamento',exact=True).click();await expect(review.locator('.form-error')).to_have_count(0);await review.get_by_role('checkbox').check()
    async with page.expect_download()as pending:await review.get_by_role('button',name='Confirmar emissão',exact=True).click()
    download=await pending.value;assert download.suggested_filename.endswith(' - 1.pdf')
    versions=await(await context.request.get(ORIGIN+base+'/orcamentos')).json();assert len(versions)==1;v=await(await context.request.get(ORIGIN+base+'/orcamentos/'+versions[0]['id'])).json();clusters=v['snapshot']['document']['data']['diagnosticos'][0]['clusters'];assert[(c['nome'],c['valor'])for c in clusters]==[('Preparação técnica','R$ 120,06'),('Pintura e acabamento','R$ 180,09')];assert v['snapshot']['calculation']['total']=='300.15'
    assert not h.page_errors and not h.external;h.mark(device+': one commercial service is emitted once across two stage categories, original exact total and automatic download preserved; no JS errors or external calls')
   except Exception as e:
    if page:await page.screenshot(path=str(ARTIFACTS/(device+'-failure.png')))
    h.results.append({'name':'failure','pass':False,'error':str(e),'traceback':traceback.format_exc()});raise
   finally:
    (ARTIFACTS/(device+'-resultados.json')).write_text(json.dumps({'synthetic':True,'results':h.results,'external':h.external,'pageErrors':h.page_errors},ensure_ascii=False,indent=2)+'\n')
    if context:await context.close()
    h.cleanup()
  await browser.close()
if __name__=='__main__':asyncio.run(run())
