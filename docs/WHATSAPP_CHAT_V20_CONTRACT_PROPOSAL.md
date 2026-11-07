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

## 4. Acesso e privacidade — decisão de produto: usuário único

**Diretriz expressa pela direção em 07/11/2026:** a primeira versão do FunixApp terá **um único operador humano**, o proprietário. Não implementar cargos, múltiplos usuários, RBAC, grants, administração de contas, equipes ou hierarquias de permissões agora. Esta decisão vale para o **desenho do MVP**, não concede deploy ou acesso a dados produtivos.

**Regra proposta:** o único operador com sessão válida na autenticação atual do FunixApp poderá consultar o histórico integral das conversas da instância explicitamente configurada `funix_comercial`, inclusive quando uma conversa estiver relacionada a vários Atendimentos. Essa leitura é intencional na experiência V20. Uma sessão anônima/expirada nunca consulta Evolution. Não há compartilhamento de senha com funcionários. A aplicação não abre acesso público.

Medidas mínimas que permanecem: login e senha robusta existentes, HTTPS e cookie seguro no acesso remoto, checagem de sessão no backend a cada chamada, `Cache-Control: no-store`, instância e JID resolvidos exclusivamente pelo servidor a partir de um `conversationId` opaco, limites de paginação/timeout, segredo Evolution somente no backend, proteção `Origin` nas escritas e auditoria técnica mínima de vínculos. Nunca gravar conteúdo/credenciais em logs. Conversas sem Atendimento podem ser exibidas sem gerar leads automáticos. As mudanças em vínculos exigem confirmação e motivo, mas **não outro nível de aprovação interna**.

A sessão atual de senha só é aceitável para esta fase enquanto **a premissa de acesso humano único for verdadeira**. Antes da entrada de qualquer segundo operador humano, reavaliar identidade individual, revogação, papéis conforme necessidade e proteção de histórico cruzado. Proteção de dados e finalidade continuam aplicáveis; usuário único não elimina LGPD.

A troca de Atendimento é só contexto comercial; não altera o histórico WhatsApp nem concederá acesso a outras instâncias ou a conversas não reconhecidas pelo servidor.

## 5. Interfaces candidatas (não rotas existentes)

Os exemplos abaixo são **propostas**; nenhum endpoint foi criado.

| Operação | Contrato sugerido | Restrições |
|---|---|---|
| `GET /api/chat/conversations` | Lista paginada de metadados autorizados com `conversationId`, status de disponibilidade e quantidade de vínculos | Sem conteúdo de conversas anônimas; não expor JIDs arbitrários |
| `GET /api/chat/conversations/:conversationId/messages?limit=50&page=1` | Retorno normalizado para o operador autenticado, `page`, `reportedTotal`, `consistency:'offset-not-snapshot'` | `page` é escolha provisória; não oferecer cursor estável inexistente; não confundir contagem de fornecedor com snapshot |
| `GET /api/chat/conversations/:conversationId/atendimentos` | Lista de Atendimentos associados que operador pode ver | Não incluir Atendimentos fora da permissão |
| `POST /api/chat/conversations/:conversationId/atendimentos` | Vínculo explícito com `atendimentoId`, `expectedRevision`, `requestId`, `reason` | Escrita exige sessão autenticada, Origin, confirmação explícita, idempotência, auditoria e conflito 409 |
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

**Falha/degradação:** em indisponibilidade Evolution, retornar estado explícito e não bloquear Atendimento/orçamento/ERP; não transformar timeout em chat vazio. Nenhum polling agressivo. O PostgreSQL Evolution não será consultado diretamente pelo browser; a rota de produção deve passar por backend e validação da sessão única.

## 7. Compatibilidade e evolução de schema

- Preservar `server/chat/schema.ts`, `ChatRepository`, `GET /api/atendimentos/:id/messages`, inbox/ingest inativos e as demais rotas como estão até migração expressa.
- **Não usar `chat_links` atual como relação N:N**: existe `chat_active_link` (índice único por conversa ativa) e `chat_messages.link_id`, ambos intencionais para a semântica legada por período.
- Uma migração futura aditiva deve criar associação N:N própria e preservar vínculo temporal legado como proveniência do registro. Requer mapeamento verificável, backup/teste de restauração, teste de regressão e rollback claramente planejado; nenhuma modificação nesta PR.
- Não ativar `capabilities.messages` sem autenticação/permissão implementada, contrato real homologado e observabilidade.
- Evitar adicionar entidades redundantes de contatos/veículos/ERP e inferência por telefone; n8n mantém classificação de leads e operação existente.

## 8. Aceite e sequência recomendada (usuário único)

| Ordem | Entrega | Ferramenta | Gate |
|---|---|---|---|
| 1 | Aplicar premissa de um operador; revisar contrato V20, vínculo N:N e segurança | ChatGPT | Sem desenvolver RBAC/contas múltiplas |
| 2 | Testes sintéticos de login, escopo da instância, vínculos N:N, contexto e rejeições | ChatGPT ou Codex conforme verificação | Não tocar produção |
| 3 | Adaptador backend experimental de leitura por conversa via sessão atual | Codex quando testes integrados justificarem | CI + nenhum acesso de navegador à chave Evolution |
| 4 | Migração aditiva de vínculos N:N, preservando períodos históricos e endpoint legado | Codex, após plano de backup/restauração | Regressão e rollback |
| 5 | Piloto interno reversível com autorização específica | Ferramenta conforme acesso | Sem interromper n8n/WhatsApp |
| 6 | Envio, mídia e tempo real | Projeto separado | Idempotência e resiliência |

### Cenários mínimos de teste

- Sem sessão e sessão expirada: nenhum acesso à Evolution.
- Sessão autenticada do operador único: leitura do histórico de conversa na instância configurada; nenhum acesso por instância/JID arbitrários fornecidos pelo browser.
- Uma conversa associada a dois Atendimentos e um Atendimento associado a duas conversas; troca de contexto não altera histórico.
- Chat sem Atendimento; Atendimento sem Chat; seleção de contexto inválido; desvínculo não apaga mensagens.
- Concorrência de vínculos: revision e requestId impedem duplicações ou atualização perdida.
- Paginação instável/empates, falha/timeout, privacidade em logs e não exposição de segredos.
- Preservar endpoint legado e `capabilities.messages=false` até piloto autorizado.

## 9. Condições de avanço

**Definido pela direção:** um único operador humano, sem diferenciação de cargos ou perfis; o login atual é a referência de autenticação do MVP. Não desenvolver gestão de usuários enquanto essa premissa se mantiver.

**Ainda pendente para implantação:** contrato técnico de leitura por conversa e tratamento de dados sensíveis; migração N:N, recuperação/backup, limites de paginação e desempenho, ausência de envio e implantação controlada. A política para múltiplos operadores só será desenhada se a realidade mudar.

**Nenhuma alteração de ambiente, merge, migração ou deploy foi autorizada por esta especificação.**
