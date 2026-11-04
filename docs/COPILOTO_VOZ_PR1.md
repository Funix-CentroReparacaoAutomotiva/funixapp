# Copiloto de Orçamento por Voz — PR 1/3

Base inspecionada: `main` `9a0ffb370cf00611c913ee09f07c3142b867c9f1`, após o merge do PR #41. Branch exclusiva: `feat/voice-command-planner`.

Entrega: contrato TypeScript, validação de dados e planejador determinístico **sem escrita**. Não há microfone, transcrição, IA, endpoint, integração com o botão ou alteração da tela de diagnóstico. Não foi acessada a VPS, Coda ou qualquer base instalada.

## Auditoria antes da implementação

| Contrato real e fonte | Reaproveitado | Acréscimo nesta entrega / lacuna |
|---|---|---|
| [CatalogItem/catalogItemUsable](../shared/commercial.ts), [CommercialRepository](../server/commercial.ts) | ID, código físico, tipo, atividade, identificação e pertencimento dimensão→serviço. Status/origem não bloqueiam o catálogo único. | Referência estruturada resolvida por ID ou não resolvida com candidatos. Nenhuma busca por nome, aproximação ou código novo. |
| `DiagnosisItem` | Uma peça física por Atendimento, diagnóstico/intensidade/observações compartilhados; intensidade `leve/moderado/severo/null`. | Patch restrito aos campos ditados; múltiplos danos/intensidades independentes viram pendência, não sobrescrita. |
| `DiagnosisService` | Identidade da linha distinta do serviço; dimensão nullable de rascunho, quantidade decimal positiva textual, observação/diagnóstico de linha, origem de recomendação read-only. | Incluir garante presença sem duplicar. Linhas manuais repetidas continuam existentes; correção precisa identificar uma linha sem ambiguidade. Este PR não interpreta dano secundário como override de linha. |
| [DiagnosisEditor](../src/DiagnosisEditor.tsx), [CommercialPanel](../src/CommercialPanel.tsx) | Quantidade inicial `1`, controles de inclusão e fila/reconciliação existentes. Serviços/componentes manuais não são reconstruídos ao trocar diagnóstico. | Contrato de intenções e referências temporárias; nenhuma integração com autosave/UI agora. |
| [ScenarioRepository](../server/scenarios.ts) | Flags por IDs; atributos e composição compartilhados. Alterações compartilhadas tocam revisão da composição e de todos os cenários. | Plano diferencia escopo compartilhado/ativo e lista cenários afetados. Não habilita pai implicitamente nem altera flags existentes de outros cenários. |
| [Consulta de recomendações](../server/diagnosis-recommendations.ts) | Consulta por diagnóstico+intensidade, IDs, vínculo válido/ativo, opcionais false preservados. | Entrada por conjunto consultado `available/unavailable`, sem SQL. Ausência de relação não vira regra plausível. |
| [Aplicação Fase 4](../server/apply-recommendations.ts) | Automático somente sem serviços/componentes; assistido escolhe IDs; não duplica serviço já presente; alternativas de dimensão não são escolhidas arbitrariamente; prioridade vigente por IDs. | Simulação dessas decisões, derivada após instruções explícitas. Nenhum applier ou recibo novo no banco. |
| [Curadoria](../shared/commercial-curation.ts) | `newServiceSelectionIssue`, `compareRecommendations`, `servicePolicy`, `executionScope`; ocultos/canônico técnico bloqueados, terceiros nunca confirmados pela sugestão. | Origens por campo e aviso de confirmação; mudança compartilhada de dimensão/quantidade indica invalidação dos escopos. |
| Quantidades em `CommercialRepository.updateDiagnosis` | Até 9 dígitos inteiros/6 casas, positivas, sem float. | Incremento exato por BigInt e substituição absoluta distintos; limite preservado. Quantidade omitida em nova linha usa somente o default `1` já existente, com origem identificada. |
| [API](API.md), revisões e [AGENTS](../AGENTS.md) | UUID/ID, cenário escolhido, composição, configuração e revisões; nada de execução externa ou motor paralelo. | Guarda todas as revisões e digest do contexto/catálogo/regras/curadoria. Não aceitar contexto fornecido pela IA. |
| Exclusões atuais | Removem globalmente; editor de serviços e lixeira de peças exigem confirmação. Snapshots/PDFs não seguem os cadastros vivos. | Só comandos explícitos planejam remoção; impacto global e confirmação existente ficam sinalizados. IA não concede essa autorização. |

### O que não foi presumido

