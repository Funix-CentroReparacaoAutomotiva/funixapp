# Revisão 01 — lançar um diagnóstico

Estado: proposta para revisão da direção; não implementada nem homologada.
Data: 21/10/2026.

## Como revisar

Ler o exemplo como uma sequência de uso. Criticar as etapas pelo número: o que falta, o que sobra, o que deveria acontecer automaticamente e qual resultado está errado. O responsável não precisa avaliar fórmulas, banco ou n8n.

## Recorte e exemplo

Primeiro caminho: registrar um diagnóstico novo, sem corrigir um diagnóstico anterior, em uma peça de um Atendimento já aberto. Entrada pelo Mapa da V20. Caso ilustrativo: capô com amassado leve. O exemplo não prescreve um serviço ou preço.

Condição inicial: Atendimento correto aberto, capô ainda não incluído e catálogo pertinente disponível. Não se exige Experiência ou cadastro completo de Cliente/Veículo para iniciar este caminho.

## Sequência para avaliação

| Etapa | Ação da pessoa | Resposta esperada do aplicativo |
|---|---|---|
| 1 | No Atendimento aberto, acessar Mapa e selecionar o capô. | Disponibilizar a inclusão/edição daquela peça, mantendo o Atendimento como contexto. |
| 2 | Abrir o campo de diagnóstico da peça e escolher Oficina → Amassado. | Mostrar as intensidades pertinentes ao diagnóstico. |
| 3 | Escolher Leve. | Exibir Amassado · Leve na peça e apresentar os serviços correspondentes à combinação do catálogo. Preservar a distinção entre serviços disponíveis e serviços selecionados. |
| 4 | Conferir os serviços e ajustar a dimensão/quantidade quando necessário. | Atualizar a composição e o subtotal de acordo com as regras reais aplicáveis; evidenciar pendências, sem tratar preço desconhecido como zero. |
| 5 | Se necessário, escrever uma observação. | Associar a observação à peça/diagnóstico que está sendo editado, conforme a estrutura funcional a validar. Não inventar vínculo com serviço específico. |
| 6 | Usar Voltar para retornar à lista. | Exibir a peça com seu diagnóstico, serviços e subtotal correspondentes; Mapa e Diagnósticos refletem a mesma composição. |

## Resultado de negócio

O Atendimento passa a conter a peça com o diagnóstico Amassado · Leve, a composição de serviços selecionada e seus valores aplicáveis. Isso ainda é elaboração comercial: não gera automaticamente proposta, aceite do cliente, agendamento ou OS.

## Base existente e propostas

- **V20 observada:** editor por peça, seletor Oficina/Estética, diagnóstico, intensidade quando aplicável, serviços/dimensões/quantidades, observação, subtotal e retorno com Voltar. As escolhas atualizam o estado local do protótipo; não existe confirmação geral Salvar nesse editor. Não adicionar esse botão por consequência da descrição anterior do fluxo.
- **Coda observado:** relação diagnóstico/intensidade → serviços, configuração de seleção padrão e vínculos diagnóstico → Atendimento e serviços → diagnóstico. O catálogo de demonstração da V20 não determina serviços ou preços produtivos.
- **Proposta técnica:** manter a interação da V20 e tornar a gravação durável verificável. Falha de rede não pode ser apresentada como salvamento concluído. O comportamento visível de pendência/erro e a recuperação ainda precisam ser detalhados.
- **Limite da evidência:** ler os seletores e ações da V20 não comprova que todas as combinações de catálogo sejam válidas no ERP. O exemplo não fixa serviços/dimensões/preços para Amassado · Leve.

## Três pontos para a direção revisar

1. **Ordem:** peça → diagnóstico → intensidade → revisão de serviços faz sentido para o trabalho real? A pessoa precisa definir algum dado antes disso?
2. **Automação:** os serviços devem aparecer com a seleção padrão configurada no catálogo, ficando ajustáveis, ou há outra intenção comercial? A referência atual combina sugestões com seleções padrão; não presumir que todos os serviços devam entrar.
3. **Gravação:** as escolhas devem permanecer ao usar Voltar, seguindo a interação da V20? Proposta: sim, sem exigir um Salvar geral. Fechar durante falha ou antes de terminar demanda um caminho próprio de revisão.

## Fora deste primeiro caminho

Alterar um diagnóstico com serviços já ajustados, cancelar inclusão, excluir peça, registrar mais de um dano na mesma peça, voltar sem concluir, catálogo sem combinação, concorrência e perda de conexão terão caminhos específicos. A questão de múltiplos danos por peça permanece aberta; este exemplo não define unicidade. A V20 já contém uma escolha Manter serviços/Aplicar sugeridos em determinadas alterações; não remover essa proteção ao detalhar a revisão.

## Registro de revisão

Nenhuma resposta da direção foi incorporada ainda. A próxima versão deve registrar os comentários por etapa e distinguir ajuste de especificação de mudança de UX ou regra comercial.
