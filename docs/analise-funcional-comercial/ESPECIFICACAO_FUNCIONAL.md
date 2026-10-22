# Módulo Comercial do ERP FUNIX — análise funcional e redesenho

Data: 21/10/2026. **RASCUNHO INICIAL**, baseado no inventário e na orientação da direção. Não constitui uma especificação completa homologada. Não houve mudança funcional na aplicação ou em produção nesta etapa.

## Objetivo do estudo

Definir o que o comercial deve entregar e projetar processos adequados ao sistema próprio. O ERP Coda é evidência de funcionamento e de regras; a implementação atual também contém mecanismos de interface, estado temporário, identificação e encadeamento exigidos ou escolhidos no contexto low-code. Esses mecanismos não são requisitos de negócio por existirem no documento.

O alvo é preservar os resultados válidos: contexto correto de Atendimento, composição do diagnóstico, serviços/itens escolhidos, preços e condições autorizados, versões de proposta, evidência de aceite e entrega operacional consistente. A quantidade de tabelas auxiliares, buscas e cliques pode mudar. Uma deficiência observada não será perpetuada como regra apenas para reproduzir a execução anterior.

Não se pressupõe que toda divergência encontrada seja um defeito ou que todo fluxo armazenado esteja em uso. Mudanças de preço, escopo, autorização, responsabilidade operacional ou UX aprovada precisam de decisão explícita. Otimizações técnicas reversíveis podem ser projetadas sem pedir à direção que escolha detalhes de implementação.

## Método por operação comercial

Para cada operação, registrar:

1. **Intenção:** quem está tentando fazer o quê e em qual Atendimento/contexto.
2. **Entradas e condições:** dados necessários, permissões, versões e decisões já existentes.
3. **Resultado observável:** o que precisa existir e aparecer ao concluir; como reconhecer sucesso.
4. **Regras a preservar:** critérios de cálculo/seleção, relações e limites comerciais que explicam esse resultado.
5. **Mecanismos atuais:** onde o Coda usa tabelas de interface, estado compartilhado, buscas, abertura de linhas e ações intermediárias.
6. **Processo proposto:** como a aplicação alcança o resultado com menos estado e coordenação desnecessários.
7. **Falha e concorrência:** cancelar, repetir, perder conexão ou editar em paralelo; o que deve e não deve persistir.
8. **Aceite:** exemplos e verificações de resultado, sem exigir a mesma sequência interna de Coda.
9. **Decisões pendentes:** somente lacunas reais, separadas de escolhas técnicas.

Esses contratos orientam o modelo conceitual e, depois, as tabelas, APIs e testes. Banco, cálculos e UI serão refinados juntos por incrementos; não se fecha um esquema completo por palpite.

## Base de evidência e autoridade

- V20: referência visual e de interação aprovada; não será redesenhada silenciosamente.
- Coda: inventário de 202 páginas, 164 bases e 1.691 colunas; leitura estática de fórmulas e ações. Esquema completo não equivale a validação operacional completa.
- Estudos em `../estudo-comercial-erp/`: dependências de Atendimento/orçamento/agendamento/OS, catálogos e integrações.
- Pedido atual da direção: otimizar o caminho preservando o resultado comercial, sem tradução literal do low-code.
- Documentos institucionais: contexto, sem promoção automática de diretrizes genéricas a funcionalidades.

Não foram executadas ações Coda ou lidos registros pessoais para este rascunho. Automações internas, controles fora de tabelas e alguns comportamentos em execução permanecem fora do inventário estrutural. Não se atribui à plataforma uma incapacidade geral de retornar IDs; o estudo trata os padrões concretos encontrados e os problemas relatados pela direção.

## Inventário funcional inicial

O [mapa geral do Comercial](MAPA_GERAL_COMERCIAL.md), versão 0.1, organiza o funcionamento reconstruído do Coda em duas partes para revisão da direção: caminho até o agendamento e ligações posteriores com a operação. É uma base de validação, não um redesenho aprovado.

Esta matriz identifica o escopo a detalhar. Apenas o primeiro caso de diagnóstico recebeu nesta rodada um desenho de operação mais aprofundado; os demais itens não estão automaticamente fechados por constarem na matriz.

