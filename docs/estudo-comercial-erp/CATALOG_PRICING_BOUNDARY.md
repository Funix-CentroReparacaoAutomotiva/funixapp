# Fronteira entre comercial no aplicativo e operação no Coda

**Estado:** investigação somente leitura, com schemas e fórmulas observados em 21/10/2026. Nenhuma alteração no app, no ERP ou nas integrações. Nenhuma fórmula de ação ou botão foi executada. Não foram lidos cadastros, mensagens, diagnósticos de clientes nem valores de orçamentos individuais.

## Resposta à direção

**A separação proposta é tecnicamente viável, mas o diagnóstico não passa a ser “só texto” por causa da criação da Experiência.** O Coda trabalha com dois modelos: um rascunho comercial parametrizado e cópias de proposta/OS com descrições e valores materializados. O primeiro congelamento observado acontece em **Gerar orçamento**, antes do agendamento. A OS recebe outra cópia desses dados.

Essa parte da hipótese está correta: os diagnósticos e serviços de uma proposta e de uma OS não mantêm o mesmo motor de cálculo de preços do rascunho. Guardam nomes, dimensões, quantidades e valores copiados. Contudo, a operação ainda consulta catálogos de serviços, etapas, fases e capacidade. Em particular, **a geração da OS recalcula sua lista de etapas a partir do catálogo vigente, em vez de simplesmente copiar as etapas já congeladas no orçamento**.

Assim, copiar apenas PDF, texto de diagnóstico e valor total não entrega ao Coda tudo o que os processos atuais utilizam. E retirar o Atendimento do Coda envolve mais que mover a interface: é preciso escolher onde ficarão os catálogos, os cálculos e o ciclo de revisão comercial.

## O que está parametrizado no Atendimento

O rascunho de diagnóstico em `db_Atendimentos_Diagnosticos` tem relações para Peça, Parte, Diagnóstico, Intensidade (`Dim.`), Serviços (`Solucao`), Itens e Atendimento. Seu texto `Descricao` é calculado a partir dessas relações; os totais também são calculados. O operador pode informar um valor comercial por diagnóstico, com campo separado de origem desse valor.

Os serviços do rascunho em `db_Atendimentos_Servicos` referenciam serviço e dimensão dos catálogos. A regra de preço é procurada por base de precificação do Atendimento, produto e dimensão, com alternativas de regra genérica. A fórmula `Vlr. serviço` tem três ramos explícitos:

| Tipo observado | Dependências do cálculo |
| --- | --- |
| Tabelado | Valor do produto definido na regra. |
| Calculado | Valor do produto, fator da dimensão, quantidade e fator de escala. |
| Percentual | Percentual da regra aplicado a outra base de referência, dimensão, quantidade e escala. |

Os fatores de cor e risco são aplicados somente quando a regra marca sua aplicação. Há tratamento de fator ausente e arredondamento com `Ceiling(... * 100, 5) / 100`. O comportamento da quantidade não se reduz a multiplicar um preço fixo pela quantidade: existe escala, e os ramos calculado/percentual não usam exatamente a mesma expressão de seleção de escala.

Os itens/peças comprados em `db_Atendimentos_Itens` têm valor de compra, quantidade e valor de venda calculado com `escopo_FatorCuradoria` do Atendimento. Os totais comerciais distinguem referência de serviços, valor efetivamente negociado por diagnóstico, desconto efetivo e desvio comercial. Na proposta, também são copiados valores de parcelamento calculados com `Cnf_FormaPagamento`.

**Não foi adotada uma regra nova de preço.** O campo Energia participa da expansão técnica, do rateio e da sugestão de duração; a fórmula de preço inspecionada utiliza regras e fatores próprios. A existência de `Custo base`, `Fator Artesao`, `Fator Peca` ou outros parâmetros no catálogo, isoladamente, não prova que todos integrem a fórmula de preço atual. Não se deve portar esses campos como regras ativas sem rastrear seu consumidor.

## Catálogos que cruzam essa fronteira

