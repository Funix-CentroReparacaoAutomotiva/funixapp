# FUNIX — crítica independente da divisão Comercial / Operação

Data: 21/10/2026. Análise estática e leitura dos inventários do ERP; nenhuma mutação, migração, envio ou mudança de código funcional.

## Parecer

**Sou favorável à direção da proposta, com uma alteração importante: o aplicativo seria o dono do processo comercial e o Coda o dono da execução operacional, ligados por uma transferência versionada de trabalho autorizado. “Até o agendamento” define o primeiro momento da transferência; não significa que a responsabilidade comercial termine depois de agendar.**

Essa separação permite substituir o módulo comercial que limita a operação sem reconstruir de uma vez financeiro, planejamento e produção. Não exige que todos os dados existam integralmente nos dois sistemas. Exige, porém, definir um único responsável por cada informação editável e um contrato de transferência mais completo que copiar um texto ou PDF.

A estrutura atual sustenta a ideia de snapshots, mas ainda não possui uma fronteira técnica independente entre Atendimento e Experiência. Remover Atendimento do Coda agora quebraria dependências observadas. Uma projeção técnica mínima no Coda é uma opção de transição menor que refatorar todo o operacional imediatamente.

## O que está comprovado e o que continua pendente

Fontes analisadas: `erp-inventory.md`, `coda-schema.json` (48 capturas anteriores, incluindo views), `coda-processes.json` e guia-mestre. O inventário integral está sendo ampliado em trabalho paralelo; este parecer não afirma cobertura total do ERP. Contagens e fórmulas refletem leituras de 21/10/2026. A existência de uma fórmula ou botão é prova de código presente, não de execução correta em todos os cenários.

Achados que determinam a arquitetura:

| Evidência observada | Consequência para a proposta |
|---|---|
| Atendimento tem dados leves de nome, telefone, modelo e placa, enquanto Experiência referencia Entidade, Veículo e Pagador | O comercial pode funcionar sem cadastro mestre precoce; a passagem precisa resolver os cadastros estruturados com segurança |
| Diagnósticos de Atendimento referenciam peça, parte, diagnóstico, intensidade e soluções; Serviços possuem lookup de serviço/dimensão e cálculo de preço | Transferir o comercial inclui um pequeno motor de domínio e catálogo, não apenas uma tela e campos de texto |
| Orçamento conserva valores e dados comerciais em snapshot | É uma boa unidade de passagem: versão aceita, sem recálculo automático por alterações futuras do Atendimento |
| `db_Orcamentos.ID_Atendimento` é lookup; `Experiencia` deriva de Atendimento→ID_Experiencia | O orçamento atual não é autônomo em relação ao Atendimento no Coda |
| `db_OSs.Id_Experiencias` deriva de Orçamento.Experiencia; Experiência agrega orçamentos/OS por essa cadeia | Copiar orçamento isoladamente, com Atendimento apenas externo, não preserva automaticamente as relações operacionais |
| A OS contém diagnósticos, serviços, itens e etapas com quantidades, valores, energia e relações | O operacional precisa receber estrutura executável além da apresentação comercial |
| `db_OSs_Etapas.Fase` procura o serviço textual nos serviços contemplados de fases operacionais | Mesmo texto copiado pode participar de regra parametrizada; renomear serviço no app pode mudar ou quebrar a classificação |
| Processos somam energia das etapas por Experiência/fase e calculam duração pela capacidade diária | Perder ou traduzir incorretamente etapas/energia afeta planejamento e fase operacional |
| Há validação técnica, rejeição, negociação, proposta de novo orçamento e retorno/retrabalho no modelo | A fronteira não pode ser uma passagem de mão única sem aditivos/revisões e rastreabilidade |
| A tabela Atendimento também contém tipo de atendimento/emprego e triagem automática; o Funil exclui os outros tipos | Migrar “a tabela Atendimento inteira” não equivale a migrar só comercial; a fronteira deve ser de processo |

## A precisão necessária sobre “é tudo texto”

A observação é parcialmente correta: a OS armazena diversas descrições e nomes como valores persistidos, reduzindo sua dependência direta dos objetos de diagnóstico do Atendimento. Isso ajuda a construir um contrato de transferência.

Mas não são apenas caracteres sem comportamento. Há valores numéricos, quantidades, relações pai-filho, IDs de origem, energia por etapa, situação da OS e fórmulas que classificam serviços nas fases. O orçamento aprovado deve ser transmitido como dados estruturados e imutáveis da versão, acompanhado de sua apresentação/PDF quando cabível.

Exemplo concreto observado: `db_OSs_Etapas.Fase` (`c-1bujdvSjCP`) usa `cnf_FaseOperacional.ServicosContemplados` → `cnf_Servicos.Nome comercial` para localizar o campo textual `Servico`. Depois, `db_Processos.Energia total` (`c-CAe2gZZqd9`) soma as energias das etapas por fase e `Sugestao_Duracao` (`c-scijESvRj5`) divide pela capacidade diária. Um PDF descrevendo “pintar porta” não substitui esse contrato.

