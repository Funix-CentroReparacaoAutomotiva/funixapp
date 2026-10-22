# Primeiro caso — lançar diagnóstico no Atendimento

Estado: **análise inicial e proposta técnica**, não fluxo implementado/homologado. Data: 21/10/2026.

## Intenção e resultado

O operador registra uma constatação referente a uma peça/parte do veículo no Atendimento escolhido e obtém uma composição inicial coerente de serviços aplicáveis. O diagnóstico e os serviços pertencem inequivocamente ao mesmo contexto e podem ser revistos conforme permissões/regras comerciais. Os totais exibidos devem corresponder aos dados efetivamente gravados e à referência de cálculo utilizada.

Não é um objetivo comercial criar uma linha de modal, abrir a última linha ou pesquisar qual registro acabou de nascer. Essas são escolhas de implementação atuais.

## Evidência concreta do caminho Coda

Leitura do inventário sanitizado de schemas e fórmulas, sem execução:

1. `db_Atendimentos.add_Diagnostico_pc` (`grid-eGvJhrlDTH`, `c-rIf9ZO3lkX`) modifica o contexto de `ui_AtendimentoModalOficina0.Last()` e abre essa linha.
2. Seletores de peça dessa tabela criam uma linha em `ui_AtendimentoModal1` (`grid-vvtYi-p3bV`) e abrem `.Last()`.
3. Seletores de diagnóstico, por exemplo Amassado (`c-C-sOa9O9U8`), criam uma linha de contexto em `ui_AtendimentoModal2` (`grid-f5B-PexiY9`) e a ação de abertura também usa `.Last()`.
4. A ação Leve (`c-ibkdacQz5D`) dessa segunda tabela cria o diagnóstico em `db_Atendimentos_Diagnosticos` (`grid-voKGJyLSB-`), procura combinações em `cnf_RelacaoDiagnosticoServicos` (`grid-bfhEBGqPTC`) e cria serviços vinculados a `db_Atendimentos_Diagnosticos.Last()`.
5. O diagnóstico final pertence ao Atendimento; seus serviços usam `Ref. Diagnostico`, catálogo de serviço e dimensão. A configuração de seleção `Aprv.` é copiada da relação de catálogo.
6. Auxiliares de serviço/item possuem ações de abertura/retorno e limpeza com `DeleteRows` sobre tabela, não apenas estado de um formulário. O significado operacional e uso atual desses caminhos precisam ser validados; a leitura estática não comprova ocorrência de falha concorrente.

Os pontos acima apoiam o relato de que há estruturas para viabilizar interface e encadeamento. Não provam que toda operação Coda tenha as mesmas limitações nem que nenhuma API da plataforma possa retornar identificadores.

## O que preservar

- Atendimento e origem da operação corretos, sem exigir Experiência/cadastro prematuro.
- Peça/parte, diagnóstico e intensidade/dimensão quando aplicáveis.
- Relação entre constatação e serviços/itens pertinentes; não acrescentar serviços arbitrariamente.
- Separação entre composição técnica/seleção comercial e aceite de uma proposta pelo cliente.
- Cálculo e ajustes comerciais válidos, com origem/versionamento pertinentes.
- Interação e mapa V20, retorno contextual e capacidade de revisar a composição.

Não se assume que todos os diagnósticos exigem os mesmos campos, que peça+diagnóstico define unicidade, nem que o flag Aprv. representa aceite do cliente. Esses aspectos precisam de contrato específico.

## Processo proposto

1. O mapa/área de diagnóstico da V20 mantém o Atendimento e as escolhas do operador em um contexto explícito. Um formulário aberto por outro operador não substitui esse contexto.
2. As opções pertinentes vêm de uma consulta delimitada e de um catálogo identificado. Alterar seleção invalida opções incompatíveis; cancelar encerra apenas o rascunho pertinente.
3. Ao confirmar, o backend recebe o Atendimento, as escolhas, a versão relevante e um identificador de solicitação.
4. O backend valida permissão, estado e compatibilidade das escolhas. Resolve a composição de serviços pelas regras escolhidas, sem confiar em preços/autorizações enviados livremente pelo navegador.
5. O backend conhece os IDs que vai usar ou os recebe explicitamente ao criar os registros. Grava diagnóstico e serviços dependentes em uma transação do banco próprio. Não procura a última linha global para descobrir uma relação.
6. Se a operação falhar antes de confirmar a transação, não deixa um diagnóstico parcialmente criado por essa solicitação. Repetição da mesma solicitação retorna o resultado conhecido em vez de criar outro conjunto.
7. A resposta identifica o diagnóstico e os filhos efetivamente confirmados e devolve os dados necessários à UI. O Atendimento visível é atualizado mantendo o contexto V20.

Esse desenho não exige um único SQL nem presume que todo cálculo esteja pronto. Define o resultado e os limites da operação. Chamadas externas não fazem parte dessa transação.

O ponto exato de confirmação/autossalvamento deve seguir as interações da V20 e os requisitos de recuperação do rascunho; não foi decidido por esta descrição.

## Casos de aceite propostos

| Cenário | Resultado esperado |
|---|---|
| Diagnóstico válido com serviços configurados | Diagnóstico e serviços no Atendimento correto; escolhas e valores resultantes coerentes |
| Dois operadores em Atendimentos distintos ao mesmo tempo | IDs e vínculos não se misturam, independentemente da ordem de conclusão |
| Dois cliques ou retry da mesma solicitação | Um único resultado para a mesma solicitação, sem bloquear dois diagnósticos legítimos semelhantes |
| Falha ao criar um dos filhos | A solicitação não confirma um conjunto parcialmente gravado |
| Resposta perdida após gravação confirmada | Nova tentativa recupera o resultado da solicitação existente |
| Cancelamento do formulário | Nenhum rascunho de outro usuário é apagado; persistência própria desse rascunho segue política definida |
| Troca de Atendimento com consulta pendente | A resposta antiga não atualiza o novo contexto |
| Alteração concorrente no mesmo objeto | Detectar a divergência e impedir sobrescrita silenciosa; política de resolução ainda a detalhar |
| Catálogo alterado durante a edição | Não substituir silenciosamente serviços/preços; usar referência definida ou solicitar revisão explícita |
| Diagnóstico/intensidade sem combinação de serviços | Resposta compreensível; comportamento comercial a confirmar, sem inventar serviço ou preço zero |

Esses casos são critérios propostos; não foram executados neste estudo e não representam testes já aprovados.

## Decisões funcionais ainda abertas

1. Significado exato de seleção/aprovação dos serviços em cada fase; não confundir inclusão na proposta com aceite do cliente.
2. Política de sugestão automática versus inclusão confirmada, preservando o comportamento aprovado e as escolhas da V20.
3. Tratamento de combinações sem serviço/regra de cálculo e de ajustes manuais autorizados.
4. Recuperação de rascunhos e conflito entre operadores no mesmo Atendimento.
5. Versão de catálogo/cálculo usada durante a elaboração e ao emitir orçamento.

A maior parte do mecanismo de criação, retorno de IDs, isolamento de contexto e transação pode ser resolvida tecnicamente. As decisões acima só serão levadas à direção quando a evidência existente e a referência visual não forem suficientes para definir o comportamento.
