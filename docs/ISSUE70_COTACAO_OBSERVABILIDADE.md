# Issue #70 — observabilidade segura do piloto de cotação

**Estado:** instrumentação proposta para revisão. Não há autorização implícita para merge, deploy ou consultas adicionais.

## Contexto

O P01 sintético (Volkswagen Gol 2019, farol dianteiro esquerdo) retornou `status=empty` e ledger com 1/10 reservas. A versão anterior não registra quantas ofertas foram propostas nem os motivos de rejeição. **O ledger não permite recuperar esses dados retroativamente**, pois registra apenas reservas.

## Instrumentação

A variável `FUNIX_QUOTE_METRICS_ENABLED=true` no backend, desativada por padrão, habilita uma linha `funix_quote_metrics` no log do contêiner por execução não atendida por cache, após resposta ou erro. Nunca é enviada à interface.

Campos possíveis: `status` (código fixo), `elapsedMs`, `webSearchCalls`, `inputTokens`, `outputTokens`, `estimatedUsd`, `proposedOffers`, `acceptedOffers`, `rejected`, `rejectionReasons` e as contagens `usableSources`, `usableCitations` (somente número de fontes/citações com URL permitida, jamais URLs). `rejectionReasons` conta somente o **primeiro bloqueio por oferta**; portanto não deve ser lido como todas as incompatibilidades de cada anúncio.

A instrumentação não armazena nem registra dados de cliente, IDs, sessão, mensagens, voz, nome de peça, termo de busca, textos, anúncios, preços, links, fontes brutas ou segredo. Emitimos apenas códigos fixos e números limitados; erros de observação não afetam a cotação. Não altera modelo, prompt, pesquisa, resposta, filtros técnicos, limite de 10 reservas, cache, ledger ou gravação de orçamento.

## Interpretação operacional

- `proposedOffers=0`: o modelo retornou nenhuma oferta estruturada; não prova ausência de anúncios no buscador.
- `proposedOffers>0` e `acceptedOffers=0`: uma ou mais ofertas foram rejeitadas por filtros, e os motivos aparecem agregados no primeiro bloqueio.
- `status=QUOTE_*` com contagens/tokens `null`: dados desconhecidos por falha; não significa custo zero. Reserva permanece contabilizada.
- `estimatedUsd` é cálculo aproximado com uso informado pelo modelo, e não corresponde necessariamente ao valor efetivamente faturado pela OpenAI.

## Próxima validação

Após aprovação de CI e autorização separada para merge e deploy, considerar habilitação temporária da flag no runtime protegido, com revisão de acesso aos logs e sem compartilhamento de saídas brutas. Executar no máximo uma consulta sintética sob o ledger persistente original (atualmente 1/10); checar contagens agregadas, tempo e uso, comparando o faturamento efetivo no painel da OpenAI. Não repetir tentativa sem entender o resultado. Desabilitar a flag depois de concluir o diagnóstico.

O P01 anterior continua com zero preços aceitos e uma reserva. Qualquer número de propostas, fontes e rejeições atribuído retroativamente à primeira consulta seria especulação.