## Haverá dados duplicados?

**Alguns, deliberadamente. Não precisa haver dois cadastros comerciais completos, dois motores comerciais concorrentes ou dois lugares onde o operador atualiza o mesmo dado.**

Devem ser distinguidos:

- **Registro mestre:** local onde a informação nasce e pode ser alterada legitimamente. Exemplo proposto: Atendimento e suas versões de orçamento no app; cadastro canônico de Veículo no Coda.
- **Snapshot:** fotografia histórica de uma versão autorizada. Exemplo: o escopo e preço aceitos, conservados no app e importados no Coda para autorizar a operação. Mudar o nome atual do cliente ou o catálogo não deve alterar retroativamente esse conteúdo.
- **Projeção:** representação derivada, consultada por outro sistema. Exemplo: o app mostrar fase da Experiência calculada pelo Coda, sem virar autor dessa fase.
- **Compatibilidade:** linha técnica mínima para satisfazer relações legadas. Pode ser necessária no Coda por causa das fórmulas atuais, mas não deve se tornar uma segunda estação de trabalho comercial.

Na arquitetura proposta, leads que não agendaram podem existir somente no app. Só o caso encaminhado à operação transmite o conjunto necessário para execução e rastreabilidade. Não é necessário copiar todas as mensagens, rascunhos, revisões rejeitadas, anexos irrelevantes ou todos os registros de prospecção para o ERP.

A cópia física só se torna problemática quando ambos os lados podem editar a mesma verdade sem regra de autoridade ou quando não se sabe qual versão foi aceita.

## Matriz de responsabilidade proposta

| Informação | Autoridade proposta | Uso pelo outro lado |
|---|---|---|
| Demanda, contexto comercial, mensagens vinculadas, próximos passos e dados informados do lead | App | Coda recebe a referência e o mínimo pertinente ao trabalho agendado |
| Diagnóstico em elaboração, alternativas, serviços/peças propostos e negociação | App | Nenhum espelho editável integral obrigatório |
| Versões emitidas do orçamento e evidência da aceitação comercial | App | Coda recebe a versão operacional autorizada e suas referências |
| Cliente/Entidade, Veículo e Pagador canônicos | Coda, inicialmente | App pesquisa e referencia IDs; textos informados preservam sua própria proveniência |
| Validação técnica, OS, processos, entrada/saída e produção | Coda | App consulta e apresenta o estado real |
| Faturas, títulos, transações e situação financeira | Coda | App consulta a projeção adequada às permissões |
| Catálogos e regras de precificação/fases | Um único dono explicitamente escolhido; Coda inicialmente é opção de transição | App usa cópia de leitura versionada; não editar dois catálogos independentemente |

A matriz é uma proposta, não uma alteração já aprovada ou implantada. Campo de cadastro atual e fotografia do documento aceito têm responsabilidades diferentes, mesmo quando parecem conter o mesmo nome ou placa.

## Cliente conhecido antes de agendar

Entidade e Veículo podem permanecer mestres no ERP sem proibir seu uso no comercial. Se o cliente já existe, o app pode localizá-lo e guardar os IDs correspondentes. Se ainda não há dados suficientes, continua com nome/modelo/contato informados, sem criar cadastros artificiais.

Ao agendar, a transferência deve distinguir cliente, proprietário/condutor quando relevante e pagador; o esquema atual permite Pagador distinto. Não associar apenas por nome parecido ou assumir telefone como identidade exclusiva. Não sobrescrever cadastro canônico automaticamente a partir de texto livre recém-recebido.

Isso preserva a simplicidade do Atendimento e evita pedir novamente dados já conhecidos. O fato de um dado mestre estar no Coda não exige que o operador saia do aplicativo para consultá-lo.

## Como a transferência deveria funcionar

1. **Fechar uma versão comercial:** identificar Atendimento, versão do orçamento, linhas, quantidades, valores, condições e evidência da autorização; preservar os IDs e a versão de catálogo/regras usados. Autorização comercial não equivale a liberação técnica.
2. **Registrar intenção durável:** gerar identificador estável da transferência e gravar seu estado antes de chamar o Coda. Não usar apenas Redis ou a resposta HTTP do clique como registro permanente da intenção.
3. **Resolver cadastros:** localizar/vincular Entidade, Veículo e Pagador existentes, ou seguir o processo de cadastro autorizado. Não criar um novo cliente em cada tentativa.
4. **Importar de modo repetível:** criar ou localizar a representação mínima do Atendimento, a Experiência e o orçamento operacional com seus filhos. Uma repetição com o mesmo identificador deve retomar a operação existente, sem criar outra Experiência, orçamento, OS ou cobrança.
5. **Confirmar no ERP:** obter os IDs reais e comprovar relações, contagens e valores esperados. “Workflow executou” ou “API aceitou solicitação” não bastam para confirmar o agendamento integral.
6. **Encerrar a transferência no app:** somente após confirmação, mostrar Experiência criada/vinculada e disponibilizar o contexto operacional. Em falha parcial, mostrar transferência pendente/erro e oferecer recuperação controlada.

