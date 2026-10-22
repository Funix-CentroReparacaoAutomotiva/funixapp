# Dependências para transferir o comercial do aplicativo ao ERP

**Data:** 21/10/2026. **Escopo:** estudo somente leitura do documento `superhuman://docs/2zsjI-nqWr`. Nenhum botão, fórmula de ação, webhook, mensagem ou escrita foi executado. Nenhum cadastro pessoal foi exportado.

**Conclusão:** o aplicativo pode ser o dono dos leads, diagnósticos, serviços, itens e negociação antes do agendamento. Isso não exige sincronizar cada rascunho com o Coda. Entretanto, o ERP atual não recebe apenas um PDF/total e segue de forma independente: o orçamento aprovado e a OS mantêm vínculos vivos com um Atendimento Coda, e o fluxo operacional pode voltar à edição comercial após a inspeção. Eliminar esse Atendimento sem adaptar os consumidores quebraria a associação da OS à Experiência, o planejamento e agregações financeiras.

Uma alternativa de menor alteração é materializar **somente no handoff** um Atendimento Coda de compatibilidade, o orçamento aprovado estruturado e seus filhos, vinculados à Experiência. Esse registro não precisaria ser o editor nem a fonte de verdade da negociação no aplicativo. Essa é uma **PROPOSTA de integração**, não o comportamento já implantado. As responsabilidades de renegociação, suplementos e retrabalho precisam ser decididas antes de fechar o contrato.

## Evidência utilizada e limite da verificação

- `coda-schema.json` e `coda-processes.json`: inventário anterior de tabelas, fórmulas e 15 ações, obtido por leitura.
- `HANDOFF_SCHEMAS.json`: leitura complementar atual, com `include:["formats"]`, dos esquemas e **fórmulas de ação armazenadas** de Atendimento, Orçamento, ux_Agendamento, quatro tabelas de filhos do orçamento, Experiência e OS. Os formatos confirmam quais campos são lookup, texto, número, fórmula e ação. Fórmulas externas foram omitidas para não copiar URLs ou possíveis literais sensíveis.
- `CROSSREF_STATIC.md`: varredura estática dos consumidores no inventário anterior. As lacunas de ação/esquema desse arquivo foram parcialmente supridas pelas novas leituras descritas aqui.

**VERIFICADO por leitura do ERP:** existência, tipos e definição atual dessas colunas/ações. **ANÁLISE ESTÁTICA:** efeitos esperados de remover vínculos ou substituir dados. **NÃO TESTADO em runtime:** criação de orçamento/OS/Experiência, atomicidade, concorrência, recuperação de falhas, efeitos de exclusão, reabertura e execução de botões em cadeia. Uma fórmula armazenada não comprova sucesso de execução.

## 1. A dependência do Atendimento permanece depois da cópia

| Vínculo atual | Referência concreta | Consequência estática de não existir o Atendimento Coda |
| --- | --- | --- |
| Experiência → Atendimento | `db_Experiencias` `grid-oejkc9WuBX`, `Atendimento` `c-xBWpl9SSPA`, lookup gravável para `grid-eGvJhrlDTH` | Um ID externo em texto não satisfaz a relação entre linhas usada nas fórmulas atuais. |
| Atendimento → Experiência reversa | `db_Atendimentos` `grid-eGvJhrlDTH`, `ID_Experiencia` `c-zXhjSpr2Vk` | Busca Experiências cujo campo Atendimento contém esta linha. Não é um ID externo armazenado. |
| Orçamento → Atendimento | `db_Orcamentos` `grid-LgsVNgYj3J`, `ID_Atendimento` `c-L-3Ddv7cPI`, lookup para Atendimento | O vínculo é estrutural, apesar dos textos e valores copiados no orçamento. |
| Orçamento → Experiência | `db_Orcamentos.Experiencia` `c-ZFbj5rInCv`, fórmula `ID_Atendimento.ID_Experiencia` | Não há, neste contrato, uma FK direta gravável de orçamento para Experiência. |
| OS → Orçamento → Experiência | `db_OSs` `grid-Umj75GSlHH`, `Id_Orcamento` `c-PTx5xN0UF3` lookup; `Id_Experiencias` `c-fPvceqLcPR` fórmula | A OS perde a resolução da Experiência mesmo com cliente, placa e valores já copiados. |
| Experiência → OSs | `db_Experiencias.xp_OSs` `c-TNM_wQpg2y` | Busca OSs por `Id_Orcamento.Experiencia=thisRow`; as linhas OS podem continuar existindo, mas deixam de participar dessa coleção. |
| Etapas OS → Experiência | `db_OSs_Etapas` `grid-khi866xSGv`, `ID_Experiencia` `c-BWs-R11x56` | Deriva de `ID_OS.Id_Experiencias`, preservando a dependência transitiva. |
| Planejamento → Etapas | `db_Processos` `grid-ddGJJK3zs5`, `Energia total` `c-CAe2gZZqd9` | Soma energia por Experiência e fase; a perda da resolução acima afeta a duração sugerida e o planejamento. |

