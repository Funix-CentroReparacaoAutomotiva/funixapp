# Issue #18 — importação comercial pontual Coda → FUNIX V7

Implementação em `feat/issue18-importacao-coda`, baseada na main `4371b4841266ac5ca22c6c89523a26a79ca98d1c`. Nenhuma alteração no Coda, VPS, banco produtivo, motor de cálculo, UI, migrações, workflows ou instalação. Sem sincronização permanente, novos endpoints ou token Coda no aplicativo/produção. Entrega para auditoria, sem merge/deploy.

## Fontes e resultado real em ambiente isolado

Leitura autenticada, somente dos cadastros do documento `2zsjI-nqWr`, pelo conector Coda/Superhuman Docs. Foram lidos esquemas/fórmulas de `db_Atendimentos_Servicos`, **nenhuma linha de clientes ou Atendimentos do ERP**. A exportação privada ficou fora do repositório. Os IDs de tabelas/colunas e fingerprints das fórmulas estão em `server/coda-import-source.ts`; a fixture de fórmulas contém apenas definições técnicas, sem linhas comerciais ou preços reais.

| Fonte | Linhas lidas | Destino/resultado |
|---|---:|---|
| Serviços | 28 | 28 cadastros, ativos e com IDs de origem estáveis |
| Dimensões de serviço | 76 | 75 dimensões vinculadas ao serviço correto; 1 sentinela excluída |
| Nomes de dimensão | 34 | Resolvidos por ID, sem unir nomes iguais de serviços diferentes |
| Diagnósticos | 16 | 16 cadastros, sem criação automática de composição |
| Bases comerciais | 4 | 4 opções; somente base Padrão possui FV comprovadamente compatível; outras 3 com fator `null` |
| Tipos de tinta / risco | 3 / 4 | 3 FC e 4 FR com valores de origem |
| Capacidade diária | 1 | Valor global positivo da fonte |
| Regras comerciais | 56 | Classificadas; não transformadas indiscriminadamente em especiais |
| Relações serviço/etapa | 113 | Verificação dos vínculos e da soma de energia por dimensão |
| Etapas / dimensões técnicas / energias | 39 / 16 / 11 | Resolvidas por ID; valores negativos/ausentes ficam pendentes |
| Relações diagnóstico/serviço | 77 | Documentadas como pendentes; V7 mantém escolha manual |
| ConfigApp | 1 | Não interpretado como MR |

Ensaio com os dados reais em **banco V7 local isolado criado para QA**, sem cópia nem acesso ao banco produtivo: **119 novos cadastros** (28 + 75 + 16), 12 serviços com base comprovada, 44 dimensões com base/FD compatíveis, 51 dimensões com etapas/energia completas. A interseção permite cálculo e energia completos em **28 dimensões**, sob as condições abaixo. Repetição: **0 inserções**, sem conflitos. Integridade SQLite e FKs verificadas. Isso não significa que todos os serviços/tabelas já possam emitir orçamento.

Os números descrevem a exportação desta revisão, não uma expectativa fixa para importações futuras. O dry-run produz os totais atuais, IDs/nomes, mapa de origem, conflitos e pendências detalhadas, sem versionar valores comerciais. Evidências publicadas usam somente dados **sintéticos**.

## Regras compatíveis e pendências materiais

- Preço normal V7 continua `teto_R$0,05(base × FD × FV × FC × FR) × quantidade`. Importam-se bases apenas quando a regra da tabela raiz é `calculado`, sem ambiguidade de dimensão/base, e FC/FR estão habilitados. Não se alterou o motor.
- O fallback `__ALL_dim__` é reconhecido conforme a fórmula original de seleção: regra da dimensão exata tem precedência sobre o fallback. A sentinela nunca vira dimensão selecionável. Chaves duplicadas não recebem uma precedência arbitrária.
- O Coda pode desligar FC/FR por regra; a V7 aplica-os globalmente. **14 regras raiz condicionais** ficaram sem base importável. Não foi criado um preço especial para disfarçar essa incompatibilidade.
- Regras percentuais (25 na fonte, incluindo 2 globais sem serviço), herança de tabelas, correção por artesão e bases por serviço/tabela não equivalem diretamente ao FV global. As três tabelas derivadas ficam com fator pendente, impedindo fallback normal incorreto. Há também uma regra sem tipo e uma chave duplicada na fonte. Não se resolveu isso com novos preços nem com escolhas `First()`.
- Todos os 113 fatores de escala técnicos atuais são 1. A equivalência de preço é declarada para **quantidade ≥ 1**. Para quantidade abaixo de 1, o Coda usa `Fator Quantidade Produto / Qnt.`; a V7 mantém a quantidade linear/fracionária aprovada. Essa divergência está no dry-run; não se modificou a regra atual para imitar o ERP.
- Energia é importada somente com todas as etapas da dimensão resolvidas, valores não negativos, soma por relação e soma total iguais às saídas Coda. Não se publica subconjunto parcial como se fosse energia completa. Energia negativa, referência ausente/quebrada ou conjunto vazio deixa a dimensão sem etapas, bloqueando emissão até revisão.
- **MR fica vazio** quando ainda não existe configuração local. `fator_curadoria` não foi convertido em MR. Componentes continuam dependendo de um MR informado pela direção. Multiplicadores locais já existentes são preservados.
- `Faturavel`, `Descontavel`, intensidade e sugestões automáticas diagnóstico → serviço não têm campos equivalentes no contrato atual. Foram apontados, sem alterar negociação, habilitar serviços automaticamente ou criar novos modelos.
- Mecânica, elétrica e vidraçaria são sinalizadas para revisão quanto à terceirização. Nenhum serviço foi apagado ou desativado silenciosamente.