Não há transação automática única entre um banco do app e o Coda. A solução precisa de idempotência, estados de transferência e reconciliação. Deletar registros parciais automaticamente para “voltar tudo” pode ser perigoso quando outras ações já ocorreram; a estratégia de recuperação precisa ser testada em cópia segura.

A OS deve continuar obedecendo às condições de aprovação e validação reais. Importar um orçamento aceito não autoriza criar OS ou liberar execução técnica incondicionalmente.

## Depois de agendado: aditivos, correções e cancelamentos

A divisão só continua clara se houver caminho de volta para a comunicação comercial:

- A produção identifica um dano oculto e registra a necessidade técnica no Coda.
- O app recebe/consulta essa necessidade e conduz proposta adicional, preço e autorização do cliente.
- Uma nova versão ou aditivo é aprovado e enviado com referência ao orçamento/escopo anterior.
- O Coda aplica o incremento pelo comando permitido, preservando o que já foi autorizado e executado.

Não atualizar silenciosamente o snapshot importado com o rascunho mais recente do Atendimento. Uma aprovação anterior não autoriza qualquer alteração futura. Correção de cadastro, remarcação de chegada, cancelamento antes da entrada, retrabalho e reentrada também precisam de comandos e autoridade definidos; “agendou, acabou o comercial” não cobre esses casos.

## Três alternativas e a recomendação proporcional

| Alternativa | Benefício | Custo/limite | Parecer |
|---|---|---|---|
| UI do app com Coda como armazenamento e regras de tudo | Resolve restrições de interface sem migração de dados; menor corte inicial | Mantém latência/limitações do modelo Coda e acoplamento das fórmulas | Boa etapa imediata ou de validação, mas não precisa ser o destino final |
| App mestre comercial + projeção mínima/snapshot operacional no Coda | Dá liberdade de comercial, reduz o que é sincronizado e preserva operacional existente | Precisa de armazenamento durável no app, catálogo/regra de preço definidos e contrato de transferência | **Melhor direção para a transição proposta**, sujeita à validação dos contratos e aprovação do escopo |
| Retirar completamente Atendimento do Coda e fazer orçamento/OS independentes | Fronteira final mais limpa e menos compatibilidade legada | Exige refatorar lookups, fórmulas, botões e automações operacionais, inclusive pós-agendamento | Não é a primeira mudança segura com o ERP atual |

É importante medir a origem da lentidão: uma UI nova remove limitações de interface; deslocar fórmulas, consultas e persistência pode remover outras limitações. Trocar o banco não prova automaticamente ganho de desempenho e transfere ao time responsabilidade por backup, regras, segurança e continuidade. Nenhuma escolha específica de banco é necessária para aprovar primeiro a divisão de responsabilidades.

## Migração gradual sem dois autores para o mesmo caso

Recomendação de corte por coorte, depois de ensaio em cópia:

1. Preservar os atendimentos e documentos legados no Coda, com histórico acessível pelo app.
2. Escolher um conjunto pequeno de novos casos para terem o app como autor comercial.
3. Registrar a origem e quem é o autor de cada caso; impedir que o mesmo caso seja editado comercialmente nos dois sistemas.
4. Redirecionar a criação automática de leads e o atendimento desses casos para um único destino. O workflow atual escreve no Coda; ativar outro receptor sem esse corte duplica demandas.
5. Testar criação, revisão, agendamento repetido, falha parcial, aditivo, remarcação, cancelamento e retorno. Conferir que o operador não precisa alimentar dois sistemas.
6. Ampliar o corte após validação. Só depois discutir desativação de campos, fórmulas e telas legadas. Preservar relações históricas e rollback.

Migrar todos os 936 atendimentos ou todos os 704 orçamentos de uma vez não é requisito para começar. Esses números são contagens do snapshot, não taxa de conversão nem prova de que todos os registros pertencem ao mesmo processo comercial.

## Decisões que ainda precisam da direção

- Aprovar o app como futuro dono do comercial e a matriz de autoridade; a orientação anterior de manter tudo inicialmente no Coda continua valendo enquanto essa mudança não for aprovada.
- Escolher a unidade exata de transferência: versão aceita, condições, cadastros e elementos operacionais exigidos.
- Concordar com a projeção técnica mínima de compatibilidade no Coda durante a transição, ou autorizar refatoração operacional maior.
- Definir o caminho de aditivos/revisões após a primeira transferência e a autoridade de aprovação técnica/comercial.
- Delimitar a coorte piloto e os registros que permanecem legados; tratar separadamente os tipos não comerciais da tabela Atendimento.
- Autorizar ensaio de mutações em cópia segura antes de mudanças produtivas. Nenhuma dessas decisões foi executada nesta análise.

A proposta pode reduzir os pontos de atrito sem obrigar a FUNIX a substituir todo o ERP. O critério de sucesso do desenho é o operador trabalhar uma vez, cada informação ter um dono e a operação receber exatamente o escopo autorizado, mesmo quando uma tentativa falha ou a negociação muda depois de agendar.
