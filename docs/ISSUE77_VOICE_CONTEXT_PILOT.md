# FUNIX — Issue #77 · piloto opt-in de redução do contexto do Copiloto

## Hipótese e fundamento
Em amostra operacional de 07/11/2026, quatro interpretações Terra reportaram 34.456, 34.460, 34.461 e 34.932 tokens de entrada. Em todas, 3.122 tokens vieram do cache. A maior parcela dos custos estimados está na entrada não-cacheada, mas os logs não isolam as parcelas de schema, instruções, catálogo, cenário e recomendações.

O `modelVoiceContext` transmite recomendações de diagnóstico e intensidade para o modelo, mesmo que o schema de saída **não tenha operação de executar uma recomendação**. As regras de recomendação são consumidas no planejador determinístico, que recebe o contexto completo obtido de `readVoiceContext`.

## Experimento reversível
- Padrão: `FUNIX_VOICE_CONTEXT_MODE` ausente => `standard`, sem mudança na requisição atual.
- Somente com `FUNIX_VOICE_CONTEXT_MODE=omit_recommendations` no backend, remover do **prompt do modelo** a propriedade `recommendations`. Não modificar catálogo, peças, pares, contexto de planejamento, políticas, diagnósticos, schema da resposta, instruções ou fluxos de revisão/confirmacão.
- Nenhuma ativação ou deploy é parte desta PR. Após aprovação e autorização operacional, testar em ambiente de homologação com dados não sensíveis, logs de tokens opt-in já existentes e conjunto de casos iguais ao baseline.
- A remoção deve reduzir bytes do JSON enviado ao provedor; **bytes não equivalem diretamente a tokens nem a economia de fatura**. Confirmar diferença de `usage.input_tokens`, cache, qualidade do plano, latência e custo na conta.

## Critérios para manter ou reverter
1. Testes sintéticos confirmam que `compact === standard` menos uma propriedade e que o planejador continua contendo as recomendações.
2. Casos de resolução ambígua, diagnóstico/intensidade e recomendações automáticas preservam comportamento; toda aplicação continua exigindo confirmação humana.
3. No piloto real autorizado: comparar ditados pareados com o mesmo estado do catálogo, mesmos modelos, esforço e condições; avaliar economia após cache e cobrança; parar se houver piora semântica ou falhas de segurança.
4. Reversão: remover a variável ou definir `standard` e recriar apenas a API de forma controlada. Não altera schema ou banco.

**Fora do escopo:** UX/ordem de opções, mudar Terra ou Transcribe, trocar esforço de raciocínio, resumir nomes/IDs, selecionar peças heurísticamente, cobrança web, migração e alterações financeiras/operacionais.

**Estado:** hipótese/implementação experimental em PR, não economia comprovada.
