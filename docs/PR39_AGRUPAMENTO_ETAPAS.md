# PR39 — agrupamento obrigatório por categorias de etapas

Continuação na branch `feat/orcamento-identificacao-pdf-download`, a partir de `8ebf3e4aaf4d23cddeaca2f6c61ef4b530df538b` (inclui o arquivo acrescentado pela direção). Esta decisão substitui o agrupamento por serviço das entregas anteriores do PR39. Sem merge/deploy, Coda/VPS ou dados reais; nenhum layout de template foi alterado.

## Fonte e classificação

Referência: `docs/referencias/pdf/CODA_STAGE_CLUSTERS_2026-11-03.json`, com **39 etapas, 113 relações, cinco categorias e duas relações não resolvidas**. A cópia usada no backend fica em `server/data/coda-stage-clusters.json`, já coberta pelo COPY existente da imagem. Um teste exige igualdade byte a byte entre referência e cópia; a emissão não consulta Coda nem lê documentos fora da imagem.

As categorias são: Preparação técnica; Correção estrutural; Pintura e acabamento; Estética e revitalização; Serviços complementares. A classificação pertence à etapa. Não se classifica por nome do serviço ou semelhança textual, e desconhecidos não são colocados em Serviços complementares.

## Modelo, importação e compatibilidade

`TechnicalStage.presentation` é um objeto JSON opcional: `stageId`, `stageDimensionId`, `clusterId`, `cluster`, `order`. O `id` anterior continua sendo a identidade da relação. IDs originais são preservados, incluindo dimensão técnica e ordem quando disponível.

- Não há migração SQL ou nova versão do banco: os campos adicionais ficam no JSON de configuração existente, no SQLite V12.
- O importador preserva o campo `ClusterOrcamento` e a ordem da relação, mantendo os mesmos guards de preço e energia. Ausência/incompatibilidade de categoria vira pendência explícita; não zera energia, não inventa etapas ou preços e não descarta a configuração matemática já válida.
- Para exportações/configurações antigas, a referência offline pode recuperar metadados somente pela combinação exata **ID da relação + ID do serviço + ID da dimensão**. Nenhuma busca aproximada por nome. O getter decora somente a cópia em memória; não escreve no SQLite ao consultar.
- Uma futura aplicação do importador pode acrescentar metadados ausentes quando todo o conteúdo anterior de preço/energia/IDs da configuração coincide. Ajustes locais divergentes continuam gerando conflito; não são sobrescritos. A segunda aplicação é idempotente.
- PATCHs de clientes antigos que omitem metadados preservam a classificação já existente. Um objeto explícito com categoria nula mantém a pendência, sem fallback silencioso.
- Na manutenção existente de etapas em Configurações foi acrescentado apenas o seletor das cinco categorias, inicialmente pendente para uma etapa nova. Não existe escolha automática pelo serviço.

Emissões/snapshots/PDFs antigos não são migrados, renumerados, recalculados ou regenerados. O renderer continua enviando literalmente o JSON já congelado quando ele existe, e o download continua lendo o BLOB original.

## Rateio financeiro

Para cada linha efetivamente incluída, o motor existente já fornece o valor comercial da linha, a quantidade e as energias técnicas:

```
energiaEtapaUnitária = baseEnergy + dimensionEnergy
energiaServiçoUnitária = soma das energias das etapas da linha
valorEtapaExato = line.total × energiaEtapaUnitária / energiaServiçoUnitária
```

`line.total` já inclui quantidade e os unitários efetivos produzidos por negociação. A quantidade **não** é multiplicada novamente. Razões periódicas ficam como `Q`/BigInt até a apresentação; não passam por float ou truncamento intermediário. As contribuições são somadas por categoria dentro de cada contexto de peça/diagnóstico.

Um serviço pode contribuir para várias categorias; serviços diferentes podem contribuir para a mesma categoria. Cada relação participa uma vez por linha. Relações técnicas duplicadas no mesmo serviço/dimensão ficam bloqueadas, em vez de cobrarem duas vezes. Linhas comerciais distintas continuam contribuindo cada uma com seu próprio valor oficial; apenas descrições repetidas são deduplicadas.

### Desconto e negociação

O motor atual mantém **desconto global**: ele não atribui desconto a cada diagnóstico/etapa. Portanto:

- As categorias somam o subtotal efetivo **antes dessa dedução global**, o mesmo `serviceSubtotal`/total por diagnóstico do motor. Não foi inventado um rateio de desconto entre serviços, peças ou etapas.
- Negociação para cima já altera os unitários/total das linhas; o rateio usa esses resultados finais, não os preços originais.
- Desconto ou negociação para baixo continuam destacados **uma única vez** em `financeiro.desconto`; o quadro “Serviços + Componentes = Total” usa `serviceNet`, conforme a conferência anterior do template.
- Componentes mantêm MR oficial, quantidades e agrupamento próprios, sem entrar no rateio técnico.

