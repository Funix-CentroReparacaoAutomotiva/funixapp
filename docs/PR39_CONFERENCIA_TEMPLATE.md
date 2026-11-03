# PR39 — conferência com o HTML fornecido pela direção

Complemento de `PR39_EMISSAO_PDF.md`, a partir de `39d0c283b7762a5e6d0ecc6fda02780c2942c2df`. A referência passou a ser o HTML efetivamente fornecido pelo proprietário, preservado em [referencias/pdf/FUNIX_ORCAMENTO_TEMPLATE_FORNECIDO.html](referencias/pdf/FUNIX_ORCAMENTO_TEMPLATE_FORNECIDO.html). A amostra de dados que acompanha a mensagem **não foi versionada**; toda a QA usa dados sintéticos.

Não houve acesso ao jsreport instalado, VPS, Coda ou banco existente, nem merge/deploy. O HTML de referência não é instalado ou enviado para substituir o template: o cliente continua solicitando `template.name = FUNIX - Orcamento` ao serviço existente.

## Resultado e correção

As sete seções do contrato JSON são compatíveis com os caminhos Handlebars do HTML recebido. Foi encontrada uma incompatibilidade de apresentação financeira: o template desenha **Serviços + Componentes = Total** e mostra o desconto em um quadro separado; antes, o adapter enviava Serviços bruto nessa igualdade. A própria amostra recebida também apresenta essa diferença quando há desconto.

**Correção restrita ao adapter:** `financeiro.servicos` passa de `calculation.serviceSubtotal` para `calculation.serviceNet`, que já é calculado oficialmente pelo motor. `financeiro.desconto` continua mostrando a dedução positiva, à qual o template acrescenta o sinal `-`. O desconto não é aplicado novamente. `financeiro.totalVista`, parcelas, linhas, MR, energia, regras e fórmulas permanecem intactos.

Exemplo exclusivamente sintético: serviços brutos R$ 300,15, desconto R$ 50,00 e componentes R$ 200,00. O quadro agora apresenta **R$ 250,15 + R$ 200,00 = R$ 450,15**, com **− R$ 50,00** destacado à esquerda. O detalhamento das peças/serviços continua bruto, sem inventar rateio do desconto por peça. Negociação para cima utiliza os valores efetivos do motor; não inventa um desconto negativo.

## Conferência dos campos

| Seção do template | Resultado |
| --- | --- |
| `meta.id`, `meta.dataCriacao` | OR permanente e data congelada, America/Sao_Paulo |
| `cliente.nome`, `cliente.contato` | Campos do Atendimento congelados; escape padrão Handlebars testado |
| `veiculo.placa`, `veiculo.modelo` | Campos congelados; opcionais vazios ativam os fallbacks do próprio HTML |
| `diagnosticos[].nome/resumo` | Peça, diagnóstico e intensidade atuais do snapshot; sem inferência de diagnósticos |
| `totalServicos`, `totalComponentes` | Detalhamento bruto efetivo; ausência representada por string vazia para os `#if`; componente existente com total zero não é confundido com ausência |
| `clusters[].nome/valor/descricaoTexto` | Arrays e nomes aceitos pelo template; agrupamento por ID do serviço; etapas, dimensões, quantidades e observações reais do snapshot |
| `clusters[].itensDetalhados` | Nomes e totais finais com MR oficial; campos extras de quantidade/unitário continuam disponíveis no snapshot |
| `condicoes.prazo` | Apenas número de dias; o HTML já acrescenta “dias úteis”, sem duplicação |
| `parcelamento.tres/seis/nove/doze` | `valorParcela` e `total` formatados; o template não calcula valores ou taxas |
| `financeiro` | Serviços líquido na igualdade; componentes e total oficiais; desconto vazio quando inexistente, evitando “− R$ 0,00” |

O template é genérico quanto aos nomes dos clusters: a amostra antiga usa grupos de etapas do Coda, mas o HTML não exige esses nomes nem aplica classificação. Não foi recriada a taxonomia antiga nem inventado rateio de valores entre etapas. Atividades sem cobrança aparecem como **Sem cobrança** no cluster, mantendo preço unitário/total da atividade nulos no snapshot; o zero do total agregado do orçamento não cria preço fictício para a atividade.

