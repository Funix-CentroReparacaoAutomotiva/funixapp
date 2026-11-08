import { createApp } from './app.ts'
import { openDatabase } from './database.ts'
import { AtendimentoRepository } from './atendimentos.ts'
import { loadIngestOptions } from './chat/ingest-config.ts'
import { loadEvolutionChat } from './chat/evolution-config.ts'
import { createV20AssociationSchema, V20AssociationRepository } from './chat/v20-associations.ts'
import { loadQuotePilot } from './component-quote-bootstrap.ts'

const port = Number(process.env.FUNIX_API_PORT ?? 8787)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FUNIX_API_PORT inválida.')
const host = process.env.FUNIX_API_HOST ?? '127.0.0.1'
if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('FUNIX_API_HOST inválida.')
if (process.env.NODE_ENV === 'production') {
  const password = process.env.FUNIX_OPERATOR_PASSWORD ?? ''
  if (password.length < 12 || password.length > 256) throw new Error('Configure uma senha de operador com 12 a 256 caracteres.')
  const origin = new URL(process.env.FUNIX_APP_ORIGIN ?? 'http://invalid')
  if (origin.protocol !== 'https:' || origin.origin !== process.env.FUNIX_APP_ORIGIN) throw new Error('Configure FUNIX_APP_ORIGIN como origem HTTPS, sem caminho ou barra final.')
}
const databasePath = process.env.FUNIX_DATABASE_PATH ?? (process.env.NODE_ENV === 'production' ? '' : '.runtime/funix.sqlite')
if (!databasePath || (process.env.NODE_ENV === 'production' && databasePath === ':memory:')) throw new Error('Configure FUNIX_DATABASE_PATH para um arquivo em armazenamento persistente autorizado.')
const db = openDatabase(databasePath)
const atendimentos = new AtendimentoRepository(db)
// Separate, OFF-by-default gate. V14 schema_migrations stays unchanged for image rollback.
// SQLite DDL is additive and transactional; no legacy chat/history mutations.
const v20Associations = process.env.FUNIX_CHAT_V20_LINKS_ENABLED === 'true' &&
  process.env.FUNIX_EVOLUTION_READ_ENABLED === 'true'
  ? (() => { createV20AssociationSchema(db); return new V20AssociationRepository(db) })()
  : undefined
const app = createApp({ atendimentos, password: process.env.FUNIX_OPERATOR_PASSWORD, origin: process.env.FUNIX_APP_ORIGIN, revision: process.env.FUNIX_REVISION, whatsappIngest: loadIngestOptions(process.env), evolutionChat: loadEvolutionChat(process.env, v20Associations), v20Associations, quotePilot: loadQuotePilot(process.env,databasePath) })
app.requestTimeout = 15_000
app.headersTimeout = 10_000
app.listen(port, host, () => { process.stdout.write(`FUNIX API comercial na porta ${port}.\n`) })
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  app.close(() => { db.close(); process.exit(0) })
  app.closeIdleConnections()
  setTimeout(() => process.exit(1), 15_000).unref()
})
