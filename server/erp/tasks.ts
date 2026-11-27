import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { ServiceError } from '../errors.ts'
import { Q } from '../exact.ts'
import type { ErpRequest } from './contracts.ts'
import { taskRiceScales, taskStatuses } from '../../shared/erp-tasks.ts'
import type { Task, TaskFields, TaskStatus } from '../../shared/erp-tasks.ts'

export function migrateTasks(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE erp_tasks (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL CHECK(revision >= 1),
      title TEXT NOT NULL CHECK(length(trim(title)) > 0),
      owner TEXT NOT NULL,
      sector TEXT NOT NULL,
      work TEXT NOT NULL,
      added_value TEXT NOT NULL,
      investment TEXT NOT NULL,
      reach TEXT NOT NULL,
      impact TEXT NOT NULL,
      confidence TEXT NOT NULL,
      effort TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('not-started','in-progress','blocked','done','approved')),
      priority TEXT NOT NULL,
      position INTEGER CHECK(position >= 0),
      due_date TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

function invalid(message: string): never {
  throw new ServiceError(422, 'INVALID_TASK', message)
}

function parseFields(body: Record<string, unknown>): TaskFields {
  function field(key: keyof TaskFields, max = 160) {
    const value = body[key]
    if (typeof value !== 'string' || value.length > max) invalid('Confira os campos da tarefa.')
    return value.trim()
  }
  function decimal(key: 'investment' | 'effort', places: 2 | 6) {
    const value = field(key, 19).replace(',', '.')
    if (value === '') return ''
    const pattern = places === 2 ? /^\d{1,12}(?:\.\d{1,2})?$/ : /^\d{1,12}(?:\.\d{1,6})?$/
    if (!pattern.test(value)) invalid(key === 'investment' ? 'Informe um investimento válido.' : 'Informe um esforço positivo.')
    const decimal = Q.from(value)
    if (key === 'effort' && decimal.n === 0n) invalid('Informe um esforço positivo.')
    return decimal.toString()
  }
  function scale(key: keyof typeof taskRiceScales) {
    const value = field(key, 4)
    const allowed: readonly string[] = taskRiceScales[key]
    if (value !== '' && !allowed.includes(value)) invalid('Confira os valores de alcance, impacto e confiança.')
    return value
  }
  const title = field('title', 250)
  if (!title) invalid('Informe a tarefa.')
  const status = field('status')
  if (!Object.hasOwn(taskStatuses, status)) invalid('Selecione uma situação válida.')
  const position = field('position', 6)
  if (position !== '' && !/^\d{1,6}$/.test(position)) invalid('Informe a ordem como um número inteiro não negativo.')
  const dueDate = field('dueDate', 10)
  if (dueDate) {
    const date = new Date(dueDate)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== dueDate)
      invalid('Informe um prazo válido.')
  }
  return {
    title, status: status as TaskStatus, position: position === '' ? '' : String(Number(position)), dueDate,
    owner: field('owner'), sector: field('sector'), work: field('work'), addedValue: field('addedValue', 500),
    investment: decimal('investment', 2), effort: decimal('effort', 6),
    reach: scale('reach'), impact: scale('impact'), confidence: scale('confidence'),
    priority: field('priority', 80), description: field('description', 4000),
  }
}

function riceScore({ reach, impact, confidence, effort }: TaskFields): Q | null {
  if (!reach || !impact || !confidence || !effort) return null
  return Q.from(reach).mul(Q.from(impact)).mul(Q.from(confidence)).div(Q.from(effort))
}

function project(row: Record<string, SQLOutputValue>): Task {
  const task = {
    id: String(row.id), revision: Number(row.revision), title: String(row.title),
    status: row.status as TaskStatus, position: String(row.position ?? ''), dueDate: String(row.due_date),
    owner: String(row.owner), sector: String(row.sector), work: String(row.work), addedValue: String(row.added_value),
    investment: String(row.investment), effort: String(row.effort), reach: String(row.reach),
    impact: String(row.impact), confidence: String(row.confidence), priority: String(row.priority), description: String(row.description),
  }
  const score = riceScore(task)
  // Rounding is for display only. Sorting compares the underlying fractions.
  const rice = score ? new Q(score.mul(new Q(10000n)).add(new Q(1n, 2n)).floor(), 10000n).toString() : null
  return { ...task, rice, atendimentoId: typeof row.atendimento_id === 'string' ? row.atendimento_id : null }
}

