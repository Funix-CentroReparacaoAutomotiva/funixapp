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

A direção definiu em 12/11/2026 que **a instância atual do FunixApp é o ambiente de homologação**, sem exigência de outra implantação. Essa decisão substitui a exigência anterior de um host separado; não dispensa controles de dados, autenticação e rollback. A configuração versionada em `compose.yaml` utiliza domínio público e banco SQLite persistente (`/data/funix.sqlite`), então os testes precisam usar identificadores sintéticos, não afetar registros existentes e preservar os fluxos n8n ativos. Antes de qualquer comunicação n8n → FunixApp, confirmar a revisão realmente implantada e disponibilizar, por autorização de deploy distinta, os endpoints da PR e chaves HMAC exclusivas, mantendo as flags OFF até habilitação controlada. O endereço não prova sozinho a revisão em execução.

Contrato de recuperação do consumidor, antes de conectar Gmail real:

1. **Enqueue:** persistir ID de origem; em resposta perdida consultar `/queue/status`, e repetir `enqueue` idempotentemente se necessário. Nunca tratar apenas o status `received` do ledger n8n como entrega.
2. **Claim:** gerar UUID e persistir `requestId` antes do HTTP. Em timeout repetir exatamente `{limit,requestId}` para obter o mesmo lote. Persistir cada `leaseToken` imediatamente antes de iniciar a busca do e-mail. Não criar novo `requestId` durante reconciliação.
3. **Classificação:** buscar mensagem com anexos desabilitados; enviar somente campos mínimos ao intake-candidates autenticado; validar `ignored` ou um `noticeId` bem formado. Não abrir documentos nem iniciar triagem posterior.
4. **ACK:** enviar todos os campos obrigatórios, incluindo `noticeId:null`/`errorCode:null` quando aplicável. Se a resposta for perdida, consultar `/queue/status` e repetir o mesmo ACK para obter o recibo idempotente, sem construir um ACK diferente. Erros definitivos vão para investigação.
5. **Lease expirado:** não afirmar sucesso por inferência. Reconciliar aviso e estado; permitir que o backend controle nova tentativa. Não descartar mensagem `received` do ledger n8n sem reconciliação.
6. **Segurança:** segredos em credenciais/ambiente restrito, nunca em Code nodes, pin data, JSON de exportação ou logs; HTTPS autenticado e mascaramento de assunto, corpo, remetente e headers. Usar credenciais separadas das existentes em produção.

Matriz de ensaio obrigatória: falha antes/depois de `enqueue`, perda da resposta `claim`, interrupção com lease aberto, timeout após candidato aceito, ACK duplicado, `409`, `408/429/5xx`, requisição assinada inválida, worker concorrente, reinício e reprocessamento de pendentes. Registrar evidência de mensagens sintéticas antes de usar qualquer caso real. **Workflow de homologação não deve ser publicado ou agendado automaticamente.**

## 13. Ensaio independente n8n do contrato (12/11/2026)

Foi criado no projeto pessoal administrativo n8n o workflow `FUNIX | DEV | Gmail queue contract — offline manual (OFF)`, ID `Hdld57vlbjOGcqjR`, que permanece **inativo** e só possui disparo manual + dois nós Code sem integrações externas. A execução manual `38642` encerrou com `success`, conferindo **quatro casos sintéticos** (`enqueue`, `claim`, `ack`, `lost-claim-response`) e devolvendo `{mode:'SYNTHETIC_OFFLINE',networkCalls:0,gmailReads:0,sideEffects:0,passed:true}`.

Este ensaio confirma unicamente que o n8n executa as validações locais dos objetos de contrato. **Não é consumidor real**: não autentica, não se comunica com os endpoints, não consulta Gmail, não executa HTTP, não armazena requests e não testa falhas de rede ou concorrência. Para chegar ao merge ainda é necessário concluir a implementação do consumidor real e ensaios de integração controlados na instância atual de homologação, com chaves próprias e dados sintéticos protegidos, incluindo persistência do `requestId` e reconciliação das respostas ambíguas. Nenhuma implantação ou ativação decorre automaticamente dessa decisão. O workflow atual não deve ser conectado à captura ativa.

## 14. Ensaio HTTP integrado local (12/11/2026)

Foi adicionado `server/tests/gmail-intake-queue-network.test.ts` para executar um servidor HTTP de loopback com as implementações reais das rotas assinadas `/queue/enqueue`, `/queue/claim`, `/queue/ack`, `/queue/status` e `/intake-candidates`, usando SQLite em memória e segredos sintéticos independentes. Testa duas mensagens artificiais (solicitação de orçamento e newsletter), repetição de enqueue/claim/ingest/ack, classificação `ignored`, vínculo de aviso relevante, status final, rejeição de credencial trocada e **zero decisões humanas**. Esse teste é incluído pelo comando `npm run test:server`.