Campos adicionais da Experiência continuam lendo o Atendimento: `categoria agendamento` `c-Du3bOQ2gFy`, `at_OrcamentosAprovados` `c-_zmaqf8zja`, `ux_Canal` `c-NtSlBEGa4w` e `ux_ExperienciaDeOrigem` `c-vX_QCiFOII`. A origem de retrabalho percorre `Atendimento.at_Origem` `c-qTAnKwg28E`, outro lookup de Atendimento.

`xp_OrcamentosGerados` `c-YHFvtWsNV7` também resolve orçamentos por `Orcamento.ID_Atendimento.ID_Experiencia`. Essa coleção alimenta os indicadores de retrabalho, cancelamento, não faturável e condições de saída. Portanto, alterar apenas a FK de uma OS não desacopla o conjunto.

## 2. O que é copiado e o que continua estruturado

Os filhos do orçamento são **tabelas com campos tipados e chaves textuais**, não apenas uma descrição livre. A maior parte dos dados comerciais é materializada em valores graváveis; não permanece uma fórmula recalculando preço a partir do rascunho do Atendimento.

| Tabela | Conteúdo verificado | Natureza após gerar orçamento |
| --- | --- | --- |
| `db_Orcamentos` `grid-LgsVNgYj3J` | Cliente, Contato, Veículo, Placa, totais, descontos, referência de serviços, desvio comercial, investimento e condições de parcelamento | Textos/números copiados e graváveis. Vínculos Atendimento/Experiência/OS e estados continuam estruturados. Não há trava de imutabilidade comprovada só por serem snapshots. |
| `db_Orcamentos_Diagnosticos` `grid-xqB705Hupo` | `Id_Orcamento` `c-w2_-fVKlI0`, `Id_Diagnostico` `c-lCwU0oLhur`, peça/parte/nome/dimensão, valores de referência/comerciais, origem do valor | Chaves e descrições são texto; valores monetários são números. `Cod` `c-R7w3HkhKw3` é fórmula de ordenação dentro do orçamento. |
| `db_Orcamentos_Servicos` `grid-Qw63i1ww0v` | `ID Orcamento` `c-rSB8OUf47K`, `ID Diagnostico` `c-NJWzNcgJcG`, `ID Servico` `c-Jc4MOnyeC3`, código, serviço/dimensão, quantidade, energia e valores | Chaves textuais e valores copiados. É preciso conservar o vínculo lógico e o código hierárquico; não basta enviar o nome do serviço. |
| `db_Orcamentos_Itens` `grid-SRAMUtadEm` | IDs textuais de orçamento/diagnóstico/item, código, item, parte/peça, quantidade, unitário e total | Snapshot tabular com junções por texto. |
| `db_Orcamento_Etapas` `grid-DpdMZC56vP` | IDs de orçamento/diagnóstico/etapa, serviço/dimensão, energia, cluster, tipo, rateio, valor rateado e centro de receita | Snapshot de etapas e classificação. A fórmula `Peca-Parte` apenas compõe uma apresentação. |

