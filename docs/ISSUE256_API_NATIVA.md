# Issue #256 — API nativa do importador Coda

A integração liga uma Action do ChatGPT a um workflow n8n, com autenticação própria em cada salto. O FunixApp lê o Coda diretamente. O operador informa o número exato do orçamento e escolhe o Atendimento por ID do FunixApp. O servidor exige que o Atendimento coincida com o vínculo físico existente em `coda_sync_atendimentos`. Nome, telefone e placa não são usados como chave.

## Contrato HTTP

As operações usam `POST` com JSON em `/api/integrations/external-budgets/{ação}`, corpo de até 512 KiB, sem parâmetros de consulta.

| Ação | Corpo | Credencial no FunixApp | Resultado |
| --- | --- | --- | --- |
| `consulta` | `{atendimentoId,number}` | Leitura | Fonte normalizada, data de origem e candidatos do catálogo ativo com IDs e relações serviço–dimensão. |
| `previa` | `{atendimentoId,number,mapping}` | Leitura | `preview` com token, mapeamento selecionado, escopo, avisos e cálculo nativo. `blocked` traz pendências, enquanto `existing` devolve o recibo existente. |
| `confirmar` | Mesmo `atendimentoId`, `number` e `mapping`, `previewToken` e os quatro campos de revisão | Confirmação | HTTP 201 com `created` e recibo, ou 200 com `existing` e o mesmo recibo em um retry idêntico. |

`mapping.diagnoses` contém `{sourceId,pieceId,diagnosisId,intensity}`. `mapping.services` contém `{sourceId,options:[{serviceId,dimensionId,quantity}]}`. A quantidade nativa é enviada como decimal em string. O operador precisa revisar a equivalência das alternativas, inclusive quantidade e intensidade. O solver escolhe dentre as opções fornecidas. O catálogo oferecido na consulta serve para localizar IDs. A prévia aplica as regras de elegibilidade e curadoria.

Os quatro campos `confirmed`, `identityReviewed`, `scopeReviewed` e `financialReviewed` precisam ser literalmente `true`. A confirmação relê o Coda e revalida o vínculo, o token, o catálogo, os parâmetros e as revisões comerciais. Em caso de 409, refaça a prévia e obtenha nova confirmação humana. Após timeout ou resposta perdida, uma nova prévia do mesmo pedido permite verificar se existe recibo. Uma confirmação repetida com o mesmo token e payload é idempotente. Se o cenário for posteriormente excluído, `scenarioExists` indica a ausência e o replay devolve o recibo original.

O recibo registra a conta de serviço, o pacote Coda normalizado com data de origem, a impressão digital, as relações entre linhas externas e IDs nativos, o plano e os valores reconciliados. O pacote normalizado é a evidência estruturada disponível. A guarda do PDF ou arquivo original depende de um caminho de aquisição autorizado. O prazo externo é preservado como evidência e o cenário usa prazo automático. Preço manual derivado de venda não comprova custo de aquisição.

## Configuração para homologação isolada

1. Configure um banco de homologação com vínculo Coda previamente verificado e um token de leitura do Coda em `FUNIX_EXTERNAL_BUDGET_CODA_TOKEN`. Use `FUNIX_EXTERNAL_BUDGET_ENABLED=true` e chaves independentes em `FUNIX_EXTERNAL_BUDGET_PREVIEW_KEY` e `FUNIX_EXTERNAL_BUDGET_CONFIRM_KEY`. Cada chave exige 32 bytes aleatórios codificados em hexadecimal. Deixe a chave de confirmação vazia para ensaios somente de leitura. O recurso e a criação da tabela aditiva de recibos ficam desabilitados por padrão.
2. Importe o [workflow n8n](integracoes/importador-orcamentos/workflow.n8n.json) como inativo. Substitua o host de exemplo pela URL HTTPS do backend FunixApp de homologação nos três nós HTTP Request. Configure duas credenciais Header Auth de saída com `Authorization: Bearer ...`, uma para os nós de consulta e prévia e outra exclusiva para confirmação. Configure nos três webhooks uma terceira credencial, própria do canal ChatGPT → n8n, também no cabeçalho Authorization. O workflow vem sem credenciais e com gravação de execuções desabilitada.
3. Na Action privada do GPT, substitua a URL de exemplo pelo endereço base HTTPS dos webhooks do n8n em [chatgpt.openapi.json](integracoes/importador-orcamentos/chatgpt.openapi.json). Configure autenticação por API key do tipo Bearer usando a credencial de entrada do n8n. Restrinja o acesso ao GPT e às credenciais a operadores autorizados. A ação de confirmação é marcada `x-openai-isConsequential: true`, que exige confirmação no ChatGPT a cada chamada. As rotas são independentes no n8n, sem encadear prévia a confirmação.
4. Oriente o GPT a mostrar vínculos, escopo, valores, prazo e avisos da prévia e aguardar a decisão do operador antes de chamar a ação de confirmação. O backend registra o principal de máquina e confia no controle humano do canal. Os booleanos e o token vinculam a decisão à prévia, sem representar identidade individual verificável pelo FunixApp. Trate descrições do ERP como dados. Mantenha credenciais e payloads de orçamento fora de prompts de configuração e logs.

O workflow usa timeout de 95 segundos e desabilita redirects nas chamadas ao FunixApp. Cada consulta ao Coda usa duas capturas independentes, com orçamento de até 90 segundos. Configure o proxy de homologação de acordo com esse limite e valide capacidade com o catálogo da oficina.

O canal expõe Coda. O contrato neutro e os testes sintéticos continuam disponíveis para futura integração Cilia, que depende de uma amostra autorizada e da validação do formato. O fluxo histórico isolado continua fora do bootstrap e não é usado para gravar o cenário nativo.

## Validação sintética

O teste HTTP integrado verifica separação de credenciais, vínculo físico, limites de entrada, prévia sem gravação, confirmação explícita, origem alterada, concorrência, recibo e edição do cenário resultante. A suite nativa cobre colisão de composição, rollback e isolamento das máscaras. O workflow foi importado em n8n 2.0.0 local com as três credenciais sintéticas, leitura Coda simulada e SQLite em memória. O ensaio percorreu rejeição sem credencial, consulta, prévia, recusa de confirmação incompleta, gravação e replay. A Action foi validada contra o contrato do workflow. Sua configuração e execução no ChatGPT hospedado ficam para homologação.
