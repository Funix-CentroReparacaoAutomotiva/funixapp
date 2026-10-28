# API — MVP Comercial FUNIX V1.0 / Issue #7

API Node 24 existente com sessão de operador e banco SQLite próprio. A inicialização não instancia o adaptador Coda. O contrato antigo foi preservado em `historico/API_CODA_LEGADO.md`, sem validade como API ativa.

## Rotas

| Rota | Resposta |
|---|---|
| `GET /api/health` | Processo vivo, origem App/SQLite e capacidades; sem registros ou segredos |
| `GET /api/ready` | 200 somente com senha configurada e tabela local acessível; revisão da aplicação; sem consulta externa |
| `GET /api/session` | Estado autenticado/configurado |
| `POST /api/session` | JSON com senha, origem exata; cookie HttpOnly/SameSite=Strict e Secure quando HTTPS |
| `DELETE /api/session` | Revoga sessão; exige origem exata |
| `GET /api/atendimentos?q=&limit=50&offset=0` | Lista autenticada: `{items,total,nextOffset,stages}`; total do banco para a busca |
| `POST /api/atendimentos` | Criação autenticada e com origem exata; 201 com registro persistido |
| `GET /api/atendimentos/:id` | Registro autenticado por UUID técnico; 404 se inexistente/inválido |
| `PATCH /api/atendimentos/:id` | Atualiza campos permitidos e exige `revision`; 200 com registro persistido |
| `GET /api/workspace` e rotas `/api/experiencias*` | 410 após autenticação; função operacional fora do MVP; nenhuma consulta Coda |
| Outros métodos de negócio | 405; não há exclusão de Atendimento, envio externo, agenda ou comando operacional |

Contrato compartilhado em `shared/contracts.ts`: `Atendimento`, `AtendimentoInput`, `AtendimentoPatch`, `AtendimentoList` e `ATENDIMENTO_STAGES`. Os tipos antigos permanecem somente para o adaptador legado isolado.

## Atendimento e validações

Telefone textual é obrigatório e precisa conter ao menos um dígito, sem exigir DDI/DDD ou ficha completa. Valores opcionais omitidos na criação viram texto vazio; omitidos no PATCH preservam o conteúdo anterior; texto vazio explícito limpa o campo opcional. Números/objetos/null não substituem textos. Telefone repetido é aceito, sem cadastro/vínculo ou escolha automática de outro Atendimento.

Campos graváveis: `phone`, `name`, `vehicle`, `brand`, `model`, `plate`, `reason`, `notes`, `stage`, `rejectionReason`, `explicitRefusal`. Campos técnicos retornados: `id`, `phoneNormalized`, `createdAt`, `updatedAt`, `revision`. São calculados no backend, não aceitos livremente do navegador.

Limites em caracteres: phone/plate 100; name/vehicle/model 250; brand 150; reason/notes 8000; rejectionReason 2000. JSON de cadastro/edição limitado a 64 KiB; senha a 1 KiB. Campos desconhecidos são rejeitados.

Telefone original é preservado com limpeza das bordas; a versão E.164 só é preenchida para formato internacional inequívoco com `+` e quantidade plausível de dígitos. Um telefone nacional/ambíguo permanece válido sem normalização inventada. Não há consulta a provedor ou Coda.

Fases: `novo-lead`, `aguardando-dados`, `em-negociacao`, `morno`, `frio`, `rejeitados`. Rótulos exatos da V1.0; a criação padrão é Novo lead. Mudanças são manuais. Rejeitados exige `explicitRefusal: true` e motivo preenchido; nenhum job avança fase por tempo.

A atualização é SQL condicional pela revisão técnica; se o registro mudou, retorna 409 `VERSION_CONFLICT` sem sobrescrever. Essa revisão não é versão A/B/C de orçamento. Emissões de orçamento têm sequência e imutabilidade próprias, descritas abaixo.

## Segurança, pesquisa e erros