As ações `gerarOrcamento_CriarDiagnosticos` `c-haQTBUP7xX`, `CriarServicos` `c-rE135O4F30`, `CriarItens` `c-rxYt425QG4` e `CriarEtapa` `c-NnF0Zl6VMX` leem os filhos editáveis de Atendimento e catálogos e preenchem essas tabelas. **Se o aplicativo importar diretamente um snapshot estruturado por um novo contrato, não precisa usar esses mesmos geradores nem copiar todos os rascunhos comerciais.** Esse caminho de entrada ainda precisa ser implementado e testado em ambiente seguro.

A geração atual do identificador de orçamento (`gerarOrcamento_CriarOrcamento` `c-wxtscuSYb3`) usa placa normalizada, `RowId(Atendimento)` e quantidade de orçamentos vinculados. O novo aplicativo precisa de mapeamento explícito entre seu ID/versionamento e os IDs Coda; não pode presumir que um UUID externo seja aceito como lookup ou tenha a mesma semântica de sequência.

Na OS, os valores de cliente/veículo/placa/preço são copiados, mas os filhos têm relações vivas: Diagnóstico → OS (lookup), Serviço → Diagnóstico (lookup), Etapa → Serviço (lookup), com OS e Experiência derivadas. `db_OSs_Itens` contém IDs classificados como texto no schema; não tratar todos esses campos como FKs tipadas equivalentes.

## 3. Catálogos ainda influenciam a execução depois de aprovado

**Achado material:** `db_Orcamentos.gerarOS_Etapas` `c-LDmKXwstxH` não copia as linhas de `db_Orcamento_Etapas`. Ele percorre os serviços já criados na OS, encontra `cnf_RelacaoServicoEtapa` `grid-p-wZJbfjUD` por **nome comercial do serviço** e dimensão, e cria etapas/energia a partir do catálogo atual.

Referências principais: `cnf_RelacaoServicoEtapa.Servico` `c-7sr002IvYn`, `Dimensao Servico` `c-EBO2IBlQEH`, `Etapa` `c-AWrfBjSHDl`, `Dimensao Etapa` `c-B9QLxROotP`, `Energia` `c-Ii7Vzlr1ni`; o serviço referencia `cnf_Servicos` `grid-lhdFxol6x-`, `Nome comercial` `c-TvFH_jzZ3k`.

Além disso, `db_OSs_Etapas.Fase` `c-1bujdvSjCP` continua sendo fórmula: procura `cnf_FaseOperacional` `grid-8fpISFOBb-` onde `ServicosContemplados` `c-SperxJDvv3` contém o nome do serviço copiado, e retorna a primeira fase. `db_Processos.Energia total` utiliza essa fase.

Consequências estáticas:

- Nome livre criado pelo app, nome comercial renomeado ou dimensão incompatível podem não encontrar as etapas/fases esperadas.
- Um catálogo alterado entre aprovação do orçamento e liberação da OS pode produzir etapas/energia diferentes do snapshot de orçamento. Não houve teste demonstrando ocorrência ou impacto; a dependência da definição atual está comprovada na fórmula.
- `gerarOS_Processo` `c-RLoNWzFW_X` ainda consulta fases com `AptoGant` `c-8UuC3zZ8ql` e `Ordem` `c-uQ_ImdUtxC` para criar processos.

O contrato precisa registrar IDs estáveis, rótulos e versão dos catálogos utilizados, e decidir se o Coda continuará expandindo etapas pelo catálogo operacional atual ou receberá etapas aprovadas de maneira explícita. Alterar essa regra exige aprovação; não deve ser corrigida silenciosamente durante a separação dos sistemas.

## 4. O agendamento vigente ainda é orientado ao Atendimento Coda

