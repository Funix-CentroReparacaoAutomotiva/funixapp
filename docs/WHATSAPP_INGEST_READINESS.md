# Receptor normalizado WhatsApp — prontidão isolada (Issue #60)

Data: **05/11/2026 (America/Sao_Paulo)**. Base inicial `main` `d0995d4`, após PR #57. Branch/worktree independentes: `feat/issue-60-whatsapp-ingest`. Referências: [Issue #60](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/60), [descoberta](WHATSAPP_DISCOVERY.md), [base SQLite](WHATSAPP_BASE_LOCAL.md), [Chat read-only](WHATSAPP_CHAT_READONLY.md) e [inventário histórico](INTEGRACOES.md).

## Alcance e evidência

**Implementado e testado localmente:** receptor máquina a máquina no mesmo backend, autenticado antes de interpretar JSON, com persistência pela inbox existente. Desativado por padrão, sem instância criada no startup/primeiro evento, sem vínculo/criação automática de Atendimento, sem envio e sem retrieval. UI/GET e `capabilities.messages=false` permanecem; nenhum arquivo do Copiloto, ERP, motor, orçamento, schema ou migração foi alterado.

**Pendente de evidência atual:** não há conector n8n/Evolution disponível nesta sessão. Não foram consultados grafos produtivos, execuções, conversas, credenciais, VPS ou banco instalado. O inventário de 21/10/2026 não confirma receptor atual, distribuição, modalidade/versão Evolution, `fromMe` do celular/Web, status ou mídias. Não se conclui que esses eventos chegarão ao App. Esta rota recebe contrato **normalizado de futuro relay confiável**; não é webhook bruto Evolution e não foi conectada a serviço externo.

Um receptor autenticado não garante cópia sem perdas: a fila/ledger durável e independente no relay exige desenho, evidência e homologação separados, preservando classificador, triagem e ERP publicados. Nenhum workflow foi criado, clonado, executado, publicado ou redirecionado.

## Fechado por padrão e configuração

O bootstrap somente considera o receptor quando `FUNIX_WHATSAPP_INGEST_ENABLED` é exatamente `true`. A mera presença de senha do operador, caminho ou arquivo não ativa a rota. Sem flag/configuração válida, todos os métodos retornam **404 `NOT_FOUND`**, sem interpretar corpo, consultar a inbox ou registrar instância. O operador continua podendo usar a aplicação; configuração ausente/inválida fecha somente o receptor.

Ativação **futura**, dependente de autorização separada:

1. Provisionar arquivo privado do backend via cofre, fora do Git/frontend/imagem e dos relatórios. Configuração apontada por `FUNIX_WHATSAPP_INGEST_CONFIG_FILE`; arquivo regular, sem symlink, sem permissão de grupo/outros e com até 16 KiB. Leitura limitada também em caso de crescimento concorrente. Não há busca remota de secrets nem fallback à senha do operador/Evolution.
2. Formato v1: `keys` com 1–8 entradas de `keyId`, `secretBase64` e `instances`. Cada segredo contém 32–64 bytes aleatórios codificados em base64 canônico; keyIds são únicos, ASCII e limitados. Lista de instâncias por chave: 1–16 aliases ASCII explícitos, sem repetição dentro da lista. Não há campos extras. Qualquer configuração inválida fecha a rota inteira. O exemplo abaixo é esquemático, **não contém credencial utilizável**:

```json
{
  "version": 1,
  "keys": [{
    "keyId": "relay-piloto",
    "secretBase64": "<fornecido por cofre; nunca por Issue/PR/chat>",
    "instances": ["alias-local-verificado"]
  }]
}
```

3. Além da whitelist, a instância deve estar **previamente registrada** em `chat_instances` com marco de ativação aprovado. Nem loader, receptor ou bootstrap chamam `registerInstance`. A operação administrativa auditável de registro ainda precisa ser definida/autorizada; não existe endpoint que a execute. Testes registram apenas aliases sintéticos em bancos temporários.
4. Somente após aprovar relay, identidade, retenção, backup e piloto, configurar flag e reiniciar de forma autorizada. Não foram alterados Compose, mounts, VPS ou runtime real nesta PR. O `.env.example` permanece explicitamente `false`; nenhum segredo foi adicionado a arquivos versionados.

