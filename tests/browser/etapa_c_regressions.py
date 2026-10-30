"""Etapa C existing functional suites with separate, ignored synthetic QA artifacts."""
import asyncio, importlib, json
from m1_atendimentos import ROOT

async def run():
    results = []
    for name in ['pr17_auditoria', 'editor_financeiro', 'm1_atendimentos', 'issue7_scenarios',
                 'issue12_inclusion', 'issue22_regressions', 'issue18_import', 'issue20_pricing']:
        suite = importlib.import_module(name)
        suite.ARTIFACTS = ROOT / '.runtime/etapa-c/regressions' / name
        suite.ARTIFACTS.mkdir(parents=True, exist_ok=True)
        if name == 'm1_atendimentos':
            suite.REPORT = suite.ARTIFACTS / 'resultados.json'
        print('SUITE', name, flush=True)
        await suite.run()
        filename = 'cenarios-resultados.json' if name == 'issue7_scenarios' else 'regressoes.json' if name == 'issue22_regressions' else 'resultados.json'
        data = json.loads((suite.ARTIFACTS / filename).read_text())
        groups = data.get('results', data.get('assertions', []))
        assert not data.get('error') and all(g['pass'] for g in groups), name
        results.append({'suite': name, 'pass': True, 'groups': len(groups), 'assertions': groups})
    (ROOT / '.runtime/etapa-c/regressions/summary.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    asyncio.run(run())
