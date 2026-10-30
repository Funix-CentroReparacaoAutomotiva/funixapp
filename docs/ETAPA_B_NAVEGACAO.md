# Etapa B — navegação e estrutura do Atendimento

Base: `main` / `24354733ef2b5e2c39fc036f23746529311a5282` (PRs #19, #21 e #23). Branch: `ui/etapa-b-navegacao`. Escopo da direção: telas internas completas, cabeçalhos/retorno, cenários compactos, swipe e Copiloto. Sem mudanças de motor, backend, schema, importador, dados existentes ou infraestrutura. Etapas C/D não iniciadas.

## Implementação

- **Editor de peça:** ocupa a área do aplicativo, sem moldura externa, botão de retorno separado ou lista por baixo. Cabeçalho superior com nome da peça e um retorno; o nome não é repetido no cabeçalho interno. Incluídos os controles originais de inclusão, observação, diagnóstico, serviços e componentes, autosave e painel financeiro. Exclusão global da peça continua disponível no próprio editor, com confirmação e preservação de versões emitidas.
- **Comparação:** tela interna com título `Comparação de cenários`, sem abas principais nem moldura externa. Mantém Só diferenças, máscaras por cenário, totais e matriz com rolagem horizontal própria.
- **Orçamentos emitidos:** novo rótulo no menu e cabeçalho. Lista e versão são níveis navegáveis; versão usa título `Orçamento A`, etc. Consulta do snapshot e download do mesmo PDF preservados. Voltar de uma versão retorna à lista; depois retorna à visão anterior do Atendimento.
- **Cabeçalho principal:** contato, veículo, edição e retorno ao Funil preservados. Chat/Diagnósticos/Mapa e controle de cenários aparecem na navegação principal; ficam ocultos nas telas internas.
- **Cenários:** reaproveitado `ScenarioMenu`, com números visíveis e nomes completos acessíveis, `+` e ícone de matriz com títulos/nomes acessíveis. Exclusão e cópia das inclusões permanecem. `ScenarioTabs` foi avaliado: já oferece números/scroll, mas não contém exclusão nem histórico. Adaptar o menu existente preserva essas funções e sua navegação de teclado sem criar um terceiro componente de cenários.
- **Swipe:** ordem Chat ↔ Diagnósticos ↔ Mapa, sem circular nos extremos. Só na visão principal; ignora vertical, gestos curtos/lentos, campos, botões, menus, diálogos, painel financeiro, comparação e ancestrais com overflow horizontal. Não chama preventDefault na rolagem vertical e usa os mesmos guards dos botões.
- **Copiloto:** removida a regra que o ocultava diante de `.approved-finance`. Posição acompanha a altura real do rodapé/painel com observadores nativos e atualização por frame, acima dos controles financeiros, inclusive expandido. Chat usa sua barra de composição como referência. Abre/fecha nas três abas, mantendo IA explicitamente indisponível. Nas telas internas, o botão fica oculto para dedicar a área ao conteúdo.

## Navegação, estado e proteção

Reutilizado o roteamento leve do App com History API, sem bibliotecas ou endpoints novos:

| Visão | Query acrescentada ao Atendimento |
|---|---|
| Peça | `tela=peca&peca=ID_ESTAVEL` |
| Comparação | `tela=comparacao` |
| Emissões | `tela=orcamentos` |
| Versão | `tela=orcamentos&versao=ID_ESTAVEL` |

`aba` continua identificando a visão principal de origem. Subtelas fazem push; mudar a aba principal continua substituindo a entrada atual. Entradas guardam o índice local e a visão anterior. Voltar nativo e cabeçalho percorrem os mesmos níveis. Acesso direto sem entrada pai usa retorno determinístico: versão → lista → Atendimento. Títulos são associados à URL atual, evitando reaproveitar o nome de outra peça/Atendimento durante carregamento.

O painel comercial fica montado nas transições limpas, preservando contexto do cenário, negociação, cache de catálogo e dados já carregados. Os IDs de peças/versões são técnicos e estáveis. As posições de rolagem reutilizam o cache do shell, com chaves por Atendimento/visão, incluindo retorno após descarte confirmado. Não há persistência comercial em localStorage nem novo mecanismo de estado global.

Enquanto grava, uma saída é bloqueada. Com rascunho/erro, a confirmação existente continua necessária. Cancelar um pop restaura a entrada do histórico com `history.go`, preservando também o caminho de avançar; não cria uma nova entrada a cada cancelamento. Confirmar descarte recarrega o estado confirmado sem gravar o texto descartado. Antes de sair do documento, o beforeunload existente permanece.

A navegação para editor após seleção já gravada e o retorno após exclusão ocorrem quando a mutação termina; não atravessam o guard de gravação. O retorno limpo não adiciona GET de workspace. A mesma revisão/autosave/reconciliação da Issue #22 segue sendo usada, sem alterações em `DiagnosisEditor.tsx` ou no contrato API.

## Validação executada

- `npm run check`: build, tipos e **105 testes Node aprovados**, lint sem erros, quatro avisos React preexistentes em `src/App.tsx`. Inclui dois testes novos para queries/retorno de versão e direção/limites de swipe.
- `python tests/browser/etapa_b_navigation.py`: **21 grupos aprovados** (10 desktop, 11 mobile), cenários dedicados em desktop 1440×960 e mobile emulado 390×844; resultados e capturas em [evidências](evidencias/etapa-b/). Cobrem cabeçalho, ausência de abas/card/botão duplicados, posição da lista, retorno nativo/avançar, cenário, criação/cópia/exclusão, máscaras/matriz, versão/PDF imutáveis, botões/swipe, Copiloto, rede, rascunhos, descarte e gravação pendente. No mobile, também usa eventos Touch pelo protocolo do Chromium, confirmando swipe horizontal e rolagem vertical nativa.
- **84 grupos existentes aprovados:** PR17 (8), editor/financeiro (17), M1 Atendimento (19), cenários (3), inclusão (11), autosave Issue22 (14), seletores com importação **sintética** Issue18 (6), regras Issue20 (6). Todos usam API/SQLite locais isolados; nenhum Coda real foi importado nesta etapa. [Asserções consolidadas](evidencias/etapa-b/regressoes.json).
- Comparação com HTML aprovado nos testes do editor/financeiro continua verificando cores, tipografia e controles. A referência remove apenas a moldura externa que a Etapa B autorizou retirar.
- Testes antigos foram adaptados ao contrato novo: menu de cenários na tela principal, retorno em cabeçalho, rótulo Orçamentos emitidos, recarga direta da URL interna e seletor fechado ao abrir peça. O ensaio de GET antigo foi atualizado: retorno não emite o GET eliminado; snapshot atrasado contra segundo escritor real produz 409, reconcilia e não duplica/perde peças.

As oito suítes existentes foram executadas em grupos, com artefatos redirecionados para `.runtime/etapa-b/regressions/`, sem sobrescrever evidências históricas. `tests/browser/etapa_b_regressions.py` oferece o agrupamento para reprodução. Não executar suítes simultaneamente nas portas locais 5173/8787.

```bash
npm run check
python tests/browser/etapa_b_navigation.py
python tests/browser/etapa_b_regressions.py
```

Pré-requisitos de QA já utilizados: dependências npm do projeto, Python/Playwright e Chromium em `/usr/bin/chromium`. O Harness cria arquivos SQLite próprios, senha efêmera e processos locais, sem carregar o `.env` do aplicativo.

## Capturas

| Tela | Desktop | Mobile |
|---|---|---|
| Chat | [abrir](evidencias/etapa-b/desktop-chat.png) | [abrir](evidencias/etapa-b/mobile-chat.png) |
| Diagnósticos | [abrir](evidencias/etapa-b/desktop-diagnosticos.png) | [abrir](evidencias/etapa-b/mobile-diagnosticos.png) |
| Mapa | [abrir](evidencias/etapa-b/desktop-mapa.png) | [abrir](evidencias/etapa-b/mobile-mapa.png) |
| Editor completo | [abrir](evidencias/etapa-b/desktop-editor.png) | [abrir](evidencias/etapa-b/mobile-editor.png) |
| Comparação | [abrir](evidencias/etapa-b/desktop-comparacao.png) | [abrir](evidencias/etapa-b/mobile-comparacao.png) |
| Orçamentos emitidos | [abrir](evidencias/etapa-b/desktop-orcamentos.png) | [abrir](evidencias/etapa-b/mobile-orcamentos.png) |
| Versão emitida | [abrir](evidencias/etapa-b/desktop-versao.png) | [abrir](evidencias/etapa-b/mobile-versao.png) |
| Copiloto no Chat | [abrir](evidencias/etapa-b/desktop-copiloto-chat.png) | [abrir](evidencias/etapa-b/mobile-copiloto-chat.png) |
| Copiloto em Diagnósticos | [abrir](evidencias/etapa-b/desktop-copiloto-diagnosticos.png) | [abrir](evidencias/etapa-b/mobile-copiloto-diagnosticos.png) |
| Copiloto no Mapa | [abrir](evidencias/etapa-b/desktop-copiloto-mapa.png) | [abrir](evidencias/etapa-b/mobile-copiloto-mapa.png) |

Somente fixtures e registros de QA sintéticos nas capturas. Não há exportação privada, preço real, credencial ou banco incluído.

## Arquivos e limites

- `src/App.tsx`, `src/detail-navigation.ts`: queries, cabeçalho, histórico, guards, swipe e posição do Copiloto.
- `src/CommercialPanel.tsx`: visões por URL e cache de rolagem, composição existente preservada.
- `src/BudgetPanel.tsx`: seleção da versão por URL, título contextual e mesmas consultas/PDF.
- `src/ScenarioMenu.tsx`, `src/App.css`, `src/approved.css`: apresentação compacta e estrutura V20.
- Testes Node/navegador, helpers de cenários e evidências/documentação.

Mobile é emulação Chromium com toque; Safari/iOS e hardware físico não foram homologados. O contexto de cenários e as posições usam a sessão aberta do aplicativo, conforme a arquitetura existente; abrir um link em outra sessão usa a seleção inicial do servidor. Não foi criado novo mecanismo de persistência de preferências. Chat/IA continuam indisponíveis. Matriz e catálogo permanecem com os contratos da main; o custo de cálculo de todos os cenários não faz parte desta entrega.

**Sem merge, deploy, importação Coda real, alteração VPS/SQLite existente, preços/fórmulas, navegação/hierarquia/seleção do mapa das etapas C/D ou workflows. PR único para auditoria; aguardar revisão.**