Rotação: aceitar chave atual e anterior em sobreposição curta, cada qual com whitelist própria, e remover a anterior no arquivo seguido de reinício autorizado. Configuração é capturada no startup, sem hot reload. Testes comprovam aceitação das duas e revogação da removida após restart. Separar completamente secrets de operador, relay e provedor; registrar responsável/data da rotação sem registrar valores. Não enviar QR, tokens ou arquivos de sessão.

## Contrato HTTP

`POST /api/integrations/whatsapp/events`, sem cookie como autoridade e sem query string. Apenas `application/json`, opcional `; charset=utf-8`; sem `Content-Encoding`. Corpo é UTF-8 válido e contém o contrato normalizado v1 já documentado; tipos suportados: `message.upsert` e `message.status`.

Headers exclusivos, sem duplicação:

```text
Content-Type: application/json
X-Funix-Key-Id: relay-piloto
X-Funix-Timestamp: <segundos Unix UTC atuais, decimal canônico>
X-Funix-Signature: sha256=<64 caracteres hexadecimais minúsculos>
```

Pré-imagem HMAC-SHA256: bytes UTF-8 de `v1\n<keyId>\n<timestamp>\n`, seguidos pelos **bytes exatos do corpo**, sem reserializar, decodificar ou normalizar antes da verificação. Cada `\n` representa um byte LF. `keyId` e timestamp também ficam vinculados à assinatura. Comparação constante de buffers de 32 bytes; chave desconhecida recebe trabalho HMAC equivalente com chave fictícia sem autorização e o mesmo erro genérico de autenticação. Assinatura nunca é segredo de operador ou chave Evolution.

Janela: **±300 segundos**, verificada antes e depois da leitura. Acordar sincronização de relógios antes de piloto. Retry preserva o evento/ID, mas usa timestamp atual e assinatura recalculada. Um replay fresco e idempotente pode recuperar o recibo; não há cache de assinatura que bloqueie retry legítimo. JSON com outra formatação precisa ser assinado novamente; o digest canônico do evento, calculado depois da autenticação, mantém dedup sem depender de espaços/ordem de campos.

Exemplo de corpo inteiramente sintético:

```json
{
  "schemaVersion": 1,
  "instance": "alias-local-verificado",
  "eventId": "evento-sintetico-001",
  "occurredAt": "2026-11-05T13:00:00Z",
  "type": "message.upsert",
  "message": {
    "remoteJid": "contato-sintetico@lid",
    "messageId": "mensagem-sintetica-001",
    "fromMe": false,
    "origin": "unknown",
    "kind": "text",
    "text": "Conteúdo exclusivamente sintético",
    "media": null
  }
}
```

O alias do exemplo não é provisionado pelo código. Usar instância em whitelist sem registro local resulta em recusa, nunca criação. LID não é telefone; grupos/identidade não confiável vão à quarentena conforme a base. `fromMe`, candidato, nome, telefone repetido ou preferência “Não gerar lead” não criam vínculos. Não se aceitam campos extras para impor um Atendimento ao evento. Mídias têm referências opacas, sem URLs livres, binário, download ou execução.

| Status | Significado |
|---|---|
| 202 | Inbox e projeções confirmadas; resposta `{receiptId,state:"persisted",disposition}`. Sem texto, JID, alias ou eco de eventId |
| 404 | Receptor desabilitado/configuração ausente ou inválida; resposta uniforme, sem enumeração de chaves/instâncias |
| 405 | Método não permitido quando configurado |
| 401 | Assinatura/header inválido ou ausente, chave desconhecida, timestamp vencido/futuro; erro genérico |
| 403 | Origin/metadado de navegador presente, instância fora do escopo ou sem registro local explícito |
| 400 / 415 / 413 | Query/corpo incompleto; formato/encoding recusado; limite de bytes excedido |
| 408 / 429 | Tempo de corpo excedido; limite de requisições ou simultaneidade (`Retry-After: 60`) |
| 422 | UTF-8/esquema/versão inválidos, após autenticação |
| 409 | Mesmo eventId com digest divergente; original preservado |
| 503 | Falha de persistência/lock; sem ACK e com retry idempotente possível |

