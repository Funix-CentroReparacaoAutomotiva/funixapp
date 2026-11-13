import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { initializeFinancialSettings } from '../financial-initialization.ts'
import { normalizePhone } from '../atendimentos.ts'
import { ServiceError } from '../errors.ts'

const rowId = /^i-[A-Za-z0-9_-]{1,100}$/
const eventId = /^[A-Za-z0-9:_-]{1,160}$/
const jid = /^(?:[0-9]{8,15}@s\.whatsapp\.net|[A-Za-z0-9_-]{1,100}@lid)$/
const phoneE164 = /^\+[1-9][0-9]{7,14}$/
const instance = 'funix_comercial'
function invalid(): never { throw new ServiceError(422, 'CODA_SYNC_INVALID_EVENT', 'Evento de Atendimento inválido.') }
function conflict(): never { throw new ServiceError(409, 'CODA_SYNC_CONFLICT', 'Evento de Atendimento inconsistente.') }

export type ConfirmedCodaEvent = {
  version: 1
  source: 'coda'
  eventId: string
  codaRowId: string
  instance: 'funix_comercial'
  remoteJid: string
  phoneE164: string | null
  displayName: string
  occurredAt: number // message event timestamp in Unix seconds
}
function validate(input: unknown): ConfirmedCodaEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid()
  const x = input as Record<string, unknown>
  const allowed = ['version','source','eventId','codaRowId','instance','remoteJid','phoneE164','displayName','occurredAt']
  if (Object.keys(x).length !== allowed.length || Object.keys(x).some(key => !allowed.includes(key)) ||
    x.version !== 1 || x.source !== 'coda' || x.instance !== instance ||
    typeof x.eventId !== 'string' || !eventId.test(x.eventId) ||
    typeof x.codaRowId !== 'string' || !rowId.test(x.codaRowId) ||
    typeof x.remoteJid !== 'string' || !jid.test(x.remoteJid) ||
    (x.phoneE164 !== null && (typeof x.phoneE164 !== 'string' || !phoneE164.test(x.phoneE164))) ||
    typeof x.displayName !== 'string' || x.displayName.length > 250 ||
    /[\u0000-\u001f\u007f]/.test(x.displayName) ||
    !Number.isSafeInteger(x.occurredAt) || Number(x.occurredAt) < 0 || Number(x.occurredAt) > 2147483647) return invalid()
  // A claimed verified E.164 number must match the exact PN JID.
  // LID-only events remain separate and never infer a phone number.
  if (typeof x.phoneE164 === 'string' && (x.remoteJid as string).endsWith('@s.whatsapp.net') &&
    x.phoneE164.slice(1) !== (x.remoteJid as string).split('@')[0]) return invalid()
  return x as ConfirmedCodaEvent
}

