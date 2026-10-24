# Comandos e evidências M1.2

Executados na raiz `funixapp`, com Node 24/npm 11, Python/Playwright e Chromium do ambiente. Nenhum `.env`, banco de clientes ou credencial externa foi utilizado nos testes. Logs contêm saídas técnicas e dados sintéticos.

## Build, tipos, testes e lint

```bash
npm run check > docs/evidencias/m1-2/npm-run-check.txt 2>&1
python3 -m unittest discover -s deploy/tests -v > docs/evidencias/m1-2/deploy-tests.txt 2>&1
python3 tests/browser/m1_2_catalogos.py > docs/evidencias/m1-2/browser-execucao.txt 2>&1
```

Os testes Node somam 29. O lint apresenta somente quatro avisos preexistentes de set-state-in-effect. A suíte Python de implantação simula o Docker: não acessa VPS, não atualiza serviços reais e não comprova deploy produtivo. O navegador M1.2 possui sete grupos de cenários, com captura desktop/mobile, reinício real da API, nova sessão e dados temporários. A falha 503 é a única resposta simulada; 401 e 409 são retornados pela API real.

## Regressão M1.1 preservando evidências históricas

```bash
python3 - <<'PY' > docs/evidencias/m1-2/regressao-m1-1.txt 2>&1
import sys, asyncio
sys.path.insert(0, 'tests/browser')
import m1_atendimentos as qa
qa.ARTIFACTS = qa.ROOT / 'docs/evidencias/m1-2/regressao-m1-1'
qa.REPORT = qa.ARTIFACTS / 'resultados.json'
asyncio.run(qa.run())
PY
```

Resultado: 19 grupos aprovados. Os dois navegadores usam portas 5173/8787 e devem ser executados sequencialmente; recusam encerrar outro serviço que ocupe essas portas.

## Imagem API e smoke isolado

Somente daemon local `unix:///var/run/docker.sock`, com seletores de daemon remoto removidos. Sem push de imagem. O build foi executado com target api, que não instala dependências npm nem exige rede nos passos de build:

```bash
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --host=unix:///var/run/docker.sock build --target api --network=none \
  -t funix-m1-2-api:local . > docs/evidencias/m1-2/container-build.txt 2>&1
```

Smoke executado com o código abaixo, passado a `node --input-type=module -e` no contêiner; esta forma stdin é equivalente e reproduzível:

```bash
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --host=unix:///var/run/docker.sock run -i --rm --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m funix-m1-2-api:local node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { openDatabase } from './server/database.ts';
import { CommercialRepository } from './server/commercial.ts';
import { AtendimentoRepository } from './server/atendimentos.ts';
let db = openDatabase('/tmp/m1-2.sqlite');
let c = new CommercialRepository(db);
assert.equal(c.catalogs().items.length, 163);
const a = new AtendimentoRepository(db).create({ phone: '123' });
const p = c.catalogs().items.find(p => p.code === 'capo');
c.saveCatalog({ revision: p.revision, status: 'validado' }, p.id);
const d = c.add(a.id, { pieceCodes: ['capo'] })[0];
const s = c.saveCatalog({ kind: 'servico', name: 'Sintético', status: 'validado' });
c.updateDiagnosis(a.id, d.id, { revision: d.revision, services: [{ serviceId: s.id, quantity: '0.250000' }] });
db.close();
db = openDatabase('/tmp/m1-2.sqlite');
c = new CommercialRepository(db);
assert.equal(c.list(a.id)[0].services[0].quantity, '0.25');
assert.equal(c.item(p.id).status, 'validado');
db.close();
console.log('PASS: API image includes V2, migrates SQLite and reopens synthetic diagnosis with exact fractional quantity; no network or published ports.');
JS
```

Saída em `container-smoke.txt`. Esse contêiner descartável não testa persistência entre recriações de contêiner, backup externo ou implantação na VPS; essas configurações continuam reservadas à implantação futura.

## Integridade

```bash
git diff --check
```

Também conferidos os SHA-256 dos 20 originais pelo manifesto `docs/especificacao-v1.0/FONTES.json`. O teste de hierarquia compara o recurso empacotado ao arquivo original, sem depender de rede.
