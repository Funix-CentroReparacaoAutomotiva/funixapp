"""Etapa 3 existing functional suites with separate, ignored synthetic QA artifacts."""
import asyncio, importlib, json, sys
from m1_atendimentos import ROOT

async def run():
    results = []
    for name in [n for n in ['etapa_b_navigation','etapa_d_components'] if not sys.argv[1:] or n in sys.argv[1:]]:
        suite=importlib.import_module(name)
        suite.ARTIFACTS=ROOT/'.runtime/etapa3/regressions'/name
        suite.ARTIFACTS.mkdir(parents=True,exist_ok=True)
        print('SUITE',name,flush=True)
        await suite.run()
        files=['resultados.json']if name=='etapa_b_navigation'else['desktop-resultados.json','mobile-resultados.json']
        groups=[]
        for filename in files:
            data=json.loads((suite.ARTIFACTS/filename).read_text())
            assert not data.get('error')
            groups.extend(data['results'])
        assert all(g['pass']for g in groups)
        results.append({'suite':name,'pass':True,'groups':len(groups),'assertions':groups})
    for name in ['pr17_auditoria', 'editor_financeiro', 'm1_atendimentos', 'issue7_scenarios',
                 'issue12_inclusion', 'issue22_regressions', 'issue18_import', 'issue20_pricing']:
        if sys.argv[1:] and name not in sys.argv[1:]: continue
        suite = importlib.import_module(name)
        suite.ARTIFACTS = ROOT / '.runtime/etapa3/regressions' / name
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
    (ROOT / ('.runtime/etapa3/regressions/continuation.json' if sys.argv[1:] else '.runtime/etapa3/regressions/summary.json')).write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    asyncio.run(run())
