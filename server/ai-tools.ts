import {createHash, randomUUID, timingSafeEqual} from 'node:crypto'
import {closeSync, constants, fstatSync, openSync, readSync} from 'node:fs'
import {dirname, join} from 'node:path'
import type {DatabaseSync} from 'node:sqlite'
import type {AtendimentoRepository} from './atendimentos.ts'
import type {FinanceRepository} from './finance.ts'
import type {ProductionRepository} from './production.ts'
import {ServiceError} from './errors.ts'
import {inputObject, transaction} from './scenarios.ts'

export const aiToolsTokenHeader = 'x-funix-ai-token'
export const aiToolsPath = '/api/integrations/ai-tools/v1'
export const aiToolsHmlOrigin = 'https://hml.funix.com.br'
type Scope = 'read' | 'write'
type Credential = {actor: string, sha256: string, scopes: Scope[]}

const readOps = ['atendimento.buscar', 'atendimento.consultar', 'experiencia.consultar', 'financeiro.consultar', 'titulo.consultar']
const writeOps = ['atendimento.criar', 'agendamento.alterar', 'titulo.criar']
const opaqueId = /^[a-zA-Z0-9_-]{1,100}$/
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const invalid = (message: string): never => { throw new ServiceError(400, 'AI_INPUT_INVALID', message) }

