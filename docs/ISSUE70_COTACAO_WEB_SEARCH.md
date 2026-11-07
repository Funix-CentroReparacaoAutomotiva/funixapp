# Issue #70 — piloto isolado de cotação com OpenAI web_search

Data de referência: 06/11/2026, America/Sao_Paulo. Base: main `5351ab8ea4c53ae4dff4e33d7a638c26a49cb059` (PR #68). Branch independente `feat/issue70-cotacao-web-search`; não inclui a investigação da branch PR #69.

**Entrega:** provider Responses separado da interpretação, endpoint autenticado, controle persistente de tentativas/custo, harness de dez casos, protótipo compacto explicitamente habilitado apenas no servidor de teste e testes de contrato/HTTP/navegador. O startup normal continua sem cotação; `NODE_ENV=production` bloqueia o endpoint mesmo com serviço injetado.

**Execução real pendente.** O runtime da sessão reportou `observations_current=true`, nenhum segredo/variável OpenAI configurado e rede restrita sem `api.openai.com`. Não procuramos chave em arquivos, não carregamos `.env`, não modificamos `OPENAI_API_KEY`/produção/rede e não realizamos chamadas OpenAI pagas. Essa condição está expressamente prevista na [Issue #70](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/70): entregar harness/mock testado quando não houver credencial autorizada. A pesquisa documental desta sessão não é o experimento Responses nem foi usada como substituto de suas métricas.

## Decisão

**GO para revisão técnica do harness e posterior execução controlada em ambiente com credencial já autorizada e conectividade apropriada. Decisão de utilidade comercial/produção pendente.** Não há evidência real para declarar que web_search resolve as dez peças, afirmar precisão, latência ou economia humana. Não se propõe automaticamente fallback manual como solução final: a hipótese aprovada de pesquisa com OpenAI continua a ser avaliada. Produção, merge, deploy e habilitação para vendedores permanecem fora desta autorização.

## API e custos documentais

Fontes oficiais verificadas:

- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search): ferramenta `web_search` na Responses API; `tool_choice` específico exige a busca; `include: ["web_search_call.action.sources"]` disponibiliza proveniência. Citations e sources têm papéis distintos. Preferências de loja estão no prompt, sem seis requisições por marca.
- [Create response](https://developers.openai.com/api/reference/resources/responses/methods/create): `max_tool_calls` limita conjuntamente as ferramentas embutidas, ignorando tentativas adicionais. O piloto envia `max_tool_calls:1`, uma ferramenta, `parallel_tool_calls:false`, sem retry, sem background e `store:false`.
- [GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini): snapshot escolhido `gpt-5.4-mini-2026-03-17`, suporte documentado a Responses, web search, structured outputs e reasoning baixo; contexto 400.000. Preços padrão de entrada US$0,75/milhão e saída US$4,50/milhão. A escolha é específica para cotação e não muda modelos de voz.
- [Pricing](https://developers.openai.com/api/docs/pricing): web search US$10/1.000 chamadas mais tokens de conteúdo de busca nas taxas do modelo. A página `platform.openai.com/pricing` não retornou texto legível na ferramenta; usamos a tabela oficial Developers. Tarifas devem ser reconfirmadas antes da rodada real; disponibilidade do snapshot/combinação schema+citations não foi testada com credencial.

Não se inferiu que o simples `max_output_tokens` limita todo custo de busca. A reserva conservadora usa o contexto completo do modelo, saída e ferramenta: `400000 × 0,75/1e6 + 4096 × 4,50/1e6 + 0,01 = US$0,328432`, arredondada para **US$0,33 por tentativa**. Dez tentativas reservam no máximo **US$3,30 no envelope documental usado**, sem impostos/câmbio. A hipótese não é cobrança medida nem autorização de alterar modelo/preço: mudança de tarifa/modelo exige revisar o envelope antes de executar.

Para consumo observado: `estimatedUsd = input_tokens × 0,75/1e6 + output_tokens × 4,50/1e6 + web_search_call_count × 0,01`, sem presumir desconto de cache. Incluir tokens de conteúdo de busca na entrada conforme faturamento do fornecedor e reconciliar usage/fatura. Não somar uma segunda parcela de tokens da busca se já estiver em usage. Em timeout/erro sem usage o custo fica **desconhecido**, nunca zero; a reserva não é devolvida. Exemplo puramente aritmético de 3.000 tokens de entrada e 1.000 de saída com uma ferramenta: US$0,01675/clique, US$16,75/1.000 cliques sem cache. Não é resultado do piloto.

O teto é por **tentativas de requisição**, até dez, o que é conservador para o máximo de dez buscas iniciais autorizado. `web_search_call` real é contado por resposta; zero, dois ou mais, status incompleto ou ação incompatível não são aceitos. Multiplicação inesperada dispara bloqueio do provider para o resto da instância. Subconsultas internas de uma ferramenta são distintas de chamadas faturáveis; o prompt pede uma única busca, mas não alegamos granularidade de controle sobre a estratégia interna do fornecedor.

## Contrato e isolamento

O arquivo `server/voice-provider.ts` não foi alterado. O prompt de voz continua sem ferramentas e sem pesquisa de preço. O serviço de cotação só é chamado por `POST /api/atendimentos/:id/copiloto/cotar` após autenticação, mesma origem, JSON limitado e habilitação explícita no harness. Voz, reload, edição e obtenção de capacidade não disparam busca. `GET /api/cotacoes/capacidade` só informa disponibilidade; não consulta modelo.

Entrada do endpoint:

```json
{"scenarioId":"emitido pelo servidor","resolutionId":"revisão vigente","commandId":"componente desse lote"}
```

Não aceita consulta montada pelo cliente, preço, nome livre, URL ou alteração comercial. O backend lê a revisão efêmera da mesma sessão/cenário, encontra o comando `add_component` e o pai resolvido e projeta DTO fechado:

```json
{"brand":"volkswagen","model":"gol","year":2019,"component":"farol dianteiro esquerdo","parent":"parachoque dianteiro","side":"esquerdo"}
```

Marca/modelo e termos técnicos usam vocabulário controlado. Campos `name`, `phone`, `plate`, VIN/chassi, notas, motivo, áudio/transcrição, IDs de negócio e textos livres não são enviados ao provider. Conteúdo suspeito/termos não suportados bloqueiam a consulta. Ano só sai quando houver exatamente um ano explícito em modelo/veículo; ano não é inferido do modelo, VIN ou contexto. Versão/motorização não são extraídas nesta versão; isso reduz cobertura e deve ser explicitado na decisão comercial. Ambiguidade de lado em farol/maçaneta/vidro/guia produz `needs_details`, sem ferramenta. Ano ausente pode ir como null; o filtro não aceita oferta sem aplicação suficiente.

Retorno: `status`, até três ofertas, `observedAt`, `expiresAt`, `cached`. Cada oferta conserva categoria, preço decimal, URL, condição, origem e trecho de sustentação pública. O frontend mostra somente ícone+valor/traço; metadados não viram cartão ou ressalva. O provider retorna métricas para observador agregado, separado da UI/clipboard.

O endpoint revalida revisão/contexto e revisão do veículo depois da espera e verifica sessão ainda válida. Não escreve banco comercial. Mudança de revisão, Apply concluído, expiração ou encerramento de sessão impedem consumo de resposta atrasada.

## Sustentação e filtros

O resultado só é considerado após `web_search_call` concluído com ação search, usage válido e uma mensagem JSON sem recusa. Uma URL de oferta deve estar **tanto em sources da ferramenta quanto em url_citation da mensagem**; não basta existir no texto do modelo. Não há fetch/scraping direto dos anúncios.

O contrato pede preço positivo em BRL, unidade, total, condição/origem, aplicação e trecho curto exato da fonte. O validador confere preço numérico contra `priceText` no trecho, peça/qualificadores técnicos no título, lado, frente/trás, marca/modelo e intervalo de aplicação. Exclui kit/par, subcomponente, avaria, parcela, faixa, promoção condicionada, zero sentinela, HTML e URL sem origem/citação. A allowlist do piloto contém anúncios diretos ML, Peças VW, Mecânico Renault, Jocar, Connect Parts e Autoglass; pertencer à allowlist **não** implica fornecedor autorizado ou originalidade. URLs com parâmetros/credenciais/porta/fragmento, listagens, vitrines, agregadores e esquemas não HTTPS são rejeitadas conservadoramente.

Original nova exige condição nova, origem original e evidência citada de canal oficial/genuinidade com a marca. Equilibrada conserva usada/paralela e exige trecho de qualidade/procedência. É uma checagem mínima do conteúdo extraído pelo modelo, **não autenticação independente de peça genuína, certificação de qualidade ou garantia de compatibilidade**. Um modelo pode extrair incorretamente um trecho ou intervalo; é precisamente o risco a avaliar na rodada real. Não se afirma que citation ou source prova estoque, preço atual ou que o link abre hoje. Redirect final do comerciante não foi verificado; o servidor não resolve URLs nem executa JavaScript das fontes.

Links da direção são preferência soft no prompt. Faltando prova, retorna `—` em vez de forçar classe/originalidade. O mesmo anúncio não é uma prova estatística de que haverá três categorias diferentes.

## Limites operacionais implementados

- Provider real só pode ser construído explicitamente pelo harness; `server/index.ts` não o instancia por variável ou por presença de chave. O endpoint normal fica desabilitado; ambiente production bloqueia inclusive injeção.
- Uma requisição Responses por tentativa, uma ferramenta no máximo, saída até 4.096 tokens incluindo reasoning, resposta até 512 KiB, sem retries ou nova chamada para completar JSON/citação. Falha permanece falha.
- Ledger de arquivo local com lock exclusivo, fsync e reserva antes do transporte; reabrir o provider ou reiniciar o processo não zera contagem no mesmo ledger. Erro/timeout não devolvem reserva. Registro corrompido, lock pendente ou ledger sem autorização de escrita falham fechado. Uma única rodada deve usar o mesmo arquivo, nunca ser reiniciada por novo caminho para ampliar o teto. Não há limpeza automática de locks após crash.
- Serviço tem teto global de até dez tentativas por instância, timeout padrão 20 s configurável até 30 s, abort por desconexão e descarte de retorno tardio mesmo se o mock ignorar AbortSignal. O abort local não garante que o fornecedor não tenha cobrado.
- Cache transitório até dez minutos por DTO normalizado e sessão autenticada, com até 100 entradas. Cliques concorrentes equivalentes compartilham uma operação. Usuários/sessões não compartilham cache. Expiração/stale não são contornadas pelo cache.
- Observabilidade usa durações, tokens, contagens, rejeições, status e custo estimado; não loga payloads, consultas, fontes brutas, segredo ou sessão. Erros do transporte são sanitizados. Nenhum desses valores entra no export de diagnóstico de voz.

## UX e confirmação final

Preservada a linha da PR #68: switch, quantidade, preço unitário base e receipt-text. No harness habilitado, o botão revela três opções compactas (carteira/balança/escudo), somente ícone+preço ou traço. Categoria fica no `aria-label`/tooltip; ausente é desabilitada e acessível como “não encontrado nesta consulta”. Não há texto visível de aproximação ou cartão de metadados. Link externo separado, com nome acessível, `noopener noreferrer` e SVG discreto.

Selecionar preço executa **um** `POST /copiloto/revisar`, usando revisão vigente e quantidade do rascunho. Retorno substitui apenas plano efêmero; não chama Apply. A revisão existente invalida a chave anterior, preservando suas proteções. Trava síncrona impede duas seleções simultâneas. Edição manual posterior prevalece; versão local da edição impede apagar rascunho mais novo. Mudança de resolução remonta estado de cotação vazio e aborta consulta antiga. Digitação cancela busca pendente e limpa opções; resposta atrasada não preenche preço. `Aplicar alterações` continua sendo o único caminho de gravação. MR, fatores, cálculo, histórico, snapshots e PDF não foram modificados.

## Dez casos preparados e resultados reais

Os dez registros estão em [real-pending.json](evidencias/issue70/real-pending.json). Para **cada linha**, latência real, tokens, quantidade de ferramentas, custo faturado/estimado, URLs reais por preço e qualidade de referência são **N/D — execução real pendente**. Houve **zero chamadas pagas nesta sessão**. Campo null indica não medido, não zero de consumo de um serviço que foi executado.

| ID | Veículo sintético | Componente | Verificação planejada |
|---|---|---|---|
| P01 | Volkswagen Gol 2019 | Farol dianteiro esquerdo | Lado/geração; genuína versus paralela |
| P02 | Volkswagen Polo 2020 | Para-choque dianteiro | Cobertura versus travessa/guia |
| P03 | Fiat Uno 2014 | Maçaneta externa dianteira direita | Lado/posição/acabamento |
| P04 | Chevrolet Cobalt 2016 | Vidro porta dianteira esquerda | Vidro móvel versus fixo/regulador |
| P05 | Hyundai HB20 2017 | Guia para-choque dianteiro direito | Geração/lado/unidade versus par |
| P06 | Fiat Mobi 2020 | Presilha de fixação para-barro | Fixador correto versus quebra-sol/kit |
| P07 | Ford Ka 2018 | Farol dianteiro esquerdo | Geração e tecnologia |
| P08 | Jeep Compass 2020 | Para-choque dianteiro | Versão/combustível, cobertura superior/inferior |
| P09 | Fiat Argo, ano ausente | Maçaneta externa dianteira direita | Não inventar ano; abstenção se não houver aplicação suficiente |
| P10 | Jeep Renegade 2019, lado ausente | Farol dianteiro | Bloquear busca até esclarecer lado |

[mock-results.json](evidencias/issue70/mock-results.json) comprova execução offline do pipeline: oito ofertas **fictícias de teste**, um vazio sem ano e um bloqueio sem lado. O preço R$39,90 e a URL contendo `MLB-0000000000-fixture-sintetica` são fixtures, **não preços encontrados nem fontes reais**. Tokens/latência do mock não representam OpenAI; `simulatedUsage` está rotulado e não entra na análise comercial. Frequência offline: 22/30 posições sem valor por construção da fixture, não cobertura de mercado. Não calcular p50/p95 real a partir disso. Não há comparação de preço entre fornecedores ainda.

Pesquisa manual preparada: cada caso saneado inclui uma URL de pesquisa externa pronta no registro, para uso por operador em rodada posterior. Qualitativamente, dispensa extração/classificação por modelo, mas exige conferência de compatibilidade e condição e digitação do preço; o piloto tenta reduzir esses passos. **Não foi cronometrado cotador humano**, logo não se declara economia de tempo ou ROI.

## Como reproduzir

Node 24 e dependências normais do repositório. Sem configuração adicional, somente testes e simulação:

```sh
npm run check
node scripts/quote-pilot.ts --out work/quote-mock.json
node scripts/quote-pilot.ts --live --out work/quote-real-pending.json
FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/quote-pilot-browser.mjs
```

Criar `work/` antes dos dois arquivos se necessário. O comando `--live` **não faz requisição** a menos que todos os gates estejam presentes: ambiente não production, `FUNIX_QUOTE_PILOT_LIVE=authorized`, `OPENAI_API_KEY` já autorizada/configurada e `FUNIX_QUOTE_LEDGER` apontando para registro persistente local exclusivo desta rodada. Não imprimir chave, movê-la, procurar `.env` ou injetar segredo para tentar destravar o piloto. Este relatório não é autorização para executar em produção nem contratar/criar credenciais. O caminho do ledger tem de ser mantido entre reinícios e entre harnesses da mesma rodada.

O script de navegador usa o módulo Playwright já disponível no ambiente de desenvolvimento e Chromium local. Na sessão foi usada a instalação disponibilizada pelo executor, sem alterar package.json/lockfile. O app do harness usa SQLite `:memory:`, áudio PCM sintético e provider injetado. Não instalar dependência paga nem reutilizar banco local instalado.

## Testes e evidências

- `npm run check`: **562/562 testes aprovados**, zero falhas/ignorados; build frontend, tipos backend e lint concluídos. Avisos legados de lint permanecem nos arquivos existentes; build/lint repetidos após ajuste final do ciclo de vida da UI.
- Doze testes novos em `server/tests/component-quote.test.ts`: DTO/PII/ano/lado, ausência de busca/citação/usage, JSON inválido/recusa/incompleto, URL/XSS, aplicação/preço/kit/parcela/condição, teto persistente inclusive após recriar provider, corpo grande/429, cache concorrente por sessão, timeout e descarte, auth/origem/ownership/shape, revisão sem escrita e invalidada, expiração/stale e bloqueio em production.
- [Resultados de navegador](evidencias/issue70/browser/results.json), **320/390/1440**: microfone/MediaRecorder nativos com áudio sintético; nenhuma busca durante voz; receipt-text por teclado; três opções compactas; link separado; sem overflow da linha; seleção faz uma revisão e zero Apply; banco inalterado até confirmação; digitação/revisão manual e resposta de cache atrasada não sobrescrevem edição; clipboard não exporta preço/fonte; Apply final explícito grava preço manual prevalecente.
- Screenshots: [320](evidencias/issue70/browser/offers-320.png), [390](evidencias/issue70/browser/offers-390.png), [1440](evidencias/issue70/browser/offers-1440.png). Somente a área afetada do piloto, com fixture sintética.
- Regressão `voice-components-browser.mjs` com cotação desabilitada, em 320/390/1440: **aprovada**; [resumo de validação](evidencias/issue70/validation.json). Não foi utilizado dispositivo móvel físico nem leitor de tela real; semântica acessível e teclado foram exercitados no Chromium.

Logs de execução em `work/` da sessão; evidências reduzidas no repositório. Nenhum segredo, áudio de cliente, banco real ou payload de cliente foi publicado. Não há migração, nova dependência, mudança de workflow, versão do provedor de voz ou configuração de produção.

## Pendências para decisão da direção

Antes de optar pela integração definitiva: rodar a amostra com credencial autorizada e mesmo ledger dentro do teto; reconciliar `web_search_call`, usage e faturamento (especialmente erros/timeout); revisar fontes reais por peça/lado/versão e genuinidade; medir latência fim a fim e campos ausentes; conferir combinação atual de schema estrito com citations; comparar qualitativamente com pesquisa manual ou cronometrá-la explicitamente. A presença de source+annotation não substitui a revisão técnica independente.

O saneador e a allowlist deliberadamente limitam cobertura; nomes/versões/OEM adicionais precisam de desenho revisado sem vazamento de texto livre. A condição de preço unitário total e a prova de originalidade ainda dependem da qualidade de extração do modelo. Dez amostras não demonstram confiabilidade estatística. Esta PR deixa a prova executável e segura para revisão; não antecipa o resultado comercial nem ativa o recurso.
