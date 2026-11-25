import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'

const endpoint = 'https://jsreport-yzac.srv2060217.hstgr.cloud/api/report'
const path = '/api/report'
const maxRequest = 21 * 1024 * 1024
const maxPdf = 15 * 1024 * 1024
const { FUNIX_JSREPORT_USERNAME: username, FUNIX_JSREPORT_PASSWORD: password } = process.env

if (username !== 'funix-hml-render' || !password) {
  throw new Error('Configure a credencial de renderização dedicada à HML.')
}

const authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64')
const expected = Buffer.from(authorization)

async function collect(stream, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) throw new RangeError('Corpo excede o limite.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const server = createServer({
  cert: readFileSync('/tls/server.pem'),
  key: readFileSync('/tls/server.key'),
  minVersion: 'TLSv1.2',
  requestTimeout: 10_000,
}, async (request, response) => {
  const fail = status => response.writeHead(status, { 'Content-Length': '0', Connection: 'close' }).end()
  if (request.url !== path) return fail(404)
  if (request.method !== 'POST') return fail(405)
  const provided = Buffer.from(request.headers.authorization ?? '')
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return fail(401)
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return fail(415)
  const size = Number(request.headers['content-length'] ?? 0)
  if (!Number.isSafeInteger(size) || size < 0 || size > maxRequest) return fail(413)

  try {
    const body = await collect(request, maxRequest)
    const result = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/pdf' },
      body,
      signal: AbortSignal.timeout(18_000),
    })
    if (!result.ok || !/^application\/pdf(?:\s*;|$)/i.test(result.headers.get('content-type') ?? '')) {
      await result.body?.cancel()
      return fail(502)
    }
    const pdf = await collect(result.body, maxPdf)
    return response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length }).end(pdf)
  } catch (error) {
    if (!response.destroyed) fail(error instanceof RangeError ? 413 : 502)
  }
})

server.maxConnections = 8
server.setTimeout(25_000, socket => socket.destroy())
server.listen(8443, '0.0.0.0')
