# FUNIX — Gate de autorização para e-mails de veículos

Status: **implementação parcial em desenvolvimento (PR #149)**. Não há aprovação para ativar processamento automático, nem para alterar produção. Decisão funcional do gestor: **receber notificações e autorizar o início do processamento exclusivamente na aba Atualizações do FunixApp**.

## 1. Regra principal

- O Gmail Trigger de um minuto pode receber e registrar identificadores em `FUNIX_GMAIL_EVENT_LEDGER`. Isso é observação técnica, não o processamento do assunto.
- Antes de autorização humana, a automação só poderá ler o mínimo necessário para **avaliar relevância**, extrair pistas e montar um aviso resumido, sem executar ações documentais, comerciais, operacionais ou comunicações externas.
- Se o e-mail se relacionar explicitamente ou provavelmente com **serviço de veículo**, **lead**, **atendimento**, **cotação**, **orçamento**, **experiência**, **sinistro**, **autorização**, **andamento do reparo** ou interlocução sobre um caso, a interface deve exibir um **aviso de triagem pendente**.
- O vínculo com uma XP existente **não é requisito** para criar o aviso. Placa, XP e cliente são **pistas não verificadas** até consulta e confirmação segura.
- E-mails claramente alheios ao serviço automotivo — publicidade, folha de pagamento, ofertas comerciais, compras de equipamentos ou peças, comprovantes de e-commerce — não devem gerar avisos de triagem.
- Casos **incertos** devem ir para revisão do operador, não ser descartados silenciosamente. O objetivo é privilegiar a recuperação de casos relevantes; aferir falsos positivos antes de automatizar.
- A decisão `Autorizar processamento` permite exclusivamente **iniciar a triagem do e-mail especificado**. **Não** aprova orçamento, reparo, arquivamento, atualização de ERP ou Drive, resposta a cliente, desconto ou alteração de escopo. Essas ações exigem alçadas e validações próprias.
- `Não autorizar` impede qualquer processamento posterior do e-mail; a decisão deve ficar registrada, inclusive motivo opcional, ator, data, versão e identificador do evento. Respeitar idempotência em reentregas.

## 2. Separar dois tipos de card

### A. Aviso de e-mail — autorização para iniciar processamento

Campos propostos: `messageId`, `source=gmail`, assunto resumido e sanitizado, remetente quando necessário, tipo provável, resumo mínimo, pistas de placa/XP, confiança/ambiguidade, `receivedAt`, status, decisão do operador, `requestId`, `revision`, `snapshotHash`.

Estados de aviso (novos, **não** confundir com `UpdatePackageStatus`):
- `awaiting_intake_authorization` — visível em Atualizações, aguardando a primeira decisão.
- `intake_authorized` — autorizado a iniciar a triagem, sem autorização de efeitos externos.
- `intake_denied` — encerrado; sem triagem.
- `intake_processing` — triagem em andamento.
- `intake_review_ready` — resultado da triagem disponível para conferência.
- `intake_failed` — falha rastreável, passível de reprocessamento controlado.

### B. Pacote de alterações — autorização de execução

Continua a usar `UpdatePackage`, `UpdatePackageStatus` e as operações de aprovação/rejeição existentes, mas nunca deve nascer por consequência da chegada do e-mail sem o registro precedente de autorização de triagem.

**Não reutilizar** o atual botão `Aprovar pacote` como autorização de processamento: as semânticas, pré-condições e consequências são diferentes.

## 3. Arquitetura e fronteiras

Fluxo previsto:

`Gmail Trigger` → `ledger de IDs` → `classificador conservador (somente leitura)` → `aviso de triagem no FunixApp` → **decisão humana autenticada** → `fila de processamento autorizada` → `triagem Coda/Drive/Gmail` → `propostas posteriores para novas decisões`.

Restrições:
1. Separar a fila de avisos das propostas de alterações no backend e na interface.
2. O classificador deve produzir `relevant`, `uncertain` ou `irrelevant`, com código de motivo. `uncertain` também gera aviso.
3. A classificação deve aceitar assunto e corpo quando necessário; **não** assumir que o assunto contém XP ou placa.
4. O ledger deve preservar eventos e tentativas. Falhas e mensagens rejeitadas não podem desaparecer com filtros de `rowNotExists` de forma irreversível.
5. Garantir idempotência no servidor por `gmailMessageId`; reentregas simultâneas e conflitos precisam de testes de concorrência e transação.
6. Guardar identificadores e metadados mínimos; proteger acesso de operador; evitar conteúdo integral ou anexos em logs e execuções.
7. A autorização será exigida em API de operador autenticado, sessão same-origin e checagem de revisão/hash; requisições n8n assinadas não podem tomar decisões humanas.
8. Uma ação que não conste do escopo autorizado precisará de nova decisão apropriada, mesmo quando a triagem tiver sido autorizada.
9. Não usar o mero recebimento de e-mail para responder ao remetente, marcar mensagens como lidas ou movimentar arquivos.
10. Não acionar nenhum workflow de escrita já existente sem teste de isolamento e liberação específica.

## 4. Enquadramento das funcionalidades existentes

| Recurso atual | Estado / limite |
| --- | --- |
| `vlwnt13SHEKwOS2S` | Monitoramento Gmail a cada minuto, já ativado; grava identificadores na tabela. **Ainda não há classificação/revisão no FunixApp.** |
| `FUNIX_GMAIL_EVENT_LEDGER` | Registro criado e testado com dados sintéticos; `state=received` não significa processado ou autorizado. |
| `33N020GyY0IsUSNv` | Workflow documental principal inativo; a ramificação `PREVIEW` consegue criar pacote de alterações via HMAC, mas **não é a autorização de triagem**. |
| `/api/integrations/updates/packages` | Recepção assinada de propostas de alterações, não serve como endpoint de decisões humanas. |
| `src/UpdatesPage.tsx` | Exibe pacotes; botão `Aprovar pacote` se refere a alterações, não a triagem. |
| `FUNIX_UPDATES_DECISIONS_ENABLED=false` | Permanece desligado. Não o ativar para representar a nova decisão. |

## 5. Critérios de aceitação antes de ativar a cadeia

- [ ] Publicidade e folha de pagamento claramente não relacionadas não geram aviso.
- [ ] Lead sem XP, cotação, orçamento, autorização, complemento e conversa de veículo geram aviso, mesmo sem placa no assunto.
- [ ] E-mail ambíguo gera aviso de classificação incerta.
- [ ] Aviso aparece em Atualizações com `Autorizar processamento` e `Não autorizar`, separados de `Aprovar pacote`.
- [ ] `Não autorizar` não executa triagem nem ações externas, inclusive após replay/reinício.
- [ ] `Autorizar processamento` libera exatamente uma triagem, não a execução de alterações.
- [ ] Replays e execuções concorrentes não duplicam avisos/processamento.
- [ ] Falhas ficam visíveis e recuperáveis; não há perda silenciosa de e-mails.
- [ ] Testes autenticados/CSRF, autorização e rollback com flags OFF por padrão.
- [ ] Testes unitários e integração em desenvolvimento; revisão e CI sem merge/deploy.
- [ ] Liberação operacional posterior exige avaliação e autorização explícita.

## 6. Próximo incremento técnico

Implementar uma entidade `GmailIntakeNotice` (ou nome equivalente) e endpoint assinado de **aviso de triagem**, ambos OFF por padrão, seguido de lista de avisos e decisão autenticada para `intake_authorized/intake_denied`. Não alterar o fluxo de `UpdatePackage` para esse propósito. Integrar n8n somente após testes do gate.

Documentação de design não é prova de implantação.

## 7. Implementação parcial na PR #149

- Tipos separados em `shared/gmail-intake.ts`.
- Schema aditivo e isolado `server/gmail-intake-schema.ts`, criado somente com `FUNIX_GMAIL_INTAKE_STORAGE_ENABLED=true`.
- Endpoint HMAC `POST /api/integrations/gmail/intake-notices` (desligado por padrão, depende também de `FUNIX_GMAIL_INTAKE_INGEST_ENABLED=true` e segredo próprio `FUNIX_GMAIL_INTAKE_SECRET`).
- API autenticada de leitura `GET /api/atualizacoes/avisos-gmail?visao=open|closed` e decisão `POST /api/atualizacoes/avisos-gmail/:id/decisao`; botão habilitado somente com `FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED=true` e schema presente.
- UI `src/GmailIntakeNotices.tsx` dentro de Atualizações, distinta dos pacotes existentes.
- Decisões autenticadas e idempotentes apenas registram `authorized` ou `denied`; não despacham nenhum executor.
- A consulta do Gmail e o classificador conservador **não foram conectados ao novo endpoint**. O workflow existente segue registrando identificadores; classificação real, outbox e recuperação de falhas continuam pendentes.
- Nenhum ambiente deve configurar essas flags ou segredo em produção sem revisão de testes, autorização e plano de rollback.

### Segurança de operação

**Autorizar processamento de e-mail não aprova execução de alterações**. O despacho futuro deverá verificar a decisão persistida no FunixApp antes de iniciar a triagem. Ativar os botões de decisão antes de construir a etapa de despacho apenas registra decisões; não implementa o processo todo.

A confirmação de `HTTP 202` pelo endpoint do aviso significa somente que o aviso foi registrado; não comprova autorização ou processamento.

## 8. Classificador e adaptador manual desenvolvidos

- `server/gmail-intake-classifier.ts`: classifica candidato mínimo em `relevant`, `uncertain`, `irrelevant` por regras conservadoras; não consulta Coda nem toma decisão humana; XP e placa são pistas.
- `POST /api/integrations/gmail/intake-candidates`: entrada HMAC, **OFF por padrão** com as mesmas flags de storage/ingest e segredo do domínio Gmail; e-mails irrelevantes retornam `ignored` sem criar aviso; relevantes/incertos criam aviso idempotente.
- `server/tests/gmail-intake-classifier.test.ts` e testes do receptor: exemplos de publicidade, compras, folha, orçamento, cotação, sinistro, reparo, duplicidade e decisões negadas.
- n8n `O4pcoCtgFgHIm1K4` (FUNIX | Gmail → candidato de aviso): workflow **inativo**, somente leitura, acionamento manual, sem anexos e sem HTTP POST. Teste de dados sintéticos executado com sucesso (execução 38306).
- **Não conectar** o workflow de captura ativo a esse adaptador/endpoint nem habilitar as flags enquanto não houver implantação aprovada e fluxo confiável de recuperação/revisão dos e-mails.
- Avaliar qualidade do classificador com amostra supervisionada e monitorar falsos negativos; não se trata de classificação sem erros.

## 9. Outbox de homologação de tentativas (11/11/2026)

- Tabela independente: `FUNIX_DEV_GMAIL_OUTBOX_SIMULATION_OFF` (`UfBOPNDKGDXEAajj`), somente IDs **sintéticos**, estado, tentativas, próximo prazo, erro e recibo; **não é a fila de produção**.
- Workflow n8n `PeErjWWg0EWX8GIp` — **inativo**, disparo manual, sem Gmail, HTTP, HMAC ou alterações no FunixApp/ERP/Drive.
- Execução de homologação `38307` passou: `202/awaiting_authorization→delivered`, `202/ignored→ignored`, `503→retry` com backoff, `409→blocked`, quinto `503→blocked` por exaustão de tentativas. Mensagem entregue pré-existente não foi reenviada.
- Reexecução `38308` passou sem consumir os eventos finais ou a tentativa 503 ainda não vencida. **Esses testes só verificam sequenciamento**, não concorrência, reinício do host ou rede real.
- A fonte ativa `vlwnt13SHEKwOS2S` segue somente registrando IDs em `FUNIX_GMAIL_EVENT_LEDGER`. Consulta em 11/11/2026 confirmou 44 registros reais, todos `received` na amostra; não existe mudança automática de status para essa tabela neste incremento.

### Requisitos ainda pendentes antes da ativação da outbox real

1. Garantir reivindicação atômica (`claim`) por consumidor, com leasing e concorrência/reentrância; filtro `rowNotExists`/atualização condicional por estado não bastam para prova de exclusão mútua.
2. Definir o armazenamento transacional da tentativa e do recibo, evitando perda entre envio `202` e persistência do status. Repetições devem enviar **o mesmo candidato imutável** ou obter tratamento explícito do `409`.
3. Reprocessar `received` já existentes e mensagens que chegaram em janelas de falha; nenhuma mensagem pode ser perdida silenciosamente por já constar do ledger.
4. Fazer ensaio com serviço de teste e rede autorizada para `408/429/5xx`, expiração HMAC, timeout e resposta malformada, sem tocar em dados de produção.
5. Garantir que `202` com `ignored` ou recibo de aviso válido é sucesso; nunca marcar uma falha como entregue.
6. Não armazenar corpo/anexos na outbox; persistir apenas ID e metadados mínimos e buscar conteúdo novamente de modo controlado. Revisar limitação de exposição de snippets.
7. Separar classificação inicial (autorizada automaticamente) de triagem de documentos e atualizações (expressamente dependente da autorização humana no FunixApp).
8. Implantação da PR, flags e HMAC só mediante liberação específica; não ativar/despachar mensagens reais automaticamente com base nessa simulação.

## 10. API assinada para fila de entrega (desenvolvimento, flags OFF)

Novo backend em `server/gmail-intake-queue-endpoint.ts`, integrado condicionalmente a `server/app.ts`.

- `POST /api/integrations/gmail/queue/enqueue`: `{messageId}`; cria um ID apenas uma vez, sem conteúdo do e-mail.
- `POST /api/integrations/gmail/queue/claim`: `{limit,requestId}`; reivindica até 25 e-mails com lease de 120 segundos. `requestId` UUID é obrigatório e registrado transacionalmente: reenvio idêntico retorna o mesmo lote, mesmo após timeout da resposta, e divergência de limite recebe 409.
- `POST /api/integrations/gmail/queue/ack`: `{messageId,leaseToken,result,noticeId,errorCode}`, com `result=notified|ignored|retry|blocked`. Um resultado `notified` exige `noticeId` já existente e pertencente ao mesmo e-mail. Não registra nem substitui decisão humana.

Cada operação exige HMAC SHA-256 do timestamp e do corpo bruto em headers `x-funix-updates-timestamp` e `x-funix-updates-signature`, dentro da janela de 5 minutos e com limite de corpo de 16 KiB. **A chave é exclusiva da fila**: `FUNIX_GMAIL_QUEUE_SECRET` (mínimo 32 caracteres), distinta de `FUNIX_GMAIL_INTAKE_SECRET`. Nenhuma chave deve aparecer no código, no workflow, em pin data ou em documentação.

Todas as rotas são **OFF por padrão**. Exigem simultaneamente `FUNIX_GMAIL_INTAKE_STORAGE_ENABLED=true`, `FUNIX_GMAIL_QUEUE_STORAGE_ENABLED=true`, `FUNIX_GMAIL_QUEUE_API_ENABLED=true`, esquema presente e segredo próprio. As flags não foram ativadas em produção.

A persistência transacional da fila usa `gmail_intake_delivery_queue`, `gmail_intake_delivery_queue_attempts` e `gmail_intake_delivery_queue_claim_requests` (tabela de idempotência de reivindicações); não altera os registros do n8n nem a XP existente.

### Contrato futuro de consumidor n8n (ainda não conectado)

1. `enqueue` deve ser feito apenas com ID válido, após captura do Gmail, sem considerar o e-mail processado.
2. `claim` usa `requestId` gerado e **persistido para a mesma requisição** em caso de incerteza de rede; não usar novo `requestId` para repetir uma resposta cujo resultado ainda seja desconhecido.
3. Para cada lease, buscar e-mail por ID, preparar candidato mínimo e enviar pelo endpoint de classificação HMAC `/api/integrations/gmail/intake-candidates`; classificação como irrelevante retorna `ignored`, relevante/incerta retorna `noticeId` para a aba Atualizações.
4. Somente após receber resposta verificável o consumidor confirma `ack`, reutilizando o mesmo token na repetição. Falhas de rede e estados ambíguos exigem reconciliação com o servidor antes de decidir se repetem o envio; o receptor classificador já deve ser idempotente por `messageId`.
5. Respostas não-2xx: `408`, `429`, `5xx` e timeout são temporárias, sem confirmar sucesso; `400` e `409` exigem revisão ou bloqueio. Nunca registrar `notified` sem aviso correspondente.
6. A captura ativa n8n e a fila SQLite do FunixApp são armazenamentos separados: falta mecanismo para reprocessar registros `received`, sem exceção silenciosa, e sincronizar o estado de entrega. Não tratar o ledger do n8n como comprovante de autorização.
7. O despacho da triagem do assunto **não faz parte** da fila de entrega e somente poderá ocorrer após decisão autenticada do operador na aba Atualizações.

### Testes

Testes adicionados em `server/tests/gmail-intake-queue-endpoint.test.ts`: HMAC errado, timestamp expirado, flag OFF, payload inválido, duas requisições de claim com o mesmo `requestId`, reivindicação duplicada, recibo idempotente e recibo de aviso de outra mensagem. São testes sintéticos locais; nenhum envio Gmail/n8n real foi executado.

## 11. Reconciliação autenticada de entrega (incremento posterior)

Foi acrescentada a operação **`POST /api/integrations/gmail/queue/status`** com payload exato `{ "messageId": "..." }`, a mesma assinatura HMAC própria da fila e as mesmas flags OFF por padrão. Retorna `messageId`, `state`, `attempts` e `nextAttemptAt`; não faz claim, não confirma ACK, não classifica e não autoriza e-mail. Um ID ausente retorna 404, e payload inválido ou HMAC incorreto são rejeitados.

**Uso previsto:** após timeout ou perda de resposta de `enqueue`/`ack`, o consumidor poderá verificar o estado persistido antes de decidir repetir. Para `claim`, deve reutilizar o **mesmo `requestId`** para recuperar o lote original; um requestId diferente não é uma reconciliação segura. Um retorno `leased` não prova que o aviso foi criado; a confirmação `notified` exige o vínculo persistido entre aviso e mensagem. O estado resumido não substitui o recibo idempotente de ACK nem fornece o `leaseToken` perdido.

Testes sintéticos adicionados para estado inicial, lease, conclusão, consulta sem mutação, ID inexistente, assinatura inválida e payload extra. **Testes e CI ainda precisam ser confirmados na versão atual.** Sem habilitação do consumidor n8n, merge, deploy ou processamento de mensagens reais.

## 12. Gate para consumidor n8n de homologação

A conexão real exige um **FunixApp de homologação acessível** com banco isolado, endpoint habilitado exclusivamente naquele ambiente e duas chaves HMAC independentes (fila e candidato). Não usar o host de produção como substituto. Nenhum endereço, segredo ou credencial está presumido aqui.

Contrato de recuperação do consumidor, antes de conectar Gmail real:

1. **Enqueue:** persistir ID de origem; em resposta perdida consultar `/queue/status`, e repetir `enqueue` idempotentemente se necessário. Nunca tratar apenas o status `received` do ledger n8n como entrega.
2. **Claim:** gerar UUID e persistir `requestId` antes do HTTP. Em timeout repetir exatamente `{limit,requestId}` para obter o mesmo lote. Persistir cada `leaseToken` imediatamente antes de iniciar a busca do e-mail. Não criar novo `requestId` durante reconciliação.
3. **Classificação:** buscar mensagem com anexos desabilitados; enviar somente campos mínimos ao intake-candidates autenticado; validar `ignored` ou um `noticeId` bem formado. Não abrir documentos nem iniciar triagem posterior.
4. **ACK:** enviar todos os campos obrigatórios, incluindo `noticeId:null`/`errorCode:null` quando aplicável. Se a resposta for perdida, consultar `/queue/status` e repetir o mesmo ACK para obter o recibo idempotente, sem construir um ACK diferente. Erros definitivos vão para investigação.
5. **Lease expirado:** não afirmar sucesso por inferência. Reconciliar aviso e estado; permitir que o backend controle nova tentativa. Não descartar mensagem `received` do ledger n8n sem reconciliação.
6. **Segurança:** segredos em credenciais/ambiente restrito, nunca em Code nodes, pin data, JSON de exportação ou logs; HTTPS autenticado e mascaramento de assunto, corpo, remetente e headers. Usar credenciais separadas das existentes em produção.

Matriz de ensaio obrigatória: falha antes/depois de `enqueue`, perda da resposta `claim`, interrupção com lease aberto, timeout após candidato aceito, ACK duplicado, `409`, `408/429/5xx`, requisição assinada inválida, worker concorrente, reinício e reprocessamento de pendentes. Registrar evidência de mensagens sintéticas antes de usar qualquer caso real. **Workflow de homologação não deve ser publicado ou agendado automaticamente.**
