# PDF — apresentação do Resumo técnico-comercial

Base: `main` em `84c173d0db6267b858fc8bcee3e16d86e5325702`. Branch: `fix/pdf-resumo-apresentacao`. Escopo exclusivo de textos novos enviados ao template; sem merge, deploy ou acesso ao jsreport instalado.

## Ajustes

- `Para-lama · Passageiro` passa a `Para-lama passageiro` na apresentação.
- Diagnóstico e intensidade são unidos por espaço, utilizando o valor estruturado masculino `leve`, `moderado` ou `severo`: `Amassado moderado`.
- `descricaoTexto` contém somente os nomes das etapas. Não são acrescentados dimensão, quantidade ou observações internas.
- Nomes repetidos na mesma categoria são omitidos da descrição, preservando a primeira ocorrência e a ordem técnica existente. Isso não remove etapas do cálculo nem suas contribuições financeiras.
- O template continua inserindo `•` entre os elementos do array, sem novo marcador no início/fim. Seu HTML não foi alterado.

A normalização é uma função pura em `server/pdf-text.ts`: espaços simples, remoção do separador `·`, inicial maiúscula e minúsculas para vocabulário comum automotivo/português. Hífens e acentos permanecem; siglas como ABS/PDR/UV, letras de colunas e nomes próprios como Mercedes-Benz/São Paulo/BMW mantêm a grafia. Termos desconhecidos conservam a escrita da origem, evitando que uma conversão indiscriminada para minúsculas corrompa nomes próprios; não há reconhecimento semântico ou regra comercial nova.

O nome de etapa também reconhece o sufixo técnico antigo `(Dimensão ... · Qtd.: ...)` quando fornecido como parte do texto. Parênteses legítimos, por exemplo `(PDR)`, permanecem.

## Preservação

Os valores de catálogo, diagnósticos, intensidades, quantidades, dimensões e observações no snapshot não são reescritos. Só os campos de apresentação `diagnosticos[].nome`, `resumo` e `clusters[].descricaoTexto` dos **novos documentos** mudam.

Nenhuma alteração em motor, energia, pesos, rateio, arredondamento, ordem/categorias técnicas, componentes, MR, descontos, parcelas, prazo, esquema SQLite, emissão ou rotas de download. Os PDFs históricos continuam sendo os BLOBs originais; o JSON de renderer já congelado é enviado literalmente, sem passar novamente pela normalização.

## Arquivos funcionais

- `server/pdf-text.ts`: formatação pura dos textos, sem I/O ou persistência.
- `server/jsreport-adapter.ts`: aplica a formatação aos títulos e diagnóstico/intensidade.
- `server/stage-allocation.ts`: altera apenas a construção/deduplicação das descrições; a aritmética e as etapas permanecem intactas.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| `npm run check` | **305 testes Node**, zero falhas; build e TypeScript aprovados; avisos de lint preexistentes fora dos arquivos funcionais alterados |
| Novos testes de apresentação | **20 casos**, incluindo exemplos solicitados, siglas/hífens/nomes próprios, ordem/deduplicação, precisão financeira e histórico |
| Comparação com módulos originais da main | **11 cenários**, com todos os campos não textuais, valores das categorias e condições financeiras idênticos; snapshots de entrada não mutados |
| Renderização local do HTML existente | **11 cenários**, PDFs válidos e texto conferido; documento extenso de 21 peças em duas páginas |
| Antes/depois solicitado | Capturas e PDFs sintéticos locais com `Para-lama passageiro`, `Amassado moderado` e `Desmontagem • Montagem • Preparação • Colorimetria` |
| Proteção histórica | Snapshot/JSON antigo com separadores, descrição técnica antiga e bytes do PDF recuperados literalmente, sem regeneração |

Evidências em [evidencias/pdf-resumo-apresentacao/](evidencias/pdf-resumo-apresentacao/). A comparação carrega os dois módulos originais de apresentação da main em memória e verifica igualdade de todos os campos, exceto os textos explicitamente autorizados. Os testes unitários também exercitam o fluxo de emissão com banco sintético e preservação do cálculo original.

**Limite das evidências:** renderização local com Handlebars/Chromium e logo sintética FUNIX QA; não é nova homologação do jsreport instalado. Não foram usados clientes reais, credenciais, banco instalado ou serviços externos. Nenhum template ou contêiner foi modificado.
