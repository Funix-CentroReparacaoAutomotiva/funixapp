# FUNIX — evidência de QA do primeiro incremento

**TESTADO em 21/10/2026.** Aplicação React real servida pelo Vite em HTTP local, em Chromium com Playwright. **59 verificações passaram; zero erros JavaScript de página observados.** Nenhum sistema produtivo foi alterado e nenhuma mensagem foi enviada.

## Escopo e separação das evidências

1. **Backend local real, sem credenciais:** abertura do aplicativo em desktop e celular mostrou “Acesso em preparação”, nenhum cadastro/cartão exposto. As capturas `app-*-indisponivel-real.png` documentam o estado efetivo do ambiente.
2. **UI com API sintética isolada:** somente as respostas de `/api/**` foram interceptadas no teste. O código React, CSS, SVG, navegação, history e transporte HTTP usados são os reais da aplicação. Todos os nomes, placas, IDs e serviços retornados pelo teste são dados fictícios marcados **TESTE**, e as capturas têm selo “TESTE — DADOS SINTÉTICOS”.
3. **Não demonstrado por este QA:** chamada do aplicativo ao Coda remoto, autorização dos usuários produtivos, envio/recebimento WhatsApp, diagnósticos integrados, agendamento, documentos, mutações comerciais/operacionais ou homologação da direção. O acesso de leitura ao ERP por conector é evidência separada da investigação.

A execução inicial do Chromium em múltiplos processos travava a rede neste ambiente. Os testes passaram usando `--no-zygote --single-process`, com um processo independente por cenário para evitar uma falha do Chromium ao abrir um segundo contexto. Não foi preciso mudar a política de rede, instalar navegador, alterar o código do app ou usar `setContent` no QA final.

## Percursos que passaram em desktop e celular

Viewports: **1440×960** e **390×844**, celular com touch habilitado.

- Acesso sem configuração é explícito e não revela registros.
- Login sintético inválido não libera dados; login válido libera apenas a leitura.
- Funil renderiza os registros e fases retornados pela API, sem `draggable=true` ou mutação operacional.
- Entrada compacta e moldura desktop de 520 px preservam a V20; no celular o `body` não tem overflow horizontal. O Kanban possui sua própria rolagem.
- Quadro/Lista usam a mesma consulta; uma coluna recolhe e mantém o estado.
- Abertura de Atendimento Beta mostra nome, placa e ID de Beta. Abertura posterior de Alfa atualiza o header e contexto para Alfa.
- Mapa carrega o SVG da V20. Diagnósticos e mensagens indisponíveis são declarados, sem lista ou envio fictício.
- Retorno restaura busca, modo, colapso e scroll. Valores observados: desktop horizontal **129→129**, vertical **25→25**; mobile horizontal **150→150**, vertical **25→25**.
- Browser **Back/Forward** preserva rota, filtro e entidade correta.
- Experiência Gama abre uma visão própria, com entrada/saída e informações operacionais. “Abrir atendimento de origem” segue o row ID fornecido pela API e abre Alfa.
- Histórico retorna **409** no cenário de política pendente e não mostra registros de histórico falsos.
- Copiloto faz uma consulta à API, mostra candidatos e abre o row ID selecionado. Consulta sem resultado não inventa registros; erro **503** é mostrado.
- Busca vazia, falha de consulta, detalhe **404** e sessão expirada **401** mostram estados correspondentes. A expiração limpa os registros exibidos.
- Busca progressiva sem resultado na página e com `nextCursor` mantém “Carregar mais registros”, sem afirmar ausência global.
- Paginação pendente de um contexto anterior não contamina a nova área após trocar para Veículos.

A inspeção das requisições do teste encontrou **zero POST/PUT/PATCH/DELETE operacional**; as únicas requisições não GET pertencem à sessão sintética.

## Artefatos de QA

- Resultado legível por máquina: `evidencias/QA_RESULTADOS.json` — 59 asserts, zero erros, lista dos endpoints chamados e limites do teste.
- Script: `/workspace/work/browser/app-review.cjs`.
- Fixtures sintéticas isoladas: `/workspace/work/browser/app-fixtures.cjs`.
- Capturas desktop/mobile de indisponibilidade real, Funil, Atendimento Beta, Mapa, Experiência, Histórico pendente e Copiloto: `/workspace/work/app-*.png`.

Os scripts são ferramentas locais de QA e não foram adicionados ao código produtivo. Para repetir, é necessário ter o Vite em `http://127.0.0.1:5173`, o backend local disponível e Playwright/Chromium no ambiente. A variável `FUNIX_QA_ORIGIN` permite selecionar outra origem local.

## Leitura visual

O visual foi comparado com as capturas do protótipo. Foram preservados os três acessos iniciais, busca, paleta azul/cinzas, cards e colunas arredondadas, header compacto com retorno à esquerda, ordem observada Chat/Diagnósticos/Mapa, SVG do veículo e Copiloto laranja de 66 px. Os conteúdos ainda não integrados aparecem como indisponíveis. Não foi feita homologação manual completa de acessibilidade, gestos, leitores de tela ou todos os tamanhos de dispositivo.
