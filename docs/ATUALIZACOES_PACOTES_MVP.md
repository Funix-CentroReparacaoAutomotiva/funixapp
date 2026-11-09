# FUNIX — Atualizações: pacotes com decisão humana (primeiro incremento)

**Status:** implementação de desenvolvimento na PR #107, sem merge/deploy. Ainda não é uma rotina operacional ativa. O segundo incremento adiciona entrada assinada e coleta de complementações, porém não executa alterações externas.

## Experiência aprovada pela direção

A nova aba `/atualizacoes` fica junto a Conversas, Funil e Configurações. Mostra somente cards: busca por experiência, placa e origem; filtros **Abertos** e **Fechados**. O toque expande ações, evidências resumidas, pendências e decisão do pacote.

- Abertos: aguardando revisão, aprovado aguardando execução, falha/retomada pendente.
- Fechados: executado (verde), rejeitado (vermelho).
- Aprovação é por **pacote**, não por documento individual.
- Informação obrigatória pendente bloqueia a aprovação. A interface de complementação ainda será implementada.
- A aprovação não confirma execução. Um executor validado deverá aplicar cada ação e registrar os respectivos resultados idempotentes.

## Modelo de dados

- `update_packages`: UUID, revisão, SHA-256 de snapshot, origem e referência, experiência/placa, título/resumo, ações e campos pendentes serializados, estado e histórico temporal.
- `update_package_decisions`: chave idempotente por pacote/solicitação, ação, versão/hash autorizados, autor e data.
- Ações possuem IDs e tipos; não carregam SQL livre nem instruções diretamente executáveis.
- O snapshot do pacote fica imutável depois da criação; uma proposta modificada deverá gerar **novo pacote** e exigir nova decisão.
- `approved_pending_execution` continua em Abertos até confirmação efetiva; `execution_failed` continua aberto.
- Recusa fecha o pacote. Aprovação é bloqueada em presença de pendências.

## API

| Método | Rota | Comportamento |
| --- | --- | --- |
| GET | `/api/atualizacoes?visao=open\|closed&q=...` | Lista autenticada; vazia quando o armazenamento não existe |
| POST | `/api/atualizacoes/:uuid/decisao` | Aprovar/rejeitar com `revision`, `snapshotHash`, `decision`, `requestId`; exige sessão, Origin e flag específica |

O armazenamento é opt-in por `FUNIX_UPDATES_STORAGE_ENABLED=true` e usa tabelas isoladas, **sem alterar o histórico `schema_migrations` V14**. As decisões HTTP exigem também `FUNIX_UPDATES_DECISIONS_ENABLED=true`. As flags permanecem não configuradas por padrão, de modo que nenhum registro novo é criado e nenhuma decisão está disponível.

## Segurança e próximo desenvolvimento

- Não há API externa de criação de pacote nem gatilho automático n8n neste incremento.
- Não há chamadas de escrita ao Coda, Drive, Evolution ou ERP pela tela.
- Usar a senha/sessão atual do operador, controle de versão e idempotência. Antes de habilitar escrita em produção: confirmar política de autenticação/autorização, persistência, backup e auditoria.
- A entrada `POST /api/integrations/updates/packages` aceita propostas estruturadas do backend/n8n com assinatura HMAC-SHA256, janela de 5 minutos, limite de 64 KB e identidade `eventKey` idempotente. Ela permanece **desligada** salvo `FUNIX_UPDATES_STORAGE_ENABLED=true`, `FUNIX_UPDATES_INGEST_ENABLED=true` e segredo `FUNIX_UPDATES_INGEST_SECRET` de pelo menos 32 caracteres. O fluxo n8n ainda não chama a rota.
- Assinatura de cada requisição: headers `X-Funix-Updates-Timestamp` (Unix em milissegundos, 13 dígitos) e `X-Funix-Updates-Signature` (hex minúsculo HMAC-SHA256 sobre `timestamp + "." + corpo JSON exato`). Identificador `eventKey` permanece único: reentrega idêntica devolve o mesmo pacote; conteúdo divergente é conflito HTTP 409.
- Contrato JSON: `{ "eventKey": "gmail:message-001", "proposal": { "source": "gmail", "sourceReference": "message-001", "experienceId": null, "plate": "ABC1D23", "title": "...", "summary": "...", "actions": [{"id":"drive:1","type":"drive_archive","title":"...","detail":"..."}], "missingFields": [{"key":"experienceId","label":"Selecionar XP","hint":"...","options":[{"value":"XP1001","label":"XP1001"}]}] } }`. Os identificadores citados são **sintéticos**; não são exemplos para execução real.
- Na aba Atualizações, os campos faltantes podem ser preenchidos (texto ou seleção). `POST /api/atualizacoes/:uuid/complementar` exige login, Origin, versão/hash e `requestId`; registra respostas com auditoria e idempotência sem mudar a proposta. Essa API exige `FUNIX_UPDATES_CLARIFICATIONS_ENABLED=true` e armazenamento habilitado.
- **Ainda falta o replanejamento do pacote.** Depois que a resposta é enviada, o card exibe `Aguardando nova conferência`; o pacote original continua bloqueado, e o n8n/backend deverá validar os dados na fonte oficial e produzir uma nova proposta/versionamento, sem assumir que a resposta humana é uma evidência externa.
- Implementar executor de ações por item com recibos, confirmação externa e retomada de falhas parciais. Uma aprovação apenas registra `approved_pending_execution`. Esta etapa **não implementa nem habilita o executor**.
- Conflito provável com a PR #104 em `src/App.tsx` e `server/app.ts`: reconciliar antes do merge.
- Realizar QA visual mobile/desktop e CI com dados sintéticos. Sem autorizar merge/deploy automaticamente.

