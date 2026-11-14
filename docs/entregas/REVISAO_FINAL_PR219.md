# Revisão final da PR #219

Branch: `feat/funil-conversas-atendimento-autonomo`. Base revisada: `eab381640f1683af3c371c96ff7a5c3ece510c9c`. Complementa [a entrega integrada](FUNIL_CONVERSAS_ATENDIMENTO.md). Escopo limitado às pendências comprovadas; nenhuma alteração no motor financeiro, PDF de produção, contratos Evolution instalados ou schema V18.

## Diagnóstico e correções

| Causa reproduzida | Correção e arquivos |
|---|---|
| O workflow de PDF procurava a aba `Diagnósticos`, embora o gesto já abrisse corretamente `Diagnóstico`. Ao final, também esperava schema V17. | `tests/browser/pdf_emission.py`: seletores da aba aprovada e asserção V18; preservados os testes de gestos, transições, diálogos, erros, prévia, emissão, snapshots e downloads. |
| A projeção comercial usava apenas o Contato do handle canônico, ocultando apelido salvo antes da confirmação PN/LID no outro handle. | `server/chat/local-associations.ts`: consulta os Contatos dos aliases exatos confirmados. Apelido não vazio do canônico prevalece; na ausência, usa o apelido do alias e seu `contactId` editável. Nenhum registro é fundido ou apagado. Havendo dois apelidos diferentes, ambos permanecem salvos. |
| A contagem de não lidas ignorava leituras registradas no alias secundário antes da confirmação. | A projeção em lote considera marcas de leitura de todos os handles da identidade técnica confirmada e conta IDs de mensagem distintos. Não reescreve recibos nem snapshots. Conflitos continuam impedindo leitura/envio e ocultando prévia/telefone. |
| Substituir/remover a referência da ficha preservava o N:N, mas também podia manter um contexto de trabalho antigo. | `server/customers.ts`, `server/atendimentos.ts`, `server/chat/local-associations.ts`: mudança do Contato principal revoga contextos do Atendimento; remoção de outro Contato revoga o canal correspondente, incluindo aliases comprovados. Preserva N:N e mensagens. Reutiliza `context_revision`, remove a seleção afetada e exige seleção explícita antes de ler/enviar novamente. Tokens antigos são recusados mesmo após A→B→A. |
| Editar apenas placa/notas/pagador podia desvincular a referência reconhecida se o PATCH repetisse o mesmo telefone. | Telefone textual inalterado mantém a referência e o contexto. Referências anteriores são capturadas antes do UPDATE da ficha, dentro da transação. |
| Fechar uma ficha já salva recarregava o Atendimento e desmontava o Chat, apagando rascunhos sem troca de destinatário. A resposta PATCH também omitia referências reconhecidas. | `src/App.tsx`, `src/AtendimentoForm.tsx`, `server/app.ts`: não recarrega ao fechar edição já confirmada; PATCH retorna a mesma representação completa do GET, capturada dentro da transação de gravação. Só uma alteração nos Contatos limpa o contexto/compositor e a seleção da URL. O formulário permanece aberto durante autosave. |

A seleção explícita de conversa na edição ocorre depois da gravação das referências, para não revogar a escolha que o próprio operador acaba de confirmar. A desvinculação N:N continua uma ação separada, com razão e autor persistidos; remover uma linha da ficha não autoriza apagar histórico. Uma seleção de outro Atendimento no mesmo canal permanece válida. Não há associação por telefone semelhante, nome ou foto.

Commits de código: `4a8a23a` (seletores e schema do teste PDF) e `8ece81a` (projeções PN/LID, contexto de Contatos, autosave e regressões). Um commit documental posterior registra as evidências finais.

## Testes de regressão acrescentados

`server/tests/customer-alias-review.test.ts` contém seis testes: PN/LID com apelido e leituras anteriores à confirmação/reinício; lista em lote e mensagem duplicada nos dois aliases/conflito; substituição, bloqueio de leitura/envio com token antigo, nova seleção e desvinculação auditada; remoção por alias com reinício; preservação de contexto em edições irrelevantes/telefone igual e revogação por telefone alterado; precedência determinística de dois apelidos sem alteração dos snapshots.

`server/tests/customer-http.test.ts` verifica que o PATCH autenticado devolve as referências reconhecidas, equivalentes ao GET. `scripts/customer-experience-browser.mjs` prova em 320/390/1440 px que editar placa preserva o rascunho, trocar Contato neutraliza o Chat anterior, o N:N histórico permanece e a nova seleção abre somente o canal correto com compositor vazio. Todos os envios são mocks locais.

