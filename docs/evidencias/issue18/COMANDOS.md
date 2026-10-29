# QA da Issue #18

Ambiente local de desenvolvimento, Node 24; nenhum comando remoto/VPS. Bancos descartáveis fora do Git. Screenshots contêm somente valores e nomes sintéticos explicitamente identificados.

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
python3 tests/browser/issue18_import.py
git diff --check
```

Resultado: 84 testes Node, 23 testes de instalação/recuperação e 6 grupos de navegador aprovados. Build e typecheck aprovados. Permanecem somente os quatro avisos preexistentes do App. O Chromium precisou executar fora da restrição de sockets do sandbox; os processos pertenciam exclusivamente ao QA em loopback.

- [Resultados de navegador](resultados.json)
- [Desktop — Catálogos](desktop-catalogos.png)
- [Desktop — Precificação](desktop-precificacao.png)
- [Desktop — Diagnóstico e parâmetros](desktop-diagnostico.png)
- [Mobile — Catálogos](mobile-catalogos.png)
- [Mobile — Precificação](mobile-precificacao.png)
- [Mobile — Diagnóstico e parâmetros](mobile-diagnostico.png)

As imagens mostram MR vazio como pendência verdadeira. O teste posterior confirma o seletor com um fator configurado explicitamente para QA. Não há nova interface nesta entrega.

A exportação real foi coletada pelo conector Coda em leitura e aplicada somente em um banco V7 local isolado: 28 serviços, 75 dimensões e 16 diagnósticos; 44 dimensões com preço compatível, 51 com energia completa, 28 com ambos. Repetição sem novas inserções. Três casos com dados reais comparados a fórmulas somente leitura do Coda: 3/3 preços e energias iguais no domínio compatível. Valores comerciais e fonte bruta ficam privados, fora do Git. O coletor REST é coberto por transporte simulado, sem afirmar execução com token produtivo.
