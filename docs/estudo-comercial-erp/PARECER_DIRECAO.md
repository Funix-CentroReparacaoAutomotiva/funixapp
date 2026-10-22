# FUNIX — parecer sobre separar comercial e operação

Data: 21/10/2026. **PROPOSTA de arquitetura; não aprovada nem implantada.** Este estudo responde à hipótese da direção. Não modifica a premissa vigente do primeiro incremento, não migra registros, não cria banco comercial e não altera o ERP ou as integrações.

## Parecer

Recomendo evoluir para **aplicativo como autor do domínio comercial e Coda como autor da operação/financeiro**, com uma transferência identificada e versionada ao agendar. A interface pode continuar unificada no aplicativo, mesmo enquanto a operação permanece no ERP.

O agendamento é um bom momento para a primeira entrega operacional. A responsabilidade comercial continua no aplicativo quando a inspeção, um pedido de alteração ou um retorno exigir nova negociação. O orçamento é o objeto de passagem, acompanhado de seus dados estruturados, vínculos e versão; o PDF é uma representação desse objeto.

O primeiro desenho implementado era uma interface sobre o Coda. Não criou outro cadastro comercial nem duplicou os dados do ERP. A hipótese agora estudada muda essa arquitetura: introduz armazenamento e regras comerciais próprios, com o Coda recebendo o conjunto necessário para a execução.

## O que foi de fato investigado

O guia recebido continha levantamento inicial de tabelas/IDs e comportamentos, não um inventário integral. A primeira investigação havia capturado 48 esquemas de tabelas/views e o núcleo comercial/operacional. Nesta rodada foram percorridas as **202 páginas** do documento Funix, exclusivamente em leitura pelo conector, com recuperação das falhas transitórias.

O inventário consolidado identifica **164 tabelas-base, 72 schemas de views e 1.691 colunas de base**, incluindo auxiliares, configurações e estruturas fora do núcleo principal. Foram levantadas relações, fórmulas e ações armazenadas; o fluxo Atendimento→Orçamento→agendamento→Experiência→OS→processos/financeiro recebeu análise específica. A auditoria identificou **11 referências a tabelas não localizadas pelo conector**, inclusive em definições ativas, e quatro botões de tabela sem fórmula de ação. Isso não comprova que os processos em uso estejam quebrados; exige distinguir legado, telas efetivamente usadas e comportamento em execução.

Essa cobertura estrutural não equivale a certificar integralmente a operação: não executei botões, não testei mutações, não li cadastros/mensagens pessoais, não inspecionei tabelas eventualmente embutidas em células de conteúdo e não tive introspecção completa das automações internas do Coda. Os detalhes da cobertura ficam em COVERAGE.md e schemas.json. Não se deve dizer que todos os processos foram homologados.

## Onde a hipótese está apoiada no ERP

O ERP já diferencia rascunhos parametrizados de cópias de documentos. Atendimento, diagnósticos, serviços e itens são editados usando catálogos, dimensões, preço, fatores e condições. Ao gerar orçamento, descrições e valores são materializados em cabeçalho e tabelas-filhas. A geração da OS copia novamente parte desses dados. Isso fornece uma base real para formalizar uma passagem comercial→operação.

Entretanto, materializar valores não os torna automaticamente imutáveis: vários campos do snapshot continuam graváveis no Coda. A versão aceita precisa de proteção e histórico explícitos no futuro contrato.

## Cinco pontos que exigem ajuste na proposta

### 1. Texto copiado ainda pode participar de relações e cálculos

Os filhos do orçamento têm descrições, quantidades, dimensões, valores, códigos e chaves de agrupamento. A OS mantém relações internas entre diagnóstico, serviço e etapa. Portanto, só PDF, descrição geral e total não permitem ao ERP executar os processos atuais.

