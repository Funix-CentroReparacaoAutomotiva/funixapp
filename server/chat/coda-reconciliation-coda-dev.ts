import type { ReconciliationConfig } from './coda-reconciliation-runner-dev.ts'
import { createDevelopmentReconciliationCycle } from './coda-reconciliation-runner-dev.ts'
import { createCodaApiPageProvider, createDoubleCheckedCodaPageProvider,
  type CodaReadConfig } from './coda-api-provider-dev.ts'

/**
 * Factory for the existing DEV only. It introduces no timers, network
 * activity at import time or startup changes. Invoke only with an authorized
 * read-only token after explicitly enabling the source/outbox feature.
 *
 * Coda pages are fetched twice and compared before ANY outbox enqueue.
 * That bounds some mid-scan changes but does not guarantee a consistent
 * transactional snapshot (Coda API does not provide one).
 */
export function createCodaBackedDevelopmentReconciliationCycle(
  coda: CodaReadConfig,
  delivery: Omit<ReconciliationConfig, 'pages' | 'maxPages' | 'maxRows'>,
) {
  const pages=createDoubleCheckedCodaPageProvider(
    createCodaApiPageProvider(coda),
    10_000,
  )
  return createDevelopmentReconciliationCycle({
    ...delivery,
    pages,
    maxPages:1,
    maxRows:10_000,
  })
}
