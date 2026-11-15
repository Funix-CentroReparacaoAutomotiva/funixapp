# Telefones nas Conversas — PR #229

**Resultado:** causa da apresentação observada identificada; lacuna adicional corrigida e comprovada em desenvolvimento. **A correção não está instalada em `app.funix.com.br` e não foi homologada contra os dados dessa instalação.** Não declarar a situação operacional resolvida por este relatório.

Branch existente: `fix/conversas-telefone-com-proveniencia`. Ponto inicial confirmado: `5e2979a7efb81d9b0c8782690f424cb5ffd0c51f`; PR aberta/em rascunho, onze workflows concluídos com sucesso, sem reviews/comentários adicionais. Os commits anteriores foram preservados, inclusive o ajuste que usa a projeção de Contato principal da ficha.

## Causas comprovadas

### 1. O endereço utilizado ainda não executa a PR

O usuário confirmou que a captura é de `https://app.funix.com.br/conversas`. Foram consultados somente HTML/JavaScript públicos e `/api/ready`, sem cookies, credenciais, consulta autenticada a conversas ou acesso direto ao SQLite/VPS:

- Backend declara revisão `f6e215bfe489d69834b5d77597349ce71d92ea3d`, anterior à implementação desta PR.
- Frontend servido: `/assets/index-D1c6brm9.js`. O bundle contém a indicação de nome de canal, mas **não contém `atendimentoPhone` nem o rótulo `Ficha:`**.
- O código do bridge na revisão declarada também não contém `atendimentoPhone`.

Isso explica por que os nomes provisórios já aparecem e o telefone comercial continua ausente: a instalação contém a correção de nomes da #227, mas não a apresentação de telefone da #229. Atualizar/pollar a página não instala o código da branch. O hash do asset e os indicadores observados estão em [metadados públicos](../evidencias/conversas-telefone-pr229/metadados-instalacao.json). A captura recebida, com dados pessoais, não foi copiada para o repositório.

Essa evidência comprova a diferença de versão; não determina quais números/associações existem em cada conversa real. Alguns casos podem legitimamente continuar pendentes mesmo depois da atualização.

### 2. A branch também omitiria o campo em um modo suportado

No ponto inicial, `createEvolutionChatBridge.list()` acrescentava `atendimentoPhone` somente dentro de `if (codaSync)`. Esse argumento representa a autoridade de canal local/legada, não todos os vínculos comerciais.

O bootstrap `loadEvolutionChat()` pode operar com leitura Evolution e vínculos N:N habilitados, sem armazenamento local/autoridade local e sem autoridade legada configurada. Nesse modo, `v20_associations` já pode conter um vínculo explícito único, mas o bridge não consultava essa relação para apresentação. O endpoint da ficha retornava o telefone do Contato principal e o endpoint da lista omitia `atendimentoPhone`.

Foi reproduzido **antes da correção**, com normalizador Evolution real, SQLite sintético e HTTP real do aplicativo: `GET /api/atendimentos/:id` devolveu o telefone do Contato principal; `GET /api/chat/conversations?skip=0` omitiu o campo. O teste falhou com `undefined` em vez do telefone comercial esperado. O cenário da coluna base vazia/Contato principal preenchido está incluído.

Os ajustes anteriores de `phone_normalized` → projeção da ficha eram válidos, mas não resolviam um caminho em que seus métodos nem eram chamados. A serialização do endpoint e o parser/frontend da branch preservam corretamente o campo quando ele chega; não houve evidência de perda por JSON ou cache nesse caminho.

## Fluxo e correção

| Etapa | Comportamento verificado |
|---|---|
| Evolution → normalização | `EvolutionReadPoc.findChatsPage` valida PN/LID, nome e alias do `lastMessage` pertencente ao mesmo chat/instância. Apenas o transporte foi substituído por fixture nos ensaios. |
| Evidência técnica | Reutiliza `ConversationIdentities`, com evidência PN↔LID única e conflito persistente. No modo Evolution/N:N sem autoridade, o repositório também registra a evidência exata retornada pelo normalizador; não cria vínculo comercial. |
| Persistência/relacionamentos | Consulta exclusivamente associações N:N explícitas não desvinculadas, pelos JIDs exatos/aliases confiáveis. Combina a referência canônica existente quando houver. Mais de um Atendimento distinto resulta em fallback pendente, mesmo se os telefones coincidirem. |
| Ficha/Contato | Helper único `atendimentoDisplayPhone()` usa `AtendimentoRepository.get(id,true)`, a mesma projeção do detalhe, incluindo `atendimento_references`/`customer_records`. Aceita número normalizado com DDI explícito; não inventa país nem converte texto incompleto em PN. |
| Bridge → endpoint | A apresentação comercial funciona com ou sem autoridade de canal. `atendimentoId`, contexto, destinatário e permissões continuam pertencendo aos mecanismos anteriores. `/api/chat/conversations` serializa o resultado sem remover o campo. |
| Frontend | O parser tipado mantém `atendimentoPhone`; a UI existente prefere PN, depois `Ficha: +…`, depois `Telefone pendente`. Busca considera ambos os números. Não houve alteração de nomes ou layout. |
| Atualização/paginação | Cliente usa `cache:no-store`; refresh manual foi exercitado. O polling existente é limitado à primeira página visível, sem diálogo aberto/páginas extras. Conflito PN/LID posterior, inclusive em outra página, continua bloqueando o número em consultas posteriores. |

Commit funcional: `20275a5` (`fix(chat): display linked ficha phones in provider-only lists`).

Arquivos funcionais alterados:

- `server/chat/conversation-phones.ts`: helper de telefone comercial compartilhado, sem identidade/permissão de canal.
- `server/chat/v20-associations.ts`: projeção de apresentação para vínculos explícitos; reaproveitamento da evidência técnica existente.
- `server/chat/evolution-bridge.ts`: aplica a projeção também sem autoridade local/legada e não deixa um PN da linha sobrescrever conflito de identidade.
- `server/chat/coda-sync.ts` e `server/chat/local-associations.ts`: reutilizam o helper, eliminando a normalização duplicada. Os mecanismos legados são preservados por compatibilidade, sem nova integração.

Não há tabela, migração, schema, flag instalada ou destinatário novo. A inferência por nome/foto/telefone semelhante continua proibida. Um telefone comercial visível **não confirma PN**, não seleciona contexto, não habilita leitura/envio e não transfere histórico. Contexto revogado pode continuar exibindo um telefone comercial unívoco, mas continua sem autorização de mensagem. Associações canônicas/N:N divergentes e identidades contraditórias não escolhem um número comercial arbitrário.

## Verificações executadas

| Verificação | Resultado |
|---|---|
| Regressão HTTP antes da correção | Falhou: a ficha tinha telefone no Contato principal, mas a lista sem autoridade omitia `atendimentoPhone` |
| `npm run check` | Exit 0: build/TypeScript frontend, TypeScript servidor, **1.038 testes de servidor**, lint e **8 testes de custo/voz** |
| `node --test server/tests/conversation-phone-contract.test.ts` final | Seis testes passaram; após a execução completa, foram acrescentadas asserções de preservação e uma página `skip=50`, e os seis foram repetidos com sucesso |
| Bootstrap real, em processo isolado e transporte offline | `loadEvolutionChat()` com armazenamento/autoridade ausentes entrega o telefone comercial; zero chamadas de rede real |
| `node scripts/conversation-phone-browser.mjs` | Exit 0 em **320/390/1440**; sete cenários por viewport, HTTP/API reais do app, apenas transporte Evolution fictício; ficha/lista concordam, busca por ambos os números, refresh, nomes preservados, zero overflow/erro JS/requisição externa |
| `node scripts/customer-experience-browser.mjs` | Exit 0 em 320/390/1440; nomes, selos, edição, rascunho, troca de Contato e contexto preservados |
| `python3 tests/browser/chat_v20_conversations.py` | Exit 0 em 320/390/1440; regressões de Chat/polling/mídia/contexto com mocks |
| `python3 tests/browser/chat_v20_links.py` | Exit 0 em 320/390/1440; N:N, confirmação/desvinculação e gates |
| TypeScript servidor/lint após as últimas asserções | Exit 0; sem erro de tipo ou lint bloqueante |
| `git diff --check` | Sem erros |

A suíte nova cobre provider/local/offline, LID isolado, PN e alias confirmados, telefone ausente/incompleto, Contato principal com coluna base vazia, múltiplos Atendimentos, divergência de números e de mapeamentos, conflitos persistentes e contexto revogado. Confere ausência de alteração em fichas, Contatos, referências e vínculos; nenhuma tentativa de envio ou consulta de histórico é disparada por essa apresentação.

O novo Chromium está incluído no workflow existente **Customer experience Chromium**, com seus artefatos. Build conserva aviso de chunk >500 kB e lint conserva warnings existentes. [Manifesto](../evidencias/conversas-telefone-pr229/verificacoes.json), [cenários Chromium](../evidencias/conversas-telefone-pr229/chromium-telefones.json) e capturas sintéticas acompanham este relatório. Os onze workflows do commit inicial estavam verdes; o estado terminal dos workflows da SHA final será conferido e informado na entrega.

## Limites, pendências e próxima ação

**É seguro solicitar homologação da build desta PR em DEV autorizado**, com os cenários e critérios acima. Não confundir isso com homologação concluída da instalação atual, nem com autorização de merge/deploy.

1. Disponibilizar a build da SHA final em ambiente DEV autorizado, sem habilitar ingestão, armazenamento autônomo, sincronização de mensagens ou envio para contornar o problema.
2. Conferir `/api/ready` e o asset do frontend desse ambiente; ambos devem corresponder à build avaliada. Registrar somente metadados, sem copiar sessão/token/dados pessoais para a PR.
3. Em sessão autorizada, escolher um caso real controlado e comparar: `source`, presença de `atendimentoPhone`, PN técnico e telefone normalizado do detalhe. Registrar somente estados booleanos/quantidades ou evidência sanitizada. Não presumir que uma ficha aberta manualmente no Funil esteja vinculada à conversa.
4. Se o campo não chegar: revisar vínculo explícito, ambiguidade/conflicto e se a ficha contém número normalizável, sem criar/corrigir vínculos automaticamente. Se chegar e não aparecer: conferir parser/bundle realmente servido e refresh. Páginas carregadas adicionais exigem “Atualizar” para refazer a primeira página.
5. Aceitar `Telefone pendente` quando não há dado válido, vínculo unívoco ou há conflito. Para um vínculo único e número comercial válido, exigir `Ficha: +…`; para PN confirmado, exigir `+…`. Preservar os dois campos quando forem diferentes.

Não foram consultados os dados autenticados da instalação, o banco instalado ou a Evolution real. Portanto não há prova individualizada de que todas as linhas da captura têm telefone elegível. O endereço atual continua na revisão anterior; sua correção operacional exige homologação/implantação separadamente autorizada. Não houve merge, deploy, mudança de VPS/Evolution/n8n, reprocessamento real, envio ou reparo automático de relações nesta tarefa.