| Grupo | Tabelas verificadas | Papel observado |
| --- | --- | --- |
| Identificação do dano | `cnf_PecaVeiculo`, `cnf_ParteVeiculo`, `cnf_Diagnostico`, `cnf_Diagnostico_Intensidade` | Relações do diagnóstico e formação de descrições. |
| Oferta de soluções | `cnf_Servicos`, `cnf_DimensoesServicos`, `cnf_NomeDimensoesServicos`, `cnf_RelacaoDiagnosticoServicos` | Serviço, dimensão, hierarquia/dicas e combinação diagnóstico → serviço/tamanho/intensidade/seleção padrão. A relação é consumida, por exemplo, pela ação operacional de registrar retorno. |
| Preços | `cnf_BasePrecificacao`, `cnf_BasePrecificacaoServicos` | Base, vigência, referência de outra base e regras por produto/dimensão; tipos `calculado`, `tabelado`, `percentual`; opções de cor/risco. |
| Multiplicadores | `cnf_TiposTinta`, `cnf_RiscoOperacional` | Multiplicadores de cor e risco ligados ao Atendimento e aplicados condicionalmente. |
| Expansão técnica | `cnf_RelacaoServicoEtapa`, `cnf_Etapas`, `cnf_DimensoesEtapas`, `cnf_Energia` | Serviço/dimensão → etapas, dimensão de etapa, energia, escala, ordem e centro de receita. |
| Apresentação e distribuição de valores | `cnf_ClusterOrcamento`, campos de cluster/tipo/diagnóstico de exibição em `cnf_Etapas` | Informações copiadas para as etapas do orçamento e usadas na construção do documento. |
| Operação | `cnf_FaseOperacional`, `cnf_CapacidadeDiaria` | Associação serviço → fase, ordem de processos e energia diária para duração sugerida. |
| Condições de pagamento | `Cnf_FormaPagamento` | Taxas utilizadas ao copiar totais e parcelas para o orçamento. |

São dependências verificadas no modelo/formulário/fórmula, e não uma confirmação de que todas as telas e ações legadas estejam homologadas. Os formatos completos de alguns catálogos retornaram erro interno no conector; nesses casos foi reaproveitado o schema simples e as referências explícitas das fórmulas, sem inferir os detalhes omitidos.

## O que é copiado e o que continua vivo

“Congelado”, nesta tabela, significa **valor materializado no registro**. Não significa que o campo seja imutável ou protegido contra edição: muitos desses campos continuam tecnicamente graváveis no Coda. A proteção da versão aceita precisará ser validada no contrato de integração.

| Momento/registro | Copiado naquele momento | Dependências que continuam vivas |
| --- | --- | --- |
| Atendimento em elaboração | Dados livres e relações escolhidas pelo operador. | Catálogos, regras de preço, fatores, quantidades, energia e somatórios do rascunho. |
| `gerarOrcamento_CriarOrcamento` | Cabeçalho, fonte de preço como nome, prazo, referência de serviços, valor comercial, desvio, peças, total, desconto, valores por grupo e parcelas. | Relação com Atendimento; status; relação derivada com Experiência/OS. Não há fórmula de recálculo de preço nesses valores copiados. |
| `gerarOrcamento_CriarDiagnosticos` | Descrição, nome, nome com intensidade, peça/parte como texto, referência de serviço, valor comercial, origem do valor, desconto, peças e total. | Código de apresentação do diagnóstico ainda é derivado da posição/ID; relações de agrupamento por identificadores da proposta. |
| `gerarOrcamento_CriarServicos` | Nomes de serviço/dimensão/peça/parte, quantidade, valores de referência/comercial e energia do serviço. | Identificadores textuais para ligação aos diagnósticos/orçamento; não conserva o lookup de precificação do rascunho. |
| `gerarOrcamento_CriarEtapa` | Etapa, dimensão, energia, ordem/código, cluster, tipo, centro de receita, diagnóstico de exibição, rateio e valor rateado. | Os dados foram buscados no catálogo ao gerar a proposta; não são fórmulas que recalculam o preço depois. |
| Criação da Experiência | Cliente/veículo/agendamento e vínculo com Atendimento, conforme fluxo de agendamento auditado em outra frente. | Orçamentos e OS continuam relacionados; criar Experiência não converte nem elimina o diagnóstico do Atendimento. |
| `gerarOS_Diagnosticos` e `gerarOS_Servicos` | Descrições, dimensões, quantidades e valores da proposta. A OS usa os valores comerciais copiados, inclusive distribuição do valor comercial por quantidade. | Vínculos internos OS/diagnóstico/serviço. Não foi encontrado novo cálculo de preço por catálogo nessas colunas da OS. |
| **`gerarOS_Etapas`** | Copia para a OS as etapas e a energia que o catálogo fornecer **na hora de gerar a OS**. | **Reconsulta `cnf_RelacaoServicoEtapa` pelo serviço/dimensão da OS. Não copia `db_Orcamento_Etapas`.** |
| OS criada / processos | Energia da etapa da OS fica como número. | A fase da etapa é calculada a partir do nome do serviço e de `cnf_FaseOperacional.ServicosContemplados`. Energia por processo soma essas etapas; duração sugerida divide pela capacidade diária vigente. |

