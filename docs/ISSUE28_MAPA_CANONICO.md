# Issue #28 — Navegação canônica do Mapa

Implementação sobre a main `b0fdba268bc9250a04267e3d313c3eca26c625c5`, conforme a [Issue #28](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/28) e os CSV integrais do [PR #27](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/27), congelados no commit `97abe59f7693d29d4a91b2d2df147d495ab7bc0e`. Os CSV estão preservados, sem alterações, em [referencias/issue28](referencias/issue28/README.md) para comparação independente nos testes.

## Implementado

- Projeção de navegação com exatamente **163 códigos, cada um em um caminho canônico**. A projeção consulta o mesmo catálogo da aplicação e mantém os IDs, códigos e nomes comerciais; seus identificadores de grupos são exclusivamente de interface. Nenhuma importação ou alteração do catálogo/banco é executada.
- Sete áreas do SVG com chaves distintas. Estrutura dianteira e Estrutura traseira abrem seus próprios caminhos. Foram alterados atributos de identificação, mantendo todas as coordenadas e a geometria do desenho.
- Regiões: Frente 27 peças, Estrutura dianteira 7, Motorista 40, Passageiro 40, Traseira 27, Estrutura traseira 10 e Topo 12. Os testes comparam todas as folhas com a matriz original.
- Laterais com as **13 categorias diretamente acessíveis**, sem paginação: Abastecimento; Acessórios e acabamentos; Caixa de roda; Componentes das portas; Estrutura lateral; Lateral traseira; Para-barro; Para-lama; Pinça de freio; Porta de carga lateral; Porta dianteira; Porta traseira; Roda.
- Grade simples de duas colunas nos primeiros níveis com oito ou treze escolhas (Frente, Traseira e laterais), para acomodar os nomes em 320 px. Os demais níveis preservam o seletor radial. Categorias não ficam escondidas em “Ver mais opções” no primeiro nível. O mecanismo de paginação interna, caso necessário, fica abaixo do círculo e distribui as páginas sem uma última opção isolada.
- **23 ações Ambos**, cada uma enviando apenas os dois códigos reais correspondentes pela fila já existente. Ambas as peças precisam estar ativas e identificadas. Não há peça artificial para representar o par.
- Eixo lateral: Ambos acima, Motorista abaixo à esquerda, Passageiro abaixo à direita. Nas posições das laterais: Dianteiro acima, Traseiro abaixo; Ambos à direita em Motorista e à esquerda em Passageiro. Posição não especificada fica separada, no lado oposto de Ambos.
- SVG mostra nome, contagem numérica e intensidade de cor, sem círculos auxiliares de estado. Seletor sem busca superior e sem o título redundante “Seleção de peças”. A busca de Diagnósticos permanece disponível.
- Avisos rotineiros de salvamento ficam fora do fluxo visual do Mapa, sem deslocar controles; o anúncio acessível permanece. Erros reais e recuperação explícita continuam visíveis.

## Casos provisórios resolvidos conforme a Issue

| Caso | Implementação |
| --- | --- |
| D01 — coluna genérica | Código original em Estrutura lateral → Colunas → Coluna (posição não especificada). Não se mistura com A/B/C nem altera seu nome cadastral. |
| D02 — caixa sem eixo | Posição não especificada, distinta de Dianteiro/Traseiro; não participa de Ambos. |
| D03 — vidros/interior | Subcategorias explícitas sob Estrutura, conforme os caminhos da matriz. Classificação de navegação, sem alterar a natureza técnica ou o cadastro. |
| D04 — soleira | Acessórios e acabamentos, sem inferir material. |

Faróis e alojamentos ficam na Frente; os itens estruturais dianteiros e para-brisa em Estrutura dianteira; abastecimento separado de iluminação; para-lamas nas laterais. Os 163 códigos continuam acessíveis sem duplicações de caminho.

## Limites preservados

Seleção/desseleção continua utilizando **as flags do cenário ativo**, inclusive nas ações Ambos. Desselecionar não remove a peça compartilhada, seus serviços/componentes ou sua participação em outro cenário. A futura regra de exclusão global não faz parte desta entrega.

Não houve alterações no motor comercial, autosave/fila de intenções, controle de revisão, recuperação de gravações incertas, API, banco, migrações, catálogo V2 ou classificação funcional de Diagnósticos. Nenhuma mudança em snapshots, PDFs emitidos, configuração, workflow ou infraestrutura. Itens fora dos 163 códigos da referência continuam acessíveis pela busca funcional existente em Diagnósticos.

## Arquivos principais

- `src/map-navigation-data.ts`: caminhos e pares de referência, sem dados financeiros.
- `src/map-navigation.ts`: projeção do catálogo, posições e paginação.
- `src/map-navigation.css`: apresentação responsiva restrita ao Mapa.
- `src/CommercialPanel.tsx`: ligação dos novos caminhos aos controles e operações existentes.
- `src/assets/car-map.svg`: identificadores distintos das duas áreas estruturais.
- `server/tests/map-navigation.test.ts`: cobertura independente dos CSV, códigos/IDs, pares, indisponibilidade, paginação e geometria SVG.
- `tests/browser/issue28_map.py`: navegação integral e operações pela API local real.
- `tests/browser/etapa_c_selection.py`: adaptação dos seletores de navegação ao caminho canônico, preservando as verificações de persistência e concorrência anteriores.
- `tests/browser/issue28_regressions.py`: regressões existentes com artefatos isolados.

## Validação reproduzível

Somente bancos SQLite temporários com dados sintéticos e API local; não se usou o SQLite existente, exportação comercial privada, Coda ou VPS. Os scripts encerram seus próprios servidores e eliminam seus bancos temporários.

```sh
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/issue28_map.py
python tests/browser/issue28_regressions.py
```

O primeiro comando inclui build, TypeScript frontend/backend, testes Node e lint. O navegador exige Chromium/Playwright disponíveis e portas locais livres. As regressões exercitam navegação das Etapas B/C/D e os fluxos anteriores de Atendimento, cenários, inclusão, importação sintética, preços, energia, negociação, emissão, PDF e recuperação de falhas.

**Resultados:** 139 testes Node, 23 testes de scripts de implantação e 157 grupos de navegador aprovados (18 específicos do Mapa + 139 regressões). Build e verificações TypeScript aprovados. Lint sem erros; quatro avisos preexistentes em `src/App.tsx`, arquivo não alterado. Há 24 screenshots desktop/mobile.

Resultados e logs estão em [evidencias/issue28](evidencias/issue28/). Cada uma das três larguras percorreu **163 caminhos e as 23 ações Ambos**, sem perda ou duplicação. Foram verificados alvos de toque ≥44 px, ausência de sobreposição entre botões radiais/centro, todas as categorias iniciais sem paginação, teclado/Escape/retorno de foco, gravações consecutivas lentas, falha HTTP e recuperação. Leituras independentes do SQLite confirmaram seleção por cenário e preservação da peça compartilhada. Catálogo, IDs, snapshot emitido e hash do PDF foram comparados antes/depois.

## Evidências visuais

| Tela | Desktop | 390 px | 320 px |
| --- | --- | --- | --- |
| Regiões | [PNG](evidencias/issue28/desktop-mapa-regioes.png) | [PNG](evidencias/issue28/mobile390-mapa-regioes.png) | [PNG](evidencias/issue28/mobile320-mapa-regioes.png) |
| Motorista: 13 categorias | [PNG](evidencias/issue28/desktop-motorista-13-categorias.png) | [PNG](evidencias/issue28/mobile390-motorista-13-categorias.png) | [PNG](evidencias/issue28/mobile320-motorista-13-categorias.png) |
| Passageiro: 13 categorias | [PNG](evidencias/issue28/desktop-passageiro-13-categorias.png) | [PNG](evidencias/issue28/mobile390-passageiro-13-categorias.png) | [PNG](evidencias/issue28/mobile320-passageiro-13-categorias.png) |
| Frente: Ambos | [PNG](evidencias/issue28/desktop-frente-ambos.png) | [PNG](evidencias/issue28/mobile390-frente-ambos.png) | [PNG](evidencias/issue28/mobile320-frente-ambos.png) |
| Motorista: posições | [PNG](evidencias/issue28/desktop-motorista-posicoes.png) | [PNG](evidencias/issue28/mobile390-motorista-posicoes.png) | [PNG](evidencias/issue28/mobile320-motorista-posicoes.png) |
| Passageiro: caixa de roda | [PNG](evidencias/issue28/desktop-passageiro-caixa-posicoes.png) | [PNG](evidencias/issue28/mobile390-passageiro-caixa-posicoes.png) | [PNG](evidencias/issue28/mobile320-passageiro-caixa-posicoes.png) |

Também há evidências de Estrutura dianteira, coluna sem posição, salvamento pendente sem deslocamento e erro recuperável. São testes locais em Chromium, com mobile emulado; a avaliação em celular físico ocorrerá após auditoria e publicação controlada futura. Não houve merge nem deploy.
