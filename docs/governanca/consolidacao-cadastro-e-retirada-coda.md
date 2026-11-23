# Consolidação do cadastro e retirada do Coda da autoridade comercial

Decisão da direção (18/11/2026): **Entidade 1:N Contato; Contato 1:1 Chat WhatsApp**. O número é único, pertence a uma Entidade e mantém histórico próprio. A Entidade pode ter vários números. Número sem WhatsApp não implica uma conversa real nem autorização de envio. Atendimentos referenciam Entidades/Contatos/Chats; não mantêm cadastro independente. FunixApp é a fonte única. Retirar a integração comercial Coda, sem apagar registros do Coda nem desativar automações não relacionadas.

## Primeira etapa — ensaio offline
`consolidateLegacyCustomers(db, apply=false)` em `server/chat/legacy-consolidation.ts` importa vínculos já persistidos no SQLite V23 e concilia fichas com uma pessoa e um número confirmado pelo vínculo histórico, sem ressuscitar relações desfeitas. O modo padrão reverte a transação. Para ensaiar sobre uma cópia nova, sem abrir a origem para escrita:

```sh
node server/consolidate-legacy-copy.ts /caminho/backup.sqlite /caminho/ensaio-novo.sqlite
```

O comando usa backup SQLite consistente, cria um arquivo novo e aplica a consolidação somente na cópia. O relatório JSON contém apenas contagens. Restringir acesso aos dois arquivos e nunca versioná-los. A cópia não deve substituir produção antes dos critérios de corte. Preserva IDs de Atendimentos, históricos e recibos. Titularidade divergente, múltiplas pessoas, LID sem PN e nomes indistinguíveis ficam pendentes. Não há alteração de schema, bootstrap ou flags. A implementação do modo autônomo existente passa a criar/reutilizar Entidade e Contato no primeiro inbound autenticado com PN inequívoco e contexto novo; nomes do canal são rótulos provisórios. LID sem PN não inventa número. Os modos anteriores são preservados até o corte.

## Antes do corte
- Validar CI e ensaiar em cópia consistente do banco instalado; conferir a conciliação de fichas sem Chat, contextos ativos/revogados e ambiguidades. Fichas sem Chat com uma pessoa e telefone completo inequívoco também são conciliadas; não criam conversa nem vínculo comercial. Contagens de pendências não autorizam descarte.
- Remover a escrita independente de nome/telefone; campos antigos que contratos/documentos requerem serão projeções, não fontes. Novos eventos autenticados e cadastros devem criar/reutilizar o par Entidade–Contato, com identidade provisória quando não identificada; preservar o histórico por número e o contrato de Atendimento.
- Validar recepção autenticada Evolution → FunixApp e replay antes de trocar a autoridade. O workflow ativo n8n `FUNIX | WhatsApp | Classificar contatos | PROD` (21wpOido7t5OHb7i) consulta/escreve Coda, recebe webhook, executa triagem agendada e envia mensagens. Não desligá-lo antes de confirmar a rota substituta; suspender o fluxo antigo no corte coordenado, sem habilitar novos envios automáticos. Conferir demais dependências comerciais.
- Backup verificável e procedimento de rollback; retirar execução e UI legadas após validação. Manter tabelas históricas retidas até autorização de descarte.

Esta primeira etapa não altera banco instalado, VPS, n8n ou Evolution. Não equivale ao corte concluído.

## Ensaio de recepção sem Coda
O teste HTTP sintético usa o envelope bruto Evolution, assinatura HMAC, modo autônomo, replay, Entidade–Contato e leitura do mesmo histórico no Atendimento. Isso não prova o encaminhamento instalado: verificar a configuração real do relay e os recibos locais antes de desativar o classificador publicado.

## Resultado do primeiro ensaio instalado — 18/11/2026
Ensaio em cópia V23: 94 vínculos (19 importados, 75 existentes), 77 Atendimentos conciliados, 74 pendentes e 3 contextos para revisão. IDs preservados, integridade OK e 57 tabelas protegidas verificadas. Diagnóstico: 57 telefones não aceitos pela normalização internacional, 11 divergências telefone/Chat, 4 sem nome, 2 entidades com mesmo nome. Motivos de formato não provam que todos os números sejam recuperáveis. A revisão seguinte propõe converter somente números brasileiros completos com DDD válido, sem inserir dígito de assinante, sem adivinhar DDD e sem criar Chat para ficha manual. Contatos legados existentes que possam colidir bloqueiam duplicação. O relatório passa a discriminar motivos e normalizações, sem dados pessoais. Exige CI e segundo ensaio; produção não alterada.