export function initAiTools(db: DatabaseSync, origin: string | undefined, databasePath: string) {
  if (origin !== aiToolsHmlOrigin || databasePath === ':memory:') return undefined
  const file = join(dirname(databasePath), 'ai-tools.credentials.json')
  const credentials = (): unknown => {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stats = fstatSync(fd)
      if (!stats.isFile() || (stats.mode & 0o027) !== 0 || stats.size > 8192) throw new Error('Arquivo de credenciais inválido.')
      const buffer = Buffer.alloc(8193)
      const size = readSync(fd, buffer)
      if (size !== stats.size) throw new Error('Arquivo de credenciais alterado durante a leitura.')
      return JSON.parse(buffer.toString('utf8', 0, size))
    } finally {closeSync(fd)}
  }
  try {credentials()} catch {return undefined}
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_tool_mutations (
      actor TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_digest TEXT NOT NULL,
      operation TEXT NOT NULL,
      record_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      change_json TEXT NOT NULL,
      PRIMARY KEY (actor, idempotency_key)
    ) STRICT;
  `)
  // Read each time so replacing the mounted file revokes credentials without a restart.
  return credentials
}

export function authenticateAiTool(token: string | string[] | undefined, credentials: () => unknown) {
  const unauthorized = () => new ServiceError(401, 'AI_AUTH_REQUIRED', 'Credencial de integração inválida.')
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized()
  let entries: unknown
  try { entries = credentials() } catch { throw unauthorized() }
  if (!Array.isArray(entries) || entries.length > 32) throw unauthorized()
  const supplied = Buffer.from(digest(token), 'hex')
  const accepted: Credential[] = []
  for (const entry of entries) {
    if (!entry || typeof entry.actor !== 'string' || !opaqueId.test(entry.actor) ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Array.isArray(entry.scopes) || !entry.scopes.every((scope: unknown) => scope === 'read' || scope === 'write')) {
      throw unauthorized()
    }
    if (timingSafeEqual(supplied, Buffer.from(entry.sha256, 'hex'))) accepted.push(entry)
  }
  if (accepted.length !== 1) throw unauthorized()
  return accepted[0]!
}

function identifier(value: unknown): string {
  if (typeof value === 'string' && opaqueId.test(value)) return value
  return invalid('Informe o identificador do registro.')
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 12) return invalid('Estrutura JSON muito profunda.')
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : Number(a > b))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item, depth + 1)).join(',') + '}'
  }
  return JSON.stringify(value)
}

export function executeAiTool(
  services: {atendimentos: AtendimentoRepository, production: ProductionRepository, finance: FinanceRepository},
  credential: Credential, body: unknown, requestId: string, now: () => number,
) {
  const {operation, arguments: raw, idempotencyKey} = inputObject(body, ['operation', 'arguments', 'idempotencyKey'])
  if (typeof operation !== 'string' || !(readOps.includes(operation) || writeOps.includes(operation))) {
    throw new ServiceError(404, 'AI_OPERATION_UNKNOWN', 'Operação fora do catálogo de integração.')
  }
  const write = writeOps.includes(operation)
  if (!credential.scopes.includes(write ? 'write' : 'read')) {
    throw new ServiceError(403, 'AI_SCOPE_REQUIRED', 'Credencial sem escopo para esta operação.')
  }
  const {atendimentos, production, finance} = services
  const response = (data: unknown, id: string | null = null) => ({ok: true, requestId, operation, id, data})
  if (!write && idempotencyKey !== undefined) invalid('A chave de idempotência é exclusiva das escritas.')
  switch (operation) {
    case 'atendimento.buscar': {
      const {q} = inputObject(raw, ['q'])
      if (typeof q !== 'string' || !q.trim() || q.length > 100) return invalid('Informe um termo de busca de até 100 caracteres.')
      return response(atendimentos.list({q, limit: 20, offset: 0}))
    }
    case 'atendimento.consultar': {
      const id = identifier(inputObject(raw, ['id']).id)
      return response(atendimentos.get(id, true), id)
    }
    case 'experiencia.consultar': {
      const data = production.get(identifier(inputObject(raw, ['atendimentoId']).atendimentoId))
      return response(data, data.experience?.id)
    }
    case 'titulo.consultar': {
      const id = identifier(inputObject(raw, ['id']).id)
      return response(finance.title(id), id)
    }
    case 'financeiro.consultar': {
      inputObject(raw, [])
      const pending = {receivable: 0n, payable: 0n}
      for (const title of finance.overview().titles) pending[title.kind] += BigInt(title.balanceCents)
      return response({pendingCents: {receivable: String(pending.receivable), payable: String(pending.payable)}})
    }
  }

  if (typeof idempotencyKey !== 'string' || !uuid.test(idempotencyKey)) {
    return invalid('Informe uma chave de idempotência UUID em minúsculas.')
  }
  const fingerprint = digest(canonical({operation, arguments: raw ?? null}))
  const {db} = atendimentos
  return transaction(db, () => {
    const receipt = db.prepare(`SELECT input_digest, record_id, request_id FROM ai_tool_mutations
      WHERE actor = ? AND idempotency_key = ?`).get(credential.actor, idempotencyKey)
    if (receipt) {
      if (receipt.input_digest !== fingerprint) {
        throw new ServiceError(409, 'AI_IDEMPOTENCY_CONFLICT', 'A chave já confirma uma operação com outros dados.')
      }
      return {...response(null, String(receipt.record_id)), persisted: true, replayed: true, mutationRequestId: receipt.request_id}
    }

    let id: string
    let data: unknown
    let change: unknown
    switch (operation) {
      case 'atendimento.criar': {
        const saved = atendimentos.create(raw, true, true)
        id = saved.id
        data = saved
        change = {revision: saved.revision}
        break
      }
      case 'titulo.criar': {
        const args = inputObject(raw, ['kind', 'counterparty', 'description', 'amountCents', 'dueDate', 'experienceId'])
        const saved = finance.create({...args, id: randomUUID()}, true)
        id = saved.id
        data = saved
        change = {kind: saved.kind, amountCents: saved.amountCents, dueDate: saved.dueDate, experienceId: saved.experienceId}
        break
      }
      case 'agendamento.alterar': {
        const {atendimentoId, scheduledEntry, expectedAtendimentoRevision, expectedExperienceRevision} = inputObject(raw,
          ['atendimentoId', 'scheduledEntry', 'expectedAtendimentoRevision', 'expectedExperienceRevision'])
        const at = identifier(atendimentoId)
        const current = production.get(at, true)
        const before = current.experience
        if (!before) throw new ServiceError(404, 'EXPERIENCE_NOT_FOUND', 'Experiência agendada não encontrada.')
        if (before.revision !== expectedExperienceRevision || current.atendimentoRevision !== expectedAtendimentoRevision) {
          throw new ServiceError(409, 'SCHEDULE_CONFLICT', 'Consulte a revisão atual antes de reagendar.')
        }
        const result = production.schedule(at, {
          budgetIds: [], scheduledEntry, deliveryDate: before.deliveryDate, expectedAtendimentoRevision, expectedExperienceRevision,
        }, true)
        id = before.id
        data = result
        change = {atendimentoId: at, before: before.scheduledEntry, after: result.experience!.scheduledEntry,
          revision: result.experience!.revision}
        break
      }
      default: throw new Error('Operação de escrita sem implementação.')
    }
    db.prepare(`INSERT INTO ai_tool_mutations
      (actor, idempotency_key, input_digest, operation, record_id, request_id, occurred_at, change_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(credential.actor, idempotencyKey, fingerprint, operation, id, requestId,
      new Date(now()).toISOString(), JSON.stringify(change))
    return {...response(data, id), persisted: true, replayed: false, mutationRequestId: requestId}
  })
}
