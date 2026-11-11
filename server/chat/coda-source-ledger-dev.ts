import type { ConfirmedCodaEvent } from './coda-sync.ts'
import type { DevelopmentCodaOutbox } from './coda-outbox-dev.ts'
import { recoverConfirmedWhatsAppRows, type RecoverableCodaRow, type RecoverySummary } from './coda-recovery-dev.ts'

/**
 * DEV-only join contract for a durable inbound source ledger and Coda-confirmed
 * records. The ledger MUST be written before contacting Coda and MUST be
 * immutable by event ID. The Coda record alone does not supply occurredAt.
 *
 * This adapter intentionally supports only exact creation-message matches.
 * Later WhatsApp messages reusing a pre-existing commercial row require a
 * separate durable message-to-row confirmation ledger; never infer by phone.
 */
export type ImmutableWhatsAppSource = {
  eventId: string
  remoteJid: string
  phoneE164: string | null
  displayName: string
  occurredAt: number
  instance: string
  source: 'whatsapp'
  suppressed: false
}
export type SourceLedgerResult = RecoverySummary & {
  sourceConflicts: number
  unsupportedReuses: number
}
const pattern = /^evo:funix_comercial:[A-Za-z0-9:_-]{1,128}$/
const jid = /^[0-9]{8,15}@s\.whatsapp\.net$/

export function reconcileSourceLedger(
  outbox: DevelopmentCodaOutbox,
  rows: readonly RecoverableCodaRow[],
  source: readonly ImmutableWhatsAppSource[],
  nowMs: number,
): SourceLedgerResult {
  const counts = new Map<string, number>()
  const records = new Map<string, ImmutableWhatsAppSource>()
  for (const event of source) {
    counts.set(event.eventId, (counts.get(event.eventId) ?? 0) + 1)
    records.set(event.eventId, event)
  }
  let sourceConflicts = 0
  let unsupportedReuses = 0
  const joinRows: RecoverableCodaRow[] = rows.map(row => {
    const marker = typeof row.fx_UUID === 'string' ? row.fx_UUID.trim() : ''
    if (!pattern.test(marker)) return row
    const count = counts.get(marker) ?? 0
    if (count > 1) {
      sourceConflicts++
      return {...row, syncSnapshot:undefined}
    }
    const original = records.get(marker)
    if (!original) {
      unsupportedReuses++
      return {...row, syncSnapshot:undefined}
    }
    const verified =
      original.source === 'whatsapp' && original.suppressed === false &&
      original.instance === 'funix_comercial' &&
      pattern.test(original.eventId) && jid.test(original.remoteJid) &&
      original.remoteJid === row['api_ID Omnichanel'] &&
      Number.isSafeInteger(original.occurredAt) && original.occurredAt >= 0 &&
      original.occurredAt <= 2147483647 &&
      typeof original.displayName === 'string' &&
      original.displayName.length <= 250 &&
      (original.phoneE164 === null ||
       original.phoneE164 === '+' + original.remoteJid.split('@')[0])
    if (!verified) return {...row, syncSnapshot:undefined}
    const snapshot: ConfirmedCodaEvent = {
      version:1, source:'coda', eventId:original.eventId,
      codaRowId:row.id, instance:'funix_comercial',
      remoteJid:original.remoteJid,phoneE164:original.phoneE164,
      displayName:original.displayName,occurredAt:original.occurredAt,
    }
    return {...row,syncSnapshot:snapshot,suppressed:false}
  })
  return {...recoverConfirmedWhatsAppRows(outbox,joinRows,nowMs),sourceConflicts,unsupportedReuses}
}
