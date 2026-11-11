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
