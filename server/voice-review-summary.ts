import type {VoiceCommand,VoiceChange,VoicePlan,VoicePlanningContext} from '../shared/voice-commands.ts'
import type {VoiceReviewEntry,VoiceReviewField,VoiceReviewGroup} from '../shared/voice-review.ts'

// Derived only from the effective plan and the same validated context used to plan it.
// The legacy prose and the model's descriptions are never parsed as changes.
export function compactVoiceReview(plan:VoicePlan,context:VoicePlanningContext,commands:VoiceCommand[]):VoiceReviewGroup[]{
 const catalog=new Map(context.catalog.map(c=>[c.id,c]))
 const pieces=new Map(context.workspace.items.map(p=>[p.id,p]))
 const lines=new Map(context.workspace.items.flatMap(p=>p.services.map((line,index)=>[line.id,{line,piece:p,index}]as const)))
 const plannedPieces=new Map(plan.changes.flatMap(c=>c.op==='add_piece'?[[c.target.id,c.pieceId]as const]:[]))
 const groups=new Map<string,VoiceReviewGroup>()
 const name=(id:string|null|undefined)=>id?catalog.get(id)?.name??'Cadastro a conferir':'Não informado'
 const fieldValue=(key:string,value:unknown):string=>{
  if(key==='diagnosisId'||key==='dimensionId'||key==='serviceId')return name(value as string|null)
  if(key==='enabled')return value?'Habilitada':'Desabilitada'
  if(key==='recommendationRuleId'){const rule=context.recommendations.flatMap(r=>r.rules).find(r=>r.id===value);return rule?name(rule.serviceId)+' · '+name(rule.dimensionId):value?'Cadastrada':'Sem vínculo'}
  if(key==='notes')return String(value??'')||'Sem observações'
  if(key==='intensity')return String(value??'Não informada')
  return String(value??'Sem vínculo')
 }
 const labels:Record<string,string>={diagnosisId:'Diagnóstico',intensity:'Intensidade',notes:'Observações',serviceId:'Serviço',dimensionId:'Dimensão',quantity:'Qtd.',recommendationRuleId:'Recomendação',enabled:'Cenário atual'}
 const fields=(values:object,before?:object):VoiceReviewField[]=>Object.entries(values).map(([key,value])=>({label:labels[key]??key,...(before?{before:fieldValue(key,(before as Record<string,unknown>)[key])}:{}),after:fieldValue(key,value)}))
 function group(id:string,title=name(id)){
  let value=groups.get(id)
  if(!value){value={id,piece:title,entries:[]};groups.set(id,value)}
  return value
 }
 const pieceId=(change:VoiceChange)=>{
  if(change.op==='add_piece')return change.pieceId
  const id='piece'in change?change.piece.id:lines.get(change.target.id)?.piece.id??change.target.id
  return pieces.get(id)?.pieceId??plannedPieces.get(id)??id
 }
 const lineLabel=(id:string)=>{
  const found=lines.get(id)
  if(!found)return 'Serviço'
  const {line,piece,index}=found
  const repeated=piece.services.filter(l=>name(l.serviceId)===name(line.serviceId)).length>1
  return name(line.serviceId)+(line.dimensionId?' · '+name(line.dimensionId):'')+(repeated?' · linha '+(index+1)+' · qtd. '+line.quantity:'')
 }
 for(const change of plan.changes){
  const origin=change.origins.dimensionId??change.origins.quantity??change.origins.presence??Object.values(change.origins)[0]
  const entry:VoiceReviewEntry={commandId:origin?.commandId,kind:'change',label:'Peça',scope:change.impact.scope==='shared'?'shared':'scenario',fields:[]}
  const affectedLines=lines.has(change.target.id)?[change.target.id]:pieces.get(change.target.id)?.services.map(l=>l.id)??[]
  if(change.impact.invalidatesExecutionConfirmations&&context.workspace.scenarios.some(s=>affectedLines.some(id=>s.serviceConfirmations?.[id])))entry.warning='Confirmações de execução serão invalidadas.'
  switch(change.op){
   case'add_piece':
    entry.kind='add';entry.label='Peça';entry.fields=fields(Object.fromEntries(Object.entries(change.values).filter(([,value])=>value!==null&&value!=='')))
    entry.fields.push({label:'Cenário atual',after:fieldValue('enabled',change.flags[context.workspace.selectedId])})
    break
   case'update_piece':entry.fields=fields(change.patch,change.before);break
   case'remove_piece':entry.kind='remove';entry.scope='global';entry.label='Excluir peça, serviços e componentes';break
   case'add_service':
    entry.kind='add';entry.label=name(change.values.serviceId)+(change.values.dimensionId?' · '+name(change.values.dimensionId):'')
    entry.fields=fields(Object.fromEntries(Object.entries(change.values).filter(([key,value])=>key!=='serviceId'&&key!=='dimensionId'&&value!==null&&value!=='')))
    entry.fields.push({label:'Cenário atual',after:fieldValue('enabled',change.flags[context.workspace.selectedId])})
    break
   case'update_service':entry.label=lineLabel(change.target.id);entry.fields=fields(change.patch,change.before);break
   case'remove_service':entry.kind='remove';entry.scope='global';entry.label=lineLabel(change.target.id);break
   case'set_piece_enabled':case'set_service_enabled':
    entry.kind=change.enabled?'add':'remove';entry.label=change.op==='set_piece_enabled'?'Peça':lineLabel(change.target.id)
    entry.fields=fields({enabled:change.enabled},{enabled:change.before});break
  }
  group(pieceId(change)).entries.push(entry)
 }
 const commandGroup=(id:string|undefined)=>{
  const command=commands.find(c=>c.id===id)
  if(!command)return group('attention','Conferir')
  return command.piece.state==='resolved'?group(command.piece.id):group('pending:'+command.piece.text,command.piece.text||'Peça a identificar')
 }
 const concise:Record<string,string>={UNRESOLVED_REFERENCE:'Identifique a referência e refaça o ditado.',AMBIGUOUS_SERVICE_LINE:'Serviço repetido: confira a linha.',LINE_NOT_FOUND:'Linha não encontrada nesta peça.',DIMENSION_PENDING:'Dimensão pendente — conferir.',ASSISTED_RECOMMENDATIONS_REQUIRED:'Serviços existentes preservados. Confira as sugestões separadamente.',RECOMMENDATION_GAP:'Sem recomendação cadastrada para este diagnóstico.',THIRD_PARTY_CONFIRMATION_REQUIRED:'Execução de terceiro exige confirmação separada.',INCOMPATIBLE_INTENTS:'Comandos conflitantes — refaça o ditado.'}
 const message=(issue:VoicePlan['issues'][number])=>concise[issue.code]??issue.message
 const pending=new Set<string>()
 for(const result of plan.results){
  if(result.status!=='pending'&&result.status!=='conflict')continue
  pending.add(result.commandId)
  const issues=plan.issues.filter(i=>i.commandId===result.commandId)
  const command=commands.find(c=>c.id===result.commandId)
  const entity=command&&'service'in command?(command.service.state==='resolved'?name(command.service.id):command.service.text):command&&'line'in command&&command.line?.kind==='id'?lineLabel(command.line.id):command&&'line'in command&&command.line?.kind==='service'?(command.line.service.state==='resolved'?name(command.line.service.id):command.line.service.text):undefined
  commandGroup(result.commandId).entries.push({commandId:result.commandId,kind:'pending',scope:'shared',label:entity||'Conferir comando',fields:issues.flatMap(i=>(i.references??[]).flatMap(id=>lines.has(id)?[{label:'Já cadastrado',after:lineLabel(id)}]:[])),warning:[...new Set(issues.map(message))].join(' ')||concise[result.reason??'']||'Contexto alterado ou referência ambígua. Refaça o ditado.'})
 }
 for(const issue of plan.issues){
  if(issue.code==='GLOBAL_REMOVAL_CONFIRMATION_REQUIRED'||issue.code==='CURRENT_CALCULATION_PENDING'||issue.commandId&&pending.has(issue.commandId))continue
  if(!issue.commandId&&plan.results.some(r=>(r.status==='pending'||r.status==='conflict')&&r.reason===issue.code))continue
  // Keep operational warnings, including missing dimensions and third-party authorization.
  commandGroup(issue.commandId).entries.push({commandId:issue.commandId,kind:'warning',scope:'shared',label:'Atenção',fields:[],warning:message(issue)})
 }
 return [...groups.values()]
}
