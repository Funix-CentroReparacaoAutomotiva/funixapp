import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { migrate } from '../migrations.ts'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { ServiceError } from '../errors.ts'
import { handleTasks } from '../erp/tasks.ts'
import type { Task } from '../../shared/erp-tasks.ts'

const now = () => Date.parse('2026-11-26T12:00:00Z')

function fixture(t: TestContext) {
  const db = openDatabase(':memory:')
  t.after(() => db.close())
  return {
    db,
    save: (body: unknown) => handleTasks({ db, body, method: 'POST', path: '/items', query: new URLSearchParams(), now }) as Task,
    list: (sort = '') => (handleTasks({ db, body: null, method: 'GET', path: '/items', query: new URLSearchParams({ sort }), now }) as { items: Task[] }).items,
  }
}

function draft(fields: Partial<Task> = {}): Task {
  return {
    id: randomUUID(), revision: 0, rice: null, title: 'Tarefa sintética', status: 'not-started',
    owner: '', sector: '', work: '', addedValue: '', investment: '', reach: '', impact: '', confidence: '',
    effort: '', priority: '', position: '', dueDate: '', description: '', ...fields,
  }
}

test('RICE preserves documented scales, including mandatory weights, and reports incomplete values', t => {
  const { save } = fixture(t)
  assert.equal(save(draft({ reach: '6', impact: '2', confidence: '0.8', effort: '3' })).rice, '3.2')
  assert.equal(save(draft({ reach: '100', impact: '100', confidence: '1', effort: '2' })).rice, '5000')
  assert.equal(save(draft({ reach: '3', impact: '0.25', confidence: '0.5', effort: '1,5' })).rice, '0.25')
  assert.equal(save(draft({ reach: '1', impact: '1', confidence: '1' })).rice, null)
  assert.throws(() => save(draft({ effort: '0' })), { code: 'INVALID_TASK' })
  assert.throws(() => save(draft({ reach: '25' })), { code: 'INVALID_TASK' })
})

test('task priority order is numeric and RICE order compares exact values before rounding', t => {
  const { save, list } = fixture(t)
  const first = save(draft({ position: '2', reach: '1', impact: '1', confidence: '1', effort: '99.99' }))
  const second = save(draft({ position: '10', reach: '1', impact: '1', confidence: '1', effort: '99.98' }))
  const unscored = save(draft())
  assert.equal(first.rice, second.rice)
  assert.deepEqual(list().map(item => item.id), [first.id, second.id, unscored.id])
  assert.deepEqual(list('rice').map(item => item.id), [second.id, first.id, unscored.id])
})

test('task creation and updates tolerate replay without duplicate records or overwriting concurrent edits', t => {
  const { save, list } = fixture(t)
  const input = draft({ investment: '012,30', position: '007', dueDate: '2026-12-01' })
  const created = save(input)
  assert.equal(created.investment, '12.3')
  assert.equal(created.position, '7')
  assert.deepEqual(save(input), created)
  assert.equal(list().length, 1)
  const update = { ...created, status: 'in-progress' }
  const changed = save(update)
  assert.deepEqual(save(update), changed)
  assert.equal(changed.revision, 2)
  assert.throws(() => save({ ...created, status: 'approved' }), { code: 'TASK_REVISION_CONFLICT', status: 409 })
  assert.equal(list()[0]?.status, 'in-progress')
})

test('invalid deadlines, status, identification and investment leave the task collection intact', t => {
  const { save, list } = fixture(t)
  for (const input of [
    draft({ dueDate: '2026-02-30' }), draft({ title: ' ' }), draft({ id: 'wrong' }), draft({ investment: '12,123' }),
    { ...draft(), status: 'other' }, { ...draft(), revision: '0' }, { ...draft(), position: '-1' },
  ]) {
    assert.throws(() => save(input), (cause: unknown) => cause instanceof ServiceError && cause.status === 422)
  }
  assert.deepEqual(list(), [])
})

test('linked tasks validate the Atendimento and preserve it on older client updates', t => {
  const { db, save, list } = fixture(t)
  const atendimento = new AtendimentoRepository(db).create({ name: 'Atendimento sintético' })
  assert.throws(() => save(draft({ atendimentoId: randomUUID() })), { code: 'INVALID_TASK' })
  const input = draft({ atendimentoId: atendimento.id })
  const task = save(input)
  assert.deepEqual(save(input), task)
  assert.equal(list()[0]?.atendimentoId, atendimento.id)
  const { atendimentoId, ...legacy } = task
  assert.equal(atendimentoId, atendimento.id)
  const completed = save({ ...legacy, status: 'done' })
  assert.equal(completed.atendimentoId, atendimento.id)
  assert.equal(save({ ...completed, atendimentoId: null }).atendimentoId, null)
})

test('V31 preserves tasks created before contextual linking', t => {
  const { db, save, list } = fixture(t)
  const oldTask = save(draft({ status: 'blocked', priority: 'Alta' }))
  db.exec('DROP INDEX erp_tasks_atendimento; ALTER TABLE erp_tasks DROP COLUMN atendimento_id; DELETE FROM schema_migrations WHERE version=31;')
  migrate(db)
  assert.deepEqual(list(), [oldTask])
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
})
