# PR17 — ajustes após auditoria da direção

Branch existente `feat/editor-autosave-mr`; referência auditada `bbcaa82fe667dfef9da8ff49ec72fb22df9cfc91`. Esta entrega aplica as decisões recebidas após a aprovação conceitual do editor/painel. Não altera produção, infraestrutura, workflows ou integrações externas.

## 1. Configurações globais

A navegação inicial passa a ter Conversas, Funil e **Configurações**. A rota `/configuracoes` é autenticada e funciona sem selecionar/criar Atendimento. `SettingsPage.tsx` reutiliza `CatalogManager` em **Catálogos** e `PricingEditor` em **Precificação**, sem criar novos tipos de configuração ou permissões SaaS.

- Catálogos: peças, diagnósticos, serviços, dimensões, busca, edição, inativação e histórico existentes. Foram explicitados rótulos acessíveis dos seletores/código, sem mudar seus controles ou regras.
- Precificação: tabelas, FC, FR, MR, bases, dimensões/FD, preços especiais por chave, etapas/energia, capacidade e condições existentes. Abrir configuração vazia não a marca indevidamente como editada.
- Os avisos de descarte e a proteção durante gravação valem para troca de área, subseção, voltar no navegador e fechar/recarregar. Falha/sessão expirada preservam formulário e permitem recuperação.
- A seleção Tabela/FC/FR/MR por Atendimento continua somente no painel financeiro. O menu do Atendimento passa a exibir **Histórico de orçamentos**, sem a configuração global duplicada; leitura de versões e download do PDF permanecem acessíveis.

## 2. Valores durante autosave/recalculo

`calculation-state.ts` compara somente identidades e atributos digitados com os confirmados no workspace; não calcula valores monetários. A assinatura por serviço inclui campos que afetam sua elegibilidade/preço e as flags de inclusão. Componentes e exclusões também invalidam os totais afetados.

| Situação | Linha alterada | Linha não afetada | Totais financeiros afetados |
|---|---|---|---|
| Campos atuais ainda não confirmados | Calculando… | Último cálculo correspondente aos seus campos | Calculando… |
| PATCH confirmado, GET recalculado ainda pendente | Calculando… | Valor confirmado correspondente | Calculando… |
| Falha na gravação/leitura | Valor não atualizado | Valor confirmado correspondente | Não atualizado |
| Recuperação e workspace confirmado | Novo valor do backend | Valor do backend | Totais exatos do backend |

A edição continua disponível; uma linha não bloqueia os campos das demais. O painel também sinaliza mudanças pendentes de fatores e leituras não confirmadas, e não permite conferir/emitir enquanto os totais estiverem sem confirmação. Falha de parâmetro possui **Atualizar valores** para recuperar o estado efetivamente salvo. Valores locais e o mecanismo existente de retry/conflito/ID idempotente não foram substituídos.

## 3. Remoção definitiva do multiplicador individual

- Removido de `ComponentItem`, validação, leitura/gravação SQL e frontend.
- A V7 remove somente a coluna obsoleta da tabela de componentes. Não foi necessário excluir qualquer Atendimento, catálogo ou configuração, nem adicionar reset na inicialização.
- Removido o teste de compatibilidade de snapshot FCT; os demais testes passam a usar exclusivamente MR. Referências remanescentes ao campo antigo são DDLs históricos/fixtures de upgrade, teste negativo de rejeição e documentação da remoção.
- O novo PDF mostra **Preço manual** e **MR do Atendimento**, do snapshot emitido. A extração independente confirma ausência de `FCT` e `undefined`. Snapshots novos não contêm o campo removido.
- Cálculo permanece `teto_R$0,05(preço manual × MR) × quantidade`, com exatidão, quantidades fracionárias, zero explícito e pendências para ausência de preço/MR. Serviços normais/especiais, energia, negociação, residual, token e idempotência continuam intactos.

Os DDLs V1–V6 não foram reescritos: são o caminho histórico de atualização, não suporte operacional ao fator removido. Orçamentos de teste já armazenados podem permanecer como bytes/dados, sem reinterpretação ou código especial; o compromisso verificado de imutabilidade vale para os novos orçamentos emitidos. Procedimento de atualização/backup/retorno em [MIGRACAO_V7_MR.md](MIGRACAO_V7_MR.md). Nenhuma base normal de desenvolvimento ou instalada na VPS foi migrada nesta tarefa; os testes usam arquivos temporários próprios.

## Arquivos principais

