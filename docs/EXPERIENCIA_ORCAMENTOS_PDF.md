# FUNIX — Prévia PDF, histórico, prazo e navegação

Base: `main` `d9e11ea6e9b4c89ea035caec109d68f9179e9012` (PR #40 integrado). Branch: `feat/pdf-previa-historico-navegacao`.

## Resultado e contratos

1. **Emitir → PDF → Voltar/Confirmar.** Sai a conferência textual/checkbox. A nova rota autenticada `POST /api/atendimentos/:id/orcamentos/previa-pdf` recebe cenário, negociação e token da prévia JSON existente. Reutiliza `build`, adaptador, template `FUNIX - Orcamento`, cliente/timeout/limites e configuração jsreport existentes. Renderiza `PRÉVIA` e verifica o token antes/depois do HTTP. Não grava tentativas, numeração, histórico ou PDF temporário. Não mantém transação SQLite durante HTTP. O PDF fica em Blob URL no navegador, revogado ao sair; requisição pendente é abortada ao desmontar.
2. **Confirmar** mantém o POST definitivo, reserva, revisão, lease e chave de idempotência existentes. O resultado persistido dispara um único download por handler protegido, sem efeitos de montagem. Resposta perdida ou emissão em processamento conserva a mesma solicitação e impede abandonar um resultado incerto. Versão gravada com download falho oferece **Baixar novamente**, exclusivamente pelo GET do BLOB armazenado. O sucesso fecha a prévia. Falhas conhecidas de validação permitem Voltar e preparar nova conferência.
3. **Histórico compacto:** lista devolve também `scenarioId` do snapshot. Agrupamento por ID congelado; ordem numérica extraída do nome de cenário já congelado; letras A/B/C derivadas da sequência de emissão dentro de cada grupo. A sequência global persistida, a letra legada, OR, UUIDs, snapshots, BLOBs e links antigos não mudam. Não consulta cenários vivos para atribuir documentos. Data/hora exibidas no fuso de São Paulo. Linha: letra / identificação+data / total / download com nome acessível. Consulta pelo restante da linha mantém rota existente.
4. **Prazo:** quinto indicador à direita do Total, somente número ou `—`. A função `executionDeadline` foi movida literalmente para `shared/budget-terms.ts`, mantendo reexportação do backend. Automático e manual seguem a mesma regra; rascunho/salvamento pendente e erro não mostram promessa desatualizada. Cinco indicadores e chevron cabem na mesma linha também em 320 px, acima da área do Copiloto.
5. **Gestos e transições:** swipe deliberado sobre o SVG permite voltar do Mapa, inclusive quando começa em região com `role=button`. Não relaxa exclusões de radial, diálogos, formulários, linhas e áreas de rolagem horizontal. Click de compatibilidade após swipe é consumido; toque novo, mouse e teclado continuam funcionando. Sem wrap. Transições nativas de 230 ms deslocam somente a superfície principal, mantendo financeiro/Copiloto e componentes existentes; direção segue Chat/Diagnósticos/Mapa. Movimento reduzido desliga a animação. Pedidos de navegação concorrentes não aplicam callback de rota antiga.

O reconhecimento explícito de resíduo de negociação continua na área de negociação, antes de gerar uma prévia emitível. Não foi convertido em aceitação automática nem em nova confirmação de emissão.

## Persistência e preservações

**Sem migração, mudança de esquema, carga ou acesso a banco instalado.** API `/previa` JSON, POST de emissão e GETs históricos preservados. A única ampliação de leitura da lista é `scenarioId`. Preço, energia, rateio, desconto, MR, parcelamento e prazo não tiveram fórmulas alteradas. A4 e HTML do jsreport não foram editados. Testes comprovam zero `total_changes()` durante prévias, nenhuma tentativa reservada, primeiro OR ainda 000001, equivalência do JSON comercial entre prévia e oficial (exceto meta), recuperação idempotente e imutabilidade histórica após renomear/remover cenários.

## Arquivos

- `server/budgets.ts`, `server/app.ts`: prévia binária transitória e identidade histórica na lista.
- `shared/budget-history.ts`: agrupamento/letras de apresentação; a função de letras preexistente foi compartilhada sem alterar o algoritmo.
- `shared/budget-terms.ts`, `server/budget-terms.ts`: mesma resolução de prazo compartilhada.
- `src/FinancialPanel.tsx`: conferência pelo PDF, recuperação, download e prazo resumido.
- `src/BudgetPanel.tsx`, `src/budget-experience.css`: histórico compacto, viewer, layout e transições.
- `src/App.tsx`, `src/detail-navigation.ts`, `src/CommercialPanel.tsx`: gestos, superfície de transição e consistência de rota.
- Testes Node/API, fixture HTTP jsreport exclusivamente sintética e três suítes de navegador. `fase5_gestures.py` só acrescenta espera pela transição antes dos toques físicos CDP; suas verificações de seleção/exclusão/autosave permanecem.
- `docs/API.md`: contrato aditivo da prévia e da leitura de histórico.

## Matriz de aceitação

| Escopo | Verificação | Evidência |
|---|---|---|
| Prévia | PDF válido incorporado, Voltar sem versão/número/download, fallback e revogação do Blob | Node/API + navegador nas três larguras |
| Emissão | Duplo clique grava/download uma vez; render falho mantém reserva; confirmação usa JSON comercial equivalente | Node + navegador |
| Recuperação | Resposta perdida, processamento pendente e falha de download preservam a identidade/chave/PDF original | Node + navegador |
| Revisões | Mudança de parcelamento entre conferência e confirmação bloqueia; alteração durante render bloqueia prévia | Node + navegador |
| Histórico | Cenários 1/2; A–E/A–B apesar de sequência global intercalada; totais antes do ícone; links mantidos | Node + navegador + screenshots |
| Imutabilidade | Hash do PDF e snapshot preservados após mudanças, restart e exclusão/renomeação do cenário | Node + navegador |
| Prazo | Automático/manual, troca de cenário, rascunho inválido e capacidade ausente; cinco colunas sem colisão | Node + navegador + screenshots |
| Navegação | Ambos sentidos, extremos sem wrap, SVG, vertical, radial, mouse/teclado, movimento reduzido e trocas rápidas | Navegador + regressões de gestos |
| Comercial | Motor oficial, rateios/categorias, condições, parcelas e todos os contratos existentes | `npm run check` + regressão de categorias |
| SQLite | V12, integridade, FKs e persistência após reinício da API | Node + navegador |

## Execução local e evidências

Somente SQLite temporário e dados sintéticos. Renderer HTTP autenticado **sintético e local**: não é o jsreport instalado na VPS. A prévia de teste mostra o DTO recebido em PDF válido; não pretende reproduzir o layout do template produtivo. Produção utiliza o mesmo cliente/adaptador/template existente. Nenhum teste utilizou credenciais comerciais, Coda ou VPS.

Comandos e resultados finais estão em [evidências](evidencias/orcamento-experiencia/README.md). Testes de interface: Chromium 154/Playwright, desktop 1440×1000 e mobile **emulado** 390×844/320×844. Evidências dos cenários atuais e das regressões foram separadas dos relatórios históricos.

## Limitações e riscos remanescentes

- Duas renderizações por emissão confirmada são intencionais: prévia sem identidade comercial e documento oficial com OR. Falha do jsreport na primeira não reserva número; falha na segunda conserva a reserva para recuperação pelo mecanismo existente.
- Viewer nativo depende do navegador; o link secundário abre o mesmo Blob em outra aba sem gerar novo PDF nem baixar automaticamente. Testado em Chromium emulado; aparelho físico/Safari e integração com jsreport instalado ficam para homologação após aprovação, sem presumir acesso produtivo.
- View Transitions é API nativa. Navegadores antigos sem suporte conservam troca imediata funcional; não foi adicionada biblioteca ou réplica de componentes. Sistemas com movimento reduzido não animam.
- Eventual legado sem `scenarioId` não é associado por aproximação. Nome histórico não numérico permanece no grupo histórico, depois dos cenários numerados. Não se reescreve snapshot para completar metadados.
- Emissão com resultado incerto precisa ser recuperada com a mesma confirmação antes de fechar; não há novo mecanismo de recuperação entre recargas completas do navegador, além do histórico/idempotência já existentes.

Sem merge, deploy, mudanças de infraestrutura ou template instalado.