`Atendimento.at_Agendar` `c-Pi7uRxxs7X` cria uma linha de `ux_Agendamento` `grid-kNTH-9FQX6`; não cria diretamente a Experiência. `ux_Agendar` `c-q1JGnvyOwr` apenas chama esse botão. O preenchimento inicial procura cliente por telefone e veículo por placa com `.First()`; isso descreve o código existente, não uma política segura de desambiguação para o app.

Na tabela auxiliar:

- `ID Atendimento` `c-GG8e0rZMIs` é lookup para Atendimento.
- `Orcamentos a serem aprovados` `c-yvRmI_MHbs` é fórmula que busca todos os orçamentos desse Atendimento.
- `Concluir` `c-AxrS9QfHHu` exige cliente, veículo, pagador, data de chegada e pelo menos um orçamento na coleção. A soma usa a flag `Aprv.` `db_Orcamentos.c-_H4DySrGEC`.
- A ação testa se `Atendimento.ID_Experiencia` já existe; se vazio, chama `criar_experiencia` `c-OP-bvGAi7u`, que grava o lookup Atendimento e cadastros/datas na nova Experiência.
- Depois muda o Atendimento para Agendado; marca orçamentos selecionados como `Consentido` e não selecionados como `Rejeitado`; cria relação entidade/veículo se não existir; abre a Experiência e apaga as linhas da tabela auxiliar.

Essa definição mostra intenção de evitar duplicação de Experiência, mas não prova uma transação/lock idempotente sob concorrência. A ação usa `ux_Agendamento.DeleteRows()` na tabela inteira; reutilizar a mesma interface auxiliar via integração concorrente requer auditoria específica, sem execução em produção.

A condição de desabilitação verifica o tamanho da coleção de orçamentos, mas não comprova que pelo menos um esteja marcado `Aprv.`. Não se deve transformar esse controle de interface, isoladamente, em prova de aprovação comercial válida no contrato do app.

**Consentimento comercial não equivale a autorização técnica da OS.** `inspecao_validacao` `db_Orcamentos.c-GlR_ht20ib` aceita estado `Consentido`, registra pessoa/data de validação, muda para `Autorizado` e chama `gerarOS_Orquestrador` `c-n1Sk01JuZv`. O handoff de “aprovado” deve definir se representa a aprovação do cliente, preservando essa liberação técnica no Coda. O aplicativo não deve importar diretamente como Autorizado para pular a inspeção.

## 5. A inspeção pode devolver o orçamento ao comercial

`db_Orcamentos.inspecao_ProporNovoOrcamento` `c-yTClTXEiGL` contém uma sequência explícita:

1. Marca o orçamento como Rejeitado.
2. Chama `revisaoOrcamento_Atendimento` `c-97iBwPxxrR`, que **apaga** os serviços, itens e diagnósticos editáveis do Atendimento vinculado.
3. Chama `revisaoOrcamento_DIagnostico` `c-El6bdeBWqk`, `revisaoOrcamento_Servicos` `c-uppw8W7coW` e `revisaoOrcamento_Itens` `c-b1PL6bDe7s`, que reconstroem esses filhos a partir do snapshot do orçamento, com IDs de origem, nomes e valores.
4. Abre o Atendimento em `View_AcompRenegociar`.

O botão `Negociar` `c-AwhmX8MwUM` também abre esse Atendimento. Na reconstrução, nomes/descrições copiados são usados para preencher campos que voltam a ser lookups para catálogos. A resolução por texto e os `.First()` precisam ser validados, especialmente se o app mantiver nomes diferentes.

Logo, não é suficiente declarar que “o comercial termina no agendamento” e manter todos os botões atuais: existe retorno operacional → comercial. É necessário escolher entre devolver a demanda de revisão ao aplicativo, tornar o Coda dono do comercial após o handoff ou manter dois editores com um protocolo explícito. A terceira opção aumenta o risco de versões divergentes.

Não foi comprovada uma entidade independente chamada “aditivo” nem um fluxo completo de suplementos após OS autorizada. O botão acima fica desabilitado em estados Autorizado, Executado e Cancelado; portanto, sua existência não prova que cubra todos os acréscimos depois da autorização. Esse caso precisa de contrato próprio: nova versão/escopo, aprovação atribuível, vínculo à Experiência existente e atualização legítima de OS/planejamento/financeiro, sem duplicar Experiência nem reescrever escopo já aceito.

