# Evidências locais — editor e painel financeiro

Base main `ef7633f310e0b8b8f498df4445012e408e8df3e7`, branch `feat/editor-autosave-mr`. Somente dados sintéticos. Execução em Node 24/npm 11, Python/Playwright e Chromium do ambiente de desenvolvimento. Sem serviços produtivos.

| Comando | Resultado |
|---|---|
| `npm run check` | Aprovado: build Vite/TypeScript, tipos backend, **72 testes Node/SQLite**, lint sem erro. Quatro avisos já existentes em `src/App.tsx`; nenhum aviso novo nos arquivos modificados. [Saída](npm-check.txt) |
| `python3 -m unittest discover -s deploy/tests -v` | **23 testes aprovados**, sem executar instalação/deploy real. [Saída](testes-deploy.txt) |
| `python3 tests/browser/editor_financeiro_regressions.py` | **50 grupos aprovados**: editor/painel 17, Atendimento 19, cenários 3, Issue12 inclusão 11. [Saída](browser.txt) |
| `pdftotext -layout docs/evidencias/editor-financeiro/desktop-orcamento-sintetico.pdf docs/evidencias/editor-financeiro/desktop-orcamento-sintetico.txt` | Extração independente: total R$2.700,00, componentes R$450,00 e desconto R$250,00 conferidos. [Texto](desktop-orcamento-sintetico.txt) |
| `git diff --check` | Sem erros de whitespace |

O runner usa portas próprias 5173/8787, SQLite temporário em arquivo, senha aleatória efêmera e bloqueio de tráfego externo. Falha se uma porta estiver ocupada. Reinicia somente sua própria API. Sem erros de runtime de navegador nem chamadas a hosts externos.

- [Editor/painel — resultados](resultados.json)
- [Atendimentos — resultados](regressoes/atendimentos/resultados.json)
- [Cenários — resultados](regressoes/cenarios/cenarios-resultados.json)
- [Inclusão/recuperação — resultados](regressoes/inclusao/resultados.json)

Desktop: 1440×960; mobile: 390×844. Os PNGs sem sufixo são a aplicação real. Recortes `*-referencia.png` renderizam o HTML original na mesma largura do componente para comparação, com viewport/media queries preservados. Nenhuma captura de referência é apresentada como funcionalidade implementada.

As imagens Docker e o Compose serão verificados pelo job validate existente no PR; não se executou deploy, publicação GHCR nem workflow_dispatch nesta tarefa. Os resultados locais não constituem homologação produtiva.
