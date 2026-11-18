# Consolidação do cadastro e retirada do Coda da autoridade comercial

Decisão da direção (18/11/2026): **Entidade 1:N Contato; Contato 1:1 Chat WhatsApp**. O número é único, pertence a uma Entidade e mantém histórico próprio. A Entidade pode ter vários números. Número sem WhatsApp não implica uma conversa real nem autorização de envio. Atendimentos referenciam Entidades/Contatos/Chats; não mantêm cadastro independente. FunixApp é a fonte única. Retirar a integração comercial Coda, sem apagar registros do Coda nem desativar automações não relacionadas.

## Primeira etapa — ensaio offline
`consolidateLegacyCustomers(db, apply=false)` em `server/chat/legacy-consolidation.ts` importa vínculos já persistidos no SQLite V23 e concilia fichas com uma pessoa e um número confirmado pelo vínculo histórico, sem ressuscitar relações desfeitas. O modo padrão reverte a transação. Para ensaiar sobre uma cópia nova, sem abrir a origem para escrita:

```sh
node server/consolidate-legacy-copy.ts /caminho/backup.sqlite /caminho/ensaio-novo.sqlite
```

O comando usa backup SQLite consistente, cria um arquivo novo e aplica a consolidação somente na cópia. O relatório JSON contém apenas contagens. Restringir acesso aos dois arquivos e nunca versioná-los. A cópia não deve substituir produção antes dos critérios de corte. Preserva IDs de Atendimentos, históricos e recibos. Titularidade divergente, múltiplas pessoas, LID sem PN e nomes indistinguíveis ficam pendentes. Não há alteração de schema, bootstrap ou flags. A implementação do modo autônomo existente passa a criar/reutilizar Entidade e Contato no primeiro inbound autenticado com PN inequívoco e contexto novo; nomes do canal são rótulos provisórios. LID sem PN não inventa número. Os modos anteriores são preservados até o corte.

## Antes do corte
- Validar CI e ensaiar em cópia consistente do banco instalado; completar conciliação de fichas sem Chat, contextos ativos/revogados e ambiguidades. Contagens de pendências não autorizam descarte.
- Remover a escrita independente de nome/telefone; campos antigos que contratos/documentos requerem serão projeções, não fontes. Novos eventos autenticados e cadastros devem criar/reutilizar o par Entidade–Contato, com identidade provisória quando não identificada; preservar o histórico por número e o contrato de Atendimento.
- Validar recepção autenticada Evolution → FunixApp e replay antes de trocar a autoridade. O workflow ativo n8n `FUNIX | WhatsApp | Classificar contatos | PROD` (21wpOido7t5OHb7i) consulta/escreve Coda, recebe webhook, executa triagem agendada e envia mensagens. Não desligá-lo antes de confirmar a rota substituta; suspender o fluxo antigo no corte coordenado, sem habilitar novos envios automáticos. Conferir demais dependências comerciais.
- Backup verificável e procedimento de rollback; retirar execução e UI legadas após validação. Manter tabelas históricas retidas até autorização de descarte.

Esta primeira etapa não altera banco instalado, VPS, n8n ou Evolution. Não equivale ao corte concluído.
