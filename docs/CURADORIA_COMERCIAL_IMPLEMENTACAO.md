# Curadoria comercial — implementação para auditoria do PR #32

Base: `b29a80182dafa0c2055c531960c436b393456d3a`, branch `feature/revisao-integrada-funix`. PR continua **draft**. Implementação local e QA sintético; nenhuma importação real, alteração Coda/VPS/banco instalado, merge ou deploy.

## Autoridade e decisões

Issue #31, comentários [6559833804](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/31#issuecomment-6559833804), [6559947927](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/31#issuecomment-6559947927), [6560186782](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/31#issuecomment-6560186782), [6560504469](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/31#issuecomment-6560504469) e [6560532482](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/31#issuecomment-6560532482). A autorização final substitui a restrição de apenas propor dos comentários anteriores.

Decisão adicional expressa do proprietário nesta execução: **permitir emitir orçamento composto somente por atividades sem cobrança**. Isso não autoriza inventar preço unitário zero, energia, capacidade ou condições comerciais. O total agregado desse orçamento é zero; as linhas não faturadas têm preço não aplicável (`null`).

## Alterações e contratos

| Área | Arquivos | Resultado |
| --- | --- | --- |
| Política versionada | `shared/commercial-curation.ts`, `server/curation.ts` | 28 IDs Coda explícitos; visibilidade, execução, cobrança e grupo independentes de `catalog.active`; versão e SHA-256 do manifesto |
| Inclusão / referências | `server/commercial.ts`, `shared/commercial.ts` | Ocultos e grupo bloqueado recusados antes de novas inclusões, inclusive via API; referências anteriores mantêm os IDs e continuam editáveis |
| Confirmação | `server/scenarios.ts`, `server/app.ts` | Confirmação explícita por cenário + linha + escopo; revisões de peça e cenário verificadas em transação |
| Persistência V8 | `server/migrations.ts` | Uma tabela de confirmações com FKs e exclusão em cascata; sem alterar linhas ou tabelas existentes |
| Cálculo / documentos | `server/pricing-engine.ts`, `server/budgets.ts`, `server/pdf.ts`, `shared/pricing.ts` | Não faturáveis fora da cobrança, desconto e negociação; energia/prazo mantidos; novos snapshots registram política e confirmações; PDFs históricos não são recalculados |
| Importação | `server/coda-import.ts`, `server/import-coda.ts`, `server/pricing-config.ts` | Projeção completa, política vinculada ao hash, recusa de IDs sem política e divergências locais, exigência de schema exatamente V8; nenhuma migração pelo CLI |
| Interface | `src/DiagnosisEditor.tsx`, `src/diagnosis-editor.css`, `src/CommercialPanel.tsx`, `src/BudgetPanel.tsx`, `src/FinancialPanel.tsx` | Seletores curados, HH no Reparo, confirmação de terceiros, “Sem cobrança” no editor/comparação/prévia; preservados layout e fluxos das Etapas 2–6 |

### Cobertura do manifesto

O manifesto lista integralmente os **28 IDs**, sem preços reais. Os IDs locais continuam `coda:2zsjI-nqWr:grid-lhdFxol6x-:<rowId>`. Não há fusão por nome nem remapeamento dos registros existentes.

- **Interna** `i-qCp1gLfJn4` e **Encantamento** `i-JPNGbPVOdw`: ocultos em novas inclusões. A importação não os apaga nem os desativa para quebrar rascunhos antigos.
- **Diagnóstico Técnico** `i-GsuErCDZgL` / **Inspeção técnica** `i-dMshyG5NMo`: mesmo grupo, sem cobrança. Uma oferta visual, **bloqueada antes de gravar nova linha** até auditoria histórica determinar a identidade. A aplicação não escolhe um ID canônico. Referências antigas são preservadas; um cenário com ambas as origens efetivas bloqueia emissão para revisão explícita.
- **Descontaminação** `i-lMM5GA_1uz` e **Proteção e cuidado** `i-odnULcJj8z`: visíveis, atualmente sem cobrança. Com as duas origens técnicas, são quatro identidades no regime `not_billed`.
- **Elétrica** `i-6FW6UIOr8H`, **Vidraçaria** `i-6v-u7Wk73b`, **Tapeçaria** `i-kNfje5jSDQ`, **Mecânica** `i-RoaRcVLUCo`, **Plotagem** `i-qErkcLJo2u`: execução externa sujeita à confirmação por linha/cenário; não são anunciadas como prestação interna confirmada.
- **Reparo** continua HH, distinto de Funilaria; Lavagem, Ducha, Limpeza técnica e Descontaminação não são fundidos; Degradê continua linha independente. Alinhamento e Restauração óptica recebem descrições operacionais específicas, sem renomear os registros armazenados.
- As demais identidades do manifesto permanecem visíveis e faturáveis, condicionadas à configuração real. Nenhum serviço importante foi ocultado por falta de base, FD ou energia.

