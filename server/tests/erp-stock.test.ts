import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import type { StockMaterial, StockMovement } from '../../shared/erp-stock.ts'
import { handleStock, migrateStock } from '../erp/stock.ts'

function fixture(path = ':memory:') {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  migrateStock(db)
  function request(method: 'GET' | 'POST', path: string, body?: unknown, search = '') {
    return handleStock({ db, method, path, query: new URLSearchParams(search), body, now: () => Date.parse('2026-11-26T15:00:00Z') })
  }
  const supply = {
    id: 'supply', code: 'I-01', name: 'Lixa sintética', kind: 'supply', manufacturer: 'Teste', unit: 'un',
    minimum: '0,40', unitCost: '5.25', released: true, revision: 0,
  }
  const paint = { ...supply, id: 'paint', code: 'T-01', kind: 'paint', name: 'Tinta sintética', unit: 'L', released: false }
  const entry = {
    id: 'entry', materialId: supply.id, date: '2026-11-26', quantity: '0,30', unitCost: '5.25',
    type: 'entry', reason: 'Compra de teste', partner: 'Fornecedor sintético', operator: 'Operador teste',
  }
  const materials = () => (request('GET', '/materials') as { items: StockMaterial[] }).items
  const movements = (search = '') => request('GET', '/movements', undefined, search) as { items: StockMovement[]; nextOffset: number | null }
  return { db, request, supply, paint, entry, materials, movements }
}

test('cadastro unificado separa tipos, liberação, saldo, estoque mínimo e valor', () => {
  const { db, request, supply, paint, materials } = fixture()
  try {
    request('POST', '/materials', supply)
    request('POST', '/materials', paint)
    assert.deepEqual(materials().map(item => [item.kind, item.released, item.minimum, item.balance, item.stockValue, item.reorder]), [
      ['supply', true, '0.4', '0', '0', true], ['paint', false, '0.4', '0', '0', true],
    ])
    assert.throws(() => request('POST', '/materials', { ...paint, code: 'i-01' }), { code: 'STOCK_CODE_IN_USE' })
    const saved = request('POST', '/materials', { ...supply, name: 'Lixa atualizada', revision: 1 }) as StockMaterial
    assert.equal(saved.revision, 2)
    assert.throws(() => request('POST', '/materials', { ...supply, name: 'Lixa desatualizada', revision: 1 }), { code: 'STOCK_REVISION_CONFLICT' })
  } finally {
    db.close()
  }
})

test('movimentos exatos são imutáveis, mantêm referências históricas e reconciliam o saldo', () => {
  const { db, request, supply, entry, materials, movements } = fixture()
  try {
    request('POST', '/materials', supply)
    const initial = request('POST', '/movements', entry) as StockMovement
    assert.equal(initial.total, '1.575')
    const exit = { ...entry, id: 'exit', date: '2026-11-24', type: 'exit', quantity: '0.10' }
    const adjustment = { ...entry, id: 'adjustment', type: 'adjustment', quantity: '0.2', reason: 'Contagem de teste' }
    request('POST', '/movements', exit)
    request('POST', '/movements', adjustment)
    request('POST', '/materials', { ...supply, name: 'Lixa nova descrição', revision: 1, unitCost: '6.5' })
    assert.deepEqual(materials().map(({ balance, stockValue, reorder }) => ({ balance, stockValue, reorder })), [
      { balance: '0.4', stockValue: '2.6', reorder: false },
    ])
    assert.deepEqual(movements('type=exit&from=2026-11-23&to=2026-11-24').items.map(row => [row.type, row.quantity, row.materialName]), [
      ['exit', '-0.1', supply.name],
    ])
    assert.deepEqual(movements().items.map(row => row.id), ['adjustment', 'entry', 'exit'])
    assert.deepEqual(request('POST', '/movements', { ...entry, quantity: '0.300' }), initial)
    assert.throws(() => db.exec("UPDATE erp_stock_movements SET reason='Alterado'"), /imutável/)
    assert.throws(() => db.exec('DELETE FROM erp_stock_movements'), /imutável/)
    assert.throws(() => request('POST', '/materials', { ...supply, revision: 2, unit: 'kg' }), { code: 'STOCK_MOVEMENT_EXISTS' })
  } finally {
    db.close()
  }
})

