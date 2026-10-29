"""Run existing functional suites in isolated synthetic SQLite databases.
Artifacts go to ignored .runtime; Issue22 targeted coverage has its own script.
Usage: python tests/browser/issue22_all_regressions.py
"""
import asyncio, importlib, json
from m1_atendimentos import ROOT

async def run():
    results = []
    for name in ['pr17_auditoria', 'editor_financeiro', 'm1_atendimentos', 'issue7_scenarios', 'issue12_inclusion']:
        suite = importlib.import_module(name)
        suite.ARTIFACTS = ROOT / '.runtime/issue22/regressions' / name
        suite.ARTIFACTS.mkdir(parents=True, exist_ok=True)
        if name == 'm1_atendimentos':
            suite.REPORT = suite.ARTIFACTS / 'resultados.json'
        print('SUITE', name, flush=True)
        await suite.run()
        filename = 'cenarios-resultados.json' if name == 'issue7_scenarios' else 'resultados.json'
        data = json.loads((suite.ARTIFACTS / filename).read_text())
        groups = data.get('results', data.get('assertions', []))
        assert not data.get('error') and all(g['pass'] for g in groups), name
        results.append({'suite': name, 'groups': len(groups), 'pass': True})
    (ROOT / '.runtime/issue22/regressions/summary.json').write_text(json.dumps(results, indent=2) + '\n')

if __name__ == '__main__':
    asyncio.run(run())
