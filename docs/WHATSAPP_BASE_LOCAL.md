# WhatsApp — base local de leitura (Issue #53, primeiro incremento)

Data: **05/11/2026, America/Sao_Paulo**. Base: `main` `696566a`, já com a PR #49 integrada. Branch/worktree independentes: `feat/issue-53-chat-local`.

Fontes: [Issue #53](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/53), [descoberta da PR #51](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/blob/docs/issue-50-whatsapp-discovery/docs/WHATSAPP_DISCOVERY.md), [INTEGRACOES.md](INTEGRACOES.md) e [V1.0 §§4–6](especificacao-v1.0/originais/FUNIX_ESPECIFICACAO_UNIFICADA_V1_0_PARA_CONFERENCIA.md). A descoberta ainda não consta da main inspecionada; não foi incorporada a branch do Copiloto nem a da descoberta.

## Escopo entregue

Este é o primeiro incremento permitido pelo critério “a primeira pode implementar somente a base local de eventos/SQLite e testes, seguida da UI”. Não conclui a Issue #53 nem o M3. A base é uma biblioteca interna de persistência, sem transporte externo, criação de Atendimento, vínculo automático, envio ou processamento de mídia.

- `shared/chat.ts`: subconjunto tipado do contrato normalizado.
- `server/chat/events.ts`: validação estrita do envelope JSON, limite antes de parse, canonicalização e digest.
- `server/chat/schema.ts`: DDL aditivo chamado pela migração central V14.
- `server/chat/repository.ts`: inbox/projeção atômicas, recibos, pendências, vínculos explícitos e leitura paginada por Atendimento.
- Testes próprios de persistência e smoke Chromium da aplicação existente.

Nenhuma rota HTTP, mudança de UI, configuração de runtime ou registro de instância foi adicionado ao bootstrap. `server/app.ts`, `src/App.tsx`, arquivos do Copiloto, motor e orçamento não foram alterados. `capabilities.messages` continua `false`. Abrir o aplicativo normalmente não gera fixtures nem habilita captura. A migração cria apenas tabelas/índices vazios quando um banco for aberto pela versão nova; nesta tarefa isso ocorreu somente em bancos temporários sintéticos.

Os dois importadores **locais/offline** (`coda-import.ts` e `diagnosis-recommendations.ts`) tiveram somente a lista de schemas aceitos e sua mensagem de erro estendidas para V14, pois a migração aditiva tornaria os bancos recém-abertos incompatíveis com suas verificações anteriores. Não mudou regra de recomendação/importação, não houve execução contra Coda/ERP real. Assertions de versão dos testes existentes foram atualizadas; a fixture de schema futuro passa de V14 para V15.

## Evidência e decisões

**Confirmado por código/testes locais:** propriedades de armazenamento descritas abaixo e ausência de ativação HTTP/UI.

**Histórico, sem revalidação:** os quatro workflows e versões em INTEGRACOES.md são evidência de 21/10/2026. Não há conector n8n/Evolution nem acesso configurado aos serviços nesta sessão. Nenhum grafo publicado/draft atual, execução, conversa pessoal, número principal, banco instalado, VPS ou credencial foi consultado. Receptor, filtros atuais, modalidade/versão Evolution, echo do celular/Web e cobertura de mídias continuam **pendentes de evidência**.

**Diretriz de desenho da direção em 05/11, ainda sujeita à homologação:** aberto significa ciclo não formalmente encerrado, separado da etapa comercial; nenhuma etapa/prazo/inatividade implica encerramento. Rejeitados requer encerramento explícito. O modelo futuro deverá separar ciclo, data e motivo. Não presumir que legados sem encerramento confiável estão abertos. Identidade comprovada e exatamente um aberto elegível são requisitos futuros para associação automática; múltiplos, LID não resolvido, candidato, “Não gerar lead” ou ambiguidade permanecem pendentes. Zero abertos não autoriza criação automática nesta etapa: conciliar primeiro com a criação ERP/n8n.

Esta PR não implementa ciclo de vida, encerramento, migração de dados de ciclo, busca automática de elegíveis ou criação automática. Nem mesmo telefone único permite criar vínculo. A função interna `link` representa apenas uma decisão humana explícita para os próximos incrementos; não está exposta à UI/API.

## Contrato efetivamente implementado

`ChatRepository.ingest(rawJson)` só aceita instância registrada explicitamente por `registerInstance`. Não lê variáveis de ambiente e não possui acesso à rede. Registro não existe no startup. Nome de instância é alias local, não prova modalidade ou ID real Evolution. O marco de ativação é imutável após registro.

Envelope v1: `instance`, `eventId`, `occurredAt`, `type`, `message`, `schemaVersion`; `correlation` opcional, com `commandId`/`erpEventRef` nullable. Correlação é somente metadado, nunca autoridade para vínculo ou prova de origem App. UTC ISO com segundos e até três casas decimais é normalizado para milissegundos. Datas inválidas e campos desconhecidos são recusados. Eventos futuros além de cinco minutos são colocados em quarentena. Limites: envelope 256 KiB e texto 16 KiB; IDs e referências possuem limites próprios no validador.

- `message.upsert`: identidade, `fromMe`, `origin: external|unknown`, `kind: text|image|audio|video|document|unsupported`, `text` e `media` nullable. `origin: app` é recusado nesta etapa porque não há ledger de comandos para comprová-lo. `fromMe` não distingue celular/Web/automação.
- `message.status`: identidade e `status: accepted|failed|delivered|read`. Não cria mensagem fictícia quando chega antes do upsert. Status posterior não regride entrega/leitura. Falha conflitante é preservada no evento, sem apagar evidência de entrega/leitura.
- JID telefônico válido e LID opaco formam identidade de mensagem; LID não é convertido em telefone. Grupos/broadcast/JID inválido ou identidade null geram quarentena técnica. Isso não comprova identidade civil ou elegibilidade de Atendimento. LID sem vínculo explícito permanece pendente.
- Mídia: apenas referência opaca, MIME e tamanho conhecido ou null. Sem URLs, base64, download, upload, decodificação ou chaves do provedor. Projeção de leitura informa `unavailable` para conteúdos não textuais; nenhum URL/ref externa é devolvido. O suporte aos cinco formatos nesta base é metadado, não suporte funcional M3.
- Outros eventos, inclusive edição/apagamento/conexão, são recusados até contrato próprio. Não se interpreta o formato bruto Evolution diretamente. Nenhuma conexão é declarada ativa por recebimento de fixture.

Exemplo inteiramente sintético:

```json
{
  "schemaVersion": 1,
  "instance": "synthetic-instance",
  "eventId": "event-one",
  "occurredAt": "2026-11-05T13:00:00Z",
  "type": "message.upsert",
  "message": {
    "remoteJid": "synthetic@lid",
    "messageId": "message-one",
    "fromMe": false,
    "origin": "unknown",
    "kind": "text",
    "text": "Conteúdo sintético",
    "media": null
  },
  "correlation": {"commandId": null, "erpEventRef": null}
}
```

## Persistência, vínculo e leitura

As sete tabelas são `chat_instances`, `chat_events`, `chat_conversations`, `chat_links`, `chat_messages`, `chat_statuses` e `chat_link_receipts`. Conversa única por `(instance,remoteJid)`; mensagem única por `(conversation_id,message_id)`, equivalente ao escopo triplo da descoberta; evento único por `(instance,eventId)`. Nenhuma tabela de envio/outbox é criada.

Cada ingestão usa `BEGIN IMMEDIATE`; recibo/projeção/status são confirmados juntos. O retorno `{state: persisted, receiptId, eventId, disposition}` ocorre **depois de COMMIT**. Não representa resposta HTTP ou aceitação de provedor. Mesmo evento/digest canônico retorna o mesmo recibo após restart; mesmo eventId/corpo divergente gera `ServiceError` 409 sem sobrescrever original. Novo eventId com mensagem já conhecida não duplica a projeção; conteúdo divergente fica em quarentena. Repetição válida de evento confirmado também pode recuperar o recibo de disposição original `pending`, mesmo após resolução posterior: recibo registra o resultado daquela ingestão, não o estado atual da conversa.

Eventos anteriores à ativação e eventos em quarentena guardam somente digest/metadados/motivo, sem payload pessoal. Eventos válidos após ativação guardam payload na inbox local para rastreabilidade; não são logs. Nenhuma rotina de expurgo é ativada sem política de retenção homologada. Replay confirmado não reexecuta efeitos nem cria Atendimentos. Falha na última escrita da inbox desfaz inclusive a projeção; não retorna recibo.

Sem vínculo, mensagem fica invisível à leitura por Atendimento. `pending()` retorna apenas conversationId/revisão/contagem, sem JID ou conteúdo; é consulta técnica interna, ainda sem endpoint ou paginação. Eventos sem identidade e conflitos ficam na quarentena de eventos, sem inventar conversa para resolução.

`link` exige Atendimento existente, conversationId, revisão esperada, requestId, ator, motivo e lista explícita de messageIds pendentes a atribuir. Recibo idempotente; divergência/revisão obsoleta retorna 409. Nenhuma comparação de telefone/nome/etapa cria vínculo. A operação fecha o período anterior e abre o novo de forma atômica, em tempo do servidor. Mensagens anteriormente vinculadas não são movidas. Mensagens futuras/atrasadas de conversa já vinculada são atribuídas conforme o período explícito que contém seu `occurredAt`; sem período, permanecem pendentes. Seleção humana de pendências pode associar mensagens anteriores ao início do período, sem reatribuir históricos já vinculados. Dois períodos não podem ser abertos no mesmo instante; retorna conflito. Essa operação interna ainda precisará de autorização de sessão/Origin no futuro adaptador HTTP.

`messages(atendimentoId,{cursor,limit})` consulta somente mensagens atribuídas àquele Atendimento, em ordem de instante do provedor e sequência durável para desempate. Limite 1–100; cursor opaco carrega escopo do Atendimento, instante, sequência e teto da primeira página. Novas chegadas acima do teto ficam para nova paginação, evitando mistura entre páginas. Cursor de outro Atendimento é recusado; filtro SQL continua aplicando Atendimento mesmo com cursor adulterado. Vínculos resolvidos durante uma leitura podem mudar o conjunto visível: não é snapshot transacional entre requisições. Não usar o cursor como credencial. Não há API pública; a autenticação/autorização deverá preceder qualquer chamada externa futura.

## Validação executada

Comandos reproduzíveis:

```sh
node --test --test-isolation=none --test-reporter=spec server/tests/chat-local.test.ts
npm run check
python tests/browser/chat_local_base.py
git diff --check
```

Os testes usam SQLite temporário/`:memory:`, referências e conteúdo sintéticos. A primeira tentativa da suíte completa no sandbox falhou por `listen EPERM` nos testes existentes de loopback; foi repetida com permissão de execução apropriada. Não se alteraram testes do Copiloto para contornar esse limite.

Cobertura da base: recibo durável/replay, instância desabilitada, digest independente da ordem de campos, identidade tripla, conflito sem overwrite, origem desconhecida, limites/datas, marco de ativação, quarentena, status antes do upsert/fora de ordem, vinculação explícita com conflito/rollback, períodos/históricos, isolamento de dois Atendimentos com mesmo telefone, cursor cronológico, mídia indisponível, falha sem ACK, upgrade V13→V14 com rollback/retry, restart em processo novo, backup/restauração SQLite, e dois processos concorrentes ingerindo o mesmo evento.

Chromium: **320×740, 390×844 e 1440×900**, troca A→B→A e abas Chat/Diagnósticos/Mapa. Capacidade de mensagens false, compositor desabilitado, conteúdo sintético privado ausente da UI, rotas de leitura/ingestão ausentes e POST recusado; zero requisições externas e zero erros de página. Artefatos locais ignorados em `.runtime/chat-local-browser/`. É smoke de preservação da UI existente; não comprova interface read-only nova nem recepção produtiva. O teste E2E da nova inbox será realizado no incremento de UI.

**Resultado final:** `npm run check` passou (build, TypeScript server, **464/464 testes**, lint sem erros). Inclui **13/13 testes específicos do Chat**. O lint mantém avisos preexistentes em módulos não alterados funcionalmente; nenhum aviso nos novos módulos Chat. Smoke Chromium: **3/3 tamanhos aprovados**. `git diff --check` passou.

## Próximos incrementos e pendências

1. Revisão desta base; interface de inbox/read-only com GETs autenticados, paginação de pendências/quarentena e resolução humana protegida por sessão/Origin/revisão. Estados vazio/desconhecido/falha devem ser reais; fixtures somente nos testes.
2. Homologar ciclo de vida separado, regras de legados, identidade/aliases e conciliação ERP antes de qualquer vínculo ou criação automática. Nenhuma classificação automática de aberto nesta PR.
3. Obter export sanitizado/read-only dos grafos **publicados** e drafts dos workflows `21wpOido7t5OHb7i` e `22tutH8gEcX6bNoe`, topologia receptora, filtros e distribuição, versão/modalidade Evolution, echo/status/mídias. Não solicitar execuções com conteúdo pessoal.
4. Revisar relay durável e adaptador assinado (segredo backend, HMAC sobre corpo bruto, janela temporal, limites, replay, rotação, rate limiting, retenção e recuperação) antes de criar rota de ingestão funcional. A assinatura não foi implementada nesta base sem transporte; **não expor `ingest` diretamente por HTTP**.
5. Definir retenção/quota/backup/RPO/RTO e testar replay/assinatura/expurgo isoladamente. Só depois pedir autorização específica para piloto de recepção com número/contatos consentidos e marco de ativação; envio permanece fora.

Piloto futuro reversível: homologar sandbox e contagens técnicas, instalar cópia independente sem substituir receptor/nem publicar draft, limitar escopo, observar continuidade ERP/celular/Web e atraso/dedup/vínculos. Parar em qualquer vínculo incorreto, duplicata, impacto operacional ou falha de persistência; desativar a cópia pelo mecanismo previamente aprovado e preservar recibos para replay controlado. Não mexer em sessão/número/triagem para reverter. Isso é plano, não foi executado.

V14 não possui downgrade destrutivo: versão anterior recusa schema futuro. Em eventual implantação autorizada, retorno à versão anterior exigiria backup pré-upgrade e plano de reconciliação; backup/restauração aqui foi somente sintético. Renumerar a migração ainda não integrada se outra PR ocupar V14; repetir CI depois de rebase. Sem merge, deploy, evento produtivo, mensagem enviada, alteração de n8n/Evolution/ERP/VPS ou banco real.

## Correção de empacotamento após revisão da PR #54

O [comentário de revisão](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/54#issuecomment-6669383401) identificou uma falha real no [CI inicial](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/actions/runs/42106904580): a API não iniciava porque `migrations.ts` importava `server/chat/schema.ts`, mas a imagem copiava somente `server/*.ts`. A validação inicial de Node/Chromium não exercitou o empacotamento da imagem; a indicação de aprovação local não incluía esse smoke Docker.

A correção inclui `server/chat/*.ts` no estágio API e libera somente essa pasta e seus módulos TypeScript no contexto permitido pelo `.dockerignore`. Era necessário corrigir ambos: somente adicionar `COPY` não disponibilizaria a pasta excluída do contexto. Não se ampliou a cópia para `server/` inteiro.

Validação local repetida: `npm run check`, build dos targets API/web e smoke `bash deploy/test-containers.sh`, usando imagens locais `funix-api:ci`/`funix-web:ci`. Verificação adicional dentro da API confirmou que `createChatSchema` é importável, que a pasta Chat contém somente `events.ts`, `repository.ts`, `schema.ts`, e que `server/tests`, `server/chat/tests`, `tests`, `.env`, `.git` e `node_modules` estão ausentes. Contêineres de teste usam `--network none`, filesystem read-only e SQLite sintético em tmpfs, sem publicação de portas ou uso de serviços produtivos.

A dependência de integrar a descoberta da PR #51 antes da PR #54 permanece para a direção. Durante a validação, a main avançou de `696566a` para `319e5ac` com a PR #55; esta branch foi atualizada por rebase sobre essa main, sem alterar os arquivos do Copiloto no diff da PR WhatsApp. Nenhum merge foi feito pelo Codex. Antes de eventual deploy, continuam obrigatórios backup pré-upgrade, autorização e plano de reversão para V14, independentemente de `capabilities.messages=false`.
