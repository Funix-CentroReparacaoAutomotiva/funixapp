# Fase 4 — aplicação automática e assistida de recomendações

Base `main`: `b0995ae5795719f7ebbe853a44f166a7becda65f`. Branch exclusiva `feature/fase4-aplicacao-recomendacoes`. Somente implementação/QA local sintético. Nenhum acesso à VPS/Coda/banco instalado; nenhuma nova importação dos catálogos reais ou das 77 relações.

## Diagnóstico e solução mínima

A Fase 3 já persistia intensidade e regras, validava seus vínculos e oferecia o GET autenticado. Não criava serviços; não havia origem persistida das linhas nem recibo idempotente de aplicação. A validade estrutural também não autorizava serviços ocultos/canonicamente bloqueados. Esses contratos foram preservados.

Foi acrescentada uma única operação transacional de aplicação. Ela reconsulta as regras e a política vigente por IDs, preserva serviços existentes e inclui somente os ausentes/autorizados. Não existe uma sequência de POSTs por linha. Criação, origem e flags iniciais são confirmadas no mesmo commit SQLite, com revisão de peça/cenário e recibo persistente para recuperação.

| Situação | Comportamento |
| --- | --- |
| Operador informa diagnóstico/intensidade em peça sem serviços/componentes | Autosave primeiro; depois uma aplicação atômica da última combinação confirmada |
| Peça vazia já salva é aberta/recarregada | Somente consulta; ação explícita Aplicar serviços sugeridos, sem reaplicação por montagem da tela |
| Existe serviço manual, mesmo desabilitado/incompleto, ou componente | Nenhuma inserção automática; Ver serviços sugeridos para inclusão assistida |
| Nova combinação com serviços existentes | Preserva linhas/dimensões/quantidades/flags; atualiza somente as ofertas |
| Recomendação false | Criada visível e desabilitada inicialmente, sem desaparecer da composição |
| Serviço já existe, inclusive em outra dimensão | Identificado como presente; nunca duplicado pelo assistente nem corrigido automaticamente |
| Serviço bloqueado/oculto/sem curadoria ou vínculo indisponível | Ignorado/reportado; outras sugestões elegíveis continuam |
| Diagnóstico/intensidade ausente ou nenhuma relação | Nenhuma linha inventada |
| Falta preço/configuração técnica | Mesmo estado pendente do motor, nunca zero fabricado |

## Dados, prioridades e cenários

Usa exclusivamente IDs de regras/serviços/dimensões já existentes. A prioridade aprovada é explícita em `shared/commercial-curation.ts`, a partir dos IDs também registrados na matriz pública anterior: Montagem `i-vmJ3Org23i`, Funilaria `i-q8IL0mnuIJ`, Pintura `i-XDTMBmueos`, Degradê `i-SW0n7TLbtf`, Alinhamento `i-6tWzUWof8c`, depois Outros por identidade estável. Nomes não são chaves e a lista manual anterior não é reordenada.

Quantidade inicial é `1`. `selectedByDefault` define a flag inicial somente no cenário ativo, inclusive na inclusão assistida: o checkbox da lista escolhe a inclusão, não redefine a habilitação. Opcionais são identificados como “inicia desabilitado” e podem ser habilitados depois pelos controles atuais. Os outros cenários recebem as novas linhas desabilitadas, sem alteração das demais flags. Nenhuma confirmação de terceiro é concedida pela aplicação; confirmações de linhas existentes permanecem intactas.

Se uma combinação tiver alternativas de dimensão do mesmo serviço ausente, não se escolhe uma por aproximação: o automático reporta `CHOOSE_DIMENSION`; o operador pode escolher uma regra por serviço no assistido. Serviços repetidos criados conscientemente pelo editor manual continuam permitidos e preservados.

## Persistência, concorrência e migração

Migração **V9 → V10**, somente:

- Coluna nullable `diagnosis_services.recommendation_rule_id`, FK para a regra de origem. Linhas anteriores recebem null; nenhum vínculo histórico é inferido.
- Tabela `recommendation_applications`, chave por peça/cenário/idempotencyKey, hash do corpo e confirmação original. Não é fila externa nem novo serviço.

