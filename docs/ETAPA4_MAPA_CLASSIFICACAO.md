# Issue #31 — Etapa 4/6: Mapa circular e classificação

Base: `857cbcda0c34d6660eac0c6098d545d5aa814d07`, branch `feature/revisao-integrada-funix`. Implementação limitada a M01–M24, conforme [aprovação da Etapa 3](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/31#issuecomment-6552741546). Sem merge, deploy, importação ou alterações em banco instalado/infraestrutura. Parar para auditoria antes da Etapa 5.

## Fontes e precedência

A Issue #31 e a autorização atual exigem círculo/radial em **todos** os níveis. A antiga permissão de grade/lista da Issue #28 não foi utilizada. A classificação documental vem do PR #27, congelado em `97abe59f7693d29d4a91b2d2df147d495ab7bc0e`. As duas cópias CSV em [revisao-integrada/etapa4](revisao-integrada/etapa4/) preservam os registros da referência pública (UTF-8 sem BOM); não contêm exportação comercial privada.

`src/data/map-navigation.json` é uma projeção de navegação, não catálogo, migração ou novo banco. Referencia exatamente os códigos existentes; `mapTree` resolve os IDs efetivos retornados pelo catálogo. Nenhuma dependência de IDs `v2:` presumidos na instalação. A [matriz implementada integral](revisao-integrada/etapa4/MATRIZ_IMPLEMENTADA.csv) explicita os paths efetivos e as decisões provisórias. Diagnósticos continua com sua projeção funcional/busca anteriores.

Decisões provisórias aprovadas, aplicadas sem mudar cadastros:

- **D01:** códigos de coluna genérica continuam separados em Estrutura lateral → Colunas → Coluna (posição não especificada), junto dos códigos A/B/C. Não há opção principal “Coluna genérica”.
- **D02:** Caixa de roda → Posição não especificada permanece separada, sem fusão nem participação em Ambos dianteiro/traseiro.
- **D03:** subcategorias explícitas de vidros/interior nas regiões visuais de Estrutura; não se redefine sua natureza técnica.
- **D04:** soleira permanece provisoriamente em Acessórios e acabamentos, sem inferir material.

## Layout e interação

Um círculo em todas as camadas. Nas laterais, nove categorias no anel externo e quatro no interno, todas presentes simultaneamente. Não há grade/lista, paginação inicial ou submenu artificial. Na largura de 320 px, alvos externos de 76×52 px, internos de 58×44 px e centro de 44×44 px. Diâmetro responsivo até 440 px no desktop; no celular usa a largura disponível. Níveis menos densos permitem altura suficiente para o rótulo.

Quebras silábicas discricionárias em palavras longas evitam transbordo; nomes de cadastro, paths e rótulos ARIA permanecem integrais. O teste mede também a área ocupada pelo texto. Houve ajuste de precedência do padding antigo do diálogo e de espaçamento/altura nos anéis até passar em 320 px; nenhuma troca silenciosa de geometria.

O botão de paginação interna, caso necessário, fica abaixo do círculo/centro, separado dos alvos radiais. A árvore atual tem no máximo 13 escolhas diretas e não precisa de paginação em camada alguma. Nove opções também ficam diretas, evitando página de um item isolado. Nenhuma categoria inicial é escondida.

A visão do carro mantém as mesmas formas e paths SVG. Somente duas chaves/nomes acessíveis de região passam a distinguir Estrutura dianteira e traseira. Nome, quantidade selecionada/total e intensidade de seleção permanecem; círculos auxiliares de estado e de contagem foram retirados. Erros reais e recuperação permanecem no diálogo; anúncios normais continuam fora do fluxo visual.

## Matriz M01–M24

| ID | Resultado | Evidência |
| --- | --- | --- |
| M01 | Atendido: círculo em todas as camadas | CSS radial, coordenadas e medidas reais de cada camada nas três larguras |
| M02 | Atendido: 13 categorias laterais diretas | Asserts de quantidade/IDs, screenshots Motorista/Passageiro e dois anéis |
| M03 | Atendido: sem Ver mais no primeiro nível | Testes de todas as sete regiões; nenhuma página inicial |
| M04 | Atendido: controle interno separado abaixo do centro | `mapPage`, renderização/CSS do pager; árvore atual não necessita paginação |
| M05 | Atendido: não paginar uma opção isolada | Teste explícito de nove opções, todas diretas |
| M06 | Atendido: nome, número e intensidade sem círculos auxiliares | SVG renderizado, sete contagens e ausência dos indicadores antigos |
| M07 | Atendido: busca retirada só do Mapa | Ausência de textbox em cada camada; busca de Diagnósticos revalidada |
| M08 | Atendido: sem título redundante | Apenas contexto da camada e fechar; assert de ausência de “Seleção de peças” |
| M09 | Preservado: status rotineiro fora do layout | Contrato/CSS de anúncio da Etapa 2 intactos; regressão dedicada |
| M10 | Atendido: 163 códigos e IDs originais | Igualdade de conjuntos com hierarquia, resolução de IDs runtime e hash dos cadastros intactos |
| M11 | Atendido: uma folha por código | Comparação individual dos 163 paths com CSV; travessia integral no navegador |
| M12 | Atendido: Frente externa | 27 códigos/8 entradas, iluminação sem repetição nas laterais |
| M13 | Atendido: Estrutura dianteira | Região própria, 7 códigos/5 entradas, sem alterar geometria SVG |
| M14 | Atendido: laterais contextuais/porta de carga | 40 códigos e 13 entradas por lado; paths independentes |
| M15 | Atendido: abastecimento separado | Categoria própria nas duas laterais; iluminação dianteira/traseira específica |
| M16 | Atendido: A/B/C com parênteses e código genérico separado | Paths comparados, D01 explícita, sem renomear cadastros |
| M17 | Atendido: Roda/Pinça/Caixa/Para-barro diretos | Asserts/screenshot da primeira camada lateral |
| M18 | Atendido: posição depois do tipo | Dianteiro acima, Traseiro abaixo; Ambos direita Motorista/esquerda Passageiro |
| M19 | Atendido: cada um dos 23 pares corretos | 23 testes individuais contra CSV + 23 operações de inclusão/remoção por dispositivo |
| M20 | Atendido: caixa de roda canônica e genérica distinta | Cada código ocorre uma vez; genéricos nunca entram em Ambos |
| M21 | Atendido: Traseira e Estrutura traseira separadas | 27/10 códigos e 8/7 entradas; áreas SVG com chaves próprias |
| M22 | Atendido: Topo e demais rotas | Topo 12 códigos/4 entradas; cobertura completa inclusive vidros/interiores |
| M23 | Preservado/ampliado: lado contextual | 15 pares por lado e 8 por posição; geometria medida nos 23 casos |
| M24 | Preservado: teclado, foco, fechar | Enter, Tab contido, Escape, retorno à região; handlers do diálogo preservados |

## Proteção de dados e contratos preservados

Seleção/deseleção continua usando presença global e a fila da Etapa 2. `showNode` entrega os códigos reais à mesma função `select`; não há API de escrita ou fila paralela. Ambos é intenção sobre dois códigos, nunca peça nova; indisponível se qualquer membro estiver inativo/não identificado. Flags do editor/comparação continuam por cenário.

Confirmações de remoção com conteúdo/outros cenários, revisão concorrente, transação, recuperação de resposta perdida e bloqueios existentes não foram alterados. Cancelar continua sem requisições ou alteração. O teste confirma IDs dos itens restantes, ausência de duplicação, integridade SQLite/FKs e imutabilidade de snapshot/PDF. Não altera motor comercial, preço, energia, MR, catálogos, migrações, rodapé ou Copiloto.

## Testes reproduzíveis

```sh
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/etapa4_mapa.py
python tests/browser/etapa4_regressions.py
```

Navegadores sequenciais, portas 5173/8787 livres, Chromium local e **somente** bancos temporários/dados sintéticos. O runner reexecuta os testes dedicados das Etapas 2/3 e as dez suítes de regressão já utilizadas. Artefatos anteriores não são reescritos: regressões em `.runtime/etapa4/regressions`, ignorado pelo Git. O teste de Mapa gera evidências em `docs/evidencias/etapa4`.

QA mede cada uma das 57 camadas por dispositivo: largura/altura circular, limites horizontais, alvos ≥44 px, transbordo dos rótulos e interseções entre todos os botões, inclusive centro. Percorre os IDs/163 códigos efetivamente renderizados e verifica individualmente os 23 pares contra a documentação, tanto por lado quanto por posição; cada ação adiciona/remove precisamente duas identidades. Tolerância numérica de colisão: 0,05 px, sem sobreposição detectada. Fontes de rótulo de 11 px, sem depender de cor para contagem/estado acessível.

### Resultados finais

**Aprovado localmente:** build/TypeScript, **178 testes Node**, lint sem erros (quatro avisos preexistentes em App.tsx); **23 testes dos scripts de implantação**; **9 grupos de Mapa + 163 grupos de regressão = 172 grupos de navegador**. Regressões dedicadas das Etapas 2 e 3 executadas sem modificar seus testes. Há **36 screenshots** desktop/390/320 e resultados estruturados de 57 camadas/163 códigos/23 pares por dispositivo: 171 camadas medidas, 69 casos de par com inclusão e remoção verificadas, sem colisões ou transbordo de rótulos, alvos mínimos de 44 px.

Logs integrais finais e resultados estruturados em [evidencias/etapa4](evidencias/etapa4/). O teste final completo terminou sem falhas; iterações anteriores detectaram padding herdado, palavras sem quebra e contatos subpixel, corrigidos antes desta rodada. O layout de 320 px permanece denso e precisa de avaliação em aparelho físico; isto não foi apresentado como homologação do proprietário.

## Limites e pendências

Validação local em desktop 1440×1000, mobile emulado 390×844/320×568; não equivale a homologação em aparelho físico. As escolhas D01–D04 continuam provisórias de navegação, explicitamente autorizadas, sem sanar/renomear o catálogo.

Dados reais A02–A09/instalação não foram consultados/importados nesta etapa. Não se afirma que a instalação possua os cadastros carregados. Nenhuma CI é presumida: esta branch não tem PR e o workflow existente valida main/PRs. Não houve acesso produtivo, merge, deploy nem início da Etapa 5.