## Incremento seguinte — revalidação e preparação local (09/11/2026)

- O contrato de ingestão aceita `replaces` opcional com `parentPackageId`, `clarificationRequestId`, `codaRowId`, `verifiedExperienceId`, `verifiedPlate`. O emissor autenticado precisa **conferir esses identificadores novamente no Coda** antes de emitir esse envelope; o servidor apenas valida a correspondência e a consistência interna, **não consulta o Coda autonomamente**.
- A API só aceita substituir pacote aberto com complementação auditada, experiência escolhida compatível e mesmas ações originais; registra pacote novo e encerra o antigo como `superseded`, transacionalmente. O pacote substituído permanece no histórico SQLite, mas não aparece em Abertos ou Fechados. A nova proposta exige nova aprovação.
- A substituição é idempotente por `eventKey`: reenvio idêntico retorna o mesmo pacote; alteração do conteúdo com a mesma chave retorna conflito.
- O workflow n8n existente (`33N020GyY0IsUSNv`) recebeu nó **Preparar rascunho de pacote (SEM ENVIO)**, que produz objeto `{eventKey,proposal}` para identificação ou dossiê documental, **sem chamadas HTTP**. Execução manual `37407`: XP1945 identificada e rascunho gerado, sem publicação e sem upload; seletores restaurados e workflow desativado.
- **Ainda não há um pacote único por evento multicanal.** As saídas independentes de identificação e documentos são rascunhos parciais e não devem ser publicadas separadamente. O próximo trabalho deve consolidar todas as propostas de um mesmo e-mail/WhatsApp em **um único pacote**, revalidar contra Coda e arquivos antes da proposta final e assegurar evidências imutáveis por ação.
- Nenhuma flag produtiva, autorização de escrita, credencial nova ou executor foi habilitado. A ligação real n8n → endpoint assinado e o replanejamento após complementação permanecem pendentes e exigem validação em desenvolvimento.

## Consolidação local de fragmentos (09/11/2026)

O módulo puro `server/update-packages-consolidate.ts` reúne propostas independentes de um **mesmo evento** em **um pacote**. O chamador declara explicitamente `expectedParts` (por exemplo, `identity`, `documents`, `commercial`) e precisa entregar todas as partes previstas. O módulo recusa partes incompletas/repetidas, origens ou referências distintas, conflito de XP ou placa, IDs de ações divergentes e definições incompatíveis de pendências. Ações rigorosamente idênticas podem ser deduplicadas. As dúvidas de identificação permanecem bloqueantes mesmo quando outra parte sugere uma XP.

Este incremento é **biblioteca de preparação, não integração ativa**: não foi conectado à API de ingestão, ao fluxo n8n, nem a fontes externas; não produz uploads, escritas no ERP, aprovações ou chamadas HTTP. O evento final só poderá ser publicado depois que um orquestrador confiável provar a completude real do e-mail/WhatsApp (incluindo corpo, anexos e informações comerciais) e fizer a revalidação pertinente. Declarar `expectedParts` incompleto para passar na verificação seria uma falha do orquestrador; por isso a preparação isolada **não autoriza habilitar as flags**.

