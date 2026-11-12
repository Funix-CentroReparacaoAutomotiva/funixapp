# FUNIX — Conversas × Funil: contrato de reconciliação (Issue #103)

**Estado:** especificação e desenvolvimento isolado na PR #148. Não há garantia produtiva de reconciliação, nem alteração do n8n/ERP/Coda/Evolution.

## Limite do MVP aprovado

- **Atendimentos manuais do FunixApp e do ERP/Coda são independentes.** Não sincronizar cadastros manuais automaticamente, não usar nome/telefone/placa para fundir registros. O futuro handoff do atendimento criado no FunixApp para produção ocorrerá **somente no agendamento**, por contrato próprio.
- O fluxo **originado em mensagem WhatsApp** continua Evolution → classificador n8n → Coda → evento assinado → vínculo no FunixApp. Não é sincronização geral de registros manuais.
- A conversa é entidade histórica N:N, mas a seleção automática depende do Atendimento comercial **ativo e canônico**, não de telefone coincidente nem da fase local.

## Estado verificável do código

- O receptor `CodaEventSyncRepository` é idempotente por `eventId`, vincula uma linha Coda a exatamente um Atendimento local e preserva histórico por JID exato; possui um único contexto ativo por JID.
- Na PR #148, `GET /api/chat/conversations/:id/active-atendimento` lê, para ID opaco de conversa, o vínculo ativo canônico **no instante do clique**, sem buscar pelo telefone; permite abrir a ficha logo após evento Coda tardio.
- A busca local por telefone da PR #148 é **somente navegação**, não prova de histórico Evolution. O modal de múltiplas fichas locais não equivale a múltiplas oportunidades abertas no Coda.
- Há um emissor HMAC conectado no workflow n8n produtivo `21wpOido7t5OHb7i`. Algumas mensagens podem ser descartadas pelo validador; execução `success` não prova recibo `202` para cada mensagem. Ainda não foi verificada outbox durável nem recuperação completa.

## Contrato de recuperação a implementar

1. Após confirmação de `codaRowId` **originado pelo WhatsApp**, registrar uma intenção de sincronização com `eventId` imutável, referência canônica e estado durável; nunca incluir atendimentos criados manualmente no escopo desse processo.
2. Evitar perda entre gravação Coda e outbox: reconciliador periódico consulta exclusivamente eventos WhatsApp elegíveis confirmados e identifica ausentes. Evitar varredura/espelhamento de todos os cadastros Coda.
3. Em tentativa de entrega, assinar **bytes exatos** `coda-sync-v1\n<Timestamp>\n<RawJSON>` com segredo independente; nova assinatura/timestamp por tentativa; corpo e eventId permanecem iguais.
4. `202` com recibo encerra pendência; timeout/rede/503 entram em retry com backoff e limite; 401/403 suspendem envio até correção; 409/422 entram em quarentena com revisão de dados; nenhum erro pode criar ficha duplicada.
5. Garantir unicidade de intenção e claim concorrente para worker; n8n Data Table de DEV com `get` + `update` não prova claim atômico ou `exactly-once`. Considerar persistência transacional ou reconciliador idempotente e execução serial bem delimitada.
6. PN e LID não podem ser fundidos por inferência, e `Não gerar lead` deve continuar respeitado. Mais de uma oportunidade ativa no Coda exige confirmação de elegibilidade; não decidir apenas pela coluna `stage` local.
7. Métricas sanitizadas: eventos elegíveis, eventos em espera, entregas confirmadas, conflitos, pendências por idade e recuperação. Nunca incluir telefone, JID, nome, mensagem ou segredo em logs/Issues.

## Gate antes de alterar produção

Testar com Coda e FunixApp DEV isolados, eventos sintéticos, duplicação 20x, reordenação, crash/restart, receptor offline, PN/LID, sem lead e múltiplas candidaturas. Verificar backups e rollback, integridade de dados e aprovação separada antes de publicar alterações n8n, banco ou app.

**Não implementado nesta PR:** outbox/reconciliador produtivo, resolução de múltiplos casos comerciais pelo Coda, nem integração de agendamento. Não interpretar um CI verde como essas garantias.


