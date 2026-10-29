import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Scenario } from '../shared/commercial.ts'
import { AtendimentoRepository } from './atendimentos.ts'
import { ServiceError } from './errors.ts'

export function invalid(message: string): never { throw new ServiceError(400, 'INVALID_COMMERCIAL_DATA', message) }
export function conflict(): never { throw new ServiceError(409, 'VERSION_CONFLICT', 'A composição ou cenário mudou em outra edição. Reabra antes de salvar; seus campos foram preservados.') }
export function inputObject(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))) invalid('Campos inválidos ou não permitidos.')
  return input as Record<string, unknown>
}
export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const result = action(); db.exec('COMMIT'); return result }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
export function selectedScenario(db: DatabaseSync, atendimentoId: string, id?: unknown, revision?: unknown): string {
  if (id !== undefined && (typeof id !== 'string' || id.length > 100)) invalid('Cenário inválido.')
  const row = id === undefined
    ? db.prepare('SELECT id,revision FROM scenarios WHERE atendimento_id=? ORDER BY position LIMIT 1').get(atendimentoId)
    : db.prepare('SELECT id,revision FROM scenarios WHERE atendimento_id=? AND id=?').get(atendimentoId, String(id))
  if (!row) throw new ServiceError(404, 'NOT_FOUND', 'Cenário não encontrado neste Atendimento.')
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision !== row.revision)) conflict()
  return String(row.id)
}
export function touchComposition(db: DatabaseSync, at: string) {
  db.prepare('UPDATE commercial_state SET revision=revision+1 WHERE atendimento_id=?').run(at)
  db.prepare('UPDATE scenarios SET revision=revision+1 WHERE atendimento_id=?').run(at)
}

export class ScenarioRepository {
  readonly db: DatabaseSync
  constructor(db: DatabaseSync) { this.db = db }
  list(at: string): Scenario[] {
    new AtendimentoRepository(this.db).get(at)
    const flags = (table:string,column:string) => {
      const grouped=new Map<string,Record<string,boolean>>()
      for(const row of this.db.prepare(`SELECT f.scenario_id,f.${column} AS id,f.enabled FROM ${table} f JOIN scenarios s ON s.id=f.scenario_id WHERE s.atendimento_id=?`).all(at)){
        const key=String(row.scenario_id),values=grouped.get(key)??{};values[String(row.id)]=row.enabled===1;grouped.set(key,values)
      }
      return grouped
    }
    const pieces=flags('scenario_piece_flags','piece_id'),services=flags('scenario_service_flags','service_id'),components=flags('scenario_component_flags','component_id')
    return this.db.prepare('SELECT * FROM scenarios WHERE atendimento_id=? ORDER BY position').all(at).map(row=>({id:String(row.id),atendimentoId:at,name:String(row.name),position:Number(row.position),revision:Number(row.revision),pieceFlags:pieces.get(String(row.id))??{},serviceFlags:services.get(String(row.id))??{},componentFlags:components.get(String(row.id))??{}}))
  }

