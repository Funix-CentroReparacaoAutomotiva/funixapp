# V20 — inspeção observada em navegador

**Estado:** PROTÓTIPO inspecionado em 21/10/2026, sem acesso nem mutação em sistemas produtivos. Nenhum dado dos exemplos foi tratado como registro FUNIX real.

## Método

Chromium do ambiente (`/usr/bin/chromium`) com Playwright instalado, viewports desktop **1440×960** e mobile touch **390×844**. Execução do browser exigiu a escalada autorizada pela ferramenta por bloqueio de sockets no sandbox. A navegação `file://` foi bloqueada por política do navegador e a URL HTTP local abortou; o HTML fornecido foi então carregado diretamente por `page.setContent`, sem requisição externa. Esta abordagem testa renderização e interações do documento, **não equivale a validar sua hospedagem HTTP**. Não foram vistos erros JavaScript nos percursos registrados.

## Aparência efetiva

- Desktop: a versão fornecida limita o app à moldura central de **520 px**; em 1440×960 a moldura mede 520×930, começa em x=460/y=15. Mobile: ocupa 390×844, sem rolagem horizontal do `body`.
- Fundo externo azul acinzentado, superfície do app quase branca, azul escuro `#061e65`/`#12347c`, cinzas azulados e Copiloto laranja `#ff7f27`.
- Entrada abre diretamente em **Conversas / Funil / Veículos**, sem cabeçalho decorativo ou rodapé institucional.
- Busca compacta (39 px). Conversas em lista branca com avatar quadrado arredondado, nome, hora, prévia e indicadores fictícios. Conteúdo cabe na moldura.
- Funil horizontal: colunas de **260 px** desktop e **245 px** mobile; recolhidas medem **51/43 px**, escondem os cards e exibem título vertical e contagem. Há Quadro/Lista.
- Atendimento: header compacto de 57 px, seta à esquerda, contato/avatar, placa e contador de propostas. Barra de visões com ícones e indicador fino laranja. **Ordem visual observada é Chat / Diagnósticos / Mapa**, embora o DOM e o guia mencionem Chat/Mapa/Diagnósticos. Preservar o desenho observado ou registrar eventual decisão de ordem; não deduzir nova UX do DOM.
- Chat: bolhas claras alinhadas em lados opostos, rail vertical estreito de atalhos à direita e composer inferior de 66 px. O Copiloto usa caixa laranja 66×66 no canto inferior direito, com raio no canto superior esquerdo.
- Mapa: SVG original de veículo visto de cima, com sete regiões: Frente, Motorista, Passageiro, Topo, Estrutura dianteira, Estrutura traseira e Traseira. Há seletor circular de peças e níveis, contador nas regiões e rodapé de orçamento.
- Diagnósticos: itens com seleção, nome, diagnóstico, quantidade de serviços/componentes, valor e botão de edição; seção de condições comerciais e ação de orçamento inferior. Tudo é demonstração local.
- Copiloto: painel arredondado ancorado à caixa inferior, header laranja com separação azul, feed, estado, texto, anexos/voz/envio. A IA/voz apenas simulam processamento no HTML.

## Percursos testados

1. Abertura em Conversas, ida ao Funil e captura de Quadro.
2. Recolher primeira coluna e conferir largura/ocultação dos cards.
3. Alternar para Lista: os mesmos três atendimentos de exemplo são exibidos.
4. Abrir primeiro registro, visitar Chat, Mapa, Diagnósticos e abrir/recolher Copiloto.
5. Voltar à origem: Funil continua selecionado.
6. Buscar `Marcos`, abrir o único card, ir ao mapa, abrir região Frente e voltar: busca `Marcos`, área Funil e um resultado foram preservados.
7. Ir a Veículos, verificar Em acompanhamento e Histórico. Modo Quadro/Lista é compartilhado no protótipo.

Menu Frente observado: Para-choque, Capô, Grade (subnível), Iluminação (subnível), Alma, Para-brisa, Defletor inferior, Ver mais opções.

## Limitações concretas que precisam ser corrigidas no app

- Ao abrir AT-1042/Marcos, interior continua com **Márcia de Souza / QXY2F31 / 3 propostas**. O header e conteúdo não são vinculados ao registro escolhido; a correção é de binding, preservando geometria.
- Array local, mensagens, valores de orçamento e drag-and-drop não possuem confirmação de ERP. A lista Conversas inclui indiscriminadamente exemplos de atendimentos, produção e histórico.
- Drag-and-drop somente modifica estágio no array. Não é contrato comercial nem operacional; fórmulas do ERP não podem ser gravadas a partir dele.
- IA e voz simuladas e botões de envio/documento não demonstram integração. Não transportar o sucesso fictício ao aplicativo.
- Teste de toque automatizado cobriu cliques; não houve homologação manual de todos os gestos, atalhos ou acessibilidade.

## Evidências

`/workspace/work/prototype-measurements.json` e `prototype-map-measurements.json`: medidas e resultados automatizados.

Capturas locais (todos os registros são exemplos fictícios do protótipo):

- `prototype-desktop-conversas.png`, `prototype-mobile-conversas.png`;
- `prototype-desktop-funil.png`, `prototype-mobile-funil.png`;
- `prototype-{desktop,mobile}-funil-collapsed.png`;
- `prototype-{desktop,mobile}-funil-lista.png`;
- `prototype-{desktop,mobile}-atendimento-chat.png`;
- `prototype-{desktop,mobile}-atendimento-mapa.png`;
- `prototype-{desktop,mobile}-atendimento-diagnosticos.png`;
- `prototype-{desktop,mobile}-copiloto.png`;
- `prototype-{desktop,mobile}-veiculos.png` e `prototype-{desktop,mobile}-historico.png`;
- `prototype-mobile-mapa-selecao.png`.

Scripts reproduzíveis da inspeção: `/workspace/work/browser/review.cjs` e `map-review.cjs`.
