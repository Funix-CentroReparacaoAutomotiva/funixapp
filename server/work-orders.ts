import {randomUUID} from 'node:crypto'
import type {DatabaseSync,SQLOutputValue} from 'node:sqlite'
import type {BudgetVersion} from '../shared/pricing.ts'
import type {WorkOrder,WorkOrderScope} from '../shared/work-order.ts'
import {BudgetRepository} from './budgets.ts'
import {ServiceError} from './errors.ts'
import {inputObject,transaction} from './scenarios.ts'

export function operationalScope(version:BudgetVersion):WorkOrderScope {
  // Only the immutable issued calculation decides which work is authorized.
  // Do not read mutable scenarios, catalog, current Atendimento or live prices.
  const frozen=version.snapshot
  const included=frozen.calculation.lines.filter(line=>line.included)
  if(!included.length)throw new ServiceError(422,'OS_EMPTY_SCOPE','Esta versão não contém serviços ou componentes incluídos.')
  const activePieces=new Set(included.map(line=>line.pieceId))
  const catalog=new Map(frozen.composition.catalog.map(item=>[item.id,item.name]))
  const diagnostics=frozen.composition.items.filter(item=>activePieces.has(item.id)).map(item=>({
    pieceId:item.id,pieceName:catalog.get(item.pieceId)??included.find(line=>line.pieceId===item.id)?.pieceName??'',
    diagnosis:catalog.get(item.diagnosisId??'')??included.find(line=>line.pieceId===item.id&&line.diagnosis)?.diagnosis??'',
    intensity:item.intensity??null,notes:item.notes
  }))
  const lines=included.map(line=>({
    id:line.id,pieceId:line.pieceId,kind:line.kind,pieceName:line.pieceName,name:line.name,
    diagnosis:line.diagnosis,dimension:line.dimension,quantity:line.quantity,notes:line.notes,
    stages:line.stages.map(stage=>({name:stage.name,dimension:stage.dimension}))
  }))
  const days=frozen.executionDeadline?.effectiveDays
  return {
    customer:{name:frozen.atendimento.name},
    vehicle:{
      description:frozen.atendimento.vehicle||[frozen.atendimento.brand,frozen.atendimento.model].filter(Boolean).join(' '),
      plate:frozen.atendimento.plate
    },
    diagnostics,lines,deadlineDays:typeof days==='number'&&Number.isSafeInteger(days)&&days>0?days:null
  }
}

const number=(serial:number)=>'OS-'+String(serial).padStart(6,'0')
function fromRow(row:Record<string,SQLOutputValue>):WorkOrder {
  return {
    id:String(row.id),number:number(Number(row.serial)),atendimentoId:String(row.atendimento_id),
    budgetVersionId:String(row.budget_version_id),budgetNumber:String(row.budget_number),
    budgetLabel:String(row.budget_label),createdAt:String(row.created_at),
    authorization:{confirmedAt:String(row.authorized_at),source:'authenticated-session-confirmation',operatorId:null},
    scope:JSON.parse(String(row.scope_json)) as WorkOrderScope,
    ...(row.cancelled_at==null?{}:{cancellation:{cancelledAt:String(row.cancelled_at),reason:String(row.cancellation_reason)}})
  }
}
export class WorkOrderRepository {
  private readonly db:DatabaseSync
  private readonly now:()=>number
  constructor(db:DatabaseSync,now:()=>number=Date.now){this.db=db;this.now=now}
  get(at:string,versionId:string):WorkOrder {
    const row=this.db.prepare('SELECT w.*,c.cancelled_at,c.reason AS cancellation_reason FROM work_orders w LEFT JOIN budget_cancellations c ON c.budget_version_id=w.budget_version_id WHERE w.atendimento_id=? AND w.budget_version_id=?').get(at,versionId)
    if(row)return fromRow(row)
    // Distinguish a missing OS from an invalid or cross-Attendimento version.
    new BudgetRepository(this.db).get(at,versionId)
    throw new ServiceError(404,'OS_NOT_FOUND','Ainda não existe OS para esta versão emitida.')
  }
  create(at:string,versionId:string,input:unknown):WorkOrder {
    const confirmation=inputObject(input,['authorized'])
    if(confirmation.authorized!==true)
      throw new ServiceError(422,'OS_AUTHORIZATION_REQUIRED','Confirme a autorização de execução da versão emitida.')
    // BEGIN IMMEDIATE serializes competing requests even across SQLite processes.
    // A unique budget_version_id is a second line of defense against retries.
    return transaction(this.db,()=>{
      const version=new BudgetRepository(this.db).get(at,versionId)
      if(version.cancellation)throw new ServiceError(409,'BUDGET_CANCELLED','Orçamento cancelado. Não é possível criar ou reemitir OS.')
      const existing=this.db.prepare('SELECT * FROM work_orders WHERE atendimento_id=? AND budget_version_id=?').get(at,versionId)
      if(existing)return fromRow(existing)
      const scope=operationalScope(version)
      const createdAt=new Date(this.now()).toISOString(),id=randomUUID()
      this.db.prepare('INSERT INTO work_orders(id,atendimento_id,budget_version_id,created_at,authorized_at,authorization_source,authorized_by,budget_number,budget_label,scope_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id,at,versionId,createdAt,createdAt,'authenticated-session-confirmation',null,version.documentNumber??'',version.label,JSON.stringify(scope))
      const row=this.db.prepare('SELECT * FROM work_orders WHERE id=?').get(id)!
      return fromRow(row)
    })
  }
}
