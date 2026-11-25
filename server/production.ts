import {randomUUID} from 'node:crypto'
import type {DatabaseSync, SQLOutputValue} from 'node:sqlite'
import type {CustomerReference, ReferenceKind} from '../shared/customer.ts'
import {validDeliveryDate} from '../shared/delivery-date.ts'
import type {BudgetLifecycleState, BudgetTransition, Experience, ExperienceInOperation, ExperienceParties, ProductionOverview} from '../shared/production.ts'
import {AtendimentoRepository} from './atendimentos.ts'
import {BudgetRepository} from './budgets.ts'
import {CustomerRepository} from './customers.ts'
import {parseDeliveryDate, writeDeliveryDate} from './delivery-date.ts'
import {ServiceError} from './errors.ts'
import {inputObject, transaction} from './scenarios.ts'
import {assertBudgetIdentity,WorkOrderRepository} from './work-orders.ts'

type Row = Record<string, SQLOutputValue>
const parties = {customer:'person', vehicle:'vehicle', payer:'payer'} as const
const transitioned = (row: Row): BudgetTransition => ({
  from: row.previous_state as BudgetTransition['from'],
  to: row.state as BudgetTransition['to'],
  origin: row.origin as BudgetTransition['origin'],
  occurredAt: String(row.occurred_at),
  reason: row.reason as string | null,
  actorSource: 'authenticated-session-confirmation',
  operatorId: null,
})
const stale = () => new ServiceError(409,'SCHEDULE_CONFLICT','O agendamento ou o Atendimento mudou. Atualize a consulta antes de confirmar.')

function experienceFrom(row: Row, deliveryDate: string | null): Experience {
  return {
    id: String(row.id), revision: Number(row.revision), scheduledEntry: String(row.scheduled_entry), deliveryDate,
    inOperation: row.in_operation===1,
    customer: JSON.parse(String(row.customer_json)) as CustomerReference,
    vehicle: JSON.parse(String(row.vehicle_json)) as CustomerReference,
    payer: JSON.parse(String(row.payer_json)) as CustomerReference,
  }
}

function sameReference(a: CustomerReference, b: CustomerReference) {
  return a.id===b.id && a.text===b.text && (a.plate??'')===(b.plate??'') &&
    (a.fabricationYear??null)===(b.fabricationYear??null) && (a.modelYear??null)===(b.modelYear??null)
}

export class ProductionRepository {
  private readonly budgets: BudgetRepository
  private readonly atendimentos: AtendimentoRepository
  private readonly customers: CustomerRepository
  private readonly orders: WorkOrderRepository

