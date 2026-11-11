import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ConfirmedCodaEvent } from './coda-sync.ts'

/**
 * DEVELOPMENT-ONLY reference implementation of a durable Coda event producer.
 * It does not run in production and does not contact Coda/Evolution/FunixApp.
 * The eventual n8n emitter needs equivalent persistence and recovery.
 */
export type DeliveryState = 'pending' | 'leased' | 'delivered' | 'quarantined'
export type DeliveryReceipt = { eventId: string; status: 202 | 409 | 422 | 401 | 403 | 429 | 500 | 502 | 503 | 504 | 0 }
type DbRow = {
  event_id: string; digest: string; body: string; state: string
  attempts: number; next_attempt_at: number; lease_until: number
}
const eventPattern = /^[A-Za-z0-9:_-]{1,160}$/
const rowPattern = /^i-[A-Za-z0-9_-]{1,100}$/
const jidPattern = /^(?:[0-9]{8,15}@s\.whatsapp\.net|[A-Za-z0-9_-]{1,100}@lid)$/

export function createDevelopmentOutboxSchema(db: DatabaseSync) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS dev_coda_sync_outbox (',
    ' event_id TEXT PRIMARY KEY, coda_row_id TEXT NOT NULL,',
    ' digest TEXT NOT NULL, body TEXT NOT NULL,',
    " state TEXT NOT NULL CHECK(state IN ('pending','leased','delivered','quarantined')),",
    ' attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),',
    ' next_attempt_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0,',
    " last_failure TEXT NOT NULL DEFAULT '',",
    " delivered_at INTEGER, created_at INTEGER NOT NULL,",
    ' CHECK ((state = \'delivered\') = (delivered_at IS NOT NULL)));',
    'CREATE INDEX IF NOT EXISTS dev_coda_outbox_due ON dev_coda_sync_outbox(state,next_attempt_at,lease_until);',
  ].join('\n'))
}

function validatedEvent(event: ConfirmedCodaEvent) {
  if (event.version !== 1 || event.source !== 'coda' || event.instance !== 'funix_comercial' ||
      !eventPattern.test(event.eventId) || !rowPattern.test(event.codaRowId) ||
      !jidPattern.test(event.remoteJid) ||
      !Number.isSafeInteger(event.occurredAt) ||
      typeof event.displayName !== 'string' || event.displayName.length > 250 ||
      (event.phoneE164 !== null && (typeof event.phoneE164 !== 'string' ||
        !/^\+[1-9][0-9]{7,14}$/.test(event.phoneE164))) ||
      (event.remoteJid.endsWith('@s.whatsapp.net') && event.phoneE164 !== null &&
       event.phoneE164 !== '+' + event.remoteJid.split('@')[0])) {
    throw new Error('OUTBOX_INVALID_EVENT')
  }
}
function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const result = action(); db.exec('COMMIT'); return result }
  catch(error) { db.exec('ROLLBACK'); throw error }
}
function digest(body: string) { return createHash('sha256').update(body).digest('hex') }
export class DevelopmentCodaOutbox {
  private readonly db: DatabaseSync
  constructor(db: DatabaseSync) { this.db = db }

  /** Only a Coda-confirmed WhatsApp-generated row may be enqueued.
   * Manual records are deliberately excluded, and never inferred by phone.
   */
  enqueue(event: ConfirmedCodaEvent, source: 'whatsapp', confirmedRowId: string, nowMs: number) {
    if (source !== 'whatsapp' || event.codaRowId !== confirmedRowId || !Number.isSafeInteger(nowMs) || nowMs < 0)
      throw new Error('OUTBOX_UNCONFIRMED_SOURCE')
    validatedEvent(event)
    const body = JSON.stringify(event), hash = digest(body)
    return transaction(this.db, () => {
      const existing = this.db.prepare('SELECT digest FROM dev_coda_sync_outbox WHERE event_id=?').get(event.eventId) as {digest:string}|undefined
      if (existing) {
        if (existing.digest !== hash) throw new Error('OUTBOX_EVENT_CONFLICT')
        return 'existing' as const
      }
      this.db.prepare('INSERT INTO dev_coda_sync_outbox(event_id,coda_row_id,digest,body,state,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,' +
        "'pending',0,?,?)").run(event.eventId, event.codaRowId, hash, body, nowMs, nowMs)
      return 'created' as const
    })
  }

  /** Reclaim crashed workers only after their lease expires, using one transaction. */
  claim(nowMs: number, leaseMs: number) {
    if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 600000)
      throw new Error('OUTBOX_INVALID_LEASE')
    return transaction(this.db, () => {
      const row = this.db.prepare([
        "SELECT * FROM dev_coda_sync_outbox WHERE (state='pending' AND next_attempt_at<=?)",
        " OR (state='leased' AND lease_until<=?) ORDER BY next_attempt_at,event_id LIMIT 1",
      ].join('')).get(nowMs, nowMs) as DbRow|undefined
      if (!row) return null
      const nextAttempts = row.attempts + 1
      this.db.prepare("UPDATE dev_coda_sync_outbox SET state='leased',attempts=?,lease_until=? WHERE event_id=?")
        .run(nextAttempts,nowMs+leaseMs,row.event_id)
      return { eventId:row.event_id, body:row.body, attempts:nextAttempts, leaseUntil:nowMs+leaseMs }
    })
  }

  /** Ignore late responses from an expired attempt (fencing by attempt+lease). */
  complete(claim: {eventId:string;attempts:number;leaseUntil:number}, status: DeliveryReceipt['status'], nowMs: number) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('OUTBOX_INVALID_CLOCK')
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT * FROM dev_coda_sync_outbox WHERE event_id=?').get(claim.eventId) as DbRow|undefined
      if (!row || row.state !== 'leased' || row.attempts !== claim.attempts || row.lease_until !== claim.leaseUntil || nowMs > row.lease_until)
        return 'stale' as const
      if (status === 202) {
        this.db.prepare("UPDATE dev_coda_sync_outbox SET state='delivered',delivered_at=?,lease_until=0,last_failure='' WHERE event_id=?")
          .run(nowMs, claim.eventId)
        return 'delivered' as const
      }
      const retryable = status === 0 || status === 429 || status >= 500
      const terminal = !retryable || claim.attempts >= 8
      // Deterministic bounded backoff; scheduler may add jitter at its edge.
      const waitMs = Math.min(15*60_000,30_000 * 2**Math.min(claim.attempts-1,5))
      this.db.prepare('UPDATE dev_coda_sync_outbox SET state=?,next_attempt_at=?,lease_until=0,last_failure=? WHERE event_id=?')
        .run(terminal?'quarantined':'pending',nowMs+(terminal?0:waitMs),'HTTP_'+status,claim.eventId)
      return terminal?'quarantined' as const:'retry' as const
    })
  }

  stats() {
    const rows = this.db.prepare('SELECT state,COUNT(*) AS total FROM dev_coda_sync_outbox GROUP BY state').all()
    const result: Record<DeliveryState,number> = {pending:0,leased:0,delivered:0,quarantined:0}
    for (const row of rows) result[String(row.state) as DeliveryState] = Number(row.total)
    return result
  }
}
