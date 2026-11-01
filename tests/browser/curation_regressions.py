"""Final curation regression runner; preserves earlier evidence and test contracts."""
import asyncio,importlib,json
from m1_atendimentos import ROOT
async def run():
 results=[]
 for name in ['etapa6_integrated','etapa5_rodape','etapa4_mapa','etapa2_persistencia','etapa3_editor','etapa_b_navigation','etapa_d_components','pr17_auditoria','editor_financeiro','m1_atendimentos','issue7_scenarios','issue12_inclusion','issue22_regressions','issue18_import','issue20_pricing']:
  suite=importlib.import_module(name);suite.ARTIFACTS=ROOT/'.runtime/curadoria-final/regressions'/name;suite.ARTIFACTS.mkdir(parents=True,exist_ok=True)
  if name=='m1_atendimentos':suite.REPORT=suite.ARTIFACTS/'resultados.json'
  print('SUITE',name,flush=True);await suite.run()
  files=['desktop-resultados.json','mobile390-resultados.json','mobile320-resultados.json']if name in ['etapa6_integrated','etapa5_rodape','etapa4_mapa','etapa2_persistencia','etapa3_editor']else['desktop-resultados.json','mobile-resultados.json']if name=='etapa_d_components'else['cenarios-resultados.json'if name=='issue7_scenarios'else'regressoes.json'if name=='issue22_regressions'else'resultados.json']
  groups=[]
  for file in files:
   d=json.loads((suite.ARTIFACTS/file).read_text());assert not d.get('error');g=d.get('results',d.get('assertions',[]));assert g and all(x['pass']for x in g);groups+=g
  results.append({'suite':name,'groups':len(groups),'pass':True,'assertions':groups})
  (ROOT/'.runtime/curadoria-final/regressions/summary.json').write_text(json.dumps({'synthetic':True,'results':results,'totalGroups':sum(r['groups']for r in results)},ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':asyncio.run(run())
