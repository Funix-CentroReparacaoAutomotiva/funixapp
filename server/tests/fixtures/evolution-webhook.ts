/** Structural fixture from n8n execution 38949 (read-only inspection).
 * IDs, timestamps, text and display name replaced. The provider database row ID is absent.
 */
export const observedEvolutionUpsert = {
  event: 'messages.upsert',
  instance: 'funix_comercial',
  date_time: '2026-11-01T00:00:00.000Z',
  data: {
    key: {
      id: 'observed-synthetic-id',
      remoteJid: 'observed-synthetic@lid',
      remoteJidAlt: '000000000001@s.whatsapp.net',
      fromMe: false,
      addressingMode: 'lid',
    },
    pushName: 'Cliente Sintético',
    status: 'READ',
    message: { conversation: 'Mensagem sintética recebida' },
    messageType: 'conversation',
    messageTimestamp: 1700000001,
    instanceId: 'synthetic-instance-id',
    source: 'ios',
  },
}
