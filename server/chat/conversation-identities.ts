import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { ServiceError } from '../errors.ts'

const instance = 'funix_comercial'
const jid = /^(?:[0-9]{8,15}@s\.whatsapp\.net|[A-Za-z0-9_-]{1,100}@lid)$/
function invalid(): never {
  throw new ServiceError(422, 'CHAT_IDENTITY_INVALID', 'Identidade de conversa inválida.')
}

/** Core technical storage. Caller owns the startup transaction; no ERP data is required. */
export function createConversationIdentitySchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_provider_conversations (
    id TEXT PRIMARY KEY, instance TEXT NOT NULL, remote_jid TEXT NOT NULL, UNIQUE(instance,remote_jid));
    CREATE TABLE IF NOT EXISTS chat_provider_alias_evidence (
    instance TEXT NOT NULL,pn TEXT NOT NULL,lid TEXT NOT NULL,first_seen_at TEXT NOT NULL,
    last_seen_at TEXT,evidence_source TEXT NOT NULL DEFAULT 'legacy',evidence_reference TEXT,
    PRIMARY KEY(instance,pn,lid));
    CREATE INDEX IF NOT EXISTS chat_provider_alias_lid ON chat_provider_alias_evidence(instance,lid);`)
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(chat_provider_alias_evidence)')
      .all()
      .map((row) => String(row.name)),
  )
  for (const [column, ddl] of [
    ['last_seen_at', 'TEXT'],
    ['evidence_source', "TEXT NOT NULL DEFAULT 'legacy'"],
    ['evidence_reference', 'TEXT'],
  ] as const)
    if (!columns.has(column))
      db.exec(`ALTER TABLE chat_provider_alias_evidence ADD COLUMN ${column} ${ddl}`)
}

/** Stable provider identities and evidence only. No Atendimento creation or commercial rule. */
export class ConversationIdentities {
  protected readonly db: DatabaseSync
  protected readonly now: () => string
  constructor(db: DatabaseSync, now = () => new Date().toISOString()) {
    this.db = db
    this.now = now
  }
  /** Provider-only evidence. Missing latest aliases never erase prior evidence.
   * Contradictory evidence is retained and quarantines BOTH sides, across pages/restarts.
   * This records identity, never creates an Atendimento or a Coda association.
   */
  rememberProviderAliases(
    rows: Array<{
      remoteJid: string
      remoteJidAlt?: string | null
      messageId?: string
      identityEvidenceRef?: string
    }>,
    inTransaction = false,
    source: 'provider' | 'findChats' | 'findMessages' | 'webhook' = 'provider',
  ): void {
    if (!inTransaction) this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows) {
        if (!jid.test(row.remoteJid)) return invalid()
        const alt = row.remoteJidAlt
        if (!alt || !jid.test(alt) || alt.endsWith('@lid') === row.remoteJid.endsWith('@lid'))
          continue
        const [pn, lid] = row.remoteJid.endsWith('@lid')
          ? [alt, row.remoteJid]
          : [row.remoteJid, alt]
        this.db
          .prepare(
            'INSERT INTO chat_provider_alias_evidence(instance,pn,lid,first_seen_at,last_seen_at,evidence_source,evidence_reference) VALUES(?,?,?,?,?,?,?) ON CONFLICT(instance,pn,lid) DO UPDATE SET last_seen_at=excluded.last_seen_at,evidence_source=excluded.evidence_source,evidence_reference=COALESCE(excluded.evidence_reference,evidence_reference)',
          )
          .run(
            instance,
            pn,
            lid,
            this.now(),
            this.now(),
            source,
            row.messageId
              ? 'sha256:' + createHash('sha256').update(row.messageId).digest('hex')
              : (row.identityEvidenceRef ?? null),
          )
      }
      if (!inTransaction) this.db.exec('COMMIT')
    } catch (error) {
      if (!inTransaction) this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** At most one PN and one LID. No transitive merging or last-write-wins identity. */
  identityJids(remoteJid: string): string[] | null {
    if (!jid.test(remoteJid)) return null
    const rows = this.db
      .prepare(
        'SELECT pn,lid FROM chat_provider_alias_evidence WHERE instance=? AND (pn=? OR lid=?)',
      )
      .all(instance, remoteJid, remoteJid)
    if (!rows.length) return [remoteJid]
    if (rows.length !== 1) return null
    const pn = String(rows[0]!.pn),
      lid = String(rows[0]!.lid)
    const count = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM chat_provider_alias_evidence WHERE instance=? AND (pn=? OR lid=?)',
      )
      .get(instance, pn, lid)!
    return Number(count.n) === 1 ? [lid, pn] : null
  }

  rememberProviderConversation(remoteJid: string): string {
    if (!jid.test(remoteJid)) return invalid()
    const legacy = this.db
      .prepare('SELECT id FROM chat_conversations WHERE instance=? AND remote_jid=?')
      .get(instance, remoteJid)
    const hasV20 = this.db
      .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='v20_conversations'")
      .get()
    const v20 = hasV20
      ? this.db
          .prepare('SELECT id FROM v20_conversations WHERE instance=? AND remote_jid=?')
          .get(instance, remoteJid)
      : undefined
    this.db
      .prepare('INSERT OR IGNORE INTO chat_provider_conversations VALUES(?,?,?)')
      .run(String(legacy?.id ?? v20?.id ?? randomUUID()), instance, remoteJid)
    return String(
      this.db
        .prepare('SELECT id FROM chat_provider_conversations WHERE instance=? AND remote_jid=?')
        .get(instance, remoteJid)!.id,
    )
  }

  providerJid(conversationId: string): string | null {
    const row = this.db
      .prepare('SELECT remote_jid FROM chat_provider_conversations WHERE instance=? AND id=?')
      .get(instance, conversationId)
    if (row) return String(row.remote_jid)
    if (
      this.db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='v20_conversations'")
        .get()
    ) {
      const legacy = this.db
        .prepare('SELECT remote_jid FROM v20_conversations WHERE instance=? AND id=?')
        .get(instance, conversationId)
      return legacy ? String(legacy.remote_jid) : null
    }
    return null
  }
}

/** Commercial adapter seam. The current implementation is Coda-backed; the Chat core does not own ERP rules. */
export interface ConversationAssociationReader {
  identityState(
    jid: string,
  ): 'linked' | 'missing_confirmation' | 'identity_conflict' | 'context_conflict'
  contextToken(jid: string): string | null
}
