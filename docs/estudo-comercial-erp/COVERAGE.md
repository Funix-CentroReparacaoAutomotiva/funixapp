# Cobertura estrutural do ERP FUNIX

Auditoria de metadados em 21/10/2026 no documento **Funix**, ID `2zsjI-nqWr`. Operação exclusivamente de leitura. Não foram executados botões, alterações, mensagens, webhooks ou processos financeiros.

## Resultado exato

| Objeto | Cobertura |
| --- | ---: |
| Páginas reportadas pelo documento | 202 |
| Páginas enumeradas pelo outline | 202/202 |
| Páginas com leitura de `contentTypesToInclude: tables` bem-sucedida | 202/202 |
| Falhas de página persistentes após retry | 0 |
| Ocorrências de tabelas/views nos canvases de página | 236 |
| IDs de tabelas-base `grid-*` com schema coletado | 164 |
| IDs de views `table-*` com schema coletado | 72 |
| Colunas nas 164 tabelas-base | 1.691 |
| Colunas com fórmula | 654 |
| Fórmulas de valor padrão | 115 |
| Colunas do tipo botão | 175 |
| Botões com `actionFormula` presente nos metadados | 171 |
| Lookups | 334 |
| Lookups sem tabela-alvo observada | 4 |
| IDs reais de base encontrados pela expansão de referências | 175 |
| Referências a bases não encontradas no documento | 11 |
| IDs sintéticos de opções de select list excluídos da fila de tabelas | 14 |

As 164 tabelas-base foram observadas diretamente em `tableUri` de páginas; não foram inventadas por inferência de nome. O total anterior de 136 correspondia somente às bases com o campo `baseTableId` explícito nas capturas, e não ao total de IDs `grid-*`.

As 72 views foram deduplicadas por ID. Em 21, a origem da base veio explicitamente de `sourceTableUri/baseTableId`. Nas outras 51, a origem foi associada à única base com o mesmo conjunto completo de IDs de coluna. Essa inferência está marcada por `baseResolution: unique-full-column-id-set`. Nenhuma view ficou sem associação; essa associação estrutural não substitui a verificação dos IDs na API REST do aplicativo.

## Procedimento e rastreabilidade

1. O outline foi paginado até obter as 202 páginas, preservando páginas ocultas e a árvore.
2. Cada página foi consultada para metadados de tabelas, sem ler o corpo markdown ou linhas pessoais.
3. Falhas transitórias foram repetidas; o lote de 36 falhas iniciais foi integralmente recuperado. Uma falha nunca foi convertida em página sem tabelas.
4. Foram unidas capturas de página, as 48 capturas anteriores e os schemas complementares dos estudos de handoff/catálogos.
5. As bases e views foram deduplicadas por ID; colunas, tipos, fórmulas, botões, defaults e destinos de lookup foram unidos por ID de coluna.
6. IDs de tabelas referenciadas em fórmulas, ações, filtros e metadados de lookup foram expandidos até não restar base acessível desconhecida. IDs sintéticos `-select-list-` foram separados de tabelas reais.
7. As 11 referências que não resolveram foram tentadas com formatos/views, schema slim e retry. Todas retornaram erro explícito `TABLE_NOT_FOUND` no documento atual.

Arquivos principais:

- `catalog.json`: outline integral, estado da leitura por página, IDs de tabelas por página e números de cobertura.
- `schemas.json`: 164 schemas de base, 72 de view, colunas, tipos, destinos, estrutura das fórmulas/ações/defaults, fontes e referências.
- `unresolved-references.json`: consumidores das 11 referências não encontradas.
- `pages/<pageId>.json`: evidência sanitizada por página.
- `tables/*ERROR.json` e `tables/closure-*.json`: evidências de tentativa dos IDs não resolvidos.
- `occurrences.json`: origem das capturas usadas na consolidação.
- `consolidate.py`: consolidação local reproduzível, sem chamadas de escrita remota.

