# Issue #70 — hipótese de descoberta focalizada (experimento V2)

**Estado:** proposta em branch isolada, aguardando CI e revisão. Não há merge, deploy nem consulta paga autorizados por esta PR.

## Evidência observada

A segunda consulta P01 (Volkswagen Gol 2019, farol dianteiro esquerdo) em 07/11/2026 devolveu `status=empty`, `proposedOffers=0`, `acceptedOffers=0`, `rejected=0`, `usableSources=2`, `usableCitations=0`, `webSearchCalls=1`, 9.158 tokens de entrada, 567 de saída, 4.223 ms e custo estimado de US$ 0,01942. Ledger passou de 1/10 a **2/10**. A telemetria comprova que o modelo não estruturou ofertas: **não comprova** que as duas URLs contivessem preços unitários ou compatibilidade suficiente.

## Hipótese de trabalho, não resultado confirmado

A busca com `search_context_size=low` e instruções que priorizam três classes pode reduzir a oportunidade de identificar uma oferta unitária concreta, mesmo quando há fontes consultadas. Investigar com um único experimento focalizado, sem relaxar requisitos de evidência, é preferível a repetir às cegas. A ausência de `url_citation` também pode limitar a aceitação: a variante proposta continua exigindo citações e não resolve, por si só, incompatibilidades do formato de saída estruturada com annotations.

## Mudança opt-in e isolada

`FUNIX_QUOTE_DISCOVERY_V2=true` (backend, padrão `false`) muda **apenas**:

- Instruções ao modelo: buscar primeiro **um** anúncio unitário do componente e veículo específico, contendo preço total, condição, lado e compatibilidade; completar outras categorias apenas com evidência independente, sem fabricar opções.
- Contexto de busca de `low` para `medium` dentro da **mesma chamada única** de web_search.

A mudança **não altera**: modelo, teto de 4.096 tokens de saída, `max_tool_calls=1`, ausência de retries, ledger persistente, teto global de dez reservas, schema estruturado, comprovantes/citações obrigatórios, allowlist HTTPS, validações, seleção/aplicação ou UI. Não amplia busca para todas as lojas nem integra uma nova API. O contexto médio pode mudar custo e latência; o controle de orçamento atual permanece, mas **a estimativa real dependerá do usage e cobrança**.

## Critério de aceitação do experimento

Rodar primeiro testes offline com transporte mockado verificando: V2 off reproduz `low` + prompt original; V2 on usa `medium` + prompt focalizado; modelo/tool/ledger/schema e demais invariantes idênticos; sem relaxar validação para preço zero, lado errado, ano inválido, fonte fora da allowlist, categoria/condição não comprovada.

Somente após revisão, CI e autorização independente de merge/deploy/ativação: executar **uma única** nova pesquisa P01 sintética com ledger original (antes do teste 2/10), colhendo o mesmo conjunto de métricas agregadas. Resultado útil mínimo: `proposedOffers>0`, seguido de preço aceito apenas se autenticidade e compatibilidade forem verificáveis manualmente no link. Se a V2 retornar `proposedOffers=0`, registrar hipótese refutada/inconclusiva e **não repetir automaticamente**. Considerar parar o piloto ou trocar arquitetura de coleta de evidência antes de consumir reservas adicionais.

Rollback: retirar `FUNIX_QUOTE_DISCOVERY_V2` ou definir `false` no runtime protegido e recriar somente a API pelo Compose; preservar ledger, flag geral e logs históricos. Desativar métricas ao terminar. Não publicar textos completos de prompts/URLs, credenciais, preços de clientes ou logs brutos.
