import {SharedConversationIdentity} from './chat/shared-identity.ts'
import {ContactChannels} from './chat/contact-channels.ts'
import { CustomerRepository } from './customers.ts'
import { funnelProjection } from './funnel.ts'
import { identifier as chatIdentifier } from './chat/events.ts'
import type { ConversationRuntime } from './chat/conversation-runtime.ts'
import { EvolutionReadError } from './experimental/evolution-read/client.ts'
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
import {ProductionRepository} from './production.ts'
import { WorkOrderRepository } from './work-orders.ts'
import {BudgetCancellationRepository} from './budget-cancellations.ts'
import {cancelledPdf} from './cancelled-pdf.ts'
import { workOrderPdf } from './work-order-pdf.ts'
import {configuredOrderRenderer,renderOrderJsreport} from './os-jsreport.ts'
import {WorkOrderPdfCache} from './os-pdf-cache.ts'
import { PricingConfigurationRepository } from './pricing-config.ts'
import { ComponentRepository } from './components.ts'
import { calculate } from './pricing-engine.ts'
import {pieceFinancialSummary} from './piece-financial-summary.ts'
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
import { createDevelopmentSourceIntake, type DevelopmentSourceIntakeConfig } from './chat/coda-source-endpoint-dev.ts'
import { createDevelopmentDecisionIntake, type DevelopmentDecisionIntakeConfig } from './chat/coda-decision-endpoint-dev.ts'
import { UpdatePackageRepository } from './update-packages.ts'
import { createUpdatePackageIngest } from './update-packages-ingest.ts'
import { hasUpdatePackageSchema } from './update-packages-schema.ts'
import { GmailIntakeRepository } from './gmail-intake.ts'
import type { GmailAnalysisService } from './gmail-analysis.ts'
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
  gmailAnalysis?: GmailAnalysisService
  conversationRuntime?: ConversationRuntime
  quotePilot?:QuoteService // explicit isolated harness injection only; no production factory
  evolutionChat?: EvolutionChatBridge // explicit opt-in injection; never auto-configured
  v20Associations?: V20AssociationRepository // independent opt-in: never read legacy chat_links
  whatsappIngest?: IngestOptions
  codaSync?: Omit<CodaSyncEndpointOptions, 'now'> // separately gated machine-to-machine intake
  sourceLedger?: Omit<DevelopmentSourceIntakeConfig, 'now'> // OFF by default; immutable source only
  decisionLedger?: Omit<DevelopmentDecisionIntakeConfig, 'now'> // same HMAC trust domain, separate signature prefix
  voiceProvider?:VoiceProvider|null
  voiceProcessingMs?:number // injectable timeout for deterministic local tests
  voiceContextMode?:'standard'|'omit_recommendations' // explicit synthetic QA override
  budgetRenderer?:BudgetOptions['render']
  cancelledPdfRenderer?:(pdf:Buffer)=>Promise<Buffer>
  osPdfRenderer?:(order:import('../shared/work-order.ts').WorkOrder)=>Promise<Buffer> // synthetic QA only
  atendimentos: AtendimentoRepository
  password?: string
  origin?: string
  revision?: string
  now?: () => number
  trustedLoginProxies?: ReadonlySet<string> // synthetic QA injection; production config is parsed strictly
}

