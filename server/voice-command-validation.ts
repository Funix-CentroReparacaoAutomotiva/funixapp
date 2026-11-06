import{componentDecimal,componentName}from'../shared/voice-components.ts'
import{DIAGNOSIS_INTENSITIES}from'../shared/commercial.ts'
import{VOICE_COMMANDS_FORMAT}from'../shared/voice-commands.ts'
import type{VoiceCommandBatch,VoiceCommand,VoiceIssue}from'../shared/voice-commands.ts'

const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=100&&v.trim()===v
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k))
export const voiceQuantity=(v:unknown):v is string=>typeof v==='string'&&/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(v)&&/[1-9]/.test(v)
export const normalizedQuantity=(s:string)=>s.includes('.')?s.replace(/0+$/,'').replace(/\.$/,''):s
function reference(v:unknown):boolean{
 if(!object(v))return false
 if(v.state==='resolved')return keys(v,['state','id'])&&id(v.id)
 return v.state==='unresolved'&&keys(v,['state','text','candidates'])&&typeof v.text==='string'&&v.text.length<=1000&&(v.candidates===undefined||Array.isArray(v.candidates)&&v.candidates.length<=20&&v.candidates.every(id))
}
function line(v:unknown):boolean{
 if(!object(v))return false
 if(v.kind==='id')return keys(v,['kind','id'])&&id(v.id)
 if(v.kind==='command')return keys(v,['kind','commandId'])&&id(v.commandId)
 return v.kind==='service'&&keys(v,['kind','service'])&&reference(v.service)
}
function revisions(v:unknown):boolean{
 if(!object(v)||!keys(v,['composition','configuration','scenarios','pieces'])||!integer(v.composition)||!integer(v.configuration))return false
 return ['scenarios','pieces'].every(key=>Array.isArray(v[key])&&v[key].length<=1000&&v[key].every(r=>object(r)&&keys(r,['id','revision'])&&id(r.id)&&integer(r.revision))&&new Set(v[key].map(r=>(r as Record<string,unknown>).id)).size===v[key].length)
}
const fields:Record<string,string[]>={
 add_component:['name','quantity','manualPrice','duplicateDecision'],add_piece:[],remove_piece:[],set_piece_enabled:['enabled'],set_diagnosis:['diagnosis','intensity','additionalDamage'],
 add_service:['service','dimension','quantity'],set_dimension:['line','dimension'],set_quantity:['line','mode','value'],
 set_service_enabled:['line','enabled'],remove_service:['line'],set_notes:['line','value'],recommend_services:['mode','ruleIds'],
}
function command(v:unknown):v is VoiceCommand{
 if(!object(v)||!id(v.id)||(v.intent!=='instruction'&&v.intent!=='correction')||!reference(v.piece)||typeof v.op!=='string'||!Object.hasOwn(fields,v.op)||!keys(v,['id','intent','piece','sourceText','op',...fields[v.op]!]))return false
 if(v.sourceText!==undefined&&(typeof v.sourceText!=='string'||v.sourceText.length>4000))return false
 switch(v.op){
  case'add_component':return componentName(v.name)&&(v.quantity===undefined||componentDecimal(v.quantity,true))&&(v.manualPrice===undefined||componentDecimal(v.manualPrice))&&(v.duplicateDecision===undefined||object(v.duplicateDecision)&&keys(v.duplicateDecision,['mode','references'])&&(v.duplicateDecision.mode==='keep'||v.duplicateDecision.mode==='new')&&Array.isArray(v.duplicateDecision.references)&&v.duplicateDecision.references.length>0&&v.duplicateDecision.references.length<=200&&v.duplicateDecision.references.every(r=>typeof r==='string'&&r.length>0&&r.length<=200)&&new Set(v.duplicateDecision.references).size===v.duplicateDecision.references.length)
  case'add_piece':case'remove_piece':return true
  case'set_piece_enabled':return typeof v.enabled==='boolean'
  case'set_diagnosis':return ('diagnosis'in v||'intensity'in v)&&(v.diagnosis===undefined||v.diagnosis===null||reference(v.diagnosis))&&(v.intensity===undefined||v.intensity===null||DIAGNOSIS_INTENSITIES.includes(v.intensity as typeof DIAGNOSIS_INTENSITIES[number]))&&(v.additionalDamage===undefined||typeof v.additionalDamage==='boolean')
  case'add_service':return reference(v.service)&&(v.dimension===undefined&&v.intent==='correction'||v.dimension===null||reference(v.dimension))&&(v.quantity===undefined||voiceQuantity(v.quantity))
  case'set_dimension':return line(v.line)&&(v.dimension===null||reference(v.dimension))
  case'set_quantity':return line(v.line)&&(v.mode==='absolute'||v.mode==='increment')&&voiceQuantity(v.value)
  case'set_service_enabled':return line(v.line)&&typeof v.enabled==='boolean'
  case'remove_service':return line(v.line)
  case'set_notes':return(v.line===undefined||line(v.line))&&typeof v.value==='string'&&v.value.length<=8000
  case'recommend_services':return(v.mode==='automatic'&&v.ruleIds===undefined)||(v.mode==='assisted'&&Array.isArray(v.ruleIds)&&v.ruleIds.length<=100&&v.ruleIds.every(r=>typeof r==='string'&&r.length>0&&r.length<=180)&&new Set(v.ruleIds).size===v.ruleIds.length)
  default:return false
 }
}
export function validateVoiceCommands(input:unknown):{batch:VoiceCommandBatch|null;issues:VoiceIssue[];invalidIndexes:number[]}{
 const issues:VoiceIssue[]=[],invalidIndexes:number[]=[]
 if(!object(input)||!keys(input,['format','idempotencyKey','atendimentoId','scenarioId','expected','commands'])||input.format!==VOICE_COMMANDS_FORMAT||typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(input.idempotencyKey)||!id(input.atendimentoId)||!id(input.scenarioId)||!revisions(input.expected)||!Array.isArray(input.commands)||input.commands.length>100){
  return{batch:null,issues:[{code:'INVALID_BATCH',message:'Contrato, contexto ou revisões inválidos.',blocking:true}],invalidIndexes}
 }
 input.commands.forEach((value,index)=>{if(!command(value)){invalidIndexes.push(index);issues.push({...(object(value)&&id(value.id)?{commandId:value.id}:{}),code:'INVALID_COMMAND',message:`Comando ${index+1} fora do contrato.`,blocking:true})}})
 // Preserve indexes and the full request digest; invalid commands are never executed.
 return{batch:input as unknown as VoiceCommandBatch,issues,invalidIndexes}
}
