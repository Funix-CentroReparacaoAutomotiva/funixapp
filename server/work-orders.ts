import {randomUUID} from 'node:crypto'
import type {DatabaseSync,SQLOutputValue} from 'node:sqlite'
import type {BudgetVersion} from '../shared/pricing.ts'
import type {Experience,ExperienceParties} from '../shared/production.ts'
import type {WorkOrder,WorkOrderScope} from '../shared/work-order.ts'
import {BudgetRepository} from './budgets.ts'
import {ServiceError} from './errors.ts'
import {inputObject,transaction} from './scenarios.ts'
import {stagePresentation} from './stage-presentation.ts'
import {correctOpticalWorkOrderScope} from '../shared/optical-work-order.ts'
import {AtendimentoRepository} from './atendimentos.ts'
import {parseDeliveryDate,writeDeliveryDate,deliveryReason} from './delivery-date.ts'

function issuedIdentity(version:BudgetVersion):Pick<WorkOrderScope,'customer'|'vehicle'> {
  const at=version.snapshot.atendimento
  return {
    customer:{name:at.name},
    vehicle:{description:at.vehicle||[at.brand,at.model].filter(Boolean).join(' '),plate:at.plate},
  }
}

const identityText=(value?:string|null)=>(value??'').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR')
const plateText=(value?:string|null)=>identityText(value).replace(/[\s-]+/g,'')
const conflicts=(issued:string,selected:string)=>issued!==''&&issued!==selected

export function assertBudgetIdentity(version:BudgetVersion,parties:Pick<ExperienceParties,'customer'|'vehicle'>) {
  const issued=issuedIdentity(version), at=version.snapshot.atendimento
  const {customer,vehicle}=parties
  const number=version.documentNumber??version.label
  if(conflicts(identityText(issued.customer.name),identityText(customer.text)))
    throw new ServiceError(409,'BUDGET_IDENTITY_CONFLICT',`O cliente do orçamento ${number} diverge do cliente selecionado. Confira a identificação ou emita um novo orçamento.`)
  if(conflicts(plateText(issued.vehicle.plate),plateText(vehicle.plate))||
    conflicts(identityText(issued.vehicle.description),identityText(vehicle.text))||
    conflicts(identityText(at.fabricationYear),identityText(vehicle.fabricationYear))||
    conflicts(identityText(at.modelYear),identityText(vehicle.modelYear)))
    throw new ServiceError(409,'BUDGET_IDENTITY_CONFLICT',`O veículo do orçamento ${number} diverge do veículo selecionado. Confira a identificação ou emita um novo orçamento.`)
}

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
  const scope:WorkOrderScope={
    ...issuedIdentity(version),
    diagnostics,lines,deadlineDays:typeof days==='number'&&Number.isSafeInteger(days)&&days>0?days:null
  }
  return correctOpticalWorkOrderScope(scope,frozen)??scope
}

const number=(serial:number)=>'OS-'+String(serial).padStart(6,'0')
function fromRow(row:Record<string,SQLOutputValue>):WorkOrder {
  return {
    id:String(row.id),number:number(Number(row.serial)),atendimentoId:String(row.atendimento_id),
    budgetVersionId:String(row.budget_version_id),budgetNumber:String(row.budget_number),
    budgetLabel:String(row.budget_label),createdAt:String(row.created_at),
    authorization:{confirmedAt:String(row.authorized_at),source:'authenticated-session-confirmation',operatorId:null},
    scope:JSON.parse(String(row.scope_json)) as WorkOrderScope,
    ...(row.experience_id==null?{}:{experienceId:String(row.experience_id)}),
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
  /** Caller holds the transaction and has recorded the technical decision. */
  createAuthorized(at:string,version:BudgetVersion,experience:Experience,createdAt:string):WorkOrder {
    if(!this.db.isTransaction)throw new Error('Work order creation requires a transaction.')
    assertBudgetIdentity(version,experience)
    const scope=operationalScope(version)
    if(!identityText(scope.customer.name))scope.customer.name=experience.customer.text
    if(!identityText(scope.vehicle.description))scope.vehicle.description=experience.vehicle.text
    if(!plateText(scope.vehicle.plate))scope.vehicle.plate=experience.vehicle.plate??''
    scope.deliveryDate=experience.deliveryDate
    const id=randomUUID()
    this.db.prepare(`INSERT INTO work_orders(id,atendimento_id,budget_version_id,created_at,authorized_at,authorization_source,
      authorized_by,budget_number,budget_label,scope_json,experience_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,at,version.id,createdAt,createdAt,'authenticated-session-confirmation',null,version.documentNumber??'',version.label,JSON.stringify(scope),experience.id)
    return this.get(at,version.id)
  }
  reissue(at:string,versionId:string,input:unknown):WorkOrder {
    const confirmation=inputObject(input,['authorized','deliveryChoice','deliveryDate','expectedAtendimentoRevision','expectedRevision','reason','correction'])
    const optical=confirmation.correction==='optical-stages-v1'
    if(confirmation.correction!==undefined&&(!optical||confirmation.deliveryChoice!==undefined||confirmation.deliveryDate!==undefined||confirmation.expectedAtendimentoRevision!==undefined||confirmation.reason!==undefined))
      throw new ServiceError(422,'OS_INVALID_CORRECTION','Correção técnica inválida ou combinada com outra alteração.')
    if(confirmation.authorized!==true||(!optical&&confirmation.deliveryChoice===undefined))
      throw new ServiceError(422,'OS_AUTHORIZATION_REQUIRED','Confirme explicitamente a nova emissão.')
    return transaction(this.db,()=>{
      const version=new BudgetRepository(this.db).get(at,versionId)
      if(version.cancellation)throw new ServiceError(409,'BUDGET_CANCELLED','Orçamento cancelado. Não é possível reemitir OS.')
      const latest=this.listRevisions(at,versionId)[0]!
      const revision=latest.revision??1
      if(confirmation.expectedRevision!==revision)
        throw new ServiceError(409,'OS_REVISION_CONFLICT','A OS já possui outra revisão. Atualize a consulta.')
      const now=new Date(this.now()).toISOString()
      let scope:WorkOrderScope,reason:string
      if(optical){
        const corrected=correctOpticalWorkOrderScope(latest.scope,version.snapshot)
        if(!corrected)throw new ServiceError(409,'OS_REVISION_UNCHANGED','Nenhuma etapa de restauração óptica elegível para correção.')
        scope=corrected
        reason='Correção de etapas de restauração óptica: lixamento, envernização e polimento'
      }else{
        const date=this.chosenDate(at,confirmation,now)
        if(date===(latest.scope.deliveryDate??null))
          throw new ServiceError(409,'OS_REVISION_UNCHANGED','A data prevista não mudou. Consulte a emissão existente.')
        scope={...latest.scope,deliveryDate:date}
        reason=deliveryReason(confirmation.reason,'Atualização da data prevista de entrega')
      }
      const id=randomUUID()
      this.db.prepare('INSERT INTO work_order_revisions(id,work_order_id,revision,created_at,authorized_at,reason,scope_json) VALUES(?,?,?,?,?,?,?)').run(id,latest.id,revision+1,now,now,reason,JSON.stringify(scope))
      return this.get(at,versionId,revision+1)
    })
  }
}
