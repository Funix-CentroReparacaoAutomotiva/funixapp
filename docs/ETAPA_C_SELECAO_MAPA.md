# Etapa C — seleção de peças e mapa

Base aprovada: `24440f75d9837d0a2928de815af525c6f472996e` (main após PR #24). Branch: `ui/etapa-c-selecao-mapa`. Entrega para auditoria, sem merge/deploy ou Etapa D.

## Implementação

- `src/piece-selection-queue.ts`: fila serial em memória por Atendimento/cenário, intenções consolidadas por código real. Alterações pendentes sobrepõem somente as inclusões apresentadas, enquanto SQLite/API permanecem autoridade. As respostas anteriores nunca substituem a intenção mais recente. Uma dupla inversão no mesmo evento consulta a intenção da fila antes do próximo render.
- Reaproveita POST de até dois códigos reais para criar peças e PATCH de máscaras por IDs/revisão para incluir/excluir as existentes. Cada confirmação exige GET do workspace; nenhuma API, tabela, migração ou fórmula nova. A fila usa sua revisão mais recente mesmo se um evento ainda possuir a renderização anterior.
- HTTP, conflito, confirmação ilegível ou resposta perdida interrompem a fila. A intenção permanece visível, com erro e ações explícitas: consultar o estado persistido e retomar, ou descartar só intenções locais. A recuperação lê antes de escrever; não reenvia cegamente um POST que pode ter sido confirmado. Cenário excluído/fallback ou peça pendente removida bloqueiam a retomada e exigem conferência/descarte.
- Lista Diagnósticos: toggles acessíveis por teclado, com `role=switch` e `aria-checked`, equivalentes ao padrão do editor. Alteram somente a máscara do cenário, sem excluir a composição mestre. Enquanto uma inclusão aguarda confirmação, outras peças e níveis do seletor continuam utilizáveis; edição de atributos, troca de cenário, emissão e saída aguardam a resolução, preservando as guardas existentes.
- Feedback neutro de salvamento e contorno pontilhado nos itens/grupos pendentes; valores ficam como Calculando ou não atualizados quando apropriado. Sem confirmação verde por seleção.
- `src/piece-navigation.ts`: projeção funcional do catálogo único em Lataria/Estrutura/Vidros/Acessórios/Interior/Outros no seletor de Diagnósticos. Busca preservada, inclusive cadastros do operador. [Correspondência integral e residuais](ETAPA_C_CLASSIFICACAO.md).
- Grupos/Mapa: nenhuma/parcial/todas com círculo vazio/traço/preenchido e uma família de azul. Contagem por conjunto de códigos únicos ativos identificados, cenário ativo e intenções locais. Grupos vazios nunca ficam completos; indicador de grupo não é ação de seleção em massa.
- Mapa: preserva SVG, regiões e seletor radial. Frente/Traseira exibem Ambos acima e os lados abaixo somente quando a V2 contém um par real válido. Contextos Motorista/Passageiro filtram o lado oposto, removem Ambos e colapsam a escolha redundante. Mesmos códigos e IDs comerciais em todas as perspectivas. Removidos botão superior Buscar peça, orientação permanente e confirmação repetitiva.

## Contratos preservados

Catálogo original e `server/data/hierarquia-v2.json` intactos. Nenhum código/identidade/equivalência comercial criado. Máscaras de serviços/componentes, atributos, cópia/comparação de cenários, autosave do editor, navegação em telas completas, retorno nativo, swipe e Copiloto preservados. FC/FR/FV/FD/MR, negociação, energia, prazo e snapshots/PDF emitidos não foram modificados.

Arquivos funcionais: `src/CommercialPanel.tsx`, `src/App.css`, `src/piece-navigation.ts`, `src/piece-selection-queue.ts`, `src/usePieceSelection.ts`, `src/piece-selection.css`. Alterações restantes são testes, evidências e documentação/AGENTS.

## Validação reproduzível

Somente API/Chromium locais, dados sintéticos e SQLite temporário removido pelos testes. Nenhum uso da exportação privada do Coda nem acesso ao banco do aplicativo existente.

```sh
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/etapa_c_selection.py
python -c "import sys,asyncio;sys.path.insert(0,'tests/browser');import etapa_b_navigation as s;s.ARTIFACTS=s.ROOT/'.runtime/etapa-c/etapa-b-navigation';asyncio.run(s.run())"
python tests/browser/etapa_c_regressions.py
```

Os testes de fila usam os repositórios SQLite reais; o QA de navegador usa arquivo SQLite real e compara as flags com leitura SQL independente. Abrange quatro seleções antes da primeira confirmação, inversões/intercalações, atraso, HTTP 503, resposta perdida após PATCH/POST, recuperação, identidades, lados reais, estados dos grupos, reinício e orçamento/PDF imutáveis. No cenário de quatro peças/intercalações, duas requisições PATCH seriais confirmam o estado final; não é uma medição de latência da VPS.

A regressão Issue12 foi atualizada: o novo limite de confirmação é fila vazia, não botão habilitado; conflitos agora permanecem bloqueados até recuperação explícita; uma segunda seleção alterna a inclusão em vez de abrir o editor. Mantidos os testes de duas sessões, confirmação perdida/truncada, erro em GET, rascunho, retorno e reinício. O editor continua acessível pela linha da peça.

Resultado: **120 testes Node**, **23 testes de scripts**, **18 grupos de navegador Etapa C**, **21 da Etapa B** e **84 de regressões comerciais**, todos aprovados. Lint sem erros, com quatro avisos preexistentes de efeitos em `src/App.tsx`. Os 22 screenshots foram inspecionados por amostras desktop/mobile. Resultados finais e logs estão em [evidências](evidencias/etapa-c/). As suítes antigas gravam artefatos em `.runtime/etapa-c/`, sem sobrescrever evidências históricas. Screenshots usam desktop 1440×1000 e mobile emulado 390×844; nenhum dado real de cliente.

## Evidências visuais

| Cenário | Desktop | Mobile emulado |
| --- | --- | --- |
| Seleções pendentes | [imagem](evidencias/etapa-c/desktop-selecoes-pendentes.png) | [imagem](evidencias/etapa-c/mobile-selecoes-pendentes.png) |
| Toggles confirmados | [imagem](evidencias/etapa-c/desktop-toggles-confirmados.png) | [imagem](evidencias/etapa-c/mobile-toggles-confirmados.png) |
| Classificação funcional | [imagem](evidencias/etapa-c/desktop-classificacao-funcional.png) | [imagem](evidencias/etapa-c/mobile-classificacao-funcional.png) |
| Nenhuma/parcial/todas | [imagem](evidencias/etapa-c/desktop-grupo-todas.png) | [imagem](evidencias/etapa-c/mobile-grupo-todas.png) |
| Mapa | [imagem](evidencias/etapa-c/desktop-mapa-estados.png) | [imagem](evidencias/etapa-c/mobile-mapa-estados.png) |
| Frente e lados | [imagem](evidencias/etapa-c/desktop-frente-ambos-lados.png) | [imagem](evidencias/etapa-c/mobile-frente-ambos-lados.png) |
| Traseira e lados | [imagem](evidencias/etapa-c/desktop-traseira-ambos-lados.png) | [imagem](evidencias/etapa-c/mobile-traseira-ambos-lados.png) |
| Motorista direto | [imagem](evidencias/etapa-c/desktop-motorista-contextual.png) | [imagem](evidencias/etapa-c/mobile-motorista-contextual.png) |
| Passageiro direto | [imagem](evidencias/etapa-c/desktop-passageiro-contextual.png) | [imagem](evidencias/etapa-c/mobile-passageiro-contextual.png) |
| HTTP antes da gravação | [imagem](evidencias/etapa-c/desktop-http.png) | [imagem](evidencias/etapa-c/mobile-http.png) |
| Confirmação perdida | [imagem](evidencias/etapa-c/desktop-lost-patch.png) | [imagem](evidencias/etapa-c/mobile-lost-patch.png) |

## Limitações e decisões pendentes

- Os 14 códigos residuais da V2 e famílias novas desconhecidas ficam em Outros, utilizáveis sem aprovação adicional. A direção pode posteriormente definir uma categoria mais específica; nenhuma pendência exige alteração do modelo ou impede esta entrega.
- Intenções ainda não confirmadas ficam na memória, sem novo armazenamento local durável. As guardas protegem retorno/saída; uma interrupção forçada do navegador não pode garantir a preservação de intenção não gravada. O SQLite confirmado não é apagado por descarte local.
- Recuperação exige ação explícita; não há retentativa silenciosa ou resolução arbitrária de conflito. Enquanto a fila está incerta, as demais mutações ficam bloqueadas por segurança.
- Workspace continua calculando todos os cenários, como na base aprovada; não foi ampliado o escopo de desempenho ou a independência preço/energia.
- Testes mobile são emulação Chromium, sem homologação em aparelho físico ou produção.
