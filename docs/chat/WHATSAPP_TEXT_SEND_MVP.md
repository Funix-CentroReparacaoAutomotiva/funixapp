# FUNIX — Envio de texto WhatsApp no Chat (MVP)

**Escopo:** trazer a função de responder texto do WhatsApp para a ficha de Atendimento do FunixApp. **Não integra IA.** Não altera Coda, n8n, banco SQLite ou pipeline de entrada.

## Funcionalidade

- Chat Evolution existente continua mostrando histórico.
- Quando o servidor está habilitado, a aba Chat oferece campo de texto e botão Enviar.
- O operador digita e envia pelo backend FunixApp diretamente à instância Evolution **já existente**.
- O servidor resolve o JID PN usando exclusivamente a combinação `atendimentoId` + `conversationId` canônica confirmada no Coda. Não aceita número/JID do navegador.
- A chamada ao provedor é **uma tentativa**; se houver erro ou timeout, o aplicativo não reenvia automaticamente, pois o primeiro envio pode ter chegado.
- O envio retorna apenas `state: accepted` e `messageId` sanitizado. A aceitação pela Evolution não prova entrega nem leitura pelo destinatário.
- O campo de texto só aparece quando o backend devolve `sendTextAvailable: true` no histórico canônico. Não aparece no Chat legado nem sem vínculo confirmado.

## Ativação (somente após testes e merge/deploy aprovados)

1. Configurar no runtime da VPS: `FUNIX_EVOLUTION_SEND_ENABLED=true`. Ausente ou `false` significa **desligado**.
2. Permanecem necessários `FUNIX_EVOLUTION_READ_ENABLED=true`, credencial Evolution existente e `FUNIX_CODA_SYNC_ENABLED=true`.
3. Atualizar a API com a configuração efetiva; não há nova credencial nem serviço.
4. Com número controlado, abrir a ficha canônica, enviar uma resposta de texto e conferir a recepção pelo WhatsApp real.
5. Em falha de envio, conferir a conversa antes de clicar novamente.

## Desligamento

Definir `FUNIX_EVOLUTION_SEND_ENABLED=false` no runtime e reiniciar apenas a API, conforme procedimento aprovado. O histórico de leitura deve continuar funcionando.

## Limites deste incremento

Não envia imagens, vídeos, áudio, anexos, mensagens em massa, não usa IA e não implementa dupla garantia de entrega. Mídias recebidas e atualização automática da conversa terão increments próprios.
