import type {DatabaseSync} from 'node:sqlite'
import {acquisitionOrigins, acquisitionStatuses, orderComponents, type AcquisitionComponent, type AcquisitionStatus, type ComponentCustody} from '../../shared/acquisition.ts'
import type {WorkOrderScope} from '../../shared/work-order.ts'
import {BudgetRepository} from '../budgets.ts'
import {operationalScope} from '../work-orders.ts'
import {ServiceError} from '../errors.ts'
import {inputObject,transaction} from '../scenarios.ts'
import type {ErpRequest} from './contracts.ts'

export function migrateAcquisition(db:DatabaseSync) {
  db.exec(`
    CREATE TABLE erp_component_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      budget_version_id TEXT NOT NULL REFERENCES budget_versions(id) ON DELETE RESTRICT,
      line_id TEXT NOT NULL,
      experience_id TEXT NOT NULL REFERENCES production_experiences(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('identified','requested','approved','received')),
      origin TEXT NOT NULL CHECK(length(origin)<=80),
      status_updated_at TEXT NOT NULL,
      custody TEXT CHECK(custody IN ('stored','out')),
      custody_updated_at TEXT,
      recorded_at TEXT NOT NULL,
      CHECK((status='received' AND custody IS NOT NULL AND custody_updated_at IS NOT NULL)
         OR (status<>'received' AND custody IS NULL AND custody_updated_at IS NULL))
    );
    CREATE INDEX erp_component_events_line ON erp_component_events(budget_version_id,line_id,sequence DESC);
    CREATE INDEX erp_component_events_experience ON erp_component_events(experience_id);
    CREATE TRIGGER erp_component_events_update BEFORE UPDATE ON erp_component_events
    BEGIN SELECT RAISE(ABORT,'Histórico dos componentes imutável'); END;
    CREATE TRIGGER erp_component_events_delete BEFORE DELETE ON erp_component_events
    BEGIN SELECT RAISE(ABORT,'Histórico dos componentes imutável'); END;
  `)
}
function invalid(message:string):never {throw new ServiceError(422,'COMPONENT_INVALID',message)}
function identifier(value:unknown):string {
  if(typeof value!=='string'||!value||value.length>160)invalid('Identificação de componente inválida.')
  return value
}

/** Only versions with the explicit experience relationship (consent or linked OS) are included.
 * Cancelled versions retain tracked lines (including late arrivals), but cannot create new needs. */
export function listAcquisition(db:DatabaseSync,experienceId:string|null=null,budgetId:string|null=null):AcquisitionComponent[] {
  if(experienceId&&!db.prepare('SELECT 1 FROM production_experiences WHERE id=?').get(experienceId))
    throw new ServiceError(404,'EXPERIENCE_NOT_FOUND','Experiência não encontrada.')
  const sources=db.prepare(`
    SELECT e.id experience_id,e.atendimento_id,b.id budget_id,b.created_at,
      json_extract(e.vehicle_json,'$.text') vehicle,json_extract(e.vehicle_json,'$.plate') plate,
      w.id order_id,w.serial order_serial,COALESCE(r.scope_json,w.scope_json) order_scope,
      c.cancelled_at,
      (SELECT t.state FROM production_budget_transitions t
        WHERE t.budget_version_id=b.id AND t.atendimento_id=e.atendimento_id ORDER BY t.id DESC LIMIT 1) state
    FROM production_experiences e JOIN budget_versions b ON b.atendimento_id=e.atendimento_id
    LEFT JOIN work_orders w ON w.budget_version_id=b.id AND w.experience_id=e.id
    LEFT JOIN work_order_revisions r ON r.work_order_id=w.id
      AND r.revision=(SELECT MAX(revision) FROM work_order_revisions WHERE work_order_id=w.id)
    LEFT JOIN budget_cancellations c ON c.budget_version_id=b.id
    WHERE (? IS NULL OR e.id=?) AND (? IS NULL OR b.id=?)
      AND NOT EXISTS(SELECT 1 FROM work_orders legacy WHERE legacy.budget_version_id=b.id AND legacy.experience_id IS NOT e.id)
      AND (w.id IS NOT NULL OR state IN ('consented','authorized','executed') OR EXISTS(
        SELECT 1 FROM erp_component_events ev WHERE ev.budget_version_id=b.id AND ev.experience_id=e.id))
    ORDER BY e.scheduled_entry,e.id,b.sequence
  `).all(experienceId,experienceId,budgetId,budgetId)
  const result:AcquisitionComponent[]=[]
  const repo=new BudgetRepository(db)
  for(const source of sources) {
    const version=repo.get(String(source.atendimento_id),String(source.budget_id))
    const cancelled=source.cancelled_at!==null||source.state==='rejected'
    const scope=source.order_scope===null?operationalScope(version):JSON.parse(String(source.order_scope)) as WorkOrderScope
    const latestEvents=new Map(db.prepare(`
      SELECT ev.* FROM erp_component_events ev WHERE ev.budget_version_id=? AND ev.experience_id=?
      AND ev.sequence=(SELECT MAX(e.sequence) FROM erp_component_events e WHERE e.budget_version_id=ev.budget_version_id AND e.line_id=ev.line_id)
    `).all(version.id,source.experience_id).map(row=>[String(row.line_id),row]))
    for(const item of orderComponents(scope)) {
      const event=latestEvents.get(item.id)
      if(cancelled&&!event)continue
      result.push({
        experienceId:String(source.experience_id),atendimentoId:version.atendimentoId,
        budgetVersionId:version.id,budgetNumber:version.documentNumber??version.label,
        orderId:source.order_id===null?null:String(source.order_id),
        orderNumber:source.order_serial===null?null:'OS-'+String(source.order_serial).padStart(6,'0'),
        lineId:item.id,code:item.code,name:item.name,pieceName:item.pieceName,quantity:item.quantity,
        vehicle:String(source.vehicle??''),plate:String(source.plate??''),
        status:(event?.status??'identified') as AcquisitionStatus,origin:String(event?.origin??''),
        statusUpdatedAt:String(event?.status_updated_at??version.createdAt),
        custody:(event?.custody??null) as ComponentCustody|null,
        custodyUpdatedAt:event?.custody_updated_at?String(event.custody_updated_at):null,
        revision:Number(event?.sequence??0),cancelled,
      })
    }
  }
  return result
}