## Revisão adicional em 11/11/2026 — limites comprovados na branch

- A referência DEV agora só considera entrega confirmada quando o transporte retorna **HTTP 202 com corpo de recibo da aplicação** (`status:202`, `state:created|existing`, `atendimentoId` UUID). HTTP 202 sem recibo válido recebe tratamento de falha temporária (retry idempotente); isso impede sucesso falso de proxy/gateway. O endpoint existente do FunixApp produz esses campos.
- A política de elegibilidade DEV deixa de presumir que todo status não encerrado é aberto: status não reconhecido gera `identity_review`. A lista explícita de estados abertos é **provisória**, deve ser validada contra os IDs/status reais do Coda antes de conectar à operação; não autoriza criar/encerrar Atendimento por conta própria.
- Inspeção **somente leitura** do workflow n8n publicado `21wpOido7t5OHb7i` mostrou 55 nós, com evento validado após nova leitura Coda, HMAC e POST já conectados. O nó emissor **não é uma outbox** e a leitura após confirmação não oferece por si só recuperação após crash/reinício. O nome do nó “OFF” não representa seu estado: o nó POST publicado está habilitado. Nenhum nó foi alterado nesta revisão.
- O classificador produtivo detecta oportunidades abertas pelo conjunto de status de encerramento. A política DEV deliberadamente mais conservadora não substitui o classificador publicado; deve-se validar o catálogo real de status para evitar bloqueios indevidos.
- Os exemplos DEV de `fx_UUID` indicam proveniência de evento; **não é um marcador de origem universalmente confiável por si só**. Uma solução produtiva precisa confirmar a cadeia evento recebido → decisão do classificador → linha Coda confirmada, com regra explícita de exclusão de cadastros manuais, e não apenas aceitar correspondência de telefone ou campo vazio.
- Recuperar o intervalo entre gravação no Coda e registro na outbox exige um **reconciliador independente** que consulte registros comprovadamente originados por WhatsApp, com cursor/varredura segura e paginação completa. O `reconcileDevelopmentSnapshot` demonstra idempotência quando recebe uma lista confiável, mas **não coleta** os dados, não inicia periodicamente e não é uma implantação durável no n8n.

**Gate pendente:** contrato persistente da origem no Coda/n8n, mecanismo de varredura e claim seguro, QA com falhas/restart em ambiente DEV integrado, migração operacional e plano de rollback. A PR permanece draft; CI verde dos testes de referência não equivale a esse gate.

## Decisão de ambiente e taxonomia validada — 11/11/2026

- A direção esclareceu que **o FunixApp atual já é o ambiente DEV** e não está em utilização operacional. Portanto, desenvolvimento e ensaios do MVP devem aproveitar essa instalação, sem exigir outra instância ou outro banco DEV. Isso **não constitui autorização de merge nem de publicação** e não converte o classificador n8n publicado, conectado ao WhatsApp real, em sandbox descartável.
- Consulta somente leitura à tabela Coda `cnf_StatusComercial` confirmou **10 status vigentes**: sete não encerrados — `Novo lead (30min)`, `Aguardando dados (24h)`, `Em negociação (48h)`, `Morno (3 dias)`, `Frio (5 dias)`, `Agendado`, `Entrou` — e três encerrados — `Orçamento rejeitados`, `Fim negativo`, `Fim positivo`. A lista explícita substitui o conjunto ilustrativo no resolvedor DEV. Um status futuro não reconhecido provoca revisão, não vinculação automática.
- Linhas do ERP originadas manualmente permanecem fora do resolvedor WhatsApp mesmo que telefone, nome ou veículo coincidam; telefone em branco na ficha manual não bloqueia os casos WhatsApp independentes. A existência de `fx_UUID` com padrão de mensagem é indício estrutural, não substitui prova da cadeia de origem e bloqueios no n8n.
- A futura recuperação no **mesmo ambiente de aplicativo** ainda depende de um produtor/reconciliador para o lado Coda/n8n, com origem comprovada, retentativas e verificação de recibos. A referência local da outbox não é lançada automaticamente ao iniciar o FunixApp.


