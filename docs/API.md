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

### Confirmação de autosave (Issue #22)

`PATCH /api/atendimentos/:id/diagnosticos/:diagnosticoId` e `POST/PATCH /api/atendimentos/:id/componentes[/:componenteId]` aceitam o header opcional `X-Funix-Include-Revision: 1`. Com ele, a resposta de sucesso é `{item,scenarioRevision}` (`CommercialSave<T>`); sem ele, o item e os status HTTP anteriores são preservados. A revisão retornada é a revisão efetiva do cenário, lida dentro da mesma transação da gravação, inclusive na recuperação idempotente de componente. Não é uma revisão estimada pelo navegador. Os corpos continuam exigindo as revisões existentes; conflitos permanecem 409 atômicos.

O editor usa essa confirmação para encadear gravações sem GET intermediário. Flags isoladas usam o PATCH existente de cenário, que já retorna sua revisão. O GET final do workspace continua atualizando cálculos e comparação de todos os cenários. Após falha de transporte, resposta ilegível/inválida ou conflito, o editor preserva o rascunho e exige tentativa explícita, com leitura de reconciliação antes de qualquer nova escrita. Um POST confirmado no banco não é repetido cegamente.

O catálogo é reutilizado somente durante a instância aberta do painel comercial. `Atualizar dados`, remontagem do painel e recarga da página voltam a consultá-lo; a API continua validando itens ativos em toda escrita. Não há cache persistente nem alteração dos endpoints de manutenção.

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
| `DELETE /api/atendimentos/:id/diagnosticos/:itemId` | `{revision,compositionRevision,scenarios}`; remove globalmente item/filhos com guard transacional; ver Etapa 2 abaixo |
| `DELETE /api/atendimentos/:id/diagnosticos` | `{pieces,compositionRevision,scenarios}`; até dois itens em transação única, inclusive Ambos |

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
| `POST /api/atendimentos/:at/componentes` | `{pieceId,name,quantity,manualPrice,notes,scenarioId?,scenarioRevision?,clientId?}`; preço null mantém pendência; zero explícito é valor. O único multiplicador é MR global; campos obsoletos são rejeitados. `clientId` UUID opcional torna a criação idempotente no reenvio do mesmo conteúdo |
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

Componentes usam `teto_R$0,05(manualPrice × MR) × quantity`; ausência de MR/preço gera pendência. A migração V7 remove o multiplicador individual; o contrato de componentes contém somente preço manual e os demais atributos atuais, sem esse campo. Notas continuam persistidas. Repetir uma criação com o mesmo `clientId`/conteúdo retorna o componente existente sem alterar revisão; conteúdo diferente causa conflito. PATCH segue exigindo a revisão, sem reenvio automático do transporte.

`Calculation.serviceNet?:string|null` e `adjustment?:string|null` são decomposições exatas do backend: serviços líquidos e ajuste efetivo assinado em relação ao subtotal original. Opcionais para compatibilidade de leitura dos snapshots schema 1 anteriores. A UI possui somente Desconto/Negociação; entrada zero vira `{mode:'none'}`. Negociação não nula usa o contrato já existente `valueIncludesComponents:true`. A prévia técnica continua somente leitura, sem botão manual no rodapé; Emitir obtém a prévia internamente e mantém `previewToken`, confirmação expressa, ciência residual e `idempotencyKey`. Nenhuma alteração na validação financeira de `server/budgets.ts` nem na geração de PDF.

### Configurações globais e estado de cálculo (auditoria PR17)

A rota web autenticada `/configuracoes` expõe **Catálogos** e **Precificação**, reutilizando os endpoints de catálogo/histórico e `/api/precificacao` existentes. Não depende de Atendimento nem introduz permissões/cadastros SaaS. A seleção dos fatores do Atendimento continua em `/api/atendimentos/:at/parametros`, no painel financeiro. O menu do Atendimento contém apenas seu histórico de orçamentos e ações contextuais.

O editor compara os campos atuais aos campos confirmados no workspace; essa comparação não calcula preço. Uma linha alterada mostra `Calculando…` até a leitura recalculada do backend. Em falha, `Valor não atualizado` substitui o preço dessa linha. Totais afetados também deixam de aparecer como definitivos; conferência/emissão ficam indisponíveis até confirmação/recuperação. Campos e linhas não afetados continuam editáveis.

