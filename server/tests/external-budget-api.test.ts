import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { AtendimentoRepository } from '../atendimentos.ts'
import { createApp } from '../app.ts'
import { createCodaEventSchema } from '../chat/coda-sync.ts'
import { openDatabase } from '../database.ts'
import { loadExternalBudgetApi } from '../external-budget-api.ts'
import { commercialFixture } from './fixtures/commercial.ts'
import { historicalCapture } from './fixtures/historical-capture.ts'

const previewKey = 'a'.repeat(64)
const confirmationKey = 'b'.repeat(64)
const number = 'SYNTHETIC-BUDGET'
const prefix = '/api/integrations/external-budgets'
const env = {
  FUNIX_EXTERNAL_BUDGET_ENABLED: 'true',
  FUNIX_EXTERNAL_BUDGET_PREVIEW_KEY: previewKey,
  FUNIX_EXTERNAL_BUDGET_CONFIRM_KEY: confirmationKey,
  FUNIX_EXTERNAL_BUDGET_CODA_TOKEN: 'synthetic-coda-credential',
}
const integration = '../../docs/integracoes/importador-orcamentos/'

test('external budget startup is opt-in and rejects a shared write credential', () => {
  const db = openDatabase(':memory:')
  try {
    assert.equal(loadExternalBudgetApi({}, db), undefined)
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='external_budget_receipts'").get(), undefined)
    assert.throws(() => loadExternalBudgetApi({ ...env, FUNIX_EXTERNAL_BUDGET_CONFIRM_KEY: previewKey }, db),
      /FUNIX_EXTERNAL_BUDGET_KEYS_INVALID/)
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='external_budget_receipts'").get(), undefined)
    assert.equal(loadExternalBudgetApi({ ...env, FUNIX_EXTERNAL_BUDGET_CONFIRM_KEY: '' }, db)?.confirmationKey, undefined)
  } finally {
    db.close()
  }
})

test('n8n template forwards status and body through fixed API endpoints, with a consequential ChatGPT confirmation', () => {
  const workflow = JSON.parse(readFileSync(new URL(integration + 'workflow.n8n.json', import.meta.url), 'utf8'))
  const spec = JSON.parse(readFileSync(new URL(integration + 'chatgpt.openapi.json', import.meta.url), 'utf8'))
  assert.equal(workflow.active, false)
  for (const action of ['consulta', 'previa', 'confirmar']) {
    const operation = spec.paths['/funix-orcamentos/' + action].post
    assert.equal(operation['x-openai-isConsequential'], action === 'confirmar')
    const webhook = workflow.nodes.find((node: { parameters: { path?: string } }) => node.parameters.path?.endsWith('/' + action))
    assert.equal(webhook.parameters.authentication, 'headerAuth')
    const requestName = workflow.connections[webhook.name].main[0][0].node
    const request = workflow.nodes.find((node: { name: string }) => node.name === requestName)
    const connection = workflow.connections[requestName].main[0][0].node
    const response = workflow.nodes.find((node: { name: string }) => node.name === connection)
    const evaluate = (expression: string, json: unknown) => runInNewContext(expression.slice(3, -2), { $json: json })
    const body = { atendimentoId: 'synthetic', number }
    assert.equal(evaluate(request.parameters.jsonBody, { body }), JSON.stringify(body))
    const target = new URL(request.parameters.url)
    assert.equal(target.origin, 'https://funix-api.example.invalid')
    assert.equal(target.pathname, prefix + '/' + action)
    assert.equal(request.parameters.genericAuthType, 'httpHeaderAuth')
    assert.equal(request.parameters.options.redirect.redirect.followRedirects, false)
    assert.equal(evaluate(response.parameters.options.responseCode, { statusCode: 409 }), 409)
    assert.equal(evaluate(response.parameters.responseBody, { body }), body)
  }
})