Na geração da OS, `gerarOS_Etapas` procura o serviço/dimensão no catálogo vigente e cria etapas e energia; não copia simplesmente as etapas já materializadas no orçamento. Depois, a fase de uma etapa da OS é calculada usando o nome do serviço e o catálogo de fases; os processos somam energia e usam capacidade diária. Um nome diferente no app pode deixar de encontrar a associação operacional.

O contrato deve identificar serviços/dimensões por IDs estáveis e preservar rótulos compatíveis. Também deve tornar explícita a regra atual de expansão técnica e decidir, com aprovação, como lidar com alterações de catálogo entre proposta e OS. Preservar preço/escopo aceitos não obriga presumir que todas as microetapas técnicas sejam imutáveis.

### 2. A ligação com Atendimento permanece depois da cópia

A cadeia observada é:

`Orçamento.ID_Atendimento → Atendimento.ID_Experiencia → Experiência`

`OS.Id_Orcamento → Orçamento.Experiencia`

Coleções da Experiência, etapas, planejamento e indicadores financeiros dependem dessa resolução. Remover o Atendimento Coda sem adaptar os consumidores pode deixar documentos existentes fora das coleções e cálculos, mesmo que os textos e valores continuem armazenados.

Recomendo, na primeira transição, criar **apenas no agendamento um Atendimento técnico de compatibilidade** no Coda, com os vínculos e metadados indispensáveis. O app mantém a negociação e os rascunhos; o Coda recebe o orçamento selecionado, seus filhos estruturados e a Experiência. Esse registro técnico não deve se tornar outro editor comercial. Não é suficiente criar uma linha vazia e executar indiscriminadamente todos os botões legados: a importação, revisões e controles precisam de contrato próprio.

Eliminar completamente esse registro é possível depois, refatorando referências de orçamento/OS/Experiência e seus consumidores. Não recomendo começar por essa reforma operacional junto da migração comercial.

### 3. Comercial não termina definitivamente no agendamento

A inspeção tem ação para rejeitar/repropor orçamento, reconstruindo o rascunho no Atendimento Coda. A Experiência também tem ação que cria novo Atendimento de retorno com vínculo à origem. Esses pontos precisam abrir revisão ou nova demanda no app quando ele assumir o comercial.

Suplemento da passagem atual deve continuar vinculado à mesma Experiência; novo retorno é uma demanda diferente e respeita a regra de origem. Não foi comprovado um fluxo completo existente de aditivos após OS autorizada, portanto ele não pode ser inferido de um botão de revisão anterior à autorização.

O ERP distingue orçamento **Consentido** de **Autorizado**: o segundo envolve validação técnica e geração da OS. A transferência de aceite do cliente deve preservar essa separação.

### 4. Catálogos e precificação fazem parte da migração

Para o comercial existir fora do Coda, é preciso definir onde são executados os cálculos e quem edita catálogos. Não basta transferir a tabela Atendimento: há regras de preço tabelado/calculado/percentual, dimensões, quantidade/escala, cor/risco, ajuste comercial, curadoria de itens, parcelas e energia.

Recomendo começar com um único responsável pelos catálogos, aproveitando o Coda inicialmente e oferecendo ao app cópias de leitura identificadas por versão. O novo cálculo exige testes de equivalência com as regras existentes antes de assumir casos reais. Um serviço central de cálculo também é uma alternativa, mas não foi encontrado serviço independente pronto para essa função.

A liberdade de código ajuda a resolver a UX e permite reduzir dependências durante a negociação. Não medi o gargalo atual, portanto não atribuo toda a lentidão ao armazenamento nem prometo ganho de desempenho apenas por mudar de banco.

### 5. A entrada automática precisa escolher um único autor

O n8n atual cria Atendimentos no Coda e faz verificações ali. Um novo criador no app, em paralelo para os mesmos eventos, pode gerar duplicidade. A mesma tabela também contém candidaturas profissionais; migrar comercial não equivale a migrar automaticamente esse outro processo.

