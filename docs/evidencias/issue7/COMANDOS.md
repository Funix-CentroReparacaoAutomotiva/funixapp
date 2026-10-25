# Issue #7 — comandos e evidências

Executados na branch comercial, Node 24/npm 11. Sem alterações em produção. Nenhum dado financeiro sintético é carregado pelo aplicativo normal.

## Verificações locais

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
python3 tests/browser/issue7_scenarios.py
python3 tests/browser/issue7_integrated.py
git diff --check
```

`npm-run-check.txt`: build, tipos, 49 testes Node e lint sem erros; quatro avisos já existentes de set-state-in-effect em App.tsx. `deploy-tests.txt`: sete testes do mecanismo existente com Docker simulado, sem execução remota.

Os testes Chromium usam Playwright e `/usr/bin/chromium`, API Node real, SQLite temporário e portas locais 5173/8787; recusam interromper serviços que já as ocupem. Devem ser executados sequencialmente. O teste integrado também usa o `pdftotext` já instalado no ambiente de QA; esse comando não é dependência da aplicação.

`cenarios-resultados.json` cobre duplicação de máscaras, serviços repetidos, edição global, pai/filhos, Só diferenças e recuperação móvel após reinício. `integrado-resultados.json` cobre o ciclo UI completo e downloads reais. Não há respostas de sucesso simuladas. Emissões 2–25 são comandos explícitos pela API no banco sintético para alcançar o limite Z/AA; A, Z e AA são emitidas pela interface.

## Regressões preservando artefatos anteriores

```bash
python3 - <<'PY'
import sys, asyncio
sys.path.insert(0,'tests/browser')
import m1_atendimentos as qa
qa.ARTIFACTS = qa.ROOT/'docs/evidencias/issue7/regressao-m1-1'
qa.REPORT = qa.ARTIFACTS/'resultados.json'
asyncio.run(qa.run())
PY
```

```bash
python3 - <<'PY'
import sys, asyncio
sys.path.insert(0,'tests/browser')
import m1_2_catalogos as qa
qa.ARTIFACTS = qa.ROOT/'docs/evidencias/issue7/regressao-m1-2'
asyncio.run(qa.run())
PY
```

Resultados: 19 grupos M1.1 e sete grupos M1.2. A expectativa de footer do teste M1.2 foi atualizada para a entrada de orçamento disponível na Issue #7. As demais funções auditadas continuam sendo verificadas. A falha 503 é simulada somente nesse teste; 401/reauth e 409 são respostas reais.

## PDF independente

O teste integrado baixa A e AA pelos botões da aplicação e executa:

```bash
pdftotext -layout docs/evidencias/issue7/orcamento-A-sintetico.pdf docs/evidencias/issue7/orcamento-A-texto.txt
pdftotext -layout docs/evidencias/issue7/orcamento-AA-sintetico.pdf docs/evidencias/issue7/orcamento-AA-texto.txt
```

Os textos confirmam nomes acentuados, condições, escopo, etapas e os totais dos respectivos snapshots. O PDF A é comparado byte a byte depois de mudar preços/Atendimento e depois de reiniciar API e navegador.

Também renderizada e inspecionada visualmente a primeira página com `pdftoppm -png -scale-to 1200 -f 1 -singlefile`, sem alterar o documento. Fontes/licença em `server/data/fonts`; nenhuma chamada a serviço PDF.

Todos os arquivos desta pasta contêm somente QA sintético. Não são amostras de dados reais nem comprovação de homologação do proprietário. Bancos temporários são excluídos pelo harness; não entram no Git. Nenhum contêiner, volume, rede ou serviço de VPS foi criado por esses comandos.
