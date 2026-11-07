# Evolution 2.3.7 — POC offline de leitura e contexto V20

Data: 06/11/2026, America/Sao_Paulo. [Issue #71](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/71). Base `main` `5351ab8`, branch/worktree exclusivos `feat/issue-71-evolution-read-poc` / `evolution-read-poc`.

## Resultado e limites da evidência

O adaptador experimental consegue projetar chats e páginas de mensagens **nos contratos sintéticos testados**. A paginação por offset não oferece histórico consistente sob mutações ou empates; deduplicação não recupera mensagens nunca recebidas. Evolution continua **candidata** a fonte principal, sem decisão de substituir a inbox local. Nenhuma validação da instalação real foi realizada nesta tarefa.

Classes usadas aqui: **VERIFICADO NO CÓDIGO** = inspeção estática do código citado, não execução da instalação; **SIMULADO** = execução offline com fixtures inteiramente inventadas; **RELATADO** = informação do administrador/terceiro; **PENDENTE NO AMBIENTE REAL** = sem comprovação nesta tarefa.

| Evidência | Classe / fonte | Consequência |
|---|---|---|
| Rotas POST `findChats` e `findMessages` | VERIFICADO NO CÓDIGO público da tag 2.3.7, router abaixo | Não usar GET para findChats; existência não comprova funcionamento instalado |
| `fetchMessages`: count separado de findMany, offset=50/page=1, skip/take, timestamp desc sem segundo critério | VERIFICADO NO CÓDIGO público Baileys | Não é cursor nem snapshot; count/pages podem divergir dos registros |
| `Query<T>` declara where/sort/page/offset, mas fetchMessages fixa DESC | VERIFICADO NO CÓDIGO público | Não expor `sort` como garantia de ordenação remota |
| `fetchChats` consome take/skip e retorna array; DISTINCT ON por JID em mensagens | VERIFICADO NO CÓDIGO público Channel | Não presumir listagem de todo Chat cadastrado ou paginação por page/offset; empates também afetam prévia/ordem |
| fromMe usa truthiness no filtro de mensagens; false não adiciona filtro | VERIFICADO NO CÓDIGO público | POC pede ambas as direções e preserva booleano; não oferece filtro inbound remoto |
| Filtro de chave tem OR remoteJid/remoteJidAlt; filtro temporal exige ambos gte/lte | VERIFICADO NO CÓDIGO público | POC envia o mesmo JID nos dois operandos; filtro temporal é opção futura, não cursor implementado |
| PN/LID/remoteJidAlt, mídia, status e erros nos exemplos | SIMULADO | Cobertura de formas mínimas testadas; não prova payload efetivamente armazenado nem entrega pelo celular |
| Evolution 2.3.7/Baileys, persistência PostgreSQL/volumes e único webhook n8n | RELATADO pela direção/auditoria Hostinger, [#62 comentário final](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/62#issuecomment-6699597067) | Digest, tabelas/índices instalados, retenção e restauração permanecem pendentes; latest não identifica build |
| Separação conversa/Atendimento, demoLinks N:N e contexto por chat | VERIFICADO NO CÓDIGO do mockup V20; SIMULADO no modelo desta POC | Referência funcional, não migração nem autorização produtiva |

Fontes públicas consultadas via GitHub, sem acesso à FUNIX:

| Arquivo na tag `2.3.7` | Trecho / Git blob SHA observado |
|---|---|
| [chat.router.ts](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/routes/chat.router.ts#L164) | findMessages/findChats, linhas 164/184; `158947ed228016e1b670082ce914bba2f1b11872` |
| [whatsapp.baileys.service.ts](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts#L5016) | fetchMessages; `60e857fcc1206776575921c9060d05efdd7ff432` |
| [channel.service.ts](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/services/channel.service.ts#L719) | fetchChats e fetchStatusMessage; `56bec080215e0ff10a7ff6a5dc8ac11d3e043815` |
| [repository.service.ts](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/repository/repository.service.ts) | Query; `793bb0c82ff0a8d7467758ff2fd3a85ac64c9ebf` |
| [chat.schema.ts](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/validate/chat.schema.ts) | messageValidateSchema/contactValidateSchema; `7dae44539b06c2d7abbb59b08bc36c0e41b9cabd` |
| [postgresql-schema.prisma](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/prisma/postgresql-schema.prisma) | Message.key JSONB, timestamp Int, índice explícito instanceId; não prova índices reais |

Os hashes identificam os arquivos consultados, não o digest de contêiner. O schema HTTP público não descreve todos os campos usados pelo serviço; aceitação de take/skip/remoteJidAlt e datas pela cadeia router/validador/serviço precisa de ensaio futuro. Não executar esse código público nem inferir que corresponda ao binário instalado.

Documentação existente revisada: [descoberta](WHATSAPP_DISCOVERY.md), [base](WHATSAPP_BASE_LOCAL.md), [leitura atual](WHATSAPP_CHAT_READONLY.md), [receptor](WHATSAPP_INGEST_READINESS.md), [topologia](WHATSAPP_REAL_TOPOLOGY_VALIDATION.md), [inventário](INTEGRACOES.md), [V1.0](especificacao-v1.0/originais/FUNIX_ESPECIFICACAO_UNIFICADA_V1_0_PARA_CONFERENCIA.md) e [V20](design/FUNIX_V20_Menu_Compacto_Kanban.html). [#53](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/53) e [#62](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/62), incluindo comentários de #62, continuam abertas. Os comentários de 06/11 atualizam a evidência n8n e superam a preferência histórica por espelho/RabbitMQ: avaliar primeiro leitura direta. Este documento não revalida n8n nem altera relatórios históricos.

## Módulos e contrato experimental

- `server/experimental/evolution-read/client.ts`: transporte obrigatório injetado, projeção/validação, erros e reconciliação pura de lotes.
- `server/experimental/evolution-read/context.ts`: estado V20 puramente em memória, sem dependência comercial/persistência.
- `server/tests/fixtures/evolution-read.ts` e `server/tests/evolution-read-poc.test.ts`: fonte sintética que modela skip/take e ordenação por timestamp. Não emula Prisma, PostgreSQL, Baileys, autenticação nem toda a Evolution.

Nenhum transporte de rede, base URL, leitura de env, API key, fetch, polling ou execução automática é fornecido. O chamador injeta função `(method,path,body,signal) -> {status,body:unknown}`; ela representa um transporte HTTP já decodificado. Todos os testes injetam funções offline. Nenhuma rota, bootstrap ou UI importa os módulos. A allowlist atual de Docker exclui `server/experimental/` e testes: a POC não entra na imagem API.

Exemplo fictício de requisições produzidas, sem host/credencial:

```json
{"method":"POST","path":"/chat/findChats/synthetic-offline","body":{"take":50,"skip":0}}
```

```json
{"method":"POST","path":"/chat/findMessages/synthetic-offline","body":{"where":{"key":{"remoteJid":"synthetic-alpha@lid","remoteJidAlt":"synthetic-alpha@lid"}},"page":1,"offset":50}}
```

Aqui **offset significa tamanho da página**, não número de registros a pular. Página 2 usa skip=50; tamanho fixo 50 entre chamadas. Resposta esperada: `{messages:{total,pages,currentPage,records:[...]}}`. Records mínimos: id técnico do registro, instanceId, key.id/remoteJid/fromMe (remoteJidAlt opcional), messageTimestamp inteiro, messageType, message objeto e MessageUpdate array de `{status}`. O adaptador verifica instanceId esperado e se JID primário **ou alternativo** coincide exatamente com o solicitado; um registro fora do escopo rejeita a página inteira, sem vazamento parcial.

Validação estrita dos campos consumidos: tipos, inteiros, limites, forma dos JIDs, booleanos, tipos de texto/mídia/status; respostas malformadas são recusadas. Campos adicionais do fornecedor são ignorados por projeção allowlist, não transportados como objeto bruto. Não se aceita formato alternativo silencioso. Os limites locais (chats 1–100 por lote, skip até 500000; mensagens 50, page 1–10000; timeout 1–60000 ms/padrão 5000; texto até 16384 caracteres; até 100 observações de status por registro) são proteções da POC, **não limites oficiais ou capacidade medida**. Uma resposta com quantidade maior que a pedida é recusada.

Projeção:

- PN e LID preservados sem conversão; remoteJidAlt é evidência retornada do registro, não regra automática para fundir conversas. Conversa inclui instância; messageId é `key.id`, separado de `recordId` do PostgreSQL. Grupo/broadcast/identidade inválida são recusados; listagem que os contenha falha explicitamente nesta versão mínima.
- fromMe permanece true/false e origin=unknown; não distingue celular/Web/n8n/App. Não marca leitura no WhatsApp.
- Texto conversation/extendedTextMessage. Image/audio/video/document apenas MIME, tamanho inteiro conhecido e referência opaca criada com instância/recordId/tipo. `available=false`; sem URL/directPath/mediaKey/base64/caption/nome/download. Formas com fileLength string/Long, wrappers, sticker e tipos desconhecidos não têm suporte presumido: desconhecido vira unsupported, forma inválida de tipo suportado é recusada.
- MessageUpdate contém observações brutas permitidas ERROR/PENDING/SERVER_ACK/DELIVERY_ACK/READ/PLAYED, sem timestamp/ordem causal no select público. Preserva conjunto ordenado/deduplicado, inclusive ERROR junto a READ; não fabrica estado “mais recente”, entregue/lida ou avanço por HTTP 200. findMessages não seleciona diretamente Message.status; findChats inclui status no lastMessage mas a projeção mínima não o usa. findStatusMessage existe no código, está fora do adaptador.
- findChats mantém só remoteJid/updatedAt/unreadCount, sem prévia, nome ou avatar; contagem ausente fica null. Nenhuma associação de Atendimento é inferida desses metadados.

Falhas: códigos sanitizados INPUT/RESPONSE/SCOPE/CONFLICT/HTTP/TRANSPORT/TIMEOUT/CANCELLED; HTTP expõe somente status, sem corpo/URL/cause. Nenhum retry automático, redirect ou fallback local com falso sucesso. Cancelamento/timeout abortam o sinal e encerram a espera mesmo se transporte o ignorar; transporte futuro deverá cancelar I/O efetivamente, limitar bytes antes do parse, Content-Type, TLS, redirecionamentos e destino permitido. A POC não garante limite de bytes de rede, concorrência distribuída ou interrupção de função injetada que bloqueie o event loop.

## Paginação: demonstrações e limites

Os lotes são apresentados cronologicamente, última mensagem ao final. Empate local é desfeito por identidade lexical; isso estabiliza somente a **apresentação dos registros recebidos**. `consistency=offset-not-snapshot` acompanha toda página. `reportedTotal/reportedPages` são consultivos; nextPage deriva do lote bruto cheio, não de promessa de total consistente. Um lote final exatamente de 50 exige mais uma chamada vazia. Lote curto não prova completude em conjunto mutável.

| Cenário sintético executado | Resultado observado / interpretação |
|---|---|
| 123 mensagens estáticas | Página 1 contém 74–123; páginas 2/3 completam 1–123, sem duplicatas |
| Inserir 101 após ler 51–100 de um conjunto de 100 | Página 2 repete 51; dedup reúne 99 registros, faltam 1 e 101; página 3 recupera 1, mas 101 só aparece ao atualizar o início |
| Remover 100 antes da página 2 | 50 continua na fonte mas é pulada; o lote agregado ainda contém a removida 100. Dedup não corrige lacuna nem exclusão |
| 100 timestamps iguais, ordem dos empates invertida entre páginas | Página 2 repete os mesmos 50; metade nunca chega, página 3 vazia. Desempate local não corrige a ordem remota |
| Inserção tardia no trecho já lido | Pode não aparecer em páginas anteriores; nenhuma fronteira estável foi criada |
| count=0 seguido de um registro no findMany simulado | Aceito como contagem consultiva inconsistente; não se fabrica snapshot |

`reconcileReadBatches` remove repetições exatas por `(instanceId,remoteJid,messageId)` nos lotes fornecidos. Conteúdo/status divergente para a mesma identidade gera CONFLICT, sem overwrite arbitrário. Ainda falta desenhar reconciliação de updates legítimos por revisão/observações; status diferente entre páginas pode bloquear a composição e exigir atualização explícita. Esse helper não guarda cache nem estado entre requests. Também não funde PN/LID com a mesma key.id sem identidade homologada.

Opções posteriores, nenhuma implementada:

1. Dedup + sobreposição/atualização explícita do início: melhora a UX, não prova completude sob mutações arbitrárias; precisa de política de conflitos e orçamento de consultas.
2. Intervalo temporal: o código público suporta ambos gte/lte inclusivos, em segundos. Pode limitar novos eventos no topo, mas não resolve empate na fronteira, backfill/remoção nem oferece ID secundário estável. Validar passagem pelo schema antes de oferecer esse filtro.
3. Consulta PostgreSQL read-only futura com ordenação composta e fronteira: exige metadados reais de índices, privilégios, isolamento, contrato versionado e EXPLAIN sem ANALYZE autorizado. Acopla ao schema do fornecedor; mudanças/retenção ainda importam. Não foi aberto banco ou construída consulta DB nesta POC.

## V20: conversa independente do Atendimento

No [mockup original](especificacao-v1.0/originais/FUNIX_V20_Menu_Compacto_Kanban.html), seção V14, demoLinks implementa pares N:N; demoActiveByChat guarda seleção por conversa. v14SwapChat troca mensagens por chat; switchAttendance altera contexto comercial sem substituir histórico. O teste de estado reproduz essa separação com IDs sintéticos próprios, sem copiar contatos do protótipo.

O modelo experimental contém ConversationRef `{conversationId,instance,remoteJid}`, conjuntos de Atendimentos conhecidos, pares explícitos e escolha por chat. Trocar Atendimento mantém a mesma referência de conversa e produz o mesmo pedido de leitura. Um Atendimento pode ter dois chats; um chat pode ter dois Atendimentos; chat sem vínculo mantém seu histórico e contexto null; Atendimento sem chat não ganha conversa fictícia. Desvincular o selecionado limpa apenas a seleção; não apaga histórico, não escolhe outro automaticamente e não cria registros. Escolha sem vínculo ou ID desconhecido é recusada. O contexto é efêmero; não implementa autenticação/autorização, auditoria ou persistência comercial.

**Diferença concreta atual:** `ChatRepository.link()` fecha o período aberto anterior da conversa, e cada mensagem guarda link_id; `messages(atendimentoId)` faz JOIN de chat_links e filtra pelo Atendimento. Mudar Atendimento pode retornar outro subconjunto da mesma conversa, com cursor local por sequência/timestamp/teto. A POC **não altera nem substitui** esse contrato, seu isolamento ou os endpoints GET atuais. O cursor SQLite não é convertido em page/offset Evolution.

Contrato futuro a aprovar: chave própria e estável de conversa/instância; associação N:N explícita com autoria/revisão; contexto por sessão/operador/conversa; leitura autorizada por conversa independente do Atendimento selecionado; regras de desvínculo/legados/aliases/privacidade e preservação dos períodos atuais. Mostrar histórico inteiro pode ampliar visibilidade em relação ao isolamento por período: não expor por um novo endpoint sem decidir autorização. V1.0 contém regras antigas de “nunca chat sem Atendimento”/criação automática; a Issue #71 autoriza apenas **provar o modelo V20**, não substituir essas regras em produção. Ciclo aberto separado do funil, ambiguidade, candidato e “Não gerar lead” continuam sem automatismos. Migração posterior explícita, nunca reinterpretar ou apagar mensagens já vinculadas.

## Matriz de testes e reprodução

Os 16 testes próprios abrangem as linhas abaixo. “Passou” nos contraexemplos significa que o teste **detectou a limitação**, não que a API ofereça consistência.

| Cobertura | Estado |
|---|---|
| POST/listagem take/skip, projeção sem prévia/URLs | PASSOU, SIMULADO |
| Últimas 50, páginas anteriores, 123 registros, vazio e limite exato | PASSOU, SIMULADO |
| Inserção, remoção, empate reordenado, backfill e count não atômico | PASSOU, SIMULADO: limitações demonstradas |
| PN/LID/remoteJidAlt, fromMe true/false, escopo de instância/conversa | PASSOU, SIMULADO |
| Validação negativa, tipo desconhecido, texto e quatro mídias opacas | PASSOU, SIMULADO |
| Status sem cronologia inventada, duplicatas exatas e conflitos | PASSOU, SIMULADO |
| HTTP 3xx/401/403/404/429/500, erro sanitizado, timeout/cancelamento | PASSOU, SIMULADO |
| N:N/contexto/troca/vínculo/desvínculo/chat livre/Atendimento multichat | PASSOU, SIMULADO |
| Build efetivo/digest, API real, índices/performance/retentiva/restore/echo celular | NÃO VERIFICÁVEL nesta POC offline |

```sh
node --test --test-isolation=none --test-reporter=spec server/tests/evolution-read-poc.test.ts
npm run check
python tests/browser/chat_local_base.py
python -m unittest discover -s deploy/tests -v
git diff --check
```

A suíte própria não precisa de rede ou banco. `npm run check` inclui persistência/reinício sintéticos existentes e TypeScript dos módulos experimentais. O primeiro ensaio completo e o Chromium foram bloqueados pelo sandbox em sockets loopback; execução repetida com permissão para servidores locais, sem mudar os testes.

**Resultados locais:** `npm run check` passou com **566/566 testes**, incluindo os **16/16 da POC**, build e TypeScript; lint sem erros, apenas avisos preexistentes. Após pequenos ajustes no validador, testes próprios, TypeScript e lint dos arquivos novos foram repetidos com sucesso e sem avisos novos. Chromium: **9/9 grupos** em 320/390/1440, sem requests externos/erros de página, preservando paginação/autorização/isolamento do Chat existente; capturas regeneradas foram mantidas fora do diff. Testes de recuperação/scripts de implantação com executáveis simulados: **23/23**; nenhum instalador foi executado contra VPS. Links locais (9), blocos e `git diff --check` aprovados. Logs locais em `.runtime/issue71-evidence/`; resultados remotos do CI devem ser conferidos na PR. Não se executou Docker local nesta POC; o CI verifica as imagens isoladamente.

Única mudança fora de módulos/testes/documentação: a etapa de health-check produtivo no workflow `voice-pr3-browser.yml` fica restrita a workflow_dispatch. Ela antes consultava o domínio real em toda PR; restringi-la é necessário para respeitar esta tarefa offline. Todos os testes sintéticos do Copiloto permanecem no workflow. Isso não altera código/UX do Copiloto, integrações n8n ou endpoints produtivos. Publish/deploy do pipeline continuam fora do evento pull_request.

## Decisão recomendada e gates

| Opção | Recomendação / evidência necessária |
|---|---|
| A — leitura backend Evolution | Primeira candidata para homologação isolada. Evita duplicar todo histórico e mantém n8n/ERP intocados. Ainda sem garantia de completude/paginação, retenção, disponibilidade ou performance |
| B — cache seletivo | Somente após medir custo/latência de listagem/contadores ou exigir continuidade offline. Definir frescor/invalidação/status/autorização/retenção; não cura falta de completude upstream. Nenhum cache implementado |
| C — mirror integral | Não justificado por esta POC. Aumenta dados sensíveis, custos, reconciliação, recuperação e risco operacional; considerar apenas mediante limitação medida e nova aprovação. Sem RabbitMQ ou fila nova |

Não há benchmark válido de grandes históricos: skip profundo e DISTINCT ON/count podem custar mais, mas não foram medidos nem foi comprovado gargalo. Schema público não declara índice composto por chave JSON de conversa + timestamp em Message; índices reais podem diferir. Não recomendar CREATE INDEX nem SLA com base na fixture. Metadados do catálogo precisam ser obtidos por papel autorizado, sem registros de clientes, em tarefa separada.

Próximo teste seguro, **ainda não executado/autorizado aqui**: Evolution descartável com digest registrado e PostgreSQL próprios, sem sessão ou dump produtivo. Fixtures sintéticas homologadas contra a cadeia HTTP completa para confirmar filtros/JSON/respostas, take/skip, page/offset, empates/concorrência e limites de payload. Só numa autorização distinta, conta/número de teste próprios para echo Baileys/celular/Web/status/mídias; nunca clonar a sessão principal. Medir latência/volume em dados artificiais, ensaiar retenção e restauração isoladas. Nenhuma alteração no número principal para esse ensaio.

**Decisões que ainda exigem aprovação:** contrato N:N/autorizações e migração de períodos; identidade PN/LID e instância técnica; política de conflitos/frescor/completude aceitável; acesso backend seguro/cofre sem chave no frontend; retenção/backup/RPO/RTO/restauração; critério mensurável para B ou C; ambiente e escopo de homologação. Sem isso, não conectar a POC, ativar ingest, alterar capabilities ou remover a inbox existente. Sem merge/deploy nesta entrega.
