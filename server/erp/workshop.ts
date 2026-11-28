import type { DatabaseSync } from 'node:sqlite'
import { workshopPhases } from '../../shared/erp.ts'
import { inputObject, transaction } from '../scenarios.ts'
import type { ErpRequest } from './contracts.ts'
import { migrateWorkshopPlanning, workshopPlanning } from './workshop-planning.ts'

import { isWorkshopPhase, listWorkshopPhases, listWorkshopVehicles, phaseIds, workshopDay, workshopError } from './workshop-read.ts'
export { listWorkshopPhases, listWorkshopVehicles, workshopDay } from './workshop-read.ts'

const editablePhaseIds = phaseIds.filter(id => id !== 'scheduled' && id !== 'departed')
const editableCommercial = [...new Set(workshopPhases
  .filter(item => editablePhaseIds.some(id => id === item.id)).map(item => item.commercial))]
const sqlValues = (items: readonly string[]) => items.map(item => "'" + item + "'").join(',')

export function migrateWorkshop(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE erp_workshop_phase_mapping (
      phase TEXT PRIMARY KEY CHECK(phase IN (${sqlValues(editablePhaseIds)})),
      commercial TEXT NOT NULL CHECK(commercial IN (${sqlValues(editableCommercial)}))
    );
    CREATE TABLE erp_workshop_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      experience_id TEXT NOT NULL REFERENCES production_experiences(id) ON DELETE RESTRICT,
      happened_at TEXT NOT NULL,
      action TEXT NOT NULL,
      note TEXT,
      operator TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN (${sqlValues(phaseIds)})),
      blocked INTEGER NOT NULL CHECK(blocked IN (0,1)),
      entered_at TEXT,
      departed_at TEXT,
      commercial_closed_at TEXT,
      request_json TEXT NOT NULL CHECK(json_valid(request_json))
    );
    CREATE INDEX erp_workshop_events_experience ON erp_workshop_events(experience_id,sequence DESC);
    CREATE TRIGGER erp_workshop_event_update BEFORE UPDATE ON erp_workshop_events
      BEGIN SELECT RAISE(ABORT,'Workshop events are immutable'); END;
    CREATE TRIGGER erp_workshop_event_delete BEFORE DELETE ON erp_workshop_events
      BEGIN SELECT RAISE(ABORT,'Workshop events are immutable'); END;
  `)
  migrateWorkshopPlanning(db)
}

function movement({ db, body, now }: ErpRequest) {
  const data = inputObject(body, ['experienceId','requestId','revision','action','phase','note','operator'])
  const {experienceId, requestId, revision, action, phase} = data
  const note = typeof data.note === 'string' ? data.note.trim() : ''
  const operator = typeof data.operator === 'string' ? data.operator.trim() : ''
  if (typeof experienceId !== 'string' || !experienceId || typeof requestId !== 'string' ||
      !/^[a-z0-9-]{8,100}$/i.test(requestId) || typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) || revision < 0 || note.length > 1000 ||
      !operator || operator.length > 120) throw workshopError('Informe uma movimentação válida e o responsável.')
  const payload = JSON.stringify([experienceId, revision, action, phase, note, operator])
  return transaction(db, () => {
    const previousRequest = db.prepare('SELECT request_json FROM erp_workshop_events WHERE id=?').get(requestId)
    const current = listWorkshopVehicles(db).find(vehicle => vehicle.experienceId === experienceId)
    if (!current) throw workshopError('Experiência não encontrada.', 404)
    if (previousRequest) {
      if (previousRequest.request_json !== payload) throw workshopError('O identificador já foi usado em outra operação.', 409)
      return current
    }
    if (current.revision !== revision) throw workshopError('O veículo foi atualizado. Consulte o Pátio e tente novamente.', 409)
    const timestamp = new Date(now()).toISOString()
    let {phase: nextPhase, blocked, enteredAt, departedAt, commercialClosedAt} = current
    switch (action) {
      case 'entry':
        if (nextPhase !== 'scheduled' || enteredAt || !current.plate) throw workshopError('Confira o agendamento e a placa antes de confirmar a entrada.')
        nextPhase = 'entry-inspection'
        enteredAt = timestamp
        break
      case 'phase': {
        if (!current.present || blocked || !isWorkshopPhase(phase) || phase === 'scheduled' || phase === 'departed')
          throw workshopError('A mudança exige presença confirmada, uma fase válida e a liberação de impedimentos.')
        const step = phaseIds.indexOf(phase) - phaseIds.indexOf(nextPhase)
        if (step === 0 || (step !== 1 && note.length < 5))
          throw workshopError('Selecione outra fase. Para saltar ou voltar etapas, registre a justificativa.')
        nextPhase = phase
        break
      }
      case 'block':
      case 'unblock':
        if (!current.present || blocked === (action === 'block') || note.length < 5)
          throw workshopError('Registre uma justificativa e confira o estado do impedimento.')
        blocked = action === 'block'
        break
      case 'quality':
        if (!current.present || note.length < 5) throw workshopError('Registre o problema de qualidade em um veículo presente.')
        break
      case 'departure':
        if (!current.present || nextPhase !== 'finished' || blocked)
          throw workshopError('A saída exige veículo presente, finalizado e sem impedimento.')
        nextPhase = 'departed'
        departedAt = timestamp
        break
      case 'commercial-close':
        if (!departedAt || commercialClosedAt) throw workshopError('Confirme a saída física antes de encerrar comercialmente.')
        commercialClosedAt = timestamp
        break
      default:
        throw workshopError('Movimentação desconhecida.')
    }
    db.prepare(`INSERT INTO erp_workshop_events
      (id,experience_id,happened_at,action,note,operator,phase,blocked,entered_at,departed_at,commercial_closed_at,request_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(requestId, experienceId, timestamp, String(action), note || null, operator,
      nextPhase, Number(blocked), enteredAt, departedAt, commercialClosedAt, payload)
    if (action === 'entry' || action === 'departure')
      db.prepare('UPDATE production_experiences SET in_operation=?,updated_at=? WHERE id=?')
        .run(Number(action === 'entry'),timestamp,experienceId)
    return listWorkshopVehicles(db).find(vehicle => vehicle.experienceId === experienceId)
  })
}

