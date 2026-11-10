import { createHash } from 'node:crypto'
import type { UpdatePackage, UpdatePackageAction } from '../shared/update-packages.ts'

/**
 * Dry-run execution state reducer. NO external actions, database writes or
 * automated state changes. Production execution requires a separately approved
 * executor, trusted receipts and atomic persistence of outcomes.
 */
export type SimulatedActionReceipt = {
  actionId:string
  actionHash:string
  attempt:number
  outcome:'succeeded'|'failed'
}
export type SimulatedExecutionPlan = {
  nextStatus:'approved_pending_execution'|'execution_failed'|'executed'
  succeeded:string[]
  failed:string[]
  pending:string[]
  retryable:string[]
}
export const actionSnapshotHash=(action:UpdatePackageAction):string=>
  createHash('sha256').update(JSON.stringify(action)).digest('hex')

export function simulateUpdatePackageExecution(
  pkg:Pick<UpdatePackage,'status'|'actions'>,
  receipts:readonly SimulatedActionReceipt[]
):SimulatedExecutionPlan {
  if(!['approved_pending_execution','execution_failed'].includes(pkg.status)) {
    throw new Error('EXECUTION_NOT_APPROVED')
  }
  if(!Array.isArray(pkg.actions)||!pkg.actions.length ||
    new Set(pkg.actions.map(a=>a.id)).size!==pkg.actions.length ||
    !Array.isArray(receipts))throw new Error('EXECUTION_INVALID')
  const snapshots=new Map(pkg.actions.map(a=>[a.id,actionSnapshotHash(a)]))
  const entries=new Map<string,Map<number,SimulatedActionReceipt>>()
  for(const receipt of receipts) {
    if(!receipt||!snapshots.has(receipt.actionId) ||
      receipt.actionHash!==snapshots.get(receipt.actionId) ||
      !Number.isSafeInteger(receipt.attempt)||receipt.attempt<1||
      !['succeeded','failed'].includes(receipt.outcome)) {
      throw new Error('EXECUTION_RECEIPT_INVALID')
    }
    let byAttempt=entries.get(receipt.actionId)
    if(!byAttempt){byAttempt=new Map();entries.set(receipt.actionId,byAttempt)}
    const existing=byAttempt.get(receipt.attempt)
    if(existing && JSON.stringify(existing)!==JSON.stringify(receipt)) {
      throw new Error('EXECUTION_RECEIPT_CONFLICT')
    }
    byAttempt.set(receipt.attempt,receipt)
  }
  const succeeded:string[]=[],failed:string[]=[],pending:string[]=[],retryable:string[]=[]
  for(const action of pkg.actions) {
    const attempts=[...(entries.get(action.id)?.values()??[])].sort((a,b)=>a.attempt-b.attempt)
    if(attempts.some((r,i)=>r.attempt!==i+1))throw new Error('EXECUTION_ATTEMPT_GAP')
    const firstSuccess=attempts.findIndex(r=>r.outcome==='succeeded')
    if(firstSuccess>=0 && firstSuccess!==attempts.length-1)throw new Error('EXECUTION_RETRY_AFTER_SUCCESS')
    const latest=attempts.at(-1)
    if(latest?.outcome==='succeeded')succeeded.push(action.id)
    else if(latest?.outcome==='failed'){failed.push(action.id);retryable.push(action.id)}
    else{pending.push(action.id);retryable.push(action.id)}
  }
  return {
    nextStatus:succeeded.length===pkg.actions.length?'executed':
      failed.length?'execution_failed':'approved_pending_execution',
    succeeded,failed,pending,retryable
  }
}