São 24 identidades habilitadas para novas escolhas, além da oferta técnica única bloqueada e dos dois legados ocultos. Isso **não significa 24 serviços calculáveis**: a calculabilidade depende de dados reais completos, não da visibilidade. Todos os 16 diagnósticos e as 75 dimensões pertinentes são preservados pela projeção; dimensões de serviços ocultos não aparecem como nova oferta operacional, mas suas referências permanecem.

### Não faturáveis, energia e emissão

- Linhas `not_billed` mantêm quantidade, serviço, dimensão e etapas; `unit`, `finalUnit` e `total` ficam `null`, com apresentação “Sem cobrança”. Não se cria preço-base, FD ou fator substituto.
- Essas linhas não entram em subtotal de serviços, base descontável, rateio ou negociação. Em cenários mistos, valores cobrados são calculados pelo motor anterior.
- Energia continua considerando todas as linhas efetivas, inclusive atividades sem cobrança. Etapas ausentes ou capacidade inválida continuam bloqueando emissão, conforme contrato vigente. Não foi implementada independência nova entre preço e energia.
- Cenário só com atividades sem cobrança pode emitir, se tecnicamente válido; total agregado zero não representa preço unitário artificial. Negociação inválida não é apagada automaticamente.
- Mantidos FC condicional, FR no normal, FV, especial pela tripla exata, desconto elegível, MR único por Atendimento, quantidades exatas e teto monetário existente.

### Confirmação de terceiros

`PATCH /api/atendimentos/:at/cenarios/:scenario/servicos/:line/confirmacao`, com `revision`, `pieceRevision`, `scope` e `confirmed` explícitos. O escopo inclui versão/política, serviço, dimensão e quantidade normalizada; cenário e linha são as chaves persistidas.

Não pode ser forjada pelo PATCH genérico de diagnóstico ou cenário. Copiar cenário não copia a confirmação. Alterar serviço/dimensão/quantidade compartilhados revoga confirmações dessa linha em todos os cenários. Desabilitar a peça ou serviço revoga a confirmação no cenário afetado. Falha ou resposta perdida exige consulta de reconciliação antes de repetir; não há retry cego. Autenticação, origem e concorrência são verificadas pelo backend. Essa confirmação é operacional e não constitui novo sistema de auditoria de usuários.

### Migração e importação

V8 é indispensável para persistir confirmação por cenário/linha. A migração é aditiva e não recalcula dados anteriores. Ensaiada apenas em bancos temporários sintéticos, incluindo banco V7 com referências e orçamento/PDF reais do escritor anterior, reinício e rollback de falha.

O importador **exige schema exatamente V8**; não chama `openDatabase` nem migra automaticamente o destino. O relatório contém `curation` com versão, digest e decisões por ID. O hash do plano inclui o manifesto completo, a origem e o estado de destino. ID de serviço Coda desconhecido ou política local divergente causam conflito, sem aplicação parcial. Um conflito de projeção é apresentado no relatório antes da validação de FKs em memória, evitando exceção sem diagnóstico.

O fluxo continua captura íntegra → projeção → curadoria → validação → dry-run → confirmação exata. Não existe whitelist reduzida de cinco serviços. A política controla novas inclusões, não ativa cadastros localmente desativados nem substitui configuração local divergente. Segunda aplicação usa novo dry-run e não duplica nem altera revisões. A fonte privada não foi aplicada nesta entrega.

**Procedimento futuro, não autorizado agora:** disponibilizar a versão auditada com V8, conferir a versão do destino em leitura, realizar backup consistente e ensaio isolado com fonte aprovada; executar dry-run explicitando fonte e banco V8; revisar conflitos/pendências/manifesto; só então autorizar `--confirm-plan` para o hash vigente, sem edição concorrente. O CLI não prepara V8 por conta própria. Não usar comandos históricos V7 como se fossem compatíveis com esta revisão.

## Matriz de aceitação

