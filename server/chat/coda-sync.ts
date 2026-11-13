import { ConversationIdentities, createConversationIdentitySchema } from './conversation-identities.ts'
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
      'CREATE TABLE IF NOT EXISTS coda_sync_context_revisions (',
      ' instance TEXT NOT NULL, remote_jid TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(instance,remote_jid));',
      'CREATE TABLE IF NOT EXISTS coda_sync_context_conflicts (',
      ' instance TEXT NOT NULL, remote_jid TEXT NOT NULL, occurred_at INTEGER NOT NULL,',
      ' PRIMARY KEY(instance,remote_jid));',
      'CREATE TABLE IF NOT EXISTS coda_sync_receipts (',
      ' event_id TEXT PRIMARY KEY, digest TEXT NOT NULL,',
      ' atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,',
      ' created_at TEXT NOT NULL);',
    ].join('\n'))
    db.exec('INSERT OR IGNORE INTO coda_sync_context_revisions SELECT instance,remote_jid,1 FROM coda_sync_active_conversations')
    createConversationIdentitySchema(db)
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('CODA_SYNC_FK_INVALID')
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

/** One Coda row maps to one local Atendimento; n8n owns commercial classification.
 * No match by phone, name or inferred PN/LID equivalence, ever.
 */
export class CodaEventSyncRepository extends ConversationIdentities {
  constructor(db: DatabaseSync, now: () => string = () => new Date().toISOString()) { super(db,now) }

  sync(raw: unknown): { atendimentoId: string; state: 'created' | 'existing' } {
    const event = validate(raw)
    const digest = createHash('sha256').update(JSON.stringify(event)).digest('hex')
    this.db.exec('BEGIN IMMEDIATE')
    let open = true
    try {
      const active = this.db.prepare('SELECT coda_row_id,occurred_at FROM coda_sync_active_conversations WHERE instance=? AND remote_jid=?').get(event.instance,event.remoteJid)
      const blockedBefore=this.contextConflict(event.remoteJid)
      if (active && Number(active.occurred_at) === event.occurredAt && String(active.coda_row_id) !== event.codaRowId) {
        this.db.prepare('INSERT INTO coda_sync_context_conflicts VALUES(?,?,?) ON CONFLICT(instance,remote_jid) DO UPDATE SET occurred_at=MAX(occurred_at,excluded.occurred_at)').run(event.instance,event.remoteJid,event.occurredAt)
        this.db.exec('COMMIT'); open = false
        return conflict()
      }
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
      // A delayed old event cannot replace the newest confirmed Atendimento.
      this.db.prepare([
        'INSERT INTO coda_sync_active_conversations VALUES(?,?,?,?,?)',
        ' ON CONFLICT(instance,remote_jid) DO UPDATE SET',
        ' coda_row_id=excluded.coda_row_id,occurred_at=excluded.occurred_at,event_id=excluded.event_id',
        ' WHERE excluded.occurred_at>coda_sync_active_conversations.occurred_at',
        ' OR (excluded.occurred_at=coda_sync_active_conversations.occurred_at',
        ' AND excluded.event_id>coda_sync_active_conversations.event_id)',
      ].join('')).run(event.instance,event.remoteJid,event.codaRowId,event.occurredAt,event.eventId)
      if(!active||((String(active.coda_row_id)!==event.codaRowId||blockedBefore)&&event.occurredAt>Number(active.occurred_at))){
        this.db.prepare('INSERT INTO coda_sync_context_revisions VALUES(?,?,1) ON CONFLICT(instance,remote_jid) DO UPDATE SET revision=revision+1').run(instance,event.remoteJid)
      }
      this.db.prepare('INSERT INTO coda_sync_receipts VALUES(?,?,?,?)').run(event.eventId,digest,atendimentoId,at)
      this.db.exec('COMMIT')
      return { atendimentoId, state }
    } catch (error) { if (open) this.db.exec('ROLLBACK'); throw error }
  }

  resolveIdentityActive(remoteJid: string): string | null {
    const members = this.identityJids(remoteJid)
    if (!members || members.some(value => this.contextConflict(value))) return null
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

  contextConflict(remoteJid: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM coda_sync_context_conflicts x JOIN coda_sync_active_conversations a ON a.instance=x.instance AND a.remote_jid=x.remote_jid WHERE x.instance=? AND x.remote_jid=? AND x.occurred_at>=a.occurred_at').get(instance,remoteJid))
  }

  identityState(remoteJid: string): 'linked' | 'missing_confirmation' | 'identity_conflict' | 'context_conflict' {
    const members=this.identityJids(remoteJid)
    if (!members) return 'identity_conflict'
    if (members.some(value=>this.contextConflict(value))) return 'context_conflict'
    const values=new Set(members.map(value=>this.resolveActive(value)).filter(Boolean))
    return values.size>1 ? 'context_conflict' : values.size===1 ? 'linked' : 'missing_confirmation'
  }

  /** Opaque revision of all authoritative context and alias evidence. */
  contextToken(remoteJid: string): string | null {
    const members=this.identityJids(remoteJid)
    if (!members || !this.resolveIdentityActive(remoteJid)) return null
    const state=members.map(value=>this.db.prepare('SELECT a.coda_row_id,COALESCE(r.revision,1) AS revision FROM coda_sync_active_conversations a LEFT JOIN coda_sync_context_revisions r ON r.instance=a.instance AND r.remote_jid=a.remote_jid WHERE a.instance=? AND a.remote_jid=?').get(instance,value) ?? null)
    return createHash('sha256').update(JSON.stringify([members,state])).digest('hex')
  }

  resolveActive(remoteJid: string): string | null {
    if (!jid.test(remoteJid) || this.contextConflict(remoteJid)) return null
    const row = this.db.prepare([
      'SELECT a.atendimento_id FROM coda_sync_active_conversations c',
      ' JOIN coda_sync_atendimentos a ON a.coda_row_id=c.coda_row_id',
      ' WHERE c.instance=? AND c.remote_jid=?',
    ].join('')).get(instance,remoteJid)
    return row ? String(row.atendimento_id) : null
  }
}
