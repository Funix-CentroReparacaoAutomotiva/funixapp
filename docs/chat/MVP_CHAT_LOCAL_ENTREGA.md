# Chat local e integração com ERP — entrega do MVP

Esta entrega implementa em desenvolvimento a arquitetura acordada em `ARQUITETURA_MVP_TRANSICAO_ERP.md`. A PR #200 passou de correção de leitura PN/LID a uma entrega do núcleo de Chat local. O relatório `IDENTIDADE_PN_LID_REVISAO.md` preserva a investigação inicial; este documento descreve o estado atual. Nenhuma implantação, merge, mensagem real ou alteração do workflow publicado foi executada.

## Responsabilidades implementadas

| Camada | Responsabilidade atual |
| --- | --- |
| Identidade técnica (`conversation-identities.ts`) | Identificadores internos, pares PN/LID explícitos, proveniência e compatibilidade dos IDs antigos. Não conhece criação de Atendimento nem regras comerciais. |
| Contexto comercial (`coda-sync.ts`) | Adaptador ERP vigente: confirmação por ID Coda, ordenação causal, revisão do contexto e bloqueio de confirmação contraditória. |
| Mensagens (`conversation-store.ts`) | Projeção nos eventos/mensagens SQLite existentes, independente de existir Atendimento. Texto, observações e metadados de mídia; sem binários. |
| Entrada (`ingest.ts`, `evolution-normalize.ts`) | Autenticação HMAC existente, validação do provedor e confirmação somente após commit. |
| Leitura e comunicação (`evolution-bridge.ts`) | Uma validação de contexto para os caminhos canônicos e genéricos; leitura local ou Evolution conforme etapa explícita. |
| Envio (`send-operations.ts`) | Operação durável vinculada ao contexto/destino, recibo reutilizável e resultado incerto sem reenvio automático. |
| Integração ERP | Source/decision ledger, outbox e reconciliação existentes continuam sendo os mecanismos para confirmações comerciais. Receber uma mensagem nunca cria uma ficha. |

Sem novos perfis, permissões por operador, aprovações por ação, microserviço, broker, banco adicional ou dependência de runtime. Login e verificação técnica de vínculo/destinatário são preservados. O n8n/ERP mantém as decisões comerciais atuais.

## Comportamento funcional

- Mensagem válida chega, a conversa e a mensagem são persistidas, e o recibo pode indicar `pending` até chegar confirmação comercial. Não há criação por telefone, nome ou foto.
- Confirmado o ID Coda, lista e Funil abrem a mesma identidade e consultam a conversa local. Um handle PN criado antes da descoberta do LID permanece canônico; handles antigos continuam resolvidos. A evidência contraditória não produz fusão transitiva.
- Com leitura local habilitada, abrir/paginar mensagens já armazenadas não consulta a Evolution. A primeira abertura sem dados/observação anterior pode carregar uma primeira página. A lista usa as conversas armazenadas e enriquece a descoberta pela Evolution; conversas recebidas não desaparecem por estarem ausentes da página do provedor. A indisponibilidade do provedor é indicada como cobertura potencialmente incompleta.
- Atualização explícita e recuperação de histórico são operações separadas. `sync-history` consulta no máximo uma página de cada JID conhecido do par, sem inventar equivalências. Não importa todo o passado; não declara completude a partir de contagens ou do fim de uma página.
- A paginação local usa cursor com limite de sequência, desempate e revisão do contexto. Uma inserção concorrente não desloca as páginas já abertas. Isso não promete um snapshot imutável de edições/exclusões; a atualização apresenta o estado atual. Mensagens antigas já carregadas são conferidas por ID e versão, em lotes limitados, para que uma edição/exclusão fora da página mais recente também atualize a tela.
- Edição válida não é desfeita por um upsert atrasado. A exclusão produz estado indisponível e não é revertida automaticamente por conteúdo atrasado. Atualizações de status antes da mensagem não inventam mensagens.
- O provedor 2.3.7 modifica `messageTimestamp` em edições. A recuperação usa essa versão somente junto da observação `EDITED`; preserva o horário original já conhecido na conversa. Corpo editado ausente oculta a cópia desatualizada, sem fabricar texto nem interpretar ausência como exclusão. Uma edição ao vivo mais recente não é substituída pela cópia mais antiga do provedor.
- Falha de sincronização não apaga as mensagens locais. Falta de vínculo, conflito ou mudança do Atendimento retira histórico/compositor do contexto anterior, inclusive durante polling.
- Repetir uma confirmação comercial do mesmo Atendimento não invalida desnecessariamente o rascunho ou cursor. A troca A→B→A altera a revisão e impede usar uma operação antiga de A.

