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
