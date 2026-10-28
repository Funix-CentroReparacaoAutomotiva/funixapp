# Editor de diagnóstico e painel financeiro aprovados

Base: main `ef7633f310e0b8b8f498df4445012e408e8df3e7`. Branch: `feat/editor-autosave-mr`. Implementação para revisão independente, sem homologação produtiva, merge ou deploy.

## Entrega

- Editor com cabeçalho/diagnóstico, serviços e componentes nas duas linhas previstas, nota única da peça, ícones e divisórias dos HTMLs. Não há Salvar diagnóstico. Notas e diagnóstico históricos por serviço permanecem nos contratos e nas gravações, sem novos campos visíveis.
- Seletores/toggles válidos salvam imediatamente; texto usa debounce de 450 ms. Rascunhos sem identificação/quantidade válida ficam locais e sinalizados. Preço manual ausente é uma pendência válida de componente; zero é válido. Valores calculados são do backend.
- Gravações sequenciais, identidade de serviço preservada inclusive em serviços repetidos; chave visual estável impede perda de foco ao receber o ID de uma linha nova. Não usa localStorage como banco.
- Falha pausa o autosave e mantém os campos. Tentar novamente reconcilia resposta perdida com o conteúdo salvo; um conflito com conteúdo mais novo não é sobrescrito. Carregar versão salva exige confirmação de descarte local. Não há retry cego de mutações. Sessão expirada oferece autenticação sem apagar o formulário; na conferência, a renovação mantém o token e a chave de emissão.
- Componentes são editados dentro da peça. Novo componente tem UUID estável de criação (`clientId`) e pode ser reenviado sem duplicação quando a resposta se perde. Exclusões persistidas exigem confirmação global. A exclusão da peça inteira permanece no menu superior quando seu editor está aberto, sem acrescentar controles ao cabeçalho aprovado. Inclusões continuam máscaras do cenário ativo.
- Painel financeiro único no rodapé de Diagnósticos/Mapa, recolhível pelo resumo inteiro; quatro seletores Tabela/FC/FR/MR. Negociação recolhível com duas opções, reais à direita e zero sem ajuste. Os totais/ajustes líquidos são calculados com Q/BigInt no servidor.
- Emitir orçamento obtém a prévia sem exigir clique em Conferir prévia. Abre conferência detalhada modal, mantém validações, exige confirmação expressa e ciência residual, conserva token e chave idempotente durante reenvio. Prévia não emite. PDF real e versões A…AA preservados.
- O menu superior de cenários contém **Histórico e configuração comercial**. Histórico lista versões e permite leitura/PDF; configuração reutiliza `PricingEditor`, incluindo cadastro explícito das opções MR. Não é etapa intermediária da emissão. As APIs administrativas de catálogos permanecem autenticadas, como na base; não se criou nova tela de catálogos na operação.

## MR e dados anteriores

Nenhuma migração SQL nova nem UPDATE em massa. O schema SQLite permanece V6. Opções MR e seleção usam propriedades opcionais nos JSONs já existentes (`resaleMultipliers`, `mrId`). PATCH parcial preserva parâmetros omitidos; configuração legada que omite a lista MR também a preserva.

O novo cálculo de componente é `teto_R$0,05(preço manual × MR global) × quantidade`. MR não altera serviços, energia nem a negociação. FCT individual não participa mais do cálculo novo e continua armazenado para compatibilidade. Notas, quantidades fracionárias, flags, IDs e preços manuais não são convertidos. Nenhum MR é deduzido de FCTs uniformes/divergentes, nem são inventadas opções neutras.

Rascunhos antigos com componentes ficam com pendência enquanto MR não for cadastrado/selecionado explicitamente. Selecionar MR recalcula a revenda do rascunho em todos os cenários; não regrava o componente nem recalcula versões emitidas. Snapshot schema 1 e BLOB PDF são lidos imutavelmente. O teste dedicado insere um snapshot histórico representativo com FCT e prova preservação exata do registro/PDF após escolher MR; outros testes cobrem persistência, atualização de base V5/V6, rollback e máscaras.

## Arquivos e contratos

| Área | Arquivos |
|---|---|
| Editor/autosave | `src/DiagnosisEditor.tsx`, integração em `CommercialPanel.tsx` |
| Painel/conferência | `src/FinancialPanel.tsx`, `src/negotiation.ts` |
| Visual original | `src/approved.css`, `src/ApprovedIcon.tsx`, HTMLs originais em `docs/referencias/editor-financeiro/` |
| Histórico/configuração | `src/BudgetPanel.tsx`, `src/PricingEditor.tsx`, `src/ScenarioMenu.tsx` |
| DTO/configurações MR | `shared/pricing.ts`, `server/pricing-config.ts` |
| Cálculo exato | `server/pricing-engine.ts` (serviços, especial, energia e distribuição de negociação preservados) |
| Criação/reenvio de componentes | `server/components.ts` |
| Testes | `server/tests/mr-contract.test.ts`, fixtures/expectativas de `pricing.test.ts` e `issue15.test.ts`; runner e scripts browser indicados abaixo |

