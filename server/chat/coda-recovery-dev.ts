import type { ConfirmedCodaEvent } from './coda-sync.ts'
import type { DevelopmentCodaOutbox } from './coda-outbox-dev.ts'

/**
 * Read-only Coda scan -> durable local outbox, for the existing FUNIX DEV.
 * The caller supplies an exhaustive, paginated, confirmed Coda snapshot.
 * This never guesses the event timestamp from row creation/modification.
 * Neither an ordinary ERP row nor a phone match can become a sync event.
 *
 * The original, immutable event snapshot must be captured at the source.
 * Historical Coda rows without it are reviewed, never silently backfilled.
 */
export type RecoverableCodaRow = {
  id: string
  fx_UUID: unknown
  'api_ID Omnichanel': unknown
  funil_Canal: unknown
  funil_contatoE164?: unknown
  syncSnapshot?: unknown
  suppressed?: unknown
}
export type RecoverySummary = {
  scanned: number
  queued: number
  existing: number
  skippedManual: number
  missingSnapshot: number
  identityReview: number
  conflicts: number
}
const rowId = /^i-[A-Za-z0-9_-]{1,100}$/
const eventId = /^evo:funix_comercial:[A-Za-z0-9:_-]{1,128}$/
const pnJid = /^([0-9]{8,15})@s\.whatsapp\.net$/
const channelId = 'i-O01Tgl0bN2'

function channel(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const ref = (value as Record<string, unknown>).rowId
    return typeof ref === 'string' ? ref : ''
  }
  return ''
}
function canonicalEvent(raw: unknown): ConfirmedCodaEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (Object.keys(x).length !== 9 ||
      x.version !== 1 || x.source !== 'coda' ||
      x.instance !== 'funix_comercial' ||
      typeof x.eventId !== 'string' || !eventId.test(x.eventId) ||
      typeof x.codaRowId !== 'string' || !rowId.test(x.codaRowId) ||
      typeof x.remoteJid !== 'string' || !pnJid.test(x.remoteJid) ||
      (x.phoneE164 !== null &&
       (typeof x.phoneE164 !== 'string' || !/^\+[1-9][0-9]{7,14}$/.test(x.phoneE164))) ||
      typeof x.displayName !== 'string' || x.displayName.length > 250 ||
      /[\u0000-\u001f\u007f]/.test(x.displayName) ||
      !Number.isSafeInteger(x.occurredAt) ||
      Number(x.occurredAt) < 0 || Number(x.occurredAt) > 2147483647)
    return null
  if (typeof x.phoneE164 === 'string' &&
      x.phoneE164 !== '+' + x.remoteJid.split('@')[0]) return null
  return x as ConfirmedCodaEvent
}

export function recoverConfirmedWhatsAppRows(
  outbox: DevelopmentCodaOutbox,
  rows: readonly RecoverableCodaRow[],
  nowMs: number,
): RecoverySummary {
  const summary: RecoverySummary = {
    scanned: 0, queued: 0, existing: 0, skippedManual: 0,
    missingSnapshot: 0, identityReview: 0, conflicts: 0,
  }
  // Preflight the complete scan: no first-writer-wins when a row or event
  // identifier appears more than once, regardless of input ordering.
  const rowCounts = new Map<string, number>()
  const eventCounts = new Map<string, number>()
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue
    rowCounts.set(row.id, (rowCounts.get(row.id) ?? 0) + 1)
    const marker = typeof row.fx_UUID === 'string' ? row.fx_UUID.trim() : ''
    if (eventId.test(marker))
      eventCounts.set(marker, (eventCounts.get(marker) ?? 0) + 1)
  }
  for (const row of rows) {
    summary.scanned++
    if (!row || typeof row.id !== 'string' || !rowId.test(row.id) || rowCounts.get(row.id) !== 1) {
      summary.identityReview++
      continue
    }
    const marker = typeof row.fx_UUID === 'string' ? row.fx_UUID.trim() : ''
    if (!marker) {
      summary.skippedManual++
      continue
    }
    if (!eventId.test(marker) || eventCounts.get(marker) !== 1) {
      summary.identityReview++
      continue
    }
    if (row.suppressed !== false ||
        channel(row.funil_Canal) !== channelId ||
        typeof row['api_ID Omnichanel'] !== 'string' ||
        !pnJid.test(row['api_ID Omnichanel'])) {
      summary.identityReview++
      continue
    }
    if (!row.syncSnapshot) {
      summary.missingSnapshot++
      continue
    }
    const event = canonicalEvent(row.syncSnapshot)
    if (!event || event.codaRowId !== row.id || event.eventId !== marker ||
        event.remoteJid !== row['api_ID Omnichanel'] ||
        (typeof row.funil_contatoE164 === 'string' &&
         row.funil_contatoE164 !== '' &&
         row.funil_contatoE164 !== event.phoneE164)) {
      summary.identityReview++
      continue
    }
    try {
      const result = outbox.enqueue(event, 'whatsapp', row.id, nowMs)
      if (result === 'created') summary.queued++
      else summary.existing++
    } catch {
      // No record payload or PII is logged; concurrent/conflicting receipts
      // require deliberate operator review.
      summary.conflicts++
    }
  }
  return summary
}
