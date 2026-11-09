# FUNIX — contrato mínimo Coda → FunixApp para Atendimento no evento

**Estado:** IMPLEMENTAÇÃO PARCIAL EM PR DRAFT #104; sem merge, deploy, flag, credencial ou alteração do n8n produtivo. Decisão: dois bancos independentes, sincronização mínima por evento. Issue #103.

## Quando disparar

Ao receber `messages.upsert` de cliente, o workflow publicado do n8n primeiro aplica as **mesmas regras comerciais atuais** (reaproveitamento de Atendimento aberto, retorno após encerrado, candidatos e opção "Não gerar lead"), consulta ou cria no Coda e **obtém confirmação do identificador real da linha** `i-...`. Somente então prepara evento de sincronização para FunixApp. Nunca enviar evento se a etapa Coda falhou ou se a regra comercial proibiu criar lead.

O workflow de hoje faz essa decisão no Coda, mas **NÃO envia esse evento ao FunixApp**. O n8n deve ganhar um emissor tanto na ramificação "Atendimento existente" quanto na ramificação "Atendimento criado e confirmado"; a gravação do Coda não é substituída.

## Endpoint opt-in implementado

`POST /api/integrations/coda/atendimentos`

Cabeçalhos: `Content-Type: application/json`, `X-Funix-Timestamp: <UnixSeconds>`, `X-Funix-Signature: sha256=<64 hex>`. Não enviar Origin/Fetch headers, cookies nem querystring. Tempo permitido: até 300 s do relógio do servidor. Corpo JSON até 4096 bytes; leitura limitada a 5 s.

Assinatura HMAC-SHA256 usando chave *independente* (32–64 bytes de entropia, base64 no runtime privado) sobre bytes exatos:
```
coda-sync-v1\n<Timestamp>\n<Raw-JSON-UTF8>
```

Exemplo inteiramente sintético de corpo (nenhum nome, telefone ou ID de cliente):
```json
{
  "version": 1,
  "source": "coda",
  "eventId": "evo:funix_comercial:synthetic-message-1",
  "codaRowId": "i-SYNTH_A",
  "instance": "funix_comercial",
  "remoteJid": "5531999990001@s.whatsapp.net",
  "phoneE164": "+5531999990001",
  "displayName": "Contato Sintético",
  "occurredAt": 1794144000
}
```

A chave da Evolution **nunca** é usada neste endpoint. Nomes e telefones devem passar somente pelos canais privados autorizados, nunca por comentários de CI ou logs públicos.

A flag `FUNIX_CODA_SYNC_ENABLED=true` e a configuração privada `FUNIX_CODA_SYNC_HMAC_KEY_BASE64` são exigidas em conjunto. Sem a flag, nenhuma tabela `coda_sync_*` é criada e a rota devolve 404. **Não ativar sem aprovação específica e backup atualizado.**

## Idempotência e escopo

- `eventId` é a identificação estável de *um evento recebido*, não gerada aleatoriamente em cada retry. O mesmo ID com conteúdo idêntico é recebido novamente sem criar Atendimento; conteúdo divergente no mesmo ID é conflito 409.
- `codaRowId` é a única chave canônica Coda→Atendimento; uma linha Coda corresponde a um único UUID local. **Não deduplicar por nome, placa ou telefone.**
- Relacionamentos são por instância e JID exatos: **PN e LID não são fundidos automaticamente**, mesmo quando visualmente parecidos.
- A mesma conversa pode ter Atendimentos diferentes ao longo do tempo; a associação histórica é preservada, e o contexto ativo se atualiza só para um evento mais recente (ordenação determinística por ocorrido/eventId).
- Todos os inserts do Atendimento, relação Coda, vínculo de conversa e receipt estão na mesma transação SQLite. A versão oficial das migrações continua V14.
- Quando um evento chega com um Coda row ID válido mas telefone não comprovado, o Atendimento local pode manter telefone vazio; **não criar telefone fictício**. No entanto, o n8n atual não cria linha Coda com LID-only, portanto este caso exige política/ramo próprio antes de se prometer cobertura universal.

## Comportamento de erro

- 202: receipt confirmado e UUID local devolvido; retorno pode indicar `created` ou `existing`.
- 401/403: assinatura, origem, tempo ou navegador rejeitados; não registrar conteúdo bruto.
- 409: receipt reusado com dados divergentes; investigar, nunca criar outro.
- 422: contrato inválido; é falha de integração, não deve gerar lead fictício.
- 503/timeout/rede: não presumir entrega. Repetir **o mesmo evento com mesmo eventId** após verificar Coda, pois o receptor garante idempotência.
- O n8n atual não foi modificado para enviar/repetir esses eventos. Fila persistente ou reprocessamento de falhas no produtor ainda são pendentes.

## Dependências para operação real

1. Escolher origem canônica de `codaRowId` na ramificação de Atendimento já existente e na criação confirmada.
2. Aprovar comportamento dos contatos `LID` sem PN e das exceções `Não gerar lead`; não falsear CRM.
3. Adaptar o n8n publicado com envio assinado, verificando que chamadas duplicadas/retries são seguras, sem tocar configuração/webhook Evolution.
4. Integrar o resolvedor `atendimentoId` do backend com a UI de atendimento, preservando **histórico Evolution real** na aba Chat. A PR #101 corrige leitura/navegação, mas o `ChatPanel` legado não usa Evolution.
5. Testar e homologar evento → Coda → SQLite → seleção → três abas com QA isolada e depois produção controlada.
6. Backups consistentes, habilitação separada de flags, validação de 404 quando OFF, aprovação de deploy e procedimento de desligamento sem perda de histórico.

**Este documento não é uma instrução de ativação produtiva.**