| ID | Critério | Evidência / resultado local |
| --- | --- | --- |
| CUR01 | 28 IDs, política explícita, sem novos preços | Manifesto + teste de cardinalidade e regimes |
| CUR02 | Interna/Encantamento ocultos; rascunhos legados preservados | Backend e seletor; teste edita referência antiga e conserva histórico |
| CUR03 | 16 diagnósticos e 75 dimensões, inclusive incompletas | Projeção sintética completa, FKs e idempotência; seletor com 16 opções |
| CUR04 | Não faturáveis fora do dinheiro, sem preço falso | Teste misto com quantidade fracionária; negociação e desconto preservados |
| CUR05 | Emissão somente sem cobrança | Node e navegador: total agregado zero, unitário null, PDF e idempotência |
| CUR06 | Energia/capacidade não inventadas | Ausência bloqueia; snapshot/PDF anterior permanece inalterado |
| CUR07 | Oferta técnica única, IDs preservados | Opção única bloqueada; backend 409 antes da gravação; conflito de duas origens antigas não resolvido silenciosamente |
| CUR08 | Terceiro exige confirmação persistida por linha/cenário | API/auth/origem/revisões/escopo; cópia sem herdar; alteração e desabilitação revogam |
| CUR09 | Resposta perdida não duplica confirmação/emissão | Navegador com gravação confirmada e resposta perdida, GET de recuperação, uma versão |
| CUR10 | Importador preserva ajustes locais e é idempotente | Testes sintéticos de conflito, hash, não sobrescrita, duas cargas e zero duplicação |
| CUR11 | V7→V8 não altera dados/histórico | Escritor V7 congelado em fixture, comparação das tabelas anteriores e bytes PDF; rollback de falha |
| CUR12 | Etapas 2–6 e contratos comerciais preservados | Suítes de regressão de seleção global, autosave, cenários, Mapa 163/23, editor, rodapé, emissão e PDF |
| CUR13 | Desktop / 390 / 320 e acessibilidade | Screenshots e grupos de navegador com teclado, estados, recuperação e ausência de overflow |
| CUR14 | CI remota do mesmo commit | Resultado e link registrados no PR #32 e na Issue #31 após publicação da branch; sem alterar workflow |

## Testes reproduzíveis e evidências

Somente dados sintéticos e SQLite temporário. IDs Coda reais são identificadores do contrato; os preços, descrições de QA e etapas das fixtures **não representam dados comerciais reais**. A fixture completa 28/16/75 comprova estrutura e retenção, não aprovação/importação da fonte privada.

```bash
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/curation_final.py
python tests/browser/curation_regressions.py
```

Navegador exige Chromium/Playwright e portas locais livres; executar as suítes em sequência. Os testes não precisam de token Coda. Os escritores pré-curadoria em `server/tests/fixtures/pre-curation/` são fixtures congeladas da base para construir bancos antigos antes de testar migração; não são outra implementação em produção nem camada nova de compatibilidade.

Resultados e logs finais ficam em [evidencias/curadoria-final](evidencias/curadoria-final). **Resultado final: 188 testes Node, 23 testes dos scripts de implantação e 220 grupos de navegador aprovados (21 específicos + 199 regressões em 15 suítes).** Build/TypeScript/lint sem erros, com quatro avisos preexistentes em `App.tsx`. São 21 grupos específicos, sete por resolução, com 21 screenshots. O runner de regressões conserva as evidências anteriores e produz seu resumo em `.runtime/curadoria-final/regressions/summary.json`; uma cópia sanitizada é entregue junto das evidências desta revisão. Logs de CI remota ficam no workflow apontado no PR/Issue.

Inspeção visual das capturas: mantidos editor, cores, disposição, rodapé e navegação aprovada; acrescentados somente aviso de atividade sem cobrança e checkbox de confirmação externa. Em 320 px, selects nativos abreviam o texto fechado como antes; as opções completas continuam acessíveis no seletor. Os testes de emulação não substituem homologação física em celular.

## Pendências reais e limites

1. **Identidade da atividade técnica:** falta auditoria de referências históricas para escolher o ID operacional. A oferta nova permanece bloqueada, com motivo explícito; não há fusão automática. Essa é uma pendência material, não um preço faltante a inventar.
2. **Dados instalados:** nenhuma carga aprovada foi executada; a disponibilidade real de catálogos/fatores no SQLite da VPS não pode ser certificada por QA sintético. A01–A09 continuam dependentes de operação futura autorizada e validação no destino.
3. **Parâmetros incompletos:** bases, FD, energia e capacidade ausentes continuam pendentes na origem/configuração. Preservar visibilidade não transforma serviço em calculável.
4. **Implantação V8 futura:** a atualização normal aplicará a migração aditiva quando autorizada. Não executada em banco instalado nesta tarefa. Importador antigo V7 e novo V8 não são intercambiáveis.
5. **Regras monetárias:** não foi mudada a matemática de serviços cobrados nem a imutabilidade das emissões; a alteração autorizada é a exclusão explícita do regime sem cobrança e a exigência de confirmação externa.

Sem novas integrações, importação real, merge, deploy ou mudanças de infraestrutura. Entrega deve permanecer em auditoria no PR #32 draft.