## Verificação de 11/11/2026 — Coda real e recuperação histórica

- Leitura **somente leitura** da tabela `db_Atendimentos` (1.157 linhas) constatou 248 registros com `fx_UUID` no padrão `evo:funix_comercial:...` e `api_ID Omnichanel` PN correspondente. Desses, **247** também possuem o canal WhatsApp esperado `i-O01Tgl0bN2`; **1** possui discrepância no canal e não deve ser importado automaticamente.
- O schema verificado contém `fx_UUID`, `api_ID Omnichanel`, `funil_Canal` e campos comerciais, mas **não contém uma cópia imutável do evento com `occurredAt` original**. O receptor HMAC exige timestamp original e usa-o para evitar retrocesso do Atendimento ativo. Portanto, **não é seguro criar eventos históricos a partir apenas da data de criação/edição da linha**. Não fazer backfill especulativo.
- Acrescentado `server/chat/coda-recovery-dev.ts`: lê um snapshot completo, exige origem, canal, identidade e corpo imutável comprovado, e coloca na outbox idempotente. Casos históricos sem snapshot, supressões desconhecidas, divergências e linhas manuais são contabilizados sem importar registros nem expor PII. **O módulo ainda não está ligado a uma consulta periódica, nem à instância executando FunixApp**.
- Rascunho n8n `21wpOido7t5OHb7i`: classificação `Code in JavaScript1` foi alterada para desconsiderar cadastros manuais/filtrar JID e canal e bloquear escolha silenciosa com múltiplas oportunidades reais; validação posterior da linha canônica exige canal e JID iguais ao evento. **A versão publicada não foi alterada.**
- Próxima dependência de arquitetura: registrar um *snapshot imutável* no instante da confirmação Coda (ou em armazenamento durável autorizado) e implementar varredura independente + reentrega a partir dessa fonte, com confirmação do recibo, sem reclassificar histórico nem sincronizar fichas manuais. Para legado sem `occurredAt` comprovado, preservar exceção manual, não falsificar data.

**Estado:** código/testes em DEV e rascunho n8n, sem alteração de Coda, banco instalado, execução produtiva ou publicação de workflow. 

## Incremento DEV — vínculo à origem e duplicidades (11/11/2026)

- O reconciliador `coda-recovery-dev.ts` faz **pré-verificação do conjunto completo de linhas** e bloqueia todas as ocorrências de um ID de linha ou `fx_UUID` duplicado. Não existe mais resultado dependente da ordem da varredura; casos duplicados não geram entrega antes da revisão.
- O novo `coda-source-ledger-dev.ts` define a junção conservadora **mensagem original imutável → linha Coda confirmada → outbox** para o *evento que criou a linha*. A origem precisa trazer `eventId`, `occurredAt` real, JID, identificação, status de supressão e instância. Não inventar horário de criação a partir do Coda. Cadastros manuais, registros incompletos e conflitos continuam fora.
- Uma mensagem posterior que **reutiliza uma ficha Coda** não pode ser conciliada apenas pelo `fx_UUID` original dessa ficha. É necessário persistir especificamente a decisão `messageEventId → codaRowId` após revalidação do classificador; o adaptador atual não afirma cobrir esse caso e não deve impor vínculos pela coincidência de telefone.
- O adaptador ainda é código sem I/O para a origem. **Não existe neste incremento criação/acionamento de uma fonte imutável persistida no n8n**, nem agendamento de varredura ou integração ponta a ponta. Estes permanecem dependências para conclusão da Issue #103.
- Os testes de duplicidade, eventos sem origem, identidade e opt-out estão incluídos na PR #148. Resultado do CI deve ser reportado para a SHA exata em que cada execução terminar.

## Incremento — fonte imutável em SQLite DEV (11/11/2026)

