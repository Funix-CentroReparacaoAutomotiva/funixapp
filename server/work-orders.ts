import {randomUUID} from 'node:crypto'
import type {DatabaseSync,SQLOutputValue} from 'node:sqlite'
import type {BudgetVersion} from '../shared/pricing.ts'
import type {WorkOrder,WorkOrderScope} from '../shared/work-order.ts'
import {BudgetRepository} from './budgets.ts'
import {ServiceError} from './errors.ts'
import {inputObject,transaction} from './scenarios.ts'
import {stagePresentation} from './stage-presentation.ts'
import {AtendimentoRepository} from './atendimentos.ts'
import {parseDeliveryDate,writeDeliveryDate,deliveryReason} from './delivery-date.ts'

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
    stages:line.stages.map(stage=>{
      const source=frozen.composition.items.find(item=>item.id===line.pieceId)?.services.find(service=>service.id===line.id)
      const presentation=source?.dimensionId?stagePresentation(stage,source.serviceId,source.dimensionId):stage.presentation
      return{name:stage.name,dimension:stage.dimension,cluster:presentation?.cluster??null}
    })
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
  get(at:string,versionId:string,revision=1):WorkOrder {
    const row=this.db.prepare('SELECT w.*,c.cancelled_at,c.reason AS cancellation_reason FROM work_orders w LEFT JOIN budget_cancellations c ON c.budget_version_id=w.budget_version_id WHERE w.atendimento_id=? AND w.budget_version_id=?').get(at,versionId)
    if(row){
      const original=fromRow(row)
      if(revision===1)return original
      const later=this.db.prepare('SELECT * FROM work_order_revisions WHERE work_order_id=? AND revision=?').get(original.id,revision)
      if(!later)throw new ServiceError(404,'OS_REVISION_NOT_FOUND','Revisão da OS não encontrada.')
      return {...original,createdAt:String(later.created_at),authorization:{...original.authorization,confirmedAt:String(later.authorized_at)},scope:JSON.parse(String(later.scope_json)) as WorkOrderScope,revision:Number(later.revision),revisionId:String(later.id),revisionReason:String(later.reason)}
    }
    // Distinguish a missing OS from an invalid or cross-Attendimento version.
    new BudgetRepository(this.db).get(at,versionId)
    throw new ServiceError(404,'OS_NOT_FOUND','Ainda não existe OS para esta versão emitida.')
  }
  listRevisions(at:string,versionId:string):WorkOrder[] {
    const original=this.get(at,versionId)
    const rows=this.db.prepare('SELECT revision FROM work_order_revisions WHERE work_order_id=? ORDER BY revision DESC').all(original.id)
    return [...rows.map(row=>this.get(at,versionId,Number(row.revision))),original]
  }
  private chosenDate(at:string,confirmation:Record<string,unknown>,now:string):string|null {
    const record=new AtendimentoRepository(this.db).get(at)
    const current=record.deliveryDate??null
    const choice=confirmation.deliveryChoice
    // Legacy caller compatibility; the UI always sends an explicit choice.
    if(choice===undefined){
      if(confirmation.deliveryDate!==undefined||confirmation.expectedAtendimentoRevision!==undefined)
        throw new ServiceError(422,'DELIVERY_CHOICE_REQUIRED','Escolha emitir com ou sem data.')
      return current
    }
    if(confirmation.expectedAtendimentoRevision!==record.revision)
      throw new ServiceError(409,'VERSION_CONFLICT','O Atendimento mudou. Consulte a data atual antes de emitir.')
    if(choice==='without'){
      if(current!==null||confirmation.deliveryDate!==undefined)
        throw new ServiceError(409,'DELIVERY_CHOICE_CONFLICT','Para emitir sem data, a previsão precisa estar vazia.')
      return null
    }
    if(choice!=='with')throw new ServiceError(422,'DELIVERY_CHOICE_REQUIRED','Escolha emitir com ou sem data.')
    const date=parseDeliveryDate(confirmation.deliveryDate)
    if(date===null)throw new ServiceError(422,'INVALID_DELIVERY_DATE','Informe a data prevista de entrega.')
    if(current!==null&&current!==date)
      throw new ServiceError(409,'DELIVERY_CHOICE_CONFLICT','Altere a previsão nas configurações do Atendimento antes de emitir.')
    writeDeliveryDate(this.db,at,current,date,'Data informada manualmente na emissão da OS',now,true)
    return date
  }
  create(at:string,versionId:string,input:unknown):WorkOrder {
    const confirmation=inputObject(input,['authorized','deliveryChoice','deliveryDate','expectedAtendimentoRevision'])
    if(confirmation.authorized!==true)
      throw new ServiceError(422,'OS_AUTHORIZATION_REQUIRED','Confirme a autorização de execução da versão emitida.')
    // BEGIN IMMEDIATE serializes competing requests even across SQLite processes.
    // A unique budget_version_id is a second line of defense against retries.
    return transaction(this.db,()=>{
      const version=new BudgetRepository(this.db).get(at,versionId)
      if(version.cancellation)throw new ServiceError(409,'BUDGET_CANCELLED','Orçamento cancelado. Não é possível criar ou reemitir OS.')
      const existing=this.db.prepare('SELECT * FROM work_orders WHERE atendimento_id=? AND budget_version_id=?').get(at,versionId)
      if(existing){
        const original=fromRow(existing)
        if(confirmation.deliveryChoice!==undefined){
          const expected=confirmation.deliveryChoice==='with'?parseDeliveryDate(confirmation.deliveryDate):confirmation.deliveryChoice==='without'&&confirmation.deliveryDate===undefined?null:undefined
          if(expected===undefined||confirmation.deliveryChoice==='with'&&expected===null||expected!==(original.scope.deliveryDate??null))
            throw new ServiceError(409,'OS_ALREADY_ISSUED','A OS já foi emitida com outra previsão. Consulte o documento existente.')
        }
        return original
      }
      const scope=operationalScope(version)
      const createdAt=new Date(this.now()).toISOString(),id=randomUUID()
      const deliveryDate=this.chosenDate(at,confirmation,createdAt)
      if(deliveryDate!==null||confirmation.deliveryChoice!==undefined)scope.deliveryDate=deliveryDate
      this.db.prepare('INSERT INTO work_orders(id,atendimento_id,budget_version_id,created_at,authorized_at,authorization_source,authorized_by,budget_number,budget_label,scope_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id,at,versionId,createdAt,createdAt,'authenticated-session-confirmation',null,version.documentNumber??'',version.label,JSON.stringify(scope))
      const row=this.db.prepare('SELECT * FROM work_orders WHERE id=?').get(id)!
      return fromRow(row)
    })
  }
  reissue(at:string,versionId:string,input:unknown):WorkOrder {
    const confirmation=inputObject(input,['authorized','deliveryChoice','deliveryDate','expectedAtendimentoRevision','expectedRevision','reason'])
    if(confirmation.authorized!==true||confirmation.deliveryChoice===undefined)
      throw new ServiceError(422,'OS_AUTHORIZATION_REQUIRED','Confirme explicitamente a nova emissão.')
    return transaction(this.db,()=>{
      const version=new BudgetRepository(this.db).get(at,versionId)
      if(version.cancellation)throw new ServiceError(409,'BUDGET_CANCELLED','Orçamento cancelado. Não é possível reemitir OS.')
      const latest=this.listRevisions(at,versionId)[0]!
      const revision=latest.revision??1
      if(confirmation.expectedRevision!==revision)
        throw new ServiceError(409,'OS_REVISION_CONFLICT','A OS já possui outra revisão. Atualize a consulta.')
      const now=new Date(this.now()).toISOString()
      const date=this.chosenDate(at,confirmation,now)
      if(date===(latest.scope.deliveryDate??null))
        throw new ServiceError(409,'OS_REVISION_UNCHANGED','A data prevista não mudou. Consulte a emissão existente.')
      const scope={...latest.scope,deliveryDate:date}
      const id=randomUUID()
      const reason=deliveryReason(confirmation.reason,'Atualização da data prevista de entrega')
      this.db.prepare('INSERT INTO work_order_revisions(id,work_order_id,revision,created_at,authorized_at,reason,scope_json) VALUES(?,?,?,?,?,?,?)').run(id,latest.id,revision+1,now,now,reason,JSON.stringify(scope))
      return this.get(at,versionId,revision+1)
    })
  }
}
