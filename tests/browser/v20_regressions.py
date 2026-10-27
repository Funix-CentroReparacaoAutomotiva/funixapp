"""Run visual and existing commercial regressions into an isolated evidence folder.
No production services or databases are contacted. Requires local Playwright/Chromium.
"""
import asyncio
import importlib
from m1_atendimentos import ROOT


async def run():
    output = ROOT / 'docs/evidencias/revisao-v20'
    suites = [('v20_visual', None), ('m1_atendimentos', 'm1'),
              ('m1_2_catalogos', 'catalogos'), ('issue7_scenarios', 'cenarios'),
              ('issue7_integrated', 'orcamento'), ('pr11_interface', 'interface'),
              ('issue12_inclusion', 'issue12')]
    for name, folder in suites:
        module = importlib.import_module(name)
        module.ARTIFACTS = output / 'regressoes' / folder if folder else output
        module.ARTIFACTS.mkdir(parents=True, exist_ok=True)
        if name == 'm1_atendimentos':
            module.REPORT = module.ARTIFACTS / 'resultados.json'
        print('SUITE', name, flush=True)
        await module.run()


if __name__ == '__main__':
    asyncio.run(run())