Limites fixos: **256 KiB** reais de corpo (Content-Length e streaming), **5 segundos** para corpo completo, **4 uploads simultâneos** e **120 tentativas por minuto por processo**, inclusive inválidas/replays. Rejeições fecham a conexão após responder, sem continuar acumulando corpo. Esses limites não substituem quotas/distribuição de carga no proxy/relay futuro e não constituem defesa distribuída. Nenhuma alteração de proxy foi feita.

Todas as respostas usam `no-store` e requestId opaco existente. Não há CORS permissivo ou redirect; Origin e `Sec-Fetch-Site` são recusados, inclusive com cookie válido. HMAC não é enviado ao navegador nem aparece em HTML/URLs. O caminho M2M é avaliado antes da autenticação por sessão; GETs do Chat continuam protegidos pela sessão e não são habilitados por chave do relay.

## Persistência, recuperação e telemetria

Após MAC/UTF-8/esquema/whitelist, `ChatRepository.ingest` verifica o registro explícito e usa a transação existente: **202 só depois de COMMIT**. Mesmo evento/digest retorna o mesmo recibo após novo timestamp, outra serialização, restart ou processos concorrentes. Alteração legítima de status usa eventId distinto; status anterior ao upsert permanece pendente sem mensagem fictícia. Entrega/leitura nunca são inferidas de sucesso HTTP.

`disposition` preserva o resultado daquela ingestão (`pending`, `projected`, `quarantined`, `before_activation`), não o estado atual da conversa. Quarentena e eventos anteriores ao marco não guardam payload, conforme a base. Evento corrigido com conteúdo diferente requer decisão auditável de reprocessamento/novo ID, sem sobrescrever o original silenciosamente.

Não há expurgo ativado: retenção de eventos/recibos, mensagens, quarentena e backups precisa de prazo/quotas/responsável aprovados. Preservar dedup/recibos pelo horizonte de retries/replay; assinatura com timestamp novo não impede replay antigo por um relay autorizado. Backups devem usar a API SQLite existente e restauração ensaiada, incluindo o registro de instâncias; definir RPO/RTO. Perder banco/backup posterior ao ACK pode perder o recibo: a cópia durável do relay e sua reconciliação são gates independentes.

Hook opcional de telemetria recebe somente `outcome`, status HTTP e duração. Nenhum payload, chave, assinatura, telefone, JID, nome ou conteúdo de mídia é logado. Falha síncrona/assíncrona do monitor não altera ACK. Contagens de requests aceitos incluem retries; não equivalem a mensagens novas, conexão ativa ou entrega. Métricas futuras de backlog/quarentena/atraso exigem revisão sem dados pessoais. O runtime não instala logger de payload nem expõe diagnóstico de configuração em health; `capabilities.messages` continua false.

## Testes executados e pipeline

```sh
node --test --test-isolation=none --test-reporter=spec server/tests/chat-ingest.test.ts
npm run check
python tests/browser/chat_local_base.py
docker build --target api -t funix-api:ci .
bash deploy/test-containers.sh
git diff --check
```

Onze testes próprios HTTP/configuração: HMAC certo/incorreto/ausente/adulterado, timestamp vencido/futuro e expirado durante corpo, bytes exatos, UTF-8, tipos/encoding/limites, header duplicado, rotação, allowlist e ausência de registro, cookie sem HMAC, CORS/redirect, dedup/conflito, status antes de mensagem, `fromMe` e mídia opaca, LID/grupos/candidato/múltiplos Atendimentos, corpo parcial sem ACK, falha de persistência sem projeção parcial, timeout, rate limit e quatro uploads simultâneos. Chaves e senhas são aleatórias por execução, mantidas em memória ou arquivos privados temporários, nunca versionadas.

