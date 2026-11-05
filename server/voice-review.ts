import type {VoicePlan,VoicePlanningContext,VoiceChange} from '../shared/voice-commands.ts'

// Human-readable review is generated from the validated server plan and its own
// authoritative context. It never trusts labels, commands or changes from HTTP.
export function voiceReview(plan:VoicePlan,context:VoicePlanningContext):string[]{
 const catalog=new Map(context.catalog.map(c=>[c.id,c.name]))
 const pieces=new Map(context.workspace.items.map(p=>[p.id,p]))
 const services=new Map(context.workspace.items.flatMap(p=>p.services.map(l=>[l.id,{line:l,piece:p}]as const)))
 const generated=new Map<string,string>()
 const pieceLabel=(id:string)=>catalog.get(id)??'peça cadastrada'
 const serviceLabel=(id:string)=>catalog.get(id)??'serviço cadastrado'
 const name=(change:VoiceChange)=>{
  if(change.op==='add_piece')return pieceLabel(change.pieceId)
  if(change.op==='add_service')return generated.get(change.piece.id)??pieceLabel(pieces.get(change.piece.id)?.pieceId??'')
  if(change.op==='remove_piece'||change.op==='update_piece'||change.op==='set_piece_enabled')return generated.get(change.target.id)??pieceLabel(pieces.get(change.target.id)?.pieceId??'')
  if(change.op==='set_service_enabled')return pieceLabel(services.get(change.target.id)?.piece.pieceId??'')
  return generated.get(change.piece.id)??pieceLabel(pieces.get(change.piece.id)?.pieceId??'')
 }
 const dimension=(id:string|null|undefined)=>id?catalog.get(id)??'dimensão cadastrada':'sem dimensão'
 const serviceOf=(change:VoiceChange)=>{
  if(change.op==='add_service')return serviceLabel(change.values.serviceId)
  if(change.op==='update_service')return serviceLabel(change.patch.serviceId??services.get(change.target.id)?.line.serviceId??'')
  return serviceLabel(services.get(change.target.id)?.line.serviceId??'')
 }
 for(const change of plan.changes)if(change.op==='add_piece')generated.set(change.target.id,pieceLabel(change.pieceId))
 return plan.changes.map(change=>{
  const piece=name(change)
  switch(change.op){
   case'add_piece':return 'Incluir peça: '+piece+' (ativa somente neste cenário)'
   case'remove_piece':return 'EXCLUIR peça: '+piece+' (todos os cenários; serviços e componentes vinculados)'
   case'update_piece':{
    const changes:string[]=[]
    if('diagnosisId'in change.patch)changes.push('diagnóstico: '+(change.patch.diagnosisId?catalog.get(change.patch.diagnosisId)??'cadastrado':'não informado'))
    if('intensity'in change.patch)changes.push('intensidade: '+(change.patch.intensity??'não informada'))
    if('notes'in change.patch)changes.push('observações da peça')
    return piece+': alterar '+changes.join(', ')+' (dados compartilhados)'
   }
   case'add_service':return piece+': incluir serviço '+serviceLabel(change.values.serviceId)+', '+dimension(change.values.dimensionId)+', quantidade '+change.values.quantity+(Object.values(change.flags).some(Boolean)?'':' (desativado)')
   case'remove_service':return 'EXCLUIR serviço '+serviceOf(change)+' de '+piece+' (todos os cenários)'
   case'update_service':{
    const changes:string[]=[]
    if('serviceId'in change.patch)changes.push('serviço: '+serviceOf(change))
    if('dimensionId'in change.patch)changes.push('dimensão: '+dimension(change.patch.dimensionId))
    if('quantity'in change.patch)changes.push('quantidade: '+change.patch.quantity)
    if('notes'in change.patch)changes.push('observações da linha')
    if('diagnosisId'in change.patch)changes.push('diagnóstico da linha')
    return piece+' / '+serviceOf(change)+': alterar '+changes.join(', ')+' (dados compartilhados)'
   }
   case'set_piece_enabled':return piece+': '+(change.enabled?'habilitar':'desabilitar')+' somente no cenário atual'
   case'set_service_enabled':return piece+' / '+serviceOf(change)+': '+(change.enabled?'habilitar':'desabilitar')+' somente no cenário atual'
  }
 })
}
