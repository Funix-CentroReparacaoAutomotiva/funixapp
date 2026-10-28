"""Current PR17 audit + existing functional/browser regressions, separate artifacts."""
import asyncio,importlib
from m1_atendimentos import ROOT
async def run():
 for name,folder in [('pr17_auditoria','auditoria'),('editor_financeiro','editor'),('m1_atendimentos','atendimentos'),('issue7_scenarios','cenarios'),('issue12_inclusion','inclusao')]:
  suite=importlib.import_module(name);suite.ARTIFACTS=ROOT/'docs/evidencias/pr17-ajustes'/folder;suite.ARTIFACTS.mkdir(parents=True,exist_ok=True)
  if name=='m1_atendimentos':suite.REPORT=suite.ARTIFACTS/'resultados.json'
  print('SUITE',name,flush=True);await suite.run()
if __name__=='__main__':asyncio.run(run())