| Responsabilidade | Arquivos |
|---|---|
| Navegação e configuração global | `src/App.tsx`, `src/SettingsPage.tsx`, estilos pontuais em `src/App.css`, reutilização em `CommercialPanel.tsx`/`PricingEditor.tsx` |
| Histórico somente do Atendimento | `src/ScenarioMenu.tsx`, `src/BudgetPanel.tsx` |
| Preços pendentes/confirmados/erro | `src/calculation-state.ts`, `DiagnosisEditor.tsx`, `CommercialPanel.tsx`, `FinancialPanel.tsx` |
| Contrato e persistência sem fator individual | `shared/pricing.ts`, `server/components.ts`, migração 7 em `server/migrations.ts` |
| PDF MR | `server/pdf.ts` |
| Testes | `server/tests/calculation-state.test.ts`, `m1-7-migration.test.ts`, `configuration.test.ts`, fixtures/expectativas afetadas; `tests/browser/pr17_auditoria.py` e runner de regressões |

`server/pricing-engine.ts`, `server/budgets.ts`, autenticação e infraestrutura não precisaram de nova regra. Não há nova biblioteca, banco, serviço ou integração.

## Testes e evidências

Comandos e saídas da execução final em [evidencias/pr17-ajustes/COMANDOS.md](evidencias/pr17-ajustes/COMANDOS.md). O runner reexecuta o teste novo de auditoria, o editor/painel aprovado e as regressões existentes de Atendimento, cenários e inclusão de peças. Os casos usam API real local, SQLite em arquivo temporário, senha efêmera e bloqueio de hosts externos.

- Migração real V6 → V7, instalação limpa, preservação dos dados necessários, integridade das máscaras e reinício; falha injetada com rollback da transação completa.
- Administração global, persistência dos cadastros/fatores, inativação/histórico, autenticação e confirmação de descarte em desktop/mobile.
- Debounce/PATCH e GET pós-gravação atrasados separadamente; somente a linha alterada exibe Calculando; nenhuma soma de preço frontend. Erro 503, campos preservados, recuperação e parâmetros pendentes/erro.
- Cenários, serviços repetidos/IDs, falhas de rede/resposta perdida, sessão renovada, emissão direta e idempotência continuam cobertos.
- PDF extraído com `pdftotext`; novos snapshots/PDFs imutáveis após editar dados vivos/reiniciar. Capturas e comparação com os HTMLs originais continuam no runner do editor.

| Evidência | Desktop | Mobile |
|---|---|---|
| Catálogos globais | [captura](evidencias/pr17-ajustes/auditoria/desktop-configuracoes-catalogos.png) | [captura](evidencias/pr17-ajustes/auditoria/mobile-configuracoes-catalogos.png) |
| Precificação global | [captura](evidencias/pr17-ajustes/auditoria/desktop-configuracoes-precificacao.png) | [captura](evidencias/pr17-ajustes/auditoria/mobile-configuracoes-precificacao.png) |
| Calculando | [captura](evidencias/pr17-ajustes/auditoria/desktop-autosave-calculando.png) | [captura](evidencias/pr17-ajustes/auditoria/mobile-autosave-calculando.png) |
| Falha/valor não atualizado | [captura](evidencias/pr17-ajustes/auditoria/desktop-autosave-erro.png) | [captura](evidencias/pr17-ajustes/auditoria/mobile-autosave-erro.png) |
| Editor normal | [captura](evidencias/pr17-ajustes/editor/desktop-editor.png) | [captura](evidencias/pr17-ajustes/editor/mobile-editor.png) |
| Painel normal | [captura](evidencias/pr17-ajustes/editor/desktop-financeiro.png) | [captura](evidencias/pr17-ajustes/editor/mobile-financeiro.png) |

As duas telas aprovadas mantêm cores, pílulas, ordem e espaçamentos normais; apenas os textos transitórios de cálculo/erro são novos. A terceira opção da navegação inicial exige um ajuste responsivo de padding no celular; Funil, Conversas e Atendimento não foram redesenhados. Configurações usa a linguagem e gerenciadores existentes.

## Pendências e limites

Não foi identificada decisão comercial adicional necessária para este escopo. A direção deve fornecer/cadastrar os valores reais de configuração; o aplicativo não os presume. Homologação da direção e autorização futura de publicação/migração continuam necessárias. Este PR não faz merge ou deploy e não modifica VPS, Coda, DNS, Traefik nem outros serviços.