  create(at: string, input: unknown) {
    new AtendimentoRepository(this.db).get(at)
    const data = inputObject(input, ['name','duplicateFrom','sourceRevision'])
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100) invalid('Informe um nome de cenário (até 100 caracteres).')
    const name = data.name.trim()
    return transaction(this.db, () => {
      const source = data.duplicateFrom === undefined ? null : selectedScenario(this.db, at, data.duplicateFrom, data.sourceRevision)
      if (source && !Number.isSafeInteger(data.sourceRevision)) invalid('Informe a revisão do cenário de origem.')
      const id = randomUUID()
      const position = Number(this.db.prepare('SELECT next_scenario_position AS position FROM commercial_state WHERE atendimento_id=?').get(at)!.position)
      this.db.prepare('UPDATE commercial_state SET next_scenario_position=next_scenario_position+1 WHERE atendimento_id=?').run(at)
      this.db.prepare('INSERT INTO scenarios(id,atendimento_id,name,position,created_at) VALUES(?,?,?,?,?)').run(id,at,name,position,new Date().toISOString())
      this.db.prepare('INSERT INTO scenario_piece_flags SELECT ?,id,0 FROM diagnosis_items WHERE atendimento_id=?').run(id,at)
      this.db.prepare('INSERT INTO scenario_service_flags SELECT ?,l.id,0 FROM diagnosis_services l JOIN diagnosis_items p ON p.id=l.diagnosis_item_id WHERE p.atendimento_id=?').run(id,at)
      this.db.prepare('INSERT INTO scenario_component_flags SELECT ?,id,0 FROM component_items WHERE atendimento_id=?').run(id,at)
      if (source) {
        this.db.prepare('UPDATE scenario_piece_flags SET enabled=(SELECT f.enabled FROM scenario_piece_flags f WHERE f.scenario_id=? AND f.piece_id=scenario_piece_flags.piece_id) WHERE scenario_id=?').run(source,id)
        this.db.prepare('UPDATE scenario_service_flags SET enabled=(SELECT f.enabled FROM scenario_service_flags f WHERE f.scenario_id=? AND f.service_id=scenario_service_flags.service_id) WHERE scenario_id=?').run(source,id)
      }
      if (source) this.db.prepare('UPDATE scenario_component_flags SET enabled=(SELECT f.enabled FROM scenario_component_flags f WHERE f.scenario_id=? AND f.component_id=scenario_component_flags.component_id) WHERE scenario_id=?').run(source,id)
      return this.list(at).find(s => s.id === id)!
    })
  }
  remove(at: string, id: string, input: unknown) {
    const data = inputObject(input, ['revision'])
    if (!Number.isSafeInteger(data.revision)) invalid('Informe a revisão do cenário.')
    return transaction(this.db, () => {
      new AtendimentoRepository(this.db).get(at)
      selectedScenario(this.db, at, id, data.revision)
      if (this.list(at).length <= 1) throw new ServiceError(409, 'LAST_SCENARIO', 'O último cenário do Atendimento não pode ser excluído.')
      // Only the three flag tables cascade. Composition and immutable budgets have no scenario FK.
      this.db.prepare('DELETE FROM scenarios WHERE atendimento_id=? AND id=?').run(at, id)
      return { deletedId: id, scenarios: this.list(at) }
    })
  }
  update(at: string, id: string, input: unknown) {
    const data = inputObject(input, ['revision','name','pieceFlags','serviceFlags','componentFlags'])
    if (!Number.isSafeInteger(data.revision)) invalid('Informe a revisão do cenário.')
    return transaction(this.db, () => {
      selectedScenario(this.db, at, id, data.revision)
      if (data.name !== undefined) {
        if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100) invalid('Nome de cenário inválido.')
        this.db.prepare('UPDATE scenarios SET name=? WHERE id=?').run(data.name.trim(),id)
      }
      for (const [field,table,column] of [['pieceFlags','scenario_piece_flags','piece_id'],['serviceFlags','scenario_service_flags','service_id'],['componentFlags','scenario_component_flags','component_id']]) {
        if (data[field] === undefined) continue
        if (!data[field] || typeof data[field] !== 'object' || Array.isArray(data[field])) invalid('Flags de cenário inválidas.')
        for (const [key,value] of Object.entries(data[field] as Record<string, unknown>)) {
          if (typeof value !== 'boolean') invalid('Inclusão deve ser verdadeira ou falsa.')
          const result = this.db.prepare(`UPDATE ${table} SET enabled=? WHERE scenario_id=? AND ${column}=?`).run(value ? 1 : 0,id,key)
          if (!result.changes) invalid('Item não pertence a este Atendimento.')
        }
      }
      this.db.prepare('UPDATE scenarios SET revision=revision+1 WHERE id=?').run(id)
      return this.list(at).find(s => s.id === id)!
    })
  }
}