Teste de regressão: `server/tests/update-packages-consolidate.test.ts`; executar a suíte e conferir CI antes de qualquer merge. A documentação e o código não representam liberação de produção.

## Pré-integração n8n: consolidação sem envio (09/11/2026)

No workflow desativado `33N020GyY0IsUSNv` foi incluído o nó **Consolidar evento (SOMENTE RASCUNHO)** após **Preparar rascunho de pacote (SEM ENVIO)**. Ele não possui chamada HTTP, assinatura, credencial nova, upload nem executor. Sua saída preserva `send_enabled:false` e `upload_permitted:false`.

A etapa exige `eventManifest` idêntico nos fragmentos, com `eventKey` e `expectedParts` explícitos, além de um `fragmentPart` distinto para cada fragmento. Na ausência do manifesto — estado atual dos rascunhos legados — retorna `AGUARDANDO_COMPLETUDE / MANIFESTO_AUSENTE`, sem publicar proposta. Quando todas as partes se apresentarem, verifica origem, referência, XP, placa, IDs de ações e pendências, mas **continua exigindo revalidação externa** e não efetua ingestão.

Esta ligação é preparatória: o workflow ainda não produz um manifesto confiável nem reúne os ramos em uma única execução. **Não apresentar isso como integração fim a fim concluída.** Próximas condições: coletar todas as partes do mesmo evento de modo verificável; garantir que anexos e corpo foram inventariados; revalidar XP/placa e arquivos; confrontar o algoritmo n8n com o módulo `server/update-packages-consolidate.ts`; testar com fixtures sintéticas; só depois avaliar assinatura e envio, ainda sob flags desligadas. A presença da ramificação histórica de upload no workflow requer proteção explícita antes de qualquer teste fora do modo controlado.

## Inventário completo de evento no backend (09/11/2026)

Novo módulo puro `server/update-packages-event.ts`: `prepareCompleteUpdateEvent` recebe um inventário por mensagem (fonte, referência, `eventKey`, confirmação de revisão do corpo e informações comerciais, IDs de todos os anexos e IDs conferidos), além de fragmentos `identity`, `documents` e `commercial`. Só consolida estruturalmente quando todos os três fragmentos estão presentes e o inventário de anexos coincide integralmente, sem duplicações. É permitido o fragmento comercial sem ações **após revisão explícita do corpo**, não antes. Recusa inconsistências de identidade, origem e inventário, delegando as verificações cruzadas de XP, placa e ações ao consolidador existente. Cobertura sintética em `server/tests/update-packages-event.test.ts`.

**Limite importante:** os sinalizadores `bodyReviewed` e `commercialReviewed`, a lista de anexos e o inventário ainda precisam ser produzidos por um extrator confiável e verificados com a fonte. Não há evidência técnica de que os fluxos alternativos atuais do n8n gerem essas informações. O módulo não é endpoint, não está conectado ao n8n, não publica pacotes nem altera sistemas. Não habilitar flags ou upload até concluir a ligação, testes e auditoria do produtor.

## Observação parcial dos anexos no n8n (09/11/2026)

No workflow inativo `33N020GyY0IsUSNv`, o nó **Inventariar Gmail (SEM ENVIO)** passou a receber em ramo paralelo o resultado de **Concluir triagem do lote dinamico**, consultando a mensagem já obtida por **Gmail - obter anexos dinamicos**. Verifica ID da mensagem, relatório de triagem somente leitura, quantidade de binários contra o relatório e existência de metadados para cada chave de anexo. A saída contém `inventory.attachmentIds`, `checkedAttachmentIds:[]`, `bodyReviewed:false` e `commercialReviewed:false`, além de `send_enabled:false` e `upload_permitted:false`.

Esse inventário é deliberadamente **parcial** e **não pode alimentar a ingestão como pacote pronto**. A correspondência das quantidades não comprova revisão semântica do conteúdo, nem a leitura comercial do corpo. O próximo incremento deve conectar identificação, corpo e anexos ao mesmo evento em um produtor confiável, preenchendo somente verificações efetivamente realizadas e exigindo revalidação das fontes. O nó atual não consulta o ERP nem envia requisições.

O agrupamento visual original `03 | Gmail e deduplicacao` foi restaurado após a ligação, sem modificar a cadeia antiga de aprovação/upload. O workflow segue desativado. A validação estrutural do n8n retornou apenas aviso preexistente de quantidade de elementos não agrupados. Não foi executado teste de ponta a ponta ou upload real nesta etapa.

