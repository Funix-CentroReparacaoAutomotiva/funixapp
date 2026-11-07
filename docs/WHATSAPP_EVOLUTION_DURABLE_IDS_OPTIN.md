# FUNIX — IDs persistentes e integração Evolution opt-in na VPS atual

**Estado:** código preparado para revisão, não implantado, sem habilitação de leitura real. **Base:** PR #86, branch `feat/chat-evolution-backend-transport`. O FunixApp instalado em `app.funix.com.br` será o único ambiente operacional de testes quando houver autorização para deploy; **não criar VM, outro serviço, Compose, Evolution ou banco**.

## 1. O que a implementação acrescenta

- **Migração aditiva SQLite V15:** tabela `evolution_conversations` apenas para correspondência `(instance,remote_jid) ↔ id` aleatório e estável, com chave única e índice de instância. **Não modifica** `chat_conversations`, `chat_links`, `chat_messages`, pagamentos, Atendimentos nem histórico do ERP.
- **`EvolutionConversationStore`:** registra JIDs recebidos do provider no backend e resolve somente IDs opacos permitidos. Identidade é estável entre reinícios do contêiner e repetição de listagem. LID e JID telefônico permanecem separados; não inferir que são a mesma pessoa.
- **Bridge:** continua compatível com ID temporário quando não recebe store (testes offline antigos), mas usa o mapeamento persistente quando injetado.
- **`loadEvolutionChat`:** retorna `undefined` se a flag não for exatamente `true`. Se habilitada sem configurações obrigatórias, falha no bootstrap sem chamar a Evolution. Origem de rede e alias de instância são **fixos no código** conforme inventário da VPS: `http://evolution-api-nvzq-api-1:8080`, `funix_comercial`. Não aceita hostname/URL de navegador ou de variável livre.
- **`server/index.ts`:** injeta a ponte opt-in quando validamente configurada. Com configuração atual sem a flag, rotas Evolution continuam desligadas.

## 2. Configuração (somente na futura implantação autorizada)

No backend FunixApp, sob `/etc/funix/runtime.env` existente e protegida, **somente após autorização para habilitar e após descobrir ID técnico sem dados pessoais**:

```ini
# Ausente/desabilitada por padrão
FUNIX_EVOLUTION_READ_ENABLED=false
# Segredos e IDs técnicos não são fornecidos no GitHub nem nesta documentação
# FUNIX_EVOLUTION_READ_API_KEY=<valor protegido, aprovado pelo administrador>
# FUNIX_EVOLUTION_INSTANCE_ID=<identificador técnico confirmado da instalação>
```

**Nunca copiar chave ou ID técnico de cliente para chat, PR, histórico de terminal, script de logs ou frontend.** A chave da Evolution **não está automaticamente presente no contêiner FunixApp**, mesmo que a rede TCP esteja funcionando. O administrador deverá provisioná-la pelo procedimento protegido apropriado; não usar `docker inspect` para imprimir env. Uma variável sem valor não é configuração pronta.

A flag habilitada disponibiliza rotas de leitura autenticadas; **não habilita envio WhatsApp**, receptor HMAC, polling, webhook ou sincronização automática. Qualquer leitura de conversas reais requer escopo de acesso e autorização específica da direção, mesmo quando apenas ela usa o aplicativo.

## 3. Gate de migração e rollback — obrigatório

**ATENÇÃO:** `openDatabase()` aplica V15 automaticamente em qualquer startup de uma build que a contenha, ainda que `FUNIX_EVOLUTION_READ_ENABLED=false`. A release anterior, cuja lista de migrações termina em V14, **recusará abrir banco V15**. Portanto, *reverter só a imagem Docker não é rollback completo*. Antes de qualquer deploy da build:

1. Obter backup consistente **do SQLite atual**, preservado fora do volume operacional e com integridade conferida; comprovar restauração conforme procedimento autorizado. Nenhum backup foi criado por esta PR.
2. Identificar revisão/imagens instaladas e estabelecer parada/reversão completa em caso de falha, incluindo **restauração verificada da cópia SQLite anterior à V15**. Se houver escritas no FunixApp após a migração, a restauração ao estado anterior pode **perder dados novos**: definir janela/critério e registrar risco.
3. Executar CI, testes de migração aditiva, testes de sessão e regressão. **Não** alterar esquema da Evolution ou DB PostgreSQL.
4. Aprovar explicitamente merge/deploy da mudança em `app.funix.com.br`. Deploy permanece manual, sem alteração no número WhatsApp ou n8n.
5. Após implantação da estrutura, **manter flag desativada** até validar credencial/instância e aprovar chamada real por tela.

Se esse custo de rollback for desproporcional ao benefício atual, **adiar a migração V15** e não lançar esta PR. O fato de o FunixApp ainda estar em testes não autoriza ignorar perda de dados persistentes.

## 4. Limites e próximos incrementos

- Mapeamento estável de conversa **não equivale** a vínculo N:N com Atendimentos. Esse relacionamento exigirá decisão e migração aditiva posteriores, preservando a semântica legada de períodos.
- O histórico continua sendo lido sob contrato Evolution `page/offset`, sem snapshot; `historyComplete='unknown'`. Não afirmar completude, tempo real, estabilidade de paginação ou entrega/leitura de status.
- A lista de chats pode depender de regras de seleção do provedor; não usar como prova de todos os históricos existentes.
- Um segundo usuário exigiria revisão da segurança simplificada. Hoje, apenas o proprietário tem acesso ao aplicativo.
- Sem novos serviços, fila, RabbitMQ, cache, índice PostgreSQL, QR, envio, alteração da Evolution, n8n ou ERP.

**Testes propostos/implementados:** IDs estáveis após fechar e reabrir SQLite, isolamento de instâncias, validação de JID, resolução da ponte, flag opt-in e ausência de rede nos testes de configuração. São somente testes sintéticos/locais, não demonstram histórico real ou disponibilidade.

Refs: Issues #71 e #76; PRs #73, #83 e #86.
