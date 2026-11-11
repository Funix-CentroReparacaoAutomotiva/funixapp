import{createVoiceEndpoint}from'./voice-endpoint.ts'
import{openAIVoiceProvider}from'./voice-provider.ts'
import type{VoiceProvider}from'./voice-provider.ts'
import{applySuggestedServices}from'./apply-recommendations.ts'
import{recommendations}from'./diagnosis-recommendations.ts'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { loginRateLimitIdentity, parseTrustedLoginProxies } from './login-rate-limit.ts'
import type { AtendimentoRepository } from './atendimentos.ts'
import{InstallmentRepository}from'./budget-terms.ts'
import type{BudgetOptions}from'./budgets.ts'
import { BudgetRepository } from './budgets.ts'
import { PricingConfigurationRepository } from './pricing-config.ts'
import { ComponentRepository } from './components.ts'
import { calculate } from './pricing-engine.ts'
import { ScenarioRepository, selectedScenario } from './scenarios.ts'
import { CommercialRepository } from './commercial.ts'
import { ServiceError } from './errors.ts'
import {resolveVoiceOption,reviseVoiceComponent} from './voice-resolution.ts'
import { applyVoiceBatch } from './voice-apply.ts'
import { ChatRepository } from './chat/repository.ts'
import { readMessages } from './chat/read.ts'
import type { EvolutionChatBridge } from './chat/evolution-bridge.ts'
import { validateMedia, type MediaKind, type MediaInput } from './chat/evolution-media.ts'
import type { V20AssociationRepository } from './chat/v20-associations.ts'
import { createCodaSyncEndpoint } from './chat/coda-sync-endpoint.ts'
import type { CodaSyncEndpointOptions } from './chat/coda-sync-endpoint.ts'
import { UpdatePackageRepository } from './update-packages.ts'
import { createUpdatePackageIngest } from './update-packages-ingest.ts'
import { hasUpdatePackageSchema } from './update-packages-schema.ts'
import { GmailIntakeRepository } from './gmail-intake.ts'
import { GmailIntakeQueue } from './gmail-intake-queue.ts'
import { createGmailQueueEndpoint } from './gmail-intake-queue-endpoint.ts'
import { hasGmailIntakeQueueSchema } from './gmail-intake-queue-schema.ts'
import { hasGmailIntakeSchema } from './gmail-intake-schema.ts'
import { createGmailIntakeIngest, createGmailCandidateIngest } from './gmail-intake-ingest.ts'
import type { GmailIntakeDecisionInput } from '../shared/gmail-intake.ts'
import type { UpdatePackageDecision, UpdatePackageClarification } from '../shared/update-packages.ts'
import { createIngestEndpoint } from './chat/ingest.ts'
import type { IngestOptions } from './chat/ingest-config.ts'
import type{QuoteService}from'./component-quote-service.ts'
import{readQuoteContext}from'./component-quote-context.ts'
import{readSavedComponentQuoteContext}from'./component-quote-saved-context.ts'

export interface AppOptions {
  quotePilot?:QuoteService // explicit isolated harness injection only; no production factory
  evolutionChat?: EvolutionChatBridge // explicit opt-in injection; never auto-configured
  v20Associations?: V20AssociationRepository // independent opt-in: never read legacy chat_links
  whatsappIngest?: IngestOptions
  codaSync?: Omit<CodaSyncEndpointOptions, 'now'> // separately gated machine-to-machine intake
  voiceProvider?:VoiceProvider|null
  voiceProcessingMs?:number // injectable timeout for deterministic local tests
  voiceContextMode?:'standard'|'omit_recommendations' // explicit synthetic QA override
  budgetRenderer?:BudgetOptions['render']
  atendimentos: AtendimentoRepository
  password?: string
  origin?: string
  revision?: string
  now?: () => number
  trustedLoginProxies?: ReadonlySet<string> // synthetic QA injection; production config is parsed strictly
}

