import type { DevelopmentCodaOutbox } from './coda-outbox-dev.ts'
import { deliverDevelopmentCodaEvent, type CodaOutboxTransport } from './coda-outbox-worker-dev.ts'

/**
 * DEV-only outbox delivery is independent of fresh Coda scans. Previously
 * confirmed events can still be retried while Coda is temporarily down.
 * Each invocation has an explicit bound; no network work at import time.
 */
export function createDevelopmentOutboxDrain(
  queue:DevelopmentCodaOutbox,
  transport:CodaOutboxTransport,
  secret:Buffer,
  now:()=>number,
  maxDeliveries=10,
) {
  if(!Number.isInteger(maxDeliveries)||maxDeliveries<1||maxDeliveries>20)
    throw Error('OUTBOX_INVALID_BATCH')
  return async()=>{
    let attempted=0,delivered=0,failures=0
    for(let i=0;i<maxDeliveries;i++){
      const result=await deliverDevelopmentCodaEvent(queue,transport,secret,now)
      if(result.status==='idle')break
      attempted++
      if(result.status==='delivered')delivered++
      else failures++
      // A failed delivery is already rescheduled/quarantined by the queue.
      // Stop this batch if the application/authentication is unhealthy.
      if(result.status!=='delivered')break
    }
    return {status:'completed' as const,attempted,delivered,failures}
  }
}