No modelo de compatibilidade, um orçamento suplementar da mesma passagem deve resolver o Atendimento Coda já associado à Experiência; criar outro Atendimento indiscriminadamente faria a fórmula atual do novo orçamento procurar outra Experiência. A distinção entre suplemento da passagem atual e novo retorno precisa ser explícita no evento.

## 6. Retorno e retrabalho criam uma nova demanda comercial no Coda

`db_Experiencias.ux_RefistrarRetorno` `c-RPBr29WoN4` foi lido integralmente. Ele cria um **novo Atendimento**, preenche dados a partir do cliente/veículo da Experiência, canal Recorrência, status Em negociação, fonte de precificação Retrabalho e `at_Origem` `c-qTAnKwg28E` apontando para o Atendimento anterior. Cria diagnóstico “Cuidados operacionais” e serviços a partir de `cnf_RelacaoDiagnosticoServicos` `grid-bfhEBGqPTC`; depois abre o novo Atendimento no Funil.

Esse botão não apenas reabre a Experiência anterior e não contém, nessa ação, a criação da nova Experiência. Se o app for o dono comercial, essa demanda deverá nascer nele ou ser incorporada por um evento com chave e proveniência claras. Deixar o botão atual criando um Atendimento paralelo sem esse acordo cria dois pontos de origem comercial.

O flag de Retrabalho passa pelo orçamento (`c-KBW86QIjab`) e é copiado à OS (`c-UVBN-ENmsA`); a Experiência deriva `flag_Retrabalho` `c-6OTq9M0H53` e `flag_NaoFaturavel` `c-tq7bn1bF9j` dos orçamentos. Não é apenas uma etiqueta visual: influencia o tratamento financeiro.

As ações OS `ConcluirOS` `c-W97DWlXgRB` e `CancelarOS` `c-hNnLKL03NA` mudam situação e data de finalização. Não foi encontrada nessas ações uma operação de reabrir OS. Não inferir o comportamento de reabertura por simplesmente reverter um status/data no aplicativo.

## 7. Financeiro pode permanecer no Coda, com os vínculos preservados

Faturas, títulos e transações têm vínculos próprios à Experiência; não dependem todos diretamente do Atendimento. A separação operacional/financeira é viável como responsabilidade de sistema.

Entretanto, na Experiência, `xp_ValorTotalOS` `c-VIvCUjDh7T` e `xp_ValorInvestimentoOS` `c-TC0xkXZZWe` somam as OSs encontradas pela cadeia Orçamento → Atendimento → Experiência. `xp_ValorRemanecente` `c--1ySID9nGB` depende desse investimento menos pagamentos, e `situacao_Financeiro` `c-s5ZEo-p4iV` considera flags derivados dos orçamentos.

**Não se está afirmando que remover Atendimento apagaria cobranças ou transações.** O risco demonstrado é perder as associações e recomputar incorretamente coleções/indicadores usados pelos processos, enquanto os registros financeiros persistem.

`Experiencia.xp_BtnFinalizar` `c-V4cBGYE3Lr` também muda orçamentos Autorizados para Executado e OSs em execução para Finalizada. O aplicativo precisará consultar o estado retornado pelo ERP; o handoff não encerra o ciclo de vida do orçamento copiado.

## 8. Opções técnicas e dependências de decisão

