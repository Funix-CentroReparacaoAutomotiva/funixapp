"""Audita artefatos e recalcula percentis localmente; não faz rede ou novas buscas."""
import csv
import json
import math
from pathlib import Path
from urllib.parse import urlsplit

root = Path(__file__).resolve().parent
data = json.loads((root / 'consultas.json').read_text())
rows = data['records']
assert len(rows) == data['synthetic_queries'] == 34
assert len({(r['vehicle'], r['part']) for r in rows}) == data['unique_vehicle_component_pairs'] == 30
assert len({r['id'] for r in rows}) == len(rows)
assert len(rows) + data['documentation_searches'] == data['total_search_queries'] <= data['limit'] == 50
with (root / 'consultas.csv').open() as stream:
    csv_rows = list(csv.DictReader(stream))
assert len(csv_rows) == len(rows)
for record, csv_row in zip(rows, csv_rows):
    assert record['id'] == csv_row['id']
    assert record['query'] == csv_row['consulta']
    assert str(record['duration_ms']) == csv_row['latencia_ferramenta_ms']
    assert record['duration_ms'] >= 0
    assert record['confirmed_unit_price_brl'] is None
    assert not record['accepted_categories']
    assert not record['provider_api_executed']
    for candidate in record['first_three_results']:
        url = urlsplit(candidate['url'])
        assert url.scheme == 'https' and not url.username and not url.password
for name, group in [('Total', rows), ('ML', rows[:24]), ('VW', rows[24:30]), ('Renault', rows[30:])]:
    values = sorted(row['duration_ms'] for row in group)
    def percentile(p):
        return values[math.ceil(p * len(values)) - 1]
    print(f'{name}: n={len(values)}, p50={percentile(.50)} ms, p95={percentile(.95)} ms')
print(f'Tokens BRL incidentais: {sum(r["any_brl_token_in_response"] for r in rows)}/{len(rows)}')
checks = json.loads((root / 'links.json').read_text())
assert len(checks) == 10
assert sum(check['status'] == 'blocked_403' for check in checks) == 5
print('Estrutura, CSV, orçamento de buscas e verificações de links: OK')
