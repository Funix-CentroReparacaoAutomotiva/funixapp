# Fase 1 — habilitar/desabilitar por cenário e excluir explicitamente

Base: `main`, `c29aedf3fcc6c66a7771c833273b4f7f39db4f8f` (V8 publicada). Branch: `fix/fase1-habilitacao-exclusao`. Entrega exclusiva para auditoria, sem merge, deploy ou acesso à VPS.

## Causa e correção

A lista de Diagnósticos e o Mapa usavam `PieceSelectionQueue.enqueue(..., false)` para controlar a presença na composição compartilhada. A fila convertia esse estado em `DELETE /diagnosticos`. Além disso, `selectedCode` consultava somente a existência da peça, ignorando `scenario_piece_flags`. Uma peça desabilitada no editor continuava visualmente selecionada nesses controles, e desmarcá-la podia excluí-la globalmente.

Os mecanismos necessários já existiam: `PATCH /cenarios/:id` modifica as máscaras por cenário; `DELETE /diagnosticos` remove a composição compartilhada com revisões; o motor usa inclusão efetiva e snapshots emitidos são imutáveis. Nenhum endpoint, tabela, migração ou cálculo novo foi necessário.

| Ação | Antes | Agora |
| --- | --- | --- |
| Habilitar peça ausente | POST de inclusão | Mesmo POST; nova peça habilitada apenas no cenário ativo |
| Habilitar peça existente desabilitada | Existência global era suficiente; podia não reabilitar | PATCH da flag do cenário ativo, mantendo o ID |
| Desabilitar na lista/Mapa/seletor | Remoção global pela fila | PATCH da flag do cenário ativo; peça continua na lista e nos outros cenários |
| Excluir | Desmarcar o seletor global | Lixeira à direita da linha; confirmação explícita sempre, seguida do DELETE já existente |
| Estado selecionado no Mapa | Existência da peça | Flag do cenário ativo, com intenções pendentes identificáveis |

Desabilitar/reabilitar preserva diagnóstico, notas, serviços, componentes e suas flags individuais. Não copia habilitações para outro cenário e não recria uma peça existente. As alterações monetárias continuam exclusivamente no motor oficial.

## Fila e integridade

- A mesma fila serial consolida intenções consecutivas de habilitação. Inclusões ausentes continuam em lotes de até duas peças, preservando o par real “Ambos”. Flags existentes usam PATCH com revisão atual do cenário.
- A exclusão é um comando explícito `enqueueRemoval`, separado de habilitar/desabilitar. A confirmação compacta existente é sempre solicitada, inclusive para peça vazia/desabilitada. O texto explicita todos os cenários.
- A fila confere o ACK e depois consulta o workspace confirmado; respostas antigas não eliminam intenções mais recentes. POST/PATCH/DELETE não são repetidos automaticamente quando a confirmação é incerta. Se a flag lida após um ACK divergir da própria gravação confirmada, a fila bloqueia antes de reaplicar a intenção: outra edição pode ter mudado a mesma flag nesse intervalo.
- Falhas de transporte, resposta ilegível/perdida e revisão concorrente bloqueiam a fila, preservam a intenção e exigem recuperação explícita com leitura antes de decidir nova gravação.
- Durante confirmação/exclusão, seleções ficam protegidas contra alterações concorrentes da própria interface. A lixeira não inicia exclusão enquanto há gravação de seleção em andamento. O backend mantém todas as verificações de composição, peças e cenários.
- Exclusão confirmada remove somente a peça e os filhos dos rascunhos, conforme o contrato anterior; não toca nos snapshots/PDFs emitidos.

## Arquivos funcionais

| Arquivo | Alteração |
| --- | --- |
| `src/piece-selection-queue.ts` | PATCH das máscaras, reconciliação por cenário e comando explícito de remoção com consentimento |
| `src/usePieceSelection.ts` | Encaminhamento do transporte PATCH existente |
| `src/CommercialPanel.tsx` | Estado selecionado por cenário, lixeira, rótulos acessíveis e bloqueios de consistência |
| `src/RemovalConfirmation.tsx` | Texto de confirmação explicita o alcance global, sem novo fluxo/layout |
| `src/piece-selection.css` | Somente coluna de 32 px e estilo/foco da lixeira reutilizando a identidade atual |

