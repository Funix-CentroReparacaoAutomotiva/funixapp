# Issue #70 — pesquisa de preços diretamente no Diagnóstico

**Estado:** proposta em branch isolada, sem merge/deploy, sem consulta paga.

## Problema e experiência desejada

Atualmente, a cotação existe somente na revisão do Copiloto de Voz, ligada a um comando efêmero `add_component`. No Diagnóstico, o usuário inclui manualmente um componente e edita descrição, quantidade, preço unitário e vê MR/Total. A melhoria cria um ícone **Pesquisar preço** após MR, sem retirar o botão do Copiloto. Após clique explícito, apresenta as mesmas três categorias (econômica, equilibrada, original nova), com preço ou travessão e link de origem quando aprovado. A escolha de um preço edita **somente o campo de preço unitário**, pelo autosave já existente e sem aplicar automaticamente qualquer orçamento.

## Arquitetura proposta

- Flag adicional `FUNIX_DIAGNOSIS_QUOTE_ENABLED=true` (padrão desligada); requer a flag principal `FUNIX_QUOTE_ENABLED=true`. A capacidade de cotar no Copiloto permanece independente.
- Nova rota autenticada `POST /api/atendimentos/:at/componentes/:id/cotar`, com corpo fechado `{scenarioId,componentRevision}`; exige mesma origem, sessão e componente **já salvo**, de Atendimento/cenário válidos. Não aceita descrição, dados pessoais, URLs, placa, fabricante ou modelo vindos do navegador.
- Backend obtém nome do componente, catálogo da peça e veículo do Atendimento a partir do SQLite e usa `saneQuoteQuery` para projeção técnica fechada. Identidade/revisão de componente, Atendimento, peça e cenário revalidadas após a chamada.
- Reutiliza **a mesma instância** de `QuoteService`, modelo, cache de sessão, reserva persistente 10 tentativas, filtros de fonte e controles de custo do Copiloto. **Não cria buscador paralelo**, retry ou pesquisa automática.
- Componente novo/alterado ainda não salvo não pode consumir uma tentativa. Falta de informação técnica retorna `needs_details` antes de qualquer reserva.
- UI em `src/DiagnosisEditor.tsx`: mantém quantidade, preço, MR, total; adiciona um ícone após MR quando a capacidade está habilitada. Em telas estreitas preserva ordem dos campos e oferece quebra responsiva. A consulta aparece sob a linha. Clique em preço escolhido altera apenas `manualPrice`, sem mudar MR, quantidade, habilitação ou cenários. A gravação continua pelo fluxo de autosave; links externos abrem em nova aba. Ao alterar descrição, quantidade, preço, revisão ou cenário, resultados anteriores deixam de ser apresentados.
- Não transforma uma candidata rejeitada em preço. No estágio atual, com `usableCitations=0`, é esperado que as três opções ainda possam aparecer como `—`. O novo botão resolve **acesso/UX**, não o bloqueio de verificação de fontes.

## Verificações e pendências

Testar autenticação, origem, rota fechada, componente e cenário inexistentes, revisão obsoleta, dados técnicos insuficientes, nenhuma mutação por consulta, cache na mesma sessão e descarte da resposta após troca do veículo. Testar UI em desktop (1440) e celular (390/320), sem overflow, sem botões ativos durante edição e sem alteração do preço até clique explícito. Nenhuma chamada à OpenAI real durante testes.

**Gates:** branch e PR somente, revisão dos checks, autorização separada de merge/deploy e ativação da flag. Não realizar a quarta tentativa paga, não aumentar o ledger e não afrouxar prova de fonte nesta entrega. O último registro de uso é 3/10 reservas e este trabalho não o altera.
