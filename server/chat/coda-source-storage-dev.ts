import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ImmutableWhatsAppSource } from './coda-source-ledger-dev.ts'

/**
 * Durable, append-only reference ledger for the existing FUNIX DEV SQLite.
 * No routes or timers are enabled. Only a trusted authenticated producer may
 * eventually call append(), after opt-out and source verification.
 */
const eventIdPattern = /^evo:funix_comercial:[A-Za-z0-9:_-]{1,128}$/
const jidPattern = /^[0-9]{8,15}@s\.whatsapp\.net$/
const phonePattern = /^\+[1-9][0-9]{7,14}$/
const controlChars = /[\u0000-\u001f\u007f]/
export function createDevelopmentSourceLedgerSchema(db:DatabaseSync) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS dev_whatsapp_source_ledger (',
    ' event_id TEXT PRIMARY KEY, body TEXT NOT NULL, digest TEXT NOT NULL,',
    ' received_at INTEGER NOT NULL CHECK(received_at>=0));',
    'CREATE INDEX IF NOT EXISTS dev_whatsapp_source_received',
    ' ON dev_whatsapp_source_ledger(received_at,event_id);',
  ].join('\n'))
}
function validate(source:ImmutableWhatsAppSource) {
  const allowed=new Set(['eventId','remoteJid','phoneE164','displayName','occurredAt','instance','source','suppressed'])
  if (!source || typeof source!=='object' || Array.isArray(source) ||
      Object.keys(source).length!==allowed.size || Object.keys(source).some(k=>!allowed.has(k)) ||
      source.source !== 'whatsapp' ||
      source.instance !== 'funix_comercial' || source.suppressed !== false ||
      typeof source.eventId !== 'string' || !eventIdPattern.test(source.eventId) ||
      typeof source.remoteJid !== 'string' || !jidPattern.test(source.remoteJid) ||
      typeof source.displayName !== 'string' ||
      source.displayName.length > 250 || controlChars.test(source.displayName) ||
      !Number.isSafeInteger(source.occurredAt) ||
      source.occurredAt < 0 || source.occurredAt > 2147483647 ||
      (source.phoneE164 !== null && (typeof source.phoneE164 !== 'string' ||
      !phonePattern.test(source.phoneE164) ||
      source.phoneE164 !== '+' + source.remoteJid.split('@')[0])))
    throw new Error('SOURCE_LEDGER_INVALID')
}
export class DevelopmentSourceLedger {
  private readonly db: DatabaseSync
  constructor(db: DatabaseSync) { this.db=db }
  append(source:ImmutableWhatsAppSource, nowMs:number):'created'|'existing' {
    validate(source)
    if (!Number.isSafeInteger(nowMs) || nowMs < 0)
      throw new Error('SOURCE_LEDGER_INVALID_TIME')
    const body = JSON.stringify(source)
    const digest = createHash('sha256').update(body).digest('hex')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT digest FROM dev_whatsapp_source_ledger WHERE event_id=?')
        .get(source.eventId) as {digest:string}|undefined
      if (existing) {
        if (existing.digest !== digest) throw new Error('SOURCE_LEDGER_CONFLICT')
        this.db.exec('COMMIT')
        return 'existing'
      }
      this.db.prepare('INSERT INTO dev_whatsapp_source_ledger(event_id,body,digest,received_at) VALUES(?,?,?,?)')
        .run(source.eventId,body,digest,nowMs)
      this.db.exec('COMMIT')
      return 'created'
    } catch(e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  /** Deterministic keyset pagination; never select by phone or name. */
  readPage(afterEventId:string,limit:number):{
    entries:ImmutableWhatsAppSource[]
    nextCursor:string|null
  } {
    if(typeof afterEventId!=='string' || afterEventId.length>160 ||
       !Number.isInteger(limit) || limit<1 || limit>100)
      throw new Error('SOURCE_LEDGER_INVALID_PAGE')
    const rows = this.db.prepare([
      'SELECT event_id,body,digest FROM dev_whatsapp_source_ledger',
      ' WHERE event_id>? ORDER BY event_id LIMIT ?',
    ].join('')).all(afterEventId,limit) as Array<{event_id:string,body:string,digest:string}>
    const entries = rows.map(row=>{
      if(createHash('sha256').update(row.body).digest('hex')!==row.digest)
        throw new Error('SOURCE_LEDGER_CORRUPT')
      const source=JSON.parse(row.body) as ImmutableWhatsAppSource
      validate(source)
      if(source.eventId!==row.event_id) throw new Error('SOURCE_LEDGER_CORRUPT')
      return source
    })
    return {entries,nextCursor:rows.length===limit?rows[rows.length-1]!.event_id:null}
  }
}
