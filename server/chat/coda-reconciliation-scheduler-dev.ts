/**
 * Optional DEV reconciliation timer. No work occurs until started by an
 * explicitly enabled application bootstrap. One run at a time, with a
 * deterministic stop() that waits for the current scan/delivery to complete.
 * Never log exception details because providers may include PII or secrets.
 */
export type ReconciliationRun = () => Promise<{status:string}>
export type ReconciliationScheduler = {stop:()=>Promise<void>; trigger:()=>Promise<'busy'|'completed'|'failed'>}
export function startDevelopmentReconciliationScheduler(
  run:ReconciliationRun,
  options:{ intervalMs:number; onStatus?:(status:'completed'|'failed')=>void },
):ReconciliationScheduler {
  const intervalMs=options.intervalMs
  if(!Number.isSafeInteger(intervalMs)||intervalMs<60_000||intervalMs>86_400_000)
    throw Error('RECONCILIATION_INVALID_INTERVAL')
  let stopping=false
  let active:Promise<'busy'|'completed'|'failed'>|null=null
  const trigger=():Promise<'busy'|'completed'|'failed'>=>{
    if(stopping||active)return Promise.resolve('busy')
    const work=(async():Promise<'completed'|'failed'>=>{
      try{
        const result=await run()
        if(result.status!=='completed')return 'failed'
        options.onStatus?.('completed')
        return 'completed'
      }catch {
        options.onStatus?.('failed')
        return 'failed'
      }
    })()
    active=work.then(result=>{active=null;return result})
    return active
  }
  const interval=setInterval(()=>{void trigger()},intervalMs)
  interval.unref()
  return {
    trigger,
    stop:async()=>{
      stopping=true
      clearInterval(interval)
      if(active)await active
    },
  }
}