## Evidências parciais correlacionadas por mensagem Gmail (09/11/2026)

Workflow inativo `33N020GyY0IsUSNv`:
- **Inventariar Gmail (SEM ENVIO)** agora confere correspondência do ID Gmail com o relatório documental, correlaciona cada binário com a triagem por nome e MIME, conta conflitos e distingue `attachmentIds` de `checkedAttachmentIds`. Mesmo quando todos têm metadados e MD5 examinados, `bodyReviewed:false` e `commercialReviewed:false`: sem leitura comercial ou conferência integral do corpo, não há autorização.
- **Evidenciar texto Gmail (SEM ENVIO)**, em ramo paralelo após **Extrair identificadores textuais**, correlaciona ID de mensagem, disponibilidade do texto simples/HTML, comprimento, eventual truncamento na extração (limite de 16.000 caracteres), pistas de placa/XP e estado da identificação. Também mantém `bodyReviewed:false` e `commercialReviewed:false`.
- Os dois ramos são **saídas parciais independentes**, não uma junção efetiva: o modo de identificação e o de documentos ainda seguem caminhos alternativos. Não assinalar `bodyReviewed` ou `commercialReviewed` como verdadeiros apenas com a presença de texto, MD5, nome de arquivo ou pista textual. Para consolidar, o produtor deverá executar ambos sobre a mesma mensagem, verificar o corpo completo e as informações comerciais, reconciliar anexos individualmente e produzir inventário + três fragmentos para `prepareCompleteUpdateEvent`.
- Nenhuma credencial, endpoint, flag de ingestão, conexão de upload ou escrita externa foi adicionada. Os nós são somente leitura, não persistem dados, não publicam pacote e não são evidência de operação ponta a ponta. Necessário testar com fixtures sintéticas antes de integrar.

## Correlação de evidências Gmail sem promoção de confiança (09/11/2026)

O módulo puro `server/update-packages-gmail-evidence.ts` correlaciona as duas saídas independentes do workflow usando o identificador exato da mensagem Gmail. Exige correspondência de `source`, `sourceReference`, `eventKey` e das contagens e chaves de anexos. Divergências causam erro em vez de seleção automática. O módulo não executa n8n nem consulta Gmail/Coda/Drive.

A saída é exclusivamente `AGUARDANDO_REVISAO` com `send_enabled:false`, `upload_permitted:false`, `bodyReviewed:false`, `commercialReviewed:false` e `checkedAttachmentIds:[]`. Mesmo que metadados e hashes coincidam, **isso não é conferência semântica dos anexos**. Mantêm-se pendências explícitas de revisão integral do corpo, informação comercial, identificação XP/placa e conteúdo documental, além de indicação de texto truncado ou não disponível quando detectado. Testes sintéticos em `server/tests/update-packages-gmail-evidence.test.ts` verificam conflito entre mensagens, inventário inconsistente e tentativas de elevar indevidamente a confiança.

**Ainda não existe junção executada no n8n**: os fluxos de identificação e de documentos são alternativos. O módulo serve de contrato de integração para o futuro orquestrador que execute ambos para a mesma mensagem, reconcilie o conteúdo de fato e só então possa encaminhar `EventPreparation` ao validador de completude. Não habilitar flags, uploads, aprovação real ou ingestão. Executar CI e testes integrados com fixtures antes de liberar o uso.

## Leitura unificada do Gmail no ramo documental (09/11/2026)

O nó existente **Inventariar Gmail (SEM ENVIO)** foi atualizado para aproveitar a **mesma mensagem** `Gmail - obter anexos dinamicos` já lida no ramo documental. Na própria execução, correlaciona o ID Gmail, a XP e a placa previamente verificadas no fluxo Coda, pistas textuais de XP/placa do assunto e corpo simples, e metadados de cada anexo com a triagem do Drive. Detecta pistas divergentes, corpo ausente ou longo e anexos em revisão. As expressões de reconhecimento de XP e placa foram corrigidas após inspeção.

Essa é uma **unificação de observações no ramo documental**, não uma consolidação de pacote executável. O nó produz `EVIDENCIAS_UNIFICADAS_GMAIL_SEM_ENVIO`, preserva `send_enabled:false`, `upload_permitted:false`, `bodyReviewed:false`, `commercialReviewed:false` e `checkedAttachmentIds:[]`. Não consulta a versão HTML para extrair conteúdo, não reconhece autorização comercial e não confirma semântica documental. Sem esse trabalho e sem a geração dos três fragmentos validados, não deve acionar a API de ingestão nem habilitar qualquer flag.

