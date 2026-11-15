# OR/OS — preenchimento por estado e regressão Chromium

Branch: `fix/document-button-computed-colors`, base `main` / `f6e215bfe489d69834b5d77597349ce71d92ea3d` (PR #228). Ensaio em 15/11/2026, dados exclusivamente sintéticos, build de produção Vite e componentes reais do FunixApp, API autenticada e SQLite temporário em arquivo. Sem merge, deploy, banco existente ou alterações de infraestrutura/workflows.

## Diagnóstico: fatos e limite da conclusão

1. A PR #228 já aplica as classes certas. No Chromium, o build original produz OR com `backgroundColor=rgb(224, 243, 230)`, `borderColor=rgb(126, 189, 147)`, `color=rgb(20, 109, 56)`, e OS pendente com `backgroundColor=rgb(225, 237, 255)`, `borderColor=rgb(128, 171, 232)`, `color=rgb(23, 79, 169)`. A [captura anterior](evidencias/os-browser/before-pr228-390.png) mostra esses fundos pastel, próximos do fundo claro anterior. Não reproduzimos uma sobrescrita das cores no desenvolvimento nem no bundle original de produção local. A diferença de especificidade não é apresentada como causa comprovada.
2. O defeito visual corrigido é a paleta de preenchimento muito clara: a cor mais definida estava no texto/borda. Agora a superfície inteira e sua borda recebem a cor definida do estado, com texto branco. Os seletores incluem a classe base para manter a regra do estado acima da aparência genérica do componente, sem `!important`. `disabled` não desbota documentos: uma operação pendente não deve apagar o significado da cor. O cancelamento mantém seu estilo existente.
3. Os testes anteriores de `work_order_flow.py` conferiam classes, não cores computadas nem pixels. Essa lacuna permitia aprovar uma aparência inadequada. O teste novo, executado contra um **checkout separado da base original**, falhou precisamente em `backgroundColor=rgb(224, 243, 230)` mesmo com `budget-action-issued` no elemento. O código corrigido passa no mesmo teste.
4. Há também defeito comprovado no marcador de olho: o último segmento do caminho SVG não tinha coordenadas suficientes. Chromium emitia `Error: <path> attribute d: Expected number`. O segmento foi corrigido, preservando o olho azul no círculo branco.
5. `BudgetPanel.tsx` já distingue documento emitido cancelado de OS nunca criada, confirma cancelamento sem pedir motivo e recarrega metadados da API. Histórico e detalhe foram testados. O backend bloqueou a tentativa de criar OS depois do cancelamento (HTTP 409). Não foi necessário mudar API, SQL ou regras financeiras. No detalhe, a consulta da OS agora só ocorre quando os metadados do histórico indicam que ela existe; isso evita o GET 404 desnecessário de uma OS nunca criada e deixa o console limpo.

**A causa da divergência observada no navegador publicado ainda não pode ser declarada resolvida.** O domínio `app.funix.com.br` está bloqueado pelo proxy deste ambiente (CONNECT HTTP 403). Foi solicitada sua liberação; sem ela, não foi possível comparar os bytes atuais dos assets entregues nem a sessão do usuário. Não atribuímos a cache uma causa não demonstrada.

## Publicação: evidência disponível

O [run 43677827679](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/actions/runs/43677827679), job `deploy` 132702213265, publicou `f6e215bfe489d69834b5d77597349ce71d92ea3d`. Os logs registram `FUNIX deploy concluído` e sucesso da verificação HTTPS de `/api/ready` **e** `/release.json` com igualdade da revisão. Digest web: `sha256:7c9f2616cb8a7c7eecfb19136b076a95f24c06f71da64c0f7ef6ba7fe5cb68a8`. Isso comprova a revisão verificada pelo workflow naquele momento, não os bytes carregados posteriormente em um navegador específico.

O build original local continha `index-C8SB-30C.css` e `index-D1c6brm9.js`. A aplicação não registra service worker. A configuração existente serve HTML/release com `no-store` e assets com hash como `immutable`; não encontramos justificativa para modificar o deploy. A comparação direta com o bundle atualmente entregue continua pendente do acesso ao domínio.

## Alterações

- `src/budget-experience.css`: quatro preenchimentos/bordas definidos e texto branco; opacidade integral dos estados documentais desabilitados. Mantidos layout compacto, marca diagonal somente na letra, identificação cinza, marcadores e cancelamento existentes.
- `src/BudgetDocumentActions.tsx`: caminho SVG válido para o olho.
- `src/BudgetPanel.tsx`: usa `workOrderNumber` do histórico para consultar somente OS emitida; mantém erros reais visíveis, sem suprimir mensagens no console.
- `tests/browser/document_button_colors.py`: regressão de cores/pixels/estados, integrada ao teste já executado pela CI `tests/browser/work_order_flow.py`. Nenhum workflow foi alterado.

## Cores efetivamente computadas

Valores confirmados em histórico e detalhe, em 1440, 390 e 320 px, inclusive após reload e reinício da API:

| Estado | Fundo e borda (`getComputedStyle`) | Texto |
|---|---|---|
| Emitido válido | `rgb(20, 109, 56)` / `#146d38` | `rgb(255, 255, 255)` |
| Ainda não criado | `rgb(23, 79, 169)` / `#174fa9` | `rgb(255, 255, 255)` |
| Emitido cancelado | `rgb(160, 35, 61)` / `#a0233d` | `rgb(255, 255, 255)` |
| Nunca criado, orçamento cancelado | `rgb(102, 117, 138)` / `#66758a` | `rgb(255, 255, 255)` |

Marcador `+`: `rgb(33, 136, 61)`; olho: `rgb(33, 102, 199)`; círculo branco: `rgb(255, 255, 255)`. A OS indisponível não apresenta marcador. Identificação cancelada (letra, número, total, data): `rgb(135, 147, 162)`. Número sem risco; letra mantém a diagonal. Cancelamento desabilitado nos cenários C/D. O teste exige `opacity=1`, ausência de imagem de fundo e **mais de 60% dos pixels reais do controle na cor esperada**; resultado observado: 71,7% a 82,4%.

## Capturas reais

As letras A/B/C/D na tela correspondem, nesta fixture, aos cenários solicitados: válido sem OS / válido com OS / ambos cancelados / cancelado sem OS.

| Viewport | Os quatro cenários | Dados computados |
|---|---|---|
| 320 × 844 | [Chromium 320](evidencias/os-browser/mobile320-four-colors.png) | [JSON 320](evidencias/os-browser/mobile320-computed-colors.json) |
| 390 × 844 | [Chromium 390](evidencias/os-browser/mobile390-four-colors.png) | [JSON 390](evidencias/os-browser/mobile390-computed-colors.json) |
| 1440 × 1000 | [Chromium desktop](evidencias/os-browser/desktop-four-colors.png) | [JSON desktop](evidencias/os-browser/desktop-computed-colors.json) |

Recortes individuais a 390 px: [A](evidencias/os-browser/mobile390-scenario-A.png), [B](evidencias/os-browser/mobile390-scenario-B.png), [C](evidencias/os-browser/mobile390-scenario-C.png), [D](evidencias/os-browser/mobile390-scenario-D.png). Há também recortes de cada cenário em 320 px e desktop no mesmo diretório. Nenhuma captura é mockup HTML.

## Verificação

- `npm run check`: build, TypeScript de servidor, 1030 testes de servidor, lint e 8 testes de custo de voz aprovados. Há warnings preexistentes do lint e de tamanho do bundle.
- `python tests/browser/work_order_flow.py`: fluxo existente de OS e nova matriz A/B/C/D aprovados nos três viewports. Inclui confirmação/recusa, resposta perdida após commit, documentos imutáveis, reload, reinício da API, histórico/detalhe, bloqueio de criação pós-cancelamento, cores/bordas/texto/marcadores/pixels, identificação cinza, ausência de colisão entre controles e de overflow horizontal.
- Nenhum `pageerror`, erro de console (incluindo recursos/SVG) ou tráfego externo no ensaio. A ausência de OS é representada pelos metadados reais; não se faz GET de OS inexistente e não há filtro que oculte mensagens de erro no teste.
- Snapshots e bytes dos PDFs originais foram comparados no SQLite antes/depois. PDFs válidos continuam abrindo no fluxo Chromium existente. Links dos documentos cancelados permanecem disponíveis. Os testes de servidor cobrem imutabilidade e o contrato de marca d'água `static-pdf`/`CANCELADO`.

## Pendências e riscos remanescentes

1. Comparar o bundle efetivamente servido e o navegador onde o problema foi observado exige acesso de leitura ao domínio. A correção está comprovada no build local, não implantada.
2. A marca d'água real dos PDFs cancelados depende do jsreport configurado no ambiente. Não houve validação ponta a ponta desses PDFs com o jsreport real; a fixture atual de navegador não implementa a receita `static-pdf`. Não se deve confundir testes do contrato e preservação dos originais com homologação do renderer externo.

Portanto, a paleta e os quatro estados estão visualmente validados nos componentes reais, mas o critério de aceitação integral no ambiente publicado permanece pendente dos itens acima. Esta PR não executa merge nem deploy.