- `coda-source-storage-dev.ts` introduz tabela **append-only** `dev_whatsapp_source_ledger` no SQLite do FunixApp, criada somente por chamada explícita ao construtor de schema. `eventId` é chave primária; regravação idêntica é idempotente, divergência é conflito e dados sem identidade, horário original ou permissão `Não gerar lead = false` são rejeitados. Nenhuma rota, cron, sincronização ou migração automática foi habilitada.
- O reconciliador `reconcilePersistedSourceLedger` lê a fonte imutável por cursor com páginas de 100 registros (limite explícito de 10 mil) e cruza apenas com um **snapshot Coda completo e confiável fornecido por quem chama**. Eventos de criação cuja `fx_UUID` é idêntica à mensagem de origem podem chegar à outbox. Mensagens posteriores que reutilizam o mesmo Atendimento ainda exigem um mapeamento durável separado, registrado após a decisão do n8n.
- Testes sintéticos cobrem reinício SQLite, conflito imutável, cursor, fonte inválida e recuperação até a outbox. O código está **inativo no bootstrap**: não foi conectado ao Coda real, ao n8n publicado nem aos dados da oficina; portanto não comprova recuperação ponta a ponta.
- **Dependência para a etapa seguinte:** decidir e implementar como o n8n, que recebe a mensagem original e faz a classificação, escreverá eventos de origem comprovada de maneira autenticada e durável ANTES de depender da confirmação Coda, sem abrir uma sincronização de cadastros manuais ou duplicar o ERP. Não inserir registros reais sem validação de dados, sigilo e reprocessamento.

## Receptor de origem autenticado — DEV desligado por padrão

- `server/chat/coda-source-endpoint-dev.ts` implementa `POST /api/integrations/whatsapp/source-ledger`. A rota **não existe (404)** sem `FUNIX_SOURCE_LEDGER_ENABLED=true` **e** chave `FUNIX_SOURCE_LEDGER_HMAC_KEY_BASE64` de 32–64 bytes; ativação cria a tabela aditiva no SQLite persistente do FunixApp. Não se confunde com as credenciais Evolution nem com a assinatura do receptor Coda.
- Contrato de autenticação: `X-Funix-Timestamp` atual, `X-Funix-Signature: sha256=<hex>` sobre os bytes de `whatsapp-source-v1\n<Timestamp>\n<JSON exato>`, sem Origin/browser, somente JSON UTF-8, máximo 2 KiB, desvio de relógio máximo 300 segundos. A aplicação valida campos exatos, instância `funix_comercial`, `source=whatsapp`, `suppressed=false`, JID PN, telefone coerente, identificador e `occurredAt` original. Retorna 202 `created/existing`; conflito retorna 409.
- **O endpoint grava somente o evento de origem, não cria Atendimento.** Enfileiramento/associação só ocorre após confirmação canônica da linha Coda e verificação das regras comerciais. Isso permite preservar o horário da mensagem original mesmo se o Coda estiver temporariamente indisponível.
- **Estado de implantação:** rota e flag codificadas em branch PR #148 e cobertas por testes HTTP sintéticos; flags não foram ativadas na instalação existente, nenhuma credencial foi configurada, nenhum n8n foi publicado e nenhum dado real foi enviado por essa rota. Ainda falta a etapa de produtor n8n antes do Coda e um reconciliador periódico que consulte registros Coda confirmados.

## Incremento 11/11/2026 (noite): produtor de origem preparado e teste de cadeia

- Verificado que a resposta **real** da rota `/api/integrations/coda/atendimentos` é HTTP 202 e corpo `{atendimentoId,state}`, **sem** campo `status` dentro do corpo. Corrigido `coda-outbox-worker-dev.ts` para validar exatamente o contrato retornado pela aplicação; os testes usam o recibo real. O rascunho n8n agora também exige `state=created|existing` e `atendimentoId` UUID; não confunde HTTP 202 com confirmação operacional.
- Preparados no rascunho do workflow n8n existente quatro nós intitulados `DEV | Fonte WhatsApp`: montar evento mínimo sem corpo da mensagem, calcular HMAC independente, enviar ao `/api/integrations/whatsapp/source-ledger` e validar recibo. Os nós foram **conectados apenas entre si, desconectados do fluxo principal**. Não existe chave própria configurada/validada neste desenvolvimento; ativação depende de integrar o gate de `Não gerar lead`, obter confirmação durável da fonte e preservar continuidade do classificador existente.
- Adicionado `server/tests/coda-reconciliation-integration-dev.test.ts`: usa exclusivamente dados fictícios, SQLite temporário, receptor `CodaEventSyncRepository` e transporte injetado; simula persistência da origem, reinício antes da confirmação Coda, inclusão idempotente na outbox, falha 503 e confirmação posterior, sem duplicar Atendimento. Este teste **não substitui** um ensaio de execução real no n8n nem ativa a instalação.
- Nenhum nó do workflow publicado foi alterado, não houve envio real, alteração de credencial, execução n8n, merge ou deploy. Registrar a versão de rascunho antes de qualquer publicação, pois a versão ativa permanece separada.
- **Próximo gate técnico:** vincular o percurso de origem no ponto sequencial correto (antes da operação Coda, sem paralelo que permita corrida), configurar autenticação e decisão de opt-out confiáveis, testar falhas e retomadas no fluxo completo, persistir decisão mensagem → linha canônica também quando reutiliza Atendimento e adicionar agendamento de reconciliação seguro.

