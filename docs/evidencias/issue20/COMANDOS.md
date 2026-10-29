# QA Issue #20

Ambiente de desenvolvimento, Node 24, API/Vite em loopback e SQLite temporário. Screenshots usam dados sintéticos. Fontes Coda brutas, preços reais, credenciais e bancos não integram o Git. O [relatório técnico](../../ISSUE20_REGRAS_COMERCIAIS.md) explica limites e precedência.

```bash
npm run check
python3 tests/browser/issue20_pricing.py
node scripts/check-coda-import-cases.ts FONTE_PRIVADA.json MATRIZ_NOVA.json --all-services
node scripts/check-issue20-preservation.ts FONTE_PRIVADA.json BANCO_QA_NOVO.sqlite
git diff --check
```

Resultado: 95 testes Node, build/typecheck e 6 grupos de navegador aprovados. Apenas quatro avisos de lint preexistentes. Chromium usa permissão de sockets para os processos locais do QA, sem acesso a serviços produtivos.

As cinco suítes de `python3 tests/browser/pr17_auditoria_regressions.py` também foram executadas, redirecionando `ARTIFACTS`/`REPORT` para `/tmp` e `.runtime` (sem substituir evidências históricas): **58 grupos aprovados**, discriminados em `testes.json`. Para repetir no caminho padrão, o runner existente executa os mesmos módulos. O teste de Atendimento exige `REPORT` dentro do checkout para apresentar seu caminho relativo; essa regra foi respeitada na execução final.

- [Resultados do navegador](resultados.json)
- [Resultados consolidados](testes.json)
- [Matriz completa sem valores comerciais](matriz.json)
- [Resumo por serviço e tabela](MATRIZ.md)
- [Desktop — flags administrativas](desktop-flags.png)
- [Mobile — flags administrativas](mobile-flags.png)
- [Desktop — Diagnóstico e painel](desktop-diagnostico.png)
- [Mobile — Diagnóstico e painel](mobile-diagnostico.png)

Comparação com PR #19 na mesma fonte real atual: 28 combinações completas anteriores mantiveram total/energia; 160 passaram a calcular; nenhuma regressão entre casos comparáveis. Nova matriz: 188/300, com 112 pendentes e Mecânica sem dimensão registrada separadamente. Não é homologação de todos os serviços ou de componentes sem MR autorizado.