Limite de evidência: essa suíte valida serviços e assinatura em uma única máquina/execução, **não** valida comunicação entre n8n e FunixApp em hosts separados, credenciais reais, ledger n8n ou recuperação de uma falha de rede verdadeira. A PR continua draft e o consumidor n8n real não foi conectado. O CI da versão que introduziu o teste deve ser conferido antes de classificá-lo como aprovado.

## 15. CI e isolamento de credenciais (12/11/2026)

O commit `e5b6156` concluiu as oito verificações do GitHub Actions com sucesso, incluindo o CI principal. Foi iniciado um protótipo manual de preparação de payload no n8n (`x0rbN62iosP2DqNb`), mas a plataforma associou automaticamente uma **credencial HMAC já existente** ao nó criptográfico, em vez de criar uma chave exclusiva de homologação. Por segurança, o nó de assinatura foi removido antes de qualquer execução e foi conferido que o workflow remanescente possui **somente trigger manual e montagem de payload sintético, sem credenciais ou saída HTTP**, e segue inativo.

**Restrição explícita:** nenhuma credencial HMAC de Atualizações, WhatsApp, VPS ou de outros domínios deve ser reaproveitada na fila Gmail. O consumidor real depende de configuração de credencial própria, endpoints da PR efetivamente disponíveis na instância atual de homologação, garantia de assinatura sobre os mesmos bytes do corpo HTTP e persistência durável de `requestId`/recibos. O fluxo `x0rbN62iosP2DqNb` não é um consumidor conectado e não deve ser tratado como tal.

## 16. Diário durável sintético no n8n (12/11/2026)

Criada a Data Table **`FUNIX_DEV_GMAIL_CLAIM_JOURNAL_OFF`** (`TlCcJn9x8WbvqkKp`) no projeto pessoal administrativo, separada do ledger ativo e da antiga simulação de outbox. Criado o workflow **`FUNIX | DEV | Gmail claim journal idempotente (MANUAL OFF)`** (`EYesCdeSIHrX7cVY`), sem credenciais nem HTTP, com disparo manual, preparação de identificadores sintéticos, upsert por `case_key`, releitura e verificação de um `requestId` fixo. Os avisos de referências de expressões foram corrigidos antes da execução.

Execuções manuais **38644 e 38645** retornaram `success`, `passed=true`, `records=1`, `requestIdStable=true`, `networkCalls=0`, `gmailReads=0`. A releitura da tabela após a segunda execução confirmou **uma única linha** (id 1) com mesmo `request_id`, `phase=prepared` e `claim_limit=1`. A tabela e o workflow estão restritos à homologação sintética; o workflow permanece inativo.

**Limitação decisiva:** `upsert` por chave de caso e `requestId` fixo são apenas demonstração de persistência e repetição sequencial. NÃO constituem controle atômico de concorrência, armazenamento de token/resposta de claim após envio, nem recuperação segura de requisição em voo. Um consumidor real precisa gerar UUID novo para cada requisição inédita, persistir o UUID antes do envio, não substituí-lo durante replay, registrar `leaseToken`/recibo após resposta e prevenir reescritas de estados finais/leased em corridas. Não conectar esse ensaio ao Gmail ativo, não adicionar agendamento ou chave de outra integração. Continua pendente verificar/autorizar a disponibilidade dos endpoints da PR no FunixApp atual, configurar chaves HMAC exclusivas e validar a comunicação n8n ↔ FunixApp sem atingir mensagens ou registros reais.


## 17. Definição de ambiente pela direção — 12/11/2026

**Decisão expressa do gestor:** "O sistema do FunixApp atual já é o de homologação." Não exigir novo servidor, domínio ou banco separado como pré-condição arquitetural para a PR #149. Essa classificação é uma decisão de uso do ambiente, não a comprovação de isolamento técnico.

**Fatos verificados no repositório:** `compose.yaml` define `NODE_ENV: production`, `FUNIX_APP_ORIGIN: https://app.funix.com.br` e o SQLite persistente `/data/funix.sqlite`. `server/index.ts` só cria a estrutura Gmail quando as respectivas flags estão `true`; a PR #149 está em draft e não foi implantada por este trabalho. Não há verificação de qual revisão está realmente em execução em `app.funix.com.br`, nem do conteúdo atual do banco.