É necessária decisão da direção para os fatores/tabelas incompatíveis, MR e ajustes técnicos pendentes. A importação parcial segura pode ser auditada independentemente dessas decisões; ela não promete orçamento completo para todos os casos.

## Arquivos e contrato de operação

- `server/coda-import-source.ts`: IDs conhecidos, envelope da exportação e preservação lexical dos decimais JSON antes da conversão para Number.
- `scripts/export-coda-commercial.ts`: coletor opcional GET-only com lista fixa de tabelas de configuração, paginação, conferência de contagens, timeout e saída exclusiva 0600. Lê apenas esquema da tabela operacional de serviços; não lê seus registros.
- `server/coda-import.ts`: planejamento offline, resolução por ID, validação pelos contratos V7, detecção de colisões e transação única.
- `server/import-coda.ts`: CLI; **sem `.env`, sem banco padrão, sem migrações automáticas**. Exige arquivo V7 existente e caminho explícito. Recusa symlinks e schemas diferentes de 7.
- Testes Node, fixture sintética e `tests/browser/issue18_import.py`; `server/tsconfig.json` inclui o coletor no typecheck existente.

Envelope JSON: `format: "funix-coda-commercial-v1"`, `documentId`, `exportedAt`, `tables:[{id,schema:{columns:[{columnId,name,formula}],rowCount},rows:[{rowId,values}],totalRows,hasMore:false}]`, `pricingFormulaSchema:{columns}`. Valores podem ser células diretas do REST ou wrappers `{value:...}` do conector; relações exigem `rowId` e tabela de destino, nunca nomes como chave. Valores numéricos são preservados como decimais textuais; precisão acima de 6 casas/12 dígitos inteiros fica pendente em vez de arredondada.

O coletor pode ser executado em uma estação autorizada, **não na VPS**, com `CODA_API_TOKEN` já provisionado no ambiente de forma segura:

```bash
node --use-env-proxy scripts/export-coda-commercial.ts .runtime/import-coda/export.json
```

O diretório privado de destino deve existir. Não colocar token na linha de comando. O coletor REST foi testado com transporte simulado/paginado; a coleta real desta entrega utilizou o conector autenticado. Se o REST omitir fórmulas ou entregar uma representação diferente da definição canônica conferida, o dry-run bloqueia preço/energia. Nesse caso, obter os esquemas canônicos via `table_columns_read` do conector para as mesmas tabelas e a tabela `grid-aHz1ZDVlfK`, conservando IDs e valores; não desativar fingerprints nem converter regras por suposição. Exportar todas as páginas de `table_rows_read` das tabelas de configuração da allowlist. Não exportar linhas da tabela operacional. A definição de energia inclui `grid-M08uQO9NFg`; a falta dela não pode virar zero.

Durante a exportação não editar cadastros no ERP: as leituras remotas não constituem um snapshot transacional Coda. Mudanças detectadas de contagem fazem o coletor recusar a saída. A fonte aprovada deve ser conservada privadamente junto dos relatórios; não há download remoto durante a importação.

## Dry-run, idempotência e preservação

```bash
node server/import-coda.ts \
  --source .runtime/import-coda/export.json \
  --database /caminho/isolado/copia-v7.sqlite > /caminho/privado/dry-run.json
```

Sem `--confirm-plan` o arquivo é aberto read-only. O relatório inclui `sourceDigest`, `targetDigest`, `planHash`, cadastros com IDs/nomes, `mapping`, `imported`, `pending`, `conflicts`, `warnings`, `inserts` e `unchanged`. Pode conter nomes comerciais: manter privado. Código de saída 0 = plano sem conflitos, **não significa ausência de pendências**; 2 = conflitos; 1 = recusa/erro de entrada ou aplicação. Revisar todos os grupos antes de autorizar.

O ID local é `coda:documento:tabela:linha`. Esse mapa não depende de nome, posição ou telefone e permanece gravado no próprio ID dos novos cadastros/fatores/etapas. Não exige tabela auxiliar nem nova migração. Nomes locais coincidentes de outra identidade causam conflito, em vez de associação silenciosa ou duplicação. Itens já editados/inativados e parâmetros divergentes nunca são sobrescritos; a carga inteira é recusada se houver conflitos.

