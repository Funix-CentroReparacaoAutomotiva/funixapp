# Fase 5 — interações do Mapa, gestos e editor

Base `main`: `11164d5e4e255f92f50187becba3e024629de552`. Branch `feature/fase5-interacoes-mapa-gestos`. Testes locais com SQLite temporário e dados sintéticos; nenhum acesso à VPS, Coda, banco instalado ou nova importação.

## Auditoria inicial e mudanças mínimas

| Área | Já existente/correto | Mudança necessária |
| --- | --- | --- |
| Mapa | SVG, sete regiões, projeção canônica de 163 códigos, 23 pares, radial, 13 entradas laterais, geometria e orientação | Toque em peça presente alternava a flag. Agora abre o editor sem mudar a habilitação. Ausente continua pela fila e permanece no Mapa |
| Pressão longa | Não existia | Atalho de 550 ms para incluir e abrir após confirmação; sem clique curto posterior; cancela com movimento >10 px, pointercancel, saída, scroll, blur, ocultação ou bloqueio |
| Teclado/mouse | Botões, foco, Enter/Espaço, Escape e retorno por History API | Shift+Enter ou botão direito equivalem ao atalho de diagnóstico. Enter/Espaço conservam a ação de toque curto |
| Grupos | Navegação para níveis internos e estado por códigos válidos | Contagem e seta discretas no tratamento existente; sem novo indicador circular |
| Ambos | Exatamente dois códigos reais, operação serial existente | Ação aditiva: inclui apenas ausentes; nunca abre editor arbitrário, desabilita ou exclui presentes. Estado parcial indica flags reais, inclusive ARIA mixed |
| Swipe entre abas | Ordem, limites, proteção de autosave/retorno, exclusão de controles e diálogos | Guard explícito para linha de diagnóstico, superfície radial/SVG e controles acessíveis; não reimplementado |
| Lista de Diagnósticos | Toque normal abre editor; toggle por cenário e lixeira global | Swipe direito revela ação vermelho-suave; só a ativação explícita chama a mesma exclusão confirmada da lixeira |
| Editor | Duas linhas, anotações, diagnóstico/intensidade, recomendações, opcionais, origem, terceiros, autosave | Nenhuma mudança de layout/cor/tipografia/contratos; validar ergonomia e regressões |

Conferido também por `git diff --exit-code` contra a base para `server/`, `shared/`, editor, financeiro, orçamentos, fila, hook de seleção, SVG, taxonomia, geometria, scripts e workflows: sem alterações.

Não há endpoint, fila, tabela ou migração nova. Nenhum arquivo do backend, catálogo, motor, configuração financeira, PDF, rodapé ou Copiloto foi modificado.

## Persistência e navegação

A fila `PieceSelectionQueue` e seu transporte continuam intactos. A projeção do Mapa verifica composição mestre por `pieceId` e flags do cenário separadamente; cores não decidem presença. Inclusões usam a intenção `true`, nunca alternam uma intenção já pendente. Vários toques na mesma peça ausente consolidam-se pela fila original. A indicação pendente vem das intenções reais; a presença só muda após o workspace confirmado.

Para o atalho, o editor é solicitado somente depois de a fila estar idle e de o workspace conter a identidade confirmada, no mesmo contexto de Atendimento/aba/cenário/seletor. Falha, conflito, nova seleção/grupo, blur/ocultação ou interrupção de contexto cancelam o atalho pendente. Uma escrita já enviada não é descartada: sua confirmação permanece pela fila, sem abertura tardia. A recuperação original é explícita e lê o estado antes de regravar. Após recuperar uma gravação incerta, o operador toca novamente para abrir; não ocorre navegação tardia.

Peça presente desabilitada abre preservando sua flag. Acesso por teclado usa o mesmo roteamento `onView`; Voltar e histórico permanecem os atuais. Ambos nunca escolhe um dos dois editores; em par misto inclui somente a peça ausente e conserva a desabilitada existente. Com as duas presentes, é uma ação sem escrita.

Foi reproduzido um problema concreto em 320 px: o feedback de falha aumentava a altura do seletor e o clique residual da pressão longa podia atingir o fundo do diálogo e fechá-lo. A supressão agora acompanha somente a liberação daquele ponteiro, inclusive quando o botão muda de posição/é desmontado, e é encerrada por novo pointerdown, cancelamento ou timeout curto. Teclado e nova interação não são bloqueados. Escape também fecha a ação da lista sem depender de foco prévio do toque.

## Gesto da lista

A linha conserva os controles originais. No estado revelado, reserva 64 px para a ação e mantém total/lixeira dentro da largura disponível; esse estado é conferido geometricamente, sem corte à direita. A linha fechada mantém dimensões e disposição anteriores. A área revelada existe somente após gesto horizontal claro para a direita (mínimo 60 px, predominância horizontal 1,8× e até 1500 ms). Movimento vertical mantém a rolagem nativa com `touch-action: pan-y`. Gesto curto/lento demais/cancelado não exclui nem abre o editor por clique residual. Gesto à esquerda fecha a ação.

O swipe da linha tem escopo próprio: não inicia troca de aba; a navegação por swipe permanece disponível fora das linhas/controles. A área fecha ao acionar/cancelar, Escape, trocar aba/cenário, navegar, iniciar outra interação, gravar ou bloquear a seleção. Escape funciona mesmo se o toque não tiver dado foco à linha; devolve foco ao botão de abertura. A lixeira original permanece acessível por teclado/mouse. Controle oculto não entra no foco nem na árvore acessível; animação respeita redução de movimento.

