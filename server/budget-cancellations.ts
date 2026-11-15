import type {DatabaseSync} from 'node:sqlite'
import {BudgetRepository} from './budgets.ts'
import {ServiceError} from './errors.ts'
import {inputObject,transaction} from './scenarios.ts'

export interface BudgetCancellation {cancelledAt:string;reason:string}
export class BudgetCancellationRepository {
 constructor(private readonly db:DatabaseSync,private readonly now:()=>number=Date.now){}
 cancel(at:string,versionId:string,input:unknown):BudgetCancellation{
  const data=inputObject(input,['reason'])
  const reason=typeof data.reason==='string'?data.reason.trim():''
  if(reason.length<5||reason.length>500)
   throw new ServiceError(422,'CANCELLATION_REASON_REQUIRED','Informe um motivo entre 5 e 500 caracteres.')
  return transaction(this.db,()=>{
   new BudgetRepository(this.db).get(at,versionId)
   const existing=this.db.prepare('SELECT cancelled_at,reason FROM budget_cancellations WHERE atendimento_id=? AND budget_version_id=?').get(at,versionId)
   if(existing)return{cancelledAt:String(existing.cancelled_at),reason:String(existing.reason)}
   const cancelledAt=new Date(this.now()).toISOString()
   this.db.prepare('INSERT INTO budget_cancellations(budget_version_id,atendimento_id,cancelled_at,reason) VALUES (?,?,?,?)')
    .run(versionId,at,cancelledAt,reason)
   return {cancelledAt,reason}
  })
 }
}