`server/budgets.ts`, `server/pdf.ts`, migrações, autenticação, infraestrutura e workflows não foram alterados. O handshake existente continua autoritativo.

## Verificação reproduzível

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
python3 tests/browser/editor_financeiro_regressions.py
git diff --check
```

Resultado detalhado e comandos: [evidências/COMANDOS.md](evidencias/editor-financeiro/COMANDOS.md). Todos os dados de QA são sintéticos, com senha efêmera, banco temporário em arquivo e processos próprios em loopback. Nenhuma credencial Coda é repassada. O runner para se as portas estiverem ocupadas; não encerra serviços alheios.

O runner atual cobre editor/painel desktop e mobile, 503, 409, resposta perdida após gravação, digitação durante autosave, foco de linha nova, incompletos, zero/ausência de preço, repetição/exclusão, MR global, cenários/abas sem GET redundante, negociação pelo total, emissão direta/idempotência, histórico, configuração, PDF imutável e reinício real da API. Reexecuta também os testes existentes de Atendimentos, cenários e inclusão de peças, com seletores/fluxo de autosave atualizados onde necessário.

Os scripts antigos de catálogos/PR11/integrado/Issue15 com botão Salvar, FCT ou rodapé antigo permanecem como evidência histórica; não foram declarados aprovados nesta UI. O runner atual substitui esses roteiros operacionais, e a suíte Node continua verificando os contratos e cálculos anteriores aplicáveis. Não se alteraram workflows para instalar navegador ou infraestrutura nova.

## Comparação visual e diferenças explícitas

Capturas reais de viewport **1440×960** e **390×844**, recortes dos componentes e renderizações dos HTMLs originais na mesma largura estão em [evidências](evidencias/editor-financeiro/). Os testes comparam estilos computados de cores, tipografia, geometria, alinhamento e controles com os HTMLs fornecidos; não afirmam igualdade de pixels com o PNG do usuário.

- [Editor desktop](evidencias/editor-financeiro/desktop-editor.png) · [recorte](evidencias/editor-financeiro/desktop-editor-recorte.png) · [HTML original na mesma largura](evidencias/editor-financeiro/desktop-editor-referencia.png).
- [Editor mobile](evidencias/editor-financeiro/mobile-editor.png) · [recorte](evidencias/editor-financeiro/mobile-editor-recorte.png) · [referência](evidencias/editor-financeiro/mobile-editor-referencia.png).
- [Painel desktop recolhido na negociação](evidencias/editor-financeiro/desktop-financeiro.png) · [recorte](evidencias/editor-financeiro/desktop-financeiro-recorte.png) · [referência](evidencias/editor-financeiro/desktop-financeiro-referencia.png).
- [Painel mobile](evidencias/editor-financeiro/mobile-financeiro.png) · [recorte](evidencias/editor-financeiro/mobile-financeiro-recorte.png) · [referência](evidencias/editor-financeiro/mobile-financeiro-referencia.png).
- [Negociação aberta desktop](evidencias/editor-financeiro/desktop-financeiro-negociacao.png) · [mobile](evidencias/editor-financeiro/mobile-financeiro-negociacao.png).

Preservou-se o shell V20 de largura máxima 520 px; as referências foram comparadas na largura efetiva de cada componente, sem alargar toda a aplicação para reproduzir a tela de 580 px do exemplo. O painel termina na borda inferior do shell e limita a altura/rola quando necessário. O indicador acrescenta o estado real de persistência (`Salvo`, `Salvando…`, rascunho ou erro); valores/opções reais substituem exemplos do desenho. Conferência modal, erros e caminho de histórico/configuração são adaptações funcionais fora das duas imagens. A conferência mantém foco/modalidade e impede interação com campos atrás dela. A ação IA indisponível não sobrepõe o novo painel. Funil/Chat e mapa não foram redesenhados.

## Limites e decisões pendentes

- A direção precisa cadastrar as opções reais de MR e selecioná-las nos Atendimentos antigos antes de novas emissões com componentes. Não há valores presumidos nem migração de FCT; essa é a decisão comercial já recebida.
- Rascunhos incompletos/erros não são banco confirmado. A navegação avisa antes de descartá-los; não há armazenamento offline de rascunhos. Conflitos exigem revisão explícita, sem mesclar edições automaticamente.
- Homologação visual/funcional pela direção e autorização separada de publicação permanecem pendentes. Não existe bloqueio técnico identificado que exija redesenho ou nova infraestrutura.