## Limitações identificadas no próprio template

- `itensDetalhados[].quantidade` e `valorUnitario` são enviados, mas o HTML imprime somente **nome — valorTotal**. Não foi alterado o layout para acrescentá-los.
- Garantia de 12 meses e a cláusula de diagnóstico de R$ 249,00 são **textos fixos do HTML recebido**. Não são preços criados pelo aplicativo nem provocam cobrança automática. `configuration.conditions` permanece congelado no snapshot, mas o HTML não possui um campo para imprimir esse texto livre.
- A logo depende de `https://funix.com.br/assets/logo-header.svg`. Na QA, a requisição foi interceptada por uma logo **FUNIX QA** sintética, sem acesso externo. Disponibilidade da imagem real e acesso de rede do jsreport continuam pendentes de homologação.
- O HTML omite um `</td>` no resumo técnico antes da coluna direita. Chromium fecha a célula implicitamente: os testes confirmaram duas colunas e nenhum conteúdo perdido. A cópia de referência não foi corrigida silenciosamente.
- Quantidades de alta precisão podem produzir valores oficiais abaixo de um centavo. Como a apresentação monetária mantém arredondamento independente em duas casas, foi reproduzida diferença de **R$ 0,01 na soma visual** em um caso sintético com quantidades `0.1` e `0.00005`. O total exato e as quantidades foram preservados; não se inventou ajuste/rateio nem se mudou a política financeira. Uma eventual exigência de eliminar essa diferença precisa definir como apresentar/alocar os centavos. Isso é distinto da correção do desconto acima.

## Validação executada

1. `npm run check`: **265 testes Node**, zero falhas; build e TypeScript aprovados, seis avisos de lint preexistentes. Foram acrescentados 12 testes para o contrato recebido: sem negociação, desconto, negociação abaixo/acima, não faturável, misto, componentes, opcionais vazios, multipágina, frações, caminhos do HTML e JSON histórico congelado.
2. Handlebars **4.7.9**, instalado apenas em prefixo local ignorado, compilou o HTML sem helpers personalizados ou dependências novas no aplicativo.
3. Chromium local A4: **10 casos aprovados**, incluindo verificação do texto extraído de todos os PDFs. O caso longo usa 21 peças reais do catálogo de teste e gerou **3 páginas**, com todos os nomes, totais, parcelas e cláusulas presentes. Dados com markup foram escapados, não executados.
4. Reexecução da suíte integrada de emissão em 1440/390/320 px: **33 grupos aprovados**, resultado registrado em `evidencias/pr39-template/browser-emissao.log`.
5. Nenhum snapshot/PDF anterior foi regravado. O teste de JSON histórico confirma envio literal dos dados já congelados, sem remapeamento silencioso pelo adapter novo.

Screenshots, logs e resultados: [evidencias/pr39-template/](evidencias/pr39-template/). Os 370 grupos de regressão da entrega anterior continuam documentados separadamente; não são apresentados como nova execução nesta conferência restrita.

### Reprodução da renderização local

```bash
npm install --prefix .runtime/pr39-template-qa --no-package-lock --no-audit --no-fund --ignore-scripts handlebars@4.7.9
node scripts/check-jsreport-template.ts .runtime/pr39-template-qa/node_modules/handlebars .runtime/pr39-template-render
python tests/browser/jsreport_template.py
```

Os testes requerem o Chromium e `pdftotext`/`pdfinfo` já disponíveis no ambiente de QA. PDFs/JSONs de entrada são gerados apenas em `.runtime` com dados sintéticos. O renderer da aplicação não recebeu nenhuma dependência ou layout alternativo.

**Parecer:** contrato conferido contra o HTML real fornecido, com correção da apresentação de desconto e evidências locais. A execução no jsreport real permanece pendente de configuração/homologação, inclusive versão do engine, opções de impressão e logo. Não se declara homologação produtiva concluída.
