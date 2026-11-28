import type { DatabaseSync } from 'node:sqlite'
import { workshopPhases, type WorkshopPhase, type WorkshopVehicle } from '../../shared/erp.ts'
import { ServiceError } from '../errors.ts'

export const phaseIds = workshopPhases.map(phase => phase.id)
export function isWorkshopPhase(value: unknown): value is WorkshopPhase {
  return typeof value === 'string' && phaseIds.includes(value as WorkshopPhase)
}
export const workshopDay = (ms: number) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(ms)
export const workshopError = (message: string, status = 422) => new ServiceError(status, 'WORKSHOP_VALIDATION', message)

type YardVehicle = WorkshopVehicle & { revision: number; enteredAt: string|null; year: string|null; requiresClassification: boolean }
export function listWorkshopVehicles(db: DatabaseSync): YardVehicle[] {
  return db.prepare(`
    SELECT e.id, e.atendimento_id, e.scheduled_entry, e.in_operation, a.delivery_date,
      COALESCE(NULLIF(json_extract(e.vehicle_json,'$.text'),''),NULLIF(a.vehicle,''),a.model) AS model,
      COALESCE(NULLIF(json_extract(e.vehicle_json,'$.plate'),''),a.plate) AS plate,
      json_extract(e.customer_json,'$.text') AS customer,
      json_extract(e.payer_json,'$.text') AS payer,
      json_extract(e.vehicle_json,'$.modelYear') AS year,
      w.sequence,w.phase,w.blocked,w.entered_at,w.departed_at,w.commercial_closed_at,
      EXISTS(SELECT 1 FROM work_orders legacy WHERE legacy.atendimento_id=e.atendimento_id AND legacy.experience_id IS NULL) AS legacy_order
    FROM production_experiences e JOIN atendimentos a ON a.id=e.atendimento_id
    LEFT JOIN erp_workshop_events w ON w.sequence=(
      SELECT sequence FROM erp_workshop_events WHERE experience_id=e.id ORDER BY sequence DESC LIMIT 1
    )
    ORDER BY e.scheduled_entry, e.id
  `).all().map(row => ({
    experienceId: String(row.id), atendimentoId: String(row.atendimento_id),
    scheduledEntry: String(row.scheduled_entry), deliveryDate: row.delivery_date as string|null,
    model: String(row.model ?? ''), plate: String(row.plate ?? ''), customer: String(row.customer ?? ''),
    payer: String(row.payer ?? ''), phase: (row.phase ?? 'scheduled') as WorkshopPhase,
    present: row.entered_at !== null && row.departed_at === null, blocked: row.blocked === 1,
    departedAt: row.departed_at as string|null, enteredAt: row.entered_at as string|null,
    commercialClosedAt: row.commercial_closed_at as string|null,
    revision: Number(row.sequence ?? 0), year: row.year === null ? null : String(row.year),
    requiresClassification: !row.plate || ((row.legacy_order === 1 || row.in_operation === 1) && row.sequence === null),
  }))
}


const phaseTones = new Map(workshopPhases.map(item => [item.commercial,item.tone]))
export function listWorkshopPhases(db: DatabaseSync) {
  const overrides = new Map(db.prepare('SELECT phase,commercial FROM erp_workshop_phase_mapping').all()
    .map(row => [row.phase,row.commercial]))
  return workshopPhases.map(item => {
    const commercial = (overrides.get(item.id) ?? item.commercial) as typeof item.commercial
    return {...item,commercial,tone:phaseTones.get(commercial)!}
  })
}
