// Clipboard boundary: only these structured technical fields may leave the UI.
// Display text, names, option labels, IDs and arbitrary strings are never read.
export type VoiceAlias=number|'unresolved'|'omitted'|'missing'
export interface VoiceTechnicalCommand {command:number;operation:string;piece:VoiceAlias;service?:VoiceAlias;dimension?:VoiceAlias;quantity?:string}
export interface VoiceTechnicalDecision {code:string;command?:number}
export interface VoiceTechnicalDiagnostic {
 interpreted:VoiceTechnicalCommand[];current:VoiceTechnicalCommand[]
 existing:{piece:VoiceAlias;service:VoiceAlias;dimension:VoiceAlias;line:number;quantity:string}[]
 results:{command:number;status:string;code?:string}[];changes:number
 decisions:VoiceTechnicalDecision[]
 alterations:{operation:string;fields:string[];dimension?:{before?:VoiceAlias;after:VoiceAlias};quantity?:{before?:string;after:string};enabled?:{before?:boolean;after:boolean}}[]
}
export type VoiceTechnicalEvent=
 |{type:'capture_started'|'capture_uploaded'|'clarification_started'|'clarification_received'|'capture_failed'|'capture_cancelled'|'apply_requested'}
 |{type:'replanned';diagnostic:VoiceTechnicalDiagnostic}
 |{type:'question_offered';question:number;options:number}
 |{type:'option_selected';question:number;option:number}
 |{type:'clarification_requested';question:number}
 |{type:'request_failed';stage:'processing'|'resolution'|'apply';code?:unknown;status?:unknown}
 |{type:'apply_confirmed';changes:number;replay:boolean}
