"""Selection regression entrypoint: Issue31 supersedes Etapa C scenario-only selection.
The preserved radial is not redesigned here; current composition selection is tested in Stage2.
"""
import asyncio
import etapa2_persistencia as suite
from m1_atendimentos import ROOT
ARTIFACTS=ROOT/'docs/evidencias/etapa2'
async def run():
 suite.ARTIFACTS=ARTIFACTS
 await suite.run()
if __name__=='__main__':asyncio.run(run())