Exemplo sintético: linha R$ 100,00, etapas de energia 2 e 3 → Preparação técnica R$ 40,00 e Pintura e acabamento R$ 60,00. Com desconto global R$ 10,00, as categorias continuam R$ 40,00/R$ 60,00 e o resumo mostra Serviços líquido R$ 90,00; o desconto aparece separado. Não há segunda dedução nem atribuição fictícia desse desconto às etapas.

### Apresentação em centavos

Após agregar as proporções exatas, os centavos das categorias são apresentados pelo método dos **maiores restos por diagnóstico**, com empate na ordem fixa das cinco categorias. A soma corresponde ao subtotal oficial arredondado desse diagnóstico. Exemplo periódico: R$ 100,00 em proporção 1/3 e 2/3 → R$ 33,33 e R$ 66,67. Isso não altera preços, quantidades ou o total exato do motor; somente representa sua distribuição no PDF.

**Parcelamento permanece integralmente inalterado e aprovado**: total e parcela são arredondados independentemente, inclusive `9 × 73,33` e total `660,00`. O arredondamento de categorias não é aplicado às parcelas. A limitação anterior da soma visual global com quantidades de alta precisão também não foi convertida em ajuste financeiro.

## Contextos e pendências

O agrupamento utiliza o ID da peça mestre e o ID efetivo do diagnóstico de cada linha. Diagnósticos distintos não se misturam, mesmo na mesma peça. Dimensões são consideradas individualmente no rateio; seus nomes, quantidades e observações aparecem junto às etapas. Componentes ficam no diagnóstico mestre de sua peça, uma única vez.

`BudgetSnapshot.pdfPresentation.errors` separa pendências de apresentação das pendências matemáticas do motor. A prévia exibe os motivos e `canEmit=false`; o backend recusa a emissão antes de reservar OR/chamar HTTP. Nenhuma confirmação verde ou emissão parcial substitui esse bloqueio.

Bloqueiam apresentação: categoria ausente/desconhecida, etapa duplicada, energia ausente/inválida, ou soma de energia igual a zero para linha faturável. Etapa individual com energia zero recebe participação zero quando as demais fornecem soma positiva. Atividades não faturáveis não recebem preço artificial; continuam “Sem cobrança”, com requisitos de energia técnica preservados.

### Duas relações não resolvidas

| Relação | Serviço | Dimensão | Situação |
| --- | --- | --- | --- |
| `i-cz0vjyEOB7` | `i-VQqzDP1-v2` | `i-WLedwbySUP` | Etapa, dimensão técnica e categoria nulas na referência |
| `i-_C-sMqVV7H` | `i-VQqzDP1-v2` | `i-WLedwbySUP` | Etapa, dimensão técnica e categoria nulas na referência |

As outras duas relações desse serviço/dimensão apontam para Limpeza de couro e Hidratação, mas isso **não identifica** as etapas das linhas vazias. A referência não permite repará-las. Permanecem pendentes para conferência/correção explícita da origem pela direção; nenhuma carga real foi feita nesta tarefa. Auditoria sanitizada em `evidencias/pr39-stage-clusters/reference-audit.json`.

## Testes e evidências

- `npm run check`: **284 testes Node**, zero falhas, build/TypeScript aprovados; seis avisos de lint preexistentes. Inclui 19 novos testes de categorias/importação/rateio e as regressões de emissão e históricos.
- `python tests/browser/stage_clusters.py`: **nove grupos** em 1440/390/320 px, cobrindo bloqueio explícito sem reserva, manutenção/persistência das categorias e emissão de um serviço em duas categorias.
- Template original: **dez casos locais** com Handlebars/Chromium, incluindo documento de **quatro páginas/21 peças**; nomes, valores, parcelas e cláusulas presentes no texto dos PDFs. Logo sintética interceptada; nenhum acesso externo.
- Regressão de emissão: suíte de 33 grupos nas três larguras, com logs/resultados em `evidencias/pr39-stage-clusters/`.
- Preservados testes de idempotência, concorrência, morte/retomada, falha HTTP/commit, arquivos legados e rollback de migrações. Casos sintéticos antigos sem categoria agora comprovam primeiro o bloqueio; uma categoria é configurada explicitamente antes de uma nova emissão, sem editar fixtures históricas congeladas.

Evidências locais não são homologação do jsreport instalado. Configuração e execução real com dados sintéticos continuam necessárias antes de publicar. Sem alterações no HTML, motor de precificação, fórmulas de energia, SQL/migrações, Mapa, VPS ou dados comerciais reais.

## Adendo de persistência — verificação final

O planejamento e a comparação antes da gravação usam o **JSON fisicamente armazenado**. A visão de compatibilidade em memória não pode mascarar a ausência de metadados no SQLite: mesmo que o getter já consiga exibir a categoria pelo ID histórico, a aplicação futura do importador precisa gravar esses metadados e avançar a revisão uma única vez. A repetição não grava novamente.

Foi acrescentada uma regressão sintética com IDs originais e valores exclusivamente de QA, cobrindo leitura sem escrita, dry-run, persistência física e segunda aplicação idempotente. O ambiente local encerrou após as validações registradas acima; este adendo é validado pelo `npm run check` da CI remota do mesmo PR. Resultado e link da execução atual constam no PR. Nenhuma importação real foi executada.
