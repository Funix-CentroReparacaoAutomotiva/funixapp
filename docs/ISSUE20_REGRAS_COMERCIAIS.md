# Issue #20 — regras comerciais e carga técnica

Branch `feat/issue20-regras-comerciais`, derivada do PR #19 (`6af207f947d5a48e8427a8c3fe2c12514bfd4075`), ainda não integrado à main. Este PR depende do #19 e apresenta somente o delta de regras/carga/testes. Não há merge automático, deploy, alteração de Coda/VPS/workflow ou execução no banco produtivo.

## Auditoria anterior ao código e fontes

A Issue #20 e a confirmação de desconto da direção prevalecem sobre os trechos antigos de FC global e desconto indiscriminado. O fluxograma V0.9 continua governando a exceção exata e a Negociação; a V7 governa MR único. O relatório anterior do PR #19 descreve o importador conservador antes destas novas decisões; seus bloqueios de FC/FV não são as regras alvo desta entrega.

Já existiam base por serviço, FD por dimensão, fatores FV/FC/FR, aritmética exata, exceção por tripla, energia aditiva por etapa, capacidade/prazo, cenários, negociação/resíduo, MR global e snapshot/PDF imutáveis. Foram reaproveitados. Faltavam flags FC/desconto por serviço, seu editor/validação, o limite do modo Desconto e a adaptação do importador ao FV simplificado. As 24 dimensões técnicas pendentes exigiam investigação dos dados, não reconstrução do motor.

Nova coleta de leitura pelo procedimento versionado do PR #19, em `.runtime/issue20/`: 15 tabelas de configuração, 479 linhas, sem registros de clientes/Atendimentos. Esquemas/fórmulas e paginação foram preservados pelo normalizador existente. **Fonte atual confirmou FV Padrão 1, Parceria 0.8, Nosso time 0.6, Retrabalho 0.** Preços/configuração/exportação brutos não são versionados. Os cadastros são fonte dos valores; não se copiou a antiga arquitetura de herança/percentuais Coda.

## Implementação mínima

- `shared/pricing.ts`: campos opcionais por serviço `colorFactorEnabled`, `discountable`, `billable`; cálculo registra `discountEligibleSubtotal` e elegibilidade efetiva por linha.
- `server/pricing-config.ts`: valida booleans/null, preserva flags já gravadas quando PATCH legado as omite e mantém revisão/origem/autenticação existentes.
- `server/pricing-engine.ts`: FC condicional e limite do modo Desconto. Especial exato, FR no normal, arredondamento, quantidade, energia, prazo, Negociação e MR reutilizam o motor atual.
- `src/PricingEditor.tsx`: controles administrativos mínimos no serviço existente, com os mesmos estilos. Nenhum controle adicional na operação de Diagnósticos/Mapa. “Faturável” é informativo e separado de “Descontável”; não remove linha nem zera preço automaticamente.
- `server/coda-import.ts`: FV simples verificado na fonte, base raiz/FD únicos, flags de serviço e revisão explícita de FC divergente, associação técnica por IDs e relatório de problemas. Somente uma regra explicitamente `tabelado` e com chave exata pode ser carregada como especial; sentinelas não são expandidas artificialmente.
- Scripts/QA: matriz completa opcional, ensaio reproduzível em arquivo V7 novo e testes unitários/API/browser. Contrato atualizado em [API.md](API.md).

**Sem nova tabela, dependência, migração SQL ou versão de schema.** Os atributos cabem em `pricing_configuration.data`, já versionado por revisão. Nenhuma leitura de inicialização grava defaults ou recalcula versões emitidas. A V7 e a migração histórica de remoção do FCT continuam intactas.

## Regras efetivas e compatibilidade

| Assunto | Comportamento |
|---|---|
| Normal | `teto_R$0,05(base × FD × FV × FC_efetivo × FR) × quantidade` |
| FC false | FC efetivo 1; cor ausente não bloqueia |
| FC true | Exige FC selecionado/configurado válido |
| FC null | Decisão pendente, bloqueia somente o caminho normal |
| FC ausente em legado | Preserva FC global aplicado anteriormente; não cria aprovação de desconto |
| FR | Obrigatório no normal, inclusive com FV zero; não incide em componentes |
| Exceção exata | Ignora base/FD/FV/FC/FR, arredonda unitário antes da quantidade, mantém energia técnica normal e elegibilidade de desconto |
| Desconto | Somente até o subtotal original das linhas de serviço com `discountable === true`; preços unitários/linhas permanecem originais e D continua linha global |
| Desconto ausente/false | Sem permissão, inclusive para serviço sem configuração; zero permitido, qualquer positivo acima do elegível é bloqueado |
| Faturável | Atributo informativo independente; não implica descontável, exclusão, preço zero ou autorização operacional |
| MR | Único por Atendimento, somente componentes: `teto_R$0,05(manual × MR) × quantidade` |

