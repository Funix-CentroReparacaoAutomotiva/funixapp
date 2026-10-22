import { createApp } from './app.ts'
import { CodaReadRepository } from './coda.ts'

const port = Number(process.env.FUNIX_API_PORT ?? 8787)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FUNIX_API_PORT inválida.')
const repository = new CodaReadRepository({
  token: process.env.CODA_API_TOKEN,
  views: process.env.FUNIX_CODA_FUNIL_VIEW_ID && process.env.FUNIX_CODA_ACOMPANHAMENTO_VIEW_ID ? {
    funil: process.env.FUNIX_CODA_FUNIL_VIEW_ID,
    acompanhamento: process.env.FUNIX_CODA_ACOMPANHAMENTO_VIEW_ID,
    historico: '',
  } : undefined,
})
const app = createApp({ repository, password: process.env.FUNIX_OPERATOR_PASSWORD, origin: process.env.FUNIX_APP_ORIGIN })
app.listen(port, '127.0.0.1', () => { process.stdout.write(`FUNIX API somente leitura: http://127.0.0.1:${port}\n`) })
