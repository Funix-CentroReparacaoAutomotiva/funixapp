# Etapa D — componentes, MR e refinamento do editor

Base obrigatória: main `5df84fd02ad5ce837285b5cec9e41abda0cc0b29`, após o merge do PR #25. Branch: `ui/etapa-d-componentes-mr`. Implementação para auditoria, sem merge/deploy, sem importação real e sem acesso à VPS ou ao SQLite existente.

## Auditoria inicial e solução mínima

O editor já possuía CRUD de componentes compartilhados, máscaras por cenário, autosave com debounce, revisões, IDs estáveis, reconciliação de confirmações incertas e recuperação explícita. Não foram reimplementados esses mecanismos. `CommercialWorkspace.calculations` já entrega uma linha por componente (`kind`, `id`, `pieceId`, `included`, `factors.MR`, `unit`, `total`) no cenário correspondente. O motor oficial já aplica preço manual × MR, teto unitário de R$ 0,05 e quantidade, com decimais exatos. Nenhuma mudança de fórmula é necessária.

A linha desabilitada ou com preço ausente não traz necessariamente `factors.MR`. Para mostrar o multiplicador nesses casos, a configuração que o painel financeiro já consulta foi compartilhada com o editor. Não foi criado outro GET, endpoint, tabela, migração ou mecanismo de configuração. Quando a configuração ainda está sendo carregada, a linha oficial atual pode informar o fator já aplicado; não se assume fator neutro quando ele falta.

## Alterações por arquivo/contrato

| Arquivo | Alteração |
| --- | --- |
| `src/DiagnosisEditor.tsx` | Componentes em duas linhas; MR e total somente leitura; estados de pendência/erro/exclusão; remoção do rodapé de sucesso permanente. Mantidos os handlers de autosave, inclusão, exclusão e recuperação. |
| `src/component-presentation.ts` | Apresentação percentual exata do fator e escolha do estado/linha oficial pelo ID e cenário. Não calcula preço, soma, arredondamento ou quantidade. |
| `src/FinancialPanel.tsx` | Entrega ao pai a configuração já consultada; mantém consulta, seletor e fluxo financeiro existentes. |
| `src/CommercialPanel.tsx` | Compartilha a configuração entre painel financeiro e editor, sem novo acesso à API. |
| `src/approved.css` | Layout compacto e responsivo, preservando paleta/controles V20, cabeçalho e serviços. |
| `server/tests/component-presentation.test.ts` | Percentuais, valores oficiais, arredondamento unitário, frações, zero e estados sem resultado confirmado. |
| `tests/browser/etapa_d_components.py` | QA desktop/mobile com API e SQLite reais temporários e dados sintéticos. |
| `tests/browser/etapa_d_regressions.py` | Bateria B/C e regressões comerciais, artefatos separados dos históricos. |
| Testes existentes de editor/autosave | Espera pela confirmação em `data-save-state`, sem depender do rodapé removido. Asserções de persistência, erros, cenários, preços e PDFs preservadas. |

`data-save-state` documenta o estado real do editor (`confirmed`, `draft`, `saving`, `incomplete`, `error`); não substitui a persistência e não é um banco local. A sonda de desempenho da Issue22 observa esse atributo em vez do texto decorativo anterior, sem alterar seu cenário/metodologia. Não foi feita nova comparação de latência nesta etapa.

## Comportamento entregue

Primeira linha: toggle de inclusão no cenário, descrição e lixeira global. Segunda linha: quantidade, preço unitário manual, MR somente leitura e total oficial. Em 390 px os quatro campos ficam na mesma linha; até 360 px admitem quebra em duas colunas, preservando legibilidade. O desktop usa a mesma ordem.

MR é percentual de efeito: 1 → 0%; 1,20 → +20%; 1,35 → +35%; 0,80 → −20%. O fator original fica no tooltip. A transformação usa inteiros exatos somente para formatar a porcentagem, sem uma segunda fórmula monetária. O único seletor de MR continua no painel financeiro e não há seleção automática.

| Situação | Apresentação do total |
| --- | --- |
| Linha oficial confirmada e incluída | `total` do backend, formatado em reais, incluindo frações de centavo existentes |
| Atributos/inclusão locais diferentes da versão salva ou MR em atualização | Calculando… |
| Falha de persistência/recálculo ou erro oficial com MR válido | Valor não atualizado |
| Preço manual ausente | Preço não informado |
| MR ausente ou opção com fator não configurado | MR não configurado |
| Componente ou peça pai desabilitados, após confirmação | Fora do orçamento, sem apresentar zero como exclusão |