O recibo impede que uma resposta perdida cause nova criação. Repetir o mesmo corpo/chave retorna a confirmação original sem alterar dados, inclusive depois de exclusão/ajuste manual de sugestões; mudar o corpo com a mesma chave é conflito. Peça/cenário devem pertencer ao Atendimento. Revisões/combinação são verificadas antes de nova aplicação, referências/políticas novamente consultadas e limite de 50 conferido antes de qualquer insert. Falha durante um insert reverte linhas, máscaras, revisões e recibo.

O frontend continua usando o autosave serial existente. Apenas alterações do operador em diagnóstico/intensidade registram intenção automática; geração recente vence resposta antiga. Sem alteração efetiva, não se carrega uma intenção antiga para uma edição posterior de observação. Durante a pequena operação de aplicação, os controles do editor ficam temporariamente protegidos; depois voltam a funcionar normalmente. Erro de gravação incerta mantém essa proteção e oferece Tentar novamente/Carregar versão salva. A recuperação lê o workspace antes de repetir o mesmo comando idempotente e confere o ACK contra uma nova leitura confirmada; não sobrescreve edição concorrente posterior.

Origem é metadata somente leitura. O cliente não pode atribuí-la por PATCH manual; o editor não a reenviará como campo editável. Alterar serviço/dimensão/quantidade preserva a origem da criação da linha. O motor de preço, energia, prazo, negociação, MR, arredondamento, emissão e template PDF não foram alterados. Snapshots anteriores não são regravados.

Importador comercial mantém V8/V9 e acrescenta V10; o de recomendações mantém V9 e acrescenta V10, sem executar migrações de alvo. A atualização é necessária porque o esquema ganhou a FK de origem, não para recarregar dados. As ferramentas anteriores mantêm seus guards e não devem ser usadas sobre esquema não suportado. Rollback de imagem anterior exige banco compatível, pelo mecanismo já existente; nenhuma infraestrutura foi implementada.

## Interface preservada

Somente a seção Serviços recebe ação discreta e lista inline com seleção, dimensão, estado “Já presente”, indicação de opcional e inclusão explícita. Linhas originadas de regras mostram “Origem: sugestão”, mantendo os controles existentes. Não há novo modal, tela ou navegação.

Os fieldsets sem borda/padding preservam a geometria e permitem o bloqueio transitório necessário durante aplicação/recuperação; o campo de diagnóstico/intensidade também fica protegido nesse intervalo, sem reorganizar o cabeçalho da Fase 3. O botão de anotações conserva posição e função. Nenhuma mudança de Mapa, Copiloto, painel financeiro ou swipe. Fase 5 não foi iniciada.

## Arquivos e contratos

| Arquivos | Mudança |
| --- | --- |
| `server/apply-recommendations.ts` | Única aplicação atômica/idempotente, contexto, revisão, política, capacidade e retorno verificável |
| `server/app.ts` | POST autenticado com Origin/JSON existentes |
| `server/migrations.ts` | V10 aditiva, coluna de origem e recibos |
| `server/commercial.ts`, `shared/commercial.ts` | Leitura/tipos de origem e contratos da operação; PATCH manual preserva a origem sem aceitá-la do cliente |
| `shared/commercial-curation.ts` | Somente prioridade por IDs; políticas/permissões/versão de curadoria inalteradas |
| `src/DiagnosisEditor.tsx`, `src/diagnosis-editor.css` | Aplicação após autosave, assistência inline, estado de falha, origem discreta e proteção transitória |
| `src/CommercialPanel.tsx` | Retorna o workspace já consultado ao editor para conferir a aplicação sem GET redundante |
| `server/coda-import.ts`, `server/import-coda.ts`, `server/diagnosis-recommendations.ts` | Compatibilidade declarada dos importadores com V10 |
| `server/tests/*`, fixtures e `tests/browser/*` | Aplicação/rollback/limite/proveniência/terceiros, upgrade V9 preservado e regressões |
| `docs/API.md`, `AGENTS.md`, relatório/evidências | Decisão vigente e reprodução |

As expectativas de testes de migração foram atualizadas para V10 e para a coluna nullable, continuando a comparar integralmente os campos legados. Fixtures SQL V8/V9 congeladas não recebem novos contratos comerciais.

## Matriz dos 16 critérios

