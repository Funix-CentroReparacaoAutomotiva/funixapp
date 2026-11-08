import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupDatabase } from '../database.ts'

/**
 * Offline backup/restore rehearsal. All data are synthetic and all paths
 * live in a unique OS temp directory; production runtime/SQLite is untouched.
 * In particular, never use production /data/funix.sqlite or runtime.env here.
 */
test('SQLite online backup restores to an isolated copy with integrity and FK checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'funix-chat-restore-'))
  const source = join(dir, 'synthetic.sqlite')
  const backup = join(dir, 'backup.sqlite')
  const recovered = join(dir, 'recovered.sqlite')
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(source)
    db.exec(`PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=WAL;
      CREATE TABLE qa_parent (id INTEGER PRIMARY KEY, marker TEXT NOT NULL);
      CREATE TABLE qa_child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL
        REFERENCES qa_parent(id));
      INSERT INTO qa_parent (id, marker) VALUES (1, 'SINTETICO_CHAT_V20');
      INSERT INTO qa_child (id, parent_id) VALUES (10, 1);`)
    // Backup is taken while original connection is open, with WAL enabled.
    await backupDatabase(db, backup)
    assert.ok(existsSync(backup))
    assert.equal(statSync(backup).mode & 0o777, 0o600)
    assert.ok(readFileSync(backup).length > 0)

    // A later change in the source must not alter the completed snapshot.
    db.prepare('UPDATE qa_parent SET marker=? WHERE id=1').run('ALTERADO_APOS_BACKUP')
    copyFileSync(backup, recovered)
    const restored = new DatabaseSync(recovered)
    try {
      restored.exec('PRAGMA foreign_keys=ON')
      assert.equal(restored.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok')
      assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), [])
      assert.equal(restored.prepare('SELECT marker FROM qa_parent WHERE id=1').get()?.marker, 'SINTETICO_CHAT_V20')
      assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM qa_child').get()?.n, 1)
      // Recovered file is usable on its own; never write to the live source.
      restored.prepare('UPDATE qa_parent SET marker=? WHERE id=1').run('RESTAURADO_OFFLINE')
    } finally { restored.close() }
    assert.equal(db.prepare('SELECT marker FROM qa_parent WHERE id=1').get()?.marker, 'ALTERADO_APOS_BACKUP')
  } finally {
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SQLite backup refuses overwriting a prior backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'funix-chat-backup-'))
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(join(dir, 'source.sqlite'))
    db.exec('CREATE TABLE qa (id INTEGER PRIMARY KEY)')
    const destination = join(dir, 'previous.sqlite')
    await backupDatabase(db, destination)
    const before = readFileSync(destination)
    await assert.rejects(backupDatabase(db, destination), /já existe/)
    assert.deepEqual(readFileSync(destination), before)
  } finally {
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
