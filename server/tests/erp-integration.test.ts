import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { AtendimentoRepository } from '../atendimentos.ts'
import { backupDatabase, openDatabase } from '../database.ts'
import { migrate } from '../migrations.ts'
import { removeV30FixtureSchema } from './fixtures/production.ts'

test('V29 to V30 preserves the original dataset and rolls back a partial migration', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'funix-erp-upgrade-'))
  const db = openDatabase(join(folder, 'candidate.sqlite'))
  const backup = join(folder, 'before.sqlite')
  const version = (conn: DatabaseSync) => conn.prepare('SELECT MAX(version) AS n FROM schema_migrations').get()?.n
  try {
    removeV30FixtureSchema(db)
    const repo = new AtendimentoRepository(db)
    const record = repo.create({name: 'Atendimento sintético de migração', plate: 'QAA1A00'})
    assert.equal(version(db), 29)
    await backupDatabase(db, backup)

    db.exec('CREATE TABLE erp_tasks (fixture TEXT)')
    assert.throws(() => migrate(db), /already exists/)
    assert.equal(version(db), 29)
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='erp_workshop_events'").get(), undefined)
    assert.equal(db.prepare("SELECT 1 FROM pragma_table_info('financial_titles') WHERE name='competence_date'").get(), undefined)
    db.exec('DROP TABLE erp_tasks')

    migrate(db)
    migrate(db)
    assert.equal(version(db), 31)
    assert.equal(repo.get(record.id).name, record.name)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok')

    const previous = new DatabaseSync(backup, {readOnly:true})
    try {
      assert.equal(version(previous), 29)
      assert.equal(previous.prepare('SELECT name FROM atendimentos WHERE id=?').get(record.id)?.name, record.name)
      assert.equal(previous.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok')
    } finally { previous.close() }
  } finally {
    db.close()
    rmSync(folder, {recursive:true, force:true})
  }
})
