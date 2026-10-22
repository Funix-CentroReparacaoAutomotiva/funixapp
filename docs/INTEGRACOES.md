# FUNIX — inventário de automações verificado

Investigação de 21/10/2026, apenas em leitura, usando o conector Funix <> n8n. Não foram executados fluxos, chamados webhooks, enviados WhatsApps, criadas credenciais nem alteradas configurações. Não foram consultados dados de execução com `includeData: true`. Este documento contém metadados e contratos, sem mensagens pessoais ou segredos.

## Evidência e alcance

Foram consultados `get_instance_context`, `search_workflows`, `get_workflow_details` (incluindo grafo da versão publicada), `search_workflow_executions`, `get_workflow_execution` com dados desativados, `list_credentials`, `search_data_tables` e `search_projects`.

Existem quatro workflows acessíveis e ativos. Nenhuma Data Table do n8n foi encontrada no escopo acessível. O projeto visível é pessoal e a instância informa `teamProjectsEnabled: false`; isso descreve o ambiente atual, sem constituir decisão sobre a futura arquitetura do app.

| Workflow | ID | Nós | Produção versus draft |
|---|---|---:|---|
| FUNIX \| WhatsApp \| Classificar contatos \| PROD | `21wpOido7t5OHb7i` | 49 | Diferentes |
| FUNIX \| WhatsApp \| Enviar mensagem \| PROD | `22tutH8gEcX6bNoe` | 5 | Diferentes |
| FUNIX \| Orcamento \| Preparar dados PDF \| PROD | `EYGYfWf9rNeLsueT` | 4 | Diferentes |
| FUNIX \| Orcamento \| Gerar PDF \| PROD | `vE1QlFYjOcjEoMZx` | 5 | Iguais |

O contexto inicial resume atividade recente. As contagens abaixo vêm de buscas explícitas de execuções, que cobrem um histórico maior e não devem ser confundidas com as contagens do resumo inicial. São fotografias de um ambiente ativo, sujeitas a evolução.

## Classificação e triagem WhatsApp

Versão publicada: `e07fec83-208c-4643-b21c-7200beec0d84`; draft consultado: `fc266800-a699-441a-aa29-f5e2221f39c4`.

Há dois caminhos no grafo publicado: webhook POST de entrada e agendamento a cada minuto para triagem profissional. O schedule está desabilitado no draft, mas habilitado na versão publicada. Portanto, olhar apenas o draft produziria uma conclusão incorreta sobre a produção.

O caminho de entrada considera eventos `messages.upsert` recebidos (`fromMe=false`), exige ID de mensagem e JID físico WhatsApp, normaliza telefone e gera `fx_UUID` a partir de instância e ID da mensagem. A classificação é determinística; não foi encontrada chamada de IA nesse caminho. Mensagens específicas de candidatura são classificadas como Candidato; demais entram como Lead. Essa regra existente deve ser preservada até decisão de negócio, sem ampliar a interpretação por IA silenciosamente.

Consulta o Coda documento `2zsjI-nqWr`, tabelas `grid-eGvJhrlDTH` (atendimentos) e `grid-l9d-WgpqtC` (entidades). Respeita a preferência manual `Não gerar lead`. Verifica evento já gravado e atendimento aberto, utiliza Redis para contenção de concorrência e cria linha no Coda com `fx_UUID` como chave. Ao retornar após encerramento, associa origem pelo atendimento anterior. São existentes as gravações de tipo, interesse profissional, nome, contato, canal, status inicial, identificador de evento e JID; o app não deve reimplementar essas gravações em paralelo sem evitar duplicidade.

A triagem profissional usa reservas Redis, agrupamento por telefone, registro persistente no Coda (`Triagem automática`, coluna `c-709jttmf6R`), confirmação de persistência via mutationStatus, revalidação de elegibilidade e verificação de histórico na Evolution. Há proteções contra intervenção humana, janela temporal, duplicidade, estado incerto de envio e repetição indiscriminada. A configuração publicada limita cinco contatos por execução, janela de 24h, recuperação de reserva após 10min, duas tentativas e intervalo de 15min quando elegível. Possui baseline de contatos/linhas anterior à ativação; seus dados não foram incluídos neste relatório.

Histórico consultado: 4.970 execuções no total; as 200 mais recentes retornaram sucesso. Consulta específica de erros encontrou seis erros históricos (incluindo testes manuais). O erro mais recente verificado foi execução `4657`, em 20/10/2026 às 21:07:59 UTC (18:07:59 em São Paulo). Sua causa não foi diagnosticada, pois metadados não a demonstram. O status de sucesso de workflow não comprova que houve envio em cada execução; o caminho pode encerrar sem candidato elegível.

## Envio de mensagens

Versão publicada: `351ed7fe-3b60-426e-afc8-718dfe627172`; draft: `60e2f4fc-07ee-41ea-8e46-34a8054fcf12`.

