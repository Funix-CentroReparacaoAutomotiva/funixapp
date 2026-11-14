# FUNIX — Issue #76: inspeção somente de catálogo PostgreSQL

**Estado:** roteiro preparado, teste de proteção executado offline; **não executado** no PostgreSQL da FUNIX.

## Objetivo

A Evolution API 2.3.7/Baileys foi relatada com PostgreSQL 15 e persistência de mensagens configurada. A IA da Hostinger não teve permissão para acessar o catálogo, portanto **tabelas/índices reais não foram verificados**. A POC da PR #73 é sintética; o laboratório da PR #75 não foi executado. O objetivo aqui é obter somente metadados técnicos de estrutura e índices, **sem consultar linhas de mensagens, clientes, contatos, chats ou sessões**.

## Procedimento e limites

Arquivo: [`sql/evolution_catalog_readonly.sql`](sql/evolution_catalog_readonly.sql).

O administrador poderá utilizá-lo **somente em sessão SQL já autorizada**, preferencialmente com papel que permita catálogo e não permita alterar tabelas. **Não executar automaticamente pelo FunixApp ou por CI.** Se a whitelist da IA Hostinger bloquear, registrar **NÃO VERIFICADO** sem contornar o bloqueio.

O arquivo começa com `BEGIN TRANSACTION READ ONLY`, configura `statement_timeout = 3000ms` e `lock_timeout = 500ms`; termina com `COMMIT`. Realiza exatamente cinco consultas somente de catálogo:

1. versão PostgreSQL via `current_setting('server_version')`;
2. nomes e tipos das três tabelas-alvo em `information_schema.tables`;
3. nomes, tipos e nulidade de colunas em `information_schema.columns`;
4. índices de `pg_catalog.pg_indexes` (incluindo expressões quando declaradas);
5. chaves PK/UNIQUE/FK via `information_schema.table_constraints` e `key_column_usage`.

**Não há SELECT das tabelas de negócio nem EXPLAIN, EXPLAIN ANALYZE, benchmark, DML/DDL, nova conexão WhatsApp ou alterações de infraestrutura.** O script não pede nem exibe segredos, números ou corpos de mensagens. A transação de leitura é uma segunda camada de proteção, não uma substituição do controle de acesso.

As consultas limitam-se ao esquema `public`; resultado vazio **não comprova que uma estrutura não exista em outro esquema**.

## Interpretação e registro

Verificar se índices existentes cobrem `instanceId`, `messageTimestamp`, `key ->> 'remoteJid'` e `key ->> 'remoteJidAlt'`, incluindo combinações. O código-fonte público da Evolution ordena mensagens por timestamp DESC e filtra IDs de conversa no campo JSONB. **Ausência de índice não prova lentidão; presença não prova que o plano o utiliza.** Não recomendar `CREATE INDEX` com base apenas nesta observação.

Guardar somente data, canal autorizado, versão, tabela/coluna/índice/constraint e interpretação em uma das categorias: **VERIFICADO NA INSTALAÇÃO**, **CÓDIGO PÚBLICO**, **INFERÊNCIA**, **NÃO VERIFICADO**. Sem URLs privadas, credenciais, payloads de clientes ou dumps.

A chamada experimental à API Evolution com filtro sintético, assim como qualquer inspeção de registros reais, **não faz parte desta etapa e exige autorização própria**. Nenhuma alteração no `funix_comercial`, webhook n8n, ERP, SQLite, Docker ou Chat.

Refs: Issues #62, #71, #74, #76; PRs #73 e #75.