A cadeia de upload supervisionado já existente foi mantida sem novas conexões. O workflow segue desativado. O próximo teste deverá cobrir com fixtures sintéticas placas em formatos diferentes, XP explícita, informações conflitantes, e-mails longos, anexos duplicados e ausência de corpo. Nenhum teste integrado com fontes reais foi realizado nesta alteração.

## Triagem comercial + orquestração segura + assinatura local (09/11/2026)

Novos componentes na PR #107:

- `server/update-packages-commercial.ts`: identifica **indícios** de autorização, recusa, valor e mudança no texto simples e assunto; devolve fragmento `commercial` com `commercialReview` quando houver ambiguidade. Não cria `erp_update` nem aceita um texto como autorização válida de associação/cliente. Não lê anexos PDF nem atesta autenticidade.
- `server/update-packages-orchestrate.ts`: une o correlador de evidências Gmail, a triagem comercial e os três fragmentos, usando inventário por ID de mensagem e verificação explícita de corpo, comercial e lista de anexos. Sem verificação retorna `NEEDS_REVIEW`. Mesmo com atestado, um indício comercial exige replanejamento externo: o atestado isolado não apaga uma pendência comercial. Somente um evento com verificação explícita e sem pendências comerciais pode produzir o envelope `READY_FOR_SIGNED_INGEST`. **`canPublish` é sempre false**, pois a preparação não autoriza envio.
- `server/update-packages-publish.ts`: constrói `body` e headers HMAC-SHA256 nos formatos já exigidos pelo receptor, com limite de 64 KB; **não faz chamada de rede**. O emissor autenticado, a configuração dos segredos e o gatilho n8n continuam não implementados/habilitados.
- Testes de regressão `update-packages-commercial.test.ts`, `update-packages-orchestrate.test.ts`, `update-packages-flow.test.ts` e `update-packages-publish.test.ts` exercitam triagem, conflitos, preparação, armazenamento e aprovação auditada e compatibilidade do envelope assinado com o receptor usando memória/streams sintéticos.

**Importante:** estes testes foram **adicionados**, não são prova de suíte executada nem CI verde. O n8n atual não fornece de forma confiável o atestado exigido e os fragmentos validados. Mesmo um envelope estruturado pode conter informação indevida se a fonte original não for revalidada. Nenhuma alteração comercial deve ser registrada como autorização externa sem comprovante e conferência específica.

**Limite de autonomia:** desenvolvimento e testes sem efeitos externos autorizados; nenhum merge/deploy/flag produtiva, gravação no Coda/Drive/ERP ou execução de pacote foi autorizado. Próximo trabalho técnico é criar o produtor confiável de atestados e fragmentos, executar a CI e validar apresentação real da fila. Antes de liberar qualquer executor de ações externas é necessária decisão explícita da direção.

## Incremento: três fragmentos e preparação do envelope assinado (09/11/2026)

- O n8n desativado `33N020GyY0IsUSNv` recebeu o nó **Montar pacote único Gmail (SEM ENVIO)**, ligado após a leitura unificada. Para uma mensagem com triagem de documentos consistente, produz rascunho único com fragmentos `identity`, `documents` (uma ação por arquivo novo com MD5) e `commercial`. O fragmento comercial permanece **pendente**, pois a triagem não comprova autorização externa. A saída mantém `send_enabled:false` e `upload_permitted:false`; não aciona a API nem altera ERP/Drive. Os outros caminhos existentes e o upload supervisionado não foram modificados.
- `server/update-packages-commercial.ts` e respectivos testes: leitura conservadora de palavras de autorização, negativa, alteração e valores, sempre como **indícios**, sem emitir autorização do ERP.
- `server/update-packages-orchestrate.ts` e testes: correlaciona evidências de uma mensagem e exige atestado independente de revisão completa e inventário de anexos. Havendo indício comercial ainda pendente, exige replanejamento. Não envia pacotes.
- `server/update-packages-publish.ts` e testes: gera corpo e assinatura HMAC para o receptor existente, sem HTTP; há teste sintético da compatibilidade assinatura/recepção em memória.
- `server/tests/update-packages-flow.test.ts`: teste sintético de preparação, criação de pacote, card aberto e decisão auditada, sem executor.

