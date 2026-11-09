# FUNIX — proposta de emissor n8n Coda → FunixApp (somente desenvolvimento)

Estado: documentação de implementação, **não instalada no n8n**; nenhuma configuração, execução ou deploy de produção.

## Workflow consultado, somente leitura

`FUNIX | WhatsApp | Classificar contatos | PROD`, id `21wpOido7t5OHb7i`.
Gatilho `messages.upsert` → extração de `fx_UUID`, `whatsappJid`, `telefoneE164` →
verificação de opção `Não gerar lead` → consulta `Get all rows` →
decisão `Code in JavaScript1`:
- `criarCard=false`, `idsAbertos`: Atendimento existente;
- `criarCard=true`, `Create a row`: novo Atendimento.

O fluxo ativo não pode ser editado para testar esse emissor. Implementar em clone
desativado com dados sintéticos, após aprovação de credenciais e de ambiente,
sem tocar no webhook Evolution nem publicar o clone.

## Regra do emissor

1. **Não emitir** se `Não gerar lead` bloqueou, a mensagem não tem JID PN
   verificável, faltou `fx_UUID`, o Coda falhou ou a classificação não terminou.
2. **Existente:** usar uma **única linha Coda canônica** confirmada para o
   Atendimento vigente. Não escolher arbitrariamente entre `idsAbertos`.
   Se houver zero ou mais de uma linha candidata, registrar pendência sem emissão.
3. **Criado:** `Create a row` não é confirmação suficiente quando o Coda
   responde assincronamente. Consultar novamente por `fx_UUID` e obter o
   `id` real `i-...`, verificando correspondência unívoca.
4. Em ambos os casos, enviar o evento **somente depois da confirmação de leitura**
   do registro canônico, com `codaRowId` imutável.
5. Construir `eventId` determinístico a partir da identidade do evento original
   (para o mesmo evento recebido, o mesmo `eventId` em toda tentativa).
   Usar `fx_UUID` somente se passar pelo contrato de formato/limite.
6. `instance` deve ser exatamente `funix_comercial`; `remoteJid` deve ser
   o PN verificado; `phoneE164` deve corresponder ao mesmo contato, não ser
   inferido de um LID. `occurredAt` é o timestamp da mensagem original
   em segundos Unix, não a hora de processamento.
7. Corpo deve conter exatamente os nove campos definidos no contrato;
   não enviar payloads de mensagens, chave da Evolution ou dados extras.

## Autenticação e entrega

- URL privada definida por configuração do ambiente de desenvolvimento.
- HMAC SHA256 sobre **bytes exatos** `coda-sync-v1\n<Timestamp>\n<Raw-JSON-UTF8>`.
  `X-Funix-Timestamp` em segundos; `X-Funix-Signature` como `sha256=<hex>`.
- Segredo independente em credencial restrita; nunca expor em expressions, logs,
  documentação, execuções públicas ou histórico do workflow.
- A serialização e a assinatura devem usar o **mesmo Buffer UTF-8**, sem
  transformação do JSON depois de assinar.
- 202 confirma receipt; 409/422 exigem investigação sem criar nova linha;
  401/403 exigem checagem de configuração/assinatura.
- Para timeout/rede/503, reenviar **o mesmo evento** com o mesmo `eventId`,
  consultando o Coda antes do retry.
- Para sobreviver a interrupção entre confirmação Coda e envio, prever outbox
  durável com status, tentativas, próxima tentativa e confirmação do receipt.
  Não considerar um Wait node isolado mecanismo de entrega garantida.
- Não emitir evento para a mesma conversa com dois Coda IDs no mesmo timestamp
  sem resolver explicitamente qual Atendimento é o ativo.

## Gates para testes

- Testes de dois caminhos: Coda existente e criação confirmada.
- Sem lead: zero chamadas ao FunixApp.
- Falha/atraso Coda: zero chamadas até linha canônica verificada.
- Evento repetido 20x: um Atendimento local.
- Evento atrasado/concorrente: mantém contexto mais recente sem mistura.
- Teste de credenciais sintéticas, assinatura, clock skew, retries e outbox.
- PN/LID: sem conversão ou associação automática não verificável.
- Testes de UI em 320/390/1440 px; sem mensagens ou contatos reais.

## Observações específicas da revisão

`Code in JavaScript` gera `fx_UUID`, telefone e JID PN; atualmente descarta
LID-only. `Code in JavaScript1` calcula `idsAbertos` mas não confirma
univocidade do registro antes de eventual envio. `Create a row` utiliza
`keyColumns: fx_UUID`. Há `Wait` de 20 segundos, mas isso sozinho não
comprova persistência e não substitui leitura de confirmação.

É necessário resolver essas lacunas antes de introduzir o emissor no n8n.

## Protótipo isolado do emissor (08/11/2026)

- Workflow n8n criado em **projeto pessoal, desativado e não publicado**: `OonRBjcVIbqUCvZf`, título `FUNIX | DEV | Coda → FunixApp | Ensaio sem envio (OFF)`.
- Quatro nós: gatilho manual, gerador sintético, validador de elegibilidade e auditoria. Sem credenciais, webhook, Coda, HTTP Request ou chamadas externas.
- Ensaio n8n `37353`: **sucesso**, 9 cenários sintéticos, 2 elegíveis para futura assinatura, 7 bloqueados.
- Casos elegíveis: `existente_confirmado` e `criado_confirmado`. Exceções bloqueadas: `NAO_GERAR_LEAD`, `CODA_NOT_CONFIRMED`, `CODA_ROW_NOT_UNIQUE`, `PN_NOT_VERIFIED`, `CODA_ROW_NOT_CANONICAL`, `EVENT_ID_INVALID`, `CREATE_CONFIRMATION_MISMATCH`.
- O ensaio apenas verifica uma **leitura Coda simulada** e serializa payload JSON de nove campos. **Não envia, não calcula HMAC com segredo, não persiste outbox, não faz retry, não prova confirmação real no Coda**. Não apresentar este ensaio como integração funcional.
- Workflow de produção `21wpOido7t5OHb7i` foi consultado apenas em leitura e permanece sem alterações realizadas nesta etapa.

### Próximos critérios de aceitação antes de qualquer ligação a sistemas reais

1. Revalidar linha canônica diretamente no Coda após a gravação, com regra determinística para `fx_UUID` e eventuais múltiplos Atendimentos abertos; a flag de criação sozinha não serve como confirmação.
2. Definir fila de saída durável e retomada de falhas, com `eventId` estável e recibo `202`; tratar `409/422` como investigação, não como motivo para criar outro Atendimento.
3. Construir assinatura HMAC-SHA256 usando bytes exatos de JSON e segredo segregado, armazenado em credencial segura; não usar expressões que exponham a chave em dados de execução.
4. Testar em destino **privado de desenvolvimento**, com credenciais sintéticas e sem copiar registros de clientes ou conectar o webhook de produção.
5. Validar que o workflow de origem continua ativo e inalterado; só então propor a alteração real com aprovação independente de ativação.