### Consequência prática da consulta de catálogo na geração da OS

Se o catálogo técnico mudar entre a geração do orçamento e a geração da OS, a mesma descrição comercial pode produzir etapas/energia operacional diferentes. O preço comercial copiado não precisa mudar para que isso aconteça. Mudanças de nome ou diferenças de dimensão também afetam uma associação feita por texto.

Isso é um **risco identificado pela leitura da fórmula**, não um erro histórico comprovado nem autorização para corrigir a regra. É necessário decidir se a operação deve receber as etapas da versão orçada ou expandir as etapas vigentes na autorização técnica. O sistema atual faz a segunda consulta. Alterá-lo para copiar o orçamento seria uma decisão de negócio/ERP, não uma refatoração cosmética.

## O comercial também é reaberto depois da Experiência

O botão `inspecao_ProporNovoOrcamento` não termina na operação: marca a proposta para revisão e chama `revisaoOrcamento_Atendimento`, `revisaoOrcamento_DIagnostico`, `revisaoOrcamento_Servicos` e `revisaoOrcamento_Itens`. A primeira ação apaga o rascunho comercial correspondente no Coda; as seguintes o reconstroem a partir da proposta, incluindo os valores comerciais e sua origem.

Além disso, a ação `ux_RefistrarRetorno` da Experiência cria novo Atendimento e usa `cnf_RelacaoDiagnosticoServicos` para gerar seus serviços iniciais. Não foi executada. Essas referências demonstram que há caminhos **operação → novo trabalho comercial**, e não uma separação unilateral e definitiva na criação da Experiência.

Se o Atendimento passar a viver exclusivamente no aplicativo, esses caminhos precisarão abrir uma revisão/demanda no app ou manter uma camada compatível no Coda. Executar o botão legado sem essa decisão pode recriar ou apagar um rascunho que o app considera seu.

## O que significa “mover Atendimento para o app”

| Opção técnica | Trabalho necessário | Efeito sobre o motor atual |
| --- | --- | --- |
| App assume a interface; rascunhos e cálculos continuam no Coda | Adaptadores, comandos autorizados, IDs corretos, validação das ações e retorno das fórmulas. | Reaproveita catálogos e cálculo existentes. Ainda depende de Coda durante a negociação. |
| App passa a armazenar o comercial e consome cálculo/catálogos de um serviço controlado | Definir serviço autoritativo de cálculo, contrato de catálogo/versão, resultados e fluxo de revisão. | Evita dois motores concorrentes, mas exige serviço e acesso efetivamente disponíveis e testados. Não foi verificado que tal serviço já exista. |
| App armazena e calcula o comercial integralmente | Portar os catálogos e o comportamento preciso das fórmulas; governar sua edição e vigência; testes de equivalência; publicar cópia operacional consistente. | É migração do domínio comercial e de precificação, não apenas da tela. Exige decisão explícita da direção. |

Não é recomendação para mudar preço, base, margem, catálogo ou armazenamento agora. A escolha da fronteira deve ser aprovada antes de implementar a mudança.

## Conteúdo mínimo da passagem aprovada para a operação

Uma passagem compatível precisa representar, pelo menos, a versão aprovada e seus diagnósticos, serviços, itens e valores comerciais; identificadores de origem e agrupamento; quantidades/dimensões; nome e identidade do serviço reconhecíveis pelo Coda; energia/etapas ou uma decisão explícita sobre sua expansão; rateios e centros utilizados pelos documentos/financeiro; condições e evidência de aprovação; vínculo de agendamento/Experiência e caminho para revisão.