| Operação | Resultado que interessa à FUNIX | Evidência atual | Otimização a estudar |
|---|---|---|---|
| Iniciar/retomar Atendimento | Demanda identificável, com contexto e dados proporcionais | Campos leves, status e origem em db_Atendimentos | Criação com ID explícito, sem cadastro prematuro; origem e autoria definidas |
| Localizar/organizar oportunidades | Encontrar e abrir o caso correto com fase/próxima ação pertinentes | Funil, status, retomada, ordenação; V20 Quadro/Lista | Consultas filtradas/indexadas e paginação; evitar recalcular/baixar todo o comercial |
| Vincular comunicação | Mensagens pertinentes à demanda, com canal e IDs originais | Contrato N:N do guia; integração atual ainda centrada em telefone/Coda | Associação explícita e desambiguação; não equiparar contato a Atendimento |
| Lançar diagnóstico | Diagnóstico no Atendimento certo e serviços aplicáveis corretamente relacionados | db_Atendimentos_Diagnosticos/Servicos e cadeia ui_* | Operação de negócio com IDs explícitos, estado de formulário isolado e gravação coordenada; detalhada no documento próprio |
| Ajustar serviços/itens | Composição coerente, quantidades/dimensões e seleção comercial rastreáveis | Catálogos, relações e auxiliares de edição | Edição contextual sem tabelas usadas apenas como telas; preservar regras de combinação |
| Calcular/negociar | Referência e valor comercial distinguíveis e resultados explicáveis | Regras tabelado/calculado/percentual; fatores, escala, curadoria e ajustes | Cálculo explícito sobre o conjunto pertinente e catálogo identificado; evitar consultas globais repetidas |
| Emitir/revisar proposta | Documento e dados correspondem à mesma versão comercial | Cabeçalho/filhos de orçamento e geração de JSON/PDF | Gerar versão consistente a partir de um conjunto identificado; separar composição do documento e renderização |
| Registrar aceite | Evidência de qual versão/escopo foi aceito e por quem/quando | Estados e agendamento; Consentido distinto de Autorizado técnico | Aceite de versão explícita; não inferir aceite por seleção técnica ou envio de mensagem |
| Comunicar/fazer follow-up | Envio atribuído ao caso, com resultado real e sem repetição indevida | Pack de seleção de copies; n8n de transporte | Comando persistente com identidade; estado incerto e reconciliação em timeout |
| Agendar/entregar à operação | Uma Experiência e orçamento operacional coerentes, com cadastros corretos | ux_Agendamento e dependência de Atendimento Coda | Transferência estruturada repetível, por caso, com confirmação; não executar auxílio compartilhado indiscriminadamente |
| Revisar após inspeção | Nova negociação preservando proposta anterior e vínculo operacional | Ações que reconstroem rascunho no Atendimento Coda | Revisão contextual no app; evitar apagar e reconstruir um rascunho compartilhado sem controle |
| Encerrar/retomar/registrar retorno | Motivo, origem e ciclo comercial coerentes | Encerramento e retorno que cria novo Atendimento | Distinguir edição, revisão da passagem atual e novo caso vinculado à origem |

## Separar negócio, apresentação e mecanismo

| Elemento observado | Tratamento no sistema próprio |
|---|---|
| Diagnóstico/serviço/quantidade, valores de referência e valores negociados | Conceitos de negócio; preservar significado e regras válidas |
| Histórico de propostas/aceite e origem de retorno | Evidência de negócio; preservar contexto e rastreabilidade |
| Mapa, regiões e seleção visual da V20 | UX aprovada; preservar o modelo visual durante o redesenho técnico |
| Tabelas ui_AtendimentoModal* utilizadas para abrir seletores | Aparentam cumprir função de interface; não são automaticamente entidades persistentes do novo comercial |
| Contexto guardado na última linha de uma tabela de interface | Substituir por contexto explícito do formulário/comando; não compartilhar estado global entre operadores |
| Uso de .Last() para vincular filhos ao registro recém-criado | Substituir por ID explícito conhecido/retornado pela operação; confirmar integridade dos vínculos |
| Limpar toda uma tabela auxiliar ao concluir/cancelar | Não transportar esse mecanismo; cancelar/limpar apenas o estado pertinente ao usuário/operação |
| Nome textual de serviço usado para localizar uma regra/fase | Planejar identidade estável e compatibilidade com o legado; alteração do resultado operacional exige aprovação |
| Fórmulas repetindo filtros/somas em toda a base | Estudar cálculo e consultas limitados ao contexto afetado; conservar a semântica e tornar explícitas dependências |

Não se conclui que todas as tabelas ui_/ux_ possam ser eliminadas: se um rascunho precisa ser recuperável, compartilhado ou auditado, ele pode merecer persistência de negócio. A finalidade deve ser demonstrada, não herdada do prefixo.

## Como avaliar a melhoria

Registrar uma comparação controlada por operação, com os mesmos dados e regras relevantes:

- Resultado de negócio: contexto, serviços/itens, valores/condições e versão corretos.
- Esforço do operador: ações e trocas de contexto necessárias na V20; não presumir que reduzir escolhas elimina controles úteis.
- Trabalho técnico: número de chamadas, consultas/gravações e extensão dos dados consultados, distinguindo navegador, servidor e banco.
- Tempo: medição de resposta e conclusão em cenários comparáveis; ainda não existe baseline de desempenho mensurado neste estudo.
- Integridade: repetição de comando, gravação parcial, atualização concorrente e troca de Atendimento sem mistura de contexto.

Não se promete ganho quantitativo sem medição. Transação de banco não equivale a uma única instrução SQL e não torna serviços externos atômicos. Geração PDF, WhatsApp e transferência para Coda requerem confirmação/recuperação próprias.

## Entregas desta fase

1. Especificação funcional por operação, com resultados, regras e exemplos de aceite.
2. Matriz rastreável: manter regra, substituir mecanismo, investigar comportamento ou decidir mudança de negócio.
3. Fluxos propostos compatíveis com a V20 e suas exceções.
4. Modelo conceitual dos dados e contratos das operações, derivado dos fluxos; esquema físico ainda evolutivo.
5. Sequência de implementação do Comercial, começando por fluxos suficientemente entendidos, sem esperar todas as exceções futuras.

O estudo está iniciado. A primeira entrega existente do aplicativo permanece uma base de interface/leitura; não foi apresentada como comercial migrado. Nenhum banco comercial foi criado nesta rodada.
