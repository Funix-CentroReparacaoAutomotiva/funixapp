import type { DatabaseSync } from 'node:sqlite'
import type { UpdatePackage } from '../shared/update-packages.ts'
import {
  simulateUpdatePackageExecution,actionSnapshotHash
} from './update-packages-execution-simulation.ts'
import type {
  SimulatedActionReceipt,SimulatedExecutionPlan
} from './update-packages-execution-simulation.ts'
import type { UpdatePackageRepository } from './update-packages.ts'

/**
 * Independent opt-in simulation schema. Data here is NEVER an external
 * execution receipt and must never promote an actual package to 'executed'.
 */
export function createUpdatePackageSimulationSchema(db:DatabaseSync):void {
 db.exec(`CREATE TABLE IF NOT EXISTS update_package_simulated_receipts (
  package_id TEXT NOT NULL REFERENCES update_packages(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
  action_id TEXT NOT NULL,
  action_hash TEXT NOT NULL CHECK(length(action_hash)=64),
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','failed')),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(package_id,action_id,attempt)
 )`)
}

/**
 * Only used by dedicated tests and simulation harnesses. Deliberately has
 * no connection to the HTTP API, n8n or any executor.
 */
export class UpdatePackageSimulationRepository {
 private readonly db:DatabaseSync
 private readonly packages:Pick<UpdatePackageRepository,'get'>
 private readonly clock:()=>string
 constructor(
  db:DatabaseSync,
  packages:Pick<UpdatePackageRepository,'get'>,
  clock:()=>string=()=>new Date().toISOString()
 ){
  this.db=db
  this.packages=packages
  this.clock=clock
 }

 private load(id:string):{pkg:UpdatePackage;receipts:SimulatedActionReceipt[]} {
  const pkg=this.packages.get(id)
  const rows=this.db.prepare(`SELECT action_id,action_hash,attempt,outcome
    FROM update_package_simulated_receipts WHERE package_id=?
    ORDER BY action_id,attempt`).all(id) as Array<{
    action_id:string;action_hash:string;attempt:number;outcome:'succeeded'|'failed'
  }>
  return {pkg,receipts:rows.map(x=>({
    actionId:x.action_id,actionHash:x.action_hash,
    attempt:x.attempt,outcome:x.outcome
  }))}
 }
 private project(pkg:UpdatePackage,receipts:SimulatedActionReceipt[]):SimulatedExecutionPlan {
  if (pkg.status!=='approved_pending_execution'&&pkg.status!=='execution_failed')
    throw new Error('SIMULATION_NOT_APPROVED')
  return simulateUpdatePackageExecution(pkg,receipts)
 }
 inspect(id:string):SimulatedExecutionPlan {
  const {pkg,receipts}=this.load(id)
  return this.project(pkg,receipts)
 }
 record(
  id:string,
  snapshot:{revision:number;snapshotHash:string},
  receipt:SimulatedActionReceipt
 ):SimulatedExecutionPlan {
  this.db.exec('BEGIN IMMEDIATE')
  try{
   const {pkg,receipts}=this.load(id)
   if(pkg.revision!==snapshot.revision || pkg.snapshotHash!==snapshot.snapshotHash)
     throw new Error('SIMULATION_SNAPSHOT_STALE')
   const action=pkg.actions.find(x=>x.id===receipt.actionId)
   if(!action || actionSnapshotHash(action)!==receipt.actionHash)
     throw new Error('SIMULATION_ACTION_CHANGED')
   const same=receipts.find(x=>x.actionId===receipt.actionId&&x.attempt===receipt.attempt)
   if(same && (same.actionHash!==receipt.actionHash||same.outcome!==receipt.outcome))
     throw new Error('SIMULATION_RECEIPT_CONFLICT')
   const next=same?receipts:[...receipts,receipt]
   const plan=this.project(pkg,next)
   if(!same){
    this.db.prepare(`INSERT INTO update_package_simulated_receipts
    (package_id,revision,snapshot_hash,action_id,action_hash,attempt,outcome,recorded_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      id,pkg.revision,pkg.snapshotHash,receipt.actionId,receipt.actionHash,
      receipt.attempt,receipt.outcome,this.clock())
   }
   this.db.exec('COMMIT')
   return plan
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
}
