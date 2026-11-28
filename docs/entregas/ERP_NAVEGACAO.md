# FunixERP — espaços de trabalho e Central de Tarefas

O mesmo menu mostra as páginas do módulo ativo. No desktop, o seletor fica no topo da lateral recolhível. No celular, o sanduíche abre um mosaico de duas colunas e a barra inferior mostra as páginas do módulo selecionado. Conversas fica em Vendas. Atualizações fica em Gestão. As URLs legadas continuam acessíveis.

A entrada pelo endereço principal e a troca pelo seletor recuperam a última página de cada módulo neste navegador. Consultar uma ficha relacionada mantém o contexto do módulo. A Central de Tarefas é um modal global e mantém a página de origem montada enquanto o usuário gerencia tarefas, inclusive no Painel e no Catálogo.

A Central conta tarefas pendentes com prioridade Alta, Urgente, Crítica, Imediata, P0 ou P1. Os demais valores continuam aceitos nas tarefas. O vínculo opcional com o Atendimento em consulta é registrado no SQLite V31. Em visões de Experiência que já identificam o Atendimento associado, o vínculo aponta para a mesma ficha. Tarefas anteriores continuam disponíveis com vínculo vazio.

## Roteiro de homologação

1. Em desktop, selecione Oficina, abra Planejamento, recolha a lateral e volte para Vendas. Troque novamente para Oficina e confirme que Planejamento é restaurado.
2. Em celular, abra o sanduíche, confirme o módulo destacado e selecione Estoque. O seletor se fecha e a barra inferior passa a mostrar apenas Insumos, Tintas e Movimentações.
3. Aplique um filtro no Funil. Abra a Central, consulte o Painel ou o Catálogo e feche a Central. Confira o filtro e a página anterior.
4. Abra um Atendimento sintético. Crie uma tarefa de prioridade Alta na Central, selecione o vínculo e confira o contador. Conclua a tarefa e confirme que o contador diminui e o Painel mostra a tarefa como Feito.

## Evidências sintéticas

- `tests/browser/erp_workspaces.py` verifica as etapas em Chromium, a 1366×768 e 390×844.
- [Lateral no desktop](../evidencias/erp-navegacao/oficina-1366.png)
- [Seletor de módulos no celular](../evidencias/erp-navegacao/seletor-390.png)
- [Central de Tarefas no celular](../evidencias/erp-navegacao/tarefas-390.png)