test('machine route verifies Coda and native scope, requires separate approval, and replays an exact receipt', async () => {
  const db = openDatabase(':memory:')
  let app: ReturnType<typeof createApp> | undefined
  try {
    const f = commercialFixture(db)
    const api = loadExternalBudgetApi(env, db)!
    const options = { atendimentos: new AtendimentoRepository(db), voiceProvider: null, password: 'synthetic-password' }
    const disabled = createApp(options)
    disabled.listen(0, '127.0.0.1')
    await once(disabled, 'listening')
    try {
      const address = disabled.address()
      assert.ok(address && typeof address === 'object')
      const result = await fetch('http://127.0.0.1:' + address.port + prefix + '/consulta', {
        method: 'POST', headers: { Authorization: 'Bearer ' + previewKey },
      })
      assert.equal(result.status, 404)
      await result.text()
    } finally {
      await new Promise<void>(resolve => disabled.close(() => resolve()))
    }

    const raw = historicalCapture()
    let reads = 0
    let returned = raw
    app = createApp({
      ...options,
      externalBudget: { ...api, provider: async queried => {
        assert.equal(queried, number)
        reads++
        return { first: returned, second: returned }
      } },
    })
    app.listen(0, '127.0.0.1')
    await once(app, 'listening')
    const address = app.address()
    assert.ok(address && typeof address === 'object')
    const origin = 'http://127.0.0.1:' + address.port
    const base = origin + prefix
    const post = (action: string, data: unknown, key?: string, extra: Record<string, string> = {}) => fetch(base + '/' + action, {
      method: 'POST',
      headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(data),
    }).then(async response => ({ status: response.status, value: await response.json() }))
    const lookup = { atendimentoId: f.at.id, number }
    const login = await fetch(origin + '/api/session', {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: options.password }),
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    await login.text()
    assert.equal((await post('consulta', lookup, undefined, { Cookie: cookie })).status, 401)
    assert.equal((await post('consulta', lookup, confirmationKey)).status, 401)
    assert.equal((await post('confirmar', lookup, previewKey)).status, 401)
    const operatorRoute = await fetch(origin + '/api/atendimentos', { headers: { Authorization: 'Bearer ' + confirmationKey } })
    assert.equal(operatorRoute.status, 401)
    await operatorRoute.text()
    assert.equal((await post('consulta', lookup, previewKey, { 'Content-Type': 'application/jsonbad' })).status, 415)
    assert.equal((await post('consulta', { ...lookup, source: {} }, previewKey)).status, 400)
    assert.equal((await post('consulta', { ...lookup, number: 'a'.repeat(512 * 1024) }, previewKey)).status, 413)
    assert.equal((await post('previa', { ...lookup, mapping: { diagnoses: [null], services: [] } }, previewKey)).value.error.code,
      'EXTERNAL_MAPPING_INVALID')
    assert.equal(reads, 0)

    assert.equal((await post('consulta', lookup, previewKey)).value.error.code, 'EXTERNAL_ATTENDANCE_UNLINKED')
    createCodaEventSchema(db)
    db.prepare('INSERT INTO coda_sync_atendimentos VALUES(?,?,?)').run('i-synthetic-at', f.at.id, '2026-01-01T00:00:00Z')
    const found = await post('consulta', lookup, previewKey)
    assert.equal(found.status, 200)
    assert.equal(found.value.sourceCreatedAt, '2026-01-01T00:00:00.000Z')
    assert.equal(found.value.source.source.provider, 'coda')
    assert.ok(found.value.sourceWarnings.some((warning: { code: string }) => warning.code === 'DUPLICATE_STAGE_CODE'))
    assert.equal((await post('consulta', { ...lookup, atendimentoId: 'other-atendimento' }, previewKey)).value.error.code,
      'EXTERNAL_ATTENDANCE_UNLINKED')
    assert.ok(found.value.catalog.some((item: { id: string }) => item.id === f.service.id))

    const piece = f.commercial.catalogs().items.find(c => c.kind === 'peca' && c.code && c.active && c.id !== f.item.pieceId)!
    const diagnosis = f.commercial.saveCatalog({ kind: 'diagnostico', name: 'Diagnóstico sintético', status: 'validado' })
    const mapping = {
      diagnoses: [{ sourceId: 'i-synthetic-diag', pieceId: piece.id, diagnosisId: diagnosis.id, intensity: 'moderado' }],
      services: [{ sourceId: 'i-synthetic-service', options: [{ serviceId: f.service.id, dimensionId: f.dimension.id, quantity: '1' }] }],
    }
    const input = { ...lookup, mapping }
    const compare = await post('previa', input, previewKey)
    assert.equal(compare.value.state, 'preview')
    assert.equal(compare.value.native.total, '220')
    assert.equal(compare.value.native.serviceNet, '100')
    assert.equal(compare.value.native.discount, '0.05')
    assert.equal(f.scenarios.list(f.at.id).length, 1)
    const approval = { ...input, previewToken: compare.value.previewToken, confirmed: true,
      identityReviewed: true, scopeReviewed: true, financialReviewed: true }
    const beforeInvalid = reads
    assert.equal((await post('confirmar', { ...approval, financialReviewed: false }, confirmationKey)).status, 422)
    assert.equal(reads, beforeInvalid)

    const changed = historicalCapture()
    const budgetRow = changed.tables.budget.pages[0]!.rows[0]!
    const date = Object.values(budgetRow.values).find(
      field => field.value && typeof field.value === 'object' && 'type' in field.value && field.value.type === 'dt',
    )!
    date.value = { type: 'dt', epoch: 1767312000 }
    returned = changed
    assert.equal((await post('confirmar', approval, confirmationKey)).status, 409)
    returned = raw
    const results = await Promise.all([post('confirmar', approval, confirmationKey), post('confirmar', approval, confirmationKey)])
    assert.deepEqual(results.map(r => r.status).sort(), [200, 201])
    assert.deepEqual(results[0]!.value.record, results[1]!.value.record)
    assert.equal(results[0]!.value.record.result.total, '220')
    assert.equal(f.scenarios.list(f.at.id).length, 2)
    const receipt = db.prepare('SELECT plan_json,operator_id FROM external_budget_receipts').get()!
    assert.equal(receipt.operator_id, 'n8n:external-budget-confirm')
    const audit = JSON.parse(String(receipt.plan_json))
    assert.equal(audit.codaEvidence.metadata.createdAt, found.value.sourceCreatedAt)
    assert.equal(audit.sourceLinks.diagnoses['i-synthetic-diag'], results[0]!.value.record.result.pieceIds[0])
    assert.equal(audit.sourceLinks.services['i-synthetic-service'], results[0]!.value.record.result.serviceIds[0])
    assert.equal(audit.sourceLinks.components['i-synthetic-component'], results[0]!.value.record.result.componentIds[0])
    const existing = await post('previa', input, previewKey)
    assert.equal(existing.value.state, 'existing')
    assert.equal(Object.hasOwn(existing.value, 'previewToken'), false)
    const native = f.scenarios.list(f.at.id).find(scenario => scenario.id === existing.value.record.scenarioId)!
    assert.equal(f.scenarios.update(f.at.id, native.id, { revision: native.revision, name: 'Cenário revisado' }).name, 'Cenário revisado')
    assert.deepEqual((await post('confirmar', approval, confirmationKey)).value.record, existing.value.record)
  } finally {
    if (app) await new Promise<void>(resolve => app!.close(() => resolve()))
    db.close()
  }
})