Procedimento de banco V6 → V7, sem reset nem execução produtiva nesta entrega: [MIGRACAO_V7_MR.md](MIGRACAO_V7_MR.md).

### Issue #20 — flags comerciais por serviço (V7, sem migração SQL)

`PricingConfig.services[]` admite `colorFactorEnabled?: boolean|null`, `discountable?: boolean` e `billable?: boolean|null`. Persistem no JSON da configuração global existente, com o mesmo PATCH autenticado, origem, revisão e limites. Não são campos de diagnóstico/componente nem novas flags de cenário. `billable` é informativo: não zera preço nem exclui linha e não concede desconto.

Normal: `teto_R$0,05(base × FD × FV × (FC se habilitado, senão 1) × FR) × quantidade`. FC falso dispensa seleção/configuração de cor; true exige FC válido; null bloqueia o normal como pendência. FC omitido em configuração legada preserva a aplicação global anterior; desconto omitido equivale a **sem permissão**, inclusive para serviço sem configuração. Omitir uma flag em PATCH legado preserva o valor já gravado desse serviço; não substitui false/null por default. O editor cria novas configurações com FC pendente e desconto desabilitado. Booleanos textuais são rejeitados, e desconto não aceita null.

A exceção exata continua ignorando base/FD/FV/FC/FR e exigindo energia técnica válida. A flag de desconto continua valendo para o serviço com especial. `PricedLine.discountable?` e `Calculation.discountEligibleSubtotal?` registram a elegibilidade efetiva e seu subtotal original, opcionais para leitura dos snapshots anteriores. Modo `discount` rejeita valor maior que o subtotal elegível, sem valores negativos ou redução de linhas protegidas/componentes. Preços das linhas permanecem originais e o desconto continua sendo uma linha global, limitada ao subconjunto elegível; não foi inventado rateio por linha.

`adjust`/Negociação conserva o contrato já vigente sobre o subtotal de todos os serviços (inclusive conciliação para baixo e aumento proporcional com resíduo); `valueIncludesComponents:true` continua traduzindo o total geral sem negociar componentes. A confirmação da direção sobre elegibilidade restringiu especificamente o modo Desconto. Não se modificou esse segundo contrato por inferência.