- Os **77 vínculos / 74 válidos / três pendências / 16 false** da [Fase 3](FASE3_INTENSIDADE_RECOMENDACOES.md) foram comprovados em cópia isolada naquela ocasião; **não comprovam as regras instaladas hoje**. Nenhuma dessas contagens é seed, meta ou fallback do planejador.
- O catálogo não contém, por si, base/FD/energia completa nem uma regra universal de obrigatoriedade de serviços. `selectedByDefault` significa seleção inicial, não obrigação técnica universal.
- As [decisões da Fase 4](FASE4_APLICACAO_RECOMENDACOES.md) prevalecem sobre a descrição histórica da Fase 3 que ainda dizia não aplicar serviços. O novo código reutiliza as decisões atuais sem modificar os módulos existentes.
- O backend consulta recomendações apenas com intensidade não nula. Regras sem intensidade do assistente antigo não podem ser transplantadas para preencher essa lacuna.
- Diagnóstico Técnico/Inspeção técnica têm dois IDs históricos e seleção canônica bloqueada. Não escolher um deles por nome nem pelo legado.
- O modelo tem diagnóstico principal e possível diagnóstico por linha, mas **não intensidades independentes por dano**. `additionalDamage` sinaliza a limitação; não cria modelo paralelo.
- Peça física do catálogo e componente monetário `ComponentItem` são entidades distintas. O contrato não inclui operações financeiras de componentes neste PR.
- Pendências atuais de cálculo podem vir do workspace oficial; são informativas e não impedem preservar referências operacionalmente válidas. O plano não calcula nem certifica preços/energia/prazo após as mudanças.

### Referências v4 disponíveis

Foi consultado o skill `funix-orcamento-voz:orcamento-por-voz`, pacote `c4/orcamento-por-voz`, com `references/02_SCHEMA_ORCAMENTO.json`, `03_COMPONENTES_PARTES.json`, `04_DIAGNOSTICOS_SERVICOS.json` (`regras_canonicas`, não o raw histórico), `05_DIMENSOES_SERVICOS.json` e `06_PONTOS_PARA_VALIDAR.md`.

Esses materiais declaram versão 4.0. Não foi localizada uma distribuição local identificada como **v4 FINAL** ou um manifesto que prove equivalência exata ao pacote mencionado pela direção. Serviram como referência de correções, opcionais, quantidades e dúvidas; não foram copiados para catálogos ou precificação.

Divergências concretas: IDs locais sequenciais/nominais do legado não substituem UUIDs/IDs atuais; remover não é simplesmente desabilitar no contrato atual; trocar diagnóstico não reconstrói conteúdo manual; intensidade nula do legado não tem consulta equivalente hoje; nomes de partes/componentes não autorizam crosswalk de IDs por aproximação. Nenhuma fórmula/interface antiga foi importada.

## Contrato de entrada

[shared/voice-commands.ts](../shared/voice-commands.ts), formato `funix-voice-commands-v1`:

- Envelope: `idempotencyKey`, `atendimentoId`, `scenarioId`, `expected` (composição/configuração/todos os cenários e peças), `commands`.
- Cada comando: `id` estável, `intent: instruction|correction`, `piece`, operação e campos estritamente permitidos; `sourceText` opcional, sem interpretação neste PR.
- Operações: `add_piece`, `remove_piece`, `set_piece_enabled`, `set_diagnosis`, `add_service`, `set_dimension`, `set_quantity`, `set_service_enabled`, `remove_service`, `set_notes`, `recommend_services`.
- Referências: `{state:'resolved',id}` ou `{state:'unresolved',text,candidates?}`. Mesmo um único candidato não é escolhido pelo planejador. Linhas usam ID próprio, serviço inequivocamente único ou comando de inclusão anterior no mesmo lote.
- `set_quantity.mode`: `increment` ou `absolute`. Repetir ID/corpo no lote não repete incremento; reutilizar ID com outro conteúdo é conflito. Dois incrementos intencionais diferentes precisam de IDs distintos.
- Dimensão `null` é ausência explícita permitida no rascunho; dimensão não identificada usa referência não resolvida e não é convertida em null automaticamente.
- Chaves/operações desconhecidas (inclusive SQL, preços, emissão, confirmação de terceiro) são rejeitadas. Limites técnicos: até 100 comandos; IDs de até 100 caracteres; observações até 8000; texto de origem até 4000; até 20 candidatos. IDs de regra até 180, como o contrato Fase 4.

[validateVoiceCommands](../server/voice-command-validation.ts) aceita `unknown`: envelope inválido impede o lote; comandos inválidos são separados, preservando operações independentes válidas. Não há parser de português, correspondência por palavras-chave ou dependência de IA.

## Planejamento e resultados

