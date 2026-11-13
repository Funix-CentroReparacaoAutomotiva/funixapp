import { randomUUID, createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ReadChat, ReadMessage } from '../experimental/evolution-read/client.ts'
import { EvolutionReadError } from '../experimental/evolution-read/client.ts'
import { ServiceError } from '../errors.ts'
import type { ChatReceipt } from '../../shared/chat.ts'
import type {
  ConversationIdentities,
  ConversationAssociationReader,
} from './conversation-identities.ts'
import { parseConversationEvent, type ConversationEvent } from './conversation-event.ts'

const instance = 'funix_comercial'
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const conflict = (): never => {
  throw new ServiceError(
    409,
    'CHAT_IDENTITY_CONFLICT',
    'Conversa com dados conflitantes; solicite revisão.',
  )
}
/** Additive metadata on the existing chat inbox/messages. No binary media or second event queue. */
export function createConversationStoreSchema(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS chat_message_state (
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id), message_id TEXT NOT NULL,
      revision_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, statuses TEXT NOT NULL DEFAULT '[]', content_available INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(conversation_id,message_id));
      CREATE TABLE IF NOT EXISTS chat_conversation_coverage (
      conversation_id TEXT PRIMARY KEY REFERENCES chat_conversations(id),
      display_name TEXT, updated_at TEXT, last_provider_sync TEXT, provider_error TEXT);`)
    if (
      !db
        .prepare('PRAGMA table_info(chat_message_state)')
        .all()
        .some((row) => row.name === 'content_available')
    )
      db.exec(
        'ALTER TABLE chat_message_state ADD COLUMN content_available INTEGER NOT NULL DEFAULT 1',
      )
    // Technical registration is explicit under the local-storage opt-in. HMAC/allowlist remain mandatory.
    db.prepare('INSERT OR IGNORE INTO chat_instances VALUES(?,?)').run(
      instance,
      '1970-01-01T00:00:00.000Z',
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
export class ConversationStore {
  readonly db: DatabaseSync
  readonly identities: ConversationIdentities & ConversationAssociationReader
  private readonly now: () => string
  constructor(
    db: DatabaseSync,
    identities: ConversationIdentities & ConversationAssociationReader,
    now = () => new Date().toISOString(),
  ) {
    this.db = db
    this.identities = identities
    this.now = now
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = run()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  private ensure(jid: string): string {
    const handle = this.identities.rememberProviderConversation(jid)
    this.db
      .prepare('INSERT OR IGNORE INTO chat_conversations(id,instance,remote_jid) VALUES(?,?,?)')
      .run(handle, instance, jid)
    const id = String(
      this.db
        .prepare('SELECT id FROM chat_conversations WHERE instance=? AND remote_jid=?')
        .get(instance, jid)!.id,
    )
    this.db
      .prepare('INSERT OR IGNORE INTO chat_conversation_coverage(conversation_id) VALUES(?)')
      .run(id)
    return id
  }
  observeChats(rows: ReadChat[]) {
    this.transaction(() => {
      for (const row of rows) {
        const id = this.ensure(row.remoteJid)
        this.db
          .prepare(
            'UPDATE chat_conversation_coverage SET display_name=COALESCE(?,display_name),updated_at=COALESCE(?,updated_at) WHERE conversation_id=?',
          )
          .run(row.displayName, row.updatedAt, id)
      }
    })
  }
  list(skip = 0) {
    return this.db
      .prepare(
        `SELECT c.remote_jid,s.display_name,s.updated_at FROM chat_conversation_coverage s
    JOIN chat_conversations c ON c.id=s.conversation_id WHERE c.instance=? ORDER BY COALESCE(s.updated_at,'') DESC,c.id LIMIT 50 OFFSET ?`,
      )
      .all(instance, skip)
      .map((r) => ({
        remoteJid: String(r.remote_jid),
        displayName: r.display_name === null ? null : String(r.display_name),
        phoneNumber: String(r.remote_jid).endsWith('@s.whatsapp.net')
          ? String(r.remote_jid).split('@')[0]!
          : null,
        updatedAt: r.updated_at === null ? null : String(r.updated_at),
        unreadCount: null,
      }))
  }
  private write(
    jid: string,
    message: Pick<
      ReadMessage,
      'messageId' | 'timestamp' | 'fromMe' | 'kind' | 'text' | 'media' | 'statuses'
    >,
    at: string,
    mode: 'snapshot' | 'message.upsert' | 'message.edit',
  ) {
    const id = this.ensure(jid),
      mid = message.messageId
    const members = this.identities.identityJids(jid) ?? [jid]
    const copies = this.db
      .prepare(
        `SELECT m.from_me,m.occurred_at FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE c.instance=? AND c.remote_jid IN (${members.map(() => '?').join(',')}) AND m.message_id=?`,
      )
      .all(instance, ...members, mid)
    if (copies.some((row) => (row.from_me === 1) !== message.fromMe)) conflict()
    const existing = this.db
      .prepare(
        'SELECT m.*,s.revision_at,s.deleted,s.statuses,s.content_available FROM chat_messages m LEFT JOIN chat_message_state s ON s.conversation_id=m.conversation_id AND s.message_id=m.message_id WHERE m.conversation_id=? AND m.message_id=?',
      )
      .get(id, mid)
    const content = {
      fromMe: message.fromMe,
      kind: message.kind,
      text: message.text,
      media: message.media
        ? { mimeType: message.media.mimeType, bytes: message.media.bytes }
        : null,
    }
    const digest = hash(content)
    const state = this.db
      .prepare('SELECT * FROM chat_message_state WHERE conversation_id=? AND message_id=?')
      .get(id, mid)
    const statuses = JSON.stringify(
      [
        ...new Set([...(state ? JSON.parse(String(state.statuses)) : []), ...message.statuses]),
      ].sort(),
    )
    if (state?.deleted) {
      this.db
        .prepare(
          'UPDATE chat_message_state SET statuses=? WHERE conversation_id=? AND message_id=?',
        )
        .run(statuses, id, mid)
      return
    }
    const snapshotEdit = mode === 'snapshot' && message.statuses.includes('EDITED')
    const currentVersion = String(state?.revision_at || existing?.occurred_at || '')
    // Evolution 2.3.7 stores an edit timestamp in messageTimestamp. A missing
    // edited body hides the stale copy without treating it as a WhatsApp deletion.
    if (existing && snapshotEdit && at > currentVersion && message.kind === 'unsupported') {
      this.db
        .prepare(
          'INSERT INTO chat_message_state(conversation_id,message_id,revision_at,deleted,statuses,content_available) VALUES(?,?,?,0,?,0) ON CONFLICT(conversation_id,message_id) DO UPDATE SET revision_at=excluded.revision_at,statuses=excluded.statuses,content_available=0',
        )
        .run(id, mid, at, statuses)
      return
    }
    // Snapshot reads never overwrite a live edit, nor manufacture deletion from null content.
    const replace =
      existing &&
      ((mode === 'message.edit' && at > String(existing.revision_at ?? '')) ||
        (snapshotEdit &&
          message.kind !== 'unsupported' &&
          (at > currentVersion || (at === currentVersion && state?.content_available === 0))) ||
        (mode === 'snapshot' &&
          !state?.revision_at &&
          existing.kind === 'unsupported' &&
          existing.text === null &&
          message.kind !== 'unsupported'))
    if (
      existing &&
      mode !== 'snapshot' &&
      !replace &&
      at === String(existing.revision_at) &&
      existing.content_digest !== digest
    )
      conflict()
    if (existing && mode !== 'snapshot' && (existing.from_me == 1) !== message.fromMe) conflict()
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO chat_messages(conversation_id,message_id,content_digest,occurred_at,received_at,from_me,origin,kind,text,media,link_id) VALUES(?,?,?,?,?,?,'unknown',?,?,?,NULL)`,
        )
        .run(
          id,
          mid,
          digest,
          new Date(message.timestamp * 1000).toISOString(),
          this.now(),
          message.fromMe ? 1 : 0,
          message.kind,
          message.text,
          JSON.stringify(content.media),
        )
    } else if (replace) {
      this.db
        .prepare(
          'UPDATE chat_messages SET content_digest=?,kind=?,text=?,media=? WHERE conversation_id=? AND message_id=?',
        )
        .run(digest, message.kind, message.text, JSON.stringify(content.media), id, mid)
    }
    const revision =
      mode === 'snapshot'
        ? snapshotEdit && replace
          ? at
          : (state?.revision_at ?? '')
        : !existing || replace
          ? at
          : (state?.revision_at ?? at)
    this.db
      .prepare(
        'INSERT INTO chat_message_state(conversation_id,message_id,revision_at,deleted,statuses,content_available) VALUES(?,?,?,0,?,?) ON CONFLICT(conversation_id,message_id) DO UPDATE SET revision_at=excluded.revision_at,statuses=excluded.statuses,content_available=excluded.content_available',
      )
      .run(
        id,
        mid,
        revision,
        statuses,
        !existing || replace
          ? message.kind === 'unsupported'
            ? 0
            : 1
          : Number(state?.content_available ?? 1),
      )
  }
  /** Provider parser has already validated every row/instance before this atomic projection. */
  observePage(jid: string, messages: ReadMessage[], page: number) {
    this.transaction(() => {
      this.identities.rememberProviderAliases(messages, true, 'findMessages')
      if (this.identities.identityState(jid) === 'identity_conflict') return
      for (const m of messages)
        this.write(m.remoteJid, m, new Date(m.timestamp * 1000).toISOString(), 'snapshot')
      const id = this.ensure(jid)
      this.db
        .prepare(
          'UPDATE chat_conversation_coverage SET last_provider_sync=?,provider_error=NULL WHERE conversation_id=?',
        )
        .run(this.now(), id)
      // A final offset page does NOT prove a complete historical snapshot.
      void page
    })
  }
  providerFailure(jid: string) {
    const id = this.ensure(jid)
    this.db
      .prepare(
        "UPDATE chat_conversation_coverage SET provider_error='UNAVAILABLE' WHERE conversation_id=?",
      )
      .run(id)
  }
  ingest(raw: string): ChatReceipt {
    const e = parseConversationEvent(raw)
    if (e.instance !== instance)
      throw new ServiceError(403, 'WHATSAPP_INSTANCE_DENIED', 'Instância não habilitada.')
    if (Date.parse(e.occurredAt) > Date.parse(this.now()) + 300000)
      throw new ServiceError(422, 'CHAT_FUTURE_EVENT', 'Horário do evento inválido.')
    return this.transaction(() => {
      const digest = hash({ ...e, displayName: undefined }),
        prior = this.db
          .prepare('SELECT * FROM chat_events WHERE instance=? AND event_id=?')
          .get(instance, e.eventId)
      if (prior) {
        if (prior.digest !== digest) conflict()
        return {
          receiptId: String(prior.receipt_id),
          eventId: e.eventId,
          state: 'persisted',
          disposition: prior.disposition,
        } as ChatReceipt
      }
      this.identities.rememberProviderAliases([e.message], true, 'webhook')
      const identity = this.identities.identityState(e.message.remoteJid)
      let disposition: ChatReceipt['disposition'] =
        identity === 'linked'
          ? 'projected'
          : identity === 'missing_confirmation'
            ? 'pending'
            : 'quarantined'
      const id = this.ensure(e.message.remoteJid)
      if (e.displayName)
        this.db
          .prepare('UPDATE chat_conversation_coverage SET display_name=? WHERE conversation_id=?')
          .run(e.displayName, id)
      if (disposition !== 'quarantined') this.apply(e, id)
      const receiptId = randomUUID()
      this.db
        .prepare(
          'INSERT INTO chat_events(instance,event_id,digest,receipt_id,occurred_at,received_at,disposition,reason,payload) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          instance,
          e.eventId,
          digest,
          receiptId,
          e.occurredAt,
          this.now(),
          disposition,
          disposition === 'quarantined' ? identity : null,
          disposition === 'quarantined'
            ? null
            : JSON.stringify({
                schemaVersion: e.schemaVersion,
                eventId: e.eventId,
                instance: e.instance,
                type: e.type,
                occurredAt: e.occurredAt,
                message: {
                  remoteJid: e.message.remoteJid,
                  remoteJidAlt: e.message.remoteJidAlt,
                  messageId: e.message.messageId,
                },
              }),
        )
      return { receiptId, eventId: e.eventId, state: 'persisted', disposition }
    })
  }
  private apply(e: ConversationEvent, id: string) {
    const m = e.message,
      prior = this.db
        .prepare('SELECT * FROM chat_message_state WHERE conversation_id=? AND message_id=?')
        .get(id, m.messageId)
    if (e.type === 'message.delete') {
      if (!prior || e.occurredAt >= String(prior.revision_at)) {
        this.db
          .prepare(
            "INSERT INTO chat_message_state(conversation_id,message_id,revision_at,deleted,statuses) VALUES(?,?,?,1,'[]') ON CONFLICT(conversation_id,message_id) DO UPDATE SET revision_at=excluded.revision_at,deleted=1",
          )
          .run(id, m.messageId, e.occurredAt)
        this.db
          .prepare(
            "UPDATE chat_messages SET kind='unsupported',text=NULL,media=NULL WHERE conversation_id=? AND message_id=?",
          )
          .run(id, m.messageId)
      }
    } else if (e.type === 'message.status') {
      const states = JSON.stringify(
        [
          ...new Set([...(prior ? JSON.parse(String(prior.statuses)) : []), ...(m.statuses ?? [])]),
        ].sort(),
      )
      this.db
        .prepare(
          "INSERT INTO chat_message_state(conversation_id,message_id,revision_at,deleted,statuses) VALUES(?,?,'',0,?) ON CONFLICT(conversation_id,message_id) DO UPDATE SET statuses=excluded.statuses",
        )
        .run(id, m.messageId, states)
    } else {
      const media = m.media
        ? {
            ...m.media,
            reference: JSON.stringify([instance, m.messageId, m.kind]),
            available: false as const,
          }
        : null
      this.write(
        m.remoteJid,
        {
          messageId: m.messageId,
          timestamp: m.timestamp!,
          fromMe: m.fromMe!,
          kind: m.kind!,
          text: m.text!,
          media,
          statuses: m.statuses ?? [],
        },
        e.occurredAt,
        e.type,
      )
    }
    this.db
      .prepare(
        'UPDATE chat_conversation_coverage SET updated_at=CASE WHEN updated_at IS NULL OR updated_at<? THEN ? ELSE updated_at END WHERE conversation_id=?',
      )
      .run(e.occurredAt, e.occurredAt, id)
  }
  health(jid: string) {
    const members = this.identities.identityJids(jid) ?? [jid]
    const rows = this.db
      .prepare(
        `SELECT s.* FROM chat_conversation_coverage s JOIN chat_conversations c ON c.id=s.conversation_id WHERE c.instance=? AND c.remote_jid IN (${members.map(() => '?').join(',')})`,
      )
      .all(instance, ...members)
    const synced =
      rows
        .map((r) => (r.last_provider_sync === null ? null : String(r.last_provider_sync)))
        .filter((v): v is string => v !== null)
        .sort()
        .at(-1) ?? null
    return {
      lastProviderSync: synced,
      providerUnavailable: rows.some((r) => r.provider_error !== null),
    }
  }
  page(jid: string, page: number, cursor?: string) {
    const members = this.identities.identityJids(jid)
    if (!members) throw new EvolutionReadError('CONFLICT')
    const token = this.identities.contextToken(jid),
      scope = hash([members, token])
    const placeholders = members.map(() => '?').join(',')
    const base = `FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id LEFT JOIN chat_message_state s ON s.conversation_id=m.conversation_id AND s.message_id=m.message_id WHERE c.instance=? AND c.remote_jid IN (${placeholders})`
    const ceiling = Number(
      this.db.prepare(`SELECT COALESCE(MAX(m.sequence),0) AS n ${base}`).get(instance, ...members)!
        .n,
    )
    let limitSequence = ceiling,
      beforeTime = '9999',
      beforeSequence = Number.MAX_SAFE_INTEGER
    if (cursor) {
      let x: unknown
      try {
        x = JSON.parse(Buffer.from(cursor, 'base64url').toString())
      } catch {
        throw new ServiceError(400, 'CHAT_INVALID_CURSOR', 'Atualize a conversa.')
      }
      if (
        !Array.isArray(x) ||
        x.length !== 5 ||
        x[0] !== scope ||
        typeof x[1] !== 'string' ||
        !Number.isSafeInteger(x[2]) ||
        !Number.isSafeInteger(x[3]) ||
        x[4] !== page ||
        x[2] < 1 ||
        x[3] < 0
      )
        throw new ServiceError(
          409,
          'CHAT_CONTEXT_CHANGED',
          'O contexto mudou. Atualize a conversa.',
        )
      beforeTime = x[1]
      beforeSequence = x[2]
      limitSequence = x[3]
    } else if (page !== 1)
      throw new ServiceError(400, 'CHAT_CURSOR_REQUIRED', 'Atualize a conversa antes de paginar.')
    const sameVersionConflict = this.db
      .prepare(
        `SELECT 1 ${base} AND m.sequence<=? AND COALESCE(s.content_available,1)=1 GROUP BY m.message_id,COALESCE(s.revision_at,'') HAVING COUNT(DISTINCT json_array(m.from_me,m.kind,m.text,m.occurred_at))>1 LIMIT 1`,
      )
      .get(instance, ...members, limitSequence)
    if (sameVersionConflict) throw new EvolutionReadError('CONFLICT')
    const total = Number(
      this.db
        .prepare(`SELECT COUNT(DISTINCT m.message_id) AS n ${base} AND m.sequence<=?`)
        .get(instance, ...members, limitSequence)!.n,
    )
    const candidates = this.db
      .prepare(
        `WITH ranked AS (
      SELECT m.*,s.statuses,s.deleted,s.revision_at,s.content_available,
      ROW_NUMBER() OVER(PARTITION BY m.message_id ORDER BY COALESCE(s.revision_at,'') DESC,COALESCE(s.content_available,1) ASC,m.sequence DESC) AS version_rank
      ${base} AND m.sequence<=?) SELECT * FROM ranked WHERE version_rank=1 AND
      (occurred_at<? OR (occurred_at=? AND sequence<?)) ORDER BY occurred_at DESC,sequence DESC LIMIT 51`,
      )
      .all(instance, ...members, limitSequence, beforeTime, beforeTime, beforeSequence)
    const selected = candidates.slice(0, 50),
      last = selected.at(-1)
    const nextCursor =
      candidates.length > 50 && last
        ? Buffer.from(
            JSON.stringify([
              scope,
              String(last.occurred_at),
              Number(last.sequence),
              limitSequence,
              page + 1,
            ]),
          ).toString('base64url')
        : null
    return {
      items: selected.reverse().map((r) => ({
        messageId: String(r.message_id),
        timestamp: Date.parse(String(r.occurred_at)) / 1000,
        fromMe: r.from_me === 1,
        origin: 'unknown' as const,
        kind: (r.content_available === 0 ? 'unsupported' : r.kind) as ReadMessage['kind'],
        text: r.content_available === 0 || r.text === null ? null : String(r.text),
        media:
          r.content_available !== 0 && r.media && r.media !== 'null'
            ? { reference: 'local', ...JSON.parse(String(r.media)), available: false }
            : null,
        statuses: r.statuses ? JSON.parse(String(r.statuses)) : [],
      })),
      page,
      reportedTotal: total,
      reportedPages: Math.ceil(total / 50),
      nextPage: nextCursor ? page + 1 : null,
      nextCursor,
      consistency: 'local-keyset' as const,
      historyComplete: 'unknown' as const,
      source: 'local' as const,
    }
  }
}
