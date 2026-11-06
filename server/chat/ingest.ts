import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ServiceError } from '../errors.ts'
import { MAX_CHAT_EVENT_BYTES, parseEvent } from './events.ts'
import type { ChatRepository } from './repository.ts'
import { ingestKeys } from './ingest-config.ts'
import type { IngestOptions } from './ingest-config.ts'

export const INGEST_CLOCK_SKEW_SECONDS = 300
export const INGEST_BODY_TIMEOUT_MS = 5000
const AUTH_MESSAGE = 'Autenticação do evento inválida.'
function authError() { return new ServiceError(401, 'WHATSAPP_EVENT_AUTH', AUTH_MESSAGE) }
function closeAfterResponse(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Connection', 'close')
  req.once('error', () => {})
  res.once?.('finish', () => { req.destroy() })
}

function header(req: IncomingMessage, name: string): string | undefined {
  const count = req.rawHeaders?.filter((_, index) => index % 2 === 0 && req.rawHeaders[index]!.toLowerCase() === name).length ?? 0
  const value = req.headers[name]
  if (count > 1 || Array.isArray(value)) throw authError()
  return value
}

/** Bounded entity bytes, before UTF-8 decoding or JSON parsing. */
function rawBody(req: IncomingMessage): Promise<Buffer> {
  // An abort may emit 'error' immediately after 'aborted', before the rejected
  // promise's caller can attach its response-close handler.
  req.on('error', () => {})
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []; let bytes = 0
    const cleanup = () => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', aborted); req.pause()
    }
    const fail = (error: ServiceError) => { cleanup(); reject(error) }
    const data = (chunk: Buffer) => {
      const part = Buffer.from(chunk); bytes += part.length
      if (bytes > MAX_CHAT_EVENT_BYTES) return fail(new ServiceError(413, 'WHATSAPP_EVENT_SIZE', 'Evento excede o limite.'))
      parts.push(part)
    }
    const end = () => { cleanup(); resolve(Buffer.concat(parts, bytes)) }
    const aborted = () => fail(new ServiceError(400, 'WHATSAPP_EVENT_BODY', 'Corpo do evento incompleto.'))
    const timer = setTimeout(() => fail(new ServiceError(408, 'WHATSAPP_EVENT_TIMEOUT', 'Tempo de recebimento excedido.')), INGEST_BODY_TIMEOUT_MS)
    req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', aborted)
  })
}

/** Dedicated relay seam. It neither registers instances nor creates links. */
export function createIngestEndpoint(chat: ChatRepository, options?: IngestOptions, now = Date.now) {
  const keys = ingestKeys(options)
  const dummySecret = Buffer.alloc(32)
  let active = 0, window = -1, attempts = 0
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const started = performance.now(); let status = 500, entered = false
    try {
      if (!keys) throw new ServiceError(404, 'NOT_FOUND', 'Rota não encontrada.')
      const currentWindow = Math.floor(now() / 60_000)
      if (window !== currentWindow) { window = currentWindow; attempts = 0 }
      if (++attempts > 120 || active >= 4) {
        res.setHeader('Retry-After', '60')
        throw new ServiceError(429, 'WHATSAPP_EVENT_LIMIT', 'Limite de recebimento atingido.')
      }
      if (req.method !== 'POST') throw new ServiceError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
      if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) throw new ServiceError(403, 'WHATSAPP_RELAY_ONLY', 'Origem não permitida.')
      if (url.search) throw new ServiceError(400, 'WHATSAPP_EVENT_QUERY', 'Parâmetros não permitidos.')
      const type = header(req, 'content-type') ?? ''
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(type) || req.headers['content-encoding'] !== undefined) throw new ServiceError(415, 'WHATSAPP_EVENT_TYPE', 'Formato de evento não permitido.')
      const length = header(req, 'content-length')
      if (length !== undefined && (!/^(0|[1-9]\d*)$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_CHAT_EVENT_BYTES)) throw new ServiceError(413, 'WHATSAPP_EVENT_SIZE', 'Evento excede o limite.')
      const keyId = header(req, 'x-funix-key-id') ?? '', time = header(req, 'x-funix-timestamp') ?? '', signature = header(req, 'x-funix-signature') ?? ''
      const timely = () => /^(0|[1-9]\d{0,11})$/.test(time) && Math.abs(Math.floor(now() / 1000) - Number(time)) <= INGEST_CLOCK_SKEW_SECONDS
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || !/^sha256=[a-f0-9]{64}$/.test(signature) || !timely()) throw authError()
      const key = keys.get(keyId)
      active++; entered = true
      const bytes = await rawBody(req)
      const mac = createHmac('sha256', key?.secret ?? dummySecret).update(`v1\n${keyId}\n${time}\n`).update(bytes).digest()
      const matches = timingSafeEqual(mac, Buffer.from(signature.slice(7), 'hex'))
      if (!matches || !key || !timely()) throw authError()
      let raw: string
      try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
      catch { throw new ServiceError(422, 'CHAT_INVALID_EVENT', 'Evento de Chat inválido.') }
      // Schema and allowlist are checked only after raw-body authentication.
      // The repository independently checks explicit local registration and commit.
      const event = parseEvent(raw)
      if (!key.instances.has(event.instance)) throw new ServiceError(403, 'WHATSAPP_INSTANCE_DENIED', 'Instância não autorizada.')
      let receipt
      try { receipt = chat.ingest(raw) }
      catch (cause) {
        if (cause instanceof ServiceError) throw cause
        throw new ServiceError(503, 'WHATSAPP_EVENT_STORAGE', 'Persistência temporariamente indisponível.')
      }
      status = 202
      return { receiptId: receipt.receiptId, state: receipt.state, disposition: receipt.disposition }
    } catch (cause) {
      status = cause instanceof ServiceError ? cause.status : 500
      closeAfterResponse(req, res)
      throw cause
    } finally {
      if (entered) active--
      // Opt-in aggregate telemetry only. A monitoring failure cannot turn a
      // committed event into a missing ACK or expose configuration/payload data.
      try {
        if (options?.telemetry) void Promise.resolve(options.telemetry({ outcome: status === 202 ? 'accepted' : !keys ? 'disabled' : 'rejected', status, elapsedMs: Math.round(performance.now() - started) })).catch(() => {})
      } catch {}
    }
  }
}
