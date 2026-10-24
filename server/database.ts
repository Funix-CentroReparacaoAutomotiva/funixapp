import { DatabaseSync, backup } from 'node:sqlite'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { migrate } from './migrations.ts'

export function openDatabase(filename: string) {
  const memory = filename === ':memory:'
  const path = memory ? filename : resolve(filename)
  if (!memory) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Arquivo de banco não pode ser link simbólico.')
    if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600))
  }
  const db = new DatabaseSync(path)
  try {
    if (!memory) chmodSync(path, 0o600)
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA synchronous = FULL;')
    migrate(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export async function backupDatabase(db: DatabaseSync, destination: string) {
  const path = resolve(destination)
  if (existsSync(path)) throw new Error('O destino do backup já existe.')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  closeSync(openSync(path, 'wx', 0o600))
  try { await backup(db, path) }
  catch (error) { unlinkSync(path); throw error }
}