**Fronteira atual:** o nó n8n gera `fragments` e `proposal` como rascunho de revisão, mas não atesta revisão comercial, conteúdo de anexos ou aprovação externa, e não usa o módulo de orquestração via endpoint. Isso não é integração fim a fim em execução. Nenhuma flag ou transporte produtivo foi habilitado; nenhuma execução externa deve ocorrer antes de autorização expressa. Os testes adicionados ainda precisam ser executados e confirmados pela CI. Antes de liberar ingestão real: validar atestados confiáveis, tratar informações comerciais com evidência e manter proteção de versão e idempotência.

## Revisão assinada, transporte local controlado e simulação do executor (09/11/2026)

- `server/update-packages-attestation.ts`: SHA-256 do texto, assunto, fragmentos e lista de identificadores **com hashes SHA-256 dos bytes dos anexos**; HMAC independente para autenticar o atestado de revisão, com janela de cinco minutos. O atestado não demonstra aprovação comercial externa. A chave somente pode residir em serviço verificador confiável, não na interface ou no n8n.
- `server/update-packages-orchestrate.ts` agora exige atestado autenticado antes de devolver `READY_FOR_SIGNED_INGEST` quando há campos de verificação. Flags booleanas isoladas não bastam. O material revisado e os fragmentos devem coincidir exatamente. Testes existentes foram adaptados e foram adicionados testes contra adulteração de mensagem/hashes.
- `server/update-packages-dev-transport.ts`: adaptador de transporte **somente para desenvolvimento**, desabilitado por padrão, exige ativação explícita e aceita apenas URL HTTP loopback na rota do receptor. O envio é feito por função injetada por testes; não há cliente de rede embutido, endpoint externo configurado ou ligação com o n8n. Testes de guarda foram adicionados.
- `server/update-packages-execution-simulation.ts`: redutor **puro** que simula resultados por ação, vinculados ao hash da ação, com idempotência de recibos, validação de tentativas, falha parcial e retomada apenas de itens pendentes ou falhos. Não altera SQLite, status real, Drive ou ERP; é uma base de validação, **não é executor produtivo**.
- `server/update-packages-commercial.ts`: ajuste no reconhecimento de vocabulário comercial com acentos.

**Validação necessária:** a CI completa e os testes locais do repositório ainda não foram confirmados no HEAD atual. O ambiente desta sessão não dispõe de checkout autenticado do repositório via shell; as alterações foram gravadas pela integração GitHub. Não utilizar os módulos como operação disponível sem análise dos testes, atestação confiável, revisão de segurança e integração com persistência de recibos.

**Autorização registrada na conversa:** desenvolvimento, integração e testes controlados podem avançar sem aprovações intermediárias. A direção solicitou nova autorização quando chegar ao ponto de **habilitar execução real** de ações após aprovação humana. Sem merge/deploy produtivo ou gravação real em sistemas externos.

## Pacotes pendentes de conferência (09/11/2026)

O módulo `server/update-packages-n8n-pending.ts` permite preparar o **rascunho incompleto** do n8n para aparecer como card no FunixApp, sem confundir uma coleta de evidências com verificação concluída. Exige manifesto com `identity/documents/commercial`, chaves de mesma mensagem, inventário ainda não revisado, correspondência integral de ações e pendências entre fragmentos e resumo, campo `commercialReview` obrigatório e **nenhuma ação `erp_update`** sem comprovação. Resulta apenas em `UpdatePackageIngest` para transmissão futura assinada e controlada; **não envia** rede nem grava qualquer arquivo/ERP. `server/tests/update-packages-n8n-pending.test.ts` cobre pacote bloqueado, dados ocultados e conflitos de identidade. No receptor existente, o card permanecerá em Abertos e não poderá ser aprovado até complementação e nova revalidação.

Isso resolve um aspecto de UX: **um evento com informação faltante deve aparecer como card bloqueado**, e não desaparecer por falta de atestado completo. O caminho de revisão autenticada existente continua necessário para montar propostas prontas para aprovação, e a substituição do pacote após conferência precisa ser integrada ao emissor confiável. Não habilitar flags de produção ou iniciar o workflow apenas para produzir esses cards.

QA de navegador da aba Atualizações: `scripts/updates-browser.mjs` e `.github/workflows/updates-browser.yml` usam dados sintéticos e bancos SQLite em memória. Verificam abertura de cards, bloqueio de aprovação com pendências, aprovação (sem executor), rejeição, filtros Abertos/Fechados e apresentação responsiva. Não estabelecem conexão n8n → servidor real nem operação em produção.
