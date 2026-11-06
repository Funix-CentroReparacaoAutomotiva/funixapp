import type {VoiceCommand,VoicePlan,VoicePlanningContext,VoiceReference} from '../shared/voice-commands.ts'
import type {VoiceDiagnostic,VoiceDiagnosticCommand} from '../shared/voice-diagnostic.ts'
import type {VoiceTechnicalDiagnostic} from '../shared/voice-diagnostic-export.ts'
import {componentDecimal} from '../shared/voice-components.ts'
import {voiceQuantity} from './voice-command-validation.ts'
export function voiceDiagnostic(interpreted:VoiceCommand[],current:VoiceCommand[],plan:VoicePlan,ctx:VoicePlanningContext,owners:Map<string,string>):VoiceDiagnostic{
 const catalog=new Map(ctx.catalog.map(c=>[c.id,c]))
 const name=(id:string|null|undefined)=>id?catalog.get(id)?.name??'Referência ausente':'Não informada'
 const reference=(r:VoiceReference|null|undefined)=>r?.state==='resolved'?name(r.id):r?'Referência não resolvida':'Não informada'
 const serviceId=(c:VoiceCommand)=>c.op==='add_service'&&c.service.state==='resolved'?c.service.id:'line'in c&&c.line?.kind==='service'&&c.line.service.state==='resolved'?c.line.service.id:'line'in c&&c.line?.kind==='id'?ctx.workspace.items.flatMap(p=>p.services).find(l=>l.id===(c.line as {id:string}).id)?.serviceId:undefined
 const project=(commands:VoiceCommand[]):VoiceDiagnosticCommand[]=>commands.map((c,i)=>({command:i+1,operation:c.op,piece:reference(c.piece),
  ...(c.op==='add_component'?{component:c.name,quantity:componentDecimal(c.quantity??'1',true)?c.quantity??'1':undefined}:{}),
  ...(serviceId(c)?{service:name(serviceId(c))}:c.op==='add_service'?{service:'Referência não resolvida'}:{}),
  ...(c.op==='add_service'||c.op==='set_dimension'?{dimension:reference(c.dimension)}:{}),
  ...(c.op==='add_service'&&voiceQuantity(c.quantity)?{quantity:c.quantity}:c.op==='set_quantity'&&voiceQuantity(c.value)?{quantity:c.value}:{})
 }))
 const aliases=new Map([...ctx.catalog].sort((a,b)=>a.id.localeCompare(b.id)).map((c,i)=>[c.id,i+1]))
 const alias=(id:string|null|undefined)=>id?aliases.get(id)??'missing' as const:'omitted' as const
 const refAlias=(r:VoiceReference|null|undefined)=>r?.state==='resolved'?alias(r.id):r?'unresolved' as const:'omitted' as const
 const technicalProject=(commands:VoiceCommand[])=>commands.map((c,i)=>({command:i+1,operation:c.op,piece:refAlias(c.piece),...(c.op==='add_component'?{component:i+1,quantity:componentDecimal(c.quantity??'1',true)?c.quantity??'1':undefined}:{}),...(serviceId(c)?{service:alias(serviceId(c))}:c.op==='add_service'?{service:'unresolved' as const}:{}),...(c.op==='add_service'||c.op==='set_dimension'?{dimension:refAlias(c.dimension)}:{}),...(c.op==='add_service'&&voiceQuantity(c.quantity)?{quantity:c.quantity}:c.op==='set_quantity'&&voiceQuantity(c.value)?{quantity:c.value}:{})}))
 const relevant=new Set(current.flatMap(c=>c.piece.state==='resolved'?[c.piece.id]:[]))
 const services=new Set(current.map(serviceId).filter(Boolean))
 const technical:VoiceTechnicalDiagnostic={interpreted:technicalProject(interpreted),current:technicalProject(current),decisions:[],changes:plan.changes.length,
  existing:ctx.workspace.items.flatMap(p=>p.services.map((l,index)=>({piece:alias(p.pieceId),service:alias(l.serviceId),dimension:alias(l.dimensionId),quantity:voiceQuantity(l.quantity)?l.quantity:'',line:index+1}))).filter(l=>current.some(c=>c.piece.state==='resolved'&&alias(c.piece.id)===l.piece&&alias(serviceId(c))===l.service)),
  results:plan.results.map(r=>({command:current.findIndex(c=>c.id===(owners.get(r.commandId)??r.commandId))+1,status:r.status,...(r.reason?{code:r.reason}:{})})),
  alterations:plan.changes.map(change=>{
   const values:Record<string,unknown>=change.op==='update_piece'||change.op==='update_service'?change.patch:change.op==='add_piece'||change.op==='add_service'||change.op==='add_component'?change.values:change.op==='set_piece_enabled'||change.op==='set_service_enabled'?{enabled:change.enabled}:{}
   const before:Record<string,unknown>=change.op==='update_piece'||change.op==='update_service'?change.before:change.op==='set_piece_enabled'||change.op==='set_service_enabled'?{enabled:change.before}:{}
   return {operation:change.op,fields:Object.keys(values),...('dimensionId'in values?{dimension:{...('dimensionId'in before?{before:alias(before.dimensionId as string|null)}:{}),after:alias(values.dimensionId as string|null)}}:{}),...(componentDecimal(values.quantity,true)?{quantity:{...(componentDecimal(before.quantity,true)?{before:before.quantity}:{}),after:values.quantity}}:{}),...(typeof values.enabled==='boolean'?{enabled:{...(typeof before.enabled==='boolean'?{before:before.enabled}:{}),after:values.enabled}}:{})}
  })}
 return {technical,interpreted:project(interpreted),current:project(current),existing:ctx.workspace.items.filter(p=>relevant.has(p.pieceId)).flatMap(p=>p.services.filter(l=>services.has(l.serviceId)).map(l=>({piece:name(p.pieceId),service:name(l.serviceId),dimension:name(l.dimensionId),quantity:voiceQuantity(l.quantity)?l.quantity:'Inválida'}))),
  results:plan.results.map(r=>({command:current.findIndex(c=>c.id===(owners.get(r.commandId)??r.commandId))+1,status:r.status,...(r.reason?{code:r.reason}:{})})),changes:plan.changes.length}
}