Resultado local: **498/498 testes** em `npm run check` (build, TypeScript, testes e lint sem erros; avisos preexistentes, nenhum no receptor novo), incluindo **11/11 testes próprios**. Chromium aprovado nos três tamanhos com os nove grupos existentes estendidos para o HMAC/replay e privacidade. A API foi reconstruída e o smoke Docker aprovado com receptor fechado; a imagem web local era a imagem de teste já disponível, enquanto o CI completo reconstrói ambos os targets. Não houve mudança de UI neste incremento; preservaram-se as capturas anteriores, e o resultado JSON registra o novo cenário HTTP. `git diff --check` e validação de JSON/links do relatório passaram.

Dois processos HTTP independentes usam o mesmo SQLite sintético e confirmam **um evento/mensagem/recibo**; um terceiro processo após reinício recupera o mesmo recibo sem registrar instância ou criar Atendimento/vínculo. Integridade SQLite verificada. Não se presume essa propriedade por simples mock.

Chromium 320/390/1440 usa a fixture explícita, com chave temporária no backend/controlador de teste, assinatura **Python HMAC → Node crypto** interoperável, evento HTTP sintético pendente e replay. Nenhum segredo é injetado em script/DOM. Cookie sozinho é recusado; navegador comum não pode postar como relay; mensagem pendente não aparece nos Atendimentos A/B de mesmo telefone. Permanecem as verificações de Chat real, paginação recente/anterior, posição preservada, sessão expirada e Copiloto único. Sem chamadas externas; capturas/relatório do smoke são artefatos sintéticos do teste.

Novos módulos ficam em `server/chat/*.ts`, cobertos pelo COPY e pela allowlist existentes; nenhum segredo ou teste é incluído na imagem API. Smoke Docker inclui rota desativada com senha/cookie de operador válido e GET read-only ainda funcional. CI completo recompila API/web e repete testes/Chromium; publicação/deploy são ignorados em PR. Não há migration nova.

## Riscos residuais e decisões da direção

| Risco/gate | Evidência ou decisão necessária antes de piloto real |
|---|---|
| Cópia interfere em ERP/triagem ou perde evento | Grafos publicados/drafts e topologia atuais sanitizados; transporte de cópia durável independente, replay e rollback homologados; não publicar draft para instalar cópia |
| Cobertura celular/Web/modalidade desconhecida | Metadados Evolution reais, integration/version, `fromMe`, echoes, status e formatos; ensaio consentido em sandbox e depois janela específica no número principal |
| Alias/identidade/vínculo equivocados | Verificar alias e instância técnica; registro administrativo com responsável/auditoria; ciclo aberto separado do funil e conciliação ERP antes de qualquer automatismo |
| Secrets/relógio/quotas | Cofre e leitura privada, rotação/revogação, NTP, quotas externas e limites por relay/processo homologados; nunca segredos em Issue/PR/chat |
| Retenção, disco ou restauração | Volume estimado, quotas e prazo de dados/recibos/backups, responsável, RPO/RTO e ensaio; impedir expurgo prematuro da dedup |
| 202 sem durabilidade além do banco local | Relay deve preservar cópia durável, ACKs e reconciliação após timeout/restauração; receptor isolado não resolve perda upstream |

Plano futuro reversível: aprovar contratos/secret/registro e retenção; testar sandbox com dados consentidos; autorizar separadamente cópia e piloto de recepção em escopo/janela definidos, com observador do ERP/celular/Web e critérios de parada. Em falha, fechar o receptor pela flag e reinício autorizado e suspender a cópia pelo mecanismo aprovado, preservando a cadeia ERP original; relay retém/reassina retries com IDs originais. Não desligar número/sessão/triagem, publicar draft ou reenviar mensagens para reverter. Nenhuma dessas operações foi executada.

Esta entrega prepara o teste técnico isolado. Captura real, mudanças de n8n/Evolution/ERP/VPS, registro operacional, vínculo automático, envio, merge e deploy continuam sem autorização. A Issue #53 e o M3 permanecem abertos para os próximos incrementos.
