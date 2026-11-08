# FUNIX — Chat V20, integração dos vínculos manuais com Atendimentos

**Estado:** PR draft, somente código e testes sintéticos; NÃO implantado. O piloto real da leitura Evolution mantém a configuração existente e continua fora deste incremento.

## Funcionalidade proposta

Com duas flags independentes já configuradas no backend — a leitura Evolution e a nova `FUNIX_CHAT_V20_LINKS_ENABLED=true` — a listagem registra os IDs técnicos de chats individuais no SQLite da FUNIX. Identidade estável somente para a mesma instância e o mesmo JID exato; PN e LID não são fundidos. Um UUID de conversa permanece disponível após reinícios. O navegador nunca recebe JID ou segredo.

O operador autenticado pode buscar um Atendimento já existente, vinculá-lo manualmente à conversa, definir contexto ativo e desvincular com motivo e confirmação. Uma conversa pode ter N Atendimentos, e o mesmo Atendimento pode aparecer em N conversas. Contexto é preferência e não altera mensagem, histórico, ERP ou cobrança. A UI aparece somente quando a API anuncia `linksEnabled: true`. Quando a flag está desativada, o comportamento anterior do Chat V20 é mantido, incluindo IDs temporários.

## API prevista

- GET `/api/chat/conversations/:id/atendimentos` retorna revisão, vínculos ativos e contexto atual, com nome/veículo/placa do Atendimento.
- POST `/api/chat/conversations/:id/atendimentos` exige Atendimento válido, motivo, requestId UUID, expectedRevision, sessão e Origin.
- DELETE `/api/chat/conversations/:id/atendimentos/:linkId` exige motivo, requestId, revisão, sessão e Origin.
- POST `/api/chat/conversations/:id/context` exige linkId previamente associado ou null, sessão e Origin.
- Não existem rotas de envio de WhatsApp; `capabilities.messages=false` permanece.

O backend só aceita UUIDs que correspondem a uma conversa registrada na instância fixa `funix_comercial`. **Não** identifica automaticamente Atendimento por telefone, nome ou placa; contato pode ter múltiplas demandas e diferentes identidades PN/LID.

## Persistência e recuperação

As tabelas `v20_*` são aditivas e criadas em transação, **apenas quando** as duas flags estiverem exatamente `true`; nenhuma tabela legada é migrada ou reescrita. O histórico `schema_migrations` continua V14, permitindo que a versão anterior do aplicativo ignore as tabelas novas em um rollback de imagem. Desligar somente `FUNIX_CHAT_V20_LINKS_ENABLED` oculta os vínculos e retorna aos IDs efêmeros sem apagar dados novos; reabilitar recupera os vínculos já escritos. Não executar `DROP TABLE`, restaurar cópia antiga sobre SQLite com novas gravações nem confundir rollback de imagem com rollback de dados.

**Gate antes de deploy:** CI completo verde contra HEAD; revisar esquema/segurança/UI e teste de rollback/reabertura com SQLite sintético; backup persistente consistente do SQLite atual imediatamente antes da ativação; preservar cópia root:0600 do runtime.env; confirmar versão e digests da instalação; habilitar a flag apenas mediante autorização separada e janela supervisionada. Em erro, desligar a nova flag e recriar somente a API FUNIX; não mexer Evolution, n8n, WhatsApp, PostgreSQL ou Redis. A versão antiga continuará sem entender os vínculos V20, que permanecerão no SQLite.

## Limites que continuam

- Histórico é lido diretamente da Evolution com paginação offset instável; não há garantia de completude nem atualização em tempo real.
- Nenhuma mídia, envio ou automação; não registra corpo de mensagens no SQLite.
- Usuário único humano; acesso de outros operadores exige política e controle de identidade posterior.
- Ausência de auditoria externa de disponibilidade/performance em dados reais; não presumir SLA.
- O painel de Atendimentos do legado ainda é separado; esta entrega **não** troca o `ChatPanel` por Atendimento automaticamente.