O editor inicia **novas** configurações de serviço com FC pendente e desconto desabilitado. Omissão em PATCH legado preserva o valor existente, inclusive false/null. Strings `"true"`/`"false"` são rejeitadas. Apenas FC/faturável podem receber null. Configurações antigas sem flag de desconto precisam de autorização explícita no editor para concedê-lo; não se tornou todo o legado descontável por omissão.

Não foi criado rateio de desconto por linha: o contrato aprovado mantém preços calculados e registra uma linha D, agora limitada ao conjunto elegível. Serviços protegidos e componentes mantêm seus valores íntegros. Desconto superior ao elegível produz pendência e não emite, sem desconto silenciosamente truncado.

**Negociação é contrato distinto:** `adjust` continua usando todos os serviços, incluindo conciliação para baixo e aumento proporcional com teto/resíduo, sem negociar componentes. A confirmação da direção na Issue #20 limitou especificamente o modo Desconto; não se ampliou essa restrição para Negociação por inferência. O handshake de prévia/token/idempotência e a negociação pelo total geral (`valueIncludesComponents:true`) não foram alterados.

## Resultado da carga e pendências reais

Plano em V7 isolado: 119 cadastros comerciais (28 serviços, 75 dimensões, 16 diagnósticos), **26 serviços com base**, **73 dimensões com FD**, **51 dimensões com energia completa / 78 relações técnicas preservadas**, 22 serviços marcados descontáveis. FC: 12 habilitados, 13 desabilitados e 3 pendentes. Sem conflitos de gravação em banco de ensaio novo.

- **Interna e Lavagem:** flags FC diferentes nas regras explícitas de Padrão/Parceria. Ficaram null e sinalizadas, sem escolher a primeira regra/tabela. A direção precisa definir a propriedade única do serviço.
- **Inspeção técnica:** não há regra específica suficiente para determinar FC/base; permanece pendente. Não se inferiu FC false a partir de Faturável false.
- **Encantamento:** FD ausente; não foi preenchido com 1.
- **Mecânica:** não tem dimensão vinculada na fonte, logo não há combinação para precificar; cadastro foi preservado e sinalizado como possível execução terceirizada.
- **MR:** nenhuma opção comprovada na fonte. Foi solicitado à direção informar os nomes/fatores autorizados; até recebê-los, não se equipara `fator_curadoria` a MR. Valores já cadastrados no destino são preservados. O editor/seleção global continuam funcionais; testes usam opções explicitamente sintéticas, nunca carregadas automaticamente.

O importador continua aditivo: não substitui preços/flags/configurações locais divergentes, não apaga peças nem associa pelo nome. Uma carga parcial anterior do PR #19 pode exigir revisão manual dos conflitos para acrescentar dados diferentes; não foi inventada sobrescrita automática de configurações já editadas. Sempre novo dry-run e confirmação por hash, sem token Coda em produção.

### Investigação das 24 dimensões de energia

Das 113 relações na fonte, 79 têm parcelas/referências válidas individualmente; somente conjuntos completos e com total igual ao Coda são liberados. Uma dimensão com parte válida e parte inválida **não** recebe energia parcial.

| Categoria de pendência por dimensão (grupos disjuntos) | Dimensões |
|---|---:|
| Referência de energia ausente/quebrada | 9 |
| Dimensão técnica ausente | 5 |
| Sem relações técnicas | 6 |
| Parcela negativa | 2 |
| Dimensão técnica ausente e parcela negativa | 1 |
| Dimensão técnica ausente e etapa ausente | 1 |
| **Total** | **24** |

A associação existente por Serviço + Dimensão + Etapa/Dimensão técnica estava correta para os 51 conjuntos completos. Foi reforçada a detecção de relação cujo serviço não corresponde ao pai da dimensão; não se “conserta” vínculo por semelhança de nome. Testes adicionais exercitam múltiplas etapas, duas dimensões do mesmo serviço e relações com IDs distintos para não duplicar/perder etapas ou misturar conjuntos.

