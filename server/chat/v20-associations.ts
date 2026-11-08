import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { ServiceError } from '../errors.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const instancePattern = /^[A-Za-z0-9_-]{1,80}$/
const individualJid = /^(?:[0-9]{8,15}@s\.whatsapp\.net|[A-Za-z0-9_-]{1,100}@lid)$/

function invalid(): never { throw new ServiceError(400, 'V20_ASSOCIATION_INVALID', 'Dados de associação inválidos.') }
function missing(): never { throw new ServiceError(404, 'V20_ASSOCIATION_NOT_FOUND', 'Conversa, Atendimento ou vínculo não encontrado.') }
function conflict(): never { throw new ServiceError(409, 'V20_ASSOCIATION_CONFLICT', 'Conflito de revisão ou vínculo.') }
function validateId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) return invalid()
  return value
}
function validateReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) return invalid()
  return value.trim()
}
function validateRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return invalid()
  return Number(value)
}
function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * Candidate additive V15 tables. Intentionally NOT registered in migrations.ts:
 * running the production V14 migrator against V15 would refuse startup after
 * a rollback. This schema is invoked ONLY by explicit offline tests for now.
 *
 * The legacy chat_links/chat_messages tables remain unmodified and continue
 * to represent temporal attribution, not the new N:N association.
 */
