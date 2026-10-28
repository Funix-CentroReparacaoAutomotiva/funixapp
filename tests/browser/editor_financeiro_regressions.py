"""Sequential local QA. Keep artifacts separate from previously audited deliveries."""
import asyncio,importlib
from m1_atendimentos import ROOT
async def run():
 for name,folder in [('editor_financeiro',None),('m1_atendimentos','atendimentos'),('issue7_scenarios','cenarios'),('issue12_inclusion','inclusao')]:
  suite=importlib.import_module(name)
  suite.ARTIFACTS=ROOT/'docs/evidencias/editor-financeiro'
  if folder:suite.ARTIFACTS=suite.ARTIFACTS/'regressoes'/folder
  suite.ARTIFACTS.mkdir(parents=True,exist_ok=True)
  if name=='m1_atendimentos':suite.REPORT=suite.ARTIFACTS/'resultados.json'
  print('SUITE',name,flush=True);await suite.run()
if __name__=='__main__':asyncio.run(run())
