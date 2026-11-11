import { createHmac } from 'node:crypto'
import type { ConfirmedCodaEvent } from './coda-sync.ts'
import { DevelopmentCodaOutbox } from './coda-outbox-dev.ts'

export type CodaOutboxTransport = (request: {
  body: string
  timestamp: string
  signature: string
}) => Promise<{ status: number }>

/**
 * DEVELOPMENT-ONLY worker contract. The transport is injected and must be
 * simulated in tests. No production endpoint, timer or Coda credentials.
 */
export async function deliverDevelopmentCodaEvent(
  queue: DevelopmentCodaOutbox,
  transport: CodaOutboxTransport,
  secret: Buffer,
  now: () => number,
) {
  if (secret.length < 32 || secret.length > 64) throw new Error('OUTBOX_INVALID_SECRET')
  const claimed = queue.claim(now(), 60_000)
  if (!claimed) return { status:'idle' as const }
  const timestamp = String(Math.floor(now()/1000))
  const signature = 'sha256=' + createHmac('sha256',secret)
    .update('coda-sync-v1\n'+timestamp+'\n')
    .update(Buffer.from(claimed.body,'utf8')).digest('hex')
  let status = 0
  try {
    const response = await transport({body:claimed.body,timestamp,signature})
    status = Number.isSafeInteger(response.status) ? response.status : 0
  } catch {
    // Network failures are retries. Never include the exception or payload
    // in operational status/logging: it may contain PII or credentials.
    status = 0
  }
  // Unexpected 2xx/3xx/4xx is NOT success and NOT an outage. Quarantine;
  // otherwise an accidental 200 could be retried indefinitely.
  const normalized = Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : 0
  const result = queue.complete(claimed,normalized,now())
  return { status:result, attempts:claimed.attempts }
}

/** The caller must enumerate a trusted snapshot of WhatsApp-originated,
 * Coda-confirmed event rows. Manual records cannot enter this path.
 * Rerunning the entire scan is safe because enqueue is idempotent by eventId.
 */
export function reconcileDevelopmentSnapshot(
  queue: DevelopmentCodaOutbox,
  entries: ReadonlyArray<{
    event: ConfirmedCodaEvent
    source: 'whatsapp' | 'manual'
    confirmedRowId: string
  }>,
  nowMs: number,
) {
  let created=0,existing=0,skippedManual=0
  for(const row of entries){
    if(row.source==='manual'){skippedManual++;continue}
    const result=queue.enqueue(row.event,'whatsapp',row.confirmedRowId,nowMs)
    if(result==='created')created++
    else existing++
  }
  return {created,existing,skippedManual}
}
