import {ServiceError} from './errors.ts'

// A small strict JSON-schema projection. All schema fields are required;
// nullable optional values are converted explicitly before the PR1 validator.
const str={type:'string'},bool={type:'boolean'}
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const enumeration=(values:string[])=>({type:'string',enum:values})
const nullable=(schema:unknown)=>({anyOf:[schema,{type:'null'}]})
const reference={anyOf:[object({state:enumeration(['resolved']),id:str}),object({state:enumeration(['unresolved']),text:str,candidates:{type:'array',items:str}})]}
const line={anyOf:[object({kind:enumeration(['id']),id:str}),object({kind:enumeration(['service']),service:reference}),object({kind:enumeration(['command']),commandId:str})]}
const base={id:str,intent:enumeration(['instruction','correction']),piece:reference}
const operation=(op:string,fields:Record<string,unknown>={})=>object({...base,op:enumeration([op]),...fields})
export const voiceModelSchema=object({commands:{type:'array',items:{anyOf:[
 operation('add_component',{name:str,quantity:str,manualPrice:str}),operation('add_piece'),operation('remove_piece'),operation('set_piece_enabled',{enabled:bool}),
 operation('set_diagnosis',{setDiagnosis:bool,diagnosis:nullable(reference),setIntensity:bool,intensity:nullable(enumeration(['leve','moderado','severo'])),additionalDamage:bool}),
 operation('add_service',{service:reference,dimension:nullable(reference),preserveDimension:bool,quantity:nullable(str)}),
 operation('set_dimension',{line,dimension:nullable(reference)}),
 operation('set_quantity',{line,mode:enumeration(['increment','absolute']),value:str}),
 operation('set_service_enabled',{line,enabled:bool}),operation('remove_service',{line}),
 operation('set_notes',{line:nullable(line),value:str})
]}}})
function invalid():never{throw new ServiceError(502,'VOICE_MODEL_INVALID','A IA retornou comandos inválidos; nenhuma alteração foi aplicada.')}
export function convertVoiceModelOutput(value:unknown):unknown[]{
 if(!voiceModelOutputMatches(value))invalid()
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='commands')||!('commands'in value)||!Array.isArray(value.commands)||value.commands.length>100)invalid()
 return value.commands.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))invalid()
  const c={...raw} as Record<string,unknown>
  if(c.op==='set_diagnosis'){
   if(typeof c.setDiagnosis!=='boolean'||typeof c.setIntensity!=='boolean')invalid()
   if(!c.setDiagnosis){if(c.diagnosis!==null)invalid();delete c.diagnosis}
   if(!c.setIntensity){if(c.intensity!==null)invalid();delete c.intensity}
   delete c.setDiagnosis;delete c.setIntensity
  }
  if(c.op==='add_service'){
   if(typeof c.preserveDimension!=='boolean')invalid()
   if(c.preserveDimension){if(c.intent!=='correction'||c.dimension!==null)invalid();delete c.dimension}
   delete c.preserveDimension
   if(c.quantity===null)delete c.quantity
  }
  if(c.op==='set_notes'&&c.line===null)delete c.line
  return c
 })
}

// Validate the transport schema as well as the domain contract. A refusal,
// unexpected property or wrong nullable representation never bypasses PR1.
export function voiceModelOutputMatches(value:unknown):boolean{
 function match(raw:unknown,value:unknown):boolean{
  const s=raw as {anyOf?:unknown[];type?:string;enum?:unknown[];properties?:Record<string,unknown>;required?:string[];items?:unknown}
  if(s.anyOf)return s.anyOf.some(v=>match(v,value))
  if(s.enum&&!s.enum.includes(value))return false
  if(s.type==='null')return value===null
  if(s.type==='string')return typeof value==='string'
  if(s.type==='boolean')return typeof value==='boolean'
  if(s.type==='array')return Array.isArray(value)&&value.every(v=>match(s.items,v))
  if(s.type==='object'){
   if(!value||typeof value!=='object'||Array.isArray(value))return false
   const v=value as Record<string,unknown>
   return Object.keys(v).every(k=>Object.hasOwn(s.properties!,k))&&s.required!.every(k=>Object.hasOwn(v,k))&&Object.entries(s.properties!).every(([k,t])=>match(t,v[k]))
  }
  return false
 }
 return match(voiceModelSchema,value)
}
