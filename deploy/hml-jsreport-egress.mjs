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

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const only = (value, fields) => object(value) && Object.keys(value).every(key => fields.includes(key))

function allowedReport(payload) {
  if (!only(payload, ['template', 'data']) || !object(payload.template)) return false
  const { template, data } = payload
  if (only(template, ['name'])) return template.name === 'FUNIX - Orcamento' && object(data)
  if (template.engine !== 'none' || typeof template.content !== 'string') return false
  if (template.recipe === 'chrome-pdf') {
    return only(template, ['content', 'engine', 'recipe', 'chrome']) && only(data, []) &&
      only(template.chrome, ['format', 'landscape', 'printBackground', 'displayHeaderFooter', 'headerTemplate',
        'footerTemplate', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'])
  }
  if (template.recipe !== 'static-pdf' || template.content !== 'FUNIX PDF' || data !== undefined ||
      !only(template, ['content', 'engine', 'recipe', 'staticPdf', 'pdfOperations']) ||
      !Array.isArray(template.pdfOperations) || template.pdfOperations.length !== 1) return false
  const asset = template.staticPdf?.pdfAsset
  const [operation] = template.pdfOperations
  if (!only(template.staticPdf, ['pdfAsset']) || !only(asset, ['content', 'encoding']) ||
      asset.encoding !== 'base64' || typeof asset.content !== 'string' ||
      !only(operation, ['type', 'mergeToFront', 'mergeWholeDocument', 'template']) ||
      operation.type !== 'merge' || operation.mergeToFront !== true || operation.mergeWholeDocument !== false) return false
  const stamp = operation.template
  return only(stamp, ['recipe', 'engine', 'content', 'chrome']) && stamp.recipe === 'chrome-pdf' &&
    stamp.engine === 'none' && typeof stamp.content === 'string' &&
    only(stamp.chrome, ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'printBackground'])
}

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
    let payload
    try { payload = JSON.parse(body) } catch { return fail(400) }
    if (!allowedReport(payload)) return fail(400)
    const result = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/pdf' },
      body: JSON.stringify(payload),
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