Parcelas negativas históricas, mesmo compensadas por positivas, não foram zeradas, absorvidas ou renomeadas. A fonte precisa de referências/etapas compatíveis aprovadas para liberar esses casos. Não houve autorização para reescrever os dados técnicos no ERP nem para mudar a validação de energia.

## Matriz funcional e diferenças

[Matriz completa: serviço, dimensão e tabela](evidencias/issue20/matriz.json), sem preços brutos. São **300 combinações de 75 dimensões × 4 tabelas**, com quantidade 1, FC C0/FR R0 reais, sem negociação nem componentes: **188 calculáveis e 112 bloqueadas**. Mecânica é registrada separadamente, sem dimensão. “Calculável” exige prévia com preço, energia/prazo e `canEmit=true`; não é apenas preenchimento de seletor.

Comparação independente: executar o código do PR #19 e o código atual sobre **a mesma fonte privada atual**, em SQLite isolado, sem publicar preços. Antes: 28 combinações completas; depois: 188. As **28 anteriores preservaram total e energia**, **160 adicionais** passaram a calcular, **zero regressões** nesses casos e nenhuma alteração monetária entre os casos completos comparáveis. Não há alegação de equivalência com os cálculos Coda substituídos por decisão da direção.

No subconjunto Funilaria/Pintura/Montagem, a matriz passou de 8/60 para **52/60**, permanecendo bloqueados Pintura/Acessórios e Pintura/Pincelada nas quatro tabelas por energia. [Tabela completa por serviço/tabela](evidencias/issue20/MATRIZ.md).

Os quatro FV passam a ser os valores globais autorizados, não percentuais por serviço/herança. FR sempre no normal e FC neutro quando desabilitado são mudanças intencionais da direção. Zero em Retrabalho é valor explícito e não dispensa cadastros/energia obrigatórios. Especial exato continua prevalecendo mesmo nessa tabela.

## Ensaios e comandos

```bash
npm run check
python3 tests/browser/issue20_pricing.py
node scripts/check-coda-import-cases.ts .runtime/issue20/export.json .runtime/issue20/matrix-all.json --all-services
node scripts/check-issue20-preservation.ts .runtime/issue20/export.json .runtime/issue20/qa-existing.sqlite
git diff --check
```

Os destinos dos dois scripts devem ser novos; preservar relatórios/bancos de QA anteriores antes de repetir. O último script recusa destino existente, usa somente dados de Atendimento sintéticos e fonte comercial privada, faz a carga em arquivo **V7 de ensaio**, verifica reinício/idempotência/integridade/FKs e preserva 163 peças, Atendimento/composição/cenários/parâmetros e snapshot/PDF. Não usa `.env` nem o caminho padrão do banco da aplicação.

- Build/typecheck e **95 testes Node aprovados**, incluindo API autenticada com flags, validação de origem, desconto bloqueado em emissão, booleans inválidos, ausência legada, persistência e snapshots/PDF.
- QA específico desktop/mobile: **6 grupos aprovados**, com edição administrativa/recarga das flags, quatro FV inclusive zero, FC seletivo/FR em ambos os serviços, MR intacto, desconto misto válido/excessivo, prévia/emissão/PDF reais em loopback.
- Cinco suítes de navegador anteriores reexecutadas: **58 grupos aprovados** (Configurações/auditoria, editor financeiro V20, Atendimento, cenários e recuperação de inclusão). Os fixtures de serviços dos dois primeiros passaram a declarar explicitamente FC e permissão de desconto, sem mudar as funcionalidades testadas. Artefatos volumosos de regressão ficaram em diretórios locais de QA; o resumo por suíte está em `testes.json`.
- Matriz e ensaio de preservação com fonte real executados; não houve emissão de orçamento com dados reais do ERP.
- Quatro avisos de lint anteriores no App permanecem; não foram feitas refatorações preventivas.

Evidências sintéticas, resultados e resumo por serviço: [COMANDOS.md](evidencias/issue20/COMANDOS.md). Implantação e carga produtiva exigem autorização específica posterior, backup V7 e revisão do plano efetivo. Não restaurar V6 nem executar os comandos de QA contra produção.