export function createV20AssociationSchema(db: DatabaseSync) {
  // Additive, idempotent DDL; no schema_migrations V15 entry or legacy table edits.
  // DDL is atomically committed, so interrupted startup cannot leave partial schema.
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec([
    'CREATE TABLE IF NOT EXISTS v20_conversations (',
    ' id TEXT PRIMARY KEY, instance TEXT NOT NULL, remote_jid TEXT NOT NULL,',
    ' revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0), created_at TEXT NOT NULL,',
    ' UNIQUE(instance,remote_jid)',
    ');',
    'CREATE TABLE IF NOT EXISTS v20_associations (',
    ' id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES v20_conversations(id) ON DELETE RESTRICT,',
    ' atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,',
    ' linked_at TEXT NOT NULL, linked_by TEXT NOT NULL, link_reason TEXT NOT NULL,',
    ' unlinked_at TEXT, unlinked_by TEXT, unlink_reason TEXT,',
    " CHECK ((unlinked_at IS NULL AND unlinked_by IS NULL AND unlink_reason IS NULL) OR",
    "        (unlinked_at IS NOT NULL AND unlinked_by IS NOT NULL AND unlink_reason IS NOT NULL)),",
    ' UNIQUE(id,conversation_id)',
    ');',
    'CREATE UNIQUE INDEX IF NOT EXISTS v20_active_pair ON v20_associations(conversation_id,atendimento_id) WHERE unlinked_at IS NULL;',
    'CREATE INDEX IF NOT EXISTS v20_active_by_atendimento ON v20_associations(atendimento_id,conversation_id) WHERE unlinked_at IS NULL;',
    'CREATE TABLE IF NOT EXISTS v20_active_context (',
    ' conversation_id TEXT PRIMARY KEY REFERENCES v20_conversations(id) ON DELETE CASCADE,',
    ' link_id TEXT NOT NULL,',
    ' FOREIGN KEY(link_id,conversation_id) REFERENCES v20_associations(id,conversation_id) ON DELETE RESTRICT',
    ');',
    'CREATE TABLE IF NOT EXISTS v20_association_receipts (',
    ' conversation_id TEXT NOT NULL REFERENCES v20_conversations(id) ON DELETE RESTRICT,',
    ' request_id TEXT NOT NULL, digest TEXT NOT NULL, result_json TEXT NOT NULL,',
    ' PRIMARY KEY(conversation_id,request_id)',
    ');',
    ].join('\n'))
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('V20_ASSOCIATION_FK_INVALID')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export type V20Association = {
  linkId: string
  atendimentoId: string
  linkedAt: string
  name: string
  vehicle: string
  plate: string
}
type MutationResult = { linkId: string; revision: number }

/**
 * Stable, server-side identity and explicit N:N links.
 * It never looks up Atendimentos by phone/name, imports message content,
 * sends WhatsApp requests or alters the legacy chat tables.
 * Integration with the live Evolution bridge is a separate, gated change.
 */
export class V20AssociationRepository {
  private readonly db: DatabaseSync
  private readonly now: () => string

  constructor(db: DatabaseSync, now: () => string = () => new Date().toISOString()) {
    this.db = db
    this.now = now
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = run()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private conversation(conversationId: string) {
    const record = this.db.prepare('SELECT revision FROM v20_conversations WHERE id=?').get(conversationId)
    if (!record) return missing()
    return Number(record.revision)
  }

  private receipt(conversationId: string, requestId: string, digest: string): MutationResult | null {
    const row = this.db.prepare('SELECT digest,result_json FROM v20_association_receipts WHERE conversation_id=? AND request_id=?').get(conversationId,requestId)
    if (!row) return null
    if (row.digest !== digest) return conflict()
    return JSON.parse(String(row.result_json)) as MutationResult
  }

  private saveReceipt(conversationId: string, requestId: string, digest: string, result: MutationResult) {
    this.db.prepare('INSERT INTO v20_association_receipts VALUES(?,?,?,?)')
      .run(conversationId, requestId, digest, JSON.stringify(result))
  }

  /** Maps the exact technical instance+JID to a stable UUID. No PN/LID inference. */
  rememberConversation(instance: string, remoteJid: string): { conversationId: string; revision: number } {
    if (!instancePattern.test(instance) || !individualJid.test(remoteJid)) return invalid()
    return this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO v20_conversations(id,instance,remote_jid,created_at) VALUES(?,?,?,?)')
        .run(randomUUID(), instance, remoteJid, this.now())
      const row = this.db.prepare('SELECT id,revision FROM v20_conversations WHERE instance=? AND remote_jid=?')
        .get(instance, remoteJid)!
      return { conversationId: String(row.id), revision: Number(row.revision) }
    })
  }

  /** Never expose raw provider JIDs in routes or browser responses. */
  resolveRemoteJid(conversationId: string, instance: string): string | null {
    validateId(conversationId)
    if (!instancePattern.test(instance)) return invalid()
    const row = this.db.prepare('SELECT remote_jid FROM v20_conversations WHERE id=? AND instance=?')
      .get(conversationId, instance)
    return row ? String(row.remote_jid) : null
  }

  listActive(conversationId: string): { revision: number; items: V20Association[]; activeAtendimentoId: string | null } {
    validateId(conversationId)
    const revision = this.conversation(conversationId)
    const items = this.db.prepare(
      'SELECT l.id,l.atendimento_id,l.linked_at,a.name,a.vehicle,a.plate FROM v20_associations l JOIN atendimentos a ON a.id=l.atendimento_id WHERE l.conversation_id=? AND l.unlinked_at IS NULL ORDER BY l.linked_at,l.id',
    ).all(conversationId).map(row => ({
      linkId: String(row.id), atendimentoId: String(row.atendimento_id), linkedAt: String(row.linked_at),
      name: String(row.name), vehicle: String(row.vehicle), plate: String(row.plate),
    }))
    const selected = this.db.prepare(
      'SELECT l.atendimento_id FROM v20_active_context c JOIN v20_associations l ON l.id=c.link_id AND l.conversation_id=c.conversation_id WHERE c.conversation_id=? AND l.unlinked_at IS NULL',
    ).get(conversationId)
    return { revision, items, activeAtendimentoId: selected ? String(selected.atendimento_id) : null }
  }

  /** Same Atendimento may be connected to many conversations and vice versa. */
  link(input: { conversationId: string; atendimentoId: string; expectedRevision: number; requestId: string; reason: string }): MutationResult {
    const conversationId = validateId(input.conversationId)
    const atendimentoId = validateId(input.atendimentoId)
    const requestId = validateId(input.requestId)
    const expectedRevision = validateRevision(input.expectedRevision)
    const reason = validateReason(input.reason)
    const digest = hashRequest(['link', conversationId, atendimentoId, expectedRevision, reason])
    return this.transaction(() => {
      const replay = this.receipt(conversationId, requestId, digest)
      if (replay) return replay
      if (this.conversation(conversationId) !== expectedRevision) return conflict()
      if (!this.db.prepare('SELECT 1 FROM atendimentos WHERE id=?').get(atendimentoId)) return missing()
      if (this.db.prepare(
        'SELECT 1 FROM v20_associations WHERE conversation_id=? AND atendimento_id=? AND unlinked_at IS NULL',
      ).get(conversationId, atendimentoId)) return conflict()
      const linkId = randomUUID()
      this.db.prepare(
        'INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)',
      ).run(linkId, conversationId, atendimentoId, this.now(), 'operator', reason)
      const revision = expectedRevision + 1
      this.db.prepare('UPDATE v20_conversations SET revision=? WHERE id=?').run(revision, conversationId)
      const result = { linkId, revision }
      this.saveReceipt(conversationId, requestId, digest, result)
      return result
    })
  }

  unlink(input: { conversationId: string; linkId: string; expectedRevision: number; requestId: string; reason: string }): MutationResult {
    const conversationId = validateId(input.conversationId)
    const linkId = validateId(input.linkId)
    const requestId = validateId(input.requestId)
    const expectedRevision = validateRevision(input.expectedRevision)
    const reason = validateReason(input.reason)
    const digest = hashRequest(['unlink', conversationId, linkId, expectedRevision, reason])
    return this.transaction(() => {
      const replay = this.receipt(conversationId, requestId, digest)
      if (replay) return replay
      if (this.conversation(conversationId) !== expectedRevision) return conflict()
      const result = this.db.prepare(
        'UPDATE v20_associations SET unlinked_at=?,unlinked_by=?,unlink_reason=? WHERE id=? AND conversation_id=? AND unlinked_at IS NULL',
      ).run(this.now(), 'operator', reason, linkId, conversationId)
      if (result.changes !== 1) return missing()
      this.db.prepare('DELETE FROM v20_active_context WHERE conversation_id=? AND link_id=?')
        .run(conversationId, linkId)
      const revision = expectedRevision + 1
      this.db.prepare('UPDATE v20_conversations SET revision=? WHERE id=?').run(revision, conversationId)
      const receipt = { linkId, revision }
      this.saveReceipt(conversationId, requestId, digest, receipt)
      return receipt
    })
  }

  /** A navigation preference, not a link change. Clearing returns to neutral. */
  selectAtendimento(conversationId: string, linkId: string | null): string | null {
    validateId(conversationId)
    if (linkId !== null) validateId(linkId)
    return this.transaction(() => {
      this.conversation(conversationId)
      if (linkId === null) {
        this.db.prepare('DELETE FROM v20_active_context WHERE conversation_id=?').run(conversationId)
        return null
      }
      const link = this.db.prepare(
        'SELECT atendimento_id FROM v20_associations WHERE id=? AND conversation_id=? AND unlinked_at IS NULL',
      ).get(linkId, conversationId)
      if (!link) return missing()
      this.db.prepare(
        'INSERT INTO v20_active_context(conversation_id,link_id) VALUES(?,?) ON CONFLICT(conversation_id) DO UPDATE SET link_id=excluded.link_id',
      ).run(conversationId, linkId)
      return String(link.atendimento_id)
    })
  }
}