Nenhum snapshot/PDF emitido é recalculado ou regravado. Detalhes, matriz e limitações da carga: [Issue #20](ISSUE20_REGRAS_COMERCIAIS.md).

## Finalização Issue #20 — decisões de FC/MR

O importador offline aplica a decisão da direção do comentário PR #21 `6500884942`: FC desabilitado para os IDs de Interna, Lavagem e Inspeção técnica; opção MR `Padrão`, fator decimal canônico `1.2` (= `1.20`). Não infere MR de `fator_curadoria`. O cadastro da opção não seleciona `mrId`: continua sendo PATCH explícito de parâmetros por Atendimento. MR local equivalente é reutilizado pelo próprio ID; divergências/duplicidades são reportadas sem sobrescrita. FR, Desconto, Negociação, especial exato e a API de orçamento permanecem nos contratos acima. Nenhuma execução na inicialização ou migração nova.

### Curadoria comercial — Issue #31 / schema V8

**Decisão posterior — Fase 1 (V8):** os seletores da lista de Diagnósticos, Mapa e Adicionar peça representam habilitação no cenário ativo. Para peça ausente, o frontend usa o POST existente e a habilita nesse cenário. Para peça já existente, usa `PATCH /api/atendimentos/:at/cenarios/:id` com `revision` e `pieceFlags`, sem criar nova identidade. Desabilitar não envia DELETE e não modifica `serviceFlags`/`componentFlags`. Exclusão global é ação explícita da lixeira, sempre confirmada na interface, usando a rota DELETE de composição e os mesmos guardas de revisão. Não há mudança de schema ou dos endpoints; essa decisão substitui a antiga semântica global dos seletores da Etapa 2. [Relatório](FASE1_HABILITACAO_EXCLUSAO.md).

Complemento posterior ao contrato V7 acima. [Relatório e decisões](CURADORIA_COMERCIAL_IMPLEMENTACAO.md). O manifesto por IDs Coda em `shared/commercial-curation.ts` distingue visibilidade de atividade: Interna/Encantamento ficam fora de novas inclusões, sem apagar/desativar referências antigas. Novas inclusões de serviço oculto, de origem Coda desconhecida ou da atividade técnica sem identidade canônica aprovada recebem `409 CURATION_SELECTION_BLOCKED`, antes de gravar. Diagnóstico Técnico/Inspeção técnica são uma oferta bloqueada para novas linhas, com ambos os IDs históricos preservados. Dimensões incompletas e os 16 diagnósticos não são filtrados por calculabilidade.

Confirmação de terceiros:

```http
PATCH /api/atendimentos/:at/cenarios/:scenario/servicos/:line/confirmacao
Content-Type: application/json

{"revision":2,"pieceRevision":3,"scope":"<executionScope da linha confirmada pelo servidor>","confirmed":true}
```

`scope` é a string JSON gerada por `executionScope` do contrato compartilhado (versão, política, serviço, dimensão e quantidade canônica). Exige sessão, mesma origem, linha pertencente ao Atendimento/cenário e revisões atuais. A confirmação exige peça/serviço habilitados e dimensão selecionada. Resposta: cenário atualizado, com revisão incrementada e mapa opcional `serviceConfirmations: { [lineId]: scope }`. Rejeita escopo/revisões obsoletos com `409 VERSION_CONFLICT`; linha de outro contexto resulta em 404; formato inválido em 400.

`DiagnosisItem.services[].executionConfirmed` é derivado/read-only e aparece somente em terceiros; não reenviar esse campo no PATCH genérico de serviços. O mapa de confirmações não é aceito no PATCH genérico de cenário. `confirmed:false` revoga a confirmação daquela linha/cenário. Cópia de cenário não copia autorização; mudar serviço/dimensão/quantidade revoga todos os escopos daquela linha; desabilitar peça/serviço revoga no cenário afetado. Resposta perdida exige reconciliar por GET antes de decidir novo PATCH, sem replay automático.

`Calculation.lines[]` pode conter `billing: 'billable' | 'not_billed'`, `execution: 'internal' | 'external_confirmation'` e `executionConfirmed`. Sem cobrança implica `unit/finalUnit/total: null`, não preço zero. A linha fica fora de subtotal, desconto e negociação, mas mantém energia/prazo e respectivas pendências. Cenário só com atividades sem cobrança pode emitir com total agregado zero quando tecnicamente válido; `nonBillableOnly: true` permite apresentá-lo como “Sem cobrança”. Terceiro sem confirmação e atividade sem energia válida bloqueiam emissão, mesmo com preço matematicamente disponível.

Novos snapshots guardam `commercialCuration: { version, digest }` e os escopos confirmados do cenário. Leituras de versões/PDFs anteriores continuam usando os registros imutáveis existentes. V8 acrescenta somente `scenario_service_confirmations` (FKs de cenário e linha, chave composta). O CLI de importação exige schema **exatamente V8**, não executa migração, inclui o manifesto no hash/relatório e recusa conflitos de curadoria/configuração local. Nenhum dado real foi importado como parte desta implementação.

## Issue #31 — presença global de peça (Etapa 2)

Os seletores de peças representam presença em `diagnosis_items`, compartilhada pelos cenários. `pieceFlags`, `serviceFlags` e `componentFlags` continuam sendo habilitação por cenário, manipulada pelo editor/comparação. Selecionar uma peça já presente não a recria nem modifica suas flags. Remover da composição apaga a peça e seus filhos dos rascunhos de todos os cenários, preservando catálogo e versões/PDFs emitidos.

`DELETE /api/atendimentos/:id/diagnosticos` aceita um ou dois IDs, para remover também Ambos em uma transação:

```json
{
  "pieces": [{"id": "ID_MESTRE", "revision": 1}],
  "compositionRevision": 5,
  "scenarios": [{"id": "ID_CENARIO", "revision": 4}]
}
```

As revisões vêm do último workspace confirmado; `scenarios` deve conter o conjunto completo de cenários atuais. Retorno: `{removed:true, removedIds:[...]}`. O servidor revalida composição, conjunto/revisões dos cenários e cada peça dentro da transação antes de qualquer exclusão. Conteúdo ou cenário alterados geram conflito, sem exclusão parcial. Requisição sem guard é inválida. O DELETE individual permanece disponível com `revision`, `compositionRevision` e `scenarios`, sujeito à mesma proteção.

A UI pede confirmação antes de enfileirar remoção quando há outros cenários habilitados ou conteúdo configurado, incluindo diagnóstico/anotação, serviços ou componentes. Cancelar não faz consulta nem gravação para essa remoção. Em resposta perdida/ilegível, a fila interrompe e oferece leitura/reconciliação explícita; não repete DELETE cegamente. Se o mesmo código reaparecer com outro ID, a intenção antiga não remove esse novo registro. Recriar uma peça após remoção global confirmada é uma nova inclusão vazia, não restauração de filhos apagados.

## Fase 2 — padrões financeiros e MR percentual

Decisão posterior da direção: novos Atendimentos recebem Tabela `Padrão`, FC `C1`, FR `R1` e MR `20%`. Os nomes identificam os cadastros inicialmente; depois, `config.defaults = {tableId,colorId,riskId,mrPercent}` preserva suas identidades estáveis, sem comparar fatores. IDs ausentes/ambíguos ficam pendentes. A manutenção existente pode alterar os fatores sem mudar seus IDs; a revisão da configuração continua invalidando prévias e rascunhos, nunca emissões.

- `POST /api/atendimentos` persiste os padrões na mesma transação de criação. Padrões posteriores não sobrescrevem escolhas existentes. Os quatro parâmetros continuam compartilhados entre cenários do Atendimento.
- `GET /api/atendimentos/:at/parametros` permanece estritamente de leitura. O estado acrescenta `mrPercent?: string|null` e `defaultsInitialized?: boolean`.
- `POST /api/atendimentos/:at/parametros/inicializar`, JSON `{}`, autenticado e protegido por Origin, inicializa uma única vez os campos realmente ausentes e converte MR legado inequívoco. Não repete alterações/revisões se já inicializado. `null` explícito é preservado; não se presume que uma limpeza antiga foi involuntária. A UI solicita esse POST somente para Atendimentos ainda não inicializados.
- `PATCH /api/atendimentos/:at/parametros` aceita `mrPercent`, decimal não negativo em **string**, com ponto, até 12 dígitos inteiros e seis casas decimais. `"0"` é válido; `null` é pendência explícita. Entrada inválida não altera o estado. Mantém revisão otimista e atualiza as revisões dos cenários. `mrId` legado continua aceito, mas não junto de `mrPercent`: gravar percentual limpa `mrId`; gravar identidade legada remove a representação percentual.
- O painel exibe nomes FC/FR. MR é um campo percentual, salvo ao sair do campo ou pressionar Enter; aceita vírgula/ponto na UI, preservando o texto durante edição. Até confirmação, totais não são apresentados como atuais. Falha/revisão divergente exige leitura explícita antes de nova tentativa; a intenção digitada é conservada.
- Multiplicador exato: `1 + percentual/100`. O motor usa racional BigInt, mantém o teto unitário de R$ 0,05 **antes** de multiplicar pela quantidade e registra `factors.MR` e `factors.MRPercent` nas novas linhas/snapshots. Não existe MR por componente nem criação de cadastro global a cada edição.
- `resaleMultipliers` e `mrId` existentes não são apagados. MR legado abaixo de 1 não pode ser convertido em percentual não negativo: conserva a interpretação original até substituição explícita, sem aplicar padrão ou um segundo MR. Snapshots e PDFs emitidos permanecem imutáveis.
- Esquema SQLite continua V8: parâmetros em `commercial_state.settings_json` e padrões em `pricing_configuration.data`; nenhuma tabela/migração nova.

Esta seção substitui exclusivamente as orientações anteriores de seleção manual obrigatória de `mrId`; os demais contratos comerciais permanecem vigentes.

## Fase 3 — intensidade mestre e regras de recomendação (V9)

Decisão posterior da direção: cada `DiagnosisItem` acrescenta `intensity: 'leve'|'moderado'|'severo'|null`, compartilhada por todos os cenários como `diagnosisId`. O campo é opcional **apenas nos tipos de leitura histórica**; os registros atuais retornam null quando não informados. O PATCH de diagnóstico existente aceita `intensity`, valida o enum e preserva o valor quando omitido. Null é uma limpeza explícita. Não altera serviços, dimensões, quantidades, componentes ou máscaras automaticamente. Revisões e recuperação do editor continuam no fluxo existente. Novos snapshots incluem a intensidade na composição; snapshots/PDFs antigos não são reescritos.

V9 acrescenta somente a coluna nullable/check de intensidade e `diagnosis_recommendations`. Não recria o banco. A nova tabela guarda ID estável de origem, tabela/linha Coda, diagnóstico, intensidade, serviço, dimensão, seleção padrão e status/reason da validação. FK aponta para o catálogo, não para Atendimentos. O par serviço–dimensão é conferido integralmente na carga e novamente na consulta; divergências são preservadas como `pending/DIMENSION_SERVICE_MISMATCH` e jamais retornadas como recomendações válidas. ID repetido, relação semântica duplicada, origem inválida, referência ausente ou alteração conflitante de regra existente impedem toda a gravação.

`GET /api/recomendacoes?diagnosisId=ID&intensity=leve` usa a sessão autenticada existente, não grava e retorna `{items:[{id,sourceRowId,sourceTable,serviceId,dimensionId,selectedByDefault}]}`. Somente regras válidas, com cadastros ativos/identificados e dimensão pertencente ao serviço. Não filtra `selectedByDefault=false`. Consulta vazia não insere nada. Métodos de escrita são recusados. Consulta não promete calculabilidade, não substitui a curadoria comercial nem concede autorização de seleção/execução: esses contratos continuam nos endpoints existentes. Nenhuma lista de sugestões nem inclusão automática foi criada nesta fase.

Carga administrativa: `node server/import-recommendations.ts --source ARQUIVO --database SQLITE_EXISTENTE` produz dry-run estritamente read-only; `--confirm-plan HASH` aplica o plano exato em transação, revalidando fonte e estado atual. O comando não carrega `.env`, não presume banco, não cria arquivo, não migra, não acessa rede nem roda no startup. Exige schema exatamente V9 e histórico contínuo. Relatório separa válidas, não selecionadas por padrão, pendências, conflitos, inserções e inalteradas. Repetição não duplica nem substitui regras. Mudanças de fonte/catálogo/regras invalidam o hash anterior. Pendências não são convertidas automaticamente em válidas quando a origem muda: divergência com registro existente exige revisão.

Contrato local normalizado, conferido com `funix-fase3-regras-importacao-v9.json` (SHA-256 `bcc58f8242825cae68486a61b4cdb40751c80977f0c9c6a3424692a2490da8af`) em SQLite V9 isolado: 77 relações, 74 válidas, três pendências, 16 false e zero conflitos. Evidência em `docs/evidencias/fase3/validacao-fonte-real.json`. O exemplo abaixo permanece exclusivamente estrutural/sintético:

```json
{
  "format": "funix-diagnosis-recommendations-v1",
  "documentId": "2zsjI-nqWr",
  "tableId": "grid-bfhEBGqPTC",
  "rows": [
    {
      "id": "i-EXEMPLO-SINTETICO",
      "diagnosisId": "coda:2zsjI-nqWr:grid-2ANpptuaKz:i-DIAGNOSTICO-SINTETICO",
      "intensity": "leve",
      "serviceId": "coda:2zsjI-nqWr:grid-lhdFxol6x-:i-SERVICO-SINTETICO",
      "dimensionId": "coda:2zsjI-nqWr:grid-7521QzZOVd:i-DIMENSAO-SINTETICA",
      "selectedByDefault": false
    }
  ]
}
```

Exemplo estrutural, não dados para carga. IDs FUNIX seguem `sourceId(tabela,rowId)` da importação anterior; são conferidos contra tabela/documento/tipo, sem associação por nome. Intensidades do arquivo podem vir com capitalização Leve/Moderado/Severo; são normalizadas exclusivamente para os três valores do enum. Seleção padrão precisa ser boolean. O original não é modificado. Se seu formato real divergir, a carga deve parar para adaptar/testar somente a leitura, sem deduzir relações.

Compatibilidade: o importador comercial atualizado aceita V8 **ou** V9 com histórico contínuo e não altera a tabela de recomendações. Continua sem migrar o alvo. O importador anterior mantém seu bloqueio exatamente V8 e não deve ser usado sobre V9. A API V8 também recusa banco futuro V9: eventual recuperação exige a combinação compatível de imagem e banco, não apenas trocar a imagem.

## Fase 4 — aplicação de serviços sugeridos (V10)

Decisão posterior da direção, base `b0995ae5795719f7ebbe853a44f166a7becda65f`: após uma escolha de diagnóstico/intensidade ser persistida, uma peça realmente sem serviços **e** componentes pode receber a composição inicial automaticamente. Abrir/recarregar não gera esse comando; peça vazia já salva oferece aplicação explícita. Com qualquer serviço/componente, somente consulta/aplicação assistida por escolha do operador. Ausência de diagnóstico/intensidade, inclusive Cuidados operacionais sem intensidade, não inventa dados.

`POST /api/atendimentos/:at/diagnosticos/:piece/recomendacoes` usa a sessão, Origin e JSON existentes. Corpo:

```ts
{
  revision: number; scenarioId: string; scenarioRevision: number;
  diagnosisId: string; intensity: 'leve'|'moderado'|'severo';
  mode: 'automatic'|'assisted'; ruleIds?: string[]; idempotencyKey: string
}
```

`automatic` reconsulta todas as regras da combinação e exige ausência de serviços/componentes. Se já houver conteúdo, devolve `notEmpty:true` e nenhuma linha é inserida. `assisted` exige a lista explícita de IDs únicos; inclui somente regras válidas/ativas, autorizadas pela curadoria e cujo serviço ainda não existe na peça. Não cria segunda linha de um serviço existente, mesmo com dimensão diferente; a edição manual continua aceitando repetições conscientes. Regras não disponíveis são reportadas como `NOT_AVAILABLE`; curadoria negada como `CURATION_BLOCKED`; existentes como `ALREADY_PRESENT`. Esses casos não impedem as outras regras elegíveis. Pendências de origem jamais são recuperadas por aproximação.

Transação verifica Atendimento/peça/cenário, revisões e combinação, revalida política/referências, calcula a quantidade de linhas antes de gravar e insere tudo ou nada. Mais de 50 linhas resulta em 422 `RECOMMENDATION_LIMIT`, sem inserção parcial. Novas linhas usam quantidade textual `"1"`, dimensão exata da regra e flags iniciais de `selectedByDefault` **somente no cenário solicitado**; demais cenários começam false. Componentes, peça pai, linhas existentes e suas flags/confirmações não são alterados. Terceiros permanecem sem confirmação até ação explícita de contratação/execução.

Prioridade por IDs estáveis: Montagem → Funilaria → Pintura → Degradê → Alinhamento → Outros. Novas linhas são anexadas nessa ordem; a ordem manual anterior é preservada. Sem decisão inequívoca entre várias dimensões do mesmo serviço ausente, o automático reporta `CHOOSE_DIMENSION` em vez de escolher por nome/ordem; o assistido permite uma escolha explícita por serviço. Escolher uma recomendação opcional significa incluí-la na composição; sua flag inicial continua false, identificada como tal na lista e editável pelo toggle existente.

Retorno `RecommendationApplication`: `{item,scenarioRevision,idempotencyKey,created:[{lineId,ruleId}],skipped:[{ruleId,reason}],notEmpty}`. A confirmação é conferida contra o workspace atual antes de adotar os dados. Resposta perdida/ilegível ou conflito preserva a intenção, bloqueia os controles da operação e exige leitura antes de repetir o mesmo corpo/chave; alterações concorrentes após ACK também impedem adoção silenciosa. Carregar versão salva é uma ação explícita de recuperação.

V10 é estritamente aditiva: `diagnosis_services.recommendation_rule_id` nullable/FK e `recommendation_applications` para recibos por peça/cenário/chave. Mesma chave/corpo retorna o recibo original sem recriar/excluir/habilitar linhas, inclusive se o operador já ajustou ou removeu as sugestões. Mesma chave com outro corpo é conflito. Origem é somente leitura para o cliente: PATCH manual não pode forjá-la; editar uma linha preserva a origem histórica da sua criação. Novos snapshots podem contê-la; versões/PDFs existentes não são recalculados.

Importador comercial atualizado aceita V8/V9/V10; importador de recomendações aceita V9/V10, sempre com histórico contínuo e sem aplicar migrações no alvo. Nenhum catálogo/regra é importado pelo startup ou pela aplicação de serviços. Migração V9→V10 preserva as relações já instaladas. Ferramentas/imagens antigas que recusam o esquema novo exigem banco compatível para rollback.


### PR39 — condições e emissão assíncrona jsreport (decisão vigente)

Esta seção prevalece sobre descrições anteriores de geração síncrona/PDF alternativo e prazo exclusivamente técnico. Detalhes: [PR39_EMISSAO_PDF.md](PR39_EMISSAO_PDF.md).

- `GET /api/parcelamento` retorna `{revision,updatedAt,rates:{tres,seis,nove,doze}}`, percentuais como textos decimais exatos. `PATCH` recebe `{revision,rates}` completo, autenticado, JSON, mesma Origin; revisão obsoleta é 409. Sem taxa por Atendimento/cenário.
- `Scenario.deadline = {mode:'automatic'|'manual', manualDays:number|null}`. `PATCH /api/atendimentos/:at/cenarios/:id` aceita `deadline` junto da revisão existente. Manual exige inteiro positivo seguro; automático exige null. Duplicação não copia a substituição.
- Prévia inclui `snapshot.executionDeadline` e `snapshot.installments`; token cobre esses dados. Ausência de prazo efetivo bloqueia emissão. Prazo manual pode substituir somente sugestão ausente por capacidade; não elimina erros de preço/energia.
- Emissão usa POST/previewToken/idempotencyKey existentes e só retorna 201 após persistir snapshot + PDF + identidade. Sem transação durante HTTP. Número global reservado não é reutilizado; falha pode deixar lacuna. Mesma chave/corpo retorna o mesmo documento; outro corpo é `IDEMPOTENCY_CONFLICT`. Em andamento: 409 `PDF_RENDER_IN_PROGRESS`; executor expirado: `PDF_LEASE_EXPIRED`; recuperar com a mesma solicitação.
- Falhas do gerador: `PDF_NOT_CONFIGURED`, `PDF_CONFIGURATION_INVALID`, `PDF_RENDER_UNAVAILABLE`, `PDF_RENDER_FAILURE`, `PDF_INVALID_RESPONSE`, `PDF_INCOMPLETE`, `PDF_TOO_LARGE`. Não criam versão parcial. Revisão/token divergente continuam bloqueados.
- Snapshot opcionalmente inclui `document:{template,data}` com JSON exato entregue ao jsreport, taxas/resultados racionais e apresentação congelados, prazo efetivo e avisos. Nunca contém conexão/credenciais. Campos opcionais preservam leitura de snapshots históricos schema1.
- GET PDF retorna BLOB original, Content-Type PDF e Content-Disposition com nome amigável UTF-8 congelado. GET não chama jsreport e não cria versão. Versões antigas sem OR não recebem número retroativo.

### PR39 — template fornecido pela direção

`document.data.financeiro.servicos` apresenta `calculation.serviceNet` para a igualdade “Serviços + Componentes = Total” do HTML recebido. `desconto` permanece destacado, sem segunda dedução; detalhamento por peça continua bruto. Nenhum cálculo oficial nem JSON/PDF já congelado é reescrito. Referência e limitações: `docs/PR39_CONFERENCIA_TEMPLATE.md`.

### PR39 — categorias técnicas e pendências PDF

`TechnicalStage.presentation` opcional preserva `stageId`, `stageDimensionId`, `clusterId`, `cluster` e `order`. Categorias são as cinco opções de `shared/stage-clusters.ts`; ausência/valor desconhecido nunca vira Serviços complementares. Configuração antiga é resolvida somente por IDs exatos da referência offline, sem escrita no getter. PATCH antigo sem o objeto preserva metadados existentes.

`BudgetSnapshot.pdfPresentation = {version:"technical-stage-v1",errors:string[]}` identifica pendências que bloqueiam `canEmit` e a confirmação, preservando os valores do motor. Os clusters agrupam etapas por categoria e contexto peça/diagnóstico; rateio racional usa `line.total × energiaEtapa / energiaServiço`. Categorias representam subtotal bruto efetivo; desconto global não é redistribuído. Centavos de apresentação por maiores restos fecham o subtotal de cada diagnóstico, sem alterar parcelamento, total oficial ou snapshots/PDFs existentes. Detalhes: `docs/PR39_AGRUPAMENTO_ETAPAS.md`.