**Plano ajustado:** preparar e testar o consumidor n8n desligado, sem tocar no monitor Gmail ativo; preservar HMAC exclusivo da fila e do classificador; validar primeiramente com IDs e avisos sintéticos reversíveis e controles de rollback na instância atual, **somente depois de autorização explícita da implantação necessária**. Sem merge, deploy, nova flag, Gmail real, escrita em ERP/Drive ou decisão automática como consequência desta atualização documental. A comunicação real depende de os endpoints da PR existirem na revisão implantada; o nome "homologação" não os disponibiliza por si só.

**Critérios para o teste integrado:** revisão e flags conferidas, backup/rollback definidos, credenciais segregadas, origem n8n controlada, casos sintéticos sem colisão, validação de replays/concorrência, nenhum envio externo e retorno das flags ao estado desligado. Bloquear avanço se houver risco de afetar registros operacionais existentes.

## 18. Compatibilidade do transporte n8n — desenvolvimento na instância atual

O receptor HMAC passou a aceitar `Content-Type: application/json` e `application/json; charset=utf-8` (sem aceitar outros tipos de corpo). A alteração **não** altera a verificação da assinatura: continua exigido HMAC-SHA256 sobre `timestamp + "." + bytes originais do JSON`, com tolerância máxima de cinco minutos, tamanho máximo de 16 KiB e segredo de ao menos 32 caracteres. Foram adicionados testes de cabeçalho UTF-8, conteúdo inválido e assinatura falsa.

O `.env.example` agora relaciona explicitamente as cinco flags Gmail, todas `false`, e `FUNIX_GMAIL_QUEUE_SECRET` e `FUNIX_GMAIL_INTAKE_SECRET` vazias e independentes. Isso é **documentação de preparação**: não ativa recursos no FunixApp atual nem cria credenciais no n8n. Para evitar incompatibilidade, o consumidor deve assinar os **mesmos bytes** transmitidos no corpo, sem serializar novamente após o HMAC, e usar o timestamp em milissegundos como string de 13 dígitos.

**Gate preservado:** a instância atual do FunixApp é homologação por decisão da direção, mas o código da PR ainda não foi implantado nela. Somente preparar e validar workflows desligados até disponibilização autorizada dos novos endpoints e das credenciais exclusivas. Nenhum workflow existente de captura Gmail deve ser modificado.

## 19. Verificação real da conectividade n8n → FunixApp (12/11/2026)

Foi criado no projeto pessoal administrativo n8n o workflow manual **`FUNIX | DEV | FunixApp readiness (MANUAL OFF)`** (`3egfARhnRUlA5yk5`), inativo, sem credencial e com uma única requisição HTTPS GET a `https://app.funix.com.br/api/ready`. Execução manual **38646** concluiu com sucesso: **HTTP 200**, `status=ready`, `source=app`, `storage=sqlite`, `revision=7ace8292da430aceb4a316bbd561fabd74217557`. Não houve POST, leitura Gmail ou escrita na aplicação.

**Fato decisivo:** a revisão implantada observada no endpoint de readiness **não é** a revisão da branch da PR #149 (`31e5c42` na verificação anterior). Assim, não afirmar disponibilidade dos endpoints Gmail novos na aplicação implantada; a própria resposta de readiness não comprova existência deles. O domínio é alcançável do n8n, mas não se deve testar POST assinado antes de haver credenciais exclusivas e publicação autorizada do código.

Consulta ao catálogo de credenciais n8n não encontrou uma credencial crypto exclusiva da fila Gmail. As credenciais HMAC existentes correspondem a outras integrações; **não reutilizar nenhuma delas**. O conector disponível oferece consulta de credenciais, mas não criação ou preenchimento seguro de novo segredo. A configuração de `FUNIX_GMAIL_QUEUE_SECRET` no runtime backend e de uma credencial crypto Gmail exclusiva no n8n continua pendente. Também haverá chave própria para `FUNIX_GMAIL_INTAKE_SECRET`.

**Critério de avanço:** manter PR draft, não efetuar deploy/merge nem habilitar flags nesta etapa; preparar os contratos, testes e workflow inativo sem chaves sensíveis. A primeira comunicação assinada só deverá ocorrer depois da revisão implantada verificada, de configuração segregada de HMAC e do controle de mudanças autorizado. O GET de readiness não é autorização para POST nem prova do fluxo de e-mails.

## 20. Credenciais HMAC independentes verificadas no n8n (12/11/2026)

A direção informou ter configurado `FUNIX_GMAIL_QUEUE_SECRET` e `FUNIX_GMAIL_INTAKE_SECRET` no arquivo privado `/etc/funix/runtime.env` da VPS; esse preenchimento foi reportado pela direção, **não** foi lido ou conferido diretamente no servidor. A consulta ao n8n confirmou a existência de duas credenciais crypto independentes, chamadas `FUNIX | Gmail Queue | HMAC` e `FUNIX | Gmail Intake | HMAC`.