export function createRequestHandler(options: AppOptions) {
  const commercial = new CommercialRepository(options.atendimentos.db)
  const chat = new ChatRepository(options.atendimentos.db)
  const updates = new UpdatePackageRepository(options.atendimentos.db)
  const gmailIntake = new GmailIntakeRepository(options.atendimentos.db)
  const gmailQueue = new GmailIntakeQueue(options.atendimentos.db,options.now)
  const gmailQueueEndpoint = createGmailQueueEndpoint(gmailQueue,process.env.FUNIX_GMAIL_QUEUE_SECRET,
    process.env.FUNIX_GMAIL_INTAKE_STORAGE_ENABLED==='true' &&
    process.env.FUNIX_GMAIL_QUEUE_STORAGE_ENABLED==='true' &&
    process.env.FUNIX_GMAIL_QUEUE_API_ENABLED==='true' &&
    hasGmailIntakeQueueSchema(options.atendimentos.db),options.now)
  const gmailIntakeIngest = createGmailIntakeIngest(gmailIntake,process.env.FUNIX_GMAIL_INTAKE_SECRET,
    process.env.FUNIX_GMAIL_INTAKE_STORAGE_ENABLED==='true' &&
    process.env.FUNIX_GMAIL_INTAKE_INGEST_ENABLED==='true',options.now)
  const gmailCandidateIngest = createGmailCandidateIngest(gmailIntake,process.env.FUNIX_GMAIL_INTAKE_SECRET,
    process.env.FUNIX_GMAIL_INTAKE_STORAGE_ENABLED==='true' &&
    process.env.FUNIX_GMAIL_INTAKE_INGEST_ENABLED==='true',options.now)
  const updatesIngest = createUpdatePackageIngest(updates,process.env.FUNIX_UPDATES_INGEST_SECRET,
    process.env.FUNIX_UPDATES_STORAGE_ENABLED==='true' && process.env.FUNIX_UPDATES_INGEST_ENABLED==='true',options.now)
  const scenarios = new ScenarioRepository(options.atendimentos.db)
  const pricing = new PricingConfigurationRepository(options.atendimentos.db)
  const components = new ComponentRepository(options.atendimentos.db)
  const budgets = new BudgetRepository(options.atendimentos.db,{render:options.budgetRenderer})
  const voiceContextMode=options.voiceContextMode??(process.env.FUNIX_VOICE_CONTEXT_MODE==='omit_recommendations'?'omit_recommendations':'standard')
  const voice=createVoiceEndpoint(options.atendimentos.db,options.voiceProvider===undefined?openAIVoiceProvider():options.voiceProvider??undefined,options.voiceProcessingMs,voiceContextMode)
  const now = options.now ?? Date.now
  const ingest = createIngestEndpoint(chat, options.whatsappIngest, now)
  const codaIntake = options.codaSync ? createCodaSyncEndpoint({ ...options.codaSync, now }) : null
  const origin = options.origin ?? 'http://127.0.0.1:5173'
  const secure = new URL(origin).protocol === 'https:'
  const cookieName = 'funix_session'
  const configured = Boolean(options.password && options.password.length >= 12 && options.password.length <= 256)
  const salt = randomBytes(16)
  const expected = scryptSync(configured ? options.password! : randomBytes(32).toString('hex'), salt, 32)
  const sessions = new Map<string, number>()
  const attempts = new Map<string, { count: number; expires: number }>()
  const trustedLoginProxies = options.trustedLoginProxies ?? parseTrustedLoginProxies(process.env.FUNIX_LOGIN_TRUSTED_PROXY_IPS)
  const maxAttemptBuckets = 4096
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
      if (url.pathname === '/api/integrations/whatsapp/events') return send(202, await ingest(req, res, url))
      if (url.pathname === '/api/integrations/coda/atendimentos') {
        if (!codaIntake) return fail(404, 'NOT_FOUND', 'Rota não encontrada.')
        const result = await codaIntake(req, res, url)
        return send(result.status, { atendimentoId: result.atendimentoId, state: result.state })
      }
      if (url.pathname === '/api/integrations/updates/packages') {
        const result=await updatesIngest(req,res)
        return send(202,result)
      }
      const queueRoute=/^\/api\/integrations\/gmail\/queue\/(enqueue|claim|ack)$/.exec(url.pathname)
      if(queueRoute){
        const result=await gmailQueueEndpoint(req,res,queueRoute[1] as 'enqueue'|'claim'|'ack')
        return send(200,result)
      }
      if (url.pathname === '/api/integrations/gmail/intake-notices') {
        const result=await gmailIntakeIngest(req,res)
        return send(202,result)
      }
      if (url.pathname === '/api/integrations/gmail/intake-candidates') {
        const result=await gmailCandidateIngest(req,res)
        return send(202,result)
      }
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
        const address = loginRateLimitIdentity(req.socket.remoteAddress, req.headers, trustedLoginProxies)
        const previous = attempts.get(address)
        const attempt = previous && previous.expires > now() ? previous : { count: 0, expires: now() + 15 * 60 * 1000 }
        if (attempt.count >= 8) return fail(429, 'LOGIN_RATE_LIMIT', 'Muitas tentativas de acesso. Aguarde 15 minutos.')
        attempt.count += 1
        // Prevent spoofed or highly distributed addresses from growing memory without bound.
        if (!attempts.has(address) && attempts.size >= maxAttemptBuckets) {
          for (const [key, entry] of attempts) if (entry.expires <= now()) attempts.delete(key)
          // Evict the oldest bucket instead of denying every new visitor under distributed load.
          if (attempts.size >= maxAttemptBuckets) attempts.delete(attempts.keys().next().value!)
        }
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
      // Intake authorization only permits analysis, never changes in the ERP or Drive.
      const intakeDecisionMatch=/^\/api\/atualizacoes\/avisos-gmail\/([0-9a-f-]{36})\/decisao$/.exec(url.pathname)
      if(url.pathname==='/api/atualizacoes/avisos-gmail' || intakeDecisionMatch){
        if(req.method==='GET' && !intakeDecisionMatch){
          if([...url.searchParams.keys()].some(k=>k!=='visao'))return fail(400,'GMAIL_INTAKE_QUERY_INVALID','Filtro inválido.')
          const view=url.searchParams.get('visao')??'open'
          if(!['open','closed'].includes(view))return fail(400,'GMAIL_INTAKE_QUERY_INVALID','Filtro inválido.')
          const available=process.env.FUNIX_GMAIL_INTAKE_STORAGE_ENABLED==='true' &&
            hasGmailIntakeSchema(options.atendimentos.db)
          return send(200,{...gmailIntake.list(view as 'open'|'closed'),
            decisionsEnabled:available && process.env.FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED==='true'})
        }
        if(req.method!=='POST'||!intakeDecisionMatch)return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if(process.env.FUNIX_GMAIL_INTAKE_STORAGE_ENABLED!=='true'||
          process.env.FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED!=='true'||
          !hasGmailIntakeSchema(options.atendimentos.db))
          return fail(503,'GMAIL_INTAKE_DECISIONS_DISABLED','Autorização de triagem indisponível.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))
          return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,4096)
        if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a decisão.')
        return send(200,gmailIntake.decide(intakeDecisionMatch[1]!,body as GmailIntakeDecisionInput,'funix_operator'))
      }
      // Operator decisions and clarifications require authenticated same-origin sessions.
      // Preparing a proposal or authorizing it does not execute an external action.
      const decisionMatch = new RegExp('^/api/atualizacoes/([0-9a-f-]{36})/decisao$').exec(url.pathname)
      const clarificationMatch = new RegExp('^/api/atualizacoes/([0-9a-f-]{36})/complementar$').exec(url.pathname)
      if (url.pathname === '/api/atualizacoes' || decisionMatch || clarificationMatch) {
        if (url.pathname === '/api/atualizacoes') {
          if (req.method !== 'GET') return fail(405,'METHOD_NOT_ALLOWED','A consulta de pacotes é somente leitura.')
          if ([...url.searchParams.keys()].some(k=>!['visao','q'].includes(k))) return fail(400,'PACKAGE_QUERY_INVALID','Filtro inválido.')
          const visao=url.searchParams.get('visao')??'open'
          const query=url.searchParams.get('q')??''
          if (!['open','closed'].includes(visao) || query.length>160) return fail(400,'PACKAGE_QUERY_INVALID','Filtro inválido.')
          const available=hasUpdatePackageSchema(options.atendimentos.db)&&process.env.FUNIX_UPDATES_STORAGE_ENABLED==='true'
          return send(200,{...updates.list(visao as 'open'|'closed',query),
            decisionsEnabled:available&&process.env.FUNIX_UPDATES_DECISIONS_ENABLED==='true',
            clarificationsEnabled:available&&process.env.FUNIX_UPDATES_CLARIFICATIONS_ENABLED==='true'})
        }
        if (req.method!=='POST') return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if (clarificationMatch) {
          if(process.env.FUNIX_UPDATES_STORAGE_ENABLED!=='true' || process.env.FUNIX_UPDATES_CLARIFICATIONS_ENABLED!=='true' ||
            !hasUpdatePackageSchema(options.atendimentos.db)) return fail(503,'PACKAGE_CLARIFICATIONS_DISABLED','Complementação indisponível.')
        } else if(process.env.FUNIX_UPDATES_STORAGE_ENABLED!=='true' || process.env.FUNIX_UPDATES_DECISIONS_ENABLED!=='true' ||
          !hasUpdatePackageSchema(options.atendimentos.db)) return fail(503,'PACKAGE_DECISIONS_DISABLED','Aprovações ainda não estão habilitadas.')
        if (req.headers.origin!==origin) return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,4096)
        if ((sessions.get(cookie)??0)<=now()) return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a decisão.')
        if (clarificationMatch) return send(202,updates.submitClarification(clarificationMatch[1]!,body as UpdatePackageClarification,'funix_operator'))
        return send(200,updates.decide(decisionMatch![1]!,body as UpdatePackageDecision,'funix_operator'))
      }

      if(req.method==='GET'&&url.pathname==='/api/cotacoes/capacidade'){
        const enabled=Boolean(options.quotePilot)&&(process.env.NODE_ENV!=='production'||process.env.FUNIX_QUOTE_ENABLED==='true')
        return send(200,{enabled,diagnosisEnabled:enabled&&process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED==='true'})
      }
      const savedComponentQuoteRoute=/^\/api\/atendimentos\/([^/]{1,100})\/componentes\/([^/]{1,100})\/cotar$/.exec(url.pathname)
      if(savedComponentQuoteRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST para cotar.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        if(!options.quotePilot||(process.env.NODE_ENV==='production'&&process.env.FUNIX_QUOTE_ENABLED!=='true')||process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED!=='true')return fail(503,'QUOTE_DISABLED','Cotação indisponível.')
        const body=await readJson(req,1024),context=readSavedComponentQuoteContext(options.atendimentos.db,savedComponentQuoteRoute[1]!,savedComponentQuoteRoute[2]!,body)
        if(!context.query)return send(200,{status:'needs_details',offers:[],observedAt:new Date(now()).toISOString(),expiresAt:new Date(now()).toISOString(),cached:false})
        const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort()}
        res.once('close',cancel)
        try{
          const result=await options.quotePilot.run(context.query,cookie,controller.signal)
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a consulta.')
          context.revalidate()
          return send(200,result)
        }finally{res.off('close',cancel)}
      }
      const quoteRoute=/^\/api\/atendimentos\/([^/]{1,100})\/copiloto\/cotar$/.exec(url.pathname)
      if(quoteRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST para cotar.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        if(!options.quotePilot||(process.env.NODE_ENV==='production'&&process.env.FUNIX_QUOTE_ENABLED!=='true'))return fail(503,'QUOTE_DISABLED','Cotação indisponível.')
        const body=await readJson(req,1024),context=readQuoteContext(options.atendimentos.db,quoteRoute[1]!,body,cookie)
        if(!context.query)return send(200,{status:'needs_details',offers:[],observedAt:new Date(now()).toISOString(),expiresAt:new Date(now()).toISOString(),cached:false})
        const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort()}
        res.once('close',cancel)
        try{
          const result=await options.quotePilot.run(context.query,cookie,controller.signal)
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a consulta.')
          context.revalidate()
          return send(200,result)
        }finally{res.off('close',cancel)}
      }
      // V20 N:N associations: opt-in, single authenticated operator and explicit Origin on writes.
      // These operations NEVER contact Evolution or change legacy chat/messages.
      if (options.evolutionChat && options.v20Associations && url.pathname.startsWith('/api/chat/conversations/')) {
        const associationRoute = /^\/api\/chat\/conversations\/([a-f0-9-]{36})\/(atendimentos)(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname)
        const contextRoute = /^\/api\/chat\/conversations\/([a-f0-9-]{36})\/context$/.exec(url.pathname)
        if (associationRoute || contextRoute) {
          const conversationId = (associationRoute?.[1] ?? contextRoute?.[1])!
          if (!options.v20Associations.resolveRemoteJid(conversationId, 'funix_comercial')) return fail(404, 'CHAT_NOT_FOUND', 'Conversa não encontrada.')
          if ([...url.searchParams.keys()].length) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
          if (associationRoute && req.method === 'GET' && !associationRoute[3])
            return send(200, options.v20Associations.listActive(conversationId))
          if (req.headers.origin !== origin) return fail(403, 'ORIGIN_REJECTED', 'Origem não autorizada.')
          if (!req.headers['content-type']?.startsWith('application/json')) return fail(415, 'JSON_REQUIRED', 'Envie JSON.')
          const body = await readJson(req, 2048)
          if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'CHAT_INVALID_BODY', 'Corpo inválido.')
          const input = body as Record<string, unknown>
          if (associationRoute && req.method === 'POST' && !associationRoute[3]) {
            if (Object.keys(input).some(key => !['atendimentoId','expectedRevision','requestId','reason'].includes(key)))
              return fail(400, 'CHAT_INVALID_BODY', 'Campos inválidos.')
            return send(201, options.v20Associations.link({
              conversationId, atendimentoId: input.atendimentoId as string, expectedRevision: input.expectedRevision as number,
              requestId: input.requestId as string, reason: input.reason as string,
            }))
          }
          if (associationRoute && req.method === 'DELETE' && associationRoute[3]) {
            if (Object.keys(input).some(key => !['expectedRevision','requestId','reason'].includes(key)))
              return fail(400, 'CHAT_INVALID_BODY', 'Campos inválidos.')
            return send(200, options.v20Associations.unlink({
              conversationId, linkId: associationRoute[3], expectedRevision: input.expectedRevision as number,
              requestId: input.requestId as string, reason: input.reason as string,
            }))
          }
          if (contextRoute && req.method === 'POST') {
            if (Object.keys(input).some(key => key !== 'linkId'))
              return fail(400, 'CHAT_INVALID_BODY', 'Campos inválidos.')
            if (!Object.hasOwn(input, 'linkId') || (input.linkId !== null && typeof input.linkId !== 'string'))
              return fail(400, 'CHAT_INVALID_BODY', 'Contexto inválido.')
            return send(200, { activeAtendimentoId: options.v20Associations.selectAtendimento(conversationId, input.linkId as string | null) })
          }
          return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
        }
      }
      // Resolve the unique active Coda-linked conversation for direct Funil navigation.
      // Returns opaque IDs only; the caller must already hold a valid FUNIX session.
      const canonicalConversationRoute = /^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversation$/.exec(url.pathname)
      if (canonicalConversationRoute && options.evolutionChat && options.codaSync) {
        if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
        if (url.search) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        const conversation = options.evolutionChat.conversationForAtendimento(canonicalConversationRoute[1]!)
        return conversation ? send(200, conversation) : fail(404, 'CHAT_NOT_LINKED', 'Nenhuma conversa canônica única vinculada.')
      }
      // Text-only WhatsApp send. No JID is accepted from the browser:
      // the active Coda mapping and opaque conversation ID select the recipient.
      const sendEvolutionRoute = /^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversations\/([a-f0-9-]{36})\/send-text$/.exec(url.pathname)
      if (sendEvolutionRoute) {
        if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST para enviar texto.')
        if (!options.evolutionChat || !options.codaSync || process.env.FUNIX_EVOLUTION_SEND_ENABLED !== 'true')
          return fail(503, 'CHAT_SEND_DISABLED', 'O envio WhatsApp não está habilitado.')
        if (req.headers.origin !== origin) return fail(403, 'ORIGIN_REJECTED', 'Origem não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415, 'JSON_REQUIRED', 'Envie JSON.')
        if (url.search) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        const data = await readJson(req, 8192)
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            Object.keys(data).length !== 1 || typeof (data as Record<string, unknown>).text !== 'string')
          return fail(400, 'CHAT_SEND_INVALID', 'Envie somente o texto da mensagem.')
        const text = (data as { text: string }).text
        if (!text.trim() || [...text].length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
          return fail(400, 'CHAT_SEND_INVALID', 'Mensagem vazia, inválida ou muito longa.')
        try {
          const result = await options.evolutionChat.sendTextForAtendimento(sendEvolutionRoute[1]!, sendEvolutionRoute[2]!, text)
          if ((sessions.get(cookie) ?? 0) <= now()) return fail(401, 'AUTH_REQUIRED', 'Sessão encerrada durante o envio. Confira o WhatsApp antes de reenviar.')
          if (result.state === 'unlinked') return fail(404, 'CHAT_NOT_LINKED', 'Conversa não vinculada ao Atendimento.')
          if (result.state === 'busy') return fail(409, 'CHAT_SEND_IN_PROGRESS', 'Há um envio em andamento nesta conversa.')
          if (result.state !== 'accepted') return fail(400, 'CHAT_SEND_INVALID', 'Mensagem inválida ou envio desativado.')
          return send(200, { state: 'accepted', messageId: result.receipt.messageId })
        } catch {
          return fail(502, 'CHAT_SEND_UNCERTAIN', 'Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente.')
        }
      }
      // WhatsApp media: authenticated operator, canonical Coda JID, no public URLs.
      const mediaSendRoute=/^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversations\/([a-f0-9-]{36})\/send-media$/.exec(url.pathname)
      if(mediaSendRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST.')
        if(!options.evolutionChat||!options.codaSync||process.env.FUNIX_EVOLUTION_MEDIA_ENABLED!=='true')
          return fail(503,'CHAT_MEDIA_DISABLED','Mídias não habilitadas.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        if(url.search)return fail(400,'CHAT_INVALID_QUERY','Parâmetros inválidos.')
        const raw=await readJson(req,17*1024*1024)
        if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail(400,'CHAT_MEDIA_INVALID','Mídia inválida.')
        const data=raw as Record<string,unknown>,keys=Object.keys(data)
        if(keys.some(key=>!['kind','mimeType','base64','caption'].includes(key))||
          typeof data.kind!=='string'||!['image','video','audio'].includes(data.kind)||
          typeof data.mimeType!=='string'||typeof data.base64!=='string'||
          (data.caption!==undefined&&typeof data.caption!=='string'))return fail(400,'CHAT_MEDIA_INVALID','Mídia inválida.')
        const item={kind:data.kind as MediaKind,mimeType:data.mimeType,base64:data.base64,
          ...(typeof data.caption==='string'?{caption:data.caption}:{})} as MediaInput
        try{validateMedia(item.kind,item.mimeType,item.base64)}
        catch{return fail(400,'CHAT_MEDIA_INVALID','Formato ou tamanho de mídia não suportado.')}
        try{
          const result=await options.evolutionChat.sendMediaForAtendimento(mediaSendRoute[1]!,mediaSendRoute[2]!,item)
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada; confira o WhatsApp antes de reenviar.')
          if(result.state==='unlinked')return fail(404,'CHAT_NOT_LINKED','Conversa não vinculada ao Atendimento.')
          if(result.state==='busy')return fail(409,'CHAT_SEND_IN_PROGRESS','Outro envio está em andamento.')
          if(result.state!=='accepted')return fail(400,'CHAT_MEDIA_INVALID','Mídia inválida.')
          return send(200,{state:'accepted',messageId:result.receipt.messageId})
        }catch{return fail(502,'CHAT_MEDIA_SEND_UNCERTAIN','Envio não confirmado. Confira o WhatsApp antes de tentar outra vez.')}
      }
      const mediaReadRoute=/^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversations\/([a-f0-9-]{36})\/messages\/([A-Za-z0-9_:-]{1,200})\/media$/.exec(url.pathname)
      if(mediaReadRoute){
        if(req.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED','Use GET.')
        if(!options.evolutionChat||!options.codaSync||process.env.FUNIX_EVOLUTION_MEDIA_ENABLED!=='true')
          return fail(503,'CHAT_MEDIA_DISABLED','Mídias não habilitadas.')
        if([...url.searchParams.keys()].some(key=>key!=='page')||url.searchParams.getAll('page').length>1)
          return fail(400,'CHAT_INVALID_QUERY','Parâmetros inválidos.')
        const page=url.searchParams.get('page')??'1'
        if(!/^[1-9][0-9]{0,3}$/.test(page)||Number(page)>1000)
          return fail(400,'CHAT_INVALID_QUERY','Página inválida.')
        try{
          const result=await options.evolutionChat.mediaForAtendimento(
            mediaReadRoute[1]!,mediaReadRoute[2]!,mediaReadRoute[3]!,Number(page))
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada.')
          if(!result)return fail(404,'CHAT_MEDIA_NOT_FOUND','Mídia indisponível neste Atendimento.')
          if(result.state==='too_large')return fail(413,'CHAT_MEDIA_TOO_LARGE','Arquivo excede o limite suportado.')
          return send(200,{kind:result.kind,mimeType:result.mimeType,base64:result.base64})
        }catch(cause){
          // Never leak provider URLs, keys, raw media or error bodies.
          const code=cause instanceof Error?cause.message:''
          if(code==='MEDIA_PROVIDER_TOO_LARGE')return fail(413,'CHAT_MEDIA_TOO_LARGE','Arquivo acima do limite disponível para o Chat.')
          if(code==='MEDIA_FORMAT_UNSUPPORTED')return fail(415,'CHAT_MEDIA_UNSUPPORTED','Formato de vídeo, imagem ou áudio não compatível com o Chat.')
          if(code==='MEDIA_CONTENT_INVALID')return fail(422,'CHAT_MEDIA_INVALID_CONTENT','O arquivo recuperado não corresponde ao formato informado.')
          if(code==='MEDIA_PROVIDER_TIMEOUT')return fail(504,'CHAT_MEDIA_TIMEOUT','A Evolution não respondeu a tempo para esta mídia.')
          return fail(503,'CHAT_MEDIA_UNAVAILABLE','Não foi possível recuperar a mídia pela Evolution.')
        }
      }
      // Authenticated canonical read: a client-supplied conversationId must be
      // confirmed against the current Coda→Atendimento mapping on the server.
      const syncedEvolutionRoute = /^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversations\/([a-f0-9-]{36})\/messages$/.exec(url.pathname)
      if (syncedEvolutionRoute && options.evolutionChat && options.codaSync) {
        if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'O Chat está disponível somente para leitura.')
        if ([...url.searchParams.keys()].some(key => key !== 'page') || url.searchParams.getAll('page').length > 1)
          return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        const page = url.searchParams.get('page') ?? '1'
        if (!/^[1-9][0-9]{0,3}$/.test(page) || Number(page) > 1000)
          return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        try {
          const result = await options.evolutionChat.messagesForAtendimento(syncedEvolutionRoute[1]!, syncedEvolutionRoute[2]!, Number(page))
          if ((sessions.get(cookie) ?? 0) <= now()) return fail(401, 'AUTH_REQUIRED', 'Sessão encerrada durante a consulta.')
          return result ? send(200, result) : fail(404, 'CHAT_NOT_LINKED', 'Conversa não vinculada a este Atendimento.')
        } catch { return fail(503, 'CHAT_PROVIDER_UNAVAILABLE', 'Não foi possível consultar as mensagens agora.') }
      }
      // Opt-in only. Existing bootstrap does not inject a bridge; no new route in production.
      if (options.evolutionChat && (url.pathname === '/api/chat/conversations' || url.pathname.startsWith('/api/chat/conversations/'))) {
        if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'O Chat está disponível somente para leitura.')
        const messagesRoute = /^\/api\/chat\/conversations\/([a-f0-9-]{36})\/messages$/.exec(url.pathname)
        const listRoute = url.pathname === '/api/chat/conversations'
        if (!listRoute && !messagesRoute) return fail(404, 'NOT_FOUND', 'Conversa não encontrada.')
        const keys = [...url.searchParams.keys()]
        if (listRoute) {
          if (keys.some(k => k !== 'skip') || url.searchParams.getAll('skip').length > 1) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
          const skip = url.searchParams.get('skip') ?? '0'
          if (!/^(0|[1-9][0-9]{0,5})$/.test(skip) || Number(skip) > 500000) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
          try {
            const result = await options.evolutionChat.list(Number(skip))
            if ((sessions.get(cookie) ?? 0) <= now()) return fail(401, 'AUTH_REQUIRED', 'Sessão encerrada durante a consulta.')
            return send(200, options.v20Associations ? { ...result, linksEnabled: true } : result)
          } catch { return fail(503, 'CHAT_PROVIDER_UNAVAILABLE', 'Não foi possível consultar as conversas agora.') }
        }
        if (keys.some(k => k !== 'page') || url.searchParams.getAll('page').length > 1) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        const page = url.searchParams.get('page') ?? '1'
        if (!/^[1-9][0-9]{0,3}$/.test(page) || Number(page) > 1000) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        try {
          const result = await options.evolutionChat.messages(messagesRoute![1]!, Number(page))
          if ((sessions.get(cookie) ?? 0) <= now()) return fail(401, 'AUTH_REQUIRED', 'Sessão encerrada durante a consulta.')
          return result ? send(200, result) : fail(404, 'CHAT_NOT_FOUND', 'Conversa não encontrada.')
        } catch { return fail(503, 'CHAT_PROVIDER_UNAVAILABLE', 'Não foi possível consultar as mensagens agora.') }
      }
      const chatReadRoute = /^\/api\/atendimentos\/([^/]+)\/messages$/.exec(url.pathname)
      if (chatReadRoute) {
        if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'O Chat está disponível somente para leitura.')
        return send(200, readMessages(chat, chatReadRoute[1]!, url.searchParams))
      }
      const voiceResolveRoute=/^\/api\/atendimentos\/([^/]{1,100})\/copiloto\/resolver$/.exec(url.pathname)
      if(voiceResolveRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST para resolver a dúvida.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,4096)
        if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a confirmação.')
        return send(200,resolveVoiceOption(options.atendimentos.db,voiceResolveRoute[1]!,body,cookie,requestId))
      }
      const voiceReviseRoute=/^\/api\/atendimentos\/([^/]{1,100})\/copiloto\/revisar$/.exec(url.pathname)
      if(voiceReviseRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST para revisar o plano.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,4096)
        if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a revisão.')
        return send(200,reviseVoiceComponent(options.atendimentos.db,voiceReviseRoute[1]!,body,cookie,requestId))
      }
      const voiceApplyRoute=/^\/api\/atendimentos\/([^/]{1,100})\/copiloto\/aplicar$/.exec(url.pathname)
      if(voiceApplyRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST para confirmar o plano.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,4096)
        if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a confirmação.')
        return send(200,applyVoiceBatch(options.atendimentos.db,voiceApplyRoute[1]!,body,cookie))
      }
      const voiceRoute=/^\/api\/atendimentos\/([^/]{1,100})\/copiloto\/interpretar$/.exec(url.pathname)
      if(voiceRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST para interpretar áudio.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        const disconnect=()=>{if(!res.writableEnded)req.emit('aborted')}
        res.once('close',disconnect)
        try{return send(200,await voice(req,voiceRoute[1]!,url,requestId,()=>(sessions.get(cookie)??0)>now(),cookie))}
        finally{res.off('close',disconnect)}
      }
      if (url.pathname === '/api/workspace' || url.pathname.startsWith('/api/experiencias')) {
        return fail(req.method === 'GET' ? 410 : 405, 'FEATURE_UNAVAILABLE', 'Esta função operacional não pertence ao MVP Comercial. Nenhum acesso ao Coda foi realizado.')
      }
      if(url.pathname==='/api/recomendacoes'){
        if(req.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED','Consulta somente leitura.')
        if([...url.searchParams.keys()].some(k=>!['diagnosisId','intensity'].includes(k))||url.searchParams.getAll('diagnosisId').length!==1||url.searchParams.getAll('intensity').length!==1)return fail(400,'INVALID_INPUT','Informe apenas diagnosisId e intensity.')
        return send(200,{items:recommendations(options.atendimentos.db,url.searchParams.get('diagnosisId'),url.searchParams.get('intensity'))})
      }
      const budgetRoute = /^\/api\/atendimentos\/([^/]{1,100})\/orcamentos(?:\/([^/]{1,100}))?(\/pdf)?$/.exec(url.pathname)
      if (budgetRoute) {
        const at = budgetRoute[1]!, id = budgetRoute[2], pdf = budgetRoute[3]
        if (req.method === 'GET') {
          if (!id) return send(200,budgets.list(at))
          if (pdf) {
            const data = budgets.pdf(at,id), version = budgets.get(at,id)
            res.setHeader('Content-Type','application/pdf')
            res.setHeader('Content-Disposition',`attachment; filename="FUNIX-orcamento-${version.documentNumber?.replace(/[^A-Za-z0-9-]/g,'')??version.label}.pdf"; filename*=UTF-8''${encodeURIComponent(version.filename??`FUNIX-orcamento-${version.label}.pdf`)}`)
            res.setHeader('Content-Length',data.length)
            res.writeHead(200);res.end(data);return
          }
          return send(200,budgets.get(at,id))
        }
        if (req.method !== 'POST' || pdf || (id && id !== 'previa' && id !== 'previa-pdf')) return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if (req.headers.origin !== origin) return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415,'JSON_REQUIRED','Envie um corpo JSON.')
        const body = await readJson(req,64*1024)
        if(id==='previa-pdf'){
          const data=await budgets.previewPdf(at,body)
          res.setHeader('Content-Type','application/pdf')
          res.setHeader('Content-Disposition','inline; filename="FUNIX-previa.pdf"')
          res.setHeader('Content-Length',data.length)
          res.setHeader('Cache-Control','no-store')
          res.writeHead(200);res.end(data);return
        }
        return send(id === 'previa' ? 200 : 201,id === 'previa' ? budgets.preview(at,body) : await budgets.emit(at,body))
      }
      if(url.pathname==='/api/parcelamento'){
        const repository=new InstallmentRepository(options.atendimentos.db)
        if(req.method==='GET')return send(200,repository.get())
        if(req.method!=='PATCH')return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        return send(200,repository.save(await readJson(req,4096)))
      }
      const globalPricing = url.pathname === '/api/precificacao'
      const pricingRoute = /^\/api\/atendimentos\/([^/]{1,100})\/(parametros|componentes)(?:\/([^/]{1,100}))?$/.exec(url.pathname)
      if (globalPricing || pricingRoute) {
        const at = pricingRoute?.[1], kind = pricingRoute?.[2], id = pricingRoute?.[3]
        if (at) options.atendimentos.get(at)
        if (req.method === 'GET') {
          if (globalPricing) return send(200,pricing.get())
          if (kind === 'parametros' && !id) return send(200,pricing.settings(at!))
          if (kind === 'componentes' && !id) return send(200,components.list(at!))
          return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        }
        const initializing=kind==='parametros'&&id==='inicializar'&&req.method==='POST'
        const allowed = (globalPricing || kind === 'parametros') ? initializing || req.method === 'PATCH' && !id : kind === 'componentes' && ((!id && req.method === 'POST') || (Boolean(id) && ['PATCH','DELETE'].includes(req.method ?? '')))
        if (!allowed) return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if (req.headers.origin !== origin) return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415,'JSON_REQUIRED','Envie um corpo JSON.')
        const body = await readJson(req,globalPricing ? 1024*1024 : 64*1024)
        if (globalPricing) return send(200,pricing.save(body))
        if (kind === 'parametros') return send(200,initializing?pricing.initializeSettings(at!,body):pricing.saveSettings(at!,body))
        return send(req.method === 'POST' ? 201 : 200,req.method === 'DELETE' ? components.remove(at!,id!,body) : req.headers['x-funix-include-revision']==='1'?components.save(at!,body,id,true):components.save(at!,body,id))
      }
      const applyRoute=/^\/api\/atendimentos\/([^/]{1,100})\/diagnosticos\/([^/]{1,100})\/recomendacoes$/.exec(url.pathname)
      if(applyRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        return send(200,applySuggestedServices(options.atendimentos.db,applyRoute[1]!,applyRoute[2]!,await readJson(req,64*1024)))
      }
      const confirmationRoute=/^\/api\/atendimentos\/([^/]{1,100})\/cenarios\/([^/]{1,100})\/servicos\/([^/]{1,100})\/confirmacao$/.exec(url.pathname)
      if(confirmationRoute){
        if(req.method!=='PATCH')return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        return send(200,scenarios.confirmService(confirmationRoute[1]!,confirmationRoute[2]!,confirmationRoute[3]!,await readJson(req,4096)))
      }
      const scenarioRoute = /^\/api\/atendimentos\/([^/]{1,100})\/cenarios(?:\/([^/]{1,100}))?$/.exec(url.pathname)
      if (scenarioRoute) {
        const at = scenarioRoute[1]!, id = scenarioRoute[2]
        const workspace = (selected?: string) => {
          const all = scenarios.list(at), selectedId = selectedScenario(options.atendimentos.db,at,all.some(s=>s.id===selected)?selected:undefined)
          const items = commercial.list(at,selectedId), parts = components.list(at), configured = pricing.get(), state = pricing.settings(at), catalog = commercial.catalogs().items
          return { scenarios: all, selectedId, items, revision: state.revision, components: parts, settings: state.settings, configurationRevision: configured.revision,
            calculations: all.map(s=>calculate(items,parts,catalog,s,configured.config,state.settings)) }
        }
        if (req.method === 'GET' && !id) return send(200,workspace(url.searchParams.get('scenarioId') ?? undefined))
        if ((req.method !== 'POST' || id) && (req.method !== 'PATCH' || !id) && (req.method !== 'DELETE' || !id)) return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if (req.headers.origin !== origin) return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415,'JSON_REQUIRED','Envie um corpo JSON.')
        const body = await readJson(req,64*1024)
        return send(req.method === 'POST' ? 201 : 200,req.method === 'POST' ? scenarios.create(at,body) : req.method === 'DELETE' ? scenarios.remove(at,id!,body) : scenarios.update(at,id!,body))
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
          if (diagnoses && !diagnoses[2]) return send(200, commercial.list(diagnoses[1]!,url.searchParams.get('scenarioId') ?? undefined))
          return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
        }
        const permitted = (catalogCollection && req.method === 'POST') || (catalogRecord && !catalogRecord[2] && req.method === 'PATCH') || (diagnoses && (!diagnoses[2] ? ['POST','DELETE'].includes(req.method??'') : ['PATCH','DELETE'].includes(req.method ?? '')))
        if (!permitted) return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
        if (req.headers.origin !== origin) return fail(403, 'ORIGIN_REJECTED', 'Origem da solicitação não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415, 'JSON_REQUIRED', 'Envie um corpo JSON.')
        const body = await readJson(req, 64 * 1024)
        if (catalogCollection) return send(201, commercial.saveCatalog(body))
        if (catalogRecord) return send(200, commercial.saveCatalog(body, catalogId))
        if (diagnoses) {
          if (!diagnoses[2]) return send(200,req.method==='DELETE'?commercial.removeMany(diagnoses[1]!,body):commercial.add(diagnoses[1]!, body))
          return send(200, req.method === 'DELETE' ? commercial.remove(diagnoses[1]!, diagnoses[2]!, body) : req.headers['x-funix-include-revision']==='1'?commercial.updateDiagnosis(diagnoses[1]!,diagnoses[2]!,body,true):commercial.updateDiagnosis(diagnoses[1]!,diagnoses[2]!,body))
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