Todas as operações de dados exigem sessão. POST/PATCH também exigem `Origin` idêntico a `FUNIX_APP_ORIGIN` e Content-Type JSON. A UI continua na mesma origem, inclusive por proxy local de desenvolvimento. Sem CORS permissivo.

Consultas parametrizadas; busca simples em textos normalizados para ignorar acentos/caixa e em ID. Busca por telefone tolera formatação; pesquisa alfanumérica de placa/ID não é ampliada por dígitos de telefones não relacionados. `limit` 1–100 e `offset` inteiro não negativo; `q` até 150 caracteres.

Erros usam `{error:{code,message,requestId}}`, sem SQL, caminhos de banco, senhas ou stack na resposta. Casos: 400 dados inválidos; 401 autenticação; 403 origem; 404 registro; 409 revisão; 413 tamanho; 415 JSON; 500 erro interno; 503 readiness indisponível. Nunca retornar sucesso vazio como recuperação de falha de armazenamento.

Sessões permanecem em memória e reiniciar API exige novo login. Não há usuários/alçadas/SaaS. O limitador de login herdado usa endereço do peer, com as limitações atrás de proxy já documentadas. O banco persistido é independente da sessão.


## M1.2 — catálogos e diagnósticos

Todos os endpoints abaixo exigem sessão. POST, PATCH e DELETE exigem origem exata, JSON e corpo de até 64 KiB. Sem acesso externo. Tipos em `shared/commercial.ts`.

| Endpoint | Contrato |
|---|---|
| `GET /api/catalogos` | `{items,hierarchy}`: todos os metadados comerciais locais e árvore V2 original |
| `GET /api/catalogos/:id` | Item local; IDs V2 devem ser URL-encoded (`v2%3Acapo`) |
| `POST /api/catalogos` | `{kind,name,status?,code?,serviceId?}`; 201. `kind`: peca/diagnostico/servico/dimensao; status padrão proposta |
| `PATCH /api/catalogos/:id` | `{revision,name?,status?,active?}`; código, fonte, lado e serviço pai são imutáveis |
| `GET /api/catalogos/:id/historico` | Revisões com data e metadados registrados; não é versão de orçamento |
| `GET /api/atendimentos/:id/diagnosticos` | Itens da composição com serviços filhos |
| `POST /api/atendimentos/:id/diagnosticos` | `{pieceCodes:[codigo]}` ou dois códigos em seleção conjunta; transacional/idempotente por peça física; retorna lista atual |
| `PATCH /api/atendimentos/:id/diagnosticos/:itemId` | `{revision,diagnosisId?,notes?,enabled?,services?}`; substitui lista de serviços somente se fornecida |
| `DELETE /api/atendimentos/:id/diagnosticos/:itemId` | `{revision}`; remove item e serviços filhos, sem alterar o Atendimento |

Catálogo único: `status`, `source` e `suggestion` são metadados legados preservados por compatibilidade, sem bloquear seleção ou cálculo. Novos cadastros não exigem status nem aprovação. As 23 folhas sem código continuam apenas na navegação, bloqueadas para gravação. Cadastro manual exige código fornecido pelo operador; nunca geramos código físico. Demais catálogos começam vazios. Códigos físicos têm unicidade e não podem ser alterados pela API; nomes são textos, não chaves. Não se exclui cadastro: inativação preserva referências/histórico e impede novas seleções.

Dimensão pertence a um serviço ativo. Cada nova seleção exige tipo correto, atividade e identificação; peças precisam de código não vazio. Status e origem não participam da elegibilidade. Não se criam relações automáticas entre dano e serviço. Referências anteriores a itens depois inativados são preservadas, identificadas na tela e podem ser editadas/removidas. A precificação mantém a exigência de referências efetivas ativas e identificadas, além da configuração monetária/técnica necessária.