[planVoiceCommands](../server/voice-planner.ts) recebe a entrada e `VoicePlanningContext`: DTOs do catálogo/workspace já consultados pelo backend, conjuntos pertinentes de recomendações e recibos confiáveis opcionais. Não recebe conexão SQLite, callbacks de escrita ou ferramentas executáveis.

Produz formato `funix-voice-plan-v1`:

- `results`: índice/ID, `valid`, `noop`, `pending` ou `conflict`; classificação por contribuição líquida no plano. Uma operação supersedida ou que retorna ao estado original não exige gravação.
- `changes`: apenas diferenças efetivas, com IDs existentes preservados; novos alvos usam referências `planned`, **não UUIDs/códigos definitivos**. A criação futura mapeará essas referências para IDs gerados na transação.
- `origins`: campos explícitos (com intenção/comando), derivados de regra (ID) ou default preexistente. Não transforma informação ausente em fato ditado.
- `issues`: código, mensagem, referências e `blocking`. Pendência de identidade bloqueia aquela operação; avisos de regra/configuração não apagam mudanças independentes. Remoções podem ser estruturalmente válidas e ainda exigir a confirmação global atual.
- `impact`: escopo, IDs dos cenários afetados, invalidação de confirmação e exigência de confirmação de exclusão. Novas linhas têm flag ativa conforme inclusão/default da regra; outros cenários recebem false. Flags já existentes dos demais cenários não são reescritas.
- `usedRules`: somente regras efetivamente utilizadas, com IDs de serviço/dimensão e comando causador.
- `requestDigest`, `stateDigest`, `guards`, `replay`, `requiresCalculation`: preparação para revalidação/idempotência futura; não substituem o motor comercial.

Instruções explícitas são processadas antes das derivações, usando o diagnóstico final. Correção válida substitui apenas seus campos. Intenções contraditórias sem correção reconciliadora são excluídas conjuntamente; o plano é reconstruído a partir do original para não deixar a primeira intenção aplicada por acaso. Demais operações continuam identificáveis.

Recomendações não sobrescrevem linhas manuais, não desfazem tombstones de exclusão e não preenchem automaticamente um serviço com intenção explícita pendente. Para criar serviço ausente, o interpretador deve emitir `add_service` com referências adequadas; `set_dimension` não cria uma linha por suposição. Se já existe conteúdo, o automático apenas reporta a necessidade do fluxo assistido vigente. Opcionais entram desabilitados quando a aplicação da regra é permitida.

### Idempotência preparada, não persistência fictícia

O plano converte incremento em **valor absoluto antes/depois**, ligado à revisão e à chave. Um recibo confiável com o mesmo hash indica os comandos já tratados e evita replanejar incrementos sobre estado novo; pendências não são falsamente marcadas como aplicadas. Mesma chave com outro conteúdo/cenário é conflito.

**Este PR não implementa idempotência durável nem executa o plano.** Sem recibo, não há como uma função pura saber se outro processo aplicou uma solicitação no passado. O PR 3 deverá consultar/persistir o recibo atomicamente com a escrita, nunca simplesmente recalcular e reaplicar um incremento após falha. A chave é atribuída pelo host e conservada em retry; texto igual não prova repetição.

## Exemplos sintéticos reproduzíveis

| Exemplo | Entrada / plano | Resultado |
|---|---|---|
| “Para-choque traseiro, amassado moderado, funilaria M e pintura parcial” | [01-criacao.json](exemplos/voice-planner/01-criacao.json) | Peça, diagnóstico e duas linhas explícitas; não acrescenta serviço plausível por fora das regras |
| “Muda a pintura para completa e mantém a funilaria” | [02-correcao-pintura.json](exemplos/voice-planner/02-correcao-pintura.json) | Um patch da dimensão da pintura; IDs, funilaria, notas, quantidade e flags preservados |
| Peça ambígua + observação independente | [03-ambiguidade-independente.json](exemplos/voice-planner/03-ambiguidade-independente.json) | Pendência da peça e observação válida separadas |

Os exemplos usam [fixtures tipadas](../server/tests/fixtures/voice-planner.ts), com relações consistentes e rótulos QA. Não representam dados instalados nem executam a primeira entrada para construir a segunda. O teste confere input/plano serializado contra a fixture e a função atual; nenhum exemplo contém preço ou cliente real.

## Conexão com os próximos PRs

### PR 2 — modelo para este contrato

1. Obter contexto autorizado e confirmado do Atendimento/cenário no backend; aguardar autosave/reconciliação antes de capturá-lo, e fornecer ao interpretador somente referências pertinentes.
2. Capturar/transcrever conforme o escopo que vier a ser autorizado. Nada disso foi implementado aqui.
3. Pedir JSON neste contrato; referências incertas ficam não resolvidas, sem adivinhar nomes/IDs. Manter ID da solicitação/comandos estáveis no retry e congelar o corpo confirmado pelo host.
4. Passar o JSON por `validateVoiceCommands` e `planVoiceCommands`. Modelo não fornece contexto, recibos, revisões autoritativas, confirmação de terceiros, SQL ou planos executáveis.
5. Expor pendências na própria experiência de diagnóstico a ser integrada, sem acrescentar uma tela de aprovação obrigatória. O planejador não contém UI.

