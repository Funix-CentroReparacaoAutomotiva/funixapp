# FunixApp — integração das entregas operacionais

Cada frente mantém seu repositório, esquema, interface e testes. A integração central registra a migração, as rotas públicas, a sessão existente e os estilos de base. IDs de Atendimento e Experiência são referências do domínio existente. Fases, rótulos comerciais e tons são definidos em `shared/erp.ts`.

| Frente | Chave de integração | Visões |
|---|---|---|
| Oficina | workshop | Pátio, Planejamento |
| Vendas | sales | Desempenho, Funil, Acompanhamento de veículos |
| Financeiro | finance | Contas a receber, Contas a pagar, Fluxo de caixa |
| Estoque | stock | Insumos, Tintas, Movimentações |
| Tarefas | tasks | Painel, Catálogo |
| Experiências | experiences | Biblioteca, Diário, SAC operacional |

API de módulo em `/api/erp/<chave>/<ação>`. O prefixo termina no nome do módulo e o handler recebe o restante do caminho com barra inicial. GET é consulta. POST recebe JSON, usa sessão e validação de origem existentes. As views usam o cliente HTTP existente. As fases do Pátio são projetadas para Vendas. Acompanhamento consulta a situação financeira por ID de Experiência quando disponível. Eventos do Diário preservam o identificador de origem. Nenhuma operação de teste aciona integrações externas reais.

## Base e migração

A entrega parte de `d81f9c4` (PR #369), que incorpora o agendamento, a OS, a situação legada de operação, os títulos e os recebimentos das PRs #361, #365, #367 e #368. O Financeiro mantém as tabelas existentes e acrescenta a associação de liquidações a transações. A V30 acrescenta o esquema das seis frentes em uma transação. O teste de migração cobre falha depois de alterações parciais, reinício e preservação da cópia V29.

## Validação sintética

- `npm run check` compila Web, verifica a tipagem do servidor, executa a suíte do servidor, lint e relatórios.
- `python -m unittest discover -s deploy/tests -q` exercita os procedimentos de operação em fixtures locais.
- `python tests/browser/erp_operacional.py` abre 15 visões em 1366×768, 1920×1080 e 390×844. Exercita movimentação, saída física e consulta ao mesmo evento no Diário com SQLite temporário.
- Os testes de navegador `erp_tasks.py`, `erp_sales.py`, `erp_stock.py` e `erp_finance.py` exercitam as operações de cada frente. Rode em um ambiente sem variáveis de integrações reais. Os testes podem ser executados com `env -i PATH="$PATH" python tests/browser/erp_operacional.py` e o mesmo prefixo nos demais.
- Capturas com dados sintéticos em [Pátio desktop](../evidencias/erp-operacional/patio-desktop.png), [Pátio mobile](../evidencias/erp-operacional/patio-mobile.png), [Planejamento](../evidencias/erp-operacional/planejamento.png) e [Fluxo de caixa mobile](../evidencias/erp-operacional/fluxo-de-caixa-mobile.png).

## Roteiro de homologação

1. Confirme o SHA da API e da Web, o SQLite de HML exclusivo e as integrações externas desativadas. Se houver migração, preserve a revisão anterior e uma cópia compatível do SQLite. Siga o [runbook vigente](HML_OPERACAO_ATUALIZADOR.md).
2. Em Oficina, agende um Atendimento sintético e confirme entrada, fase, impedimento e saída. Confira as 12 fases, o excesso acessível e a placa em desktop e celular. Em Vendas, confirme o Fechamento pendente e liquide um título sintético apenas pelo próprio Financeiro.
3. Em Planejamento, configure um recurso sintético, um feriado e a associação da etapa autorizada à fase. Programe dois serviços disputando o recurso, reordene e faça uma reprogramação. Valide a indicação de sobrecarga e o histórico de plano e realizado.
4. No Funil, programe um retorno no passado, registre comentário e altere a etapa. Confira o relógio e o Diário. Cenários de entrega ou falha de WhatsApp são cobertos com dublês nos testes.
5. Cadastre e altere uma tarefa no Catálogo e compare com o Painel. Em Estoque compare Insumos, Tintas e Movimentações depois de uma entrada, saída e ajuste sintéticos.
6. Em Financeiro, crie títulos a pagar e receber, liquide parcialmente dois títulos com uma transação e verifique os saldos e o caixa. Registre uma transferência interna sintética e confirme efeito líquido zero.
7. Em Biblioteca, encontre a Experiência por placa e confira orçamento, OS e Diário. Em SAC registre uma reclamação sintética e uma sequência de retrabalho com vínculo à origem.

## Premissas e limites

- Placa e saídas físicas são confirmadas na operação. O indicador legado de operação não comprova presença. Fases podem ser puladas ou revisitadas com justificativa. O Pátio lista as saídas do dia. Gestão permite ajustar o De–Para intermediário. Agendado e Fechamento seguem condicionados ao agendamento e à saída confirmada.
- A capacidade é diária por recurso, com fins de semana de sábado e domingo e feriados cadastráveis. A carga prevista é distribuída nos dias úteis do segmento. O prazo comercial do orçamento mantém sua fórmula original.
- O saldo financeiro representa os lançamentos do FunixApp. Conciliação bancária, saldos iniciais de contas externas e indicador de faturamento por data fiscal seguem sem fonte integrada. A baixa agrupada mantém o estorno por alocação para preservar o histórico existente.
- O custo vigente do material é usado na avaliação do saldo. Lote, formulação e novo critério de custeio dependem de regra de negócio. O esforço RICE usa decimal positivo explícito, já que o export histórico preserva os pesos conhecidos e omite as opções de esforço.
- O responsável declarado é preservado nos novos registros, dentro da autenticação compartilhada existente. Eventos legados sem autoria comprovada mantêm essa informação ausente. Anexos do Diário somam até 40 KiB por entrada. Garantia permanece sem fonte estruturada.
- Gestão analítica, conteúdo de Início e resumo por IA seguem fora desta entrega.