| Critério | Evidência de validação |
| --- | --- |
| 1 Inicial vazio | Navegador: uma única aplicação da última combinação persistida; backend guard de conteúdo vazio |
| 2 Opcionais | Linhas visíveis, quantidade 1, false no ativo e demais cenários |
| 3 Serviço/componente já existente | Nenhum POST automático, dados/flags/frações preservados |
| 4 Assistido explícito | Lista inline e uma operação para os IDs escolhidos |
| 5 Duplicação | Serviço existente bloqueado por ID, mesmo com dimensão distinta/null ou repetição manual anterior |
| 6 Ajustes manuais | Quantidade 0,25/dimensão null/estado independente preservados na mudança de diagnóstico |
| 7 Troca rápida | Leve→Moderado→Severo durante PATCH atrasado: apenas Severo aplicado |
| 8 Reload/reinício | Peça salva vazia não aplica no mount; linhas/origens existentes permanecem após restart |
| 9 Cenários | Novas máscaras só no ativo; flags de peça/componentes/linhas anteriores inalteradas |
| 10 Pendências de origem | Três vínculos sintéticos pending excluídos; nenhuma aproximação/recarga da fonte real |
| 11 Curadoria | IDs técnico/Encantamento bloqueados e serviço sem curadoria não são inseridos; demais seguem |
| 12 Rede/idempotência/revisão | Resposta perdida, falha antes da entrega, 409 e escritor após ACK com recuperação explícita; recibo não recria linhas apagadas |
| 13 Cálculos/terceiros | Motor inalterado; componente/frações/MR, energia/prazo e confirmação existente preservados; novos terceiros não confirmados |
| 14 Histórico | Snapshot e bytes do PDF anteriores idênticos após aplicação/migração/restart |
| 15 Responsividade | Screenshots desktop1440/390/320, lista inline utilizável, sem overflow |
| 16 Regressões | Fases 1/2/3 e suítes anteriores executadas; resultados finais nas evidências |

## Testes e evidências

Resultados finais e screenshots em [`docs/evidencias/fase4/`](evidencias/fase4/):

| Comando | Resultado |
| --- | --- |
| `npm run check` | Build, TypeScript frontend/backend, 228 testes Node e lint aprovados; quatro avisos preexistentes de effects em `src/App.tsx` |
| `python -m unittest discover -s deploy/tests` | 23 testes aprovados |
| `bash -n deploy/funix-install deploy/funix-deploy deploy/funix-ssh deploy/test-containers.sh` | Sintaxe aprovada |
| `python tests/browser/fase4_recommendations.py` | 33 grupos aprovados: 11 em cada resolução 1440/390/320 px |
| `python tests/browser/fase4_regressions.py` | 307 grupos de 19 suítes anteriores aprovados (retomada com `issue7_scenarios` após corrigir espera de montagem no próprio teste) |

Total: **340 grupos de navegador**, incluindo Fases 1–3 e regressões integradas anteriores. Logs `check.log`, `implantacao.log`, `browser.log`, resultados por resolução e `regressoes-resultados.json` preservados. Após o último ajuste que evita pré-selecionar dimensões ambíguas, `npm run check` e os 11 grupos completos de 320 px foram repetidos com sucesso (`browser-final320.log`).

No teste antigo de cenários mobile, foi acrescentada somente uma espera pela montagem do seletor antes de navegar: sem ela o helper interpretava o carregamento inicial como ausência do menu e saía da tela. Nenhuma asserção foi removida ou enfraquecida. Os outros testes existentes receberam somente as expectativas necessárias de esquema V10.

 Todos os testes usam SQLite temporário e cadastros/regras explicitamente sintéticos; nenhum dado privado ou banco é versionado. As 77 relações reais instaladas não foram reimportadas, consultadas na VPS ou modificadas. A validade da fonte real já documentada na Fase 3 não é reapresentada aqui como nova coleta/validação produtiva.

## Limites e publicação futura

Não há seleção por nomes, intensidade presumida, preço novo ou correção das três pendências. Falta de configuração continua pendência do motor; atividades sem intensidade não recebem serviços fictícios. Aplicação não autoriza execução/contratação de terceiros.

Após auditoria e eventual autorização separada de publicação, a migração V10 será aplicada pelo mecanismo de startup existente. Ela conserva os catálogos e as 77 relações V9; **não é preciso executar qualquer importação comercial ou de recomendações para esta fase**. Esta entrega para no PR e na CI, sem merge/deploy/VPS e sem Fase 5.