### PR 3 — aplicação no backend

1. Autenticar contexto; procurar recibo da chave antes de repetir qualquer mutação.
2. Dentro de uma transação, reconsultar DTOs/regras/políticas, comparar guardas/digest e replanejar com o mesmo contrato. Nunca executar um plano enviado livremente pela IA/navegador.
3. Mapear referências planejadas para IDs reais uma vez; persistir apenas mudanças necessárias, preservando linhas/atributos não mencionados e as flags dos outros cenários.
4. Reutilizar validações do domínio e origem das recomendações. `recommendationRuleId` é read-only no PATCH manual; não forjá-lo como campo do cliente.
5. Os repositórios atuais abrem transações próprias: não encadear chamadas com `BEGIN` aninhado. A integração precisará compor os mesmos helpers no limite transacional, sem reconstruir regras. O recibo da Fase 4 cobre apenas recomendações por peça/cenário; **não é recibo universal de voz**. Definir o registro mínimo de idempotência no PR 3 e justificar eventual migração antes de implementá-la.
6. Remoção global exige o contrato de confirmação existente e escopo de revisão correto. O tratamento vocal dessa confirmação precisa ser explicitado na integração; a IA não pode autorizá-la. Não foi criada tela/modal nesta entrega.
7. Gravar o recibo junto das mutações; depois devolver workspace/cálculo oficial. Emissão/PDF/histórico não fazem parte dessa aplicação.

## Validação e matriz de aceite

| Pedido | Teste específico |
|---|---|
| 1–2 Peça ausente/existente | Inclusão uma vez; existente desabilitada não é reativada implicitamente |
| 3 Diagnóstico/intensidade | Patch compartilhado preserva notas/linhas |
| 4 Serviço sem duplicação | Existente fica intacto; novos usam referência temporária |
| 5–6 Dimensão e não mencionados | Só pintura muda; funilaria/IDs/quantidades/flags preservados |
| 7 Incremental/absoluta | BigInt exato, limites, repetição de ID e correção absoluta |
| 8 Última correção válida | Substituição por campo, correção inválida não apaga anterior, contradição posterior não revive valor supersedido |
| 9 Exclusão explícita | Regra posterior não recria serviço/peça, inclusive serviço ainda ausente |
| 10 Ambiguidades | Peça, diagnóstico, dimensão e múltiplas linhas sem escolha arbitrária |
| 11 Sem regras inventadas | Regras indisponíveis/vazias/nulas/pendentes e curadoria |
| 12 Manuais | Automático protegido, assistido não substitui conteúdo |
| 13 Cenários | Flags ativas isoladas e impactos compartilhados explícitos |
| 14 Revisões | Conflitos em composição, configuração, cenário ou peça impedem alterações |
| 15 Resultados separados | Valid/noop/pending/conflict, instruções independentes e fontes |
| 16 Sem SQLite escrito | DTOs de repositórios reais sintéticos; `total_changes()` invariável, módulo sem imports de persistência |
| 17 Histórico imutável | Snapshot e bytes PDF emitidos iguais antes/depois da chamada |
| Extras | Inputs congelados, replay parcial, ID reutilizado, curadoria/terceiros, configuração pendente, quantidade fracionária, JSON de exemplos |

Foram aprovados **362 testes Node (47 novos)**, build frontend/backend e lint, com os sete avisos preexistentes. Há teste de paridade com `applySuggestedServices`: o planejador não escreve; somente depois dele o applier existente é executado no banco sintético e seus resultados são comparados. Nenhum comportamento produtivo foi alterado para realizar essa comparação.

Comandos/resultados em [evidências](evidencias/voice-planner/README.md). Sem testes de browser novos: não há interface, endpoint ou integração alcançável pelo aplicativo nesta entrega. Build frontend e regressões Node existentes continuam executados por `npm run check`.

## Pendências delimitadas

Estado real de catálogo/recomendações da VPS não inspecionado; intensidade nula e múltiplos danos permanecem lacunas; identificação canônica da atividade técnica segue bloqueada; confirmação global e recibo transacional serão tratados na integração, não inferidos pelo modelo. Valores/configuração técnica não são fabricados para tornar uma linha calculável.

Não há migração, escrita em dados reais, merge ou deploy. Parar neste PR para auditoria.
