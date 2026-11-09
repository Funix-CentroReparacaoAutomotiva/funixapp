# FUNIX — Atualizações: pacotes com decisão humana (primeiro incremento)

**Status:** implementação de desenvolvimento na PR #107, sem merge/deploy. Ainda não é uma rotina operacional ativa. O segundo incremento adiciona entrada assinada e coleta de complementações, porém não executa alterações externas.

## Experiência aprovada pela direção

A nova aba `/atualizacoes` fica junto a Conversas, Funil e Configurações. Mostra somente cards: busca por experiência, placa e origem; filtros **Abertos** e **Fechados**. O toque expande ações, evidências resumidas, pendências e decisão do pacote.

- Abertos: aguardando revisão, aprovado aguardando execução, falha/retomada pendente.
- Fechados: executado (verde), rejeitado (vermelho).
- Aprovação é por **pacote**, não por documento individual.
- Informação obrigatória pendente bloqueia a aprovação. A interface de complementação ainda será implementada.
- A aprovação não confirma execução. Um executor validado deverá aplicar cada ação e registrar os respectivos resultados idempotentes.

## Modelo de dados

- `update_packages`: UUID, revisão, SHA-256 de snapshot, origem e referência, experiência/placa, título/resumo, ações e campos pendentes serializados, estado e histórico temporal.
- `update_package_decisions`: chave idempotente por pacote/solicitação, ação, versão/hash autorizados, autor e data.
- Ações possuem IDs e tipos; não carregam SQL livre nem instruções diretamente executáveis.
- O snapshot do pacote fica imutável depois da criação; uma proposta modificada deverá gerar **novo pacote** e exigir nova decisão.
- `approved_pending_execution` continua em Abertos até confirmação efetiva; `execution_failed` continua aberto.
- Recusa fecha o pacote. Aprovação é bloqueada em presença de pendências.

## API

| Método | Rota | Comportamento |
| --- | --- | --- |
| GET | `/api/atualizacoes?visao=open\|closed&q=...` | Lista autenticada; vazia quando o armazenamento não existe |
| POST | `/api/atualizacoes/:uuid/decisao` | Aprovar/rejeitar com `revision`, `snapshotHash`, `decision`, `requestId`; exige sessão, Origin e flag específica |

O armazenamento é opt-in por `FUNIX_UPDATES_STORAGE_ENABLED=true` e usa tabelas isoladas, **sem alterar o histórico `schema_migrations` V14**. As decisões HTTP exigem também `FUNIX_UPDATES_DECISIONS_ENABLED=true`. As flags permanecem não configuradas por padrão, de modo que nenhum registro novo é criado e nenhuma decisão está disponível.

## Segurança e próximo desenvolvimento

- Não há API externa de criação de pacote nem gatilho automático n8n neste incremento.
- Não há chamadas de escrita ao Coda, Drive, Evolution ou ERP pela tela.
- Usar a senha/sessão atual do operador, controle de versão e idempotência. Antes de habilitar escrita em produção: confirmar política de autenticação/autorização, persistência, backup e auditoria.
- A entrada `POST /api/integrations/updates/packages` aceita propostas estruturadas do backend/n8n com assinatura HMAC-SHA256, janela de 5 minutos, limite de 64 KB e identidade `eventKey` idempotente. Ela permanece **desligada** salvo `FUNIX_UPDATES_STORAGE_ENABLED=true`, `FUNIX_UPDATES_INGEST_ENABLED=true` e segredo `FUNIX_UPDATES_INGEST_SECRET` de pelo menos 32 caracteres. O fluxo n8n ainda não chama a rota.
- Assinatura de cada requisição: headers `X-Funix-Updates-Timestamp` (Unix em milissegundos, 13 dígitos) e `X-Funix-Updates-Signature` (hex minúsculo HMAC-SHA256 sobre `timestamp + "." + corpo JSON exato`). Identificador `eventKey` permanece único: reentrega idêntica devolve o mesmo pacote; conteúdo divergente é conflito HTTP 409.
- Contrato JSON: `{ "eventKey": "gmail:message-001", "proposal": { "source": "gmail", "sourceReference": "message-001", "experienceId": null, "plate": "ABC1D23", "title": "...", "summary": "...", "actions": [{"id":"drive:1","type":"drive_archive","title":"...","detail":"..."}], "missingFields": [{"key":"experienceId","label":"Selecionar XP","hint":"...","options":[{"value":"XP1001","label":"XP1001"}]}] } }`. Os identificadores citados são **sintéticos**; não são exemplos para execução real.
- Na aba Atualizações, os campos faltantes podem ser preenchidos (texto ou seleção). `POST /api/atualizacoes/:uuid/complementar` exige login, Origin, versão/hash e `requestId`; registra respostas com auditoria e idempotência sem mudar a proposta. Essa API exige `FUNIX_UPDATES_CLARIFICATIONS_ENABLED=true` e armazenamento habilitado.
- **Ainda falta o replanejamento do pacote.** Depois que a resposta é enviada, o card exibe `Aguardando nova conferência`; o pacote original continua bloqueado, e o n8n/backend deverá validar os dados na fonte oficial e produzir uma nova proposta/versionamento, sem assumir que a resposta humana é uma evidência externa.
- Implementar executor de ações por item com recibos, confirmação externa e retomada de falhas parciais. Uma aprovação apenas registra `approved_pending_execution`. Esta etapa **não implementa nem habilita o executor**.
- Conflito provável com a PR #104 em `src/App.tsx` e `server/app.ts`: reconciliar antes do merge.
- Realizar QA visual mobile/desktop e CI com dados sintéticos. Sem autorizar merge/deploy automaticamente.
