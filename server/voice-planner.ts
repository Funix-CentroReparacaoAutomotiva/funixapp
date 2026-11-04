// Pure planning only. No SQLite/repository/HTTP imports, clocks, UUIDs or execution.
import{createHash}from'node:crypto'
import{catalogItemUsable}from'../shared/commercial.ts'
import type{CatalogItem,DiagnosisItem,DiagnosisService}from'../shared/commercial.ts'
import{COMMERCIAL_CURATION,compareRecommendations,executionScope,newServiceSelectionIssue,servicePolicy}from'../shared/commercial-curation.ts'
import type{VoiceChange,VoiceCommand,VoiceEntityReference,VoiceLineReference,VoiceOrigin,VoicePlan,VoicePlanningContext,VoiceReference,VoiceResult,VoiceRevisions}from'../shared/voice-commands.ts'
import{validateVoiceCommands,voiceQuantity,normalizedQuantity}from'./voice-command-validation.ts'

function canonical(value:unknown):string{
 const active=new Set<object>()
 const visit=(v:unknown):unknown=>{
  if(v===null||typeof v!=='object'){if(typeof v==='bigint'||typeof v==='function'||typeof v==='symbol')throw Error('Not JSON');return v}
  if(active.has(v))throw Error('Cyclic input');active.add(v)
  const result=Array.isArray(v)?v.map(visit):Object.fromEntries(Object.keys(v).sort().filter(k=>(v as Record<string,unknown>)[k]!==undefined).map(k=>[k,visit((v as Record<string,unknown>)[k])]))
  active.delete(v);return result
 }
 return JSON.stringify(visit(value))
}
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex')
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b)
const commandId=(raw:unknown,index:number)=>raw&&typeof raw==='object'&&'id'in raw&&typeof raw.id==='string'&&raw.id.length>0&&raw.id.length<=100&&raw.id.trim()===raw.id?raw.id:'invalid:'+index
export function voiceContextDigest(context:VoicePlanningContext){return digest({curation:COMMERCIAL_CURATION,atendimentoId:context.atendimentoId,workspace:context.workspace,catalog:[...context.catalog].sort((a,b)=>a.id.localeCompare(b.id)),recommendations:[...context.recommendations].sort((a,b)=>(a.diagnosisId+':'+a.intensity).localeCompare(b.diagnosisId+':'+b.intensity))})}
export function voiceRevisions(context:VoicePlanningContext):VoiceRevisions{return{composition:context.workspace.revision,configuration:context.workspace.configurationRevision,scenarios:context.workspace.scenarios.map(s=>({id:s.id,revision:s.revision})),pieces:context.workspace.items.map(p=>({id:p.id,revision:p.revision}))}}
const sortRefs=(rows:{id:string;revision:number}[])=>[...rows].sort((a,b)=>a.id.localeCompare(b.id))
const sameRevisions=(a:VoiceRevisions,b:VoiceRevisions)=>a.composition===b.composition&&a.configuration===b.configuration&&equal(sortRefs(a.scenarios),sortRefs(b.scenarios))&&equal(sortRefs(a.pieces),sortRefs(b.pieces))
const explicit=(c:VoiceCommand):VoiceOrigin=>({kind:'explicit',commandId:c.id,intent:c.intent})
function increment(a:string,b:string){
 const units=(v:string)=>{const[w,f='']=v.split('.');return BigInt(w!)*1000000n+BigInt(f.padEnd(6,'0'))}
 const value=units(a)+units(b)
 return normalizedQuantity(value/1000000n+'.'+String(value%1000000n).padStart(6,'0'))
}
type WorkingPiece=Pick<DiagnosisItem,'id'|'pieceId'|'diagnosisId'|'notes'|'services'>&{intensity:NonNullable<DiagnosisItem['intensity']>|null}
class IntentConflict{indexes:number[];constructor(indexes:number[]){this.indexes=indexes}}

