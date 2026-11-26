import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import type { StockKind, StockMaterial, StockMovement, StockMovementType } from '../../shared/erp-stock.ts'
import type { ErpRequest } from './contracts.ts'
import { Q, ZERO } from '../exact.ts'
import { ServiceError } from '../errors.ts'
import { transaction } from '../scenarios.ts'

export function migrateStock(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE erp_stock_materials (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('supply', 'paint')),
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      manufacturer TEXT NOT NULL,
      unit TEXT NOT NULL,
      minimum TEXT NOT NULL,
      unit_cost TEXT NOT NULL,
      released INTEGER NOT NULL CHECK (released IN (0, 1)),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE erp_stock_movements (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      material_id TEXT NOT NULL REFERENCES erp_stock_materials(id) ON DELETE RESTRICT,
      material_code TEXT NOT NULL,
      material_name TEXT NOT NULL,
      material_kind TEXT NOT NULL,
      material_unit TEXT NOT NULL,
      business_date TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      partner TEXT NOT NULL,
      operator TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('entry', 'exit', 'adjustment')),
      reason TEXT NOT NULL,
      quantity TEXT NOT NULL,
      unit_cost TEXT NOT NULL
    );
    CREATE INDEX erp_stock_movements_material ON erp_stock_movements(material_id, sequence);
    CREATE INDEX erp_stock_movements_by_date ON erp_stock_movements(business_date DESC, sequence DESC);
    CREATE TRIGGER erp_stock_movement_update BEFORE UPDATE ON erp_stock_movements
    BEGIN SELECT RAISE(ABORT, 'Movimentação de estoque imutável'); END;
    CREATE TRIGGER erp_stock_movement_delete BEFORE DELETE ON erp_stock_movements
    BEGIN SELECT RAISE(ABORT, 'Movimentação de estoque imutável'); END;
  `)
}

type Row = Record<string, SQLOutputValue>
type Input = Record<string, unknown>
const kindValues: StockKind[] = ['supply', 'paint']
const movementTypes: StockMovementType[] = ['entry', 'exit', 'adjustment']

function validation(message: string): never {
  throw new ServiceError(422, 'STOCK_INVALID', message)
}

function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation('Envie os dados do estoque em um objeto.')
  return value as Input
}

function text(value: unknown, label: string, max: number, optional = false): string {
  if (value === undefined && optional) return ''
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) {
    validation(`Confira o campo ${label}.`)
  }
  return value.trim()
}

function choice<T extends string>(value: unknown, choices: T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) validation(`Confira o campo ${label}.`)
  return value as T
}

function id(value: unknown): string {
  const result = text(value, 'identificador', 60)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) validation('Identificador inválido.')
  return result
}

function decimal(value: unknown, label: string, signed = false): Q {
  const raw = text(value, label, 28).replace(',', '.')
  const negative = raw.startsWith('-')
  if (negative && !signed) validation(`Informe ${label} maior ou igual a zero.`)
  try {
    const exact = Q.from(negative ? raw.slice(1) : raw)
    return negative ? ZERO.sub(exact) : exact
  } catch {
    validation(`Informe ${label} com até seis casas decimais.`)
  }
}

function storedDecimal(value: SQLOutputValue): Q {
  const raw = String(value)
  return raw.startsWith('-') ? ZERO.sub(Q.from(raw.slice(1))) : Q.from(raw)
}

function date(value: unknown): string {
  const result = text(value, 'data da movimentação', 10)
  const parsed = new Date(`${result}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) {
    validation('Informe uma data válida para a movimentação.')
  }
  return result
}

function materialFrom(row: Row, balance: Q): StockMaterial {
  const minimum = storedDecimal(row.minimum)
  const unitCost = storedDecimal(row.unit_cost)
  return {
    id: String(row.id), kind: row.kind as StockKind, code: String(row.code), name: String(row.name),
    manufacturer: String(row.manufacturer), unit: String(row.unit), minimum: minimum.toString(),
    unitCost: unitCost.toString(), released: row.released === 1, revision: Number(row.revision),
    balance: balance.toString(), stockValue: balance.mul(unitCost).toString(),
    reorder: balance.cmp(minimum) < 0,
  }
}

