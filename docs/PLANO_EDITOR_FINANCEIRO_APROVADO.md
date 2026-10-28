> Registro histórico do plano anterior à auditoria. A decisão posterior remove o FCT e centraliza a administração em Configurações; o relatório vigente está em [PR17_AJUSTES_AUDITORIA.md](PR17_AJUSTES_AUDITORIA.md).

# Auditoria e plano mínimo — editor e painel financeiro

Base verificada: main `ef7633f310e0b8b8f498df4445012e408e8df3e7`, PR #16 integrado. Branch local `feat/editor-autosave-mr`. A auditoria inicial não executou migrações. Plano registrado antes da implementação. A entrega desenvolvida e as evidências estão em [EDITOR_FINANCEIRO_APROVADO.md](EDITOR_FINANCEIRO_APROVADO.md).

## Fontes

Especificação de 28/10/2026 e duas imagens apresentadas pela direção. Consultados README, AGENTS, docs/API.md, docs/ISSUE_7_MVP_COMERCIAL.md e docs/PR11_INTERFACE.md. Os documentos antigos descrevem FCT por componente, salvar manualmente e tela intermediária; esses trechos são superados pelo novo contrato, sem autorizar apagar dados anteriores.

## Código observado

- `CommercialPanel.tsx`: composição, rascunho de diagnóstico, serviços e flags; PATCH manual e guardas de contexto. Proteção da Issue #12 continua presente.
- `BudgetPanel.tsx`: componentes, parâmetros, configuração, negociação, emissão e histórico; funções devem ser redistribuídas, não apagadas.
- `negotiation.ts` e `server/budgets.ts`: conversão autoritativa por total geral já existe (`valueIncludesComponents:true`), assim como token de prévia e chave idempotente.
- `server/components.ts`: preço manual, FCT individual e notas; metadados e notas antigos precisam permanecer.
- `server/pricing-config.ts`: configuração versionada, tabelas/FC/FR, sem catálogo MR; parâmetros comerciais são JSON e podem receber campos opcionais sem reconstruir SQLite.
- `server/pricing-engine.ts`: Q/BigInt, preço especial por chave exata, arredondamento unitário, energia e resíduos. Componente ainda usa FCT individual.
- Banco atual: migrações até V6. Nenhuma migração destrutiva é necessária para introduzir opções MR e parâmetro MR em JSON.
- Snapshots/PDFs: cópias congeladas, triggers de imutabilidade. Não atualizar ou regerar.

## Arquivos e contratos mínimos previstos

1. `shared/pricing.ts`, `server/pricing-config.ts`, `PricingEditor.tsx`: lista MR cadastrada explicitamente na configuração e seleção única por Atendimento. Sem seed ou opção neutra inventada. PATCH que omite MR preserva o parâmetro anterior.
2. `server/pricing-engine.ts`: caminho MR para revenda, mantendo o teto unitário antes da quantidade e sem aplicar negociação a componentes. Acrescentar decomposição exata original/líquido/ajuste assinado para evitar somas financeiras no cliente.
3. `server/budgets.ts`: reaproveitar a conversão por total geral e handshake; snapshots novos registram o MR selecionado. Emissões anteriores continuam idênticas.
4. Editor dedicado compacto: cabeçalho azul, observação única, linhas diretas de serviço/componente, valores do backend e indicador real de autosave. Preservar diagnosisId/notes históricos por linha, sem expô-los como campos novos.
5. Autosave serializado e com debounce: nenhuma linha incompleta vai ao banco; IDs persistidos não são recriados. Confirmar cada gravação, conservar digitação posterior à requisição e interromper em conflito/resultado incerto. Não repetir POST de criação sem reconciliação/idempotência. Contexto não muda enquanto há gravação ou rascunho sem decisão explícita.
6. Painel fixo dedicado: resumo único, quatro dropdowns, negociação recolhível de duas opções e zero→none. Botões de prévia e emissão direta; emissão prepara a prévia internamente e exige as mesmas validações/consentimento antes de enviar token+chave. Nenhuma emissão ao digitar.
7. `CommercialPanel.tsx`, `BudgetPanel.tsx`, menu superior: retirar navegação habitual da tela intermediária; reutilizar configuração/histórico em acessos mínimos no controle existente, preservando cenário e dados carregados. Não apagar endpoints administrativos.
8. Testes API/SQLite e navegador: legado FCT, MR ausente/uniforme/divergente, snapshots/PDFs congelados, autosave/409/503/resposta perdida, IDs/flags/frações, negociação zero, resíduos e emissão direta idempotente. Capturas editor/painel nos tamanhos de referência e mobile, sem dados produtivos.

## Transição FCT → MR — decisão recebida da direção

Não há equivalência automática quando um Atendimento contém FCTs diferentes. Mesmo um FCT uniforme não comprova que a direção aprovou esse número como opção do catálogo MR.

A direção confirmou que não haverá mais FCT individual no novo cálculo: somente MR global por Atendimento. Não é necessária nova confirmação desta regra. Estratégia de preservação:

- Não converter, sobrescrever ou remover nenhum FCT antigo, uniforme ou divergente.
- Não criar opções MR deduzidas de FCT nem escolher um MR automaticamente.
- Preservar FCT nos dados legados e snapshots históricos; nunca utilizá-lo como fallback do novo cálculo MR.
- Bloquear nova emissão com componentes até o operador cadastrar/selecionar explicitamente o MR do Atendimento.
- A seleção explícita de MR passa a recalcular a revenda de TODOS os componentes do rascunho e de seus cenários. Preservar preços manuais, quantidades, IDs, flags e notas; snapshots/PDFs já emitidos continuam intactos.
- Valores ainda digitados/incompletos permanecem locais; não são recalculados ou persistidos pela introdução do novo parâmetro.

Este ponto afeta o valor comercial de rascunhos existentes e a sua possibilidade de emissão. Não é mera troca de rótulo FCT/MR. A especificação solicita apresentação desse tratamento antes de executar migração que altere preços/dados e veda conversão silenciosa. Nenhum banco produtivo foi consultado para identificar seus valores atuais.

## Situação desta preparação

Implementação de desenvolvimento concluída conforme o relatório vinculado acima, sem reescrever registros existentes. Este documento preserva o diagnóstico inicial; não substitui o relatório e os resultados finais. Merge, deploy, workflows, segredos, Coda, DNS e VPS permanecem fora da autorização.
