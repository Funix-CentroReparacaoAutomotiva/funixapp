import { timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { catalogItemUsable } from '../shared/commercial.ts'
import { CommercialRepository } from './commercial.ts'
import { ServiceError } from './errors.ts'
import { checkCodaLink, createExternalBudgetApplicationSchema, ExternalBudgetApplication } from './external-budget-application.ts'
import { parseExternalMapping } from './external-budget-plan.ts'
import { externalBudgetFromCoda } from './external-budget.ts'
import { normalizeHistoricalCodaCapture } from './historical-coda-capture.ts'
import { createHistoricalCodaProvider, historicalBudgetNumber, type HistoricalCaptureProvider } from './historical-coda-provider.ts'

const tokenPattern = /^[a-f0-9]{64}$/
const machineActor = 'n8n:external-budget-confirm'
export type ExternalBudgetApi = {
  provider: HistoricalCaptureProvider
  previewKey: string
  confirmationKey?: string
}

export function loadExternalBudgetApi(env: NodeJS.ProcessEnv, db: DatabaseSync): ExternalBudgetApi | undefined {
  if (env.FUNIX_EXTERNAL_BUDGET_ENABLED !== 'true') return
  const previewKey = env.FUNIX_EXTERNAL_BUDGET_PREVIEW_KEY
  const confirmationKey = env.FUNIX_EXTERNAL_BUDGET_CONFIRM_KEY || undefined
  if (!previewKey || !tokenPattern.test(previewKey) ||
      (confirmationKey && (!tokenPattern.test(confirmationKey) || confirmationKey === previewKey))) {
    throw new Error('FUNIX_EXTERNAL_BUDGET_KEYS_INVALID')
  }
  const provider = createHistoricalCodaProvider({ token: env.FUNIX_EXTERNAL_BUDGET_CODA_TOKEN ?? '' })
  createExternalBudgetApplicationSchema(db)
  return { provider, previewKey, confirmationKey }
}

function fields(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== keys.length || !keys.every(key => Object.hasOwn(raw, key))) {
    throw new ServiceError(400, 'INVALID_INPUT', 'Campos inválidos ou não permitidos.')
  }
  return raw as Record<string, unknown>
}

export function createExternalBudgetEndpoint(db: DatabaseSync, api: ExternalBudgetApi) {
  const application = new ExternalBudgetApplication(db)
  return async (
    action: string, authorization: string | undefined,
    readBody: () => Promise<unknown>,
  ) => {
    const confirming = action === 'confirmar'
    const expected = confirming ? api.confirmationKey : api.previewKey
    const match = /^Bearer ([a-f0-9]{64})$/i.exec(authorization ?? '')
    if (!expected || !match || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(match[1]!, 'hex'))) {
      throw new ServiceError(401, 'EXTERNAL_IMPORT_UNAUTHORIZED', 'Credencial de integração inválida.')
    }
    const lookup = action === 'consulta'
    const body = fields(await readBody(), [
      'atendimentoId', 'number', ...(!lookup ? ['mapping'] : []),
      ...(confirming ? ['previewToken', 'confirmed', 'identityReviewed', 'scopeReviewed', 'financialReviewed'] : []),
    ])
    const { atendimentoId } = body
    if (typeof atendimentoId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(atendimentoId)) {
      throw new ServiceError(400, 'INVALID_INPUT', 'Informe o ID do Atendimento no FunixApp.')
    }
    const number = historicalBudgetNumber(body.number)
    const mapping = lookup ? undefined : parseExternalMapping(body.mapping)
    const previewToken = body.previewToken
    if (confirming && (typeof previewToken !== 'string' || !tokenPattern.test(previewToken) ||
        body.confirmed !== true || body.identityReviewed !== true ||
        body.scopeReviewed !== true || body.financialReviewed !== true)) {
      throw new ServiceError(422, 'EXTERNAL_CONFIRMATION_REQUIRED', 'Confirme identidade, escopo e valores da prévia.')
    }
    const { first, second } = await api.provider(number)
    const { data: coda, warnings: sourceWarnings } = normalizeHistoricalCodaCapture(first, second)
    const source = externalBudgetFromCoda(coda).data
    if (source.source.documentNumber !== number) {
      throw new ServiceError(502, 'EXTERNAL_CODA_NUMBER_MISMATCH', 'A origem retornou outro orçamento.')
    }
    if (!mapping) {
      checkCodaLink(db, source, atendimentoId)
      const catalog = new CommercialRepository(db).catalogs().items.filter(catalogItemUsable)
        .map(({ id, kind, code, name, side, serviceId }) => ({ id, kind, code, name, side, serviceId }))
      return { status: 200, value: { atendimentoId, source, sourceCreatedAt: coda.metadata.createdAt, sourceWarnings, catalog } }
    }
    const input = { atendimentoId, source, mapping }
    if (!confirming) {
      const result = application.preview(input)
      if (result.state === 'existing') return { status: 200, value: { state: result.state, record: result.record } }
      if (result.state === 'blocked') return { status: 200, value: result }
      const { items, selected, components, calculation } = result.plan
      const { serviceSubtotal, serviceNet, componentSubtotal, total, discount, energy, days } = calculation
      return {
        status: 200,
        value: {
          state: result.state, atendimentoId, previewToken: result.previewToken,
          source: result.source, sourceCreatedAt: coda.metadata.createdAt, sourceWarnings, warnings: result.warnings,
          diagnoses: items.map(({ id, pieceId, diagnosisId, intensity }) => ({ sourceId: id, pieceId, diagnosisId, intensity })),
          services: selected,
          components: components.map(({ id, manualPrice, notes }) => ({ sourceId: id, manualPrice, notes })),
          native: {
            serviceSubtotal, serviceNet, componentSubtotal, total, discount, energy, days,
            lines: calculation.lines.map(({ id, kind, finalUnit, total, energy }) => ({ sourceId: id, kind, finalUnit, total, energy })),
          },
        },
      }
    }
    const result = application.confirm({
      ...input, previewToken: String(previewToken), confirmed: true, identityReviewed: true,
      scopeReviewed: true, financialReviewed: true,
    }, machineActor, coda)
    return { status: result.state === 'created' ? 201 : 200, value: result }
  }
}
