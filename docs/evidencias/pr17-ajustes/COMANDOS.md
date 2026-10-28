# PR17 após auditoria — comandos e resultados

Referência anterior `bbcaa82fe667dfef9da8ff49ec72fb22df9cfc91`; mesma branch `feat/editor-autosave-mr`. Execução em desenvolvimento em 28/10/2026; nenhum ambiente instalado ou produtivo foi acessado.

| Comando | Resultado |
|---|---|
| `npm run check` | **Aprovado**: build Vite/TypeScript, tipos backend, **76 testes Node/SQLite** e lint sem erro. Permanecem os quatro avisos anteriores de set-state-in-effect em `App.tsx`. Nenhum aviso novo nos arquivos adicionados. [Saída](npm-check.txt) |
| `python3 -m unittest discover -s deploy/tests -v` | **23 testes aprovados**, sem instalação/deploy real. [Saída](testes-deploy.txt) |
| `python3 tests/browser/pr17_auditoria_regressions.py` | **58 grupos aprovados**: auditoria 8, editor/painel 17, Atendimentos 19, cenários 3, inclusão/recuperação 11. [Saída](browser.txt) |
| `git diff --check` | Aprovado, sem erros de whitespace |

O runner usa Playwright/Chromium, API local real e arquivos SQLite temporários. Falha se 5173/8787 estiverem ocupadas; inicia/reinicia/encerra somente seus próprios processos. Remove credenciais Coda do ambiente de teste, usa senha aleatória efêmera e bloqueia hosts externos. Não inclui banco nem credenciais nas evidências.

Resultados estruturados:

- [Auditoria de Configurações/pending/erro/MR](auditoria/resultados.json)
- [Editor/painel aprovados e comparação com HTML](editor/resultados.json)
- [Atendimentos](atendimentos/resultados.json)
- [Cenários](cenarios/cenarios-resultados.json)
- [Inclusão/recuperação](inclusao/resultados.json)

Desktop **1440×960**, mobile **390×844**. As capturas `auditoria/*` mostram as duas seções de Configurações, a linha em Calculando e o estado de erro real injetado no transporte. Capturas `editor/*` revalidam as duas telas normais e negociação aberta/recolhida, comparando também os estilos computados com os HTMLs originais na mesma largura. Nenhum erro de runtime do navegador ou solicitação a host externo.

O teste `pr17_auditoria.py` chama `pdftotext -layout` nos PDFs realmente baixados, gerando [desktop](auditoria/desktop-orcamento-mr.txt) e [mobile](auditoria/mobile-orcamento-mr.txt). Confere preço manual **R$375,00**, MR **1.2** e revenda **R$450,00**, sem `FCT` ou `undefined`. Não afirma homologação em produção.

O job validate existente do PR verificará também as imagens Docker e o Compose, sem mudança de workflow. Nenhum workflow_dispatch, publicação produtiva ou deploy foi iniciado nesta tarefa.