export function planVoiceCommands(input:unknown,context:VoicePlanningContext):VoicePlan{
 const parsed=validateVoiceCommands(input),batch=parsed.batch,guards=voiceRevisions(context)
 let requestDigest:string
 try{requestDigest=digest(input)}catch{requestDigest=digest(null);parsed.issues.push({code:'NOT_JSON',message:'Entrada deve conter somente dados JSON.',blocking:true});parsed.batch=null}
 const plan:VoicePlan={format:'funix-voice-plan-v1',idempotencyKey:batch?.idempotencyKey??null,requestDigest,stateDigest:voiceContextDigest(context),guards,results:[],changes:[],issues:[...parsed.issues],usedRules:[],replay:false,requiresCalculation:false}
 for(const calculation of context.workspace.calculations??[])if(calculation.scenarioId===context.workspace.selectedId)for(const message of calculation.errors)plan.issues.push({code:'CURRENT_CALCULATION_PENDING',message:'Estado atual, antes do plano: '+message,blocking:false})
 if(!batch||!parsed.batch)return plan
 const invalid=new Set(parsed.invalidIndexes),blocked=new Set<number>(),repeated=new Set<number>(),seen=new Map<string,{index:number;body:string}>()
 batch.commands.forEach((c,i)=>{
  const id=commandId(c,i),body=canonical(c),old=seen.get(id)
  if(!old)seen.set(id,{index:i,body})
  else if(old.body===body)repeated.add(i)
  else{blocked.add(i);blocked.add(old.index);plan.issues.push({commandId:id,code:'COMMAND_ID_CONFLICT',message:'Mesmo ID identifica comandos diferentes.',blocking:true})}
 })
 const receipt=context.receipts?.find(r=>r.atendimentoId===batch.atendimentoId&&r.idempotencyKey===batch.idempotencyKey)
 const failAll=(code:string,message:string)=>{plan.issues.push({code,message,blocking:true});plan.results=batch.commands.map((c,index)=>({index,commandId:commandId(c,index),status:'conflict',reason:code}));return plan}
 if(batch.atendimentoId!==context.atendimentoId||batch.scenarioId!==context.workspace.selectedId||!context.workspace.scenarios.some(s=>s.id===batch.scenarioId)||context.workspace.scenarios.some(s=>s.atendimentoId!==context.atendimentoId)||context.workspace.items.some(p=>p.atendimentoId!==context.atendimentoId))return failAll('CONTEXT_CONFLICT','Atendimento/cenário incompatível; nenhum destino inferido.')
 if(receipt){
  if(receipt.requestDigest!==requestDigest||receipt.scenarioId!==batch.scenarioId)return failAll('IDEMPOTENCY_CONFLICT','Chave já confirmada para outro conteúdo ou cenário.')
  plan.replay=true;plan.results=batch.commands.map((c,index)=>({index,commandId:commandId(c,index),status:receipt.handledCommandIds.includes(c?.id)?'noop':'pending',reason:receipt.handledCommandIds.includes(c?.id)?'ALREADY_HANDLED':'NOT_HANDLED_BY_RECEIPT'}));return plan
 }
 if(!sameRevisions(batch.expected,guards))return failAll('REVISION_CONFLICT','Composição, cenário, configuração ou peça mudou. Replaneje com estado confirmado.')
 const ids=context.catalog.map(c=>c.id),physical=context.workspace.items.map(p=>p.pieceId),lineIds=context.workspace.items.flatMap(p=>p.services.map(l=>l.id))
 if(new Set(ids).size!==ids.length||new Set(physical).size!==physical.length||new Set(lineIds).size!==lineIds.length)return failAll('INVALID_CONTEXT','Identidades duplicadas no estado; nenhuma correspondência arbitrária.')
 // A conflicting field invalidates both intentions; rebuild independent changes from the original.
 for(let pass=0;pass<=batch.commands.length;pass++){
  try{return buildPlan()}
  catch(error){if(!(error instanceof IntentConflict))throw error;for(const index of error.indexes)blocked.add(index);plan.issues.push({code:'INCOMPATIBLE_INTENTS',message:'Intenções incompatíveis sem correção explícita.',blocking:true,references:error.indexes.map(i=>batch.commands[i]!.id)})}
 }
 return failAll('INCOMPATIBLE_INTENTS','Não foi possível separar as intenções conflitantes.')

 function buildPlan():VoicePlan{
  const issues=[...plan.issues],results:VoiceResult[]=batch!.commands.map((c,index)=>{
   const reason=invalid.has(index)?'INVALID_COMMAND':blocked.has(index)?'INCOMPATIBLE_INTENTS':repeated.has(index)?'REPEATED_COMMAND':null
   return{index,commandId:commandId(c,index),status:invalid.has(index)?'pending':blocked.has(index)?'conflict':'noop',...(reason?{reason}:{})}
  })
  const w=context.workspace,sceneIds=w.scenarios.map(s=>s.id),selected=batch!.scenarioId,catalog=new Map(context.catalog.map(c=>[c.id,c]))
  const pieces=new Map<string,WorkingPiece>(w.items.map(p=>[p.pieceId,{id:p.id,pieceId:p.pieceId,diagnosisId:p.diagnosisId,intensity:p.intensity??null,notes:p.notes,services:structuredClone(p.services)}]))
  const refs=new Map<string,VoiceEntityReference>(w.items.flatMap(p=>[[p.id,{kind:'existing' as const,id:p.id}]as const,...p.services.map(l=>[l.id,{kind:'existing' as const,id:l.id}]as const)]))
  const plannedRef=(kind:'piece'|'service',command:string,ruleId?:string):VoiceEntityReference=>({kind:'planned',id:kind+':'+digest([requestDigest,command,ruleId??null])})
  const flags=new Map(w.scenarios.map(s=>[s.id,{piece:{...s.pieceFlags},service:{...s.serviceFlags}}]))
  const origins=new Map<string,VoiceChange['origins']>(),commandLines=new Map<string,{pieceId:string;id:string}>(),removedPieces=new Set<string>(),removedServices=new Set<string>(),removedLines=new Set<string>(),explicitServices=new Set<string>()
  // Removal snapshots retain identity, manual attributes and all scenario masks.
  const removedPieceValues=new Map<string,WorkingPiece>(),removedServiceValues=new Map<string,{pieceId:string;line:DiagnosisService}>(),unresolvedServicePieces=new Set<string>()
  const lineOrder=new Map(w.items.flatMap(p=>p.services.map((l,i)=>[l.id,i]as const)))
  const nextOrder=new Map(w.items.map(p=>[p.pieceId,p.services.length]))
  const writes=new Map<string,{value:unknown;indexes:number[];conflict:boolean}>(),diagnosisTriggers=new Map<string,number>(),usedRules:VoicePlan['usedRules']=[]
  let index=0
  const c=()=>batch!.commands[index]!
  const issue=(code:string,message:string,blocking=true,references?:string[])=>{issues.push({commandId:c().id,code,message,blocking,...(references?{references:[...references]}:{})});if(blocking){results[index]!.status='pending';results[index]!.reason=code}}
  const mark=(entity:string,field:keyof VoiceChange['origins'],origin:VoiceOrigin)=>{origins.set(entity,{...origins.get(entity),[field]:origin})}
  const write=(entity:string,field:keyof VoiceChange['origins'],value:unknown,current:unknown,sequential=false)=>{
   const key=entity+':'+field,old=writes.get(key)
   const relativeAmbiguity=Boolean(old?.conflict&&sequential),conflict=relativeAmbiguity||c().intent!=='correction'&&Boolean(old?.conflict||old&&!equal(old.value,value)&&!sequential)
   writes.set(key,{value,conflict,indexes:old?[...old.indexes,index]:[index]});if(!equal(current,value)||c().intent==='correction'&&origins.get(entity)?.[field]){mark(entity,field,explicit(c()));results[index]!.status='valid'}
  }
  const resolve=(r:VoiceReference,kind:CatalogItem['kind'],usable=false):CatalogItem|undefined=>{
   if(r.state==='unresolved'){issue('UNRESOLVED_REFERENCE',r.text||'Referência não identificada.',true,r.candidates);return}
   const item=catalog.get(r.id)
   if(!item||item.kind!==kind){issue('MISSING_REFERENCE','ID ausente ou tipo incompatível no catálogo.',true,[r.id]);return}
   if(usable&&!catalogItemUsable(item)){issue('INACTIVE_REFERENCE','Nova seleção exige item ativo e identificado.',true,[r.id]);return}
   return item
  }
  const line=(p:WorkingPiece,r:VoiceLineReference):DiagnosisService|undefined=>{
   let id:string|undefined
   if(r.kind==='id')id=r.id
   else if(r.kind==='command'){const target=commandLines.get(r.commandId);if(target?.pieceId===p.pieceId)id=target.id}
   else{
    const service=resolve(r.service,'servico');if(!service){unresolvedServicePieces.add(p.pieceId);return}
    explicitServices.add(p.pieceId+':'+service.id)
    const matches=p.services.filter(l=>l.serviceId===service.id)
    if(!matches.length&&c().op==='remove_service'){removedServices.add(p.pieceId+':'+service.id);results[index]!.reason='ALREADY_ABSENT';return}
    if(matches.length>1){issue('AMBIGUOUS_SERVICE_LINE','Informe o ID da linha: o serviço possui múltiplos lançamentos.',true,matches.map(l=>l.id));return}
    id=matches[0]?.id
   }
   const found=p.services.find(l=>l.id===id)
   if(!found)issue('LINE_NOT_FOUND','Linha ausente ou não pertence à peça indicada.',true,id?[id]:[])
   return found
  }
  const thirdParty=(l:DiagnosisService)=>{
   if(servicePolicy(l.serviceId)?.execution==='external_confirmation'&&flags.get(selected)!.service[l.id]&&w.scenarios.find(s=>s.id===selected)!.serviceConfirmations?.[l.id]!==executionScope(l))issue('THIRD_PARTY_CONFIRMATION_REQUIRED','A execução de terceiro exige confirmação oficial por linha/cenário.',false,[l.id])
  }
  const addLine=(p:WorkingPiece,serviceId:string,dimensionId:string|null,quantity:string,origin:VoiceOrigin,enabled:boolean,ruleId?:string)=>{
   if(p.services.length>=50){issue('SERVICE_LIMIT','A peça atingiria mais de 50 serviços.');return}
   const reference=plannedRef('service',c().id,ruleId),id='@voice:'+reference.id
   const l:DiagnosisService={id,serviceId,dimensionId,quantity,enabled,notes:'',diagnosisId:null,...(ruleId?{recommendationRuleId:ruleId}:{})}
   lineOrder.set(id,nextOrder.get(p.pieceId)??0);nextOrder.set(p.pieceId,(nextOrder.get(p.pieceId)??0)+1)
   p.services.push(l);refs.set(id,reference)
   const command=c()
   mark(id,'presence',origin);mark(id,'serviceId',origin);mark(id,'dimensionId',origin);mark(id,'quantity',origin.kind==='rule'||command.op==='add_service'&&command.quantity===undefined?{kind:'existing-default',commandId:c().id,rule:'initial-quantity-one'}:origin)
   mark(id,'enabled',origin)
   for(const scene of sceneIds)flags.get(scene)!.service[id]=scene===selected&&enabled
   results[index]!.status='valid';thirdParty(l)
   if(dimensionId===null)issue('DIMENSION_PENDING','Linha mantida como rascunho sem dimensão; nenhum valor calculado.',false,[serviceId])
   return l
  }
  for(index=0;index<batch!.commands.length;index++){
   if(invalid.has(index)||blocked.has(index)||repeated.has(index))continue
   const cmd=c(),physical=resolve(cmd.piece,'peca');if(!physical)continue
   let p=pieces.get(physical.id)
   if(cmd.op==='add_piece'){
    if(p)continue
    if(removedPieces.has(physical.id)){
     if(cmd.intent!=='correction'){issue('EXPLICIT_REMOVAL_PRESERVED','Uma remoção neste lote não será revertida implicitamente.');continue}
     const previous=removedPieceValues.get(physical.id)
     if(!previous){issue('RESTORATION_UNRESOLVED','Não há estado anterior seguro para restaurar a peça.');continue}
     pieces.set(physical.id,structuredClone(previous));removedPieces.delete(physical.id);removedPieceValues.delete(physical.id);mark(previous.id,'presence',explicit(cmd));results[index]!.status='valid';continue
    }
    if(!catalogItemUsable(physical)){issue('INACTIVE_REFERENCE','Peça nova exige código e cadastro ativo.');continue}
    const reference=plannedRef('piece',cmd.id),id='@voice:'+reference.id
    p={id,pieceId:physical.id,diagnosisId:null,intensity:null,notes:'',services:[]};pieces.set(physical.id,p);refs.set(id,reference);mark(id,'presence',explicit(cmd));mark(id,'pieceId',explicit(cmd));mark(id,'enabled',{kind:'existing-default',commandId:cmd.id,rule:'new-item-flags'})
    for(const scene of sceneIds)flags.get(scene)!.piece[id]=scene===selected
    results[index]!.status='valid';continue
   }
   if(cmd.op==='remove_piece'){
    removedPieces.add(physical.id)
    if(p){removedPieceValues.set(physical.id,structuredClone(p));pieces.delete(physical.id);mark(p.id,'presence',explicit(cmd));results[index]!.status='valid'}
    continue
   }
   if(!p){issue('PIECE_NOT_PRESENT','Inclua explicitamente a peça antes de alterar seu diagnóstico.');continue}
   switch(cmd.op){
    case'set_piece_enabled':write(p.id,'enabled',cmd.enabled,Boolean(flags.get(selected)!.piece[p.id]));flags.get(selected)!.piece[p.id]=cmd.enabled;break
    case'set_diagnosis':{
     if(cmd.additionalDamage){issue('MULTIPLE_DAMAGE_UNSUPPORTED','O modelo tem um diagnóstico/intensidade principal; não sobrescrever múltiplos danos.');break}
     const d=cmd.diagnosis===null?null:cmd.diagnosis===undefined?undefined:resolve(cmd.diagnosis,'diagnostico',cmd.diagnosis.state==='resolved'&&cmd.diagnosis.id!==p.diagnosisId)
     if(cmd.diagnosis!==undefined&&cmd.diagnosis!==null&&!d)break
     if(cmd.diagnosis!==undefined){write(p.id,'diagnosisId',d?.id??null,p.diagnosisId);p.diagnosisId=d?.id??null}
     if(cmd.intensity!==undefined){write(p.id,'intensity',cmd.intensity,p.intensity);p.intensity=cmd.intensity}
     diagnosisTriggers.set(p.pieceId,index);break
    }
    case'add_service':{
     const service=resolve(cmd.service,'servico');if(!service){unresolvedServicePieces.add(p.pieceId);break}
     const serviceKey=p.pieceId+':'+service.id
     explicitServices.add(serviceKey)
     const matches=p.services.filter(l=>l.serviceId===service.id)
     const restoring=removedServices.has(serviceKey)
     if(restoring&&cmd.intent!=='correction'){issue('EXPLICIT_REMOVAL_PRESERVED','Não recriar serviço removido no mesmo lote.');break}
     const removed=[...removedServiceValues.values()].filter(v=>v.pieceId===p.pieceId&&v.line.serviceId===service.id)
     if(restoring&&(removed.length!==1||matches.length)){
      issue('RESTORATION_UNRESOLVED','Restauração exige uma única linha anterior, sem lançamentos concorrentes.',true,removed.map(v=>v.line.id));break
     }
     if(matches.length>1){issue('AMBIGUOUS_SERVICE_LINE','Serviço repetido: escolha a linha exata.',true,matches.map(l=>l.id));break}
     const previous=restoring?removed[0]!.line:matches[0]
     if(cmd.dimension===undefined&&!previous){issue('RESTORATION_UNRESOLVED','Sem linha anterior não é possível preservar a dimensão.');break}
     const dimension=cmd.dimension===undefined?undefined:cmd.dimension===null?null:resolve(cmd.dimension,'dimensao',cmd.dimension.state==='resolved'&&cmd.dimension.id!==previous?.dimensionId)
     if(cmd.dimension!==undefined&&cmd.dimension!==null&&!dimension)break
     if(dimension&&dimension.serviceId!==service.id){issue('DIMENSION_SERVICE_MISMATCH','Dimensão não pertence ao serviço.',true,[dimension.id,service.id]);break}
     const dimensionId=cmd.dimension===undefined?previous!.dimensionId:dimension?.id??null
     if(restoring){
      const restored=structuredClone(previous!)
      if(cmd.dimension!==undefined){write(restored.id,'dimensionId',dimensionId,restored.dimensionId);restored.dimensionId=dimensionId}
      if(cmd.quantity!==undefined){const quantity=normalizedQuantity(cmd.quantity);write(restored.id,'quantity',quantity,restored.quantity);restored.quantity=quantity}
      p.services.push(restored);p.services.sort((a,b)=>lineOrder.get(a.id)!-lineOrder.get(b.id)!)
      removedServiceValues.delete(restored.id);removedLines.delete(restored.id);removedServices.delete(serviceKey)
      mark(restored.id,'presence',explicit(cmd));commandLines.set(cmd.id,{pieceId:p.pieceId,id:restored.id});results[index]!.status='valid';thirdParty(restored);break
     }
     if(previous){commandLines.set(cmd.id,{pieceId:p.pieceId,id:previous.id});if(previous.dimensionId!==dimensionId||(cmd.quantity!==undefined&&previous.quantity!==normalizedQuantity(cmd.quantity)))issue('EXISTING_SERVICE_DIFFERENT','Use uma correção direcionada para mudar dimensão/quantidade, sem duplicar o serviço.',true,[previous.id]);break}
     const policyIssue=newServiceSelectionIssue(service.id)
     if(policyIssue||!catalogItemUsable(service)){issue('CURATION_BLOCKED',policyIssue??'Serviço inativo.',true,[service.id]);break}
     const created=addLine(p,service.id,dimension?.id??null,normalizedQuantity(cmd.quantity??'1'),explicit(cmd),true)
     if(created)commandLines.set(cmd.id,{pieceId:p.pieceId,id:created.id});break
    }
    case'recommend_services':break // Evaluated after explicit instructions, using the final diagnosis.
    default:{
     if(cmd.op==='remove_service'&&cmd.line.kind==='id'&&removedLines.has(cmd.line.id)){results[index]!.reason='ALREADY_REMOVED';break}
     const target='line'in cmd&&cmd.line?line(p,cmd.line):undefined
     if('line'in cmd&&cmd.line&&!target){
      if(cmd.op==='remove_service'&&cmd.line.kind==='id'&&removedLines.has(cmd.line.id)){results[index]!.status='noop';results[index]!.reason='ALREADY_REMOVED'}
      break
     }
     if(cmd.op==='set_notes'){const entity=target??p;write(entity.id,'notes',cmd.value.trim(),entity.notes??'');entity.notes=cmd.value.trim();break}
     if(!target)break
     if(cmd.op==='remove_service'){removedServiceValues.set(target.id,{pieceId:p.pieceId,line:structuredClone(target)});p.services=p.services.filter(l=>l.id!==target.id);removedServices.add(p.pieceId+':'+target.serviceId);removedLines.add(target.id);mark(target.id,'presence',explicit(cmd));results[index]!.status='valid';break}
     if(cmd.op==='set_service_enabled'){write(target.id,'enabled',cmd.enabled,Boolean(flags.get(selected)!.service[target.id]));flags.get(selected)!.service[target.id]=cmd.enabled;thirdParty(target);break}
     if(cmd.op==='set_dimension'){
      const dimension=cmd.dimension===null?null:resolve(cmd.dimension,'dimensao',cmd.dimension.state==='resolved'&&cmd.dimension.id!==target.dimensionId)
      if(cmd.dimension!==null&&!dimension)break
      if(dimension&&dimension.serviceId!==target.serviceId){issue('DIMENSION_SERVICE_MISMATCH','Dimensão não pertence ao serviço.',true,[dimension.id,target.serviceId]);break}
      write(target.id,'dimensionId',dimension?.id??null,target.dimensionId);target.dimensionId=dimension?.id??null;thirdParty(target);break
     }
     if(cmd.op==='set_quantity'){
      if(cmd.mode==='increment'&&!voiceQuantity(target.quantity)){issue('INVALID_EXISTING_QUANTITY','Quantidade atual inválida; não incrementar por suposição.');break}
      const value=cmd.mode==='absolute'?normalizedQuantity(cmd.value):increment(target.quantity,cmd.value)
      if(!voiceQuantity(value)){issue('QUANTITY_LIMIT','Resultado excede o contrato de quantidade.');break}
      write(target.id,'quantity',value,target.quantity,cmd.mode==='increment');target.quantity=value;thirdParty(target)
     }
    }
   }
  }
  const incompatible=[...writes.values()].filter(v=>v.conflict)
  if(incompatible.length)throw new IntentConflict([...new Set(incompatible.flatMap(v=>v.indexes))])
  // The existing Phase 4 empty-piece gate also protects newly dictated manual lines.
  const recommend=(p:WorkingPiece,mode:'automatic'|'assisted',ruleIds?:string[],derived=false)=>{
   if(mode==='automatic'&&unresolvedServicePieces.has(p.pieceId)){issue('AUTOMATIC_RECOMMENDATIONS_SUSPENDED','Identidade de serviço explícito pendente; derivação automática suspensa somente nesta peça.',false,[p.pieceId]);return}
   const missing=(code:string,message:string)=>issue(code,message,!derived)
   if(!p.diagnosisId||!p.intensity){missing('RECOMMENDATION_CONTEXT_MISSING','Consulta exige diagnóstico e intensidade; regra sem intensidade não pode ser presumida.');return}
   const diagnosis=catalog.get(p.diagnosisId)
   if(!diagnosis||diagnosis.kind!=='diagnostico'||!catalogItemUsable(diagnosis)){missing('INACTIVE_REFERENCE','Recomendações exigem diagnóstico ativo e identificado.');return}
   const sets=context.recommendations.filter(s=>s.diagnosisId===p.diagnosisId&&s.intensity===p.intensity)
   if(sets.length!==1||sets[0]!.availability!=='available'){missing(sets.length>1?'AMBIGUOUS_RULE_SET':'RECOMMENDATIONS_UNAVAILABLE','Regras pertinentes não foram confirmadas/carregadas.');return}
   const set=sets[0]!
   if(set.pending?.length)issue('PENDING_RULES','Relações pendentes não serão utilizadas.',false,set.pending.map(r=>r.ruleId))
   if(!set.rules.length){issue('RECOMMENDATION_GAP','Nenhuma relação cadastrada para a combinação; não inventar serviços.',false);return}
   if(mode==='automatic'&&(p.services.length||w.components.some(part=>part.pieceId===p.id))){issue('ASSISTED_RECOMMENDATIONS_REQUIRED','Conteúdo existente preservado; inclusão assistida precisa de IDs de regras explícitos.',false,set.rules.map(r=>r.id));return}
   const chosen=mode==='assisted'?new Set(ruleIds):null
   if(chosen)for(const id of chosen)if(!set.rules.some(r=>r.id===id))issue('RULE_NOT_AVAILABLE','Regra solicitada não está disponível.',false,[id])
   const candidates=set.rules.filter(r=>!chosen||chosen.has(r.id)).sort(compareRecommendations)
   const eligible=candidates.filter(r=>{
    if(set.pending?.some(p=>p.ruleId===r.id)){issue('PENDING_RULE','Relação pendente não é recomendação válida.',false,[r.id]);return false}
    if(candidates.filter(v=>v.id===r.id).length>1){issue('DUPLICATE_RULE_ID','Identidade de regra repetida; não aplicar.',false,[r.id]);return false}
    const service=catalog.get(r.serviceId),dimension=catalog.get(r.dimensionId)
    if(!service||service.kind!=='servico'||!dimension||dimension.kind!=='dimensao'||dimension.serviceId!==service.id||!catalogItemUsable(service)||!catalogItemUsable(dimension)){issue('RULE_REFERENCE_INVALID','Referências da regra incompatíveis/inativas; não corrigir por aproximação.',false,[r.id]);return false}
    if(newServiceSelectionIssue(service.id)){issue('CURATION_BLOCKED','Regra retida pela curadoria vigente.',false,[r.id,service.id]);return false}
    return true
   })
   for(const r of eligible){
    const service=catalog.get(r.serviceId)!,dimension=catalog.get(r.dimensionId)!
    if(removedServices.has(p.pieceId+':'+service.id)){issue('EXPLICIT_REMOVAL_PRESERVED','Regra não desfaz exclusão explícita.',false,[r.id]);continue}
    if(p.services.some(l=>l.serviceId===service.id))continue
    if(explicitServices.has(p.pieceId+':'+service.id)){issue('EXPLICIT_SERVICE_INTENT_PENDING','Regra não substitui uma instrução explícita ainda pendente.',false,[r.id,service.id]);continue}
    if(eligible.filter(v=>v.serviceId===service.id).length>1){issue('AMBIGUOUS_RECOMMENDATION','Mais de uma dimensão/regra para o serviço; selecione explicitamente.',false,eligible.filter(v=>v.serviceId===service.id).map(v=>v.id));continue}
    const origin:VoiceOrigin={kind:'rule',commandId:c().id,ruleId:r.id}
    if(addLine(p,service.id,dimension.id,'1',origin,r.selectedByDefault,r.id))usedRules.push({id:r.id,commandId:c().id,serviceId:r.serviceId,dimensionId:r.dimensionId})
   }
  }
  for(const[physical,trigger]of diagnosisTriggers){
   const p=pieces.get(physical),before=w.items.find(p=>p.pieceId===physical)
   if(p&&(p.diagnosisId!==before?.diagnosisId||p.intensity!==(before?.intensity??null))){index=trigger;recommend(p,'automatic',undefined,true)}
  }
  for(index=0;index<batch!.commands.length;index++){
   if(invalid.has(index)||blocked.has(index)||repeated.has(index))continue
   const cmd=c();if(cmd.op!=='recommend_services')continue
   const physical=cmd.piece.state==='resolved'?cmd.piece.id:null,p=physical?pieces.get(physical):undefined
   if(p)recommend(p,cmd.mode,cmd.ruleIds)
  }
  const changes:VoiceChange[]=[],ref=(id:string)=>refs.get(id)!,impact=(scope:'shared'|'active-scenario',invalidates=false,removal=false)=>({scope,scenarioIds:scope==='shared'?[...sceneIds]:[selected],invalidatesExecutionConfirmations:invalidates,requiresGlobalRemovalConfirmation:removal})
  const base=(id:string,scope:'shared'|'active-scenario',invalidates=false,removal=false)=>({origins:origins.get(id)??{},impact:impact(scope,invalidates,removal)})
  const values=(p:WorkingPiece)=>({diagnosisId:p.diagnosisId,intensity:p.intensity,notes:p.notes})
  const serviceValues=(l:DiagnosisService)=>({serviceId:l.serviceId,dimensionId:l.dimensionId,quantity:l.quantity,notes:l.notes??'',diagnosisId:l.diagnosisId??null,...(l.recommendationRuleId?{recommendationRuleId:l.recommendationRuleId}:{})})
  function difference<T extends object>(before:T,after:T){const patch:Partial<T>={},old:Partial<T>={};for(const key of Object.keys(after)as(keyof T)[])if(!equal(before[key],after[key])){patch[key]=after[key];old[key]=before[key]}return{patch,before:old}}
  for(const old of w.items)if(!pieces.has(old.pieceId))changes.push({...base(old.id,'shared',true,true),op:'remove_piece',target:ref(old.id)})
  for(const p of pieces.values()){
   const old=w.items.find(v=>v.id===p.id)
   if(!old)changes.push({...base(p.id,'shared'),op:'add_piece',target:ref(p.id),pieceId:p.pieceId,values:values(p),flags:Object.fromEntries(sceneIds.map(id=>[id,Boolean(flags.get(id)!.piece[p.id])]))})
   else{
    const diff=difference(values({...old,intensity:old.intensity??null}),values(p));if(Object.keys(diff.patch).length)changes.push({...base(p.id,'shared'),op:'update_piece',target:ref(p.id),...diff})
    const before=Boolean(w.scenarios.find(s=>s.id===selected)!.pieceFlags[p.id]),enabled=Boolean(flags.get(selected)!.piece[p.id]);if(before!==enabled)changes.push({...base(p.id,'active-scenario',!enabled),op:'set_piece_enabled',target:ref(p.id),scenarioId:selected,before,enabled})
   }
   for(const removed of old?.services??[])if(!p.services.some(l=>l.id===removed.id))changes.push({...base(removed.id,'shared',true,true),op:'remove_service',target:ref(removed.id),piece:ref(p.id)})
   for(const l of p.services){
    const previous=old?.services.find(v=>v.id===l.id)
    if(!previous)changes.push({...base(l.id,'shared'),op:'add_service',target:ref(l.id),piece:ref(p.id),values:serviceValues(l),flags:Object.fromEntries(sceneIds.map(id=>[id,Boolean(flags.get(id)!.service[l.id])]))})
    else{
     const diff=difference(serviceValues(previous),serviceValues(l));if(Object.keys(diff.patch).length)changes.push({...base(l.id,'shared',executionScope(previous)!==executionScope(l)),op:'update_service',target:ref(l.id),piece:ref(p.id),...diff})
     const before=Boolean(w.scenarios.find(s=>s.id===selected)!.serviceFlags[l.id]),enabled=Boolean(flags.get(selected)!.service[l.id]);if(before!==enabled)changes.push({...base(l.id,'active-scenario',!enabled),op:'set_service_enabled',target:ref(l.id),scenarioId:selected,before,enabled})
    }
   }
  }
  for(const change of changes){
   const fields=change.op==='update_piece'||change.op==='update_service'?Object.keys(change.patch):change.op.startsWith('set_')?['enabled']:change.op.startsWith('remove_')?['presence']:Object.keys(change.origins)
   change.origins=Object.fromEntries(Object.entries(change.origins).filter(([field])=>fields.includes(field)))
  }
  const contributors=new Set(changes.flatMap(change=>Object.values(change.origins).filter(Boolean).map(origin=>origin!.commandId)))
  for(const result of results)if(result.status==='valid'&&!contributors.has(result.commandId)){result.status='noop';result.reason='NO_NET_CHANGE_OR_SUPERSEDED'}
  for(const change of changes)if(change.impact.requiresGlobalRemovalConfirmation)issues.push({code:'GLOBAL_REMOVAL_CONFIRMATION_REQUIRED',message:'Remoção compartilhada exige a confirmação já prevista no aplicativo; IA não concede autorização.',blocking:true,references:[change.target.id]})
  return{...plan,results,changes,issues,usedRules,replay:false,requiresCalculation:changes.length>0}
 }
}
