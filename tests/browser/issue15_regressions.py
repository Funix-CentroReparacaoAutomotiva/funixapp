"""Issue15 regression runner; evidence isolated from previous audited deliveries."""
import asyncio,importlib
from m1_atendimentos import ROOT

async def run():
 output=ROOT/'docs/evidencias/issue15'
 suites=[('issue15_diagnosticos',None),('m1_atendimentos','m1'),('m1_2_catalogos','catalogos'),('issue7_scenarios','cenarios'),('issue7_integrated','orcamento'),('pr11_interface','interface'),('v20_visual','v20'),('issue12_inclusion','issue12')]
 for name,folder in suites:
  module=importlib.import_module(name);module.ARTIFACTS=output/'regressoes'/folder if folder else output
  module.ARTIFACTS.mkdir(parents=True,exist_ok=True)
  if name=='m1_atendimentos':module.REPORT=module.ARTIFACTS/'resultados.json'
  print('SUITE',name,flush=True);await module.run()

if __name__=='__main__':asyncio.run(run())
