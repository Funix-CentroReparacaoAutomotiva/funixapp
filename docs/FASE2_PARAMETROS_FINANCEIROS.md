# Fase 2 — padrões financeiros, FC/FR e MR percentual

Base: `main` em `3a07568d7b8a1a54fa5fd56523d4e76ce21ff919`. Branch exclusiva `feature/fase2-parametros-financeiros`. Sem acesso à VPS, Coda, SQLite instalado ou exportação privada; sem importação, merge ou deploy.

## Diagnóstico anterior e comportamento entregue

O painel já tinha quatro controles financeiros e administração de fatores. FC/FR mostravam números em vez de nomes. O MR exigia `mrId`/`resaleMultipliers`; cada escolha dependia de cadastro global. A criação do Atendimento não persistia padrões financeiros. O motor já implementava o teto unitário de R$ 0,05 antes da quantidade, revisão de configuração, prévia/token, negociação e PDFs imutáveis: esses contratos foram reutilizados.

| Item | Agora |
| --- | --- |
| Novo Atendimento | Padrão/C1/R1/MR20% persistidos na mesma transação de criação, se os cadastros necessários existirem |
| FC/FR | Dropdowns mostram `name`; continuam persistindo IDs e usando os fatores correspondentes |
| Administração | Reutiliza nomes/valores existentes; acrescenta somente três seletores de padrão e MR padrão percentual |
| Alterar padrões | Afeta novos Atendimentos; não altera escolhas registradas |
| MR do Atendimento | Percentual livre, incluindo zero e decimais, sem criar fatores globais |
| Gravação de MR | Ao sair do campo ou pressionar Enter; texto preservado durante digitação; inválido/incompleto não é gravado |
| Falha/confirmação incerta | Mantém a intenção digitada, bloqueia a emissão e exige leitura antes de tentar salvar novamente |
| Componentes | Usam somente o MR do Atendimento; valor pendente/incompleto/erro não mostra total antigo como confirmado |

## Persistência e compatibilidade

O esquema permanece **V8**, sem tabela nova nem migração. `commercial_state.settings_json` guarda `mrPercent` e `defaultsInitialized`; `pricing_configuration.data` guarda `defaults:{tableId,colorId,riskId,mrPercent}`. Os campos de padrões podem ser null para representar pendência explícita.

A resolução inicial usa nomes únicos Padrão/C1/R1 e guarda seus IDs; não compara os fatores 1,01/1,06 para descobrir identidades. Alterações de fator/nome preservam o ID escolhido. O servidor reutiliza padrões já persistidos quando clientes anteriores omitem o novo campo. Se faltar um cadastro ou houver nomes ambíguos, não escolhe outro fator por aproximação. A ausência permanece pendente, sem fabricar cadastros.

Para Atendimentos legados, a UI usa um POST autenticado de inicialização idempotente, nunca uma escrita em GET. Uma transação preenche somente propriedades realmente ausentes, preserva valores explícitos e marca a inicialização. Revisões da composição/cenários são incrementadas, invalidando prévias anteriores. Repetições não alteram novamente o estado. Na criação, o estado já nasce inicializado.

`null` legado é preservado: não existe evidência para distinguir uma limpeza manual antiga de um null preenchido automaticamente pela API anterior. Os padrões não sobrescrevem essa ambiguidade. Atendimentos criados antes de os cadastros necessários existirem podem, por isso, precisar de seleção manual posterior.

MR legado válido e convertível para percentual não negativo é convertido uma única vez quando o Atendimento ainda não foi inicializado. Fatores abaixo de 1 continuam interpretados pelo caminho legado, sem inventar percentual não negativo, alterar o preço ou aplicar MR novamente; o operador pode substituí-los explicitamente por um percentual válido. Identidades/fatores legados não são apagados. `mrPercent` tem precedência quando presente; null significa pendência. A API rejeita a gravação simultânea de `mrId` e `mrPercent`. Salvar um percentual limpa a referência legada; salvar `mrId` por cliente legado remove a representação percentual.

Percentual API: string decimal não negativa, ponto, até 12 dígitos inteiros e seis casas decimais; UI aceita vírgula/ponto. A conversão para fator usa BigInt e admite as oito casas necessárias ao dividir o percentual por 100, sem ampliar silenciosamente o contrato de todos os demais decimais. O cálculo continua `ceil_0,05(custo × MR) × quantidade`, com zero manual e quantidades fracionárias. Novos snapshots registram percentual e fator; PDFs novos mostram o percentual quando disponível. Snapshots/PDFs antigos não são regravados nem recalculados.

## Interface preservada

A única substituição de controle é MR: input com teclado decimal, sufixo `%`, mesma borda, cores, tipografia e altura de 37 px dos seletores. FC/FR mudam apenas o texto. Expansão/recolhimento, negociação, resumo, emissão e linhas dos componentes não foram reorganizados.

Foi encontrada uma regra preexistente em `footer-copilot.css` que quebrava os quatro controles em duas linhas abaixo de 400 px. Apenas essa regra foi retirada para atender à exigência explícita da Fase 2 de quatro colunas horizontais também em 320/390 px. O resumo financeiro e a geometria do Copiloto permanecem como antes. Esta é a diferença responsiva intencional documentada, além do input de MR e dos controles mínimos de padrões nas Configurações.

## Arquivos e contratos

