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
  if('piece'in change)return generated.get(change.piece.id)??pieceLabel(pieces.get(change.piece.id)?.pieceId??'')
  return pieceLabel(services.get(change.target.id)?.piece.pieceId??'')
 }
 const diagnosis=(id:string|null|undefined)=>id?catalog.get(id)??'diagnóstico cadastrado':'não informado'
 const notes=(value:string|null|undefined)=>value?JSON.stringify(value):'vazias (apagar conteúdo anterior)'
 const flags=(values:Record<string,boolean>)=>(values[context.workspace.selectedId]?'habilitada':'desabilitada')+' no cenário atual; desabilitada nos demais cenários'
 const dimension=(id:string|null|undefined)=>id?catalog.get(id)??'dimensão cadastrada':'sem dimensão'
 const serviceOf=(change:VoiceChange)=>{
  if(change.op==='add_service')return serviceLabel(change.values.serviceId)
  if(change.op==='update_service')return serviceLabel(change.patch.serviceId??services.get(change.target.id)?.line.serviceId??'')
  const existing=services.get(change.target.id)
  if(!existing)return 'serviço cadastrado'
  const position=existing.piece.services.findIndex(line=>line.id===existing.line.id)+1
  return serviceLabel(existing.line.serviceId)+' (linha '+position+', '+dimension(existing.line.dimensionId)+', quantidade '+existing.line.quantity+')'
 }
 for(const change of plan.changes)if(change.op==='add_piece')generated.set(change.target.id,pieceLabel(change.pieceId))
 const review=plan.changes.map(change=>{
  const piece=name(change)
  switch(change.op){
   case'add_piece':return 'Incluir peça: '+piece+'; diagnóstico: '+diagnosis(change.values.diagnosisId)+
    '; intensidade: '+(change.values.intensity??'não informada')+'; observações da peça: '+notes(change.values.notes)+
    ' (dados compartilhados); peça '+flags(change.flags)
   case'remove_piece':return 'EXCLUIR peça: '+piece+' (todos os cenários; serviços e componentes vinculados)'
   case'update_piece':{
    const changes:string[]=[]
    if('diagnosisId'in change.patch)changes.push('diagnóstico: '+(change.patch.diagnosisId?catalog.get(change.patch.diagnosisId)??'cadastrado':'não informado'))
    if('intensity'in change.patch)changes.push('intensidade: '+(change.patch.intensity??'não informada'))
    if('notes'in change.patch)changes.push('observações da peça: '+notes(change.patch.notes))
    return piece+': alterar '+changes.join(', ')+' (dados compartilhados)'
   }
   case'add_service':return piece+': incluir serviço '+serviceLabel(change.values.serviceId)+', '+dimension(change.values.dimensionId)+
    ', quantidade '+change.values.quantity+'; diagnóstico da linha: '+diagnosis(change.values.diagnosisId)+
    '; observações da linha: '+notes(change.values.notes)+(change.values.recommendationRuleId?'; origem: recomendação cadastrada':'')+
    ' (dados compartilhados); linha '+flags(change.flags)
   case'remove_service':return 'EXCLUIR serviço '+serviceOf(change)+' de '+piece+' (todos os cenários)'
   case'update_service':{
    const changes:string[]=[]
    if('serviceId'in change.patch)changes.push('serviço: '+serviceOf(change))
    if('dimensionId'in change.patch)changes.push('dimensão: '+dimension(change.patch.dimensionId))
    if('quantity'in change.patch)changes.push('quantidade: '+change.patch.quantity)
    if('notes'in change.patch)changes.push('observações da linha: '+notes(change.patch.notes))
    if('diagnosisId'in change.patch)changes.push('diagnóstico da linha: '+diagnosis(change.patch.diagnosisId))
    if('recommendationRuleId'in change.patch)changes.push('origem da recomendação: '+(change.patch.recommendationRuleId??'sem vínculo'))
    return piece+' / '+serviceOf(change)+': alterar '+changes.join(', ')+' (dados compartilhados)'
   }
   case'set_piece_enabled':return piece+': '+(change.enabled?'habilitar':'desabilitar')+' somente no cenário atual'
   case'set_service_enabled':return piece+' / '+serviceOf(change)+': '+(change.enabled?'habilitar':'desabilitar')+' somente no cenário atual'
  }
 })
 return review.map((text,index)=>text+(plan.changes[index]!.impact.invalidatesExecutionConfirmations?
  '; confirmações de execução anteriores serão invalidadas':''))
}