function phaseSettings(db: DatabaseSync) {
  const phases = listWorkshopPhases(db)
  return {phases,revision:JSON.stringify(phases.map(item => item.commercial)),options:editableCommercial}
}

function savePhaseSettings({db,body}: ErpRequest) {
  const data = inputObject(body,['revision','correspondences'])
  const editable = new Map<string,string>()
  if (!Array.isArray(data.correspondences) || data.correspondences.length !== editablePhaseIds.length)
    throw workshopError('Envie todas as correspondências de fases editáveis.')
  for (const entry of data.correspondences) {
    const {phase,commercial} = inputObject(entry,['phase','commercial'])
    if (!isWorkshopPhase(phase) || !editablePhaseIds.some(id => id === phase) || editable.has(phase) ||
        !editableCommercial.some(label => label === commercial))
      throw workshopError('A correspondência de fase não é válida.')
    editable.set(phase,String(commercial))
  }
  return transaction(db, () => {
    if (phaseSettings(db).revision !== data.revision)
      throw workshopError('A correspondência foi alterada. Atualize a consulta antes de salvar.',409)
    db.exec('DELETE FROM erp_workshop_phase_mapping')
    const insert = db.prepare('INSERT INTO erp_workshop_phase_mapping(phase,commercial) VALUES (?,?)')
    for (const phase of workshopPhases) {
      const commercial = editable.get(phase.id)
      if (commercial && commercial !== phase.commercial) insert.run(phase.id,commercial)
    }
    return phaseSettings(db)
  })
}

export function handleWorkshop(request: ErpRequest): unknown {
  const {db, method, path, query, now} = request
  if (path === '/phase-mapping') return method === 'GET' ? phaseSettings(db) : savePhaseSettings(request)
  if (method === 'GET' && path === '/yard') {
    const today = workshopDay(now())
    const all = listWorkshopVehicles(db)
    const vehicles = all.filter(vehicle => !vehicle.departedAt || workshopDay(Date.parse(vehicle.departedAt)) === today)
    const unlinked = db.prepare(`SELECT DISTINCT w.atendimento_id AS atendimentoId FROM work_orders w
      WHERE w.experience_id IS NULL AND NOT EXISTS (SELECT 1 FROM production_experiences e WHERE e.atendimento_id=w.atendimento_id)
      ORDER BY w.atendimento_id`).all()
    return { today, phases:listWorkshopPhases(db), vehicles, unlinked }
  }
  if (method === 'GET' && path === '/history') {
    const id = query.get('experienceId')
    if (!id || !db.prepare('SELECT 1 FROM production_experiences WHERE id=?').get(id))
      throw workshopError('Experiência não encontrada.', 404)
    return { events: db.prepare(`SELECT id, happened_at AS happenedAt, action, note, operator, phase FROM erp_workshop_events
      WHERE experience_id=? ORDER BY sequence DESC`).all(id) }
  }
  if (method === 'POST' && path === '/movement') return movement(request)
  return workshopPlanning(request)
}
