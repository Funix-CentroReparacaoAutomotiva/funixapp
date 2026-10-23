import { createApp } from './app.ts'
import { CodaReadRepository } from './coda.ts'

const port = Number(process.env.FUNIX_API_PORT ?? 8787)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FUNIX_API_PORT inválida.')
const host = process.env.FUNIX_API_HOST ?? '127.0.0.1'
if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('FUNIX_API_HOST inválida.')
if (process.env.NODE_ENV === 'production') {
  const password = process.env.FUNIX_OPERATOR_PASSWORD ?? ''
  if (password.length < 12 || password.length > 256) throw new Error('Configure uma senha de operador com 12 a 256 caracteres.')
  const origin = new URL(process.env.FUNIX_APP_ORIGIN ?? 'http://invalid')
  if (origin.protocol !== 'https:' || origin.origin !== process.env.FUNIX_APP_ORIGIN) throw new Error('Configure FUNIX_APP_ORIGIN como origem HTTPS, sem caminho ou barra final.')
}
const repository = new CodaReadRepository({
  token: process.env.CODA_API_TOKEN,
  views: process.env.FUNIX_CODA_FUNIL_VIEW_ID && process.env.FUNIX_CODA_ACOMPANHAMENTO_VIEW_ID ? {
    funil: process.env.FUNIX_CODA_FUNIL_VIEW_ID,
    acompanhamento: process.env.FUNIX_CODA_ACOMPANHAMENTO_VIEW_ID,
    historico: '',
  } : undefined,
})
const app = createApp({ repository, password: process.env.FUNIX_OPERATOR_PASSWORD, origin: process.env.FUNIX_APP_ORIGIN, revision: process.env.FUNIX_REVISION })
app.requestTimeout = 15_000
app.headersTimeout = 10_000
app.listen(port, host, () => { process.stdout.write(`FUNIX API somente leitura na porta ${port}.\n`) })
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  app.close(() => process.exit(0))
  app.closeIdleConnections()
  setTimeout(() => process.exit(1), 15_000).unref()
})
