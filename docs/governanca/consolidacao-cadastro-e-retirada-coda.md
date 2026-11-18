# Consolidação do cadastro e retirada do Coda da autoridade comercial

Decisão da direção (18/11/2026): **Entidade 1:N Contato; Contato 1:1 Chat WhatsApp**. O número é único, pertence a uma Entidade e mantém histórico próprio. A Entidade pode ter vários números. Número sem WhatsApp não implica uma conversa real nem autorização de envio. Atendimentos referenciam Entidades/Contatos/Chats; não mantêm cadastro independente. FunixApp é a fonte única. Retirar a integração comercial Coda, sem apagar registros do Coda nem desativar automações não relacionadas.

## Primeira etapa — ensaio offline
`consolidateLegacyCustomers(db, apply=false)` em `server/chat/legacy-consolidation.ts` importa vínculos já persistidos no SQLite V23 e concilia fichas com uma pessoa e um número confirmado pelo vínculo histórico, sem ressuscitar relações desfeitas. O modo padrão reverte a transação. Preserva IDs de Atendimentos, históricos e recibos. Titularidade divergente, múltiplas pessoas, LID sem PN e nomes indistinguíveis ficam pendentes. Não há alteração de schema, bootstrap ou flags.

## Antes do corte
- Validar CI e ensaiar em cópia consistente do banco instalado; completar conciliação de fichas sem Chat, contextos ativos/revogados e ambiguidades. Contagens de pendências não autorizam descarte.
- Remover a escrita independente de nome/telefone; campos antigos que contratos/documentos requerem serão projeções, não fontes. Novos eventos autenticados e cadastros devem criar/reutilizar o par Entidade–Contato, com identidade provisória quando não identificada; preservar o histórico por número e o contrato de Atendimento.
- Validar recepção autenticada Evolution → FunixApp e replay antes de trocar a autoridade. O workflow ativo n8n `FUNIX | WhatsApp | Classificar contatos | PROD` (21wpOido7t5OHb7i) consulta/escreve Coda, recebe webhook, executa triagem agendada e envia mensagens. Não desligá-lo antes de confirmar a rota substituta; suspender o fluxo antigo no corte coordenado, sem habilitar novos envios automáticos. Conferir demais dependências comerciais.
- Backup verificável e procedimento de rollback; retirar execução e UI legadas após validação. Manter tabelas históricas retidas até autorização de descarte.

Esta primeira etapa não altera banco instalado, VPS, n8n ou Evolution. Não equivale ao corte concluído.
