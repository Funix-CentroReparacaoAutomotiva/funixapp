# Issue #77 — diagnóstico opt-in da dimensão do prompt do Copiloto

## Evidências e decisão
A primeira amostra real teve quatro chamadas Terra com ~34 a 35 mil tokens de entrada e 3.122 tokens reportados como cache em cada uma. A PR #85 propõe omitir somente as recomendações do modelo, preservando o planejador. A CI sintética da PR #85 mostrou redução de apenas **314 bytes em 38.376 bytes (0,82%) no fixture**; esse resultado **não mede tokens faturados nem o catálogo real**. PR #85 continua independente, em rascunho e **não deve ser integrada apenas por essa medição**.

## Implementação
`FUNIX_VOICE_FOOTPRINT_ENABLED=true` (backend, opt-in) produz no log `funix_voice_footprint` **somente** uma estrutura fixa com contagens e tamanhos em bytes UTF-8, antes da chamada de interpretação:

- bytes totais do JSON do request; bytes do conteúdo do input, instruções, schema de saída e contexto;
- bytes de catálogo, peças, regras de recomendação, pares físicos e revisões;
- número de itens do catálogo (utilizáveis/não utilizáveis), peças, conjuntos e regras de recomendação.

**Não registra** texto do ditado, nomes, códigos ou IDs do catálogo, registros do Atendimento, respostas do modelo, chaves, preços, telefone ou cliente. Os cálculos não mudam o corpo da requisição; erro de medição não impede o fluxo. Flag ausente/inválida = desligado. Não cria endpoint, banco, migração ou chamada externa extra.

A contagem de bytes de cada campo não é soma aditiva do corpo total: o JSON inclui wrappers, aspas, escapes, dupla serialização do campo `content`, nomes de propriedades e campos adicionais. O schema JSON e as instruções também podem ocupar tokens; a API pode ter cache e unidades de cobrança diferentes. **Não usar bytes como sinônimo de tokens ou custo.** Os logs de footprint não têm identificador de correlação com cada linha `funix_voice_usage`, logo agregados devem ser conferidos por janela isolada e comparados a `usage` do provedor.

## Plano de medição
1. CI com dados sintéticos e mocks deve demonstrar configuração opt-in, ausência de conteúdo sensível e request idêntico com flag ligada/desligada.
2. Mediante revisão/integração e autorização operacional, habilitar a flag **somente no ambiente de testes**, mantendo `FUNIX_VOICE_USAGE_ENABLED=true`, Terra atual, `FUNIX_VOICE_REASONING_EFFORT` ausente e `FUNIX_VOICE_CONTEXT_MODE` não ativada.
3. Executar **um** ditado fictício simples (sem aplicar alterações). Coletar apenas `funix_voice_footprint` e `funix_voice_usage` sanitizados, no mesmo intervalo, e conferir o resultado semântico na interface.
4. Identificar a parcela dominante do payload por bytes e definir uma hipótese técnica específica para redução; estimar efeito econômico real somente em teste controlado com cobrança/usage e checagem de qualidade.
5. Desabilitar flag caso concluída a avaliação. Preservar controles existentes de acesso/rotação de logs.

## Fora do escopo
Sem mudança de modelo, esforço, UX, compactação de catálogo, remoção de regras, alteração de prompts, despesas financeiras do ERP, segredos, deploy, ativação na VPS ou chamadas pagas nesta PR.

**Estado:** instrumentação experimental para orientar decisões; nenhuma economia comprovada.
