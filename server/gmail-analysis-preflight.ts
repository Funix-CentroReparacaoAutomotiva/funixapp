/**
 * Read-only, credential-redacted preflight for the ONE-notice Gmail real pilot.
 * No network, providers, schema changes or job scheduling. It does NOT authorize activation.
 * Run inside the deployed API container using its already-injected environment.
 */
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

export type PreflightCheck = { check: string; ok: boolean; detail: string }
export type PreflightResult = { readyForManualReview: boolean; checks: PreflightCheck[]; manualReviewRequired: string[] }

const keys = ['processId', 'experienceId', 'plate', 'vehicle', 'partner', 'budgetId', 'budgetVersion'] as const
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const codaColumnPattern = /^c-[A-Za-z0-9_-]{1,98}$/
const providerKeys = [
  'GMAIL_ACCOUNT', 'GMAIL_TOKEN', 'CODA_TOKEN', 'CODA_DOC_ID', 'CODA_TABLE_ID',
  'OPENAI_API_KEY', 'OPENAI_MODEL'
] as const
const mandatoryFlags = [
  'FUNIX_UPDATES_STORAGE_ENABLED', 'FUNIX_UPDATES_DECISIONS_ENABLED',
  'FUNIX_UPDATES_CLARIFICATIONS_ENABLED', 'FUNIX_GMAIL_INTAKE_STORAGE_ENABLED',
  'FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED'
] as const

export function preflightGmailAnalysis(env: NodeJS.ProcessEnv, db: DatabaseSync): PreflightResult {
  const checks: PreflightCheck[] = []
  const add = (check: string, ok: boolean, detail: string) => checks.push({ check, ok, detail })
  const hasTable = (name: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
  const enabled = env.FUNIX_GMAIL_ANALYSIS_ENABLED === 'true'
  add('activation_off', !enabled, enabled ? 'Análise já habilitada: interrompa o pré-deploy.' : 'Análise permanece desligada.')
  add('real_pilot_mode', env.FUNIX_GMAIL_ANALYSIS_MODE === 'real-pilot', 'Modo real-pilot explicitamente configurado.')
  add('no_synthetic_provider', env.FUNIX_GMAIL_ANALYSIS_SYNTHETIC !== 'true' && !env.FUNIX_GMAIL_ANALYSIS_FIXTURE_FILE, 'Sem fixture ou modo sintético.')
  for (const key of mandatoryFlags) add(key, env[key] === 'true', 'Dependência deve estar habilitada para homologação.')
  for (const suffix of providerKeys) {
    const name = 'FUNIX_GMAIL_ANALYSIS_' + suffix
    add(name, Boolean(env[name]?.trim()), 'Somente presença; segredo e permissão não são exibidos nem validados.')
  }
  add('coda_read_only_claim', env.FUNIX_GMAIL_ANALYSIS_CODA_READ_ONLY_CONFIRMED === 'true', 'Declaração local; confirmar permissão real no provedor.')
  const columnsRaw = env.FUNIX_GMAIL_ANALYSIS_CODA_COLUMNS_JSON
  let columnMapValid = false
  if (columnsRaw) {
    try {
      const parsed: unknown = JSON.parse(columnsRaw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>
        const values = keys.map(key => obj[key])
        columnMapValid = Object.keys(obj).sort().join(',') === [...keys].sort().join(',') &&
          values.every(value => typeof value === 'string' && codaColumnPattern.test(value)) &&
          new Set(values).size === keys.length
      }
    } catch { /* Keep JSON error redacted. */ }
  }
  add('coda_columns_shape', columnMapValid, 'Exige sete IDs distintos c-...; nomes e significado devem ser auditados no Coda.')
  const cutoff = env.FUNIX_GMAIL_ANALYSIS_PILOT_ACTIVATED_AT
  const validCutoff = Boolean(cutoff && Number.isFinite(Date.parse(cutoff)) && new Date(cutoff).toISOString() === cutoff)
  add('cutoff_format', validCutoff, 'Data UTC ISO 8601 com milissegundos e Z.')
  const noticeId = env.FUNIX_GMAIL_ANALYSIS_PILOT_NOTICE_ID
  const validId = Boolean(noticeId && idPattern.test(noticeId))
  add('notice_id_format', validId, 'UUID de um aviso novo, não autorizado, posterior ao corte.')
  const pilotBound = hasTable('gmail_analysis_pilot_scope') &&
    Number((db.prepare('SELECT COUNT(*) AS n FROM gmail_analysis_pilot_scope').get() as { n: number }).n) > 0
  add('pilot_not_previously_bound', !pilotBound, 'Vínculo prévio exige revisão: não trocar o piloto por configuração.')
  const jobsCount = hasTable('gmail_analysis_jobs')
    ? Number((db.prepare('SELECT COUNT(*) AS n FROM gmail_analysis_jobs').get() as { n: number }).n) : 0
  add('no_existing_jobs', jobsCount === 0, 'Jobs históricos devem permanecer intocados; não apagar tabelas para reiniciar.')
  const noticeTable = hasTable('gmail_intake_notices')
  add('notice_storage', noticeTable, 'Tabela de avisos existente.')
  let eligible = false
  if (noticeTable && validId && validCutoff) {
    const row = db.prepare('SELECT created_at, status, decided_at FROM gmail_intake_notices WHERE id=?').get(noticeId!) as
      { created_at: string; status: string; decided_at: string | null } | undefined
    eligible = Boolean(row && row.status === 'awaiting_authorization' && !row.decided_at && row.created_at >= cutoff!)
  }
  add('notice_eligible', eligible, 'Aviso novo e pendente após corte; não autorizar até concluir as verificações.')
  return {
    readyForManualReview: checks.every(x => x.ok), checks,
    manualReviewRequired: [
      'Confirmar conta e escopo OAuth Gmail gmail.readonly no provedor.',
      'Conferir token Coda read-only e cada uma das sete colunas na tabela correta; não utilizar a fila de eventos.',
      'Confirmar propósito, minimização de dados, projeto/chave OpenAI e limite de gastos.',
      'Obter autorização explícita antes de ENABLED=true e da análise de um único aviso.'
    ]
  }
}

function main() {
  try {
    const path = process.env.FUNIX_DATABASE_PATH
    if (!path || !path.startsWith('/')) throw Error('DB_PATH_UNAVAILABLE')
    const db = new DatabaseSync(path, { readOnly: true })
    let result: PreflightResult
    try { result = preflightGmailAnalysis(process.env, db) } finally { db.close() }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    if (!result.readyForManualReview) process.exitCode = 2
  } catch {
    process.stderr.write('PREFLIGHT_UNAVAILABLE: banco ou configuração não podem ser verificados em leitura.\n')
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
