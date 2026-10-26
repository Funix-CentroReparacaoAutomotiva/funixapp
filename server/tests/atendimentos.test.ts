import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase, backupDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'

function files() {
  const directory = mkdtempSync(join(tmpdir(), 'funix-atendimento-test-'))
  return { directory, filename: join(directory, 'commercial.sqlite'), close: () => rmSync(directory, { recursive: true, force: true }) }
}

test('SQLite preserves optional text and independent duplicate-phone UUIDs after close and reopen', () => {
  const temp = files()
  try {
    let db = openDatabase(temp.filename)
    let repo = new AtendimentoRepository(db)
    const first = repo.create({ phone: '1', name: 'Primeiro', vehicle: 'Carro informado', notes: 'Texto livre' })
    const second = repo.create({ phone: '1' })
    assert.notEqual(first.id, second.id)
    assert.equal(second.phoneNormalized, null)
    assert.equal(second.model, '')
    db.close()
    db = openDatabase(temp.filename)
    repo = new AtendimentoRepository(db)
    assert.equal(repo.list().total, 2)
    assert.equal(repo.get(first.id).notes, 'Texto livre')
    const edited = repo.update(first.id, { revision: first.revision, name: '', brand: 'Marca texto', plate: 'placa texto', notes: '' })
    assert.equal(edited.id, first.id)
    assert.equal(edited.name, '')
    assert.equal(edited.vehicle, first.vehicle)
    assert.equal(edited.phone, first.phone)
    assert.equal(edited.notes, '')
    db.close()
    assert.equal(statSync(temp.filename).mode & 0o777, 0o600)
  } finally { temp.close() }
})

test('two independent Node processes recover persisted Atendimento from the same file', () => {
  const temp = files()
  try {
    const databaseModule = new URL('../database.ts', import.meta.url).href
    const repositoryModule = new URL('../atendimentos.ts', import.meta.url).href
    const child = join(temp.directory, 'restart.mjs')
    writeFileSync(child, `import {writeFileSync} from 'node:fs'; import {openDatabase} from ${JSON.stringify(databaseModule)}; import {AtendimentoRepository} from ${JSON.stringify(repositoryModule)}; const db=openDatabase(process.argv[2]); const repo=new AtendimentoRepository(db); const record=process.argv[3]==='create'?repo.create({phone:'123',model:'Modelo sintético'}):repo.get(process.argv[5]); db.close(); writeFileSync(process.argv[4],JSON.stringify({pid:process.pid,record}));`)
    // Result files also work in restricted runners where child stdout pipes are unavailable.
    const firstReport = join(temp.directory, 'created.json')
    const secondReport = join(temp.directory, 'reopened.json')
    const first = spawnSync(process.execPath, [child, temp.filename, 'create', firstReport], { encoding: 'utf8' })
    assert.equal(first.status, 0, first.stderr)
    const created = JSON.parse(readFileSync(firstReport, 'utf8'))
    assert.match(created.record.id, /^[\da-f-]{36}$/)
    const second = spawnSync(process.execPath, [child, temp.filename, 'read', secondReport, created.record.id], { encoding: 'utf8' })
    assert.equal(second.status, 0, second.stderr)
    const reopened = JSON.parse(readFileSync(secondReport, 'utf8'))
    assert.equal(reopened.record.model, 'Modelo sintético')
    assert.equal(reopened.record.id, created.record.id)
    assert.notEqual(reopened.pid, created.pid)
    assert.notEqual(created.pid, process.pid)
  } finally { temp.close() }
})

test('search and pagination remain database queries and SQL-like text does not select unrelated rows', () => {
  const db = openDatabase(':memory:')
  const repo = new AtendimentoRepository(db)
  try {
    repo.create({ phone: '(11) 99999-1000', name: "Contato % _ ' OR 1=1 --", plate: 'TESTE01' })
    repo.create({ phone: '123', name: 'ÁLVARO Segundo' })
    repo.create({ phone: '3', name: 'Terceiro' })
    assert.equal(repo.list({ q: '11999991000' }).total, 1)
    assert.equal(repo.list({ q: "' OR 1=1 --" }).total, 1)
    assert.equal(repo.list({ q: '%' }).total, 1)
    assert.equal(repo.list({ q: 'alvaro' }).total, 1)
    assert.equal(repo.list({ q: 'ABC1D23' }).total, 0)
    const first = repo.list({ limit: 2 })
    const second = repo.list({ limit: 2, offset: first.nextOffset! })
    assert.equal(first.total, 3)
    assert.equal(first.items.length, 2)
    assert.equal(second.items.length, 1)
    assert.equal(second.nextOffset, null)
    assert.equal(new Set([...first.items, ...second.items].map(r => r.id)).size, 3)
  } finally { db.close() }
})

test('manual backup restores actual data and refuses overwrite', async () => {
  const temp = files()
  const db = openDatabase(temp.filename)
  try {
    const original = new AtendimentoRepository(db).create({ phone: '+44 1234 567890', name: 'Backup sintético' })
    const destination = join(temp.directory, 'backup.sqlite')
    await backupDatabase(db, destination)
    await assert.rejects(backupDatabase(db, destination), /já existe/)
    const restored = openDatabase(destination)
    try { assert.deepEqual(new AtendimentoRepository(restored).get(original.id), original) }
    finally { restored.close() }
  } finally { db.close(); temp.close() }
})

test('newer schema is refused without resetting data', () => {
  const temp = files()
  try {
    let db = openDatabase(temp.filename)
    const id = new AtendimentoRepository(db).create({ phone: '1' }).id
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)').run(999, 'future')
    db.close()
    assert.throws(() => openDatabase(temp.filename), /versão mais recente/)
    db = new DatabaseSync(temp.filename)
    assert.equal(db.prepare('SELECT id FROM atendimentos WHERE id=?').get(id)?.id, id)
    db.close()
  } finally { temp.close() }
})