### Segurança do rascunho n8n — chave independente

- Em leitura posterior do rascunho, constatou-se que o n8n associou automaticamente ao novo nó HMAC de origem a credencial existente **`FUNIX | VPS ↔ n8n | HMAC`**, também utilizada pelo caminho antigo. Não se deve considerar essa credencial uma chave independente para a nova rota.
- Como contenção, os nós `DEV | Fonte WhatsApp | HMAC independente` e `DEV | Fonte WhatsApp | POST FunixApp` foram explicitamente **desabilitados** no rascunho, que permanece desconectado do fluxo de classificação principal. Nenhum envio real foi feito. Antes de testar a integração, substituir por uma credencial exclusiva e verificar separação de segredos entre emissor e receptor.

## Incremento — decisões imutáveis para reaproveitamento comercial

- `coda-decision-ledger-dev.ts`: nova estrutura SQLite de desenvolvimento **opt-in**, append-only, que registra a decisão comprovada `eventId da mensagem → codaRowId canônico + remoteJid`. O mesmo evento não pode mudar de linha sem produzir conflito. A tabela **não** é habilitada no bootstrap da aplicação, nem fornece endpoint público.
- `reconcileConfirmedDecisions` cruza essa decisão persistida com a fonte original imutável e com o conjunto comprovadamente confirmado de linhas Coda. Só prepara eventos para outbox quando o Coda conserva origem WhatsApp, canal correto e mesmo JID, com supressão já validada na origem. Duplicação da linha canônica, origem ausente ou divergência de identidade falham fechado; registros manuais não entram por coincidência de telefone.
- A implementação separa o **evento original que criou a ficha** de **mensagens posteriores que reutilizam a mesma ficha**. A associação posterior deve ser produzida depois da revalidação do classificador no Coda, ainda não conectada ao n8n.
- Testes sintéticos cobrem confirmação/replay, conflitos de mapeamento, ausência de fonte, rejeição de linha manual e múltiplas linhas com mesmo ID. Não afirmar sincronização real até existir o produtor autenticado de decisões e reconciliador integrado com operação.

### Receptor de decisão canônica — desenvolvimento

- `POST /api/integrations/whatsapp/confirmed-decision` recebe **somente** `{eventId,codaRowId,remoteJid}`, depois que o classificador confirmar uma linha Coda; usa HMAC com domínio específico `whatsapp-decision-v1` e a mesma chave independente do diário de origem (não a credencial antiga `VPS ↔ n8n`). É distinto do endpoint que recebe `occurredAt` original. O receptor grava exclusivamente uma decisão imutável no SQLite, sem criar Atendimento.
- A rota fica **404 por padrão**, habilitada junto com `FUNIX_SOURCE_LEDGER_ENABLED=true` e uma chave de alta entropia. Controles de payload pequeno, timestamp, content-type, origem do navegador, assinatura e conflito 409 são testados. O adaptador de reconciliação lê apenas decisões confirmadas e fontes originais imutáveis, exige existência da linha Coda com proveniência WhatsApp e identidade exata.
- O novo endpoint **não verifica Coda online ao gravar**; a conformidade do registro é verificada na reconciliação antes da fila. O n8n precisa produzir a decisão somente depois de releitura canônica, sem pular as regras de bloqueio. Sem essa emissão, o módulo é infraestrutura de DEV não utilizada.
- Nenhuma credencial foi instalada/configurada nem qualquer flag foi ativada no aplicativo; os nós HMAC e POST preparados no rascunho n8n seguem **desabilitados** e o fluxo publicado continua separado.