A ação revelada chama exatamente `selectionQueue.enqueueRemoval`, assim como a lixeira, preservando revisão, confirmação, reconciliação e remoção global transacional já existentes. Cancelar não dispara GET nem escrita e não muda dados. Confirmação não é dispensada pelo gesto.

## Arquivos

| Arquivo | Justificativa |
| --- | --- |
| `src/CommercialPanel.tsx` | Distingue presença/flag, intenção de abertura confirmada e integração dos controles existentes |
| `src/MapPieceButton.tsx` | Controle de pressão longa/cancelamento, clique único e alternativas de entrada |
| `src/DiagnosisSwipeRow.tsx` | Revelação contextual com teclado/fechamento, sem transporte de persistência próprio |
| `src/App.tsx` | Amplia somente as exclusões do swipe já existente |
| `src/map-radial.css`, `src/piece-selection.css` | Contagem/seta discreta, pan-y e ação contextual sem redesenho |
| `tests/browser/fase5_gestures.py`, `fase5_regressions.py` | QA dedicado e reprodução das regressões |
| Testes de navegador anteriores afetados | Atualizam apenas a expectativa aprovada de toque em presente/Ambos, preservando asserts de IDs, máscaras, erros e histórico |

## Aceitação e evidências

- `npm run check`: build, TypeScript frontend/backend e 228 testes Node aprovados; lint sem novos avisos (quatro efeitos preexistentes em `src/App.tsx`).
- `python -m unittest discover -s deploy/tests`: 23 testes aprovados; `bash -n` nos quatro scripts de implantação aprovado.
- `python tests/browser/fase5_regressions.py`: 340 grupos aprovados em 20 suítes, incluindo regressões completas Fases 1–4 e os cenários anteriores do MVP.
- `python tests/browser/fase5_gestures.py`: **45 grupos aprovados**, 15 por resolução 1440/390/320 px, em rodada final após os ajustes de interrupção, teclado e largura da ação revelada. Total: **385 grupos de navegador**.

As expectativas de `fase1_selection`, `etapa2_persistencia`, `etapa4_mapa` e `etapa6_integrated` foram atualizadas somente onde o comportamento aprovado mudou: tocar presente abre editor; Ambos deixa de alternar flags. As asserções de cenário, dados, revisão, cancelamento, recuperação e histórico foram mantidas. Onde o teste precisava alterar a flag, passa a usar o toggle do editor, que continua sendo o controle correto.

O build visual anterior foi extraído da base aprovada em diretório temporário, com outDir isolado. As comparações usam os mesmos dois mestres sintéticos iniciais e as mesmas larguras/alturas; não são screenshots da instalação produtiva. Os screenshots da ação revelada são capturados com animações concluídas, acompanhados de verificação geométrica de que a ação não se sobrepõe ao conteúdo. Registro em `referencia-visual.json`. Logs finais `check.log`, `implantacao.log`, `browser.log`; matrizes `regressoes-resultados.json`, `mapa-geometria-pares.json` e resultados por resolução.

Screenshots comparáveis antes/depois em `docs/evidencias/fase5/`; relatório por resolução e logs apenas sintéticos. A validação dos 163 caminhos/23 pares utiliza a suíte geométrica já existente, incluindo colisões, texto e alvos de toque ≥44 px. A suíte dedicada utiliza entrada física Chromium/CDP em todas as resoluções, além de teclado/mouse e verificação SQLite/PDF após restart.

## Matriz de aceitação

| Requisito | Resultado |
| --- | --- |
| Toque curto novo/presente/desabilitado/outro cenário | Aprovado: inclusão única ou editor, sem alterar máscaras existentes |
| Pressão longa e clique único | Aprovado: POST + workspace confirmados antes de abrir; liberação não ativa outra ação |
| Cancelamento/interrupção/entrada alternativa | Aprovado: arraste, cancel, blur, nova seleção, Shift+Enter e botão direito; teclado permanece independente |
| Grupos/163 códigos/23 pares | Aprovado: geometria, caminho único, direção, duas identidades reais, repetição e par misto |
| Swipe das abas | Aprovado: ordem sem wrap, exclusões de controles/diálogos/radial/linhas e rolagem vertical |
| Swipe da linha e exclusão | Aprovado: somente revela; ação explícita, confirmação, Cancel sem escrita e DELETE oficial |
| Estados de rede/concorrência | Aprovado: atraso, falha antes da entrega, resposta perdida após commit, conflito real e recuperação sem duplicação |
| Editor/autosave/recomendações | Aprovado: layout e funcionalidades preservados, retorno protegido e rascunho recuperado; regressões Fases1–4 |
| SQLite/histórico | Aprovado: V10, integridade/FKs, restart e snapshot/bytes do PDF preservados |
| Responsividade/acessibilidade | Aprovado: 1440/390/320, alvos/rótulos/foco, ação oculta fora da árvore acessível, sem colisão/corte/overflow indevido |

## Limitações

Os testes de toque são em Chromium com emulação móvel e entrada real do protocolo CDP, não homologação em aparelho físico/iOS. Não se altera a regra de curadoria, intensidade, preço, FC/FR/FV/FD/MR, energia, quantidades ou emissão. Nenhuma conferência produtiva dos cadastros foi realizada nesta tarefa. Não há operação de publicação autorizada nesta entrega; parar no PR para auditoria.