export function createRequestHandler(options: AppOptions) {
  const contactChannels=options.evolutionChat?.contacts??new ContactChannels(options.atendimentos.db,{checkNumber:async()=>{throw Error('disabled')},findMessages:async()=>{throw Error('disabled')}},'disabled')
  const customerView=(id:string)=>{const r=contactChannels.customers.record(id);return r.kind==='entity'?contactChannels.entity(id):r.kind==='contact'?{...r,whatsapp:contactChannels.status(id)}:r}
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
  const production = new ProductionRepository(options.atendimentos.db,options.now)
  const workOrders = new WorkOrderRepository(options.atendimentos.db,options.now)
  // V21 revisions and new explicit issues freeze the first successfully rendered PDF.
  const osCache=new WorkOrderPdfCache(options.atendimentos.db)
  const cancellations = new BudgetCancellationRepository(options.atendimentos.db,options.now)
  const stampPdf=options.cancelledPdfRenderer??cancelledPdf
  const voiceContextMode=options.voiceContextMode??(process.env.FUNIX_VOICE_CONTEXT_MODE==='omit_recommendations'?'omit_recommendations':'standard')
  const voice=createVoiceEndpoint(options.atendimentos.db,options.voiceProvider===undefined?openAIVoiceProvider():options.voiceProvider??undefined,options.voiceProcessingMs,voiceContextMode)
  const now = options.now ?? Date.now
  const ingest = createIngestEndpoint(chat, options.whatsappIngest, now, options.conversationRuntime?.store, options.conversationRuntime?.providerIdentity)
  const codaIntake = options.codaSync && !options.conversationRuntime?.authority ? createCodaSyncEndpoint({ ...options.codaSync, now }) : null
  const sourceIntake = options.sourceLedger ? createDevelopmentSourceIntake({ ...options.sourceLedger, now }) : null
  const decisionIntake = options.decisionLedger ? createDevelopmentDecisionIntake({...options.decisionLedger,now}) : null
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
    const providerFailure = (cause: unknown, operation: 'list' | 'history') => {
      if(cause instanceof ServiceError)return fail(cause.status,cause.code,cause.message)
      const reason = cause instanceof EvolutionReadError ? cause.code : 'UNKNOWN'
      const providerStatus = cause instanceof EvolutionReadError ? cause.httpStatus : undefined
      console.warn(JSON.stringify({ event: 'chat_provider_failure', requestId, operation, reason, providerStatus }))
      if (reason === 'HTTP' && (providerStatus === 401 || providerStatus === 403))
        return fail(503, 'CHAT_PROVIDER_AUTH', 'A integração WhatsApp precisa de revisão de acesso. Informe o código de referência ao suporte.')
      if (reason === 'SCOPE' || reason === 'CONFLICT')
        return fail(503, 'CHAT_PROVIDER_SCOPE', 'O histórico foi bloqueado por inconsistência de identidade. Solicite revisão do vínculo.')
      if (reason === 'RESPONSE')
        return fail(503, 'CHAT_PROVIDER_RESPONSE', 'A Evolution retornou uma resposta incompatível. Informe o código de referência ao suporte.')
      if (reason === 'TIMEOUT')
        return fail(503, 'CHAT_PROVIDER_TIMEOUT', 'A Evolution demorou para responder. Tente atualizar o histórico.')
      return fail(503, 'CHAT_PROVIDER_UNAVAILABLE', 'Não foi possível consultar o WhatsApp agora. Tente novamente.')
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (!url.pathname.startsWith('/api/')) return fail(404, 'NOT_FOUND', 'Rota não encontrada.')
      if (url.pathname === '/api/integrations/whatsapp/events') return send(202, await ingest(req, res, url))
      if (url.pathname === '/api/integrations/whatsapp/confirmed-decision') {
        if (!decisionIntake) return fail(404,'NOT_FOUND','Rota não encontrada.')
        const result=await decisionIntake(req,res,url)
        return send(result.status,{state:result.state})
      }
      if (url.pathname === '/api/integrations/whatsapp/source-ledger') {
        if (!sourceIntake) return fail(404, 'NOT_FOUND', 'Rota não encontrada.')
        const result = await sourceIntake(req,res,url)
        return send(result.status, { state:result.state })
      }
      if (url.pathname === '/api/integrations/coda/atendimentos') {
        if (!codaIntake) return fail(404, 'NOT_FOUND', 'Rota não encontrada.')
        const result = await codaIntake(req, res, url)
        return send(result.status, { atendimentoId: result.atendimentoId, state: result.state })
      }
      if (url.pathname === '/api/integrations/updates/packages') {
        const result=await updatesIngest(req,res)
        return send(202,result)
      }
      const queueRoute=/^\/api\/integrations\/gmail\/queue\/(enqueue|claim|ack|status|overview)$/.exec(url.pathname)
      if(queueRoute){
        const result=await gmailQueueEndpoint(req,res,queueRoute[1] as 'enqueue'|'claim'|'ack'|'status'|'overview')
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
      if(url.pathname==='/api/atualizacoes/analises-gmail'){
        if(req.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        const ids=url.searchParams.has('ids')?(url.searchParams.get('ids')?url.searchParams.get('ids')!.split(','):[]):undefined
        if(ids&&(ids.length>100||ids.some(id=>!/^[0-9a-f-]{36}$/.test(id))))return fail(422,'GMAIL_ANALYSIS_INVALID','Identificadores inválidos.')
        return send(200,options.gmailAnalysis?{...options.gmailAnalysis.list(ids),scope:options.gmailAnalysis.scopeStatus()}:{enabled:false,items:[]})
      }
      const analysisRetry=/^\/api\/atualizacoes\/avisos-gmail\/([0-9a-f-]{36})\/analisar$/.exec(url.pathname)
      if(analysisRetry){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if(!options.gmailAnalysis)return fail(503,'GMAIL_ANALYSIS_DISABLED','Análise contextual ainda não configurada.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,4096)
        if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a solicitação.')
        const analysis=options.gmailAnalysis.retry(analysisRetry[1]!,body as {requestId:string,revision:number,snapshotHash:string},'funix_operator')
        options.gmailAnalysis.kick()
        return send(202,analysis)
      }
      // Intake authorization only permits analysis, never changes in the ERP or Drive.
      const intakeDecisionMatch=/^\/api\/atualizacoes\/avisos-gmail\/([0-9a-f-]{36})\/decisao$/.exec(url.pathname)
      if(url.pathname==='/api/atualizacoes/avisos-gmail' || intakeDecisionMatch){
        if(req.method==='GET' && !intakeDecisionMatch){
          if([...url.searchParams.keys()].some(k=>!['visao','q'].includes(k)))return fail(400,'GMAIL_INTAKE_QUERY_INVALID','Filtro inválido.')
          const view=url.searchParams.get('visao')??'open'
          const query=url.searchParams.get('q')??''
          if(!['open','closed','all'].includes(view)||query.length>160)return fail(400,'GMAIL_INTAKE_QUERY_INVALID','Filtro inválido.')
          const available=process.env.FUNIX_GMAIL_INTAKE_STORAGE_ENABLED==='true' &&
            hasGmailIntakeSchema(options.atendimentos.db)
          return send(200,{...(options.gmailAnalysis?options.gmailAnalysis.listNotices(view as 'open'|'closed'|'all',query):gmailIntake.list(view as 'open'|'closed'|'all',query)),
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
        const decided=gmailIntake.decide(intakeDecisionMatch[1]!,body as GmailIntakeDecisionInput,'funix_operator')
        if(decided.status==='authorized'&&options.gmailAnalysis?.isEligible(decided.id)){options.gmailAnalysis.schedule(decided.id);options.gmailAnalysis.kick()}
        return send(200,decided)
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
          if (!['open','closed','all'].includes(visao) || query.length>160) return fail(400,'PACKAGE_QUERY_INVALID','Filtro inválido.')
          const available=hasUpdatePackageSchema(options.atendimentos.db)&&process.env.FUNIX_UPDATES_STORAGE_ENABLED==='true'
          return send(200,{...updates.list(visao as 'open'|'closed'|'all',query,Boolean(options.gmailAnalysis)),
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
        if (clarificationMatch) {
          const pkg=updates.submitClarification(clarificationMatch[1]!,body as UpdatePackageClarification,'funix_operator')
          if(options.gmailAnalysis?.revise(pkg.id))options.gmailAnalysis.kick()
          return send(202,pkg)
        }
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
      const prepareConversationRoute=/^\/api\/atendimentos\/([a-f0-9-]{36})\/prepare-conversation$/.exec(url.pathname)
      if(prepareConversationRoute&&options.conversationRuntime?.authority){
        if(req.method!=='POST'||url.search)return fail(400,'CHAT_INVALID_QUERY','Solicitação inválida.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,1024)
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['contactIndex','revision'].includes(k)))return fail(400,'INVALID_REFERENCE','Contato inválido.')
        const input=body as {contactIndex?:unknown;revision?:unknown}
        if(typeof input.contactIndex!=='number'||typeof input.revision!=='number')return fail(400,'INVALID_REFERENCE','Contato inválido.')
        return send(200,options.conversationRuntime.authority.prepareConversation(prepareConversationRoute[1]!,input.contactIndex,input.revision))
      }
      const localConversationsRoute=/^\/api\/atendimentos\/([a-f0-9-]{36})\/conversations$/.exec(url.pathname)
      if(localConversationsRoute&&(options.conversationRuntime?.authority||options.codaSync&&options.evolutionChat)){
        if(req.method!=='GET'||url.search)return fail(400,'CHAT_INVALID_QUERY','Solicitação inválida.')
        options.atendimentos.get(localConversationsRoute[1]!)
        const items=options.conversationRuntime?.authority?.conversationsForAtendimento(localConversationsRoute[1]!)??[]
        if(items.length||options.conversationRuntime?.authority)return send(200,{items})
        const existing=options.evolutionChat?.conversationForAtendimento(localConversationsRoute[1]!)
        return send(200,{items:existing?[{...existing,phone:null}]:[]})
      }
      const photoRoute=/^\/api\/chat\/conversations\/([a-f0-9-]{36})\/profile-photo$/.exec(url.pathname)
      if(photoRoute&&options.evolutionChat){
        if(req.method!=='GET'||url.search)return fail(400,'CHAT_INVALID_QUERY','Solicitação inválida.')
        const photo=await options.evolutionChat.profilePhoto(photoRoute[1]!)
        if(!photo)return fail(404,'PHOTO_UNAVAILABLE','Foto indisponível.')
        res.writeHead(200,{'Content-Type':photo.mime,'Content-Length':photo.bytes.length,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(photo.bytes);return
      }
      const contactMediaRoute=/^\/api\/customer-records\/([a-f0-9-]{36})\/chat\/([a-f0-9-]{36})\/messages\/([A-Za-z0-9_:-]{1,200})\/media$/.exec(url.pathname)
      if(contactMediaRoute){
        if(req.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED','Use GET.')
        if(process.env.FUNIX_EVOLUTION_MEDIA_ENABLED!=='true')return fail(503,'CHAT_MEDIA_DISABLED','Mídias não habilitadas.')
        const page=url.searchParams.get('page')??'1'
        if([...url.searchParams.keys()].some(k=>k!=='page')||url.searchParams.getAll('page').length>1||!/^[1-9][0-9]{0,3}$/.test(page)||Number(page)>1000)return fail(400,'CHAT_INVALID_QUERY','Página inválida.')
        try{const result=await contactChannels.readMedia(contactMediaRoute[1]!,contactMediaRoute[2]!,contactMediaRoute[3]!,Number(page))
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada.')
          return send(200,result)
        }catch(e){if(e instanceof ServiceError)throw e;return fail(503,'CHAT_MEDIA_UNAVAILABLE','Não foi possível recuperar a mídia.')}
      }
      const contactChannelRoute=/^\/api\/customer-records\/([a-f0-9-]{36})\/(verify-whatsapp|open-chat|chat)(?:\/([a-f0-9-]{36})\/(messages|send-text|send-media|message-states))?$/.exec(url.pathname)
      if(contactChannelRoute){
        const [,contactId,action,conversationId,operation]=contactChannelRoute
        if(req.method==='GET'&&action==='chat'&&conversationId&&operation==='messages'){
          if([...url.searchParams.keys()].some(k=>!['page','cursor'].includes(k))||url.searchParams.getAll('page').length>1||url.searchParams.getAll('cursor').length>1)return fail(400,'CHAT_INVALID_QUERY','Parâmetros inválidos.')
          const cursor=url.searchParams.get('cursor')??undefined
          if(cursor&&!/^[A-Za-z0-9_-]{1,900}$/.test(cursor))return fail(400,'CHAT_INVALID_QUERY','Cursor inválido.')
          const page=url.searchParams.get('page')??'1'
          if(!/^[1-9][0-9]{0,3}$/.test(page)||Number(page)>1000)return fail(400,'CHAT_INVALID_QUERY','Página inválida.')
          try{const result=await contactChannels.messages(contactId!,conversationId,Number(page),cursor)
            if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada.')
            return send(200,result)
          }catch(e){if(e instanceof ServiceError)throw e;return providerFailure(e,'history')}
        }
        if(req.method!=='POST'||url.search)return fail(405,'METHOD_NOT_ALLOWED','Use POST.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,operation==='send-media'?17*1024*1024:operation==='message-states'?32768:8192)
        if(!body||typeof body!=='object'||Array.isArray(body))return fail(400,'INVALID_CONTACT','Dados inválidos.')
        const input=body as Record<string,unknown>
        if(action==='chat'&&operation==='message-states'&&conversationId){
          if(Object.keys(input).length!==1||!Array.isArray(input.messages)||input.messages.length<1||input.messages.length>50||input.messages.some(m=>!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['messageId','version'].includes(k))||!chatIdentifier(m.messageId,200)||m.version!==undefined&&(typeof m.version!=='string'||!/^[a-f0-9]{64}$/.test(m.version))))return fail(400,'CHAT_INVALID_QUERY','Mensagens inválidas.')
          return send(200,contactChannels.states(contactId!,conversationId,input.messages))
        }
        if(action==='verify-whatsapp'&&!conversationId&&Object.keys(input).length===0){const result=await contactChannels.verify(contactId!);if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada.');return send(200,result)}
        if(action==='open-chat'&&!conversationId&&Object.keys(input).length===0){
          await contactChannels.verify(contactId!)
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada.')
          return send(200,{
            conversationId:contactChannels.context(contactId!).conversationId,
            linksEnabled:!!options.v20Associations&&(!options.conversationRuntime||!!options.conversationRuntime.authority),
          })
        }
        if(action==='chat'&&operation==='send-text'&&conversationId){
          if(process.env.FUNIX_EVOLUTION_SEND_ENABLED!=='true')return fail(503,'CHAT_SEND_DISABLED','Envio WhatsApp não habilitado.')
          if(Object.keys(input).some(k=>!['text','requestId','contextToken','confirmed'].includes(k))||input.confirmed!==true||typeof input.text!=='string'||typeof input.requestId!=='string'||typeof input.contextToken!=='string')return fail(400,'CHAT_SEND_INVALID','Confirme explicitamente a mensagem e o destinatário.')
          try{const receipt=await contactChannels.send(contactId!,conversationId,input.text,{requestId:input.requestId,contextToken:input.contextToken},()=>{if((sessions.get(cookie)??0)<=now())throw new ServiceError(401,'AUTH_REQUIRED','Sessão encerrada.')})
            return send(200,{state:'accepted',messageId:receipt.messageId})
          }catch(e){if(e instanceof ServiceError)throw e;return fail(502,'CHAT_SEND_UNCERTAIN','Envio não confirmado. Confira o WhatsApp antes de tentar novamente.')}
        }
        if(action==='chat'&&operation==='send-media'&&conversationId){
          if(process.env.FUNIX_EVOLUTION_MEDIA_ENABLED!=='true')return fail(503,'CHAT_MEDIA_DISABLED','Mídias não habilitadas.')
          if(Object.keys(input).some(k=>!['kind','mimeType','base64','caption','requestId','contextToken','confirmed'].includes(k))||input.confirmed!==true||typeof input.requestId!=='string'||typeof input.contextToken!=='string'||typeof input.kind!=='string'||!['image','video','audio'].includes(input.kind)||typeof input.mimeType!=='string'||typeof input.base64!=='string'||input.caption!==undefined&&typeof input.caption!=='string')return fail(400,'CHAT_MEDIA_INVALID','Confirme a mídia e o destinatário.')
          const item={kind:input.kind as MediaKind,mimeType:input.mimeType,base64:input.base64,...(typeof input.caption==='string'?{caption:input.caption}:{})}
          try{const receipt=await contactChannels.sendMedia(contactId!,conversationId,item,{requestId:input.requestId,contextToken:input.contextToken},()=>{if((sessions.get(cookie)??0)<=now())throw new ServiceError(401,'AUTH_REQUIRED','Sessão encerrada.')})
            return send(200,{state:'accepted',messageId:receipt.messageId})
          }catch(e){if(e instanceof ServiceError)throw e;return fail(502,'CHAT_SEND_UNCERTAIN','Envio não confirmado. Confira a conversa antes de repetir.')}
        }
        return fail(400,'INVALID_CONTACT','Operação inválida.')
      }
      const customerRoute=/^\/api\/customer-records(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname)
      if(customerRoute){
        const customers=new CustomerRepository(options.atendimentos.db),id=customerRoute[1]
        if(req.method==='GET')return send(200,id?customerView(id):{items:customers.search(url.searchParams.get('kind')??'',url.searchParams.get('q')??'')})
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        if(req.method==='POST'&&!id || req.method==='PATCH'&&id){
          const saved=customers.save(await readJson(req,32768),id)
          if(saved.kind==='entity')await contactChannels.verifyEntity(saved.id)
          else if(saved.kind==='contact')await contactChannels.verify(saved.id)
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Cadastro salvo; a sessão encerrou durante a verificação. Entre novamente para consultá-lo.')
          return send(id?200:201,customerView(saved.id))
        }
        return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
      }
      // V20 N:N associations: opt-in, single authenticated operator and explicit Origin on writes.
      // These operations NEVER contact Evolution or change legacy chat/messages.
      if ((!options.conversationRuntime || options.conversationRuntime.authority) && options.evolutionChat && options.v20Associations && url.pathname.startsWith('/api/chat/conversations/')) {
        const associationRoute = /^\/api\/chat\/conversations\/([a-f0-9-]{36})\/(atendimentos)(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname)
        const contextRoute = /^\/api\/chat\/conversations\/([a-f0-9-]{36})\/context$/.exec(url.pathname)
        const identityRoute = /^\/api\/chat\/conversations\/([a-f0-9-]{36})\/identity$/.exec(url.pathname)
        if (associationRoute || contextRoute || identityRoute) {
          const conversationId = (associationRoute?.[1] ?? contextRoute?.[1] ?? identityRoute?.[1])!
          const authority=options.conversationRuntime?.authority
          const contacts=options.evolutionChat.contacts
          const scope=identityRoute?undefined:(authority?.associationScope(conversationId) ??
            (contacts?.identities.providerJid(conversationId)?contacts.identities.associationScope(conversationId):undefined))
          if (!options.v20Associations.resolveRemoteJid(conversationId, 'funix_comercial')) return fail(404, 'CHAT_NOT_FOUND', 'Conversa não encontrada.')
          if ([...url.searchParams.keys()].length) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
          const identity=identityRoute?new SharedConversationIdentity(options.atendimentos.db,options.evolutionChat.observedConversation):undefined
          if(identity&&req.method==='GET')return send(200,identity.preview(conversationId))
          if (associationRoute && req.method === 'GET' && !associationRoute[3])
            return send(200, options.v20Associations.listActive(conversationId,scope))
          if (req.headers.origin !== origin) return fail(403, 'ORIGIN_REJECTED', 'Origem não autorizada.')
          if (!req.headers['content-type']?.startsWith('application/json')) return fail(415, 'JSON_REQUIRED', 'Envie JSON.')
          const body = await readJson(req, 2048)
          if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'CHAT_INVALID_BODY', 'Corpo inválido.')
          const input = body as Record<string, unknown>
          if(identity&&req.method==='POST')return send(200,identity.confirm(conversationId,input))
          if (associationRoute && req.method === 'POST' && !associationRoute[3]) {
            if (Object.keys(input).some(key => !['atendimentoId','expectedRevision','requestId','reason'].includes(key)))
              return fail(400, 'CHAT_INVALID_BODY', 'Campos inválidos.')
            return send(201, options.v20Associations.link({
              conversationId, atendimentoId: input.atendimentoId as string, expectedRevision: input.expectedRevision as number,
              requestId: input.requestId as string, reason: input.reason as string,
            },scope))
          }
          if (associationRoute && req.method === 'DELETE' && associationRoute[3]) {
            if (Object.keys(input).some(key => !['expectedRevision','requestId','reason'].includes(key)))
              return fail(400, 'CHAT_INVALID_BODY', 'Campos inválidos.')
            return send(200, options.v20Associations.unlink({
              conversationId, linkId: associationRoute[3], expectedRevision: input.expectedRevision as number,
              requestId: input.requestId as string, reason: input.reason as string,
            },scope))
          }
          if (contextRoute && req.method === 'POST') {
            if (Object.keys(input).some(key => key !== 'linkId'))
              return fail(400, 'CHAT_INVALID_BODY', 'Campos inválidos.')
            if (!Object.hasOwn(input, 'linkId') || (input.linkId !== null && typeof input.linkId !== 'string'))
              return fail(400, 'CHAT_INVALID_BODY', 'Contexto inválido.')
            return send(200, { activeAtendimentoId: options.v20Associations.selectAtendimento(conversationId, input.linkId as string | null,scope) })
          }
          return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
        }
      }
      // Resolve the current canonical Atendimento after a stale conversation list.
      // The opaque ID is registered by Evolution; no browser-supplied JID or phone.
      const statesRoute=/^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversations\/([a-f0-9-]{36})\/message-states$/.exec(url.pathname)
      if(statesRoute&&options.evolutionChat&&options.conversationRuntime?.read){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        if(url.search)return fail(400,'CHAT_INVALID_QUERY','Parâmetros inválidos.')
        const body=await readJson(req,32*1024) as {messages?:unknown}
        if(!body||Object.keys(body).length!==1||!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>50||body.messages.some(item=>!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['messageId','version'].includes(key))||!chatIdentifier(item.messageId,200)||(item.version!==undefined&&(typeof item.version!=='string'||!/^[a-f0-9]{64}$/.test(item.version))))||new Set(body.messages.map(item=>item.messageId)).size!==body.messages.length)return fail(400,'CHAT_INVALID_QUERY','Mensagens inválidas.')
        try{const result=await options.evolutionChat.messageStates(statesRoute[1]!,statesRoute[2]!,body.messages)
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada.')
          return result?send(200,result):fail(404,'CHAT_NOT_LINKED','Conversa não vinculada.')
        }catch(cause){return providerFailure(cause,'history')}
      }
      const recoveryRoute=/^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversations\/([a-f0-9-]{36})\/sync-history$/.exec(url.pathname)
      if(recoveryRoute&&options.evolutionChat&&options.conversationRuntime){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        if(url.search)return fail(400,'CHAT_INVALID_QUERY','Parâmetros inválidos.')
        const body=await readJson(req,1024) as {page?:unknown}
        if(!body||Object.keys(body).length!==1||!Number.isInteger(body.page)||Number(body.page)<1||Number(body.page)>1000)return fail(400,'CHAT_INVALID_QUERY','Página inválida.')
        try{const result=await options.evolutionChat.recoverHistory(recoveryRoute[1]!,recoveryRoute[2]!,Number(body.page))
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada.')
          return result?send(200,result):fail(404,'CHAT_NOT_LINKED','Conversa não vinculada.')
        }catch(cause){return providerFailure(cause,'history')}
      }
      const activeContextRoute = /^\/api\/chat\/conversations\/([a-f0-9-]{36})\/active-atendimento$/.exec(url.pathname)
      if (activeContextRoute && options.evolutionChat && (options.codaSync || options.conversationRuntime?.authority)) {
        if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.')
        if (url.search) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        const atendimentoId = options.evolutionChat.activeAtendimentoForConversation(activeContextRoute[1]!)
        return send(200, { atendimentoId, ...(options.conversationRuntime?{state:options.evolutionChat.conversationState(activeContextRoute[1]!)}:{}) })
      }
      // Resolve the unique active Coda-linked conversation for direct Funil navigation.
      // Returns opaque IDs only; the caller must already hold a valid FUNIX session.
      const canonicalConversationRoute = /^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversation$/.exec(url.pathname)
      if (canonicalConversationRoute && options.evolutionChat && (options.codaSync || options.conversationRuntime?.authority)) {
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
        if (!options.evolutionChat || !(options.codaSync || options.conversationRuntime?.authority) || process.env.FUNIX_EVOLUTION_SEND_ENABLED !== 'true')
          return fail(503, 'CHAT_SEND_DISABLED', 'O envio WhatsApp não está habilitado.')
        if (req.headers.origin !== origin) return fail(403, 'ORIGIN_REJECTED', 'Origem não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415, 'JSON_REQUIRED', 'Envie JSON.')
        if (url.search) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        const data = await readJson(req, 8192)
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            Object.keys(data).some(key=>!['text','requestId','contextToken'].includes(key)) || typeof (data as Record<string, unknown>).text !== 'string')
          return fail(400, 'CHAT_SEND_INVALID', 'Envie somente o texto da mensagem.')
        const command=data as {text:string;requestId?:string;contextToken?:string}
        if(options.conversationRuntime&&(typeof command.requestId!=='string'||typeof command.contextToken!=='string'))return fail(400,'CHAT_SEND_COMMAND_REQUIRED','Atualize a conversa antes de enviar.')
        const text = command.text
        if (!text.trim() || [...text].length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
          return fail(400, 'CHAT_SEND_INVALID', 'Mensagem vazia, inválida ou muito longa.')
        try {
          const result = await options.evolutionChat.sendTextForAtendimento(sendEvolutionRoute[1]!, sendEvolutionRoute[2]!, text, command.requestId&&command.contextToken?{requestId:command.requestId,contextToken:command.contextToken}:undefined)
          if ((sessions.get(cookie) ?? 0) <= now()) return fail(401, 'AUTH_REQUIRED', 'Sessão encerrada durante o envio. Confira o WhatsApp antes de reenviar.')
          if (result.state === 'unlinked') return fail(404, 'CHAT_NOT_LINKED', 'Conversa não vinculada ao Atendimento.')
          if (result.state === 'busy') return fail(409, 'CHAT_SEND_IN_PROGRESS', 'Há um envio em andamento nesta conversa.')
          if (result.state !== 'accepted') return fail(400, 'CHAT_SEND_INVALID', 'Mensagem inválida ou envio desativado.')
          return send(200, { state: 'accepted', messageId: result.receipt.messageId })
        } catch (cause) {
          if(cause instanceof ServiceError)return fail(cause.status,cause.code,cause.message)
          return fail(502, 'CHAT_SEND_UNCERTAIN', 'Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente.')
        }
      }
      // WhatsApp media: authenticated operator, canonical Coda JID, no public URLs.
      const mediaSendRoute=/^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversations\/([a-f0-9-]{36})\/send-media$/.exec(url.pathname)
      if(mediaSendRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Use POST.')
        if(!options.evolutionChat||!(options.codaSync || options.conversationRuntime?.authority)||process.env.FUNIX_EVOLUTION_MEDIA_ENABLED!=='true')
          return fail(503,'CHAT_MEDIA_DISABLED','Mídias não habilitadas.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        if(url.search)return fail(400,'CHAT_INVALID_QUERY','Parâmetros inválidos.')
        const raw=await readJson(req,17*1024*1024)
        if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail(400,'CHAT_MEDIA_INVALID','Mídia inválida.')
        const data=raw as Record<string,unknown>,keys=Object.keys(data)
        if(keys.some(key=>!['kind','mimeType','base64','caption','requestId','contextToken'].includes(key))||
          typeof data.kind!=='string'||!['image','video','audio'].includes(data.kind)||
          typeof data.mimeType!=='string'||typeof data.base64!=='string'||
          (data.caption!==undefined&&typeof data.caption!=='string'))return fail(400,'CHAT_MEDIA_INVALID','Mídia inválida.')
        if(options.conversationRuntime&&(typeof data.requestId!=='string'||typeof data.contextToken!=='string'))return fail(400,'CHAT_SEND_COMMAND_REQUIRED','Atualize a conversa antes de enviar.')
        const item={kind:data.kind as MediaKind,mimeType:data.mimeType,base64:data.base64,
          ...(typeof data.caption==='string'?{caption:data.caption}:{})} as MediaInput
        try{validateMedia(item.kind,item.mimeType,item.base64)}
        catch{return fail(400,'CHAT_MEDIA_INVALID','Formato ou tamanho de mídia não suportado.')}
        try{
          const result=await options.evolutionChat.sendMediaForAtendimento(mediaSendRoute[1]!,mediaSendRoute[2]!,item,typeof data.requestId==='string'&&typeof data.contextToken==='string'?{requestId:data.requestId,contextToken:data.contextToken}:undefined)
          if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada; confira o WhatsApp antes de reenviar.')
          if(result.state==='unlinked')return fail(404,'CHAT_NOT_LINKED','Conversa não vinculada ao Atendimento.')
          if(result.state==='busy')return fail(409,'CHAT_SEND_IN_PROGRESS','Outro envio está em andamento.')
          if(result.state!=='accepted')return fail(400,'CHAT_MEDIA_INVALID','Mídia inválida.')
          return send(200,{state:'accepted',messageId:result.receipt.messageId})
        }catch(cause){if(cause instanceof ServiceError)return fail(cause.status,cause.code,cause.message);return fail(502,'CHAT_MEDIA_SEND_UNCERTAIN','Envio não confirmado. Confira o WhatsApp antes de tentar outra vez.')}
      }
      const mediaReadRoute=/^\/api\/atendimentos\/([a-f0-9-]{36})\/evolution-conversations\/([a-f0-9-]{36})\/messages\/([A-Za-z0-9_:-]{1,200})\/media$/.exec(url.pathname)
      if(mediaReadRoute){
        if(req.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED','Use GET.')
        if(!options.evolutionChat||!(options.codaSync || options.conversationRuntime?.authority)||process.env.FUNIX_EVOLUTION_MEDIA_ENABLED!=='true')
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
      if (syncedEvolutionRoute && options.evolutionChat && (options.codaSync || options.conversationRuntime?.authority || (!options.conversationRuntime && options.v20Associations && options.evolutionChat.contacts))) {
        if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'O Chat está disponível somente para leitura.')
        if ([...url.searchParams.keys()].some(key => !['page','cursor','scope'].includes(key)) || url.searchParams.getAll('page').length > 1 || url.searchParams.getAll('cursor').length>1 || url.searchParams.getAll('scope').length>1)
          return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        const scope=url.searchParams.get('scope')
        if(scope!==null&&scope!=='linked')return fail(400,'CHAT_INVALID_QUERY','Parâmetros inválidos.')
        const cursor=url.searchParams.get('cursor')??undefined
        if(cursor&&(!options.conversationRuntime?.read||! /^[A-Za-z0-9_-]{1,900}$/.test(cursor)))return fail(400,'CHAT_INVALID_QUERY','Cursor inválido.')
        const page = url.searchParams.get('page') ?? '1'
        if (!/^[1-9][0-9]{0,3}$/.test(page) || Number(page) > 1000)
          return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        try {
          if(scope==='linked'){
            const runtime=options.conversationRuntime
            const conversationId=syncedEvolutionRoute[2]!
            const jid=runtime?.authority?.linkedHistoryJid(syncedEvolutionRoute[1]!,conversationId)
            if(!runtime?.read||!jid)return fail(404,'CHAT_NOT_LINKED','Conversa não vinculada a este Atendimento.')
            return send(200,{conversationId,...runtime.store.page(jid,Number(page),cursor)})
          }
          const result = await options.evolutionChat.messagesForAtendimento(syncedEvolutionRoute[1]!, syncedEvolutionRoute[2]!, Number(page),cursor)
          if ((sessions.get(cookie) ?? 0) <= now()) return fail(401, 'AUTH_REQUIRED', 'Sessão encerrada durante a consulta.')
          return result ? send(200, result) : fail(404, 'CHAT_NOT_LINKED', 'Conversa não vinculada a este Atendimento.')
        } catch (cause) { if(cause instanceof ServiceError)return fail(cause.status,cause.code,cause.message);return providerFailure(cause, 'history') }
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
            return send(200, options.v20Associations && (!options.conversationRuntime || options.conversationRuntime.authority) ? { ...result, linksEnabled: true } : result)
          } catch (cause) { return providerFailure(cause, 'list') }
        }
        if (keys.some(k => k !== 'page') || url.searchParams.getAll('page').length > 1) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        const page = url.searchParams.get('page') ?? '1'
        if (!/^[1-9][0-9]{0,3}$/.test(page) || Number(page) > 1000) return fail(400, 'CHAT_INVALID_QUERY', 'Parâmetros inválidos.')
        try {
          const result = await options.evolutionChat.messages(messagesRoute![1]!, Number(page))
          if ((sessions.get(cookie) ?? 0) <= now()) return fail(401, 'AUTH_REQUIRED', 'Sessão encerrada durante a consulta.')
          return result ? send(200, result) : fail(404, 'CHAT_NOT_FOUND', 'Conversa não encontrada.')
        } catch (cause) { if(cause instanceof ServiceError)return fail(cause.status,cause.code,cause.message);return providerFailure(cause, 'history') }
      }
      const chatReadRoute = /^\/api\/atendimentos\/([^/]+)\/messages$/.exec(url.pathname)
      if (chatReadRoute) {
        if(options.conversationRuntime)return fail(410,'CHAT_LEGACY_DISABLED','Abra o Chat pela conversa confirmada.')
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
      const experienceRoute=/^\/api\/atendimentos\/([^/]{1,100})\/experiencia$/.exec(url.pathname)
      const scheduleRoute=/^\/api\/atendimentos\/([^/]{1,100})\/agendamento$/.exec(url.pathname)
      const productionBudgetRoute=/^\/api\/atendimentos\/([^/]{1,100})\/orcamentos\/([^/]{1,100})\/(autorizacao-tecnica|rejeicao-tecnica|rejeicao-comercial)$/.exec(url.pathname)
      if(experienceRoute || scheduleRoute || productionBudgetRoute){
        if(url.search)return fail(400,'INVALID_QUERY','Parâmetros não permitidos.')
        if(experienceRoute){
          if(req.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
          return send(200,production.get(experienceRoute[1]!))
        }
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,scheduleRoute?16384:2048)
        if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a confirmação.')
        if(scheduleRoute)return send(200,production.schedule(scheduleRoute[1]!,body))
        const [,at,versionId,action]=productionBudgetRoute!
        if(action==='autorizacao-tecnica')return send(200,production.authorize(at!,versionId!,body))
        return send(200,production.reject(at!,versionId!,action==='rejeicao-comercial'?'commercial':'technical',body))
      }
      if (url.pathname === '/api/workspace' || url.pathname.startsWith('/api/experiencias')) {
        return fail(req.method === 'GET' ? 410 : 405, 'FEATURE_UNAVAILABLE', 'Esta função operacional não pertence ao MVP Comercial. Nenhum acesso ao Coda foi realizado.')
      }
      if(url.pathname==='/api/recomendacoes'){
        if(req.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED','Consulta somente leitura.')
        if([...url.searchParams.keys()].some(k=>!['diagnosisId','intensity'].includes(k))||url.searchParams.getAll('diagnosisId').length!==1||url.searchParams.getAll('intensity').length!==1)return fail(400,'INVALID_INPUT','Informe apenas diagnosisId e intensity.')
        return send(200,{items:recommendations(options.atendimentos.db,url.searchParams.get('diagnosisId'),url.searchParams.get('intensity'))})
      }
      // Operational OS: frozen emitted version and immutable SQLite record.
      // PDF uses the configured jsreport OS template or the existing local fallback.
      const cancellationRoute = /^\/api\/atendimentos\/([^/]{1,100})\/orcamentos\/([^/]{1,100})\/cancelamento$/.exec(url.pathname)
      if(cancellationRoute){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if(url.search)return fail(400,'INVALID_QUERY','Parâmetros não permitidos.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie JSON.')
        const body=await readJson(req,2048)
        if((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante o cancelamento.')
        return send(200,cancellations.cancel(cancellationRoute[1]!,cancellationRoute[2]!,body))
      }
      const orderRoute = /^\/api\/atendimentos\/([^/]{1,100})\/orcamentos\/([^/]{1,100})\/os(?:\/(revisoes)(?:\/([1-9][0-9]{0,8}))?)?(\/pdf)?$/.exec(url.pathname)
      if (orderRoute) {
        const at=orderRoute[1]!,versionId=orderRoute[2]!,revisions=orderRoute[3],revision=orderRoute[4],pdf=orderRoute[5]
        if (req.method==='GET') {
          if (url.search) return fail(400,'INVALID_QUERY','Parâmetros não permitidos.')
          if(revisions&&!revision){
            if(pdf)return fail(404,'NOT_FOUND','Informe a revisão da OS.')
            return send(200,workOrders.listRevisions(at,versionId))
          }
          const order=workOrders.get(at,versionId,revision?Number(revision):1)
          if (!pdf) return send(200,order)
          const useJsreportOrderPdf=Boolean(options.osPdfRenderer)||process.env.FUNIX_OS_JSREPORT_ENABLED==='true'
          let original:Buffer
          // Keep the old fallback behavior only for legacy records without an explicit delivery field.
          const frozenPdf=order.scope.deliveryDate!==undefined||!!order.revisionId
          if(!useJsreportOrderPdf&&!frozenPdf) original=workOrderPdf(order)
          else {
            const cached=osCache.get(order.id,order.revisionId)
            if(cached)original=cached
            else{
              const renderer=options.osPdfRenderer??((item:typeof order)=>renderOrderJsreport(item,configuredOrderRenderer()))
              const rendered=useJsreportOrderPdf?await renderer(order):workOrderPdf(order)
              original=osCache.save(order.id,rendered,order.revisionId)
            }
          }
          const data=order.cancellation?await stampPdf(original):original
          res.setHeader('Content-Type','application/pdf')
          res.setHeader('Content-Disposition','inline; filename="FUNIX-'+order.number+(order.revision&&order.revision>1?'-R'+String(order.revision).padStart(2,'0'):'')+'.pdf"')
          res.setHeader('Content-Length',data.length)
          res.writeHead(200);res.end(data);return
        }
        if (req.method!=='POST'||pdf||revision) return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if (url.search) return fail(400,'INVALID_QUERY','Parâmetros não permitidos.')
        if (req.headers.origin!==origin) return fail(403,'ORIGIN_REJECTED','Origem não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415,'JSON_REQUIRED','Envie JSON.')
        if(!revisions)return fail(409,'DIRECT_OS_DISABLED','A criação da OS ocorre pela autorização técnica na Experiência do Atendimento.')
        const body=await readJson(req,1024)
        if ((sessions.get(cookie)??0)<=now())return fail(401,'AUTH_REQUIRED','Sessão encerrada durante a confirmação.')
        return send(201,workOrders.reissue(at,versionId,body))
      }
      const budgetRoute = /^\/api\/atendimentos\/([^/]{1,100})\/orcamentos(?:\/([^/]{1,100}))?(\/pdf)?$/.exec(url.pathname)
      if (budgetRoute) {
        const at = budgetRoute[1]!, id = budgetRoute[2], pdf = budgetRoute[3]
        if (req.method === 'GET') {
          if (!id) return send(200,budgets.list(at))
          if (pdf) {
            const version = budgets.get(at,id), original=budgets.pdf(at,id)
            const data=version.cancellation?await stampPdf(original):original
            res.setHeader('Content-Type','application/pdf')
            res.setHeader('Content-Disposition',`${url.searchParams.get('view')==='1'?'inline':'attachment'}; filename="FUNIX-orcamento-${version.documentNumber?.replace(/[^A-Za-z0-9-]/g,'')??version.label}.pdf"; filename*=UTF-8''${encodeURIComponent(version.filename??`FUNIX-orcamento-${version.label}.pdf`)}`)
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
          const calculations=all.map(s=>calculate(items,parts,catalog,s,configured.config,state.settings))
          return { scenarios: all, selectedId, items, revision: state.revision, components: parts, settings: state.settings, configurationRevision: configured.revision,
            calculations, pieceCategoryTotals:Object.fromEntries(calculations.map(c=>[c.scenarioId,pieceFinancialSummary(c,items.map(item=>item.id))])) }
        }
        if (req.method === 'GET' && !id) return send(200,workspace(url.searchParams.get('scenarioId') ?? undefined))
        if ((req.method !== 'POST' || id) && (req.method !== 'PATCH' || !id) && (req.method !== 'DELETE' || !id)) return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if (req.headers.origin !== origin) return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415,'JSON_REQUIRED','Envie um corpo JSON.')
        const body = await readJson(req,64*1024)
        return send(req.method === 'POST' ? 201 : 200,req.method === 'POST' ? scenarios.create(at,body) : req.method === 'DELETE' ? scenarios.remove(at,id!,body) : scenarios.update(at,id!,body))
      }
      // #168: dedicated authenticated mutation; never re-create or merge a diagnosis.
      const replacement = /^\/api\/atendimentos\/([^/]{1,100})\/diagnosticos\/([^/]{1,100})\/trocar-peca$/.exec(url.pathname)
      if(replacement){
        if(req.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
        if(req.headers.origin!==origin)return fail(403,'ORIGIN_REJECTED','Origem da solicitação não autorizada.')
        if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON_REQUIRED','Envie um objeto JSON.')
        const body=await readJson(req,64*1024)
        return send(200,commercial.replacePiece(replacement[1]!,replacement[2]!,body))
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
        const result=options.atendimentos.list({ q, limit: Number(limit), offset: Number(offset) })
        return send(200,{...result,items:funnelProjection(options.atendimentos.db,new CustomerRepository(options.atendimentos.db).present(result.items))})
      }
      const withChatIdentity=(atendimento:ReturnType<AtendimentoRepository['get']>)=>{
        const cid=url.searchParams.get('conversa')
        if(cid&&/^[a-f0-9-]{36}$/.test(cid)&&options.evolutionChat&&options.v20Associations&&
          options.v20Associations.resolveRemoteJid(cid,'funix_comercial')){
          const identity=new SharedConversationIdentity(options.atendimentos.db,options.evolutionChat.observedConversation)
          const chatIdentity=identity.forAtendimento(cid,atendimento.id)
          if(chatIdentity)atendimento.chatIdentity=chatIdentity
        }
        return atendimento
      }
      if (record && req.method === 'GET') return send(200,withChatIdentity(options.atendimentos.get(record[1]!,true)))
      if ((collection && req.method === 'POST') || (record && req.method === 'PATCH')) {
        if (req.headers.origin !== origin) return fail(403, 'ORIGIN_REJECTED', 'Origem da solicitação não autorizada.')
        if (!req.headers['content-type']?.startsWith('application/json')) return fail(415, 'JSON_REQUIRED', 'Envie um corpo JSON.')
        const body = await readJson(req, 64 * 1024)
        if (collection) return send(201, options.atendimentos.create(body))
        return send(200, withChatIdentity(options.atendimentos.update(record![1]!, body,true)))
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
