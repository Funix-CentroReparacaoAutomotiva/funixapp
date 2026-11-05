import type { DatabaseSync } from 'node:sqlite'
import { AtendimentoRepository } from '../../atendimentos.ts'
import { ChatRepository } from '../../chat/repository.ts'
import type { ChatUpsert } from '../../../shared/chat.ts'

/** Explicitly test-only. Never imported by the application bootstrap. */
export function chatReadFixture(db: DatabaseSync) {
  const atendimentos = new AtendimentoRepository(db)
  const a = atendimentos.create({ phone: '000000000', name: 'QA Atendimento A', notes: 'Dados inteiramente sintéticos' })
  const b = atendimentos.create({ phone: '000000000', name: 'QA Atendimento B' })
  const empty = atendimentos.create({ phone: '000000000', name: 'QA Sem mensagens' })
  let now = '2026-11-05T13:00:00.000Z'
  const chat = new ChatRepository(db, () => now)
  chat.registerInstance('synthetic-browser', '2026-11-05T12:00:00Z')
  const ingest = (id: string, text: string, options: Partial<ChatUpsert['message']> = {}) => chat.ingest(JSON.stringify({
    schemaVersion: 1, instance: 'synthetic-browser', eventId: id, occurredAt: now, type: 'message.upsert',
    message: { remoteJid: 'synthetic-browser@lid', messageId: id, fromMe: false, origin: 'unknown', kind: 'text', text, media: null, ...options },
  }))
  const first = 'QA A | primeira mensagem sintética'
  const last = 'QA A | última mensagem sintética'
  const privateB = 'QA B | conteúdo exclusivo sintético'
  ingest('a-0', first)
  const conversationId = chat.pending()[0]!.conversationId
  chat.link({ conversationId, atendimentoId: a.id, revision: 0, requestId: 'test-link-a', actor: 'qa', reason: 'Decisão humana sintética', pendingMessageIds: ['a-0'] })
  for (let index = 1; index < 54; index++) {
    const kind = ({ 8: 'image', 10: 'audio', 12: 'video', 14: 'document' } as const)[index as 8 | 10 | 12 | 14]
    ingest('a-' + index, index === 53 ? last : index === 16 ? '<img src=x onerror="window.chatInjection=true">' : index === 18 ? 'QA A | ' + 'texto_sintético_sem_espaço_'.repeat(30) : `QA A | mensagem sintética ${index}`, {
      fromMe: index % 2 === 1, kind: kind ?? 'text', media: kind ? { ref: 'synthetic-media', mime: kind === 'document' ? 'application/pdf' : `${kind}/synthetic`, bytes: 100 } : null,
    })
  }
  for (const [messageId, status] of [['a-1', 'accepted'], ['a-3', 'delivered'], ['a-5', 'read'], ['a-7', 'failed']]) chat.ingest(JSON.stringify({
    schemaVersion: 1, instance: 'synthetic-browser', eventId: 'status-' + messageId, occurredAt: now,
    type: 'message.status', message: { remoteJid: 'synthetic-browser@lid', messageId, status },
  }))
  now = '2026-11-05T14:00:00.000Z'
  chat.link({ conversationId, atendimentoId: b.id, revision: 1, requestId: 'test-link-b', actor: 'qa', reason: 'Novo período sintético', pendingMessageIds: [] })
  ingest('b-0', privateB)
  ingest('pending', 'PENDENTE PRIVADO SINTÉTICO', { remoteJid: 'unlinked-synthetic@lid' })
  return { a, b, empty, first, last, privateB, count: 54 }
}