Webhook POST autenticado por credencial de header. Contrato observado no grafo publicado: `body.telefone` e `body.mensagens` (array). O fluxo separa as mensagens e chama Evolution `/message/sendText/funix_comercial`, usando campos `number` e `text`. Lote de um item com intervalo de 1.500ms. Valida quantidade de respostas e recibo `key.id` com `key.fromMe === true`; retorna `ok`, `solicitadas` e `aceitas` pelo fluxo de resposta.

O recibo comprova aceitação pela Evolution, não entrega nem leitura pelo destinatário. Não foi encontrada persistência de um identificador de comando/idempotência neste fluxo simples. Uma repetição pelo app após timeout pode enviar novamente; isso exige projeto e validação antes de habilitar envio real.

Histórico completo acessível: 17 execuções, 16 com sucesso e uma com erro manual. Último sucesso observado: `3880`, 20/10/2026 às 14:11:32 UTC (11:11:32 em São Paulo). Nenhuma nova mensagem foi enviada nesta investigação.

## Preparação de PDF

Versão publicada: `c6738874-b9fe-42d7-bca4-1040fb84876d`; draft: `a96d0216-2a9b-4c16-8519-2f907d79cdce`.

Webhook POST com autenticação por credencial de header. Aceita JSON por `body.json`, `body.dados` ou pelo próprio body, inclusive texto JSON. Valida `meta.id`, presença de cliente/veículo e array de diagnósticos. O campo opcional `solicitacao` aceita somente `[A-Za-z0-9_-]` e tamanho de 8 a 80.

Armazena o JSON em Redis por 300 segundos. A chave é `funix:pdf:{id}:{solicitacao}` quando há identificador; sem ele o preparador ainda admite `funix:pdf:{id}`. Responde JSON com `sucesso`, `id` e `chave`.

Histórico acessível: 54 execuções, 52 sucessos e dois erros. Último sucesso observado: `5119`, 21/10/2026 às 04:41:50 UTC (01:41:50 em São Paulo).

## Geração de PDF

Versão publicada e draft iguais: `d87efefd-b4d1-43a4-82d1-381412ee9e39`.

Webhook GET; o grafo não configura autenticação no webhook. Busca no Redis pela composição de `query.id` e `query.solicitacao`, valida presença do JSON e coincidência de `dados.meta.id`, chama jsreport `/api/report` com template `FUNIX - Orcamento` e responde binário inline com nome `{id}.pdf`.

Existe uma assimetria contratual: o preparador admite `solicitacao` ausente, mas a expressão de chave do gerador concatena sempre `':' + query.solicitacao`. O app deve sempre emitir identificador de solicitação válido; compatibilidade do caminho sem identificador não foi comprovada. Não corrigir produção sem aprovação e teste isolado.

Histórico acessível: 47 execuções, 36 sucessos e 11 erros (incluindo testes manuais). Erros recentes `5091` e `5096` em 21/10/2026 foram seguidos por sucesso `5120` às 04:41:51 UTC (01:41:51 em São Paulo). Não há base para concluir causa ou resolução definitiva apenas com esses metadados.

## Plataformas verificadas indiretamente

Foram verificadas referências de credenciais e nós para Coda API, Coda Header Auth, Coda Pack Header Auth, Evolution API, Redis, PDF Basic Auth e JSReport. A listagem de credenciais retorna metadados sem valores secretos. A presença de credencial não prova validade atual nem autorização de um backend novo para utilizá-la.

Evolution API é chamada pela instância `funix_comercial`, com operações de localizar chats, consultar mensagens e enviar texto. Redis participa de locks e trânsito temporário de PDF. jsreport renderiza o orçamento. Não foi feita conexão direta com esses serviços, nem foi comprovada credencial utilizável pelo runtime local. Imagine.io não apareceu nos quatro workflows; isso não comprova inexistência fora desse escopo.

## Riscos e recomendações para o primeiro incremento

1. Manter o app inicialmente em leitura e separar adaptadores de dados de comandos. O ERP continua sendo a fonte de verdade. Não criar outro receptor de leads que dispute com o atual.
2. Usar o grafo publicado como referência de comportamento produtivo e registrar divergências com o draft. Publicar drafts existentes poderia alterar a triagem ativa.
3. Implementar autorização e segredos exclusivamente no backend. Os webhooks de classificação de entrada e geração PDF não têm autenticação configurada no grafo; exposição de produção, controles externos e política de acesso não foram auditados. Não apresentar tais rotas diretamente ao navegador como arquitetura final.
4. Habilitar envio real somente após contrato de idempotência, tratamento de timeout/recibo e recuperação de falhas ser validado em ambiente seguro. Não repetir automaticamente um envio cujo resultado é incerto.
5. Para PDF, sempre usar solicitação única e respeitar TTL de 300s; tratar expiração e falha do jsreport explicitamente. Revisar controle de acesso do PDF antes de liberar dados reais pelo app.
6. O histórico comprova execução e falhas reais, mas não fornece SLA ou teste funcional completo. Não foram consultadas mensagens ou cargas pessoais para explicar erros.

Essas recomendações são propostas técnicas reversíveis para desenvolvimento; alterações de autenticação produtiva, contratos, regras de negócio, publicação de workflows ou habilitação de comandos dependem de revisão apropriada e autorização da direção.