  private readonly db: DatabaseSync
  private readonly now: () => number

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db
    this.now = now
    this.budgets = new BudgetRepository(db)
    this.atendimentos = new AtendimentoRepository(db)
    this.customers = new CustomerRepository(db)
    this.orders = new WorkOrderRepository(db, now)
  }

  private row(at: string) {
    return this.db.prepare('SELECT * FROM production_experiences WHERE atendimento_id=?').get(at)
  }

  private append(at: string, version: string, from: BudgetLifecycleState, to: BudgetLifecycleState,
    origin: BudgetTransition['origin'], occurredAt: string, reason: string | null = null) {
    this.db.prepare(`INSERT INTO production_budget_transitions
      (atendimento_id,budget_version_id,previous_state,state,origin,occurred_at,reason) VALUES(?,?,?,?,?,?,?)`)
      .run(at,version,from,to,origin,occurredAt,reason)
  }

  private current(at: string, version: string): BudgetLifecycleState | null {
    const row = this.db.prepare(`SELECT c.budget_version_id AS cancelled, w.id AS work_order, w.experience_id,
      (SELECT t.state FROM production_budget_transitions t WHERE t.atendimento_id=b.atendimento_id AND t.budget_version_id=b.id
       ORDER BY t.id DESC LIMIT 1) AS state
      FROM budget_versions b LEFT JOIN work_orders w ON w.budget_version_id=b.id
      LEFT JOIN budget_cancellations c ON c.budget_version_id=b.id
      WHERE b.atendimento_id=? AND b.id=?`).get(at,version)
    if(!row)throw new ServiceError(404,'NOT_FOUND','Orçamento não encontrado neste Atendimento.')
    if(row.cancelled!=null)return 'cancelled'
    if(row.work_order!=null && row.experience_id==null)return null
    return (row.state ?? 'negotiating') as BudgetLifecycleState
  }

  private overview(at: string): ProductionOverview {
    const record = this.atendimentos.get(at,true)
    const {person,vehicle,payer} = record.references!
    const deliveryDate = record.deliveryDate ?? null
    const row = this.row(at)
    const history = new Map<string,BudgetTransition[]>()
    for(const event of this.db.prepare('SELECT * FROM production_budget_transitions WHERE atendimento_id=? ORDER BY id').all(at)){
      const version=String(event.budget_version_id)
      const events=history.get(version)??[]
      events.push(transitioned(event))
      history.set(version,events)
    }
    return {
      experience: row ? experienceFrom(row,deliveryDate) : null,
      atendimentoRevision: record.revision, deliveryDate, references: {person,vehicle,payer},
      budgets: this.budgets.list(at).map(item=>{
        const id=String(item.id), events=history.get(id)??[]
        return {
          id, label:String(item.label), total:String(item.total),
          ...(item.documentNumber ? {documentNumber:item.documentNumber} : {}),
          ...(item.workOrderNumber ? {workOrderNumber:item.workOrderNumber} : {}),
          legacyOrder:item.work_order_serial!=null && item.experienceId==null,
          state:item.cancelledAt!=null ? 'cancelled' : events.at(-1)?.to ?? (item.work_order_serial==null ? 'negotiating' : null),
          history:events,
        }
      }),
    }
  }

  get(at: string, inTransaction = false): ProductionOverview {
    if (inTransaction) return this.overview(at)
    // A deferred read transaction gives the experience, budgets and history one SQLite snapshot.
    this.db.exec('BEGIN')
    try {return this.overview(at)}
    finally {this.db.exec('ROLLBACK')}
  }

  listInOperation(): ExperienceInOperation[] {
    return this.db.prepare(`SELECT id,atendimento_id,customer_json,vehicle_json,scheduled_entry
      FROM production_experiences WHERE in_operation=1 ORDER BY scheduled_entry,id`).all().map(row=>({
      id:String(row.id), atendimentoId:String(row.atendimento_id),
      customer:JSON.parse(String(row.customer_json)) as CustomerReference,
      vehicle:JSON.parse(String(row.vehicle_json)) as CustomerReference,
      scheduledEntry:String(row.scheduled_entry),
    }))
  }

  setInOperation(at: string, input: unknown): ProductionOverview {
    const {inOperation}=inputObject(input,['inOperation'])
    if(typeof inOperation!=='boolean')
      throw new ServiceError(422,'INVALID_OPERATION_STATUS','Informe se a Experiência está em operação.')
    return transaction(this.db,()=>{
      if(!this.row(at))throw new ServiceError(404,'EXPERIENCE_NOT_FOUND','Agende o Atendimento para registrar a operação.')
      const status=Number(inOperation)
      this.db.prepare(`UPDATE production_experiences SET in_operation=?,updated_at=?
        WHERE atendimento_id=? AND in_operation<>?`).run(status,new Date(this.now()).toISOString(),at,status)
      return this.overview(at)
    })
  }

  schedule(at: string, input: unknown, inTransaction = false): ProductionOverview {
    const data=inputObject(input,['budgetIds','parties','scheduledEntry','deliveryDate','expectedAtendimentoRevision','expectedExperienceRevision'])
    const entry=data.scheduledEntry
    if(typeof entry!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(entry)||!validDeliveryDate(entry.slice(0,10)))
      throw new ServiceError(422,'INVALID_SCHEDULE','Informe uma data válida para a entrada e confira o horário, se preenchido.')
    const deliveryDate=parseDeliveryDate(data.deliveryDate)
    if(deliveryDate!==null && deliveryDate<entry.slice(0,10))
      throw new ServiceError(422,'INVALID_SCHEDULE','A entrega combinada deve ser na data da entrada ou depois.')
    const ids=data.budgetIds
    if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||id.length<1||id.length>100)||new Set(ids).size!==ids.length)
      throw new ServiceError(422,'INVALID_SCHEDULE_BUDGETS','Selecione orçamentos emitidos distintos deste Atendimento.')
    const write = () => {
      const record=this.atendimentos.get(at,true)
      const row=this.row(at)
      const previousDate=record.deliveryDate??null
      const existing=row?experienceFrom(row,previousDate):null
      if(!existing && !ids.length)
        throw new ServiceError(422,'SCHEDULE_BUDGET_REQUIRED','Selecione ao menos um orçamento emitido com consentimento comercial.')
      const pending: string[]=[]
      for(const id of ids as string[]){
        const state=this.current(at,id)
        if(state==='negotiating')pending.push(id)
        else if(state!=='consented'&&state!=='authorized'&&state!=='executed')
          throw new ServiceError(409,'BUDGET_NOT_SCHEDULABLE','Um dos orçamentos selecionados está indisponível para agendamento.')
      }
      const selected=this.scheduleParties(data.parties,record.references!,existing)
      for(const id of ids as string[])assertBudgetIdentity(this.budgets.get(at,id),selected)
      const sameSchedule=existing?.scheduledEntry===entry && previousDate===deliveryDate
      const unchanged=!!sameSchedule && !pending.length
      if(unchanged)return this.overview(at)
      if(data.expectedAtendimentoRevision!==record.revision || data.expectedExperienceRevision!==(existing?.revision??null))
        throw stale()
      const now=new Date(this.now()).toISOString()
      if(!existing){
        this.db.prepare(`INSERT INTO production_experiences
          (id,atendimento_id,customer_json,vehicle_json,payer_json,scheduled_entry,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),at,JSON.stringify(selected.customer),JSON.stringify(selected.vehicle),
          JSON.stringify(selected.payer),entry,now,now)
      }else{
        this.db.prepare('UPDATE production_experiences SET scheduled_entry=?,revision=revision+1,updated_at=? WHERE id=?')
          .run(entry,now,existing.id)
      }
      writeDeliveryDate(this.db,at,previousDate,deliveryDate,'Entrega combinada no agendamento da Experiência',now,true)
      for(const id of pending)this.append(at,id,'negotiating','consented','commercial',now)
      return this.overview(at)
    }
    return inTransaction ? write() : transaction(this.db, write)
  }

  private scheduleParties(raw: unknown, references: Record<ReferenceKind,CustomerReference[]>, existing: Experience | null): ExperienceParties {
    const data=raw===undefined?{}:inputObject(raw,Object.keys(parties))
    const choose=(key: keyof ExperienceParties,candidates: CustomerReference[])=>{
      const selection=data[key]
      const selected=selection===undefined
        ? (candidates.length===1?candidates[0]:undefined)
        : this.customers.validateReference(selection,parties[key])
      const confirmed=selected && candidates.find(ref=>sameReference(selected,ref))
      if(!confirmed)
        throw new ServiceError(409,'SCHEDULE_PARTIES_CONFLICT','Confira o cliente, o veículo e o pagador da Experiência.')
      return confirmed
    }
    const customer=choose('customer',existing?[existing.customer]:references.person.filter(ref=>ref.text))
    const vehicle=choose('vehicle',existing?[existing.vehicle]:references.vehicle.filter(ref=>ref.text||ref.plate))
    const registeredPayers=references.payer.filter(ref=>ref.text)
    const payer=choose('payer',existing?[existing.payer]:registeredPayers.length?registeredPayers:[customer])
    return {customer,vehicle,payer}
  }

  authorize(at: string, versionId: string, input: unknown) {
    const data=inputObject(input,['confirmed'])
    if(data.confirmed!==true)
      throw new ServiceError(422,'OS_AUTHORIZATION_REQUIRED','Confirme a autorização técnica do orçamento emitido.')
    return transaction(this.db,()=>{
      const state=this.current(at,versionId)
      if(state==='cancelled')throw new ServiceError(409,'BUDGET_CANCELLED','O orçamento está cancelado.')
      if(state==='authorized'||state==='executed')return this.orders.get(at,versionId)
      const row=this.row(at)
      if(state!=='consented'||!row)
        throw new ServiceError(409,'BUDGET_CONSENT_REQUIRED','Confirme o consentimento comercial no agendamento antes de autorizar.')
      const version=this.budgets.get(at,versionId)
      const experience=experienceFrom(row,this.atendimentos.get(at).deliveryDate??null)
      const now=new Date(this.now()).toISOString()
      this.append(at,versionId,'consented','authorized','technical',now)
      return this.orders.createAuthorized(at,version,experience,now)
    })
  }

  reject(at: string, versionId: string, origin: BudgetTransition['origin'], input: unknown) {
    const data=inputObject(input,['reason'])
    const reason=typeof data.reason==='string'?data.reason.trim():''
    if(reason.length<5 || reason.length>500)
      throw new ServiceError(422,'REJECTION_REASON_REQUIRED','Informe um motivo de 5 a 500 caracteres.')
    return transaction(this.db,()=>{
      const from=origin==='commercial'?'negotiating':'consented'
      const state=this.current(at,versionId)
      if(state==='rejected'){
        const last=this.db.prepare(`SELECT origin,reason FROM production_budget_transitions
          WHERE atendimento_id=? AND budget_version_id=? ORDER BY id DESC LIMIT 1`).get(at,versionId)
        if(last?.origin===origin && last.reason===reason)return this.overview(at)
      }
      if(state!==from)
        throw new ServiceError(409,'BUDGET_REJECTION_CONFLICT','O orçamento não está no estado exigido para esta rejeição.')
      this.append(at,versionId,from,'rejected',origin,new Date(this.now()).toISOString(),reason)
      return this.overview(at)
    })
  }
}