Há uma diferença entre **transportar a descrição para exibir** e **transportar um contrato operacional que o Coda consiga executar**. PDF e total ajudam na consulta humana, mas não substituem os registros filhos esperados pelas fórmulas atuais.

Recomendação proporcional para a próxima decisão: definir primeiro o dono dos catálogos e do cálculo; o instante em que a versão técnica fica fixada; e a forma de devolver revisões da inspeção ao comercial. Em seguida, testar em cópia um orçamento com serviço calculado, tabelado e percentual, quantidade maior que um, cor/risco, valor comercial por diagnóstico, itens, parcelamento e alteração de catálogo entre proposta e OS. Esta auditoria não executou esses cenários em produção.

## Evidências técnicas para conferência

Documento observado: `superhuman://docs/2zsjI-nqWr`.

| Evidência | Local/identificador |
| --- | --- |
| Rascunhos parametrizados e cálculo | `db_Atendimentos` `grid-eGvJhrlDTH`; `db_Atendimentos_Diagnosticos` `grid-voKGJyLSB-`; `db_Atendimentos_Servicos` `grid-aHz1ZDVlfK`; `db_Atendimentos_Itens` `grid-N4cjfFoShQ`. |
| Regra de serviço e seleção de base | Serviço: `c-CTMaCn6A8p` (`Vlr. serviço`), `c-hxarcKkPOG` (`Regra precificacao`), `c-JfloaDYRDT` (`Regra Base Referencia`). |
| Ajuste comercial por diagnóstico | Diagnóstico: `c-vxV-TOLYF2` (`comercial_ValorServico`), `c-Qnyd6oKSUp` (`comercial_OrigemValor`), `c-V-EhbSU0at` (`comercial_ValorEfetivo`). |
| Criação da proposta e seus filhos | Atendimento: `c-wxtscuSYb3`, `c-haQTBUP7xX`, `c-rE135O4F30`, `c-NnF0Zl6VMX`, `c-rxYt425QG4`; orquestrador `c-GQKGjK00am`. |
| Tabelas copiadas da proposta | `grid-LgsVNgYj3J`, `grid-xqB705Hupo`, `grid-Qw63i1ww0v`, `grid-SRAMUtadEm`, `grid-DpdMZC56vP`. |
| Geração de OS e etapas por catálogo vivo | Orçamento: `c-n1Sk01JuZv` (`gerarOS_Orquestrador`), `c-LDmKXwstxH` (`gerarOS_Etapas`). |
| Etapas e duração operacional | `db_OSs_Etapas` `grid-khi866xSGv`, `c-1bujdvSjCP` (`Fase`); `db_Processos` `grid-ddGJJK3zs5`, `c-CAe2gZZqd9` (`Energia total`), `c-scijESvRj5` (`Sugestao_Duracao`). |
| Reabertura de rascunho | Orçamento: `c-yTClTXEiGL`, `c-97iBwPxxrR`, `c-El6bdeBWqk`, `c-uppw8W7coW`, `c-b1PL6bDe7s`. |
| Retorno da operação | Experiência: `c-RPBr29WoN4` (`ux_RefistrarRetorno`), capturado no inventário global de páginas. |

Capturas locais de referência: `coda-schema.json`, `coda-processes.json`, `erp-full-audit/tables/boundary-grid-eGvJhrlDTH.json`, `boundary-grid-LgsVNgYj3J.json`, `boundary-grid-voKGJyLSB-.json`, `boundary-grid-aHz1ZDVlfK.json` e os quatro schemas de filhos de orçamento. Os arquivos `.cfl` desta pasta são **texto das fórmulas lidas**, não scripts executados.

**Limite da conclusão:** comportamento declarado em schemas e fórmulas foi verificado. Execução completa, coerções entre texto/lookup, concorrência, imutabilidade e equivalência de preços ainda precisam de testes em cópia. Alguns botões legados escrevem em colunas que o schema atual apresenta como derivadas; isso deve ser validado antes de reaproveitar essas ações por API. Não se conclui que todos os botões funcionam apenas porque sua definição foi localizada.
