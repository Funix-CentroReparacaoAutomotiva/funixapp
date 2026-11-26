import type { DatabaseSync } from 'node:sqlite'
import { validDeliveryDate } from '../../shared/delivery-date.ts'
import type { BudgetSnapshot } from '../../shared/pricing.ts'
import type { WorkOrderScope } from '../../shared/work-order.ts'
import { Q, ZERO } from '../exact.ts'
import { inputObject, transaction } from '../scenarios.ts'
import type { ErpRequest } from './contracts.ts'
import { isWorkshopPhase, listWorkshopPhases, listWorkshopVehicles, workshopDay, workshopError } from './workshop-read.ts'

const scale = 1_000_000_000_000n
const decimal = (value: string) => {
  const [integer, fraction = ''] = value.split('.')
  return new Q(BigInt(integer! + fraction), 10n ** BigInt(fraction.length))
}
function dayAfter(day: string) {
  const next = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString()
  return next.split('T')[0]!
}
const weekend = (day: string) => [0,6].includes(new Date(day + 'T00:00:00Z').getUTCDay())
const usablePhase = (value: unknown) => isWorkshopPhase(value) && value !== 'scheduled' && value !== 'departed'

export function migrateWorkshopPlanning(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE erp_workshop_resource (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, daily_energy TEXT NOT NULL, exclusive INTEGER NOT NULL CHECK(exclusive IN (0,1))
    );
    CREATE TABLE erp_workshop_holiday (day TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE erp_workshop_mapping (stage_id TEXT PRIMARY KEY, phase TEXT NOT NULL);
    CREATE TABLE erp_workshop_plan (
      source_id TEXT PRIMARY KEY, experience_id TEXT NOT NULL REFERENCES production_experiences(id) ON DELETE RESTRICT,
      resource_id TEXT NOT NULL REFERENCES erp_workshop_resource(id) ON DELETE RESTRICT,
      phase TEXT NOT NULL, energy TEXT NOT NULL, start_day TEXT NOT NULL, end_day TEXT NOT NULL,
      priority INTEGER NOT NULL, predecessor TEXT REFERENCES erp_workshop_plan(source_id),
      actual_start TEXT, actual_end TEXT, revision INTEGER NOT NULL CHECK(revision>0), source_fingerprint TEXT NOT NULL,
      CHECK(end_day>=start_day), CHECK(actual_end IS NULL OR actual_end>=actual_start)
    );
    CREATE INDEX erp_workshop_plan_window ON erp_workshop_plan(start_day,end_day);
    CREATE TABLE erp_workshop_plan_history (
      sequence INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES erp_workshop_plan(source_id),
      recorded_at TEXT NOT NULL, action TEXT NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
    );
  `)
}

function sources(db: DatabaseSync) {
  const mapping = new Map(db.prepare('SELECT stage_id,phase FROM erp_workshop_mapping').all()
    .map(row => [String(row.stage_id),String(row.phase)]))
  const rows = db.prepare(`SELECT w.id,w.experience_id,b.snapshot,w.scope_json,
    (SELECT scope_json FROM work_order_revisions WHERE work_order_id=w.id ORDER BY revision DESC LIMIT 1) AS revised_scope
    FROM work_orders w JOIN budget_versions b ON b.id=w.budget_version_id
    WHERE w.experience_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM budget_cancellations c WHERE c.budget_version_id=b.id)
    ORDER BY w.serial`).all()
  return rows.flatMap(row => {
    const snapshot = JSON.parse(String(row.snapshot)) as BudgetSnapshot
    const scope = JSON.parse(String(row.revised_scope ?? row.scope_json)) as WorkOrderScope
    const authorized = new Set(scope.lines.filter(line => line.kind === 'service').map(line => line.id))
    return snapshot.calculation.lines.filter(line => line.included && line.kind === 'service' && authorized.has(line.id)).flatMap(line => {
      const stages = line.stages.length ? line.stages : [{id:'',name:'Etapa técnica ausente',baseEnergy:null,dimensionEnergy:null}]
      return stages.map((stage, index) => {
        const defined = stage.baseEnergy !== null && stage.dimensionEnergy !== null
        return {
          id: JSON.stringify([row.id,line.id,index]), experienceId: String(row.experience_id),
          name: line.name, piece: line.pieceName, stageId: stage.id, stageName: stage.name,
          phase: mapping.get(stage.id) ?? null,
          energy: defined ? Q.from(stage.baseEnergy!).add(Q.from(stage.dimensionEnergy!)).mul(Q.from(line.quantity)).toString() : null,
        }
      })
    })
  })
}
type Source = ReturnType<typeof sources>[number]
const fingerprint = (source: Source) => JSON.stringify([source.stageId,source.phase,source.energy])
function readPlans(db: DatabaseSync) {
  return db.prepare('SELECT * FROM erp_workshop_plan ORDER BY priority,start_day,source_id').all().map(row => ({
    sourceId: String(row.source_id), experienceId: String(row.experience_id), resourceId: String(row.resource_id),
    phase: String(row.phase), energy: String(row.energy), start: String(row.start_day), end: String(row.end_day),
    priority: Number(row.priority), predecessor: row.predecessor as string|null,
    actualStart: row.actual_start as string|null, actualEnd: row.actual_end as string|null,
    revision: Number(row.revision), fingerprint: String(row.source_fingerprint),
  }))
}
type Plan = ReturnType<typeof readPlans>[number]
function readCalendar(db: DatabaseSync) {
  return new Set(db.prepare('SELECT day FROM erp_workshop_holiday ORDER BY day').all().map(row => String(row.day)))
}
function workingDays(start: string, end: string, holidays: Set<string>) {
  const days: string[] = []
  for (let day = start; day <= end; day = dayAfter(day)) {
    if (!weekend(day) && !holidays.has(day)) days.push(day)
    if (day === end) break
  }
  return days
}
function distribute(plan: Plan, holidays: Set<string>) {
  const days = workingDays(plan.start,plan.end,holidays)
  const energy = decimal(plan.energy)
  const units = energy.n * scale / energy.d
  const length = BigInt(days.length)
  return days.map((day,index) => ({day, energy:new Q(units / length + (index < units % length ? 1n : 0n), scale)}))
}
function readResources(db: DatabaseSync) {
  return db.prepare('SELECT * FROM erp_workshop_resource ORDER BY name,id').all()
    .map(row => ({id:String(row.id), name:String(row.name), dailyEnergy:String(row.daily_energy), exclusive:row.exclusive === 1}))
}
const text = (input: unknown, max: number) => typeof input === 'string' && input.trim() && input.trim().length <= max ? input.trim() : null

function setup({db,body}: ErpRequest) {
  const data = inputObject(body,['action','id','name','dailyEnergy','exclusive','day','stageId','phase'])
  return transaction(db, () => {
    switch (data.action) {
      case 'resource': {
        const id = text(data.id,100), name = text(data.name,120), capacity = text(data.dailyEnergy,20)
        if (!id || !name || !capacity || !/^\d{1,12}(?:\.\d{1,6})?$/.test(capacity) || Q.from(capacity).n === 0n)
          throw workshopError('Informe nome e capacidade diária positiva para o recurso.')
        if (data.exclusive === true) {
          const authorized = new Set(sources(db).map(source => source.id))
          const plans = readPlans(db).filter(plan => plan.resourceId === id && authorized.has(plan.sourceId))
          if (plans.some((plan,i) => plans.slice(i+1).some(other => plan.start <= other.end && other.start <= plan.end)))
            throw workshopError('Resolva as sobreposições antes de tornar o recurso exclusivo.',409)
        }
        db.prepare(`INSERT INTO erp_workshop_resource VALUES (?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,daily_energy=excluded.daily_energy,exclusive=excluded.exclusive`)
          .run(id,name,Q.from(capacity).toString(),Number(data.exclusive === true))
        break
      }
      case 'holiday': {
        const day = data.day, name = text(data.name,120)
        if (!validDeliveryDate(day) || !name) throw workshopError('Informe data e nome do feriado.')
        if (db.prepare('SELECT 1 FROM erp_workshop_plan WHERE start_day<=? AND end_day>=?').get(day,day))
          throw workshopError('Reprograme os serviços que abrangem a data antes de bloquear o dia.',409)
        db.prepare('INSERT INTO erp_workshop_holiday VALUES (?,?) ON CONFLICT(day) DO UPDATE SET name=excluded.name').run(day,name)
        break
      }
      case 'remove-holiday':
        if (!validDeliveryDate(data.day)) throw workshopError('Informe a data do feriado.')
        if (db.prepare('SELECT 1 FROM erp_workshop_plan WHERE start_day<=? AND end_day>=?').get(data.day,data.day))
          throw workshopError('Reprograme os serviços que abrangem a data antes de reabrir o dia.',409)
        db.prepare('DELETE FROM erp_workshop_holiday WHERE day=?').run(data.day)
        break
      case 'mapping': {
        const stageId = text(data.stageId,100)
        if (!stageId || !usablePhase(data.phase) || !sources(db).some(source => source.stageId === stageId))
          throw workshopError('Selecione uma etapa técnica da OS e sua fase operacional.')
        db.prepare('INSERT INTO erp_workshop_mapping VALUES (?,?) ON CONFLICT(stage_id) DO UPDATE SET phase=excluded.phase')
          .run(stageId,String(data.phase))
        break
      }
      default:
        throw workshopError('Configuração desconhecida.')
    }
    return {saved:true}
  })
}

function savePlan({db,body,now}: ErpRequest) {
  const data = inputObject(body,['sourceId','resourceId','start','end','priority','predecessor','revision','action','actualStart','actualEnd'])
  const sourceId = text(data.sourceId,500)
  const revision = data.revision
  if (!sourceId || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    throw workshopError('Serviço ou revisão inválidos.')
  return transaction(db, () => {
    const plans = readPlans(db), previous = plans.find(plan => plan.sourceId === sourceId)
    if ((previous?.revision ?? 0) !== revision) throw workshopError('O cronograma foi atualizado. Recarregue antes de gravar.',409)
    if (data.action !== undefined && data.action !== 'actual') throw workshopError('Ação de programação desconhecida.')
    if (data.action === 'actual') {
      const {actualStart, actualEnd} = data
      const today = workshopDay(now())
      if (!previous || !validDeliveryDate(actualStart) || actualStart > today ||
          (actualEnd != null && (!validDeliveryDate(actualEnd) || actualEnd < actualStart || actualEnd > today)))
        throw workshopError('Informe as datas realizadas, até hoje, na ordem correta.')
      if (previous.actualStart === actualStart && previous.actualEnd === (actualEnd ?? null)) return previous
      db.prepare('UPDATE erp_workshop_plan SET actual_start=?,actual_end=?,revision=revision+1 WHERE source_id=?')
        .run(actualStart,actualEnd ?? null,sourceId)
    } else {
      const {start,end,priority} = data
      const authorized = new Map(sources(db).map(item => [item.id,item]))
      const source = authorized.get(sourceId)
      const resource = readResources(db).find(item => item.id === data.resourceId)
      const predecessor = text(data.predecessor,500)
      if (!source || !source.phase || source.energy === null)
        throw workshopError('A OS ativa precisa de fase vinculada e energia definida para esse serviço.')
      if (!resource || !validDeliveryDate(start) || !validDeliveryDate(end) || start > end ||
          Date.parse(end) - Date.parse(start) > 90 * 86400000 || typeof priority !== 'number' ||
          !Number.isSafeInteger(priority) || priority < 0 || priority > 9999)
        throw workshopError('Informe recurso, prioridade e intervalo de até 91 dias.')
      const days = workingDays(start,end,readCalendar(db))
      if (days[0] !== start || days.at(-1) !== end) throw workshopError('O início e o fim devem ser dias úteis do calendário.')
      if (data.predecessor != null && !predecessor) throw workshopError('Etapa predecessora inválida.')
      const activePlans = plans.filter(plan => authorized.has(plan.sourceId))
      const parent = activePlans.find(plan => plan.sourceId === predecessor)
      if (predecessor && (!parent || parent.sourceId === sourceId || parent.experienceId !== source.experienceId || parent.end >= start))
        throw workshopError('A etapa predecessora da mesma Experiência precisa terminar antes do início.')
      if (activePlans.some(plan => plan.predecessor === sourceId && plan.start <= end))
        throw workshopError('O novo término conflita com uma etapa dependente.')
      if (resource.exclusive && activePlans.some(plan => plan.sourceId !== sourceId && plan.resourceId === resource.id && plan.start <= end && plan.end >= start))
        throw workshopError('O recurso exclusivo já está ocupado no intervalo.',409)
      db.prepare(`INSERT INTO erp_workshop_plan
        (source_id,experience_id,resource_id,phase,energy,start_day,end_day,priority,predecessor,revision,source_fingerprint)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(source_id) DO UPDATE SET resource_id=excluded.resource_id,phase=excluded.phase,energy=excluded.energy,
        start_day=excluded.start_day,end_day=excluded.end_day,priority=excluded.priority,predecessor=excluded.predecessor,
        revision=excluded.revision,source_fingerprint=excluded.source_fingerprint`)
        .run(sourceId,source.experienceId,resource.id,source.phase,source.energy,start,end,priority,predecessor,revision+1,fingerprint(source))
    }
    const saved = readPlans(db).find(plan => plan.sourceId === sourceId)!
    db.prepare('INSERT INTO erp_workshop_plan_history(source_id,recorded_at,action,snapshot) VALUES (?,?,?,?)')
      .run(sourceId,new Date(now()).toISOString(),data.action === 'actual' ? 'actual' : 'plan',JSON.stringify(saved))
    return saved
  })
}

export function workshopPlanning(request: ErpRequest): unknown {
  const {db,method,path,query,now} = request
  if (method === 'POST' && path === '/planning/setup') return setup(request)
  if (method === 'POST' && path === '/planning/segment') return savePlan(request)
  if (method === 'GET' && path === '/planning/history') {
    const sourceId = query.get('sourceId')
    if (!sourceId) throw workshopError('Informe o serviço.')
    return { events: db.prepare(`SELECT sequence,recorded_at AS recordedAt,action,snapshot
      FROM erp_workshop_plan_history WHERE source_id=? ORDER BY sequence DESC`).all(sourceId) }
  }
  if (method !== 'GET' || path !== '/planning') throw workshopError('Visão da Oficina não encontrada.',404)
  const today = workshopDay(now()), start = query.get('start') ?? today
  const length = Number(query.get('days') ?? 14)
  if (!validDeliveryDate(start) || !Number.isInteger(length) || length < 7 || length > 35)
    throw workshopError('Selecione uma janela de 7 a 35 dias.')
  const holidays = readCalendar(db), days: {day:string; holiday:boolean; weekend:boolean}[] = []
  let day = start
  for (let i = 0; i < length && validDeliveryDate(day); i++, day = dayAfter(day)) {
    days.push({day, holiday:holidays.has(day), weekend:weekend(day)})
  }
  const end = days.at(-1)!.day, source = sources(db), resources = readResources(db), plans = readPlans(db)
  const bySource = new Map(source.map(item => [item.id,item]))
  const vehicles = listWorkshopVehicles(db).filter(vehicle => !vehicle.departedAt ||
    plans.some(plan => plan.experienceId === vehicle.experienceId && plan.end >= start && plan.start <= end))
  const priorities = new Map<string,number>()
  for (const plan of plans) {
    const previous = priorities.get(plan.experienceId) ?? 10000
    if (plan.priority < previous) priorities.set(plan.experienceId,plan.priority)
  }
  vehicles.sort((a,b) => (priorities.get(a.experienceId) ?? 10000) - (priorities.get(b.experienceId) ?? 10000))
  const visible = plans.filter(plan => plan.end >= start && plan.start <= end ||
    plan.actualStart && plan.actualStart <= end && (plan.actualEnd ?? today) >= start).map(plan => {
    const item = bySource.get(plan.sourceId)
    return {...plan, name:item?.name ?? 'Serviço retirado do escopo',
      sourceChanged:!item || fingerprint(item) !== plan.fingerprint}
  })
  const load = new Map<string,Q>()
  const phaseLoad = new Map<string,Map<string,Q>>()
  for (const plan of visible.filter(plan => bySource.has(plan.sourceId))) {
    for (const slice of distribute(plan,holidays)) {
      if (slice.day < start || slice.day > end) continue
      const key = JSON.stringify([plan.resourceId,slice.day])
      load.set(key,(load.get(key) ?? ZERO).add(slice.energy))
      const phases = phaseLoad.get(key) ?? new Map<string,Q>()
      phases.set(plan.phase,(phases.get(plan.phase) ?? ZERO).add(slice.energy))
      phaseLoad.set(key,phases)
    }
  }
  const capacity = resources.map(resource => ({
    ...resource, days:days.map(date => {
      const key = JSON.stringify([resource.id,date.day]), planned = load.get(key) ?? ZERO
      const available = date.holiday || date.weekend ? ZERO : Q.from(resource.dailyEnergy)
      const phases = [...(phaseLoad.get(key) ?? new Map<string,Q>())].map(([phase,amount]) => ({phase,energy:amount.toString()}))
      return {...date, planned:planned.toString(), capacity:available.toString(), phases,
        percent:available.n ? planned.mul(new Q(100n)).div(available).ceil().toString() : null, overloaded:planned.cmp(available)>0}
    }),
  }))
  return {today,days,vehicles,resources,capacity,plans:visible,scheduledIds:plans.map(plan => plan.sourceId),
    dependencies:plans.filter(plan => bySource.has(plan.sourceId)).map(plan => ({sourceId:plan.sourceId,experienceId:plan.experienceId,end:plan.end,phase:plan.phase,
      name:bySource.get(plan.sourceId)?.name ?? 'Serviço retirado do escopo'})),
    sources:source, holidays:[...holidays], phases:listWorkshopPhases(db)}
}