## Incremento DEV — coordenador de reconciliação paginada (11/11/2026)

- `server/chat/coda-reconciliation-runner-dev.ts` é o novo orquestrador **de chamadas explícitas**, sem cron ou credenciais. Recebe um provedor de páginas Coda injetado e **não começa a enfileirar enquanto não confirmar o fim da varredura completa**. Rejeita cursor repetido, página vazia com continuação, limite excedido e término incompleto; limita a coleta e impede ciclos concorrentes na mesma instância.
- Depois de uma leitura confirmada, cruza fonte WhatsApp original e decisões canônicas com todas as linhas confirmadas, usa a outbox idempotente e tenta entregar **um evento por ciclo**, respeitando o contrato HMAC, recibo real da aplicação e retentativas do worker. Uma falha de transporte não inventa vínculo e permanece pendente.
- Testes `coda-reconciliation-runner-dev.test.ts` exercitam leitura em múltiplas páginas, interrupção/incompletude, cursor circular, concorrência, repetição e reaproveitamento de Atendimento confirmado. Todos os dados são fictícios.
- **Limites importantes:** o provedor precisa atestar por conta própria a paginação consistente, identidade, fonte e completude da API Coda. O orquestrador não acessa a API, não tem timers e não está rodando no FunixApp instalado. Não ativa a flag da fonte nem conecta nós da produção do n8n. Mais adiante, conectar ao provedor real requer validação de paginação e corrida entre atualizações Coda, deduplicação, falhas operacionais, métricas e credencial exclusiva.

### Preparação da decisão canônica no rascunho n8n

- Acrescentados quatro nós `DEV | Decisão Coda` (preparação do contrato `eventId → codaRowId + remoteJid`, HMAC em domínio `whatsapp-decision-v1`, POST e verificação do recibo). São **um trecho isolado e desconectado da classificação publicada**; os nós HMAC e POST estão desabilitados, sem credencial exclusiva configurada, sem envio externo e sem disparo de teste contendo cliente real.
- A preparação lê a saída da releitura `Evento | Validar vínculo` e a decisão anterior do classificador, exigindo origem WhatsApp, política `Não gerar lead=false` e ID canônico consistente. Esta preparação por si só **não é uma autorização de envio** e não substitui o teste integrado com dados sintéticos.
- Um produtor conectado precisa aguardar a confirmação da fonte imutável, permitir a classificação comercial sem duplicação, esperar a confirmação do Coda e então persistir a decisão. Falhas devem manter uma pendência recuperável: a simples cadeia de HTTP sequenciais não elimina uma lacuna de crash entre Coda e decisão. A varredura independente continua necessária.

## Provedor real somente leitura do Coda — incremento DEV

- `coda-api-provider-dev.ts` implementa a chamada de leitura REST `GET /apis/v1/docs/{docId}/tables/{tableId}/rows`, com `pageToken` opaco, `valueFormat=rich`, `useColumnNames=false`, `visibleOnly=false` e IDs estáveis das colunas verificadas em `db_Atendimentos`. A conversão de referências de canal só aceita ID de linha, nunca nome de exibição. Uso exclusivo de `Authorization: Bearer` via argumento injetado, sem log de tokens/PII e sem escrita no Coda.
- `createDoubleCheckedCodaPageProvider` realiza **duas varreduras completas** e compara uma impressão SHA-256 dos IDs de linha, origem, JID, canal e telefone; rejeita páginas inválidas, lacunas de paginação, IDs repetidos, mudanças entre leituras e excesso de linhas. **Não garante snapshot transacional da API Coda**, nem protege contra mudanças depois da segunda varredura; em caso de desvio, não sincroniza.
- `coda-reconciliation-coda-dev.ts` conecta esse provedor ao coordenador existente somente por fábrica opt-in, sem timer, sem alterar bootstrap da aplicação e sem iniciar rede ao importar o módulo.
- Testes usam um `fetchImpl` sintético, verificando paginação, token opaco, rich reference, respostas inválidas, leitura divergente, integração com SQLite/outbox/receptor e exclusão de cadastro manual. Nenhum token real foi lido/copied, e o Coda real **não** recebeu pedidos pela nova implementação.
- Antes de ativar: validar a resposta da API oficial no ambiente conectado (especialmente a forma de `funil_Canal` em rich), comportamento de linhas atualizadas durante paginação, política de credenciais read-only, e se a oficina aceita atrasos de varredura por mudanças concorrentes. Persistir métricas e testar falhas de rede com a execução real, sem modificar dados reais.