## Migração e inbound

A V18 foi revalidada, sem modificação ou nova migração. Os testes de `customer-inbound.test.ts` cobrem upgrade aditivo a partir da V17, preservação de UUIDs/vínculos, falha DDL com rollback, recuperação, ambiguidades, conflitos, reutilização e concorrência em seis processos SQLite. Os novos testes em arquivo comprovam integridade/FKs e persistência de leituras, apelidos e contexto revogado/explicitamente selecionado após reinício. A suíte PDF verifica V18, integridade, FKs e documentos persistidos em cada viewport.

A política de criação inbound permanece: primeiro evento elegível cria/reutiliza uma única ficha; snapshot inicial imutável, retries idempotentes, campos manuais preservados, LID sem telefone inventado, encerrados sem reabertura automática. Nenhum envio de apresentação foi introduzido.

## Verificações finais

| Verificação executada | Resultado |
|---|---|
| `npm run check` | Exit 0: build/TypeScript frontend, TypeScript servidor, 987 testes de servidor, lint e 8 testes de custo/voz |
| `npm run check:server` + `npm run test:server` após a última alteração | Exit 0; 987 testes passaram novamente |
| Novas regressões PN/LID e HTTP | 9 testes passaram (seis novos cenários de aliases/Contatos e três cenários HTTP, um ampliado) |
| `npm run lint` após ajustes finais | Exit 0; warnings existentes preservados |
| `git diff --check` | Sem erros |
| `node scripts/customer-experience-browser.mjs` | 320/390/1440: fluxo aprovado, confirmação mock, referências, rascunho preservado e troca de Contato segura |
| `node scripts/atendimento-vehicle-browser.mjs` | 320/390/1440: ficha, anos, autosave e negociação |
| `node scripts/diagnosis-quote-browser.mjs` | 320/390/1440: Diagnóstico, Mapa, composição, cotação e orçamento |
| `python3 tests/browser/chat_v20_conversations.py` | 320/390/1440: polling, mídia e envio sintético, revogação de contexto |
| `python3 tests/browser/chat_mvp_local.py` | 320/390/1440: histórico local, paginação, edição/exclusão e recibos |
| `python3 tests/browser/chat_v20_links.py` | 320/390/1440: vínculos N:N, conflitos e desvinculação explícita |
| `python3 tests/browser/chat_local_base.py` | 320/390/1440: regressão de navegação, sessão e histórico |
| `python3 tests/browser/pdf_emission.py` | 320/390/1440: suíte completa, exit 0; gestos/abas, prévia/PDF real, rascunhos, falhas conhecidas/incertas, reinício, hashes originais e V18/integridade/FKs |

Build conserva o aviso de chunk acima de 500 kB; lint conserva warnings anteriores, sem erro bloqueante. As capturas foram inspecionadas nas três larguras. A falha do PDF original foi reproduzida antes de corrigir o teste.

Evidências sintéticas: [manifesto](../evidencias/revisao-pr219/verificacoes.json), [fluxo comercial](../evidencias/revisao-pr219/customer-results.json) e resultados de PDF por viewport. O CI remoto deve ser consultado para a SHA final em [PR #219](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/219/checks); a conferência do resultado terminal de todos os workflows será informada na entrega. Não presumir que uma execução antiga valida um commit posterior.

## Riscos e homologação

Recomendada para revisão técnica após as verificações locais e remotas do commit final. A política conservadora exige reselecionar uma conversa após troca/remoção de Contato; isso é intencional e precisa ser exercitado com vendedores. Se dois aliases já tinham apelidos, o canônico prevalece sem destruir o secundário; eventual unificação de cadastros exige ação própria futura.

Não havia cópia de banco instalado autorizada nesta revisão: a V18 foi exercitada exclusivamente em SQLite sintético, inclusive arquivos/reinícios e falha simulada. Mantém-se o roteiro de homologação da entrega original: cópia de desenvolvimento autorizada com backup, recepção assinada e capacidades/foto PN/LID na Evolution instalada, aparelhos reais e envio a número controlado somente mediante autorização específica. Nenhum acesso ou alteração em banco instalado, mensagem real, Evolution instalada, merge ou deploy foi realizado.

## Preparação de homologação controlada

O [procedimento de homologação controlada](HOMOLOGACAO_CONTROLADA_PR219.md) complementa esta revisão sem reabri-la: ensaio sintético em arquivo com backup/WAL, falha/recuperação V18, verificador somente leitura e matrizes de Evolution/aparelhos ainda pendentes de recursos e autorização. A nova rodada distingue resultados locais de integrações reais não executadas.
