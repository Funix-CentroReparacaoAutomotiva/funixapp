# Evolution 2.3.7 — laboratório descartável (Issue #74)

Data: **06/11/2026, America/Sao_Paulo**. Base `main` `ac73fed5431547999f82c79a6e35dc9fd34ea750`, após PR #73. Branch/worktree exclusivos: `feat/issue-74-evolution-sandbox` / `evolution-sandbox`.

## Resultado: execução bloqueada, homologação HTTP não concluída

**Nenhum contêiner do laboratório foi iniciado. Não houve requisição HTTP à Evolution, seed, consulta PostgreSQL, medição de latência ou teste real de recuperação.** O download da imagem pública fixada por digest chegou à extração e falhou com `failed to register layer ... no space left on device`. A fotografia posterior tinha aproximadamente 449 MiB livres no filesystem local de 7,9 GiB. O daemon gerenciado usa camadas VFS nessa extração; não extrapolar o espaço de uma imagem compactada para sua extração local.

Não foram removidos recursos compartilhados, alterado storage driver, reiniciado daemon nem usado `docker system prune`. O Docker local informou versão 29.9.2. O acesso inicial ao socket foi bloqueado pelo sandbox; a consulta ao socket **local explícito**, com seletores remotos removidos, funcionou com permissão de execução. O problema que bloqueou a imagem foi espaço, não acesso à VPS ou indisponibilidade comprovada da Evolution.