`DiagnosisEditor.tsx`, `server/scenarios.ts`, `server/commercial.ts`, motor comercial, modelos persistidos, banco/migrações, classificação e geometria do Mapa não foram alterados. A inspeção comprovou que suas máscaras/remoção já suportam a regra solicitada. AGENTS e API registram a nova decisão, que substitui a semântica anterior dos seletores.

## Matriz de aceitação

| # | Critério | Evidência |
| --- | --- | --- |
| 1 | Desabilitar nunca chama exclusão | Espião de transporte Node e requisições reais no navegador: somente PATCH de cenário |
| 2 | Peça desabilitada permanece na lista/composição | Duas peças visíveis, mesmo ID após off/on |
| 3–4 | Cenários independentes | Capô/Grade com máscaras inversas; cenário não editado permanece idêntico |
| 5 | Conteúdo e flags de filhos preservados | Diagnóstico/notas, serviços/componentes fracionários e flags false/true mantidos após off/on |
| 6 | Reabilitar não duplica | POST apenas para ausente; Mapa/Ambos preservam IDs ao alternar |
| 7–8 | Exclusão explícita e confirmada | Lixeira global, cancelamento sem requisições; peça vazia também exige confirmação |
| 9 | Orçamentos históricos imutáveis | Snapshot e hash PDF comparados antes/depois de flags e exclusão |
| 10 | Mapa/lista coerentes | aria-checked/aria-pressed e flags efetivas concordam |
| 11 | Persistência | Recarregamento, troca de cenário e reinício da API local |
| 12 | Cliques rápidos/concorrência/falhas | Serialização, última intenção, 409 real, ACK perdido, GET de recuperação e ausência de DELETE acidental |

## Testes e evidências

Somente dados sintéticos e bancos temporários; nenhuma leitura ou escrita produtiva.

```bash
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/fase1_selection.py
python tests/browser/fase1_regressions.py
```

Os testes Node antigos de exclusão continuam exercitando o comando explícito. Expectativas antigas que exigiam apagar ao desmarcar foram atualizadas para a decisão desta fase, mantendo falhas, concorrência, recuperação e atomicidade. As jornadas existentes de editor, Mapa, seleção e orçamento foram ajustadas somente nos pontos em que invocavam a antiga ação de exclusão pelo seletor. As demais suítes são reexecutadas sem mudança funcional. Uma medição de rolagem mobile divergiu transitoriamente; o teste foi comparado com a V8 original e reexecutado com sucesso na correção, sem modificar navegação/swipe. O harness aguarda a estabilização da rolagem inercial e a propagação visual do estado ocupado antes do retorno nativo durante PATCH.

Resultados, logs e screenshots em [evidencias/fase1](evidencias/fase1). Novos testes de navegador: **39 grupos**, em desktop 1440, 390 e 320 px. Testes Node: **197 aprovados**. Scripts de implantação: **23 aprovados** (testes, não deploy). **Regressões: 220 grupos em 16 suítes; total navegador: 259 grupos, todos aprovados.** Resultados finais consolidados por suíte no resumo; CI remota registrada no PR do commit entregue.

## Preservação visual e limites

Layout, posições, cores, fontes, espaçamentos, controles do editor, quatro campos financeiros, abas, swipe, Copiloto e Mapa circular permanecem com a implementação da V8. A única adição visual é a lixeira no extremo direito, após o valor. Seu espaço horizontal exige a redução mínima correspondente da coluna de texto; não há reorganização do restante da linha. Capturas desktop/mobile inspecionadas e ausência de overflow validada.

- QA mobile é emulação de viewport, não homologação em aparelho físico.
- As proteções anteriores de terceiros continuam vigentes: ao desabilitar uma atividade, a confirmação de execução pode ser revogada pelo backend; não foi alterada essa regra da curadoria. As flags individuais de habilitação dos filhos permanecem preservadas.
- Nenhuma configuração comercial é preenchida automaticamente; sem alterações de MR, intensidade, sugestões, dimensões, toque prolongado ou fases seguintes.
- A composição ainda pode ser removida por sua API administrativa existente com os guardas anteriores; a confirmação humana é realizada na interface, não foi criado token/backend novo para isso.

Sem merge, deploy, importação ou alterações na VPS. Parar para auditoria do PR exclusivo da Fase 1.
