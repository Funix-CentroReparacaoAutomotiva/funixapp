import { createApp } from './app.ts'
import { openDatabase } from './database.ts'
import { AtendimentoRepository } from './atendimentos.ts'
import { loadIngestOptions } from './chat/ingest-config.ts'
import { loadEvolutionChat } from './chat/evolution-config.ts'
import { createV20AssociationSchema, V20AssociationRepository } from './chat/v20-associations.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from './chat/coda-sync.ts'
import { createUpdatePackageSchema } from './update-packages-schema.ts'
import { createGmailIntakeSchema } from './gmail-intake-schema.ts'
import { createGmailIntakeQueueSchema } from './gmail-intake-queue-schema.ts'
import { parseCodaSyncSecret } from './chat/coda-sync-endpoint.ts'
import { parseDevelopmentSourceSecret } from './chat/coda-source-endpoint-dev.ts'
import { createDevelopmentSourceLedgerSchema, DevelopmentSourceLedger } from './chat/coda-source-storage-dev.ts'
import { createDevelopmentDecisionLedgerSchema, DevelopmentDecisionLedger } from './chat/coda-decision-ledger-dev.ts'
import { createDevelopmentOutboxSchema, DevelopmentCodaOutbox } from './chat/coda-outbox-dev.ts'
import { createDevelopmentOutboxDrain } from './chat/coda-outbox-drain-dev.ts'
import { createCodaBackedDevelopmentReconciliationCycle } from './chat/coda-reconciliation-coda-dev.ts'
import { startDevelopmentReconciliationScheduler } from './chat/coda-reconciliation-scheduler-dev.ts'
import { ServiceError } from './errors.ts'
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
// Independent OFF-by-default event sync. The n8n workflow is never modified
// by activating this bootstrap; actual event routing requires another gate.
// Opt-in updates storage; disabled by default.
if (process.env.FUNIX_UPDATES_STORAGE_ENABLED === 'true') createUpdatePackageSchema(db)
if (process.env.FUNIX_GMAIL_INTAKE_STORAGE_ENABLED === 'true') createGmailIntakeSchema(db)
if (process.env.FUNIX_GMAIL_INTAKE_STORAGE_ENABLED === 'true' && process.env.FUNIX_GMAIL_QUEUE_STORAGE_ENABLED === 'true') createGmailIntakeQueueSchema(db)
const codaSyncKey = parseCodaSyncSecret(process.env)
const codaSync = codaSyncKey ? (() => {
  createCodaEventSchema(db)
  return { repo: new CodaEventSyncRepository(db), secret: codaSyncKey }
})() : undefined
const sourceLedgerKey = parseDevelopmentSourceSecret(process.env)
const sourceLedger = sourceLedgerKey ? (() => {
  createDevelopmentSourceLedgerSchema(db)
  createDevelopmentDecisionLedgerSchema(db)
  return { ledger:new DevelopmentSourceLedger(db), decisionLedger:new DevelopmentDecisionLedger(db), secret:sourceLedgerKey }
})() : undefined
const decisionLedger=sourceLedger ? {ledger:sourceLedger.decisionLedger,secret:sourceLedger.secret} : undefined
const app = createApp({ codaSync, sourceLedger, decisionLedger, atendimentos, password: process.env.FUNIX_OPERATOR_PASSWORD, origin: process.env.FUNIX_APP_ORIGIN, revision: process.env.FUNIX_REVISION, whatsappIngest: loadIngestOptions(process.env), evolutionChat: loadEvolutionChat(process.env, v20Associations, codaSync?.repo), v20Associations, quotePilot: loadQuotePilot(process.env,databasePath) })
// Media uploads are capped to 12 MiB; allow slow mobile connections up to 60s.
app.requestTimeout = 60_000
app.headersTimeout = 10_000
// Reconciliation is an additional opt-in, not implied by the HTTP intake
// gates. No Coda API access or scheduled sync occurs when the flag is unset.
const reconciliationEnabled=process.env.FUNIX_CODA_RECONCILIATION_ENABLED==='true'
if(reconciliationEnabled && (!sourceLedger || !codaSync || !codaSyncKey))
  throw Error('RECONCILIATION_REQUIRES_SOURCE_AND_CODA_SYNC')
const reconciliationToken=process.env.FUNIX_CODA_API_TOKEN ?? ''
if(reconciliationEnabled && reconciliationToken.length<16)
  throw Error('RECONCILIATION_REQUIRES_CODA_READ_TOKEN')
const reconciliationInterval=Number(process.env.FUNIX_CODA_RECONCILIATION_INTERVAL_MS ?? 600_000)
let reconciliation:ReturnType<typeof startDevelopmentReconciliationScheduler>|undefined
let deliveryScheduler:ReturnType<typeof startDevelopmentReconciliationScheduler>|undefined
if(reconciliationEnabled && sourceLedger && codaSync && codaSyncKey) {
  createDevelopmentOutboxSchema(db)
  const outbox=new DevelopmentCodaOutbox(db)
  // Local transaction, not an HTTP callback to the same server.
  const transport=async(request:{body:string;timestamp:string;signature:string})=>{
    try {return {status:202,body:codaSync.repo.sync(JSON.parse(request.body))}}
    catch(error) {return {status:error instanceof ServiceError?error.status:500}}
  }
  const cycle=createCodaBackedDevelopmentReconciliationCycle(
    {token:reconciliationToken},
    {
      source:sourceLedger.ledger,decisions:sourceLedger.decisionLedger,
      outbox,hmacSecret:codaSyncKey,now:Date.now,
      transport,
    },
  )
  reconciliation=startDevelopmentReconciliationScheduler(cycle,{intervalMs:reconciliationInterval})
  // Deliver already-confirmed events even when the next Coda scan is blocked.
  // The SQLite queue owns fencing, retries and duplicate suppression.
  const drain=createDevelopmentOutboxDrain(outbox,transport,codaSyncKey,Date.now,10)
  deliveryScheduler=startDevelopmentReconciliationScheduler(drain,{intervalMs:60_000})
}
app.listen(port, host, () => { process.stdout.write(`FUNIX API comercial na porta ${port}.\\n`) })
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  const stopping=Promise.all([reconciliation?.stop(),deliveryScheduler?.stop()])
  app.close(async () => { await stopping; db.close(); process.exit(0) })
  app.closeIdleConnections()
  setTimeout(() => process.exit(1), 15_000).unref()
})
