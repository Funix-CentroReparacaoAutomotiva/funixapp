# FUNIX — Atualizações: pacotes com decisão humana (primeiro incremento)

**Status:** implementação de desenvolvimento na PR #107, sem merge/deploy. Ainda não é uma rotina operacional ativa.

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
- Implementar entrada de pacotes com identidade de evento idempotente e evidências; integração n8n via autenticação independente.
- Implementar resolução dos campos obrigatórios com validação no backend, replanejamento de snapshot e aprovação somente de versão revisada.
- Implementar executor de ações por item com recibos, confirmação externa e retomada de falhas parciais.
- Conflito provável com a PR #104 em `src/App.tsx` e `server/app.ts`: reconciliar antes do merge.
- Realizar QA visual mobile/desktop e CI com dados sintéticos. Sem autorizar merge/deploy automaticamente.
