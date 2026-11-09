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

## Incremento seguinte — revalidação e preparação local (09/11/2026)

- O contrato de ingestão aceita `replaces` opcional com `parentPackageId`, `clarificationRequestId`, `codaRowId`, `verifiedExperienceId`, `verifiedPlate`. O emissor autenticado precisa **conferir esses identificadores novamente no Coda** antes de emitir esse envelope; o servidor apenas valida a correspondência e a consistência interna, **não consulta o Coda autonomamente**.
- A API só aceita substituir pacote aberto com complementação auditada, experiência escolhida compatível e mesmas ações originais; registra pacote novo e encerra o antigo como `superseded`, transacionalmente. O pacote substituído permanece no histórico SQLite, mas não aparece em Abertos ou Fechados. A nova proposta exige nova aprovação.
- A substituição é idempotente por `eventKey`: reenvio idêntico retorna o mesmo pacote; alteração do conteúdo com a mesma chave retorna conflito.
- O workflow n8n existente (`33N020GyY0IsUSNv`) recebeu nó **Preparar rascunho de pacote (SEM ENVIO)**, que produz objeto `{eventKey,proposal}` para identificação ou dossiê documental, **sem chamadas HTTP**. Execução manual `37407`: XP1945 identificada e rascunho gerado, sem publicação e sem upload; seletores restaurados e workflow desativado.
- **Ainda não há um pacote único por evento multicanal.** As saídas independentes de identificação e documentos são rascunhos parciais e não devem ser publicadas separadamente. O próximo trabalho deve consolidar todas as propostas de um mesmo e-mail/WhatsApp em **um único pacote**, revalidar contra Coda e arquivos antes da proposta final e assegurar evidências imutáveis por ação.
- Nenhuma flag produtiva, autorização de escrita, credencial nova ou executor foi habilitado. A ligação real n8n → endpoint assinado e o replanejamento após complementação permanecem pendentes e exigem validação em desenvolvimento.

## Consolidação local de fragmentos (09/11/2026)

O módulo puro `server/update-packages-consolidate.ts` reúne propostas independentes de um **mesmo evento** em **um pacote**. O chamador declara explicitamente `expectedParts` (por exemplo, `identity`, `documents`, `commercial`) e precisa entregar todas as partes previstas. O módulo recusa partes incompletas/repetidas, origens ou referências distintas, conflito de XP ou placa, IDs de ações divergentes e definições incompatíveis de pendências. Ações rigorosamente idênticas podem ser deduplicadas. As dúvidas de identificação permanecem bloqueantes mesmo quando outra parte sugere uma XP.

Este incremento é **biblioteca de preparação, não integração ativa**: não foi conectado à API de ingestão, ao fluxo n8n, nem a fontes externas; não produz uploads, escritas no ERP, aprovações ou chamadas HTTP. O evento final só poderá ser publicado depois que um orquestrador confiável provar a completude real do e-mail/WhatsApp (incluindo corpo, anexos e informações comerciais) e fizer a revalidação pertinente. Declarar `expectedParts` incompleto para passar na verificação seria uma falha do orquestrador; por isso a preparação isolada **não autoriza habilitar as flags**.

Teste de regressão: `server/tests/update-packages-consolidate.test.ts`; executar a suíte e conferir CI antes de qualquer merge. A documentação e o código não representam liberação de produção.