Entregue o fallback previsto na [Issue #74](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/74): harness isolado, contrato estático da cadeia upstream, testes offline de segurança e relatório do impedimento. O harness e suas asserções HTTP ainda precisam ser ensaiados em Docker com espaço suficiente; não são um teste de integração aprovado.

Classes: **REGISTRO PÚBLICO** = manifest/proveniência consultados sem executar imagem; **CÓDIGO** = inspeção estática upstream/FunixApp; **ESTÁTICO/SIMULADO** = parser/configuração ou comandos mockados; **BLOQUEADO** = não executado. Nenhuma classe comprova a instalação FUNIX.

## Imagens, versão e rastreabilidade

| Imagem candidata, plataforma linux/amd64 | Manifest digest fixado | Evidência |
|---|---|---|
| `evoapicloud/evolution-api:v2.3.7` | `sha256:456b4104b0ddffbb092d6b3c0560a4ae86fc3e014e885b882aca4b1b371dfc81` | REGISTRO PÚBLICO: a tag aponta para índice OCI contendo esse manifest; pull por digest falhou na extração |
| `postgres:15.15-alpine` | `sha256:f6498f214984ab10ad90d839204a19effa2ad3aff15fbacd12e43cd8b527c5e5` | REGISTRO PÚBLICO: manifest resolvido; não baixado/executado |
| `redis:7.4.7-alpine` | `sha256:b9f6cf0cab55fdd102fd2182deeae150457943d33439d18c6e2fc5666d3228c1` | REGISTRO PÚBLICO: manifest resolvido; não baixado/executado |

A referência alternativa `evoapicloud/evolution-api:2.3.7` retornou `no such manifest`; não se usou `latest` como fallback. O Compose contém referências **por digest de plataforma**, não tags mutáveis.

A proveniência publicada via `docker buildx imagetools inspect ... --format '{{json .Provenance}}'` declara como material/configSource o commit **`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`** do repositório upstream. `git ls-remote` confirmou tag anotada `2.3.7` (`6a398a6a08e59eb87dcf98b0f389e8decaf08689`) resolvida para esse commit. O [package.json dessa revisão](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/package.json) declara 2.3.7, blob `56e32fcc8a5401262dbc560d35c8285a9a75d7aa`.

Isso é vínculo verificável entre **publicação do fornecedor, digest e código declarado**, não auditoria criptográfica independente do builder nem prova da imagem instalada na FUNIX. Não se verificou assinatura externa da attestation, correspondência byte a byte do bundle ou reprodutibilidade do build. O Dockerfile upstream contém label antigo 2.3.1 no builder: label isolado não basta para identificar versão. Image ID local, package.json extraído e versão declarada pela aplicação em execução continuam **BLOQUEADOS**.

O harness faz gate adicional: após pull, cria contêiner **sem iniciar processo**, com `--network none`, copia somente `/evolution/package.json` e exige versão 2.3.7; divergência impede `up`. Registra image ID sem imprimir ambiente. Não inicia imagem arbitrária para “descobrir” versão. Se o vínculo acima for contestado ou o arquivo não corresponder, parar e revisar, sem trocar silenciosamente o digest.

[Registro resumido sanitizado](evidencias/issue74-evolution-sandbox/evidence.json). Não versionar a proveniência inteira, configs resolvidas com secrets ou logs brutos de criação da instância.

## Contrato assertivo por código, ainda sem homologação HTTP

Fontes upstream na revisão acima: [router](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/routes/chat.router.ts), [RouterBroker](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/abstract/abstract.router.ts), [schemas](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/validate/chat.schema.ts), [controller](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/controllers/chat.controller.ts), [Baileys fetchMessages](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts), [Channel fetchChats](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/services/channel.service.ts), [Prisma](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/prisma/postgresql-schema.prisma).

`RouterBroker.routerPath()` usa `/:instanceName`; `instance` na POC é alias da URL, enquanto `instanceId` é a identidade técnica esperada no retorno. Guards verificam instância/autorização; controller acessa instância em memória. `dataValidate` instancia Query, copia o body com Object.assign, valida JSONSchema e chama controller. Não filtra automaticamente todos os campos desconhecidos. **Não transformar esse schema permissivo em API pública do FunixApp.**

| Operação | Requisição por código | Resposta por código / limite |
|---|---|---|
| `POST /chat/findChats/:instanceName` | Body Query; where opcional com remoteJid; serviço consome take/skip e intervalo where.messageTimestamp com gte **e** lte. Não consome page/offset para limitar chats | 200 array com id nullable, remoteJid, pushName, profilePicUrl, updatedAt, windowStart/windowExpires/windowActive, lastMessage opcional, unreadCount/isSaved. DISTINCT ON de mensagens por JID; não prova listagem de chats sem mensagem |
| `POST /chat/findMessages/:instanceName` | where opcional com id/source/messageType, key.id/fromMe/participant/remoteJid/remoteJidAlt; intervalo de datas apenas com ambos gte/lte. page default1; offset default50 por truthiness | 200 `{messages:{total,pages,currentPage,records}}`. Count e findMany separados; orderBy messageTimestamp DESC fixo; skip=offset×(page−1), take=offset |

Campos não são todos obrigatórios no JSONSchema upstream. contactValidateSchema valida strings declaradas quando presentes; messageValidateSchema declara where/key e `limit` inteiro, mas não declara todas as opções efetivamente consumidas pelo serviço. `_id` aparece no schema, enquanto serviço usa `where.id`: não há prova de alias automático. `limit` não limita o fetchMessages; `sort` em Query não muda o DESC fixo. A condição propertyNames em key e a ausência de additionalProperties=false não equivalem ao validador estrito da POC. Aceitação efetiva e códigos de erro seguem **BLOQUEADOS** até passar pela cadeia HTTP.

O serviço cria OR entre comparações JSON de remoteJid/remoteJidAlt. A POC preservada envia o mesmo JID em ambos os operandos, sem inferir que LID é telefone. Filtros isolados e presença de operandos vazios merecem ensaio: não presumir semântica Prisma a partir do nome de um campo. `fromMe=false` não adiciona filtro, pois o serviço testa truthiness; `true` adiciona. Nenhuma origem App/celular/Web pode ser deduzida só desse booleano.

Records de findMessages selecionam id, key, pushName, messageType, message, messageTimestamp, instanceId, source, contextInfo e MessageUpdate com status. Não selecionam diretamente Message.status. São campos do fornecedor; a POC aceita/projeta somente seu subconjunto testado. Status não vem com ordem causal/timestamps nessa seleção. Mídia está no JSON message; URL/mediaKey não devem escapar da projeção ou ser acessadas. Wrappers, Long/string em fileLength, conteúdo removido/expirado e formatos não conhecidos seguem sem garantia.

Exemplo **fictício**, sem host ou credencial:

```json
{"where":{"key":{"remoteJid":"synthetic-lab@lid","remoteJidAlt":"synthetic-lab@lid"}},"page":1,"offset":50}
```

## Harness: isolamento e reprodução

Arquivos em `tests/evolution-sandbox/`:

- `compose.yaml`: três serviços novos, rede internal, **zero portas publicadas**, sem network_mode host, volumes external, Docker socket ou mounts de dados existentes. Volumes de PostgreSQL/Redis/instances são do projeto aleatório.
- `run.py`: entrada opt-in; fixa socket Docker local, ignora seletores remotos/COMPOSE_/LAB_ herdados, usa nonce e recusa colisão com volumes/redes/contêineres existentes. Gera somente secrets locais aleatórios em arquivo temporário 0600, não carrega `.env` e não imprime config/erro bruto. Pull de dependências públicas ocorre fora da rede de runtime.
- `contract.mjs`: executado **dentro da Evolution local**, com URL fixa loopback e allowlist de caminhos. Importa `EvolutionReadPoc` original por mount read-only, sem mudar o adaptador. Não fornece rotas connect/QR/send/download; única criação é instância fictícia com integration Baileys e qrcode=false.
- `test_harness.py`: dez testes offline com comandos Docker simulados. Integrados ao `npm run check` pelo teste `server/tests/evolution-sandbox-harness.test.ts`; CI comum não inicia laboratório.

O estado da instância de laboratório é close; segundo código do monitor, reload de close não chama connectToWhatsapp. Runtime não tem egress, proxies de download não são passados ao processo, telemetry/Sentry/eventos globais/integrações externas ficam desabilitados. Não há QR, número, clone de sessão ou autenticação Baileys. Retorno de criação pode conter hash mesmo local: runner descarta e nunca grava resposta bruta.

Pré-requisitos futuros: máquina descartável com Docker/Compose, linux/amd64 ou emulação revisada, Node 24/Python3 no controlador e disco suficiente para camadas/migrações/dados. O guard de **8 GiB livres** é uma reserva conservadora do harness, **não tamanho medido da imagem nem garantia de suficiência para VFS**. O ambiente atual inteiro tem menos espaço que isso; o guard interrompe antes de novo pull/start. Não retirar o guard para forçar execução neste filesystem.

```sh
# Estático/offline, não inicia Docker nem Evolution
python -m unittest discover -s tests/evolution-sandbox -v
node --check tests/evolution-sandbox/contract.mjs
npm run check

# Opt-in: executar somente em máquina descartável com espaço e os gates satisfeitos
python tests/evolution-sandbox/run.py
```

O controlador usa sempre `docker --host=unix:///var/run/docker.sock`, arquivos Compose/env explícitos e projeto evoreadlab-<nonce>. Verifica package antes de start; migrações são apenas as da imagem no PostgreSQL novo. Seed parametrizado verifica colunas mínimas no schema criado, sem fabricar DDL alternativo. Nenhuma variável permite apontar DB/API para host externo.

O fluxo proposto executa ensaios, interrompe só o PostgreSQL local para observar 5xx **ou timeout**, para Evolution, recupera DB/Redis/Evolution e verifica contagem/API/ausência de sessões. Recovery é restart de serviços com volumes retidos, **não backup/restore nem recuperação de desastre**. `finally` remove apenas o projeto recém-criado com down --volumes; falha de cleanup deixa estado bloqueado e projeto registrado para inspeção. Não há prune global, rmi compartilhado ou alteração de daemon. Secrets temporários são removidos; artefatos sintéticos ficam privados em `.runtime/evolution-sandbox/`. Imagens puxadas permanecem em cache do daemon; limpeza global é decisão do responsável pelo ambiente.

## Matriz: executado versus pendente

| Ensaio / evidência | Resultado nesta tarefa |
|---|---|
| Manifest/proveniência/tag/package upstream | REGISTRO PÚBLICO/CÓDIGO: vínculo documentado; execução do pacote da imagem não verificada |
| Pull por digest | FALHOU: extração sem espaço; sem contêiner iniciado |
| Configuração Compose resolvida com secrets temporários, saída não impressa | ESTÁTICO: passou; três imagens fixas, rede interna, sem portas/volumes externos |
| Gates de disco/versão/pull/colisão, cleanup e não propagação de secrets | SIMULADO: 10/10 testes offline; não certificam comportamento de Docker real |
| Sintaxe runner JS / regressões POC existentes | ESTÁTICO/SIMULADO: verificadas pelos comandos e CI; sem alteração do adaptador |
| HTTP listagem, take/skip e GET indevido | BLOQUEADO; runner preparado, não executado |
| 123 mensagens estáticas: últimas50 e páginas2/3 | BLOQUEADO; asserções futuras via POC inalterada |
| Inserir duas mensagens entre páginas / exclusão+backfill | BLOQUEADO; runner verifica sobreposição/lacuna sem prometer snapshot |
| 60 timestamps iguais | BLOQUEADO; runner registra repetição/estabilidade observada, não exige ordem arbitrária para fabricar falha |
| PN/LID/remoteJidAlt, fromMe true/false e isolamento de duas instâncias | BLOQUEADO; nenhum payload real consultado |
| Status conflitantes e quatro mídias opacas, sem retrieval | BLOQUEADO; JSON sintético apenas; não comprova envio/cobertura Baileys |
| 4xx, offset zero/negativo, sort, perda de DB 5xx/timeout | BLOQUEADO; nenhum código HTTP observado no laboratório |
| Catálogo/índices/constraints/EXPLAIN e p50/p95 | BLOQUEADO; não há números ou planos executados |
| Restart/retenção local/ausência de Session | BLOQUEADO; não há conclusão de recuperação |

Os contraexemplos da [POC #71](WHATSAPP_EVOLUTION_READ_POC.md) continuam **simulações**: offset pode repetir/omitir registros com inserção/remoção/backfill e empates. Reordenação lexical dos lotes recebidos não é cursor remoto. Runner registra comportamento de empate observado, sem prometer que instabilidade necessariamente se manifestará em toda execução. Testes offline do harness não elevam essas simulações a evidência HTTP.

## Índices e medições: plano reproduzível, sem resultados inventados

No schema Prisma público, Message tem PK id, instanceId/FK e índice explícito instanceId; key é JSONB e messageTimestamp Int. Chat declara unique(instanceId,remoteJid) e índices instanceId/remoteJid. MessageUpdate declara FK messageId/instanceId e índices nesses campos. **Não são o catálogo efetivo do laboratório nem da VPS**; migrações ou alterações podem produzir outros índices. Nenhum CREATE INDEX proposto/executado.

Quando executável, o runner gravará somente metadados locais: information_schema.columns de Message, pg_indexes e pg_constraint para Message/Chat/MessageUpdate. O EXPLAIN ANALYZE/BUFFERS tem timeout5s e é permitido **só no banco descartável**: SELECT representativo com instanceId, igualdade JSON JID e timestamp DESC LIMIT50. Essa consulta com `->>` é representativa, **não captura do SQL exato do Prisma nem prova do plano do endpoint**. Não transportar esse comando para produção.

Carga planejada: 123 mensagens iniciais, 60 empates, quatro mídias/um LID, registros de mutação e mil mensagens artificiais em outra conversa; duas instâncias. Para cada operação first/deeper/chats: três aquecimentos, vinte amostras com dois workers; p50/p95 pelo método nearest rank (`ceil(n×p)−1` no array ordenado), medidos do request à leitura do corpo. Salvar dataset/concurrency/amostras junto às medições; registrar recursos/versões/driver da máquina na repetição. Vinte amostras são exploração limitada, não SLO, capacidade sustentada ou comparação estatística com VPS.

**p50: não medido. p95: não medido. Catálogo/planos: não obtidos.** Não afirmar adequação dos índices, performance de histórico grande, completude, retentiva ou durabilidade por startup/configuração.

## Testes de repositório e decisões

Foram executados testes offline do harness (**10/10**), validação de sintaxe, configuração Compose sem start e `npm run check` (**567/567**, build/TypeScript/lint sem erros, avisos preexistentes) com dados sintéticos. Após ajustes finais de autenticação Redis/metadados, testes próprios, lint e Compose estático foram repetidos e aprovados. O teste integrado que cria subprocessos exigiu permissão de execução por bloqueio EPERM do sandbox; não foi contornado reduzindo assertions. Links/blocos/JSON e whitespace também foram conferidos. Resultados do CI constam na PR. Nenhum workflow de deploy foi modificado; os quatro workflows existentes validam regressões/imagens FunixApp, **não executam este laboratório**. A restrição anterior do health-check produtivo a disparo manual permanece.

**Decisões dependentes da FUNIX:** disponibilizar ambiente descartável com espaço adequado (sem liberar/alterar VPS produtiva para isso); revisar os gates/artefatos da imagem e, após execução real, aceitar ou corrigir o contrato de leitura/POC com testes; decidir tolerância a lacunas/status/aliases, autorização e migração N:N/períodos, retenção/backup/RPO/RTO. A escolha entre leitura direta/cache/mirror continua pendente; nenhum cache, broker ou duplicação integral foi acrescentado.

Fase 2 com número/conta WhatsApp de laboratório exige autorização separada. A Fase 1 ainda não prova echo celular/Web, ingestão Baileys real, reconexão com número, mídia disponível ou restauração. Não ligar sessão principal para concluir ensaio. Refs #74, #71, #62 e #53; não encerrar automaticamente #74 enquanto faltarem evidências de execução. Nenhum acesso à VPS/serviços/dados FUNIX, mudança de Chat/rotas/SQLite/capabilities/Copiloto/deploy, merge ou deploy nesta entrega.