O workflow manual `x0rbN62iosP2DqNb`, agora denominado `FUNIX | DEV | Gmail HMAC Queue e Intake (MANUAL OFF)`, foi atualizado com dois nós Crypto vinculados explicitamente às respectivas credenciais, sem reutilização de credenciais de Atualizações/VPS. A execução **38952** concluiu em `success`; o verificador retornou `passed=true`, `queueHmacValid=true`, `intakeHmacValid=true`, `keysDistinct=true`, `networkCalls=0`, `gmailReads=0`. Nenhuma assinatura ou chave foi exibida pelo verificador.

**Escopo do teste:** comprova a geração de dois HMACs distintos a partir das credenciais do n8n e payload fictício; **não comprova** que essas chaves correspondam aos valores salvos na VPS, nem a aceitação de assinatura pelo backend atual. A revisão implantada anteriormente verificada foi `7ace8292da430aceb4a316bbd561fabd74217557`, anterior à PR. O workflow permanece manual e inativo. Não houve merge, deploy, ativação de flags, leitura Gmail ou comunicação HTTP neste ensaio.

**Próximo critério:** disponibilização autorizada da versão que contém os endpoints da PR #149; comparar assinaturas ponta a ponta usando dados sintéticos, sem expor os segredos, e somente então preparar o consumidor persistente. Manter controles de rollback e a captura Gmail atual separada.

## 21. Pré-teste HMAC contra a VPS sem implantar a PR

A execução manual n8n **38953** consultou `GET https://app.funix.com.br/api/ready`: HTTP 200, `status=ready`, `revision=dff46da9ca40cdc53e779df29c7a95ab563d85eb`. Consultando essa revisão no GitHub, `server/app.ts` não contém as rotas Gmail e os módulos `server/gmail-intake-queue-endpoint.ts`/`server/gmail-intake-ingest.ts` não existem. **Não realizar POST à fila nem declarar teste ponta a ponta aprovado nessa revisão**.

Alternativa de prova criptográfica sem implantação: comparar localmente na VPS os HMAC-SHA256 da mesma string sintética já assinada pelo n8n na execução **38952**, usando os valores salvos no arquivo privado `/etc/funix/runtime.env`; imprimir apenas `OK/DIVERGENTE`, sem expor chaves ou hashes em logs. Este procedimento verifica se n8n e VPS compartilham os mesmos segredos, **não** verifica roteamento/flags nem substitui a integração real. Usar desafio sintético não reutilizável como requisição, jamais mover credenciais para Git ou chat. A comparação na VPS depende de execução do operador e seu resultado não é conhecido até que ele a confirme.

## 22. Preflight assinado n8n controlado (12/11/2026)

A direção confirmou por execução local na VPS que as duas comparações HMAC n8n↔`/etc/funix/runtime.env` retornaram `OK`. Trata-se de confirmação relatada pelo operador; não foi necessário revelar os segredos.

Criado workflow manual inativo n8n `FUNIX | DEV | Gmail HMAC status preflight (MANUAL OFF)` (`MQOm97nNiyXiUvlj`). Seu grafo consulta `GET /api/ready` no FunixApp atual, prepara um `messageId` fictício e o corpo JSON bruto, assina `timestamp + "." + rawBody` com a credencial **Gmail Queue** e utiliza um gate explícito **OFF** para impedir `POST /api/integrations/gmail/queue/status`. O ramo POST está configurado mas inacessível na execução atual; não há acesso Gmail nem escrita.

Execução **38956**: `success`, `passed=true`, `mode=HMAC_QUEUE_PREFLIGHT_OFF`, `signatureFormatValid=true`, `postRequests=0`, `gmailReads=0`, `dataMutations=0`, `networkGetRequests=1`. A revisão reportada pelo readiness é `dff46da9ca40cdc53e779df29c7a95ab563d85eb`, anterior à PR e sem endpoints Gmail. Isso prova somente a preparação do transporte, **não** valida uma requisição assinada contra o backend.

**Bloqueio para teste com um e-mail real:** requer autorização específica para implantação da versão compatível com a PR #149, uma estratégia segura de disponibilização sem impactar dados existentes, confirmação pós-deploy da revisão/flags, envio manual de um único e-mail de teste identificado e ativação controlada de um consumidor realmente implementado e revisado. A PR segue draft. Não habilitar fluxos de captura/classificação global como atalho; o monitor Gmail atual permanece separado.