O escopo de visualização do MVP é a conversa do contato no Atendimento canônico ativo. Não se inventa uma partição temporal por serviço nem se atribuem retroativamente as mensagens à ficha selecionada. A navegação arquivada por vários Atendimentos é uma ampliação posterior com regra explícita.

## Contratos de entrada e evidência

Endpoint existente: `POST /api/integrations/whatsapp/events`, sem Origin de navegador. Mantidos assinatura, limites e allowlist do receptor existente:

```
x-funix-key-id: <id da chave configurada>
x-funix-timestamp: <segundos de envio da requisição>
x-funix-signature: sha256=<HMAC do UTF-8 exato>

entrada da assinatura = v1\n<keyId>\n<timestamp>\n<bodyJson>
```

O body deve ser serializado uma vez e a mesma string usada na assinatura e no HTTP. Em retry, conservar o evento original, mas renovar timestamp/assinatura de transporte. O timestamp da mensagem/edição não pode ser substituído pela hora do retry.

Com o núcleo local habilitado, o receptor aceita:

1. **Contrato normalizado v2**, validado em `conversation-event.ts`: `message.upsert`, `message.edit`, `message.delete`, `message.status`, identidade explícita e conteúdo mínimo. Referências de mídia não contêm URLs/chaves do provedor. Nome opcional é somente apresentação.
2. **Webhook Evolution autenticado**, normalizado antes de persistir: `messages.upsert`, `messages.update`, `messages.delete`, `messages.edited`, `send.message.update`. Instância e formatos precisam corresponder ao contrato reconhecido. Grupos/eventos incompatíveis não recebem um recibo falso de mensagem armazenada.

Para entrada v2/normalizada, o 202 contém `eventId`, `receiptId`, `state: persisted` e `disposition`. `pending` significa armazenado aguardando confirmação comercial; `quarantined` exige revisão. Um 202 sem recibo correspondente não deve consumir a pendência do produtor.

Eventos em quarentena não guardam o conteúdo da mensagem. Depois que uma confirmação comercial posterior resolve o conflito, a recuperação exige reapresentar o evento original autenticado: o mesmo digest e recibo passam a `projected`, sem criar ficha ou duplicar mensagem. Replay enquanto persistir ambiguidade continua bloqueado; payload diferente com o mesmo ID é recusado. Exclusões/edições posteriores continuam prevalecendo. A origem precisa conservar o evento original para essa recuperação; o recibo de quarentena não é confirmação de projeção.

**Evidência real de upsert:** execução n8n `38949`, consultada somente para leitura, mostra `data.key`, `status`, `message`, `messageType`, `messageTimestamp`, `instanceId`, `source`, sem `data.id` da linha do banco. `evolution-webhook.ts` é sua fixture estrutural sanitizada. O adaptador distingue a chave WhatsApp da referência interna exigida pelo parser de histórico; não inventa um ID comercial e não persiste o payload bruto, URLs ou segredos do webhook.

**Edições/status/exclusões:** formatos e semântica conferidos no código público da tag 2.3.7, incluindo a mudança do timestamp em edições e os dois formatos de exclusão. Fonte: `https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`. Cobertura com fixtures sintéticas e HTTP local. Isso não comprova a assinatura de todos esses eventos na configuração instalada; verificar as subscrições e um exemplo sanitizado durante a homologação autorizada antes de substituir a leitura operacional.

A evidência PN/LID registra primeira/última observação, origem e referência SHA-256 da chave. Ausência posterior de alternativo não apaga evidência. Conflitos permanecem bloqueados para os dois lados; não há um botão que escolha identidade por nome/telefone.

## Envio e erros

No núcleo novo, texto/mídia levam `requestId` e `contextToken` além do conteúdo. São campos técnicos transparentes à operação, não novas permissões. O backend verifica o vínculo atual e o PN confirmado, e registra o comando antes da chamada externa.

