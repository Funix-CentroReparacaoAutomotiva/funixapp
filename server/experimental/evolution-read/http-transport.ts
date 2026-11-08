import type { ReadRequest, ReadTransport } from './client.ts'

/**
 * Opt-in Evolution HTTP adapter for the existing backend.
 * This module reads NO env, opens NO connection on import and registers NO route.
 * The caller must provide a server-approved origin and API key explicitly.
 */
export type HttpFetcher = typeof fetch
export type HttpTransportOptions = Readonly<{
  origin: string
  apiKey: string
  fetcher?: HttpFetcher
  maxResponseBytes?: number
}>

const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_REQUEST_BYTES = 2048
const ALLOWED_PATH = /^\/chat\/(?:findChats|findMessages)\/[A-Za-z0-9_-]{1,80}$/

function invalidConfiguration(): never { throw new Error('Evolution HTTP transport configuration invalid') }
function invalidResponse(): never { throw new Error('Evolution HTTP transport response invalid') }

/** Response and error messages never include provider bodies, URLs, credentials or headers. */
export function createEvolutionHttpTransport(options: HttpTransportOptions): ReadTransport {
  let parsed: URL
  try { parsed = new URL(options.origin) } catch { return invalidConfiguration() }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash || !parsed.hostname ||
      options.origin !== parsed.origin && options.origin !== parsed.origin + '/') return invalidConfiguration()
  if (typeof options.apiKey !== 'string' || !options.apiKey.trim() ||
      options.apiKey.length > 2048 || /[\r\n]/.test(options.apiKey)) return invalidConfiguration()
  const max = options.maxResponseBytes ?? MAX_RESPONSE_BYTES
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_RESPONSE_BYTES) return invalidConfiguration()
  const fetcher = options.fetcher ?? fetch
  return async (request: ReadRequest): Promise<{ status: number; body: unknown }> => {
    if (request.method !== 'POST' || !ALLOWED_PATH.test(request.path)) return invalidConfiguration()
    let json: string
    try { json = JSON.stringify(request.body) } catch { return invalidConfiguration() }
    if (typeof json !== 'string' || Buffer.byteLength(json) > MAX_REQUEST_BYTES) return invalidConfiguration()
    const response = await fetcher(new URL(request.path, parsed.origin), {
      method: 'POST',
      headers: { apikey: options.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: json,
      redirect: 'error',
      cache: 'no-store',
      signal: request.signal,
    })
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined)
      return { status: response.status, body: null }
    }
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null && Number.isFinite(Number(contentLength)) && Number(contentLength) > max) {
      await response.body?.cancel().catch(() => undefined)
      return invalidResponse()
    }
    if (!response.body) return invalidResponse()
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > max) { await reader.cancel(); return invalidResponse() }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    let value: unknown
    try { value = JSON.parse(Buffer.concat(chunks, total).toString('utf8')) } catch { return invalidResponse() }
    return { status: response.status, body: value }
  }
}
