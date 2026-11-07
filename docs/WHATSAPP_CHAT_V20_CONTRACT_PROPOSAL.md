# FUNIX — Contrato técnico proposto do Chat V20 (Issue #71)

**Estado:** PROPOSTA PARA REVISÃO, não política aprovada, não implementação nem autorização de deploy. Preparado em 07/11/2026 após validação restrita da Evolution em produção (Issue #76). Fonte funcional: protótipo `FUNIX_V20_Menu_Compacto_Kanban.html`, seção V14; código de referência: `server/chat/{schema,repository,read}.ts`, `server/app.ts`, `server/experimental/evolution-read/{client,context}.ts`, `shared/chat.ts`. Requisitos institucionais: `00_master_index.md`, `06_legal_and_policy.md`, `07_digital.md`, `09_decision_framework.md`, `10_strategy.md` (versão conceitual v0.3.1 ainda não registrada como aprovada em `FUNIX_REGISTROS_VIVOS.md`).

## 1. Decisão a preparar

Separar *conversa WhatsApp* (linha do tempo de uma instância + identidade de chat) de *Atendimento* (demanda comercial/operacional) e da *seleção de contexto* do operador. Priorizar leitura direta da Evolution existente **como candidata**, com backend fazendo autorização e normalização, sem nova VM/cache integral/índices por antecipação.

O protótipo usa `demoLinks` como associação N:N e `demoActiveByChat` como seleção. O `ChatRepository.link()` atual encerra o único vínculo ativo anterior de uma conversa (`chat_active_link`), atribui `chat_messages.link_id` por período, e `messages(atendimentoId)` lê por Atendimento. **Os contratos não são equivalentes**. O desenho V20 não autoriza reinterpretar, apagar ou migrar essa história local silenciosamente.

## 2. Evidências e limites

| Constatação | Classe | Limitação |
|---|---|---|
| PostgreSQL produtivo 15.19, tabelas `Chat`, `Message`, `MessageUpdate` e 9 índices | Verificado via saída de terminal autorizado na Issue #76 | Índices reais não provam desempenho |
| `Message` apenas PK(id) e índice(instanceId); aprox. 25.843 linhas estimadas/39 MB total | Verificado via catálogo/estatística, **estimativa** | Sem índice específico JID JSONB/timestamp não prova gargalo |
| `EXPLAIN` sintético prevê index scan por instância + filtro JSONB + sort | Verificado na instalação, **sem ANALYZE** | Instância fictícia; plano não representa custo real |
| `POST /chat/findMessages/funix_comercial` JID sintético, status 200 e 200 ms em uma chamada | Verificado via saída fornecida pela direção | Não é benchmark ou SLA |
| Segunda chamada sintética: JSON no formato esperado, page=1, total=0, records=0 | Verificado via saída fornecida pela direção | Não demonstra filtros sobre dados reais nem cobertura histórica |
| Contador/paginação separados, `page` e `offset` (offset=tamanho), ordenação por timestamp sem desempate estável | Verificado no código público Evolution 2.3.7 e POC sintética #73 | Pode duplicar/omitir sob mutação, sem snapshot |
| O usuário do FunixApp usa sessão por senha compartilhada/sem papéis individuais formalizados no `server/app.ts` | Código da aplicação | Sessão autenticada NÃO basta para conceder acesso a todo histórico |
| `capabilities.messages=false`, ingest HMAC inativo por padrão, endpoint legado GET por Atendimento | Código da aplicação | Não ativar nem mudar por documentação |

Nenhum teste com conteúdo real foi aprovado ou executado. Não se comprovou captura de mensagens do celular, retenção histórica, mídia, disponibilidade, recuperação, consistência de paginação nem taxa de consultas sob uso real.

## 3. Semântica do domínio

- `Conversation`: identidade técnica estável dentro da **instância**, usando `remoteJid` como identificador opaco. `@lid` não é número telefônico. Alias PN↔LID só com evidência de equivalência; conflito exige intervenção. Um contato, um telefone ou uma pessoa não são sinônimos de conversa.
- `Attendance`: Atendimento comercial/operacional existente, ID local próprio. Pode não ter Chat; Chat pode não ter Atendimento.
- `ConversationAttendanceLink`: associação explícita N:N, sem exclusividade artificial, sem criação automática por número/nome/placa. Contém ID próprio, IDs envolvidos, ator autorizado, instante, revisão, motivo e, quando removido, data/ator/motivo de desvínculo. Remover a associação **não apaga mensagens**.
- `ActiveAttendanceContext`: preferência de navegação de um operador/sessão para uma conversa, opcional, deve pertencer aos vínculos atualmente autorizados. Preferência não equivale a propriedade dos dados, direito de acesso ou mudança de vínculo. Ao mudar de conversa, recuperar contexto previamente selecionado se continuar válido; caso contrário mostrar neutro, sem escolher Atendimento errado automaticamente.
- `Message`: pertence à conversa, jamais exclusivamente a um Atendimento. `messageId` qualificado por instância+conversa; origem `fromMe` não prova quem enviou (celular, Web ou automação). Não presumir completude, monotonicidade de status ou mídia disponível.

**Invariantes:** selecionar outro Atendimento não altera `conversationId`, consulta de mensagens nem a linha do tempo; vincular/desvincular não muda conteúdo do histórico; nenhuma mudança de contexto cria lead ou altera faturamento; vínculo N:N admite (0, N) em ambos os sentidos.

## 4. Autorização e visibilidade — decisão bloqueante antes de exposição real

**Risco material:** histórico inteiro pode conter assuntos de múltiplos veículos, familiares, representantes e Atendimentos antigos. A lógica de leitura legada por Atendimento limita a visibilidade de forma diferente. O login por senha/sessão do MVP não identifica funções/papéis individuais nem fornece alçada suficiente para ampliar acesso.

**Proposta conservadora:** antes de qualquer endpoint real de histórico por conversa, implementar ou comprovar identidade individual do operador e uma política aprovada de permissão. Por padrão, **negar** acesso sem autorização expressa. Uma autorização sobre Atendimento A **não concede** automaticamente acesso à conversa inteira quando ligada ao Atendimento B. A liberação precisa ser no escopo `conversationId` para um usuário/função autorizada, com decisão explícita sobre históricos cruzados.

Para cada operação de conteúdo, o backend revalida sessão, operador, permissão específica por conversa e escopo da instância; nunca confia em `remoteJid` ou `atendimentoId` enviados pelo navegador como prova de autorização. Registra auditoria mínima de acessos/associações sem conteúdo sensível, sem repassar tokens de Evolution ao cliente, com resposta `Cache-Control: no-store`; erros não revelam existência de conversa sem permissão. Proteção de dados, retenção, finalidades e alçadas de acesso exigem validação de privacidade conforme `06_legal_and_policy.md`.

**Não decidido:** matriz de quem lê histórico integral e em que circunstâncias (gestão, comercial, operação, auditoria); visibilidade de conversas sem Atendimento; duração de logs/auditoria. Essas escolhas não devem ser inventadas pelo código.

## 5. Interfaces candidatas (não rotas existentes)

Os exemplos abaixo são **propostas**; nenhum endpoint foi criado.

| Operação | Contrato sugerido | Restrições |
|---|---|---|
| `GET /api/chat/conversations` | Lista paginada de metadados autorizados com `conversationId`, status de disponibilidade e quantidade de vínculos | Sem prévias ou conteúdo até autorização; não expor JIDs arbitrários |
| `GET /api/chat/conversations/:conversationId/messages?limit=50&page=1` | Retorno normalizado de mensagens autorizadas, `page`, `reportedTotal`, `consistency:'offset-not-snapshot'` | `page` é escolha provisória; não oferecer cursor estável inexistente; não confundir contagem de fornecedor com snapshot |
| `GET /api/chat/conversations/:conversationId/atendimentos` | Lista de Atendimentos associados que operador pode ver | Não incluir Atendimentos fora da permissão |
| `POST /api/chat/conversations/:conversationId/atendimentos` | Vínculo explícito com `atendimentoId`, `expectedRevision`, `requestId`, `reason` | Escrita exige autenticação individual, Origin, autorização, idempotência, auditoria e conflito 409 |
| `DELETE /api/chat/conversations/:conversationId/atendimentos/:linkId` | Desvínculo explícito com revisão/motivo | Sem excluir histórico nem vínculos legados por efeito colateral |
| Contexto selecionado | Armazenado localmente na sessão do operador ou em preferência por usuário+conversa | Não confundir com vínculo; não dar acesso |

**Não criar rotas de escrita ou ativar Chat nessa fase.** Preferir adaptar a superfície conforme autenticação real aprovada e decisões de UX, não transformar nomes de rotas propostos em exigências imutáveis.

### Esqueleto de resposta para leitura (apenas contrato proposto)

```json
{
  "conversationId": "id-interno-opaco",
  "items": [],
  "page": 1,
  "reportedTotal": 0,
  "hasMore": false,
  "consistency": "offset-not-snapshot",
  "historyComplete": "unknown",
  "source": "evolution",
  "observedAt": "2026-11-07T15:00:00Z"
}
```

A interface deve diferenciar “sem mensagens retornadas” de “histórico comprovadamente vazio” e de erro da Evolution; não alegar sincronização ao vivo, lida/entregue, mídia disponível ou completude sem evidência. `hasMore` é heurística e não garantia sob mutações. A atual POC do adapter com page size 50 deve ser consistente com esse contrato ou ter adaptação explicitamente testada.

## 6. Origem da leitura e resiliência

**A — Evolução direta (preferência experimental):** backend lê Evolution através de transporte interno seguro, segredo exclusivamente no servidor, timeout curto, abort/cancelamento, baixo limite de concorrência, resultados limitados e saneados; aplicativo nunca acessa API key. Sem mudança em webhook n8n nem no ERP.

**B — Cache seletivo:** avaliar somente se medições do uso real mostrarem latência, indisponibilidade, excessivas leituras/consumo ou UX inadequada. Cache com proteção, retenção, invalidação e responsabilidade de operação; **não implementar por conjectura**.

**C — Espelho durável:** avaliar se requisitos aprovados incluírem completude auditável, recuperação histórica, pesquisa, confiabilidade de eventos ou independência de retenção Evolution. Exige projeto separado de eventos, backfill, idempotência, recuperação, privacidade e backups; não presumir RabbitMQ obrigatório.

**Falha/degradação:** em indisponibilidade Evolution, retornar estado explícito e não bloquear Atendimento/orçamento/ERP; não transformar timeout em chat vazio. Nenhum polling agressivo. O PostgreSQL Evolution não será consultado diretamente pelo browser; a rota de produção deve passar por backend e política de acesso.

## 7. Compatibilidade e evolução de schema

- Preservar `server/chat/schema.ts`, `ChatRepository`, `GET /api/atendimentos/:id/messages`, inbox/ingest inativos e as demais rotas como estão até migração expressa.
- **Não usar `chat_links` atual como relação N:N**: existe `chat_active_link` (índice único por conversa ativa) e `chat_messages.link_id`, ambos intencionais para a semântica legada por período.
- Uma migração futura aditiva deve criar associação N:N própria e preservar vínculo temporal legado como proveniência do registro. Requer mapeamento verificável, backup/teste de restauração, teste de regressão e rollback claramente planejado; nenhuma modificação nesta PR.
- Não ativar `capabilities.messages` sem autenticação/permissão implementada, contrato real homologado e observabilidade.
- Evitar adicionar entidades redundantes de contatos/veículos/ERP e inferência por telefone; n8n mantém classificação de leads e operação existente.

## 8. Aceite e sequência recomendada

| Ordem | Entrega | Ferramenta preferida | Gate |
|---|---|---|---|
| 1 | Revisão desta especificação + decisão de permissão de histórico | ChatGPT + direção | Não publicar história cruzada sem alçada |
| 2 | Testes 100% sintéticos da política de visibilidade e invariante N:N, sem migração | ChatGPT ou Codex se necessário para execução integrada | Provar isolamento e invariantes |
| 3 | Leitor backend experimental com transporte injetável e autenticação por conta individual; sem deploy | Codex **somente** se integração/testes no repositório completo justificarem | CI, testes negativos e regressão |
| 4 | Migração aditiva do relacionamento N:N após aprovar regras e backup/restore | Codex, por ambiente e testes integrados | Dados legados preservados e rollback |
| 5 | Piloto interno, explicitamente autorizado e reversível; amostra consentida/permitida | Ferramenta conforme acesso real | Métrica de desempenho, completude declarada, privacidade e proteção da produção |
| 6 | Envio de mensagens e atualizações em tempo real | Projeto separado | Idempotência, observabilidade, segurança, continuidade do WhatsApp/n8n |

### Cenários mínimos de teste

- Uma conversa com dois Atendimentos, um Atendimento com dois chats; sem Atendimento; Atendimento sem chat.
- Seleção A→B não altera requisição de mensagens nem histórico; troca de chat recupera contexto válido ou estado neutro.
- Desvínculo da associação ativa não apaga mensagens; contexto inválido é limpo; concorrência de duas revisões gera 409.
- Usuário sem autorização recebe negação mesmo com link conhecido/URL adivinhada; sessão expirada; acesso permitido a A mas não ao histórico cruzado de B; tentativa de JID arbitrário; mensagens e mídia nunca aparecem em logs/erros.
- Paginação sob inserção/remoção/empates; identidade PN/LID não inferida; erro 401/timeout/5xx; zero de resultados não significa histórico totalmente vazio.
- Nenhum requisito de cliente/n8n depende do Chat para seguir operando; `capabilities.messages=false` permanece até liberação.

## 9. Decisões para aprovação posterior

1. **Quem tem permissão de leitura do histórico integral por conversa?** Recomendação: privilégio de função específica, auditável, nunca automaticamente implícito no vínculo com Atendimento.
2. **Como vincular ou desvincular?** Recomendação: ação explícita autorizada e auditada; sugestão por telefone/nome/placa é candidato, não vínculo.
3. **Contexto ativo deve persistir entre sessões?** Recomendação: inicialmente só por sessão individual; persistência por usuário após confirmar necessidade real.
4. **Como tratar históricos antigos e retenção?** Depende de orientação de privacidade e garantia de cobertura; não preencher com dedução.
5. **Qual desempenho é aceitável?** Definir pela UX em teste piloto, não por estimativa do EXPLAIN sintético.

**Nenhuma dessas propostas equivale a política formal até aprovação expressa.**
