# FUNIX — Conversas × Funil: contrato de reconciliação (Issue #103)

**Estado:** especificação e desenvolvimento isolado na PR #148. Não há garantia produtiva de reconciliação, nem alteração do n8n/ERP/Coda/Evolution.

## Limite do MVP aprovado

- **Atendimentos manuais do FunixApp e do ERP/Coda são independentes.** Não sincronizar cadastros manuais automaticamente, não usar nome/telefone/placa para fundir registros. O futuro handoff do atendimento criado no FunixApp para produção ocorrerá **somente no agendamento**, por contrato próprio.
- O fluxo **originado em mensagem WhatsApp** continua Evolution → classificador n8n → Coda → evento assinado → vínculo no FunixApp. Não é sincronização geral de registros manuais.
- A conversa é entidade histórica N:N, mas a seleção automática depende do Atendimento comercial **ativo e canônico**, não de telefone coincidente nem da fase local.

## Estado verificável do código

- O receptor `CodaEventSyncRepository` é idempotente por `eventId`, vincula uma linha Coda a exatamente um Atendimento local e preserva histórico por JID exato; possui um único contexto ativo por JID.
- Na PR #148, `GET /api/chat/conversations/:id/active-atendimento` lê, para ID opaco de conversa, o vínculo ativo canônico **no instante do clique**, sem buscar pelo telefone; permite abrir a ficha logo após evento Coda tardio.
- A busca local por telefone da PR #148 é **somente navegação**, não prova de histórico Evolution. O modal de múltiplas fichas locais não equivale a múltiplas oportunidades abertas no Coda.
- Há um emissor HMAC conectado no workflow n8n produtivo `21wpOido7t5OHb7i`. Algumas mensagens podem ser descartadas pelo validador; execução `success` não prova recibo `202` para cada mensagem. Ainda não foi verificada outbox durável nem recuperação completa.

## Contrato de recuperação a implementar

1. Após confirmação de `codaRowId` **originado pelo WhatsApp**, registrar uma intenção de sincronização com `eventId` imutável, referência canônica e estado durável; nunca incluir atendimentos criados manualmente no escopo desse processo.
2. Evitar perda entre gravação Coda e outbox: reconciliador periódico consulta exclusivamente eventos WhatsApp elegíveis confirmados e identifica ausentes. Evitar varredura/espelhamento de todos os cadastros Coda.
3. Em tentativa de entrega, assinar **bytes exatos** `coda-sync-v1\n<Timestamp>\n<RawJSON>` com segredo independente; nova assinatura/timestamp por tentativa; corpo e eventId permanecem iguais.
4. `202` com recibo encerra pendência; timeout/rede/503 entram em retry com backoff e limite; 401/403 suspendem envio até correção; 409/422 entram em quarentena com revisão de dados; nenhum erro pode criar ficha duplicada.
5. Garantir unicidade de intenção e claim concorrente para worker; n8n Data Table de DEV com `get` + `update` não prova claim atômico ou `exactly-once`. Considerar persistência transacional ou reconciliador idempotente e execução serial bem delimitada.
6. PN e LID não podem ser fundidos por inferência, e `Não gerar lead` deve continuar respeitado. Mais de uma oportunidade ativa no Coda exige confirmação de elegibilidade; não decidir apenas pela coluna `stage` local.
7. Métricas sanitizadas: eventos elegíveis, eventos em espera, entregas confirmadas, conflitos, pendências por idade e recuperação. Nunca incluir telefone, JID, nome, mensagem ou segredo em logs/Issues.

## Gate antes de alterar produção

Testar com Coda e FunixApp DEV isolados, eventos sintéticos, duplicação 20x, reordenação, crash/restart, receptor offline, PN/LID, sem lead e múltiplas candidaturas. Verificar backups e rollback, integridade de dados e aprovação separada antes de publicar alterações n8n, banco ou app.

**Não implementado nesta PR:** outbox/reconciliador produtivo, resolução de múltiplos casos comerciais pelo Coda, nem integração de agendamento. Não interpretar um CI verde como essas garantias.


## Revisão adicional em 11/11/2026 — limites comprovados na branch

- A referência DEV agora só considera entrega confirmada quando o transporte retorna **HTTP 202 com corpo de recibo da aplicação** (`status:202`, `state:created|existing`, `atendimentoId` UUID). HTTP 202 sem recibo válido recebe tratamento de falha temporária (retry idempotente); isso impede sucesso falso de proxy/gateway. O endpoint existente do FunixApp produz esses campos.
- A política de elegibilidade DEV deixa de presumir que todo status não encerrado é aberto: status não reconhecido gera `identity_review`. A lista explícita de estados abertos é **provisória**, deve ser validada contra os IDs/status reais do Coda antes de conectar à operação; não autoriza criar/encerrar Atendimento por conta própria.
- Inspeção **somente leitura** do workflow n8n publicado `21wpOido7t5OHb7i` mostrou 55 nós, com evento validado após nova leitura Coda, HMAC e POST já conectados. O nó emissor **não é uma outbox** e a leitura após confirmação não oferece por si só recuperação após crash/reinício. O nome do nó “OFF” não representa seu estado: o nó POST publicado está habilitado. Nenhum nó foi alterado nesta revisão.
- O classificador produtivo detecta oportunidades abertas pelo conjunto de status de encerramento. A política DEV deliberadamente mais conservadora não substitui o classificador publicado; deve-se validar o catálogo real de status para evitar bloqueios indevidos.
- Os exemplos DEV de `fx_UUID` indicam proveniência de evento; **não é um marcador de origem universalmente confiável por si só**. Uma solução produtiva precisa confirmar a cadeia evento recebido → decisão do classificador → linha Coda confirmada, com regra explícita de exclusão de cadastros manuais, e não apenas aceitar correspondência de telefone ou campo vazio.
- Recuperar o intervalo entre gravação no Coda e registro na outbox exige um **reconciliador independente** que consulte registros comprovadamente originados por WhatsApp, com cursor/varredura segura e paginação completa. O `reconcileDevelopmentSnapshot` demonstra idempotência quando recebe uma lista confiável, mas **não coleta** os dados, não inicia periodicamente e não é uma implantação durável no n8n.

**Gate pendente:** contrato persistente da origem no Coda/n8n, mecanismo de varredura e claim seguro, QA com falhas/restart em ambiente DEV integrado, migração operacional e plano de rollback. A PR permanece draft; CI verde dos testes de referência não equivale a esse gate.
