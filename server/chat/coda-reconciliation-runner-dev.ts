import type { DevelopmentCodaOutbox } from './coda-outbox-dev.ts'
import { deliverDevelopmentCodaEvent, type CodaOutboxTransport } from './coda-outbox-worker-dev.ts'
import type { DevelopmentSourceLedger } from './coda-source-storage-dev.ts'
import type { DevelopmentDecisionLedger } from './coda-decision-ledger-dev.ts'
import { reconcileConfirmedDecisions } from './coda-decision-ledger-dev.ts'
import { reconcilePersistedSourceLedger } from './coda-source-ledger-dev.ts'
import type { RecoverableCodaRow } from './coda-recovery-dev.ts'

/**
 * DEV-only orchestration contract. The provider must return an exhaustive,
 * consistent scan of Coda Atendimentos (not a telephone search). A page is
 * allowed to be final only if the provider has verified the upstream end.
 * No Coda credentials, timers or HTTP fetches are wired by this module.
 */
export type ConfirmedCodaPage = {
  rows: readonly RecoverableCodaRow[]
  nextCursor: string | null
  complete: boolean
}
export type ConfirmedCodaPageProvider = (cursor: string | null) => Promise<ConfirmedCodaPage>
export type ReconciliationCycle = {
  status: 'completed'
  scanned: number
  created: number
  reused: number
  pendingReview: number
  delivery: Awaited<ReturnType<typeof deliverDevelopmentCodaEvent>>
}
export type ReconciliationConfig = {
  pages: ConfirmedCodaPageProvider
  source: DevelopmentSourceLedger
  decisions: DevelopmentDecisionLedger
  outbox: DevelopmentCodaOutbox
  transport: CodaOutboxTransport
  hmacSecret: Buffer
  now: () => number
  maxPages?: number
  maxRows?: number
}

/** A single-flight cycle: incomplete scans cannot enqueue any new event. */
export function createDevelopmentReconciliationCycle(config: ReconciliationConfig) {
  const maxPages = config.maxPages ?? 100
  const maxRows = config.maxRows ?? 10000
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>1000 ||
     !Number.isInteger(maxRows)||maxRows<1||maxRows>100000)
    throw Error('RECONCILIATION_INVALID_LIMIT')
  let running = false
  return async (): Promise<ReconciliationCycle | { status: 'busy' }> => {
    if(running) return {status:'busy'}
    running=true
    try {
      const rows: RecoverableCodaRow[]=[]
      const cursors=new Set<string>()
      let cursor:string|null=null
      let complete=false
      for(let pageNo=0;pageNo<maxPages;pageNo++) {
        const page=await config.pages(cursor)
        if(!page || !Array.isArray(page.rows) ||
           typeof page.complete!=='boolean' ||
           (page.nextCursor!==null &&
             (typeof page.nextCursor!=='string'||page.nextCursor.length<1||
              page.nextCursor.length>512)) ||
           page.rows.some(r=>!r||typeof r.id!=='string')) {
          throw Error('RECONCILIATION_INVALID_PAGE')
        }
        if(page.rows.length===0 && page.nextCursor!==null)
          throw Error('RECONCILIATION_EMPTY_PAGE')
        if(rows.length+page.rows.length>maxRows)
          throw Error('RECONCILIATION_ROW_LIMIT')
        rows.push(...page.rows)
        if(page.nextCursor===null) {
          if(!page.complete) throw Error('RECONCILIATION_INCOMPLETE')
          complete=true
          break
        }
        if(page.complete || page.nextCursor===cursor || cursors.has(page.nextCursor))
          throw Error('RECONCILIATION_INVALID_CURSOR')
        cursors.add(page.nextCursor)
        cursor=page.nextCursor
      }
      if(!complete) throw Error('RECONCILIATION_PAGE_LIMIT')
      // Identical source events queued via both paths are idempotent. A crash
      // after partial enqueue is harmless; the following complete scan retries.
      const original=reconcilePersistedSourceLedger(config.outbox,config.source,rows,config.now())
      const decisions=reconcileConfirmedDecisions(
        config.outbox,config.source,config.decisions,rows,config.now(),
      )
      // Drain at most one queued event per cycle. Transport has bounded retry,
      // application receipt verification and fencing for expired leases.
      const delivery=await deliverDevelopmentCodaEvent(
        config.outbox,config.transport,config.hmacSecret,config.now,
      )
      return {
        status:'completed',scanned:rows.length,
        created:original.queued+decisions.queued,
        reused:original.existing+decisions.existing,
        pendingReview:original.identityReview+original.conflicts+
          original.missingSnapshot+original.sourceConflicts+
          original.unsupportedReuses+decisions.review+decisions.missingSource,
        delivery,
      }
    } finally {running=false}
  }
}