Uma linha de serviço recebe `{id?,serviceId,dimensionId?,quantity,enabled?}`. ID omitido cria linha; ID informado precisa já pertencer a este item. `quantity` é **string decimal positiva**, com ponto, até nove dígitos inteiros e seis casas decimais (limite técnico de entrada). Exemplo `"0.250000"` é armazenado e retornado como `"0.25"`. Não é float nem valor monetário. Números JSON, zero, negativos, notação exponencial e precisão além do limite são rejeitados. Dimensão pode ficar pendente (`null`) neste rascunho sem emissão. Máximo 50 linhas de serviço por item e 8000 caracteres de observações.

`enabled:false` mantém o diagnóstico e suas seleções; não pode liberar futuramente serviços filhos para precificação sem o pai ativo. A composição isolada não aplica preço manualmente no frontend. Cálculos, configuração e emissão usam as rotas abaixo; não há chamadas Coda. Falhas retornam os erros sanitizados existentes; 409 preserva dados sem sobrescrever.


## Issue #7 — cenários, preços, componentes e emissões

Mesma sessão de operador. Escritas exigem Origin exato e JSON; sem execução externa. JSON normal limitado a 64 KiB; manutenção da configuração comercial completa a 1 MiB. Valores financeiros de entrada são strings decimais com ponto, até 12 dígitos inteiros e 6 casas; ausência usa null, nunca zero implícito. Preços/fatores/energias configurados são não negativos; capacidade e quantidades devem ser positivas. Ajustes negativos de energia/fatores ainda exigiriam regra de catálogo explícita antes de ampliar essa validação.

Na interface compacta do PR #11, cenários são identificados pela `position` estável (1,2,3…), sem renomear cadastros existentes. O botão `+` envia `duplicateFrom` e `sourceRevision`, selecionando a cópia das flags; a UI não oferece cenário vazio nem renomeação. Esses contratos administrativos continuam compatíveis na API. Prévias e novas emissões usam `Cenário N` como rótulo; letras A,B,C… continuam exclusivas das versões emitidas. Snapshots/PDFs antigos não são regravados. Endpoints de catálogo permanecem autenticados, embora a operação não exponha acesso à manutenção de cadastros; serviços/diagnósticos/dimensões aguardam configuração pela direção, sem seed fictício.

| Endpoint | Contrato |
|---|---|
| `GET /api/atendimentos/:at/cenarios?scenarioId=` | Workspace: cenários/máscaras, composição mestre, cenário escolhido, revisão, componentes, parâmetros comuns e cálculos pré-negociação de todos os cenários |
| `POST /api/atendimentos/:at/cenarios` | `{name,duplicateFrom?,sourceRevision?}`; criação vazia ou cópia somente de flags |
| `PATCH /api/atendimentos/:at/cenarios/:id` | `{revision,name?,pieceFlags?,serviceFlags?,componentFlags?}`; mapas por ID e booleano, pertencimento verificado |
| `GET /api/precificacao` | `{revision,updatedAt,config}` inicialmente vazio |
| `PATCH /api/precificacao` | `{revision,config}` completo; valida chaves, referências, decimais, capacidade e duplicatas de especiais |
| `GET /api/atendimentos/:at/parametros` | Revisão da composição e `{tableId,colorId,riskId,mrId?}` comuns a todos cenários |
| `PATCH /api/atendimentos/:at/parametros` | `{revision,tableId?,colorId?,riskId?,mrId?}`; IDs configurados ou null; omissão preserva o campo anterior |
| `GET /api/atendimentos/:at/componentes` | Lançamentos monetários mestre, distintos das peças físicas |
| `POST /api/atendimentos/:at/componentes` | `{pieceId,name,quantity,manualPrice,fct?,notes,scenarioId?,scenarioRevision?,clientId?}`; preço null mantém pendência; zero explícito é valor. FCT é legado; cálculo novo usa MR global. `clientId` UUID opcional torna a criação idempotente no reenvio do mesmo conteúdo |
| `PATCH /api/atendimentos/:at/componentes/:id` | Mesmos campos + revision; identidade/peça de origem preservadas |
| `DELETE /api/atendimentos/:at/componentes/:id` | `{revision}`; exclusão global e cascata de máscaras |
| `POST /api/atendimentos/:at/orcamentos/previa` | `{scenarioId,negotiation}`; `{snapshot,token,canEmit}`; sem emissão nem perda de rascunho |
| `POST /api/atendimentos/:at/orcamentos` | `{scenarioId,negotiation,previewToken,idempotencyKey}`; 201 com versão e snapshot; repetição idêntica retorna a mesma versão |
| `GET /api/atendimentos/:at/orcamentos` | Metadados das N versões, ordem decrescente; sem transferir PDF/snapshots de todas em cada listagem |
| `GET /api/atendimentos/:at/orcamentos/:id` | Versão imutável com snapshot |
| `GET /api/atendimentos/:at/orcamentos/:id/pdf` | Bytes `application/pdf`, attachment com rótulo da versão, protegido pela mesma sessão |

