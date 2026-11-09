import type { UpdatePackageFragment } from './update-packages-consolidate.ts'

/**
 * Commercial triage is an observation, NOT an external approval or a quote.
 * Do not use this output as an ERP authorization, payment instruction, or
 * evidence that a customer/association approved a scope change.
 */
export type CommercialSignal = {
  kind: 'possible_authorization' | 'possible_rejection' | 'possible_amount' | 'possible_change'
  excerpt: string
}
export type CommercialTriage = {
  source: 'gmail'
  sourceReference: string
  bodyComplete: boolean
  status: 'requires_review' | 'no_commercial_signals'
  signals: CommercialSignal[]
  fragment: UpdatePackageFragment
}

const gmailId=/^[0-9a-f]{15,25}$/i
const monetary=/\bR\$\s*(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{2})?\b/gi
const rules: Array<[CommercialSignal['kind'],RegExp]> = [
  ['possible_authorization', /\b(?:autorizad[oa]s?|aprovad[oa]s?|liberad[oa]s?)\b/i],
  ['possible_rejection', /\b(?:negad[oa]s?|recusad[oa]s?|reprovad[oa]s?|cancelad[oa]s?)\b/i],
  ['possible_change', /\b(?:complemento|alter[aç][aã]o|revis[aã]o|aditivo|franquia|participa[cç][aã]o)\b/i]
]
function excerpt(text:string, start:number, end:number):string {
  return text.slice(Math.max(0,start-80),Math.min(text.length,end+80)).replace(/\s+/g,' ').slice(0,200)
}
export function triageCommercialEmail(input:{
  messageId:string
  subject:string
  body:string | null
  bodyComplete:boolean
  experienceId:string | null
  plate:string | null
}):CommercialTriage {
  if (!gmailId.test(input.messageId) || typeof input.subject!=='string' ||
    input.subject.length>3000 || !(input.body===null || typeof input.body==='string') ||
    (input.body!==null && input.body.length>100000) || typeof input.bodyComplete!=='boolean') {
    throw new Error('COMMERCIAL_INPUT_INVALID')
  }
  const text=[input.subject,input.body??''].join('\n')
  const signals:CommercialSignal[]=[]
  for (const [kind,re] of rules) {
    const found=re.exec(text)
    if(found)signals.push({kind,excerpt:excerpt(text,found.index,found.index+found[0].length)})
  }
  monetary.lastIndex=0
  for (const found of text.matchAll(monetary)) {
    if (signals.filter(s=>s.kind==='possible_amount').length>=10)break
    signals.push({kind:'possible_amount',excerpt:excerpt(text,found.index??0,(found.index??0)+found[0].length)})
  }
  // Conservative: no semantic decision from a subject, partial text or keywords.
  const requiresReview=signals.length>0 || !input.bodyComplete || input.body===null
  const summary=requiresReview
    ? 'Mensagem contém possíveis dados comerciais ou leitura incompleta. Conferência obrigatória.'
    : 'Nenhum indício comercial detectado por regras limitadas. Verificar conteúdo integral.'
  return {
    source:'gmail',sourceReference:input.messageId,bodyComplete:input.bodyComplete,
    status:requiresReview?'requires_review':'no_commercial_signals',signals,
    fragment:{
      part:'commercial',
      proposal:{
        source:'gmail',sourceReference:input.messageId,
        experienceId:input.experienceId,plate:input.plate,
        title:'Triagem comercial da mensagem',
        summary,
        actions: signals.length? [{
          id:'review:commercial',type:'other',
          title:'Revisar informações comerciais',
          detail:'Indícios de autorização, recusa, alteração ou valor foram extraídos como texto; nenhum é autorização externa comprovada.'
        }]:[],
        missingFields:requiresReview?[{
          key:'commercialReview',label:'Conferir conteúdo comercial',
          hint:'Verifique emissor, documento, escopo, condições, valores e autorização na fonte oficial. Resposta exige replanejamento.'
        }]:[]
      }
    }
  }
}