/** Additive V14-compatible schema created only on the independent opt-in flag. */
export function createCodaEventSchema(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec([
      'CREATE TABLE IF NOT EXISTS coda_sync_atendimentos (',
      ' coda_row_id TEXT PRIMARY KEY,',
      ' atendimento_id TEXT NOT NULL UNIQUE REFERENCES atendimentos(id) ON DELETE RESTRICT,',
      ' created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS coda_sync_conversation_links (',
      ' instance TEXT NOT NULL, remote_jid TEXT NOT NULL,',
      ' coda_row_id TEXT NOT NULL REFERENCES coda_sync_atendimentos(coda_row_id) ON DELETE RESTRICT,',
      ' first_seen_at TEXT NOT NULL, PRIMARY KEY(instance,remote_jid,coda_row_id));',
      'CREATE TABLE IF NOT EXISTS coda_sync_active_conversations (',
      ' instance TEXT NOT NULL, remote_jid TEXT NOT NULL,',
      ' coda_row_id TEXT NOT NULL REFERENCES coda_sync_atendimentos(coda_row_id) ON DELETE RESTRICT,',
      ' occurred_at INTEGER NOT NULL, event_id TEXT NOT NULL,',
      ' PRIMARY KEY(instance,remote_jid));',
      'CREATE TABLE IF NOT EXISTS chat_provider_conversations (',
      ' id TEXT PRIMARY KEY, instance TEXT NOT NULL, remote_jid TEXT NOT NULL,',
      ' UNIQUE(instance,remote_jid));',
      'CREATE TABLE IF NOT EXISTS chat_provider_alias_evidence (',
      ' instance TEXT NOT NULL, pn TEXT NOT NULL, lid TEXT NOT NULL, first_seen_at TEXT NOT NULL,',
      ' PRIMARY KEY(instance,pn,lid));',
      'CREATE INDEX IF NOT EXISTS chat_provider_alias_lid ON chat_provider_alias_evidence(instance,lid);',
      'CREATE TABLE IF NOT EXISTS coda_sync_receipts (',
      ' event_id TEXT PRIMARY KEY, digest TEXT NOT NULL,',
      ' atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,',
      ' created_at TEXT NOT NULL);',
    ].join('\n'))
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('CODA_SYNC_FK_INVALID')
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

/** One Coda row maps to one local Atendimento; n8n owns commercial classification.
 * No match by phone, name or inferred PN/LID equivalence, ever.
 */
export class CodaEventSyncRepository {
  private readonly db: DatabaseSync
  private readonly now: () => string
  constructor(db: DatabaseSync, now: () => string = () => new Date().toISOString()) { this.db = db; this.now = now }

  sync(raw: unknown): { atendimentoId: string; state: 'created' | 'existing' } {
    const event = validate(raw)
    const digest = createHash('sha256').update(JSON.stringify(event)).digest('hex')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const receipt = this.db.prepare('SELECT digest,atendimento_id FROM coda_sync_receipts WHERE event_id=?').get(event.eventId)
      if (receipt) {
        if (receipt.digest !== digest) return conflict()
        this.db.exec('COMMIT')
        return { atendimentoId: String(receipt.atendimento_id), state: 'existing' }
      }
      const found = this.db.prepare('SELECT atendimento_id FROM coda_sync_atendimentos WHERE coda_row_id=?').get(event.codaRowId)
      const state = found ? 'existing' as const : 'created' as const
      const atendimentoId = found ? String(found.atendimento_id) : randomUUID()
      const at = this.now()
      if (!found) {
        const phone = event.phoneE164 ?? '' // Never fabricate digits for LID-only contacts.
        const normalized = phone ? normalizePhone(phone) : null
        if (phone && !normalized) return invalid()
        const name = event.displayName.trim()
        const search = [atendimentoId, phone, name].join('\n')
          .normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
        this.db.prepare("INSERT INTO atendimentos(id,phone,phone_normalized,name,search_text,stage,created_at,updated_at) VALUES(?,?,?,?,?,'novo-lead',?,?)")
          .run(atendimentoId,phone,normalized,name,search,at,at)
        if (this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='pricing_configuration'").get())
          initializeFinancialSettings(this.db,atendimentoId,true)
        this.db.prepare('INSERT INTO coda_sync_atendimentos VALUES(?,?,?)').run(event.codaRowId,atendimentoId,at)
      }
      this.db.prepare(
        'INSERT OR IGNORE INTO coda_sync_conversation_links VALUES(?,?,?,?)',
      ).run(event.instance,event.remoteJid,event.codaRowId,at)
      // Equal timestamps from different canonical Coda records do not carry
      // enough causal information to select one. Fail closed instead of
      // lexicographically choosing a possibly incorrect customer context.
      const active = this.db.prepare(
        'SELECT coda_row_id,occurred_at FROM coda_sync_active_conversations WHERE instance=? AND remote_jid=?',
      ).get(event.instance, event.remoteJid)
      if (active && Number(active.occurred_at) === event.occurredAt &&
          String(active.coda_row_id) !== event.codaRowId) return conflict()
      // A delayed old event cannot replace the newest confirmed Atendimento.
      this.db.prepare([
        'INSERT INTO coda_sync_active_conversations VALUES(?,?,?,?,?)',
        ' ON CONFLICT(instance,remote_jid) DO UPDATE SET',
        ' coda_row_id=excluded.coda_row_id,occurred_at=excluded.occurred_at,event_id=excluded.event_id',
        ' WHERE excluded.occurred_at>coda_sync_active_conversations.occurred_at',
        ' OR (excluded.occurred_at=coda_sync_active_conversations.occurred_at',
        ' AND excluded.event_id>coda_sync_active_conversations.event_id)',
      ].join('')).run(event.instance,event.remoteJid,event.codaRowId,event.occurredAt,event.eventId)
      this.db.prepare('INSERT INTO coda_sync_receipts VALUES(?,?,?,?)').run(event.eventId,digest,atendimentoId,at)
      this.db.exec('COMMIT')
      return { atendimentoId, state }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  /** Provider-only evidence. Missing latest aliases never erase prior evidence.
   * Contradictory evidence is retained and quarantines BOTH sides, across pages/restarts.
   * This records identity, never creates an Atendimento or a Coda association.
   */
  rememberProviderAliases(rows: Array<{ remoteJid: string; remoteJidAlt?: string | null }>): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows) {
        if (!jid.test(row.remoteJid)) return invalid()
        const alt = row.remoteJidAlt
        if (!alt || !jid.test(alt) || alt.endsWith('@lid') === row.remoteJid.endsWith('@lid')) continue
        const [pn, lid] = row.remoteJid.endsWith('@lid') ? [alt, row.remoteJid] : [row.remoteJid, alt]
        this.db.prepare('INSERT OR IGNORE INTO chat_provider_alias_evidence VALUES(?,?,?,?)')
          .run(instance,pn,lid,this.now())
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  /** At most one PN and one LID. No transitive merging or last-write-wins identity. */
  identityJids(remoteJid: string): string[] | null {
    if (!jid.test(remoteJid)) return null
    const rows = this.db.prepare(
      'SELECT pn,lid FROM chat_provider_alias_evidence WHERE instance=? AND (pn=? OR lid=?)',
    ).all(instance,remoteJid,remoteJid)
    if (!rows.length) return [remoteJid]
    if (rows.length !== 1) return null
    const pn = String(rows[0]!.pn), lid = String(rows[0]!.lid)
    const count = this.db.prepare(
      'SELECT COUNT(*) AS n FROM chat_provider_alias_evidence WHERE instance=? AND (pn=? OR lid=?)',
    ).get(instance,pn,lid)!
    return Number(count.n) === 1 ? [lid,pn] : null
  }

  rememberProviderConversation(remoteJid: string): string {
    if (!jid.test(remoteJid)) return invalid()
    this.db.prepare('INSERT OR IGNORE INTO chat_provider_conversations VALUES(?,?,?)')
      .run(randomUUID(),instance,remoteJid)
    return String(this.db.prepare('SELECT id FROM chat_provider_conversations WHERE instance=? AND remote_jid=?')
      .get(instance,remoteJid)!.id)
  }

  providerJid(conversationId: string): string | null {
    const row = this.db.prepare('SELECT remote_jid FROM chat_provider_conversations WHERE instance=? AND id=?')
      .get(instance,conversationId)
    return row ? String(row.remote_jid) : null
  }

  resolveIdentityActive(remoteJid: string): string | null {
    const members = this.identityJids(remoteJid)
    if (!members) return null
    const active = new Set(members.map(value => this.resolveActive(value)).filter((value): value is string => value !== null))
    return active.size === 1 ? [...active][0]! : null
  }

  /** One shared resolution for Funil and list. Prefer the provider's LID domain.
   * Multiple unrelated conversations and divergent active contexts remain blocked.
   */
  resolveIdentityJid(atendimentoId: string): string | null {
    const rows = this.db.prepare(
      'SELECT c.remote_jid FROM coda_sync_active_conversations c JOIN coda_sync_atendimentos a ON a.coda_row_id=c.coda_row_id WHERE c.instance=? AND a.atendimento_id=?',
    ).all(instance,atendimentoId)
    const preferred = new Set<string>()
    for (const row of rows) {
      const remoteJid = String(row.remote_jid), members = this.identityJids(remoteJid)
      if (!members || this.resolveIdentityActive(remoteJid) !== atendimentoId) return null
      preferred.add(members[0]!)
    }
    return preferred.size === 1 ? [...preferred][0]! : null
  }

  /** Never select an arbitrary conversation when multiple PN/LID contexts are active. */
  resolveUniqueActiveJid(atendimentoId: string): string | null {
    const rows = this.db.prepare([
      'SELECT c.remote_jid FROM coda_sync_active_conversations c',
      ' JOIN coda_sync_atendimentos a ON a.coda_row_id=c.coda_row_id',
      ' WHERE c.instance=? AND a.atendimento_id=? LIMIT 2',
    ].join('')).all(instance, atendimentoId)
    return rows.length === 1 ? String(rows[0]!.remote_jid) : null
  }

  resolveActive(remoteJid: string): string | null {
    if (!jid.test(remoteJid)) return null
    const row = this.db.prepare([
      'SELECT a.atendimento_id FROM coda_sync_active_conversations c',
      ' JOIN coda_sync_atendimentos a ON a.coda_row_id=c.coda_row_id',
      ' WHERE c.instance=? AND c.remote_jid=?',
    ].join('')).get(instance,remoteJid)
    return row ? String(row.atendimento_id) : null
  }
}