| Opção | O que muda | Avaliação |
| --- | --- | --- |
| App controla comercial; Coda recebe no agendamento um agregado de compatibilidade | Criar/vincular Atendimento mínimo Coda + snapshot estruturado do aprovado + Experiência. Leads e rascunhos ficam só no app. Definir retorno de revisão/retrabalho ao app. | **Recomendação inicial de menor alteração**, sujeita a contrato e testes. Preserva a maior parte dos links existentes. Não implica replicar continuamente toda a negociação. |
| App controla comercial; nenhum Atendimento Coda para novos casos | Introduzir vínculo direto de orçamento/OS à Experiência e ID/origem externa; adaptar coleções da Experiência, flags, agendamento, renegociação, retorno e consumidores financeiros/operacionais. Preservar a leitura dos históricos existentes. | Possível, mas é uma reforma relevante do ERP, não apenas substituir tela ou enviar orçamento. Exige aprovação e validação em cópia. |
| Coda assume alterações comerciais após agendamento | Handoff define troca de dono; renegociação/retrabalho continuam nos editores Coda com estados retornados ao app. | Reduz alterações iniciais nesses botões, mas precisa ser uma escolha consciente de operação; pode deixar duas experiências comerciais de uso para a equipe. |

O contrato de transferência precisa cobrir, pelo menos:

- Identidade estável do Atendimento/app, versão aprovada, evento de handoff e mapeamento para row IDs Coda de Atendimento/Orçamento/Experiência; chave idempotente e confirmação recuperável.
- Cliente, veículo e pagador estruturados, datas e origem; sem associar automaticamente por `.First()` ou nome parecido.
- Diagnósticos, serviços, itens, códigos hierárquicos, quantidades, valores comerciais aceitos, referência de preço e descontos; IDs/rótulos/versionamento de catálogos, etapas/energia e classificação necessária aos processos existentes.
- Evidência de aprovação do cliente separada da validação técnica Coda; snapshots/versionamento que preservem escopo anterior.
- Rejeição técnica, revisão, suplemento, cancelamento e retorno/retrabalho como eventos com dono definido; vínculo à Experiência devida e recuperação de falha parcial.

**Primeiro ensaio seguro recomendado:** montar, em cópia autorizada, um único orçamento sintético com dois diagnósticos, serviços/itens e catálogos conhecidos; importar o agregado sem rascunhos comerciais, criar uma única Experiência e testar inspeção → OS → etapas → processos → agregado financeiro. Depois testar retry, revisão técnica, mudança de catálogo, suplemento e retorno. Isso valida a fronteira proposta sem alterar o ERP produtivo.

## 9. Divergências atuais observadas por leitura, sem correção

- `LiberarParaInsepcao` `db_Orcamentos.c-n2i7Vk__gu` contém tentativa de gravar `Experiencia.fase_Operacional`, que o schema atual identifica como fórmula não gravável. Ação armazenada e esquema divergem; não foi executada.
- O predicado do botão de saída `xp_DarSaidaNoVeiculo` usa `Status != Executado OR Status != Cancelado`; a mensagem `ux_InfosSobreSaida` usa `AND` na verificação correspondente. Não foi demonstrado o efeito operacional.
- Geradores de OS/orçamento usam várias ações `AddRow` e guardas visuais; não foi comprovada atomicidade ou unicidade sob retry/concurrency.
- Em `inspecao_validacao`, a atribuição de data original ocorre sob condição de data programada vazia. O comportamento esperado dessa condição deve ser conferido em cópia, sem normalizar o código por palpite.

Essas divergências não impedem estudar a separação, mas tornam inadequado copiar os botões ou prometer que um payload de orçamento aprovado acionará o fluxo completo com segurança sem ensaio de integração.

## 10. Complemento: agendamento de retrabalho tem implementação separada

Leitura adicional de formatos/ações, sem execução: `ux_AgendamentoRetrabalho` `grid-_fSkqlESYT`, na página `section-BT7Sqto-cE`. O esquema contém 18 colunas e informou três linhas; não li seu conteúdo. Evidência saneada em `HANDOFF_RETRABALHO_SCHEMA.json`. A existência dessas linhas não comprova uso atual nem execução bem-sucedida do fluxo.

Essa tabela não é equivalente ao `ux_Agendamento` normal:

| Aspecto | Definição atual do retrabalho | Impacto no contrato |
| --- | --- | --- |
| Atendimento e orçamento | `ID Atendimento` `c-GG8e0rZMIs` é lookup Coda; os orçamentos continuam selecionados por `ID_Atendimento`. | Mantém a dependência do Atendimento Coda e da versão aprovada estruturada. |
| Elegibilidade | `Concluir` `c-AxrS9QfHHu` fica desabilitado se faltar cliente, veículo, pagador, chegada ou se `totalSendoAprovado` `c-xwMGa93jw7` for zero. | A regra é diferente da coleção não vazia do agendamento normal. Total nominal, valor de investimento, gratuidade e responsável pelo custo precisam de definição explícita; não são campos intercambiáveis. |
| Criação da Experiência | Se `Atendimento.ID_Experiencia` estiver vazio, faz `AddRow` em Experiências com Atendimento e datas de chegada/entrega. | Preserva uma intenção de 0..1 Experiência por Atendimento; não prova exclusão mútua sob concorrência. Um novo Atendimento de retorno pode gerar uma nova Experiência, sem reabrir automaticamente a anterior. |
| Cliente, veículo e pagador | O `AddRow` da Experiência não preenche esses três campos. Na etapa seguinte, a ação tenta gravá-los no Atendimento. | Diverge do agendamento normal, que preenche os cadastros na Experiência. Duas colunas do Atendimento usadas como destino são hoje fórmulas: `cliente_Entidade` `c-jpIXfWpPRE` e `cliente_Pagador` `c-xmuHzzLrSR`; não são graváveis no schema atual. Isso é uma incompatibilidade estática, não um teste de falha executado. |
| Aprovação | Orçamentos marcados `Aprv.` viram Consentido; os demais viram Rejeitado. | Continua distinta da autorização técnica que libera OS. |
| Pagamento | `Pagamento` `c-fta6q5E7Ul` e `Forma` `c-eZFHNOkGyu` podem gerar linha em `db_Saldo` `grid-3LWgdKRekS`, com Experiência, valor recebido, forma, data, usuário e pagador. | É um efeito financeiro extra não observado na conclusão normal. A compatibilidade desse caminho com o financeiro atual não foi testada; não reproduzir recebimento no app por inferência. |
| Limpeza | Concluir e Cancelar chamam `thisTable.DeleteRows()`. | A limpeza alcança a tabela auxiliar inteira, exigindo revisão de concorrência antes de reutilizar via integração. |

**Entrada do fluxo não certificada:** na leitura atual, `Atendimento.retrabalho_Agendar` `c-gPBfwY5i4a` tem formato de botão e rótulo Agendar, mas não possui `actionFormula`. `Atendimento.ux_Agendar` `c-q1JGnvyOwr` chama `at_Agendar` `c-Pi7uRxxs7X`, o caminho normal. Esse caminho normal já verifica `at_Origem` para sugerir a FUNIX como pagador quando há origem. Não foi demonstrado um chamador atual para a tabela específica de retrabalho; controles de página, automações ou integrações fora das ações auditadas ainda podem existir. Não classificar essa tabela auxiliar como fluxo implantado apenas pelo nome ou pelas três linhas.

**Fronteira proposta com o app como dono comercial:** o registro de retorno originado no Coda deve criar ou solicitar uma nova demanda no aplicativo, carregando a Experiência de origem e o mapeamento para o Atendimento anterior. O aplicativo conduz diagnóstico/negociação/aprovação e volta a solicitar agendamento. No handoff de compatibilidade, cria-se um novo Atendimento Coda com `at_Origem` apontando para o Atendimento Coda anterior, e a nova Experiência é associada ao novo Atendimento. Essa proposta preserva a distinção entre novo retorno e suplemento da passagem atual; não executa a antiga Experiência novamente nem usa o ID de Experiência como se fosse um lookup de Atendimento.

A escolha de quem inicia esse retorno, qual editor assume a nova demanda e qual regra financeira se aplica ao retrabalho permanece decisão de negócio/integração. O fluxo dedicado encontrado exige teste em cópia e não deve ser reutilizado como se fosse o agendamento normal validado.
