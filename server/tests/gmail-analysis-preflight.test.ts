import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { preflightGmailAnalysis } from '../gmail-analysis-preflight.ts'

const now = '2026-11-15T01:30:00.000Z'
const cutoff = '2026-11-15T01:00:00.000Z'
const noticeId = '11111111-1111-4111-8111-111111111111'
const columns = { processId:'c-process', experienceId:'c-experience', plate:'c-plate', vehicle:'c-vehicle', partner:'c-partner', budgetId:'c-budget', budgetVersion:'c-version' }
function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE gmail_intake_notices (id TEXT PRIMARY KEY, created_at TEXT, status TEXT, decided_at TEXT)')
  db.exec('CREATE TABLE gmail_analysis_jobs (notice_id TEXT)')
  db.exec('CREATE TABLE gmail_analysis_pilot_scope (singleton INTEGER)')
  db.prepare('INSERT INTO gmail_intake_notices VALUES (?, ?, ?, NULL)').run(noticeId, now, 'awaiting_authorization')
  const env: NodeJS.ProcessEnv = {
    FUNIX_GMAIL_ANALYSIS_ENABLED:'false', FUNIX_GMAIL_ANALYSIS_MODE:'real-pilot', FUNIX_GMAIL_ANALYSIS_SYNTHETIC:'false',
    FUNIX_GMAIL_ANALYSIS_PILOT_NOTICE_ID:noticeId, FUNIX_GMAIL_ANALYSIS_PILOT_ACTIVATED_AT:cutoff,
    FUNIX_GMAIL_ANALYSIS_GMAIL_ACCOUNT:'piloto@example.invalid', FUNIX_GMAIL_ANALYSIS_GMAIL_TOKEN:'super-secret-token',
    FUNIX_GMAIL_ANALYSIS_CODA_TOKEN:'other-secret-token', FUNIX_GMAIL_ANALYSIS_CODA_DOC_ID:'doc', FUNIX_GMAIL_ANALYSIS_CODA_TABLE_ID:'grid',
    FUNIX_GMAIL_ANALYSIS_CODA_COLUMNS_JSON:JSON.stringify(columns), FUNIX_GMAIL_ANALYSIS_CODA_READ_ONLY_CONFIRMED:'true',
    FUNIX_GMAIL_ANALYSIS_OPENAI_API_KEY:'third-secret-token', FUNIX_GMAIL_ANALYSIS_OPENAI_MODEL:'model',
    FUNIX_UPDATES_STORAGE_ENABLED:'true', FUNIX_UPDATES_DECISIONS_ENABLED:'true', FUNIX_UPDATES_CLARIFICATIONS_ENABLED:'true',
    FUNIX_GMAIL_INTAKE_STORAGE_ENABLED:'true', FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED:'true'
  }
  return { db, env }
}
test('pré-verificação é somente leitura e retorna estado local redigido', () => {
  const { db, env } = setup()
  try {
    const before = db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_notices').get()
    const result = preflightGmailAnalysis(env, db)
    assert.equal(result.readyForManualReview, true)
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM gmail_intake_notices').get(), before)
    const output = JSON.stringify(result)
    for (const secret of ['super-secret-token', 'other-secret-token', 'third-secret-token', 'piloto@example.invalid'])
      assert.equal(output.includes(secret), false)
    assert.ok(result.manualReviewRequired.length > 0)
  } finally { db.close() }
})
test('rejeita coluna repetida, aviso antigo ou previamente autorizado', () => {
  const { db, env } = setup()
  try {
    env.FUNIX_GMAIL_ANALYSIS_CODA_COLUMNS_JSON = JSON.stringify({ ...columns, budgetVersion: columns.budgetId })
    db.prepare('UPDATE gmail_intake_notices SET status=? WHERE id=?').run('authorized', noticeId)
    const result = preflightGmailAnalysis(env, db)
    assert.equal(result.readyForManualReview, false)
    assert.equal(result.checks.find(x=>x.check==='coda_columns_shape')?.ok, false)
    assert.equal(result.checks.find(x=>x.check==='notice_eligible')?.ok, false)
  } finally { db.close() }
})
test('bloqueia piloto histórico já vinculado e jobs existentes', () => {
  const { db, env } = setup()
  try {
    db.exec('INSERT INTO gmail_analysis_pilot_scope VALUES (1)')
    db.exec("INSERT INTO gmail_analysis_jobs VALUES ('historico')")
    const checks = preflightGmailAnalysis(env, db).checks
    assert.equal(checks.find(x=>x.check==='pilot_not_previously_bound')?.ok, false)
    assert.equal(checks.find(x=>x.check==='no_existing_jobs')?.ok, false)
  } finally { db.close() }
})
