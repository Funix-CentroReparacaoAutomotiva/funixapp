import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import type { ReadRepository } from './repository.ts'
import { ServiceError } from './errors.ts'

export interface AppOptions {
  repository: ReadRepository
  password?: string
  origin?: string
  revision?: string
  now?: () => number
}

export function createRequestHandler(options: AppOptions) {
  const now = options.now ?? Date.now
  const origin = options.origin ?? 'http://127.0.0.1:5173'
  const secure = new URL(origin).protocol === 'https:'
  const cookieName = 'funix_session'
  const configured = Boolean(options.password && options.password.length >= 12)
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
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { status: 'ok', source: { system: 'coda', configured: options.repository.configured }, readOnly: true })
      if (req.method === 'GET' && url.pathname === '/api/ready') {
        if (!configured) return fail(503, 'AUTH_NOT_CONFIGURED', 'O acesso ainda não foi configurado.')
        return send(200, { status: 'ready', revision: options.revision ?? null, readOnly: true })
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
        let bytes = 0
        const parts: Buffer[] = []
        for await (const chunk of req) {
          const buffer = Buffer.from(chunk)
          bytes += buffer.length
          if (bytes > 1024) throw new ServiceError(413, 'BODY_TOO_LARGE', 'Solicitação muito grande.')
          parts.push(buffer)
        }
        let body: unknown
        try { body = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { return fail(400, 'INVALID_JSON', 'JSON inválido.') }
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

      if (req.method !== 'GET') return fail(405, 'READ_ONLY', 'Este incremento permite apenas consultas. Nenhum dado operacional foi alterado.')
      if (!authenticated) return fail(401, 'AUTH_REQUIRED', 'Entre no aplicativo para consultar os registros.')
      if (url.pathname === '/api/workspace') {
        const area = url.searchParams.get('area') ?? 'funil'
        const scope = url.searchParams.get('scope') ?? 'acompanhamento'
        const q = url.searchParams.get('q') ?? ''
        const cursor = url.searchParams.get('cursor')
        const limitValue = url.searchParams.get('limit') ?? '50'
        if (!['funil', 'veiculos'].includes(area) || !['acompanhamento', 'historico'].includes(scope) || q.length > 150 || (cursor?.length ?? 0) > 2048 || !/^\d+$/.test(limitValue)) return fail(400, 'INVALID_QUERY', 'Parâmetros de consulta inválidos.')
        const limit = Number(limitValue)
        if (limit < 1 || limit > 100) return fail(400, 'INVALID_QUERY', 'O limite deve estar entre 1 e 100.')
        if (area === 'veiculos' && scope === 'historico') return fail(409, 'HISTORY_POLICY_PENDING', 'O Histórico aguarda validação: a vista atual do ERP inclui experiências sem saída registrada.')
        return send(200, await options.repository.workspace({ area: area as 'funil' | 'veiculos', scope: scope as 'acompanhamento' | 'historico', q, cursor, limit }))
      }
      const record = /^\/api\/(atendimentos|experiencias)\/(i-[\w-]{1,100})$/.exec(url.pathname)
      if (record) return send(200, await options.repository.record(record[1] === 'atendimentos' ? 'atendimento' : 'experiencia', record[2]!))
      return fail(404, 'NOT_FOUND', 'Rota ou identificador não encontrado.')
    } catch (error) {
      if (error instanceof ServiceError) return fail(error.status, error.code, error.message)
      return fail(500, 'INTERNAL_ERROR', 'Não foi possível concluir a consulta. Use o identificador da solicitação para suporte.')
    }
  }
}

export function createApp(options: AppOptions) { return createServer(createRequestHandler(options)) }