export interface VoiceHistoryEvent {text:string;technical?:VoiceTechnicalEvent}
const operations=new Set(['add_piece','remove_piece','set_piece_enabled','set_diagnosis','add_service','set_dimension','set_quantity','set_service_enabled','remove_service','set_notes','recommend_services','update_piece','update_service'])
const statuses=new Set(['valid','noop','pending','conflict'])
const fields=new Set(['presence','pieceId','diagnosisId','intensity','notes','serviceId','dimensionId','quantity','enabled','recommendationRuleId'])
const decisions=new Set(['EXISTING_LINE_RECONCILED','ADDITIONAL_LINE_REQUIRES_EDITOR','NATIVE_OPERATION_LIMIT'])
const codes=new Set([
 'AUTH_NOT_CONFIGURED','AUTH_REQUIRED','BODY_TOO_LARGE','DATABASE_UNAVAILABLE','FEATURE_UNAVAILABLE','INTERNAL_ERROR','INVALID_CREDENTIALS','INVALID_INPUT','INVALID_JSON','INVALID_PATH','INVALID_QUERY','JSON_REQUIRED','LOGIN_RATE_LIMIT','METHOD_NOT_ALLOWED','NOT_FOUND','ORIGIN_REJECTED','SESSION_LIMIT',
 'ALREADY_ABSENT','ALREADY_HANDLED','ALREADY_REMOVED','AMBIGUOUS_RECOMMENDATION','AMBIGUOUS_RULE_SET','AMBIGUOUS_SERVICE_LINE','ASSISTED_RECOMMENDATIONS_REQUIRED','AUTOMATIC_RECOMMENDATIONS_SUSPENDED','COMMAND_ID_CONFLICT','CONTEXT_CONFLICT','CURATION_BLOCKED','CURRENT_CALCULATION_PENDING','DIMENSION_PENDING','DIMENSION_SERVICE_MISMATCH','DUPLICATE_RULE_ID','EXISTING_SERVICE_DIFFERENT','EXPLICIT_REMOVAL_PRESERVED','EXPLICIT_SERVICE_INTENT_PENDING','GLOBAL_REMOVAL_CONFIRMATION_REQUIRED','IDEMPOTENCY_CONFLICT','INACTIVE_REFERENCE','INCOMPATIBLE_INTENTS','INVALID_BATCH','INVALID_COMMAND','INVALID_CONTEXT','INVALID_EXISTING_QUANTITY','LINE_NOT_FOUND','MISSING_REFERENCE','MULTIPLE_DAMAGE_UNSUPPORTED','NOT_HANDLED_BY_RECEIPT','NOT_JSON','NO_NET_CHANGE_OR_SUPERSEDED','PENDING_RULE','PENDING_RULES','PIECE_NOT_PRESENT','QUANTITY_LIMIT','RECOMMENDATIONS_UNAVAILABLE','RECOMMENDATION_CONTEXT_MISSING','RECOMMENDATION_GAP','REPEATED_COMMAND','RESTORATION_UNRESOLVED','REVISION_CONFLICT','RULE_NOT_AVAILABLE','RULE_REFERENCE_INVALID','SERVICE_LIMIT','THIRD_PARTY_CONFIRMATION_REQUIRED','UNRESOLVED_REFERENCE',
 'VOICE_APPLY_INVALID','VOICE_AUDIO_FORMAT','VOICE_AUDIO_TOO_LARGE','VOICE_BUSY','VOICE_CANCELLED','VOICE_CAPTURE_FAILED','VOICE_CLARIFICATION_PENDING','VOICE_CONTEXT_STALE','VOICE_IDEMPOTENCY_CONFLICT','VOICE_INTERPRETATION_FAILED','VOICE_INVALID_INPUT','VOICE_MODEL_INCOMPLETE','VOICE_MODEL_INVALID','VOICE_MODEL_REFUSED','VOICE_NO_SAFE_CHANGES','VOICE_PLAN_EXPIRED','VOICE_PROVIDER_UNAVAILABLE','VOICE_RATE_LIMIT','VOICE_REMOVAL_CONFIRMATION_REQUIRED','VOICE_REQUEST_FAILED','VOICE_RESOLUTION_INVALID','VOICE_TIMEOUT','VOICE_TRANSCRIPTION_FAILED','VOICE_UNAVAILABLE','VOICE_UPLOAD_TIMEOUT'
])
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
const list=(v:unknown)=>Array.isArray(v)?v.slice(0,200):[]
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1_000_000?v:undefined
const alias=(v:unknown)=>count(v)??(v==='unresolved'||v==='omitted'||v==='missing'?v:undefined)
const quantity=(v:unknown)=>typeof v==='string'&&/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(v)&&/[1-9]/.test(v)?v:undefined
const token=(v:unknown,allowed:Set<string>,fallback:string)=>typeof v==='string'&&allowed.has(v)?v:fallback
function command(value:unknown){
 const c=object(value)
 return {command:count(c.command),operation:token(c.operation,operations,'UNKNOWN_OPERATION'),piece:alias(c.piece),service:alias(c.service),dimension:alias(c.dimension),quantity:quantity(c.quantity)}
}
function diagnostic(value:unknown){
 const d=object(value)
 return {interpreted:list(d.interpreted).map(command),current:list(d.current).map(command),
  existing:list(d.existing).map(value=>{const r=object(value);return {piece:alias(r.piece),service:alias(r.service),dimension:alias(r.dimension),line:count(r.line),quantity:quantity(r.quantity)}}),
  results:list(d.results).map(value=>{const r=object(value);return {command:count(r.command),status:token(r.status,statuses,'UNKNOWN_STATE'),...(r.code===undefined?{}:{code:token(r.code,codes,'UNKNOWN_CODE')})}}),
  decisions:list(d.decisions).map(value=>{const r=object(value);return {code:token(r.code,decisions,'UNKNOWN_DECISION'),command:count(r.command)}}),
  changes:count(d.changes),alterations:list(d.alterations).map(value=>{
   const r=object(value),dim=object(r.dimension),qty=object(r.quantity),enabled=object(r.enabled)
   return {operation:token(r.operation,operations,'UNKNOWN_OPERATION'),fields:list(r.fields).filter(f=>typeof f==='string'&&fields.has(f)),
    ...(r.dimension?{dimension:{before:alias(dim.before),after:alias(dim.after)}}:{}),
    ...(r.quantity?{quantity:{before:quantity(qty.before),after:quantity(qty.after)}}:{}),
    ...(r.enabled?{enabled:{before:typeof enabled.before==='boolean'?enabled.before:undefined,after:typeof enabled.after==='boolean'?enabled.after:undefined}}:{})}
  })}
}
function technicalEvent(value:unknown){
 const e=object(value)
 switch(e.type){
  case'capture_started':case'capture_uploaded':case'clarification_started':case'clarification_received':case'capture_failed':case'capture_cancelled':case'apply_requested':return {type:e.type}
  case'replanned':return {type:e.type,diagnostic:diagnostic(e.diagnostic)}
  case'question_offered':return {type:e.type,question:count(e.question),options:count(e.options)}
  case'option_selected':return {type:e.type,question:count(e.question),option:count(e.option)}
  case'clarification_requested':return {type:e.type,question:count(e.question)}
  case'request_failed':return {type:e.type,stage:token(e.stage,new Set(['processing','resolution','apply']),'unknown'),code:token(e.code,codes,'UNKNOWN_CODE'),status:typeof e.status==='number'&&Number.isInteger(e.status)&&e.status>=400&&e.status<600?e.status:undefined}
  case'apply_confirmed':return {type:e.type,changes:count(e.changes),replay:typeof e.replay==='boolean'?e.replay:undefined}
  default:return undefined
 }
}
export function copiedVoiceDiagnostic(events:readonly {text?:unknown;technical?:unknown}[]):string{
 const safe=events.flatMap(e=>{const value=technicalEvent(e.technical);return value?[value]:[]})
 return 'FUNIX — diagnóstico técnico efêmero (aliases locais; sem nomes ou textos livres)\n'+safe.map((e,i)=>(i+1)+'. '+JSON.stringify(e)).join('\n')
}