Preço manual `0` continua válido e pode resultar em R$ 0,00. Preço `null` continua pendente. Uma falha de cálculo com MR válido não é rotulada incorretamente como ausência de MR. A troca global do MR invalida os valores durante a gravação e o GET final; todos os componentes refletem o novo resultado confirmado, coerente com o subtotal financeiro.

A mensagem permanente “Salvamento automático · Salvo” foi removida. Pendências reais, salvamento em andamento, rascunhos incompletos, erros, conflitos, retentativa e recuperação da versão salva continuam visíveis. Não há mensagem repetitiva de sucesso, nem remoção do autosave.

## Validação reproduzível

```sh
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/etapa_d_components.py
python tests/browser/etapa_d_regressions.py
```

Os cenários de navegador usam Chromium, API local real e arquivos SQLite temporários com dados explicitamente sintéticos, excluídos ao término. Não utilizam exportações comerciais privadas nem o banco existente. As regressões anteriores gravam suas evidências em `.runtime/etapa-d/regressions/`, sem sobrescrever screenshots históricos.

Casos cobertos: ordem/geometria dos campos; quatro fatores MR; uma única consulta de configuração compartilhada; quantidades inteiras e fracionárias; teto unitário anterior à quantidade; zero/preço ausente/MR ausente ou null; recálculo global com workspace atrasado; digitação durante PATCH; HTTP 503, conflito real e confirmação perdida; recuperação sem duplicar gravações; inclusão independente por cenário; cancelamento/confirmação de exclusão global; IDs preservados; snapshot e hash do PDF imutáveis; ausência do rodapé decorativo; largura 390/320 px sem rolagem horizontal; regressões B/C e comerciais.

Exemplo sintético conferido contra o motor: 100,01 × MR 1,20 → unitário 120,05; quantidade 2 → 240,10. Quantidade 0,25 → 30,0125. O frontend exibe os valores recebidos, sem refazer essa conta. A edição rápida também é conferida diretamente nas colunas do arquivo SQLite com uma conexão independente, além de API e tela.

## Resultado executado

**133 testes Node**, **23 testes dos scripts** e **139 grupos de navegador** aprovados: 16 específicos da Etapa D, 21 da B, 18 da C e 84 regressões comerciais. Build e typechecks aprovados; lint sem erros, com quatro avisos preexistentes em `src/App.tsx`. As 15 capturas incluem os estados confirmados, pendentes, falha, exclusão e largura de 320 px. Foram inspecionadas amostras desktop/mobile. Os logs completos estão abaixo.

## Evidências

[Resultados e logs](evidencias/etapa-d/) — desktop 1440×1000, mobile emulado 390×844 e caso estreito 320×844. Dados e preços dos screenshots são sintéticos.

| Estado | Desktop | Mobile |
| --- | --- | --- |
| MR/total confirmado | [imagem](evidencias/etapa-d/desktop-mr-total-confirmado.png) | [imagem](evidencias/etapa-d/mobile-mr-total-confirmado.png) |
| Atualização global do MR | [imagem](evidencias/etapa-d/desktop-mr-recalculando.png) | [imagem](evidencias/etapa-d/mobile-mr-recalculando.png) |
| MR pendente | [imagem](evidencias/etapa-d/desktop-mr-pendente.png) | [imagem](evidencias/etapa-d/mobile-mr-pendente.png) |
| Preço pendente | [imagem](evidencias/etapa-d/desktop-preco-pendente.png) | [imagem](evidencias/etapa-d/mobile-preco-pendente.png) |
| Campos em autosave | [imagem](evidencias/etapa-d/desktop-autosave-pendente.png) | [imagem](evidencias/etapa-d/mobile-autosave-pendente.png) |
| Falha com rascunho preservado | [imagem](evidencias/etapa-d/desktop-erro-preservado.png) | [imagem](evidencias/etapa-d/mobile-erro-preservado.png) |
| Fora do orçamento | [imagem](evidencias/etapa-d/desktop-fora-do-orcamento.png) | [imagem](evidencias/etapa-d/mobile-fora-do-orcamento.png) |
| Tela estreita | — | [320 px](evidencias/etapa-d/mobile-estreito-320.png) |

## Limites e pendências

Nenhuma decisão comercial nova ou incompatibilidade estrutural foi necessária. APIs, SQLite V7, migrações, configuração de produção, catálogo, hierarquia V2, seleção serial, mapa, navegação B/C, serviços, Tabela/FC/FR/MR, negociação, energia/prazo e emissões/PDFs permanecem com seus contratos existentes.

Os totais desabilitados não mostram estimativas: o motor não calcula preço para linhas excluídas, e a UI informa Fora do orçamento. A emulação mobile não equivale à homologação em aparelho físico/produção. Workspace continua calculando todos os cenários, como na base, sem novas otimizações ou regras. Não foram iniciadas outras etapas.