## Incremento DEV — retentativas e agendamento com duas responsabilidades (11/11/2026)

- `coda-api-provider-dev.ts`: leitura REST oficial do Coda agora aplica no máximo **3 tentativas** a falhas de rede, HTTP 429 e 5xx com espera limitada e `Retry-After` controlado. HTTP 401/403 e payloads inválidos falham sem retentativa. Nenhum erro grava corpo da resposta, token ou informação de cliente em logs. Testes cobrem sucesso após 429/503, esgotamento de tentativas, 403 e exceções de rede.
- `coda-reconciliation-scheduler-dev.ts`: agendador **opt-in**, com um ciclo por instância, sem operações ao importar o módulo, intervalos validados e parada que aguarda a execução corrente. O agendamento **não** configura credenciais nem publica o n8n.
- `server/index.ts`: nova ativação adicional apenas por `FUNIX_CODA_RECONCILIATION_ENABLED=true`, exigindo também os gates de fonte e receptor Coda já existentes, token de **leitura** `FUNIX_CODA_API_TOKEN` e intervalo configurável `FUNIX_CODA_RECONCILIATION_INTERVAL_MS` (padrão 600000 ms). Quando desativado, a instalação continua sem varreduras automáticas nem tabelas extras de outbox por esse recurso. Nenhuma flag foi alterada na instalação atual nesta rodada.
- `coda-outbox-drain-dev.ts`: entrega de eventos já confirmados funciona em ciclo separado (1 minuto, lote máximo de 10), **sem depender de nova leitura Coda**. A entrega interna usa a mesma `CodaEventSyncRepository.sync` transacional e validada do receptor HTTP; não gera uma chamada HTTP do aplicativo para si mesmo. A fila permanece responsável pela confirmação, deduplicação, fencing, retentativas e quarentena. Testes exercitam drenagem limitada e recuperação após 503.
- **Gate não resolvido:** o classificador n8n ainda precisa publicar, depois de QA e credencial exclusiva, os eventos originais e decisões canônicas no FunixApp DEV. Um scan sem essas fontes jamais deve inventar `occurredAt` nem criar Atendimento por telefone. Mecanismo de dupla leitura não é snapshot atômico, e o calendário pode sofrer atrasos quando os dados mudam simultaneamente. Não afirmar reconciliação real já operante.

**Escopo desta rodada:** implementação em branch PR #148 e testes sintéticos. Nenhum merge, deploy, ativação de env, publicação do n8n ou escrita nos dados reais ocorreu.

## Auditoria adicional de identidade — 12/11/2026

- A correção do rascunho n8n `Code in JavaScript1` limita a regra `unknownOrigin` ao mesmo `remoteJid` ou mesmo `fx_UUID`. Antes, uma linha de outro cliente podia bloquear globalmente a classificação. A alteração permanece em rascunho, não publicada.
- Foi identificado um risco de **conflito entre os dois caminhos de reconciliação**: a recuperação de eventos criadores de fichas já bloqueava duplicações de `fx_UUID`, mas a recuperação de decisões comerciais posteriores não exigia que o marcador de origem fosse único na varredura completa.
- Foi implementada `assertNoConflictingCodaOriginClaims` em `coda-decision-ledger-dev.ts` e chamada pelo coordenador **antes de qualquer enfileiramento**. Ela impede que uma decisão imutável aponte a mensagem criadora para outra linha ou selecione uma origem duplicada. A reconciliação de decisões verifica também unicidade do marcador da linha, não apenas unicidade de `row.id`.
- Testes cobrem colisão entre dois registros Coda com a mesma origem e tentativa de remapeamento da mensagem inicial, inclusive no coordenador: nenhum evento é inserido nem enviado quando o pré-check falha.
- **Limite:** o pré-check verifica o conjunto recebido; continua dependendo de varredura Coda completa e consistente, e da origem autenticada. Não detecta uma linha que a API omitiu, não cria associação por telefone e não substitui confirmação operacional do n8n.
- Sem merge, deploy, publicação n8n, ativação de feature flag ou escrita em dados Coda. CI deve ser conferido pelo SHA final da branch.

