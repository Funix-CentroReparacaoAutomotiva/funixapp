import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { backupDatabase } from './database.ts'

const source = process.env.FUNIX_DATABASE_PATH ?? '.runtime/funix.sqlite'
const destination = process.argv[2]
if (!destination || source === ':memory:' || !existsSync(source)) throw new Error('Uso: node server/backup.ts CAMINHO_NOVO_DE_BACKUP. Configure a origem existente em FUNIX_DATABASE_PATH.')
if (resolve(source) === resolve(destination)) throw new Error('O backup deve usar um arquivo diferente da origem.')
const db = new DatabaseSync(source, { readOnly: true })
try {
  db.prepare('SELECT id FROM atendimentos LIMIT 1').get()
  await backupDatabase(db, destination)
  process.stdout.write('Backup SQLite concluído. Guarde o arquivo fora do Git e restrinja seu acesso.\n')
} finally { db.close() }
