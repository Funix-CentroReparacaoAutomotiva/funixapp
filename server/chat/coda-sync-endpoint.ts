import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ServiceError } from '../errors.ts'
import type { CodaEventSyncRepository } from './coda-sync.ts'

const maxBodyBytes = 4096
const skewSeconds = 300
function deny(): never {
  throw new ServiceError(401, 'CODA_SYNC_AUTH', 'Autenticação da integração inválida.')
}
function reject(status: number, code: string): never {
  throw new ServiceError(status, code, 'Solicitação da integração rejeitada.')
}

export type CodaSyncEndpointOptions = {
  repo: CodaEventSyncRepository
  secret: Buffer
  now?: () => number
}

/** A dedicated, non-browser machine-to-machine endpoint. It is disabled unless
 * the bootstrap explicitly injects a validated secret and repository.
 */
export function createCodaSyncEndpoint(config: CodaSyncEndpointOptions) {
  const now = config.now ?? Date.now
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (req.method !== 'POST') return reject(405, 'METHOD_NOT_ALLOWED')
    if (url.search || req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined)
      return reject(403, 'CODA_SYNC_BROWSER_DENIED')
    if (req.headers['content-encoding'] !== undefined ||
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(req.headers['content-type'] ?? '')))
      return reject(415, 'CODA_SYNC_TYPE')
    const header = (name: string): string | null => {
      const count = req.rawHeaders?.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length
      const raw = req.headers[name]
      if ((count !== undefined && count !== 1) || Array.isArray(raw)) return deny()
      return raw ?? null
    }
    const timestamp = header('x-funix-timestamp') ?? ''
    const signature = header('x-funix-signature') ?? ''
    if (!/^(0|[1-9]\d{0,11})$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(signature) ||
      Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > skewSeconds) return deny()
    const declared = header('content-length')
    if (declared != null && (!/^(0|[1-9]\d*)$/.test(declared) ||
      Number(declared) > maxBodyBytes)) return reject(413, 'CODA_SYNC_SIZE')
    const chunks: Buffer[] = []
    let bytes = 0
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    let body: Buffer
    try {
      for await (const part of req) {
        if (controller.signal.aborted) return reject(408, 'CODA_SYNC_TIMEOUT')
        bytes += (part as Buffer).length
        if (bytes > maxBodyBytes) return reject(413, 'CODA_SYNC_SIZE')
        chunks.push(Buffer.from(part as Buffer))
      }
      if (controller.signal.aborted) return reject(408, 'CODA_SYNC_TIMEOUT')
      body = Buffer.concat(chunks, bytes)
    } finally { clearTimeout(timer) }
    const actual = createHmac('sha256', config.secret)
      .update('coda-sync-v1\n' + timestamp + '\n').update(body).digest()
    if (!timingSafeEqual(actual, Buffer.from(signature.slice(7), 'hex'))) return deny()
    let event: unknown
    try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) }
    catch { return reject(422, 'CODA_SYNC_JSON') }
    const result = config.repo.sync(event)
    res.setHeader('Cache-Control', 'no-store')
    return { status: 202, ...result }
  }
}

/** Do not open database tables or expose a route without a dedicated opt-in
 * and high entropy base64 secret. This key is independent of Evolution keys.
 */
export function parseCodaSyncSecret(env: NodeJS.ProcessEnv): Buffer | null {
  if (env.FUNIX_CODA_SYNC_ENABLED !== 'true') return null
  const encoded = env.FUNIX_CODA_SYNC_HMAC_KEY_BASE64 ?? ''
  if (!/^[A-Za-z0-9+/]{43,88}={0,2}$/.test(encoded)) throw Error('CODA_SYNC_KEY_INVALID')
  const key = Buffer.from(encoded, 'base64')
  if (key.length < 32 || key.length > 64 || key.toString('base64') !== encoded)
    throw Error('CODA_SYNC_KEY_INVALID')
  return key
}
