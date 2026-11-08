# Chat V20 — vínculo N:N e identidade durável (incremento isolado)

**Estado: proposta de código offline e testes sintéticos. NÃO implantado ou habilitado.** Base: `main` de 08/11/2026. O piloto real de leitura Evolution continua ativo e inalterado.

## Decisão e problema concreto

A leitura real atualmente apresenta IDs de conversa **efêmeros** em `server/chat/evolution-bridge.ts`. O SQLite legado V14 contém `chat_links` com índice `chat_active_link` que permite apenas uma ligação temporal ativa por conversa; `chat_messages.link_id` atribui mensagens a um período específico. Esses dados não equivalem à associação N:N do mockup FUNIX V20.

**Não modificar o legado, não inferir vínculo por número e não migrar durante este incremento.** O novo modelo de referência armazena uma identidade estável por (instância Evolution, remoteJid opaco), com `@s.whatsapp.net` e `@lid` separados, e relações explícitas entre conversas e Atendimentos.

## Implementação criada para testes isolados

- `server/chat/v20-associations.ts`: função `createV20AssociationSchema(db)` e `V20AssociationRepository`.
- Tabelas candidatas `v20_conversations`, `v20_associations`, `v20_active_context` e `v20_association_receipts`; nenhuma inclui texto de mensagens/credenciais Evolution.
- Uma conversa tem 0..N Atendimentos e um Atendimento tem 0..N conversas. Vincular e desvincular exige ação explícita, motivo, revisão esperada e requestId idempotente. Vínculos encerrados permanecem auditáveis.
- A seleção de contexto é **preferência de navegação** e não altera vínculos, Atendimentos ou histórico.
- O modelo usa uma única identidade de operador, coerente com o MVP atual. Antes de um segundo operador humano, reavaliar controles de acesso e propriedade do contexto.
- Todos os testes usam `:memory:` e dados artificiais; nenhum HTTP, credencial, Evolution, n8n ou WhatsApp.
- **Sem inclusão em `server/migrations.ts`**, sem injeção no bootstrap, sem rotas ou UI nova, sem ligação com os IDs atuais do bridge.

## Por que nenhuma migração entrou nesta PR

O migrador de produção é V14. Se adicionássemos V15 automaticamente ao inicializar, o rollback de imagem para versões anteriores recusaria abrir o SQLite mais novo. Para este recurso, que não exige alterar produção agora, isso é risco desnecessário.

**Antes de implantar:** decidir abordagem reversível para persistência do modelo (por exemplo migração separada e política de compatibilidade, ou mecanismo próprio revisado), testar backup/restore de dados sintéticos e plano de reversão sem perder escrita comercial. O backup local do Gate C não resolve rollback após novas gravações. Fazer CI de uma branch que não modifica migrations não valida uma futura migração.

## Critérios de validação do incremento

1. IDs persistem por instância e JID exatos ao reconstruir o repositório, sem fusão indevida PN/LID.
2. N:N entre duas conversas e dois Atendimentos, contexto alternável e estado neutro.
3. Repetição do mesmo requestId retorna mesmo resultado; parâmetros diferentes no mesmo requestId, revisão desatualizada e par ativo repetido geram conflito.
4. Desvinculação encerra vínculo sem apagar histórico nem afetar outro Atendimento.
5. `chat_links`, `chat_messages` e V14 permanecem intactos; nenhum caminho de produção acessa as tabelas candidatas.
6. `npm run check` e testes da PR passam com dados sintéticos.

**Próxima entrega separada:** incorporar o repositório aos endpoints do Chat V20 com controle de acesso, sessão e proteção CSRF, mais migração e recuperação de dados aprovadas; somente então integrar UI e avaliar deploy. Envio, mídia, webhooks e alteração de Evolution/n8n continuam fora do escopo.