function updateAcquisition(db:DatabaseSync,body:unknown,now:string) {
  const data=inputObject(body,['experienceId','budgetVersionId','lineId','revision','status','origin','custody'])
  const experienceId=identifier(data.experienceId),budgetId=identifier(data.budgetVersionId),lineId=identifier(data.lineId)
  if(typeof data.revision!=='number'||!Number.isSafeInteger(data.revision)||data.revision<0)invalid('Revisão inválida.')
  if(data.status===undefined&&data.custody===undefined&&data.origin===undefined)invalid('Informe a alteração.')
  return transaction(db,()=>{
    const current=listAcquisition(db,experienceId,budgetId).find(item=>item.lineId===lineId)
    if(!current)throw new ServiceError(404,'COMPONENT_NOT_FOUND','Componente não encontrado no escopo vinculado.')
    const status=(data.status??current.status) as AcquisitionStatus
    if(!acquisitionStatuses.includes(status))invalid('Status de aquisição inválido.')
    if(acquisitionStatuses.indexOf(status)<acquisitionStatuses.indexOf(current.status))invalid('Não é possível retroceder o status de aquisição.')
    if(current.cancelled&&((status!==current.status&&status!=='received')||(data.origin!==undefined&&data.origin!==current.origin)))invalid('A aquisição foi cancelada. Registre somente recebimento já solicitado ou situação física.')
    const origin=data.origin===undefined?current.origin:data.origin
    if(typeof origin!=='string'||(origin!==''&&!acquisitionOrigins.some(value=>value===origin)))invalid('Selecione a origem do fornecimento.')
    if(status!=='identified'&&!origin)invalid('Defina a origem do fornecimento.')
    let custody=current.custody
    if(status==='received'&&current.status!=='received')custody='stored'
    if(data.custody!==undefined) {
      if(current.status!=='received'||(data.custody!=='stored'&&data.custody!=='out'))invalid('A situação física só pode ser alterada após o recebimento.')
      custody=data.custody
    }
    if(current.status===status&&current.origin===origin&&current.custody===custody)return current
    if(current.revision!==data.revision)throw new ServiceError(409,'COMPONENT_REVISION_CONFLICT','Componente atualizado em outra tela. Recarregue antes de continuar.')
    db.prepare(`INSERT INTO erp_component_events(budget_version_id,line_id,experience_id,status,origin,status_updated_at,custody,custody_updated_at,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(budgetId,lineId,experienceId,status,origin,
        current.status===status?current.statusUpdatedAt:now,custody,
        current.custody===custody?current.custodyUpdatedAt:now,now)
    return listAcquisition(db,experienceId,budgetId).find(item=>item.lineId===lineId)!
  })
}

export function handleAcquisition({db,method,path,query,body,now}:ErpRequest) {
  if(path==='/items'&&method==='GET')return {items:listAcquisition(db,query.has('experienceId')?identifier(query.get('experienceId')):null)}
  if(path==='/update'&&method==='POST')return updateAcquisition(db,body,new Date(now()).toISOString())
  throw new ServiceError(404,'NOT_FOUND','Operação de componentes indisponível.')
}