function materialRow(db: DatabaseSync, materialId: string) {
  const row = db.prepare('SELECT * FROM erp_stock_materials WHERE id = ?').get(materialId)
  if (!row) throw new ServiceError(404, 'STOCK_MATERIAL_NOT_FOUND', 'Material não encontrado.')
  return row
}

function balanceFor(db: DatabaseSync, materialId: string): Q {
  const statement = db.prepare('SELECT quantity FROM erp_stock_movements WHERE material_id = ?')
  let balance = ZERO
  for (const row of statement.iterate(materialId)) balance = balance.add(storedDecimal(row.quantity))
  return balance
}

function listMaterials(db: DatabaseSync) {
  const balances = new Map<string, Q>()
  for (const row of db.prepare('SELECT material_id, quantity FROM erp_stock_movements').iterate()) {
    const materialId = String(row.material_id)
    balances.set(materialId, (balances.get(materialId) ?? ZERO).add(storedDecimal(row.quantity)))
  }
  return db.prepare('SELECT * FROM erp_stock_materials ORDER BY name COLLATE NOCASE, code').all()
    .map(row => materialFrom(row, balances.get(String(row.id)) ?? ZERO))
}

function saveMaterial(db: DatabaseSync, data: Input, recordedAt: string) {
  const materialId = id(data.id)
  const kind = choice(data.kind, kindValues, 'tipo de material')
  const code = text(data.code, 'código', 60)
  const name = text(data.name, 'nome', 160)
  const manufacturer = text(data.manufacturer, 'fabricante', 120, true)
  const unit = text(data.unit, 'unidade', 30)
  const minimum = decimal(data.minimum, 'estoque mínimo').toString()
  const unitCost = decimal(data.unitCost, 'custo unitário').toString()
  if (typeof data.released !== 'boolean') validation('Informe se o material está liberado.')
  const released = data.released ? 1 : 0
  if (typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0) {
    validation('A revisão do material é inválida.')
  }
  const revision = data.revision
  return transaction(db, () => {
    const current = db.prepare('SELECT * FROM erp_stock_materials WHERE id = ?').get(materialId)
    const occupied = db.prepare('SELECT id FROM erp_stock_materials WHERE code = ? AND id <> ?').get(code, materialId)
    if (occupied) throw new ServiceError(409, 'STOCK_CODE_IN_USE', 'Já existe um material com esse código.')
    if (current) {
      const balance = balanceFor(db, materialId)
      const same = current.kind === kind && current.code === code && current.name === name &&
        current.manufacturer === manufacturer && current.unit === unit && current.minimum === minimum &&
        current.unit_cost === unitCost && current.released === released
      if (same) return materialFrom(current, balance)
      if (current.revision !== revision) {
        throw new ServiceError(409, 'STOCK_REVISION_CONFLICT', 'O cadastro mudou. Atualize antes de salvar.')
      }
      if ((current.unit !== unit || current.kind !== kind) &&
        db.prepare('SELECT 1 FROM erp_stock_movements WHERE material_id = ? LIMIT 1').get(materialId)) {
        throw new ServiceError(409, 'STOCK_MOVEMENT_EXISTS', 'Altere tipo e unidade somente em materiais sem movimentações.')
      }
      db.prepare(`UPDATE erp_stock_materials SET kind=?, code=?, name=?, manufacturer=?, unit=?,
        minimum=?, unit_cost=?, released=?, revision=revision+1, updated_at=? WHERE id=?`)
        .run(kind, code, name, manufacturer, unit, minimum, unitCost, released, recordedAt, materialId)
      return materialFrom(materialRow(db, materialId), balance)
    }
    if (revision !== 0) throw new ServiceError(404, 'STOCK_MATERIAL_NOT_FOUND', 'Material não encontrado.')
    db.prepare(`INSERT INTO erp_stock_materials
      (id, kind, code, name, manufacturer, unit, minimum, unit_cost, released, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(materialId, kind, code, name, manufacturer, unit, minimum, unitCost, released, recordedAt)
    return materialFrom(materialRow(db, materialId), ZERO)
  })
}

const movementSelect = 'SELECT m.* FROM erp_stock_movements m'

function movementFrom(row: Row): StockMovement {
  const quantity = storedDecimal(row.quantity)
  const unitCost = storedDecimal(row.unit_cost)
  return {
    id: String(row.id), materialId: String(row.material_id), materialCode: String(row.material_code),
    materialName: String(row.material_name), materialKind: row.material_kind as StockKind, unit: String(row.material_unit),
    date: String(row.business_date), recordedAt: String(row.recorded_at), partner: String(row.partner),
    operator: String(row.operator), type: row.type as StockMovementType, reason: String(row.reason),
    quantity: quantity.toString(), unitCost: unitCost.toString(), total: quantity.mul(unitCost).toString(),
  }
}

function createMovement(db: DatabaseSync, data: Input, recordedAt: string) {
  const movementId = id(data.id)
  const materialId = id(data.materialId)
  const businessDate = date(data.date)
  const type = choice(data.type, movementTypes, 'tipo da movimentação')
  const amount = decimal(data.quantity, 'a quantidade', type === 'adjustment')
  if (amount.n === 0n) validation('Informe uma quantidade diferente de zero.')
  const quantity = type === 'exit' ? ZERO.sub(amount) : amount
  const unitCost = decimal(data.unitCost, 'o valor unitário').toString()
  const reason = text(data.reason, 'justificativa', 500, type !== 'adjustment')
  const operator = text(data.operator, 'responsável', 160)
  const partner = text(data.partner, 'parceiro', 160, true)
  return transaction(db, () => {
    const material = materialRow(db, materialId)
    const existing = db.prepare(`${movementSelect} WHERE m.id = ?`).get(movementId)
    if (existing) {
      if (existing.material_id === materialId && existing.business_date === businessDate &&
        existing.type === type && existing.quantity === quantity.toString() && existing.unit_cost === unitCost &&
        existing.reason === reason && existing.operator === operator && existing.partner === partner) {
        return movementFrom(existing)
      }
      throw new ServiceError(409, 'STOCK_MOVEMENT_CONFLICT', 'Esse identificador já registra outra movimentação.')
    }
    if (balanceFor(db, materialId).add(quantity).n < 0n) {
      throw new ServiceError(409, 'STOCK_INSUFFICIENT_BALANCE', 'O saldo é insuficiente para esta movimentação.')
    }
    db.prepare(`INSERT INTO erp_stock_movements
      (id, material_id, material_code, material_name, material_kind, material_unit, business_date,
        recorded_at, partner, operator, type, reason, quantity, unit_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(movementId, materialId, material.code, material.name, material.kind, material.unit, businessDate,
        recordedAt, partner, operator, type, reason, quantity.toString(), unitCost)
    return movementFrom(db.prepare(`${movementSelect} WHERE m.id = ?`).get(movementId)!)
  })
}

function listMovements(db: DatabaseSync, query: URLSearchParams) {
  const materialId = query.has('materialId') ? id(query.get('materialId')) : null
  const type = query.has('type') ? choice(query.get('type'), movementTypes, 'tipo da movimentação') : null
  const from = query.has('from') ? date(query.get('from')) : null
  const to = query.has('to') ? date(query.get('to')) : null
  if (from && to && from > to) validation('A data inicial precisa anteceder a data final.')
  const offset = Number(query.get('offset') ?? 0)
  if (!Number.isSafeInteger(offset) || offset < 0) validation('Página de movimentações inválida.')
  const rows = db.prepare(`${movementSelect}
    WHERE (? IS NULL OR m.material_id = ?) AND (? IS NULL OR m.type = ?)
      AND (? IS NULL OR m.business_date >= ?) AND (? IS NULL OR m.business_date <= ?)
    ORDER BY m.business_date DESC, m.sequence DESC LIMIT 101 OFFSET ?`)
    .all(materialId, materialId, type, type, from, from, to, to, offset)
  return { items: rows.slice(0, 100).map(movementFrom), nextOffset: rows.length > 100 ? offset + 100 : null }
}

export function handleStock({ db, method, path, query, body, now }: ErpRequest) {
  if (path === '/materials') {
    if (method === 'GET') return { items: listMaterials(db) }
    return saveMaterial(db, object(body), new Date(now()).toISOString())
  }
  if (path === '/movements') {
    if (method === 'GET') return listMovements(db, query)
    return createMovement(db, object(body), new Date(now()).toISOString())
  }
  throw new ServiceError(404, 'STOCK_ROUTE_NOT_FOUND', 'Área do estoque não encontrada.')
}