Os arquivos canônicos mascaram literais de string, URLs e rótulos de referência a linhas nas fórmulas. Preservam IDs, referências e estrutura dos operadores. Portanto não contêm uma cópia literal irrestrita das fórmulas produtivas ou segredos embutidos; são suficientes para examinar dependências, e os contratos relevantes devem ser relidos de forma controlada antes de implementação.

## Referências não encontradas

| ID | Consumidores observados na estrutura das fórmulas/ações |
| --- | --- |
| grid-37H74MPJbw | db_VinculoFiscalFinanceiro; ux_GerarFatura |
| grid-3LWgdKRekS | ux_AgendamentoRetrabalho.Concluir |
| grid-5qGokqACe8 | db_Veiculos.Peças |
| grid-CzzihqVX9k | db_lavInspecao.Responsavel |
| grid-DqEYcFqj22 | aux_WaterfallDRE; db_DRE |
| grid-JWh31vOUHZ | bib_CorCarros.bib_Tintas |
| grid-ewMKgS9sYE | DRE; extratos financeiros |
| grid-g0dV39pwlH | db_lavSrvAprv |
| grid-jN0aicolhn | db_LavQuitacao.Seguradora |
| grid-okv7g2PTxH | aux_Fatura.Faturar |
| grid-wk3iZouYL5 | aux_Fatura e outros consumidores financeiros/legados |

Essas referências aparecem na estrutura não comentada das fórmulas ou nos destinos de lookup observados. Isso é evidência de dependência que não resolve no documento auditado. Não demonstra que todo processo consumidor seja usado hoje ou esteja falhando em execução. Também não distingue tabela removida, ID inválido ou eventual limitação de acesso; não houve tentativa de reparar nada em produção.

## Metadados incompletos ou ausentes

Quatro botões foram observados sem `actionFormula`:

- db_Atendimentos.retrabalho_Agendar — c-gPBfwY5i4a.
- ui_AtendimentoModal1.DiagnosticoPadrao — c-iVXbEvnKfU.
- ux_inspecaoTecnica_Rejeitar.Rejeitar — c-Xblb-7hqa7.
- ux_inspecaoTecnica_Rejeitar.Cancelar — c-K8vu8QzQ1H.

Não foram executados para tentar descobrir um comportamento. A ausência é uma característica dos metadados lidos, sem presumir implementação funcional.

Os quatro lookups sem alvo são campos **Sync account** em tabelas de exemplos de sincronização: Best by Month (Extra Header), Meeting Notes Archive, People (Extra Header) e People (Without Header). Não foram tratados como relações de negócio FUNIX com destino presumido.

Nenhuma coluna retornou erro de fórmula no campo de erro dos schemas coletados. Isso não equivale a testar o resultado de todas as fórmulas ou ações.

## Limites da completude

A cobertura é **integral dos metadados tabulares expostos nas 202 páginas e das referências de base alcançáveis**, com as 11 lacunas explicitadas. Não é uma certificação funcional integral do ERP.

Não foram auditados nesta varredura:

- Conteúdo de linhas, arquivos anexos ou cell-canvases, para evitar leitura desnecessária de dados pessoais.
- Controles independentes e fórmulas fora de tabelas nos canvases de página.
- Regras internas de automação do Coda ou configuração privada de autenticação dos Packs, não expostas por este inventário.
- Histórico de execuções de todos os botões e processos, concorrência, idempotência, efeitos externos e permissões reais de cada usuário.
- Disponibilidade de cada integração externa; a investigação de n8n está documentada separadamente.
- Equivalência dos identificadores do conector com os IDs da API REST pública, que exige probe autenticado em runtime.

As ações de criação/revisão de orçamento, agendamento normal, agendamento de retrabalho, geração de OS e integrações foram analisadas estaticamente nos relatórios de domínio, sem dispará-las. A opinião de arquitetura deve diferenciar o comportamento codificado observado, o comportamento realmente executado e a proposta de mudança futura.

