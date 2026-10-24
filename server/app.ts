import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AtendimentoRepository } from './atendimentos.ts'
import { CommercialRepository } from './commercial.ts'
import { ServiceError } from './errors.ts'

export interface AppOptions {
  atendimentos: AtendimentoRepository
  password?: string
  origin?: string
  revision?: string
  now?: () => number
}

export function createRequestHandler(options: AppOptions) {
  const commercial = new CommercialRepository(options.atendimentos.db)
  const now = options.now ?? Date.now
  const origin = options.origin ?? 'http://127.0.0.1:5173'
  const secure = new URL(origin).protocol === 'https:'
  const cookieName = 'funix_session'
  const configured = Boolean(options.password && options.password.length >= 12 && options.password.length <= 256)
  const salt = randomBytes(16)
  const expected = scryptSync(configured ? options.password! : randomBytes(32).toString('hex'), salt, 32)
  const sessions = new Map<string, number>()
  const attempts = new Map<string, { count: number; expires: number }>()
  const duration = 8 * 60 * 60 * 1000

  return async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Request-Id', requestId)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    const send = (status: number, value: unknown) => { res.writeHead(status); res.end(JSON.stringify(value)) }
    const fail = (status: number, code: string, message: string) => send(status, { error: { code, message, requestId } })
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (!url.pathname.startsWith('/api/')) return fail(404, 'NOT_FOUND', 'Rota não encontrada.')
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { status: 'ok', source: { system: 'app', storage: 'sqlite' }, capabilities: { atendimentos: true, messages: false, ai: false, erp: false } })
      if (req.method === 'GET' && url.pathname === '/api/ready') {
        if (!configured) return fail(503, 'AUTH_NOT_CONFIGURED', 'O acesso ainda não foi configurado.')
        try { options.atendimentos.ready() } catch { return fail(503, 'DATABASE_UNAVAILABLE', 'O armazenamento do aplicativo está indisponível.') }
        return send(200, { status: 'ready', revision: options.revision ?? null, source: 'app', storage: 'sqlite' })
      }
      const cookie = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? ''
      const authenticated = (sessions.get(cookie) ?? 0) > now()
      if (cookie && !authenticated) sessions.delete(cookie)

      if (url.pathname === '/api/session') {
        if (req.method === 'GET') return send(200, { authenticated, configured })
        if (!['POST', 'DELETE'].includes(req.method ?? '')) return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
        if (req.headers.origin !== origin) return fail(403, 'ORIGIN_REJECTED', 'Origem da solicitação não autorizada.')
        if (req.method === 'DELETE') {
          sessions.delete(cookie)
          res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure ? '; Secure' : ''}`)
          return send(200, { authenticated: false, configured })
        }
        if (!configured) return fail(503, 'AUTH_NOT_CONFIGURED', 'O acesso ao aplicativo ainda não foi configurado no servidor.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415, 'JSON_REQUIRED', 'Envie um corpo JSON.')
        const address = req.socket.remoteAddress ?? 'unknown'
        const previous = attempts.get(address)
        const attempt = previous && previous.expires > now() ? previous : { count: 0, expires: now() + 15 * 60 * 1000 }
        if (attempt.count >= 8) return fail(429, 'LOGIN_RATE_LIMIT', 'Muitas tentativas de acesso. Aguarde 15 minutos.')
        attempt.count += 1
        attempts.set(address, attempt)
        const body = await readJson(req, 1024)
        const password = body && typeof body === 'object' && 'password' in body ? body.password : null
        if (typeof password !== 'string' || password.length > 256 || !timingSafeEqual(scryptSync(password, salt, 32), expected)) return fail(401, 'INVALID_CREDENTIALS', 'Senha incorreta.')
        attempts.delete(address)
        for (const [id, expires] of sessions) if (expires <= now()) sessions.delete(id)
        if (sessions.size >= 100) return fail(503, 'SESSION_LIMIT', 'Limite de sessões atingido.')
        const token = randomBytes(32).toString('hex')
        sessions.set(token, now() + duration)
        res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${duration / 1000}${secure ? '; Secure' : ''}`)
        return send(200, { authenticated: true, configured })
      }

      if (!authenticated) return fail(401, 'AUTH_REQUIRED', 'Entre no aplicativo para consultar os registros.')
      if (url.pathname === '/api/workspace' || url.pathname.startsWith('/api/experiencias')) {
        return fail(req.method === 'GET' ? 410 : 405, 'FEATURE_UNAVAILABLE', 'Esta função operacional não pertence ao MVP Comercial. Nenhum acesso ao Coda foi realizado.')
      }
      const catalogCollection = url.pathname === '/api/catalogos'
      const catalogRecord = /^\/api\/catalogos\/([^/]{1,180})(\/historico)?$/.exec(url.pathname)
      const diagnoses = /^\/api\/atendimentos\/([^/]{1,100})\/diagnosticos(?:\/([^/]{1,100}))?$/.exec(url.pathname)
      let catalogId = ''
      if (catalogRecord) {
        try { catalogId = decodeURIComponent(catalogRecord[1]!) }
        catch { return fail(400, 'INVALID_PATH', 'Identificador inválido.') }
      }
      if (catalogCollection || catalogRecord || diagnoses) {
        if (req.method === 'GET') {
          if (catalogCollection) return send(200, commercial.catalogs())
          if (catalogRecord) return send(200, catalogRecord[2] ? commercial.historyOf(catalogId) : commercial.item(catalogId))
          if (diagnoses && !diagnoses[2]) return send(200, commercial.list(diagnoses[1]!))
          return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
        }
        const permitted = (catalogCollection && req.method === 'POST') || (catalogRecord && !catalogRecord[2] && req.method === 'PATCH') || (diagnoses && (!diagnoses[2] ? req.method === 'POST' : ['PATCH','DELETE'].includes(req.method ?? '')))
        if (!permitted) return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
        if (req.headers.origin !== origin) return fail(403, 'ORIGIN_REJECTED', 'Origem da solicitação não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415, 'JSON_REQUIRED', 'Envie um corpo JSON.')
        const body = await readJson(req, 64 * 1024)
        if (catalogCollection) return send(201, commercial.saveCatalog(body))
        if (catalogRecord) return send(200, commercial.saveCatalog(body, catalogId))
        if (diagnoses) {
          if (!diagnoses[2]) return send(200, commercial.add(diagnoses[1]!, body))
          return send(200, req.method === 'DELETE' ? commercial.remove(diagnoses[1]!, diagnoses[2]!, body) : commercial.updateDiagnosis(diagnoses[1]!, diagnoses[2]!, body))
        }
      }
      const collection = url.pathname === '/api/atendimentos'
      const record = /^\/api\/atendimentos\/([^/]{1,100})$/.exec(url.pathname)
      if (collection && req.method === 'GET') {
        const q = url.searchParams.get('q') ?? ''
        const limit = url.searchParams.get('limit') ?? '50'
        const offset = url.searchParams.get('offset') ?? '0'
        if (!/^\d+$/.test(limit) || !/^\d+$/.test(offset)) return fail(400, 'INVALID_QUERY', 'Parâmetros de busca inválidos.')
        return send(200, options.atendimentos.list({ q, limit: Number(limit), offset: Number(offset) }))
      }
      if (record && req.method === 'GET') return send(200, options.atendimentos.get(record[1]!))
      if ((collection && req.method === 'POST') || (record && req.method === 'PATCH')) {
        if (req.headers.origin !== origin) return fail(403, 'ORIGIN_REJECTED', 'Origem da solicitação não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415, 'JSON_REQUIRED', 'Envie um corpo JSON.')
        const body = await readJson(req, 64 * 1024)
        if (collection) return send(201, options.atendimentos.create(body))
        return send(200, options.atendimentos.update(record![1]!, body))
      }
      if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Este comando não está disponível neste incremento.')
      return fail(404, 'NOT_FOUND', 'Rota ou identificador não encontrado.')
    } catch (error) {
      if (error instanceof ServiceError) return fail(error.status, error.code, error.message)
      return fail(500, 'INTERNAL_ERROR', 'Não foi possível concluir a consulta. Use o identificador da solicitação para suporte.')
    }
  }
}

async function readJson(req: IncomingMessage, maximum: number): Promise<unknown> {
  let bytes = 0
  const parts: Buffer[] = []
  // Do not destroy the HTTP socket when rejecting an oversized streamed body:
  // the caller still needs to receive the JSON 413 response.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > maximum) {
      req.resume()
      throw new ServiceError(413, 'BODY_TOO_LARGE', 'Solicitação muito grande.')
    }
    parts.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) }
  catch { throw new ServiceError(400, 'INVALID_JSON', 'JSON inválido.') }
}

export function createApp(options: AppOptions) { return createServer(createRequestHandler(options)) }