- Mesmo ID/conteúdo/contexto aceito: retorna o primeiro recibo, sem outra chamada ao WhatsApp.
- Mesmo ID com conteúdo ou contexto diferente: conflito.
- Concorrência entre handles do mesmo destinatário: bloqueada no registro durável.
- Timeout ou processo interrompido após início: resultado incerto. Não reexecutar automaticamente. Ao iniciar, operações interrompidas passam a incertas; o modelo operacional é um backend proprietário do SQLite/dispatch, não múltiplos workers concorrentes.

A interface conserva o ID da operação quando perde a resposta. Um resultado incerto continua exigindo conferência da conversa; não há promessa de exactly-once no provedor, que não fornece essa garantia. Logs contêm código fixo, operação, status e requestId; não corpos, nomes, JIDs ou credenciais.

Mídia é localizada por chave da mensagem e conversa, sem depender da página de offset em que a interface a viu. O estado local é conferido antes e depois da recuperação: exclusão ou indisponibilidade bloqueia também o endpoint de arquivo, não apenas sua apresentação na tela. Binários não são armazenados localmente por esta entrega.

## Dados, compatibilidade e preparação

Continua sendo o SQLite existente. São reutilizados `chat_instances`, `chat_events`, `chat_conversations` e `chat_messages`; não foi criada uma segunda fila de mensagens/eventos. Na projeção local as mensagens não ganham `link_id` de uma ficha por inferência. A leitura nova usa a associação canônica atual.

Metadados aditivos:

- Identidades/aliases já preparados na #200, agora no módulo próprio, com proveniência e handle canônico. Upgrade da versão anterior de quatro colunas conserva os pares.
- `coda_sync_context_conflicts` e `coda_sync_context_revisions`, sob o opt-in Coda existente. Um 409 por empate conserva o conflito sem criar o segundo Atendimento. Replay antigo não desbloqueia; uma confirmação autenticamente posterior resolve o contexto pela ordem causal e renova a revisão.
- `chat_message_state`, `chat_conversation_coverage`, `chat_send_operations`, somente sob o opt-in local. `content_available` distingue falta de conteúdo atualizado de exclusão. Nenhum dado legado é apagado, renumerado ou religado automaticamente.

IDs V20 existentes são compatíveis para resolver handles; no novo modo os controles manuais V20 e a rota legada de leitura temporal deixam de ser caminhos paralelos de operação. A atualização deve usar a aplicação/rotas canônicas. Não apagar as tabelas V20/legadas.

Eventos v2 guardam digest, recibo e metadados técnicos no inbox; texto atual fica na projeção, evitando cópias de conteúdo desnecessárias no ledger. Guardar um evento não significa que uma mensagem foi entregue/lida no WhatsApp.

Flags novas, inicialmente desligadas:

```
FUNIX_CHAT_LOCAL_ENABLED=true
FUNIX_CHAT_LOCAL_READ_ENABLED=false
```

Pré-requisitos existentes: Coda sync configurado, leitura Evolution configurada e instância correta. Para receber eventos, habilitação/configuração HMAC do ingest existente (`FUNIX_WHATSAPP_INGEST_ENABLED`, `FUNIX_WHATSAPP_INGEST_CONFIG_FILE`) com arquivo privado e allowlist da instância. Não versionar secrets nem valores de configuração instalada. Não ligar envio/mídia como efeito desta ativação; suas flags continuam independentes.

O modo de observação registra eventos e páginas lidas, mas mantém a Evolution como fonte de apresentação. `FUNIX_CHAT_LOCAL_READ_ENABLED=true` seleciona a fonte local depois da validação de correspondência. Não misturar silenciosamente listas das duas fontes.

## Publicação do relay n8n e recuperação

A ligação do produtor ainda é uma operação de implantação; o workflow publicado não foi alterado nesta tarefa.

Ao preparar a alteração autorizada, ler a versão publicada mais recente e alterar somente a entrega dos eventos de Chat. Preservar classificação, preferências, criação/reuso Coda e demais automações. A entrega de Chat precisa observar também saídas do celular e os eventos de atualização; não ficar dentro do filtro de entradas elegíveis para gerar lead.