Negociação: `{mode:"none"}` ou `{mode:"discount"|"adjust",value:"decimal",acknowledgeResidual:boolean}`. Desconto é valor monetário sobre serviços; não combina com ajuste. `previewToken` precisa corresponder ao estado corrente; dados alterados causam 409. Pendências da emissão causam 422 `BUDGET_INCOMPLETE`. Chave idempotente tem 16–100 caracteres alfanuméricos/hífen/underscore e não pode ser reutilizada para outro conteúdo.

Diagnósticos aceitam adicionalmente `scenarioId`/`scenarioRevision` em inclusão/edição; GET aceita `?scenarioId=`. Sem cenário explícito, usa o primeiro para compatibilidade. `enabled` é projeção da máscara escolhida, não atributo global. Uma linha aceita `notes` e `diagnosisId` próprios. IDs de linhas existentes não são trocados ao editar atributos; repetir o mesmo serviço gera outra linha, não agregação.

`shared/pricing.ts` define configuração, componentes, cálculo, prévia e snapshot. Totais gerados mantêm precisão exata inclusive além de duas casas; nenhuma soma financeira usa floats. A matriz apresenta antes da negociação. Somente linhas com pai e filho habilitados são elegíveis; referências inativadas em uso bloqueiam emissão até correção, sem apagar dados antigos. Snapshot/PDF não consultam dados vivos na leitura.

Configuração e prévia completas, exemplos e limites: [ISSUE_7_MVP_COMERCIAL.md](ISSUE_7_MVP_COMERCIAL.md). A API não afirma aceite jurídico nem cria OS. O contrato atual do editor/painel está em [EDITOR_FINANCEIRO_APROVADO.md](EDITOR_FINANCEIRO_APROVADO.md).

### Atualização editor/painel — MR único

`PricingConfig.resaleMultipliers?: {id,name,factor:string|null}[]` é mantido pelo operador, com as mesmas validações dos fatores existentes. Omitir a propriedade em PATCH legado preserva a lista; enviar `[]` a remove explicitamente. `PricingSettings.mrId?:string|null` pertence ao Atendimento e vale para todos os cenários. Não há seed nem fallback por FCT.

Componentes usam `teto_R$0,05(manualPrice × MR) × quantity`; ausência de MR/preço gera pendência. `fct` e notas existentes são preservados; PATCH sem `fct` mantém seu valor anterior. Repetir uma criação com o mesmo `clientId`/conteúdo retorna o componente existente sem alterar revisão; conteúdo diferente causa conflito. PATCH segue exigindo a revisão, sem reenvio automático do transporte.

`Calculation.serviceNet?:string|null` e `adjustment?:string|null` são decomposições exatas do backend: serviços líquidos e ajuste efetivo assinado em relação ao subtotal original. Opcionais para compatibilidade de leitura dos snapshots schema 1 anteriores. A UI possui somente Desconto/Negociação; entrada zero vira `{mode:'none'}`. Negociação não nula usa o contrato já existente `valueIncludesComponents:true`. Conferir é somente leitura; Emitir obtém a prévia internamente e mantém `previewToken`, confirmação expressa, ciência residual e `idempotencyKey`. Nenhuma alteração na validação financeira de `server/budgets.ts` nem na geração de PDF.