Aplicar exige o hash exato produzido pelo dry-run para a mesma origem e estado de destino. O plano é recalculado sob `BEGIN IMMEDIATE`. Cadastros, histórico e configuração são confirmados juntos; qualquer falha reverte tudo. A repetição com novo dry-run não cria registros nem altera revisões. Um hash anterior à primeira aplicação deixa de valer; refazer dry-run ao repetir, sem reutilizar confirmação obsoleta.

Peças, Atendimentos, composição, cenários, parâmetros dos Atendimentos, componentes e emissões/PDFs não são gravados pela carga. `specialPrices`, condições e MR locais são preservados. A configuração global muda uma única revisão quando há alteração; consequentemente **rascunhos passam a usar a configuração atual** e prévias antigas perdem validade pelo mecanismo existente. Snapshots/PDFs emitidos permanecem byte a byte. Encerrar a edição do operador antes da aplicação, sem mudanças silenciosas durante seu teste.

## Execução futura em produção — somente após autorização específica

Não executado nesta entrega. Antes, a direção deve aprovar fonte, relatório/pendências e disponibilização da imagem contendo o importador. Não usar o backup V6 como destino/restauração da V7.

1. Obter exportação privada atual; ensaiar em cópia V7 isolada; revisar o relatório e conservar a fonte aprovada.
2. Em janela autorizada sem edição do operador, parar **somente API FUNIX**, fazer backup V7 com o comando existente e guardar cópia externa protegida. Colocar a fonte em `/var/lib/funix/app-data/.import-source.json`, UID/GID 1000 e 0600, fora do Git; o volume existente a apresenta como `/data/.import-source.json`. Não substituir o banco por arquivo de teste.
3. Usar o Compose/imagens aprovados já instalados (não reinstalar infraestrutura). Exemplo dos comandos de carga, executados com as permissões administrativas já existentes:

```bash
docker compose -p funixapp --env-file /var/lib/funix/current.env -f /opt/funix/compose.yaml stop api
docker compose -p funixapp --env-file /var/lib/funix/current.env -f /opt/funix/compose.yaml run --rm --no-deps api node server/backup.ts /data/backups/pre-import-v7.sqlite
docker compose -p funixapp --env-file /var/lib/funix/current.env -f /opt/funix/compose.yaml run --rm --no-deps api node server/import-coda.ts --source /data/.import-source.json --database /data/funix.sqlite
```

4. Guardar/revisar o relatório produtivo privadamente. Após autorização explícita para o plano efetivo, usar o valor de `planHash` do dry-run anterior:

```bash
docker compose -p funixapp --env-file /var/lib/funix/current.env -f /opt/funix/compose.yaml run --rm --no-deps api node server/import-coda.ts --source /data/.import-source.json --database /data/funix.sqlite --confirm-plan HASH_DO_DRY_RUN
docker compose -p funixapp --env-file /var/lib/funix/current.env -f /opt/funix/compose.yaml up -d --no-deps api
```

5. Conferir `/api/ready`, Configurações e composição de um teste aprovado pelo proprietário; não confundir isso com homologação comercial. Guardar o relatório final. Na repetição, novo dry-run deve mostrar zero inserções. Não tocar nos demais serviços.

Falha antes do commit: rollback automático do SQLite, sem trocar arquivos. Recuperação manual após aplicação confirmada: API parada, preservar arquivo atual e restaurar **backup V7 pré-carga** pelo procedimento de backup existente; conservar o estado atual para análise. Não restaurar sobre banco aberto nem misturar journals. Nenhum desses comandos foi executado na VPS por esta entrega.

## Testes e evidências

- `npm run check`: build, typecheck frontend/backend/coletor, **84 testes Node aprovados**, zero falhas; quatro avisos de lint preexistentes em `src/App.tsx`.
- `python3 -m unittest discover -s deploy/tests -v`: **23 testes aprovados**; nenhum script/workflow de deploy alterado.
- `python3 tests/browser/issue18_import.py`: **6 grupos desktop/mobile aprovados**, API real em loopback, SQLite descartável e cadastros sintéticos. Exercita Configurações, relações, autosave, parâmetros, preço, energia/prazo, recarga e MR não inventado. O teste de seleção de MR acrescenta um valor explicitamente sintético via manutenção já existente, não pela importação.
- Três casos parametrizados de Montagem/dimensões diferentes: preço unitário e energia V7 comparados a expressões somente leitura no Coda, resolvendo os valores por IDs reais. Todos iguais, com quantidade 1, escala 1, FC/FR reais e tabela raiz. **Não são comparação de orçamentos de clientes nem prova para regras pendentes/quantidades fracionárias.**
- Regressões: dry-run sem alterar bytes do arquivo, backup/cópia V7, 163 peças preservadas, Atendimento/cenários/versão emitida/PDF preservados, reinício, repetição sem atualização, conflito de cadastro/nome/inativação, hash obsoleto, rollback de falha, integridade/FKs, referências quebradas, sentinela, percentuais, FC/FR condicionais, energia negativa/divergente, fórmulas alteradas, precisão lexical e exportador GET-only paginado.

Resultados e screenshots sintéticos: [evidências](evidencias/issue18/COMANDOS.md). Exportações reais, preços brutos, banco/backup, credenciais e dados de clientes **não integram o PR**.
