import type {VoiceCommand,VoicePlan,VoicePlanningContext,VoiceReference} from '../shared/voice-commands.ts'
import type {VoiceDiagnostic,VoiceDiagnosticCommand} from '../shared/voice-diagnostic.ts'
import {voiceQuantity} from './voice-command-validation.ts'
export function voiceDiagnostic(interpreted:VoiceCommand[],current:VoiceCommand[],plan:VoicePlan,ctx:VoicePlanningContext,owners:Map<string,string>):VoiceDiagnostic{
 const catalog=new Map(ctx.catalog.map(c=>[c.id,c]))
 const name=(id:string|null|undefined)=>id?catalog.get(id)?.name??'Referência ausente':'Não informada'
 const reference=(r:VoiceReference|null|undefined)=>r?.state==='resolved'?name(r.id):r?'Referência não resolvida':'Não informada'
 const serviceId=(c:VoiceCommand)=>c.op==='add_service'&&c.service.state==='resolved'?c.service.id:'line'in c&&c.line?.kind==='service'&&c.line.service.state==='resolved'?c.line.service.id:'line'in c&&c.line?.kind==='id'?ctx.workspace.items.flatMap(p=>p.services).find(l=>l.id===(c.line as {id:string}).id)?.serviceId:undefined
 const project=(commands:VoiceCommand[]):VoiceDiagnosticCommand[]=>commands.map((c,i)=>({command:i+1,operation:c.op,piece:reference(c.piece),
  ...(serviceId(c)?{service:name(serviceId(c))}:c.op==='add_service'?{service:'Referência não resolvida'}:{}),
  ...(c.op==='add_service'||c.op==='set_dimension'?{dimension:reference(c.dimension)}:{}),
  ...(c.op==='add_service'&&voiceQuantity(c.quantity)?{quantity:c.quantity}:c.op==='set_quantity'&&voiceQuantity(c.value)?{quantity:c.value}:{})
 }))
 const relevant=new Set(current.flatMap(c=>c.piece.state==='resolved'?[c.piece.id]:[]))
 const services=new Set(current.map(serviceId).filter(Boolean))
 return {interpreted:project(interpreted),current:project(current),existing:ctx.workspace.items.filter(p=>relevant.has(p.pieceId)).flatMap(p=>p.services.filter(l=>services.has(l.serviceId)).map(l=>({piece:name(p.pieceId),service:name(l.serviceId),dimension:name(l.dimensionId),quantity:voiceQuantity(l.quantity)?l.quantity:'Inválida'}))),
  results:plan.results.map(r=>({command:current.findIndex(c=>c.id===(owners.get(r.commandId)??r.commandId))+1,status:r.status,...(r.reason?{code:r.reason}:{})})),changes:plan.changes.length}
}