| Arquivos | Motivo |
| --- | --- |
| `shared/pricing.ts`, `shared/mr.ts`, `shared/financial-defaults.ts` | Tipos, percentual exato e resolução de padrões por identidade |
| `server/financial-initialization.ts`, `server/atendimentos.ts` | Inicialização transacional única e criação com padrões |
| `server/pricing-config.ts`, `server/app.ts` | Validação/configuração persistida, PATCH percentual e POST explícito de inicialização |
| `server/pricing-engine.ts`, `server/pdf.ts` | Consumo do MR percentual e identificação em novas emissões, mantendo a aritmética oficial |
| `src/FinancialPanel.tsx` | Nomes FC/FR, input MR, ACK/reconciliação e proteção do rascunho |
| `src/CommercialPanel.tsx` | Retorno do workspace já consultado para confirmar o MR sem GET redundante; outros consumidores continuam aguardando a mesma operação |
| `src/PricingEditor.tsx` | Controles mínimos de padrões no editor existente |
| `src/component-presentation.ts`, `src/approved.css`, `src/footer-copilot.css` | Percentual/estados oficiais e compatibilidade geométrica do novo controle |
| `server/tests/*`, `tests/browser/*` | Cobertura da Fase 2 e adaptação das ações antigas de dropdown para o contrato percentual |
| `docs/API.md`, `AGENTS.md`, este relatório e evidências | Contratos vigentes, reprodutibilidade e auditoria |

Não foram alterados seleção/exclusão da Fase 1, fila de peças, swipe, classificações/Mapa, fórmulas de serviços/energia/prazo/desconto/negociação, migrações, importador, workflows ou infraestrutura.

## Matriz de aceitação

| Requisitos da solicitação | Evidência |
| --- | --- |
| 1–2 Padrões, reload e reinício | `fase2-financial.test.ts`; navegador 1440/390/320 |
| 3 FC/FR por nome | Valores/opções verificados no DOM, sem fatores nos textos |
| 4–5 Edição C1/R1 | Editor existente no navegador; testes de identidade, cálculo, prévia obsoleta e PDF congelado |
| 6 Escolhas manuais | Backend + reload/reinício no navegador |
| 7–10 MR20/30/0/decimais | Tabelas de resultados exatos e seis casas de percentual no Node; vírgula no navegador |
| 11 Entradas inválidas | API 400/nenhuma alteração; UI sem PATCH e totais incompletos |
| 12–14 MR único, teto e quantidade | Resultados unitários/total, zero manual e frações no Node e navegador |
| 15–16 Cenários e Atendimentos | Parâmetros compartilhados; isolamento entre Atendimentos e padrões posteriores |
| 17–18 Legados/escolhas | Inicialização repetida, mrId, redução legada e null explícito preservados |
| 19 Histórico | Snapshot e bytes do PDF idênticos após edição de parâmetros/fatores |
| 20 Concorrência | API 409; resposta perdida; leitura antes de repetição e confirmação explícita do rascunho |
| 21–22 Layout | Caixas medidas dos quatro campos na mesma linha, altura/larguras e ausência de overflow em 1440/390/320 |

## Testes executados

- `npm run check`: build/Vite, TypeScript frontend/backend e **210 testes Node aprovados**; lint sem erros, com quatro avisos preexistentes em `App.tsx` e nenhum novo.
- `python -m unittest discover -s deploy/tests`: **23 testes aprovados**. `bash -n deploy/funix-install deploy/funix-deploy deploy/funix-ssh deploy/test-containers.sh`: aprovado.
- `python tests/browser/fase2_financial.py`: **21 grupos aprovados** em 1440/390/320, incluindo editor, administração dos padrões, medidas dos quatro controles, reinício da API, MR inválido, resposta perdida e concorrência.
- `fase1_selection.run()` com `ARTIFACTS=.runtime/fase2/fase1`: **39 grupos aprovados**, preservando todos os contratos homologados da Fase 1 e os snapshots/PDFs.
- `python tests/browser/fase2_regressions.py`: 16 suítes existentes, **220 grupos aprovados**. A execução foi retomada por nome de suíte (`pr17_auditoria`, `issue22_regressions`, `issue18_import`) após adaptar expectativas antigas de dropdown/valor numérico/PDF ao novo contrato de percentual/nome. Os relatórios finais de todas as 16 suítes foram conferidos individualmente, não inferidos pelo resultado parcial de uma execução.
- Total: **280 grupos de navegador**. Mobile emulado em Chromium, não dispositivo físico. Nenhuma requisição externa, erro JavaScript ou overflow nos cenários validados.

Resultados, logs e matriz agregada em `docs/evidencias/fase2/`. Screenshots: `desktop-*`, `mobile390-*`, `mobile320-*`, com painel, editor, pendência, recuperação e padrões das Configurações. A execução de QA local não representa homologação na VPS. Os smoke tests das imagens Docker e do Compose serão executados pelo workflow existente do PR, sem alterar workflows nem iniciar deploy.

## Limites e revisão

A inicialização não supre cadastros inexistentes nem parâmetros técnicos pendentes. Null legado não é reinterpretado. Reduções legadas de MR não passam a ser uma opção nova de percentual negativo. MR inválido permanece em edição e exige correção antes de emissão; não existe fallback silencioso para zero/20%.

A entrega termina no PR para auditoria. Publicação e validação com os cadastros efetivamente instalados exigem outra autorização. Nenhuma nova decisão de fórmula ou dado comercial foi adotada.