## Gate de validação integrada autenticada — 12/11/2026

- Consulta às credenciais n8n acessíveis identificou HMACs existentes para outras integrações, mas **não uma credencial exclusiva** da nova fonte/decisão WhatsApp. Não reutilizar `FUNIX | VPS ↔ n8n | HMAC` ou `FUNIX | Atualizações | HMAC`. Os nós de POST e HMAC da integração continuam desabilitados no rascunho, sem publicação.
- Adicionado `server/tests/coda-authenticated-chain-dev.test.ts`: teste exclusivamente sintético que envia **HTTP POST com HMAC correto** ao receptor de origem, testa replay idempotente, envia decisão comercial pós-Coda autenticada, executa duas leituras Coda simuladas, reconcilia a mesma ficha de origem e de reutilização e confirma duas entregas sem criar duas fichas. Assinaturas cruzadas de domínios fonte/decisão são rejeitadas. O teste não usa clientes ou tokens reais.
- Essa evidência prova o contrato de servidores e os componentes simulados, **não** que o n8n publicou eventos, que a API REST Coda respondeu como no teste, que a instalação do FunixApp foi modificada ou que a conexão real está ativa.
- Antes de habilitar: criar/configurar credencial exclusiva em cada lado, garantir assinatura sobre os bytes exatos enviados, testar decisões e fonte com mensagens sintéticas no n8n desconectado do ramo operacional, comprovar entrega e recuperação após falha/reinício, validar com segurança e rollback antes da publicação. A ativação de n8n e o merge/deploy seguem como gates separados.

## Validação contratual do rascunho n8n — 12/11/2026

- Extraídos para fixture de teste exclusivamente os seis blocos JavaScript do **rascunho** atual, sem credenciais, execuções reais nem mensagens de clientes. `server/tests/n8n-commercial-contract-dev.test.ts` executa esses códigos em VM isolada para reproduzir: evento original Evolution, `fromMe`, timestamp, origem JID, exclusão de cadastros manuais, outro cliente não bloqueia a conversa, canal divergente, múltiplos Atendimentos abertos, replay, emissão após confirmação e domínios de assinatura separados.
- Corrigido no rascunho `Code in JavaScript` o tratamento de `messageTimestamp`: `null`, vazio, booleano, zero ou texto inválido resultam em `occurredAt=null`, **não** no falso timestamp epoch zero. Tanto segundos numéricos quanto string decimal válida seguem preservados; o envio ao ledger continua recusando eventos sem horário comprovado.
- Identificada diferença de chave técnica: `Get all rows` e `Coda | Confirmar linha canônica` consultavam `funil_contatoE164` (telefone normalizado), enquanto a elegibilidade/associação canônica exige `api_ID Omnichanel` (JID real). Isso poderia omitir um Atendimento existente quando a normalização do telefone diverge. **Apenas no rascunho**, ambas as consultas Coda passam a filtrar pelo JID exato; os demais checks de `fx_UUID`, canal e origem continuam obrigatórios. A fixture também guarda as duas expressões e o teste impede a regressão para busca por telefone.
- Esses testes validam comportamento dos blocos do rascunho sem disparar o workflow completo; não atestam credencial exclusiva, ordem transacional entre n8n e Coda ou execução produtiva. O workflow publicado permanece inalterado; HMAC/POST dos nós DEV continuam desconectados e desabilitados.