Envio WhatsApp e geração de PDF podem ser reaproveitados como serviços por backend. O PDF já aceita JSON externo; Redis guarda esses dados temporariamente por 300 segundos, não constitui o registro durável dos orçamentos. Não há banco persistente do app configurado/verificado no ambiente.

## Responsabilidade proposta pelos dados

| Informação | Autoridade proposta | Uso pelo outro sistema |
|---|---|---|
| Atendimento, contexto, conversas vinculadas e acompanhamento comercial | App | Coda recebe identificação/origem do caso agendado |
| Diagnósticos em elaboração, alternativas e negociação | App | Rascunhos não precisam ser espelhados integralmente |
| Versões de orçamento e aceite comercial | App | Coda recebe a versão selecionada e o escopo operacional estruturado |
| Cliente/Entidade, Veículo e Pagador canônicos | Coda inicialmente | App pesquisa e referencia IDs; mantém separados os dados informados no contato |
| Validação técnica, Experiência, OS, processos e entrada/saída | Coda | App consulta e apresenta os estados reais |
| Faturas, títulos, transações e situação financeira | Coda | App consulta conforme permissões |
| Catálogos e regras | Responsável único definido por catálogo | Cópias de leitura versionadas; sem dois editores independentes |

Entidade não é exclusiva da Experiência: também atende papéis financeiros e relacionamentos. Sua autoridade deve seguir a responsabilidade do cadastro, não apenas onde ele aparece em uma tela.

Nome/modelo/contato informados no primeiro contato podem continuar leves e incompletos. Isso não impede o app de procurar um cliente/veículo já existentes e guardar seus IDs, sem cadastrar novamente nem obrigar cadastro prematuro. Texto informado e cadastro confirmado têm proveniências distintas; telefone ou nome parecido não garantem identidade.

## Duplicação e transição

Não recomendo copiar todos os leads, mensagens e rascunhos para os dois lados. Alguns dados existirão deliberadamente em ambos: por exemplo, a fotografia do orçamento aceito no app e sua cópia de execução no Coda. Essa cópia histórica tem função própria; o risco é permitir que os dois sistemas editem independentemente a mesma versão.

Proposta de transição:

1. Preservar casos e documentos legados no Coda, acessíveis pela interface do app.
2. Pilotar novos casos comerciais com o app como autor; identificar a origem e responsabilidade de cada caso.
3. Redirecionar a criação automática desses casos a um único destino, conservando os processos fora do piloto.
4. Persistir a intenção de agendamento com ID estável e versão do orçamento.
5. Resolver Cliente/Veículo/Pagador, importar o conjunto operacional e confirmar IDs, vínculos e valores no Coda.
6. Só confirmar a transferência após essa verificação. Clique duplo, retry e falha no meio devem retomar o mesmo registro, sem outra Experiência, orçamento, OS ou cobrança.
7. Tratar revisões, remarcações, cancelamentos e retorno por comandos com responsabilidade definida; ampliar o piloto após validação.

Não existe transação automática entre banco do app e Coda. É necessário registro persistente de transferência, recuperação e reconciliação. A equipe deve trabalhar uma vez, ainda que o backend mantenha o acordo entre os sistemas.

## Próxima decisão recomendada

Recomendo aprovar a separação de responsabilidades e o ensaio de uma passagem sintética em cópia segura antes de migrar comercial real. Esse ensaio deve verificar orçamento estruturado, agendamento repetido, inspeção/OS, etapas/processos, agregações financeiras e retorno ao comercial.

O código da aplicação permanece na arquitetura anterior enquanto essa mudança material não for aprovada. O estudo fornece a base para decidir o banco comercial, o contrato de transferência e as alterações mínimas de compatibilidade; não trata a conversa como autorização automática para editar produção.

Evidências complementares: HANDOFF_DEPENDENCIES.md, CATALOG_PRICING_BOUNDARY.md, AUTOMATION_BOUNDARY.md, ARCHITECTURE_CRITIQUE.md, COVERAGE.md e schemas.json.