O produtor deve manter eventos não confirmados em execução/fila durável até receber recibo correspondente. Conferir a política real de retenção/retry do n8n; não considerar um ramo com erro ignorado e execução descartada como entrega confiável. A indisponibilidade do Chat não pode interromper o processamento comercial existente. Não criar um segundo webhook/sessão WhatsApp nem outro banco para fazer esse transporte.

`deliverConversationEvent` fornece o contrato de entrega/validação do recibo; não é um timer ativado nem uma promessa de que o produtor já está conectado. As repetições dessa entrega são de **eventos**, não de envios WhatsApp.

Ferramenta de recuperação isolada:

```
node scripts/chat-relay-replay.ts --input=<arquivo-local-do-evento-original>
```

Padrão: dry-run, sem rede e sem gravação. Aceita evento v2 ou webhook reconhecido (este requer ID técnico de instância configurado). Imprime somente tipo, eventId e digest. O arquivo de origem deve ficar protegido fora do Git; não exportar conteúdo privado desnecessário.

`--apply` exige origem explícita do FunixApp, configuração HMAC privada existente e `FUNIX_CHAT_RELAY_KEY_ID`. Envia somente a rota de ingest do Chat, com limite/timeout e sem redirects; nunca reexecuta workflow comercial nem chama envio WhatsApp. Uso em dados instalados exige autorização específica. Não foi executado em produção.

Para confirmações comerciais faltantes como Drico, manter o procedimento do relatório inicial: conferir a execução original, decisão exata/ID Coda e recibos locais; reutilizar source/decision ledger/outbox existentes e reaplicar somente a confirmação verificada. Não construir vínculo a partir de um telefone nem fabricar o horário da decisão. A recuperação de mensagens não substitui essa confirmação nem cria Atendimento.

## Verificação e implantação controlada

Resultados finais estão em `docs/evidencias/chat-identity/mvp-validation.json`. Cobertura inclui:

- Defeitos reproduzidos antes das correções: rota genérica contornando quarentena e 409 descartando a contradição.
- PN/LID, nome apenas como apresentação, aliases conflitantes, evento posterior à lista e múltiplos Atendimentos.
- Recebimento pendente sem criar ficha, retry com resposta perdida, falha de COMMIT sem ACK/efeito parcial.
- Original/edição/exclusão/status atrasados, corpo indisponível e reparo de edição perdida pelo provedor.
- Reabertura de arquivo SQLite, handles antes/depois do alias, migração aditiva, revisão A→B→A.
- Cursores com horários iguais/inserção concorrente; texto e mídia idempotentes, resultado incerto e recuperação de processo interrompido.
- Replay CLI sem rede por padrão; nenhuma mensagem WhatsApp real enviada.
- Chromium com API real e SQLite temporário, Evolution simulada indisponível, em 320/390/1440 px: 125 mensagens locais, cursor, resposta de envio perdida, recibo reutilizado e limpeza do Chat após confirmação ERP diferente. Regressões das telas anteriores também executadas.

Após autorização de implantação:

1. Identificar imagem/SHA instalado e fazer backup consistente do SQLite; confirmar um único processo de dispatch. Rever as flags existentes sem imprimir secrets.
2. Publicar código com leitura operacional ainda em Evolution e armazenamento local habilitado. Preparar/publicar somente o relay aprovado, validando assinatura/allowlist e retenção dos eventos não confirmados.
3. Confirmar entrada e saída, recibo após COMMIT, estados pendentes e associação posterior; comparar mensagens e contagens em conversas conhecidas. Verificar também edições, exclusões e status na versão instalada. Sem envio real de teste sem autorização específica.
4. Habilitar leitura local após a equivalência observada. Validar A/B/C no celular, paginação, reinício e erro transitório. Carregar histórico antigo somente conforme necessidade; manter indicação de cobertura desconhecida.
5. Reversão preferencial: desligar somente a seleção de leitura local, mantendo recepção e registros de envio. Não executar DROP, reset ou restaurar backup antigo por cima de eventos novos. Downgrade de imagem exige avaliar compatibilidade do receptor e suspender envio incerto; não voltar silenciosamente aos bloqueios em memória da #181.

Prontidão de código e testes não equivale à comprovação de todos os eventos na instância instalada. A ativação do produtor e a homologação operacional são deliberadamente separadas da execução de desenvolvimento para respeitar a autorização de produção.