test('rejeição ou repetição concorrente preserva as quantidades e os metadados existentes', () => {
  const { db, request, supply, entry, materials, movements } = fixture()
  try {
    request('POST', '/materials', supply)
    request('POST', '/movements', entry)
    assert.throws(() => request('POST', '/movements', { ...entry, quantity: '0.4' }), { code: 'STOCK_MOVEMENT_CONFLICT' })
    assert.throws(() => request('POST', '/movements', { ...entry, id: 'no-stock', type: 'exit', quantity: '0.31' }), { code: 'STOCK_INSUFFICIENT_BALANCE' })
    assert.throws(() => request('POST', '/movements', { ...entry, id: 'adjustment', type: 'adjustment', quantity: '-0.1', reason: ' ' }), { code: 'STOCK_INVALID' })
    assert.throws(() => request('POST', '/movements', { ...entry, id: 'bad-date', date: '2026-02-30' }), { code: 'STOCK_INVALID' })
    assert.throws(() => request('POST', '/movements', { ...entry, id: 'bad-number', quantity: '0.0000001' }), { code: 'STOCK_INVALID' })
    const firstIssue = { ...entry, id: 'unique-one', type: 'exit', quantity: '0.2' }
    request('POST', '/movements', firstIssue)
    assert.throws(() => request('POST', '/movements', { ...firstIssue, id: 'unique-two' }), { code: 'STOCK_INSUFFICIENT_BALANCE' })
    assert.equal(materials()[0].balance, '0.1')
    assert.equal(movements().items.length, 2)
  } finally {
    db.close()
  }
})

test('pagina o histórico de movimentações e filtra por material', () => {
  const { db, request, supply, paint, entry, movements } = fixture()
  try {
    request('POST', '/materials', supply)
    request('POST', '/materials', paint)
    for (let number = 0; number < 101; number++) request('POST', '/movements', { ...entry, id: `mov-${number}` })
    request('POST', '/movements', { ...entry, id: 'paint-entry', materialId: 'paint' })
    const first = movements('materialId=supply')
    assert.equal(first.items.length, 100)
    assert.equal(first.nextOffset, 100)
    const second = movements('materialId=supply&offset=100')
    assert.deepEqual(second.items.map(row => row.id), ['mov-0'])
    assert.equal(second.nextOffset, null)
    assert.deepEqual(movements('materialId=paint').items.map(row => row.id), ['paint-entry'])
  } finally {
    db.close()
  }
})


test('duas conexões concorrentes não podem comprometer o mesmo saldo', { timeout: 5000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'funix-stock-race-'))
  const path = join(directory, 'stock.sqlite')
  const { db, request, supply, entry, materials, movements } = fixture(path)
  const workerCode = `
    const { DatabaseSync } = require('node:sqlite')
    const { workerData, parentPort } = require('node:worker_threads')
    import(workerData.module).then(({ handleStock }) => {
      const db = new DatabaseSync(workerData.path)
      db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')
      parentPort.once('message', () => {
        try {
          handleStock({ db, method: 'POST', path: '/movements', query: new URLSearchParams(),
            body: workerData.body, now: () => Date.parse('2026-11-26T15:00:00Z') })
          parentPort.postMessage('saved')
        } catch (error) {
          parentPort.postMessage(error.code)
        } finally {
          db.close()
        }
      })
      parentPort.postMessage('ready')
    })
  `
  const workers: Worker[] = []
  const ready: Worker[] = []
  const issue = (id: string) => new Promise<string>((resolve, reject) => {
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: {
        path, module: new URL('../erp/stock.ts', import.meta.url).href,
        body: { ...entry, id, type: 'exit', quantity: '0.2' },
      },
    })
    workers.push(worker)
    worker.once('error', reject)
    worker.once('message', message => {
      if (message !== 'ready') {
        reject(new Error('Conexão de teste não ficou pronta.'))
        return
      }
      worker.once('message', resolve)
      ready.push(worker)
      if (ready.length === 2) ready.forEach(connection => connection.postMessage('go'))
    })
  })
  try {
    request('POST', '/materials', supply)
    request('POST', '/movements', entry)
    const outcomes = await Promise.all([issue('competing-a'), issue('competing-b')])
    assert.deepEqual(outcomes.sort(), ['STOCK_INSUFFICIENT_BALANCE', 'saved'])
    assert.equal(materials()[0].balance, '0.1')
    assert.equal(movements().items.length, 2)
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()))
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