function list(db: DatabaseSync, sort: string) {
  const items = db.prepare('SELECT * FROM erp_tasks ORDER BY position IS NULL, position, priority, created_at, id').all().map(project)
  if (sort === 'rice') {
    const withScore = items.map(task => ({ task, score: riceScore(task) }))
    withScore.sort((a, b) => !a.score ? (b.score ? 1 : 0) : b.score ? b.score.cmp(a.score) : -1)
    return { items: withScore.map(({ task }) => task) }
  }
  if (sort === 'title') items.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
  if (sort === 'deadline') items.sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99'))
  if (sort === 'priority') items.sort((a, b) => (a.priority || '\uffff').localeCompare(b.priority || '\uffff', 'pt-BR', { numeric: true }))
  return { items }
}

function save({ db, body, now }: ErpRequest): Task {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Envie os dados da tarefa.')
  const input = body as Record<string, unknown>
  const { id, revision } = input
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) invalid('Identificador de tarefa inválido.')
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) invalid('Revisão de tarefa inválida.')
  const fields = parseFields(input)
  const reference = input.atendimentoId
  if (reference !== undefined && reference !== null &&
    (typeof reference !== 'string' || !db.prepare('SELECT 1 FROM atendimentos WHERE id=?').get(reference))) {
    invalid('Atendimento vinculado não encontrado.')
  }
  const atendimentoId = typeof reference === 'string' ? reference : null
  const values = [
    fields.title, fields.owner, fields.sector, fields.work, fields.addedValue,
    fields.investment, fields.reach, fields.impact, fields.confidence, fields.effort,
    fields.status, fields.priority, fields.position === '' ? null : Number(fields.position), fields.dueDate, fields.description,
  ]
  const time = new Date(now()).toISOString()
  let changed: Record<string, SQLOutputValue> | undefined
  if (revision === 0) {
    changed = db.prepare(`INSERT INTO erp_tasks(id, revision, title, owner, sector, work, added_value, investment,
      reach, impact, confidence, effort, status, priority, position, due_date, description, created_at, updated_at, atendimento_id)
      VALUES(?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING *`).get(id, ...values, time, time, atendimentoId)
  } else {
    changed = db.prepare(`UPDATE erp_tasks SET title=?, owner=?, sector=?, work=?, added_value=?, investment=?,
      reach=?, impact=?, confidence=?, effort=?, status=?, priority=?, position=?, due_date=?, description=?,
      updated_at=?, atendimento_id=CASE WHEN ? THEN atendimento_id ELSE ? END, revision=revision+1 WHERE id=? AND revision=? RETURNING *`).get(...values, time, Number(reference === undefined), atendimentoId, id, Number(revision))
  }
  if (changed) return project(changed)
  const row = db.prepare('SELECT * FROM erp_tasks WHERE id=?').get(id)
  if (!row) throw new ServiceError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada.')
  const saved = project(row)
  const matches = Object.entries(fields).every(([key, value]) => saved[key as keyof TaskFields] === value)
  if (matches && (reference === undefined || saved.atendimentoId === atendimentoId) && saved.revision === Number(revision) + 1) return saved
  throw new ServiceError(409, 'TASK_REVISION_CONFLICT', 'Outra atualização alterou esta tarefa. Atualize o catálogo antes de editar novamente.')
}

export function handleTasks(request: ErpRequest): unknown {
  if (request.path === '/items' && request.method === 'GET') return list(request.db, request.query.get('sort') || 'position')
  if (request.path === '/items' && request.method === 'POST') return save(request)
  throw new ServiceError(404, 'TASK_ROUTE_NOT_FOUND', 'Operação de tarefas não encontrada.')
}
