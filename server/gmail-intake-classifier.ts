import type { GmailIntakeNoticeInput, GmailIntakeRelevance } from '../shared/gmail-intake.ts'

/** Read-only email classification. Results must never authorize downstream work. */
export type GmailIntakeCandidate = {
  messageId: string
  subject: string
  snippet: string
  sender?: string
  bodyText?: string
  threadSubject?: string
}
export type GmailCandidateClassification =
  | { relevance: 'irrelevant'; reason: string; notice: null }
  | { relevance: GmailIntakeRelevance; reason: string; notice: GmailIntakeNoticeInput }

const messageIdPattern = /^[0-9a-f]{15,25}$/i
const normalize = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const clean = (s: string) => s.replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()
const plateRegex = /(?:^|[^a-z0-9])([a-z]{3})[\s-]?([0-9])([a-z0-9])([0-9]{2})(?=$|[^a-z0-9])/gi
const xpRegex = /\bXP[\s:#-]*([0-9]{3,8})\b/gi

const serviceSignal = /\b(sinistro|colis[aã]o|avaria|funilaria|pintura\s+automotiva|reparo|repara[cç][aã]o|conserto|parachoque|para-choque|lanternagem|carro\s+batido|ve[ií]culo\s+sinistrado|servi[cç]o\s+do\s+ve[ií]culo|autoriza[cç][aã]o\s+de\s+servi[cç]o|per[ií]cia\s+automotiva|complemento\s+de\s+servi[cç]o)\b/
const vehicleSignal = /\b(veiculo|carro|automovel|moto|placa|chassi|oficina|seguradora|associacao\s+veicular|protecao\s+veicular|vistoria|franquia|atendimento|experiencia|cliente\s+do\s+veiculo)\b/
const commercialSignal = /\b(orcamento|cotacao|avaliacao|proposta|autorizacao|liberacao|complemento|pendencia|retorno|agendamento|atualizacao)\b/
const adminSignal = /\b(folha\s+de\s+pagamento|holerite|contracheque|e-?social|contabilidade|departamento\s+pessoal|imposto\s+de\s+renda|honorarios\s+contabeis)\b/
const purchaseSignal = /\b(mercado\s*livre|compra\s+aprovada|pedido\s+confirmado|pedido\s+enviado|rastreamento\s+de\s+pedido|entrega\s+do\s+pedido|compra\s+de\s+(pecas|equipamentos|maquinas)|nota\s+fiscal\s+de\s+compra)\b/
const marketingSignal = /\b(promocao|oferta\s+especial|black\s+friday|descontos?\s+imperdiveis?|marketing\s+digital|campanha\s+publicitaria|newsletter|liquidacao|aproveite\s+agora)\b/
const riskySubject = /\b(orcamento|cotacao|atendimento|autorizacao|complemento|processo)\b/

function hints(raw: string) {
  const plates=new Set<string>(),xps=new Set<string>()
  let m:RegExpExecArray|null
  plateRegex.lastIndex=0
  while((m=plateRegex.exec(raw))!==null)plates.add((m[1]!+m[2]!+m[3]!+m[4]!).toUpperCase())
  xpRegex.lastIndex=0
  while((m=xpRegex.exec(raw))!==null)xps.add('XP'+m[1]!)
  return {plates,xps,ambiguous:plates.size>1||xps.size>1}
}

function validated(value: unknown): GmailIntakeCandidate {
  if(!value || typeof value!=='object'||Array.isArray(value)) throw new Error('GMAIL_CANDIDATE_INVALID')
  const c=value as Record<string,unknown>
  if(Object.keys(c).some(k=>!['messageId','subject','snippet','sender','bodyText','threadSubject'].includes(k))||
    typeof c.messageId!=='string'||!messageIdPattern.test(c.messageId)||
    typeof c.subject!=='string'||c.subject.length>500||
    typeof c.snippet!=='string'||c.snippet.length>1500||
    (c.sender!==undefined&&(typeof c.sender!=='string'||c.sender.length>300))||
    (c.bodyText!==undefined&&(typeof c.bodyText!=='string'||c.bodyText.length>8000))||
    (c.threadSubject!==undefined&&(typeof c.threadSubject!=='string'||c.threadSubject.length>500)))
    throw new Error('GMAIL_CANDIDATE_INVALID')
  return c as GmailIntakeCandidate
}

export function classifyGmailCandidate(candidate:unknown): GmailCandidateClassification {
  const c=validated(candidate)
  const subject=clean(c.subject)
  const snippet=clean(c.snippet)
  const full=normalize([subject,snippet,c.bodyText??'',c.threadSubject??''].join(' ').slice(0,11000))
  const {plates,xps,ambiguous}=hints(full)
  const vehicle=vehicleSignal.test(full),service=serviceSignal.test(full)
  const commercial=commercialSignal.test(full)
  const subjectNormalized=normalize(subject)
  const admin=adminSignal.test(subjectNormalized),purchase=purchaseSignal.test(subjectNormalized)
  const marketing=marketingSignal.test(subjectNormalized)
  const identified=plates.size>0||xps.size>0
  let relevance: 'relevant'|'uncertain'|'irrelevant'
  let reason:string
  if(ambiguous){
    relevance='uncertain';reason='MULTIPLE_VEHICLE_IDENTIFIERS'
  }else if(admin||purchase){
    relevance='irrelevant';reason=admin?'ADMINISTRATIVE':'PURCHASE'
  }else if(marketing&&!identified){
    relevance='irrelevant';reason='MARKETING'
  }else if(marketing&&identified){
    relevance='uncertain';reason='MARKETING_WITH_VEHICLE_IDENTIFIER'
  }else if(identified){
    relevance='relevant';reason='VEHICLE_IDENTIFIER'
  }else if(service){
    relevance='relevant';reason='REPAIR_SERVICE_CONTEXT'
  }else if(vehicle&&commercial){
    relevance='uncertain';reason='POSSIBLE_VEHICLE_SERVICE'
  }else if(vehicle){
    relevance='uncertain';reason='VEHICLE_CONTEXT'
  }else if(commercial&&riskySubject.test(normalize(subject))){
    relevance='uncertain';reason='COMMERCIAL_LEAD_UNVERIFIED'
  }else{
    relevance='irrelevant';reason='NO_SERVICE_SIGNAL'
  }
  if(relevance==='irrelevant')return {relevance,reason,notice:null}
  const title=subject.slice(0,200)||'Mensagem sobre possível serviço de veículo'
  // Store only a short preview and the classification, never email content/attachments.
  const summary=snippet.slice(0,300) || 'Novo e-mail potencialmente ligado a serviços automotivos. Verificar antes de processar.'
  return {
    relevance,reason,
    notice:{
      messageId:c.messageId.toLowerCase(),title,summary,relevance,reason,
      plateHint:plates.size===1?[...plates][0]!:null,
      xpHint:xps.size===1?[...xps][0]!:null
    }
  }
}
