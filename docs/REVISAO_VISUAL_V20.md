# FUNIX — Revisão visual e estrutural V20

Implementação local na branch `ui/reaproximacao-v20`, sobre `b06f1a5532081853e2ea360f67ca5b1c73543fe9` (correção da Issue #12 / PR #13). Essa correção foi preservada como dependência; esta entrega não a publicou nem integrou à main.

## O que foi aproximado

- Shell: moldura central de 520 px / até 930 px no desktop, ocupação da tela no celular, paleta azul/laranja, superfícies claras, cards e botões menos arredondados, espaçamento compacto. Sem nova faixa institucional ou tela de configuração.
- Cabeçalho: mantidos retorno à origem, contato/veículo do Atendimento efetivamente selecionado, edição compacta e ordem visual Chat → Diagnósticos → Mapa.
- Chat: rail vertical à direita na ordem Sugestão, Chat IA, Áudio, Fotos, Orçamento, Olá e Mapa; composer inferior com anexo, áudio e envio. Removida a faixa horizontal de IA que ocupava espaço acima do composer. Todas as ações ainda indisponíveis estão desabilitadas e identificadas; nenhuma mensagem fictícia foi introduzida.
- Diagnósticos: título e contador compactos, linhas com checkbox à esquerda, identificação/diagnóstico/contagem de serviços e componentes no centro e edição à direita. Exclusão com confirmação continua disponível, em ação secundária. Adição abaixo da lista, resumo comercial com valores do backend e rodapé fixo ao lado do Copiloto.
- Edição: serviços em duas colunas onde cabem, observações em largura completa, mantendo todos os campos e lançamentos repetidos/fracionários.
- Mapa: carro maior dentro da área disponível, regiões com indicação/contagem da composição incluída no cenário, seleção circular sobre o mapa, grupos, lados, paginação e retorno central. Não abre uma lista abaixo do carro. Busca unificada está disponível no mesmo seletor.
- Funil: retoques nas superfícies e cards; preservados Quadro/Lista, busca, colunas horizontais recolhíveis e retorno contextual.

## Diferenças necessárias em relação ao protótipo

- Sem bolhas, contadores de propostas, preços ou sugestões fictícios. Chat mostra contexto real do Atendimento e indisponibilidade do canal.
- Miniabas numéricas, variação de cenários e matriz foram preservadas, embora não existam com a mesma capacidade na V20.
- O mapa usa os nomes/códigos e grupos atuais da hierarquia V2; não substitui esse catálogo pelos exemplos do HTML. Nomes mais longos quebram em linhas. Região estrutural e respectiva frente/traseira continuam compartilhando o acesso da hierarquia existente.
- O seletor circular usa diálogo nativo para foco, teclado/Escape e bloqueio de ações de fundo, com busca, fechamento explícito e recuperação de erros no próprio seletor. A V20 apresenta somente o disco demonstrativo sobre a área do carro; aqui o fundo da aplicação também fica inerte durante a seleção.
- O clique em peça existente continua abrindo sua edição, sem duplicar a peça nem reativar flags silenciosamente. Não copiamos a alternância demonstrativa do HTML que removia/adicionava itens implicitamente.
- Condições, componentes, configuração e emissão continuam no fluxo de orçamento existente. O card visual resume valores confirmados; não cria uma segunda implementação dos formulários/regras comerciais da V20. O rodapé usa **Referência**, pois o valor antecede a negociação e a emissão imutável.
- Conversas continua indisponível; Veículos não foi reintroduzido por existir no protótipo antigo.

## Comportamentos preservados

Catálogo único por atividade/identidade; SQLite, dados e migrações existentes; autenticação; IDs e revisões; uma composição mestre; flags por cenário e restauração dos filhos; múltiplos danos/serviços por peça; quantidades exatas; cálculos do backend; componentes; orçamento N e PDFs imutáveis; proteção de rascunhos; retorno com filtros; confirmação de gravação separada da atualização da tela; reconciliação manual sem repetir POST automaticamente.

O checkbox da nova linha usa a mesma API de flags da matriz, afetando apenas o cenário selecionado. As contagens do mapa derivam das peças incluídas e da hierarquia já carregada, sem novas consultas ou mutações.

Nenhuma alteração em backend, shared, banco, dependências, Docker, workflows, Coda ou infraestrutura. Não houve push, merge nem deploy nesta entrega.

## Validação e evidências

**Resultado: build/TypeScript aprovados, 59 testes Node e 61 grupos de navegador aprovados, sem acessos externos ou erros JavaScript nos percursos da aplicação.** Lint sem erros; permanecem quatro avisos preexistentes de efeitos em `App.tsx`, sem novos avisos. [Resumo verificável](evidencias/revisao-v20/validacao.json).

- `npm run check`: build de produção, TypeScript frontend/backend, 59 testes Node e lint. Resultado final registrado em `evidencias/revisao-v20/npm-run-check.txt`.
- `python3 tests/browser/v20_visual.py`: referência HTML original aberta em Chromium e aplicação real em **1440×960** e **390×844**, com SQLite temporário e registros sintéticos. Inclui teclado/foco/Escape, níveis/paginação, busca unificada, persistência, flags, comparação, orçamento, retorno contextual e inclusão confirmada seguida de falha GET recuperada no diálogo.
- `python3 tests/browser/v20_regressions.py`: executa a revisão visual e a regressão dos scripts existentes, com evidências isoladas nesta entrega: `m1_atendimentos.py`, `m1_2_catalogos.py`, `issue7_scenarios.py`, `issue7_integrated.py`, `pr11_interface.py` e `issue12_inclusion.py`. Os seletores alterados nos testes acompanham os controles V20; as verificações de persistência, isolamento, frações, PDFs e falhas foram mantidas.
- Execução local: Chromium `/usr/bin/chromium`, Playwright Python, Node 24; os testes abrem apenas processos em loopback, recusam portas ocupadas e removem seus bancos temporários. Nenhum teste utiliza a VPS ou dados reais.

[Galeria desktop/mobile e referência V20](evidencias/revisao-v20/index.html) · [Resultados visuais](evidencias/revisao-v20/resultados.json) · [Log das regressões](evidencias/revisao-v20/browser-regressoes.txt).

A avaliação visual final pela direção permanece necessária. As capturas não equivalem a homologação de WhatsApp/IA ou a publicação em produção.
