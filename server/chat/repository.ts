import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ChatPage, ChatReceipt, ChatStatus } from '../../shared/chat.ts'
import { ServiceError } from '../errors.ts'
import { digest, identifier, invalid, parseEvent, reliableIdentity, timestamp } from './events.ts'

const statusRank: Record<ChatStatus, number> = { accepted: 1, failed: 2, delivered: 3, read: 4 }
function conflict(): never { throw new ServiceError(409, 'CHAT_CONFLICT', 'Conflito de revisão ou identidade no Chat.') }
function missing(): never { throw new ServiceError(404, 'CHAT_NOT_FOUND', 'Registro de Chat não encontrado.') }

/** Local storage only. No HTTP route, provider, worker, env activation or automatic binding. */
export class ChatRepository {
  readonly db: DatabaseSync
  private readonly now: () => string
  constructor(db: DatabaseSync, now = () => new Date().toISOString()) { this.db = db; this.now = now }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = action(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  /** Explicit registration for isolated tests; application startup never calls this. */
  registerInstance(instance: string, activatedAt: string) {
    if (!identifier(instance, 80) || !timestamp(activatedAt)) return invalid()
    activatedAt = new Date(activatedAt).toISOString()
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT activated_at FROM chat_instances WHERE instance=?').get(instance)
      if (existing && existing.activated_at !== activatedAt) return conflict()
      this.db.prepare('INSERT OR IGNORE INTO chat_instances VALUES(?,?)').run(instance, activatedAt)
    })
  }

  ingest(raw: string): ChatReceipt {
    const event = parseEvent(raw)
    return this.transaction(() => {
      const instance = this.db.prepare('SELECT activated_at FROM chat_instances WHERE instance=?').get(event.instance)
      if (!instance) throw new ServiceError(403, 'CHAT_INSTANCE_DISABLED', 'Instância de Chat não habilitada.')
      const hash = digest(event)
      const existing = this.db.prepare('SELECT * FROM chat_events WHERE instance=? AND event_id=?').get(event.instance, event.eventId)
      if (existing) {
        if (existing.digest !== hash) return conflict()
        return { receiptId: String(existing.receipt_id), eventId: event.eventId, state: 'persisted', disposition: existing.disposition as ChatReceipt['disposition'] }
      }
      const receiptId = randomUUID(), receivedAt = this.now()
      let disposition: ChatReceipt['disposition'] = 'projected', reason: string | null = null
      if (event.occurredAt < String(instance.activated_at)) { disposition = 'before_activation'; reason = 'HISTORICAL_EVENT' }
      else if (!reliableIdentity(event.message.remoteJid, event.message.messageId)) { disposition = 'quarantined'; reason = 'UNRELIABLE_IDENTITY' }
      else if (Date.parse(event.occurredAt) > Date.parse(receivedAt) + 300_000) { disposition = 'quarantined'; reason = 'FUTURE_TIMESTAMP' }
      else {
        const { remoteJid, messageId } = event.message
        this.db.prepare('INSERT OR IGNORE INTO chat_conversations(id,instance,remote_jid) VALUES(?,?,?)').run(randomUUID(), event.instance, remoteJid)
        const conversation = this.db.prepare('SELECT id FROM chat_conversations WHERE instance=? AND remote_jid=?').get(event.instance, remoteJid)!
        const conversationId = String(conversation.id)
        if (event.type === 'message.status') {
          this.db.prepare(`INSERT INTO chat_statuses VALUES(?,?,?,?) ON CONFLICT(conversation_id,message_id)
            DO UPDATE SET status=excluded.status,rank=excluded.rank WHERE excluded.rank>chat_statuses.rank`)
            .run(conversationId, messageId, event.message.status, statusRank[event.message.status])
          // No placeholder message is invented when status arrives first.
          if (!this.db.prepare('SELECT 1 FROM chat_messages WHERE conversation_id=? AND message_id=?').get(conversationId, messageId)) disposition = 'pending'
        } else {
          const contentHash = digest(event.message)
          const previous = this.db.prepare('SELECT content_digest,link_id FROM chat_messages WHERE conversation_id=? AND message_id=?').get(conversationId, messageId)
          if (previous) {
            if (previous.content_digest !== contentHash) { disposition = 'quarantined'; reason = 'MESSAGE_ID_CONFLICT' }
            else if (!previous.link_id) disposition = 'pending'
          } else {
            // Late messages belong to the verified period, never just the latest Atendimento.
            const link = this.db.prepare(`SELECT id FROM chat_links WHERE conversation_id=? AND started_at<=?
              AND (ended_at IS NULL OR ended_at>?)`).get(conversationId, event.occurredAt, event.occurredAt)
            this.db.prepare(`INSERT INTO chat_messages(conversation_id,message_id,content_digest,occurred_at,received_at,from_me,origin,kind,text,media,link_id)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(conversationId, messageId, contentHash, event.occurredAt, receivedAt,
              event.message.fromMe ? 1 : 0, event.message.origin, event.message.kind, event.message.text,
              event.message.media === null ? null : JSON.stringify(event.message.media), link ? String(link.id) : null)
            if (!link) disposition = 'pending'
          }
        }
      }
      // Payloads without reliable identity and historical contents are not retained.
      this.db.prepare(`INSERT INTO chat_events(instance,event_id,digest,receipt_id,occurred_at,received_at,disposition,reason,payload)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(event.instance, event.eventId, hash, receiptId, event.occurredAt, receivedAt, disposition, reason,
          disposition === 'quarantined' || disposition === 'before_activation' ? null : JSON.stringify(event))
      return { receiptId, eventId: event.eventId, state: 'persisted', disposition }
    })
  }

  /** Technical metadata only; pending message content never leaks into an orphan Chat. */
  pending() {
    return this.db.prepare(`SELECT c.id,c.revision,COUNT(m.sequence) AS count FROM chat_conversations c
      JOIN chat_messages m ON m.conversation_id=c.id WHERE m.link_id IS NULL GROUP BY c.id ORDER BY c.id`).all()
      .map(row => ({ conversationId: String(row.id), revision: Number(row.revision), count: Number(row.count) }))
  }

  /** Explicit human decision seam for the next UI PR. No telephone or phase inference. */
  link(input: { conversationId: string; atendimentoId: string; revision: number; requestId: string; actor: string; reason: string; pendingMessageIds: string[] }) {
    if (![input.conversationId, input.atendimentoId, input.requestId, input.actor].every(value => identifier(value)) ||
      !Number.isSafeInteger(input.revision) || input.revision < 0 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500 ||
      !Array.isArray(input.pendingMessageIds) || input.pendingMessageIds.length > 100 ||
      !input.pendingMessageIds.every(value => identifier(value)) || new Set(input.pendingMessageIds).size !== input.pendingMessageIds.length) return invalid()
    return this.transaction(() => {
      const hash = digest(input)
      const receipt = this.db.prepare('SELECT * FROM chat_link_receipts WHERE conversation_id=? AND request_id=?').get(input.conversationId, input.requestId)
      if (receipt) {
        if (receipt.digest !== hash) return conflict()
        return { linkId: String(receipt.link_id), revision: Number(receipt.revision) }
      }
      const conversation = this.db.prepare('SELECT revision FROM chat_conversations WHERE id=?').get(input.conversationId)
      if (!conversation || !this.db.prepare('SELECT 1 FROM atendimentos WHERE id=?').get(input.atendimentoId)) return missing()
      if (Number(conversation.revision) !== input.revision) return conflict()
      const now = this.now(), linkId = randomUUID(), revision = input.revision + 1
      const latest = this.db.prepare('SELECT started_at FROM chat_links WHERE conversation_id=? AND ended_at IS NULL').get(input.conversationId)
      if (latest && String(latest.started_at) >= now) return conflict()
      this.db.prepare('UPDATE chat_links SET ended_at=? WHERE conversation_id=? AND ended_at IS NULL').run(now, input.conversationId)
      this.db.prepare('INSERT INTO chat_links VALUES(?,?,?,?,?,NULL,?,?)').run(linkId, input.conversationId, input.atendimentoId, revision, now, input.actor, input.reason.trim())
      for (const messageId of input.pendingMessageIds) {
        const changed = this.db.prepare('UPDATE chat_messages SET link_id=? WHERE conversation_id=? AND message_id=? AND link_id IS NULL').run(linkId, input.conversationId, messageId)
        if (changed.changes !== 1) return conflict()
      }
      this.db.prepare('UPDATE chat_conversations SET revision=? WHERE id=?').run(revision, input.conversationId)
      this.db.prepare('INSERT INTO chat_link_receipts VALUES(?,?,?,?,?)').run(input.conversationId, input.requestId, hash, linkId, revision)
      return { linkId, revision }
    })
  }

  /** Internal query only. Any future HTTP adapter must enforce session authorization first. */
  messages(atendimentoId: string, options: { cursor?: string; limit?: number } = {}): ChatPage {
    if (!identifier(atendimentoId)) return invalid()
    const limit = options.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return invalid()
    if (!this.db.prepare('SELECT 1 FROM atendimentos WHERE id=?').get(atendimentoId)) return missing()
    let afterTime = '', after = 0, ceiling = Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM chat_messages').get()!.n)
    if (options.cursor !== undefined) {
      if (typeof options.cursor !== 'string' || options.cursor.length > 600) return invalid()
      let cursor: unknown
      try { cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString()) } catch { return invalid() }
      if (!Array.isArray(cursor) || cursor.length !== 4 || cursor[0] !== atendimentoId || !timestamp(cursor[1]) ||
        !Number.isSafeInteger(cursor[2]) || !Number.isSafeInteger(cursor[3]) || cursor[2] < 0 || cursor[3] < cursor[2]) return invalid()
      afterTime = cursor[1]; after = cursor[2]; ceiling = cursor[3]
    }
    const rows = this.db.prepare(`SELECT m.*,s.status FROM chat_messages m JOIN chat_links l ON l.id=m.link_id
      LEFT JOIN chat_statuses s ON s.conversation_id=m.conversation_id AND s.message_id=m.message_id
      WHERE l.atendimento_id=? AND (m.occurred_at>? OR (m.occurred_at=? AND m.sequence>?)) AND m.sequence<=?
      ORDER BY m.occurred_at,m.sequence LIMIT ?`).all(atendimentoId, afterTime, afterTime, after, ceiling, limit + 1)
    const items = rows.slice(0, limit).map(row => ({ sequence: Number(row.sequence), messageId: String(row.message_id),
      occurredAt: String(row.occurred_at), fromMe: row.from_me === 1, origin: row.origin as 'external' | 'unknown',
      kind: row.kind as ChatPage['items'][number]['kind'], text: row.text === null ? null : String(row.text),
      mediaState: row.kind === 'text' ? 'none' as const : 'unavailable' as const, status: row.status === null ? null : row.status as ChatStatus }))
    return { items, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify([atendimentoId, items.at(-1)!.occurredAt, items.at(-1)!.sequence, ceiling])).toString('base64url') : null }
  }
}
