import {createHash,randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {CatalogItem} from '../shared/commercial.ts'
import {catalogItemUsable} from '../shared/commercial.ts'
import {newServiceSelectionIssue} from '../shared/commercial-curation.ts'
import type {VoiceCommand,VoiceCommandBatch,VoicePlanningContext,VoiceReference,VoicePlan} from '../shared/voice-commands.ts'
import type {VoiceInterpretation} from '../shared/voice-input.ts'
import {hierarchyPiecePairs} from './hierarchy.ts'
import {ServiceError} from './errors.ts'
import {readVoiceContext} from './voice-context.ts'
import {planVoiceCommands,voiceContextDigest} from './voice-planner.ts'
import {stageVoiceBatch,discardVoiceBatch} from './voice-apply.ts'
import {compactVoiceReview} from './voice-review-summary.ts'
import {voiceReview} from './voice-review.ts'
import {reconcileVoiceServices} from './voice-reconciliation.ts'
import {voiceDiagnostic} from './voice-diagnostic.ts'
import {componentDecimal} from '../shared/voice-components.ts'
import {voiceQuantity,normalizedQuantity,validateVoiceCommands} from './voice-command-validation.ts'

type Slot='piece'|'service'|'lineService'|'dimension'|'diagnosis'|'line'|'serviceLine'|'adjustment'|'quantity'|'componentDuplicate'
type Target={id:string;key:string;label:string;text:string;kind:CatalogItem['kind']|'line'|'adjustment'|'quantity'|'component';slots:{index:number;slot:Slot}[]}
type Choice={id:string;label:string;values:string[];speech:string[];target:Target;quantity?:string;componentDecision?:{mode:'keep'|'new';references:string[]}}
type Stored={id:string;batch:VoiceCommandBatch;source:VoiceCommandBatch;interpreted:VoiceCommand[];bindings:Record<string,string>;owners:Map<string,string>;additionalIds:string[];limited:boolean;transcription:string;digest:string;session:string;expires:number;dependencyIds:string[];targets:Target[];choices:Choice[]}
const stores=new WeakMap<DatabaseSync,Map<string,Stored>>()
const normalize=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const expired=()=>new ServiceError(409,'VOICE_PLAN_EXPIRED','Revisão expirada ou substituída. Refaça o ditado.')
const invalid=()=>new ServiceError(400,'VOICE_RESOLUTION_INVALID','Selecione uma opção emitida para esta revisão.')
const matches=(text:string,item:CatalogItem)=>{const words=normalize(item.name+' '+(item.code??'')).split(' ');return normalize(text).split(' ').every(w=>words.includes(w))}
const resolved=(id:string)=>({state:'resolved' as const,id})
const pairCodes=hierarchyPiecePairs()
function mapFor(db:DatabaseSync){let map=stores.get(db);if(!map){map=new Map();stores.set(db,map)}for(const [id,s]of map)if(s.expires<=Date.now())map.delete(id);return map}

function targetsFor(batch:VoiceCommandBatch,ctx:VoicePlanningContext,bindings:Record<string,string>):Target[]{
 const targets=new Map<string,Target>()
 const needsChoice=(ref:VoiceReference,kind:CatalogItem['kind'])=>ref.state==='unresolved'||!ctx.catalog.some(c=>c.id===ref.id&&c.kind===kind&&catalogItemUsable(c))
 const textFor=(ref:VoiceReference)=>ref.state==='unresolved'?ref.text:ctx.catalog.find(c=>c.id===ref.id)?.name??''
 const add=(index:number,slot:Slot,kind:Target['kind'],text:string,scope:string)=>{
  const key=slot+':'+scope+':'+normalize(text),old=targets.get(key)
  if(old){old.slots.push({index,slot});return}
  targets.set(key,{id:randomUUID(),key,label:kind==='peca'?'Peça':kind==='servico'?'Serviço':kind==='dimensao'?'Dimensão':kind==='diagnostico'?'Diagnóstico':kind==='adjustment'?'Corrigir serviço':kind==='quantity'?'Quantidade':'Linha',kind,text,slots:[{index,slot}]})
 }
 batch.commands.forEach((c,index)=>{
  const existingPiece=c.piece.state==='resolved'&&ctx.catalog.some(item=>item.id===(c.piece as {id:string}).id&&item.kind==='peca')&&ctx.workspace.items.some(item=>item.pieceId===(c.piece as {id:string}).id)
  if(needsChoice(c.piece,'peca')&&!existingPiece){add(index,'piece','peca',textFor(c.piece),'');return}
  if(c.piece.state!=='resolved')return
  const piece=c.piece.id
  if(c.op==='add_service'){
   if(needsChoice(c.service,'servico')){add(index,'service','servico',textFor(c.service),piece);return}
   if(c.service.state!=='resolved')return
   const rows=ctx.workspace.items.find(p=>p.pieceId===piece)?.services.filter(l=>l.serviceId===(c.service as {id:string}).id)??[]
   if(rows.length>1&&!bindings[c.id]){add(index,'serviceLine','line',c.service.id,piece);return}
   if(c.dimension&&needsChoice(c.dimension,'dimensao'))add(index,'dimension','dimensao',textFor(c.dimension),piece+':'+c.service.id)
   else if(c.dimension!==null&&(rows.length||c.dimension?.state==='resolved'&&ctx.catalog.find(d=>d.id===(c.dimension as {id:string}).id)?.serviceId!==c.service.id))add(index,'adjustment','adjustment','',piece+':'+c.service.id)
   // A null dimension is a legal incomplete draft, not an invented reference.
   if(c.dimension===null)add(index,rows.length?'adjustment':'dimension',rows.length?'adjustment':'dimensao','',piece+':'+c.service.id)
  }
  if(c.op==='set_diagnosis'&&c.diagnosis&&needsChoice(c.diagnosis,'diagnostico'))add(index,'diagnosis','diagnostico',textFor(c.diagnosis),piece)
  if('line'in c&&c.line){
   if(c.line.kind==='service'){
    if(needsChoice(c.line.service,'servico')){add(index,'lineService','servico',textFor(c.line.service),piece);return}
    if(c.line.service.state!=='resolved')return
    const id=c.line.service.id,rows=ctx.workspace.items.find(p=>p.pieceId===piece)?.services.filter(l=>l.serviceId===id)??[]
    if(rows.length!==1){add(index,'line','line',id,piece);return}
   }
   if(c.line.kind==='id'&&!ctx.workspace.items.find(p=>p.pieceId===piece)?.services.some(l=>l.id===(c.line as {id:string}).id)){
    add(index,'line','line','',piece);return
   }
   if(c.line.kind==='command'&&!batch.commands.some(previous=>previous.id===(c.line as {commandId:string}).commandId&&previous.op==='add_service'&&previous.piece.state==='resolved'&&previous.piece.id===piece)){add(index,'line','line','',piece);return}
   if(c.op==='set_quantity')add(index,'quantity','quantity','',piece+':'+JSON.stringify(c.line))
   if(c.op==='set_dimension')add(index,'dimension','dimensao',c.dimension&&needsChoice(c.dimension,'dimensao')?textFor(c.dimension):'',piece+':'+JSON.stringify(c.line))
  }
 })
 return [...targets.values()]
}
function serviceFor(c:VoiceCommand,ctx:VoicePlanningContext,batch:VoiceCommandBatch):string|undefined{
 if(c.op==='add_service')return c.service.state==='resolved'?c.service.id:undefined
 if(!('line'in c)||!c.line||c.piece.state!=='resolved')return
 const pieceId=c.piece.id,rows=ctx.workspace.items.find(p=>p.pieceId===pieceId)?.services??[]
 if(c.line.kind==='id')return rows.find(l=>l.id===(c.line as {id:string}).id)?.serviceId
 if(c.line.kind==='service')return c.line.service.state==='resolved'?c.line.service.id:undefined
 const id=c.line.commandId,previous=batch.commands.find(cmd=>cmd.id===id)
 return previous?.op==='add_service'&&previous.piece.state==='resolved'&&previous.piece.id===pieceId&&previous.service.state==='resolved'?previous.service.id:undefined
}
function choicesFor(target:Target,batch:VoiceCommandBatch,ctx:VoicePlanningContext,query=target.text,plan?:VoicePlan):Choice[]{
 const commands=target.slots.map(s=>batch.commands[s.index]!)
 const catalog=new Map(ctx.catalog.map(c=>[c.id,c]))
 const make=(label:string,values:string[],speech:string[]=[label]):Choice=>({id:randomUUID(),label,values,speech,target})
 if(target.kind==='component'){
  const command=commands[0]!
  const issue=plan?.issues.find(i=>i.commandId===command.id&&i.code==='DUPLICATE_COMPONENT')
  if(!issue?.references?.length)return[]
  return (['keep','new'] as const).map(mode=>({...make(mode==='keep'?'Manter existente':'Adicionar outro', ['component-decision']),componentDecision:{mode,references:issue.references!}}))
 }
 if(target.kind==='quantity')return[]
 if(target.kind==='line'){
  const c=commands[0]!,pieceId=c.piece.state==='resolved'?c.piece.id:'',piece=ctx.workspace.items.find(p=>p.pieceId===pieceId)
  return (piece?.services??[]).flatMap((line,index)=>{
   const item=catalog.get(line.serviceId)
   if(!item||!catalogItemUsable(item)||target.text&&line.serviceId!==target.text)return[]
   const label='Linha '+(index+1)+' · '+(catalog.get(line.dimensionId??'')?.name??'sem dimensão')+' · qtd. '+line.quantity
   return [make(label,[line.id],['linha '+(index+1),label])]
  })
 }
 const kind=target.kind==='adjustment'?'dimensao':target.kind
 const lookup=target.kind==='peca'?normalize(query).replace(/\b(ambos|os dois)( os)?( lados)?\b/g,'').trim():query
 const candidates=ctx.catalog.filter(item=>item.kind===kind&&catalogItemUsable(item)&&(lookup.trim()?matches(lookup,item):kind==='dimensao')&&
  (item.kind!=='servico'||!newServiceSelectionIssue(item.id))&&commands.every(c=>{
   if(item.kind==='dimensao')return item.serviceId===serviceFor(c,ctx,batch)
   if(item.kind==='servico'){
    if(c.op==='add_service'&&c.dimension?.state==='resolved')return catalog.get(c.dimension.id)?.serviceId===item.id
    if('line'in c&&c.piece.state==='resolved')return ctx.workspace.items.find(p=>p.pieceId===(c.piece as {id:string}).id)?.services.some(l=>l.serviceId===item.id)
   }
   return true
  })).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))
 const pair=target.kind==='peca'&&candidates.length===2&&pairCodes.some(codes=>codes.every(code=>candidates.some(c=>c.code===code)))
 const distinct=candidates.filter(item=>item.kind==='peca'||candidates.filter(c=>normalize(c.name)===normalize(item.name)).length===1)
 const choices=distinct.map(item=>make(pair&&(item.side==='motorista'||item.side==='passageiro')?item.side==='motorista'?'Motorista':'Passageiro':item.name+(item.kind==='peca'&&candidates.filter(c=>normalize(c.name)===normalize(item.name)).length>1?' · '+item.code:''),[item.id],[item.name,...(pair?[item.side,'lado do '+item.side]:[])]))
 // Expanding line IDs or references to commands outside this piece would invent a binding.
 const indices=new Set(target.slots.map(s=>s.index)),commandIds=new Set([...indices].map(i=>batch.commands[i]!.id))
 const canExpand=commands.every(c=>!('line'in c)||!c.line||c.line.kind==='service'||c.line.kind==='command'&&commandIds.has(c.line.commandId))&&
  !batch.commands.some((c,i)=>!indices.has(i)&&'line'in c&&c.line?.kind==='command'&&commandIds.has(c.line.commandId))&&batch.commands.length+indices.size<=100
 if(pair&&canExpand)choices.push(make('Ambos',candidates.map(c=>c.id),['ambos','os dois','ambos os lados']))
 return choices
}
function present(db:DatabaseSync,stored:Stored,ctx:VoicePlanningContext,requestId:string):VoiceInterpretation{
 const plan=planVoiceCommands(stored.batch,ctx),groups=compactVoiceReview(plan,ctx,stored.batch.commands)
 for(const group of groups)for(const entry of group.entries)if(entry.commandId)entry.commandId=stored.owners.get(entry.commandId)??entry.commandId
 for(const target of stored.targets){
  const ids=new Set(target.slots.map(s=>stored.source.commands[s.index]!.id)),options=stored.choices.filter(c=>c.target===target).map(c=>({id:c.id,label:c.label}))
  let attached=false
  for(const group of groups){
   group.entries=group.entries.filter(entry=>{
    if(!entry.commandId||!ids.has(entry.commandId))return true
    if(target.kind!=='adjustment'&&target.kind!=='quantity'&&entry.kind!=='pending'&&entry.kind!=='warning')return true
    if(attached&&target.kind==='peca')return false
    if(!attached){
     entry.pendingId=target.id;entry.options=options
     if(target.kind==='component'){
      const references=stored.choices.find(c=>c.target===target)?.componentDecision?.references??[]
      entry.fields=references.slice(0,3).flatMap(reference=>{
       const existing=ctx.workspace.components.find(c=>c.id===reference),prior=stored.source.commands.find(c=>'command:'+c.id===reference)
       if(existing)return [{label:'Já cadastrado',after:existing.name+' · qtd. '+existing.quantity+' · preço unitário '+(existing.manualPrice===null?'não informado':'R$ '+existing.manualPrice.replace('.',','))}]
       if(prior?.op==='add_component')return [{label:'Neste ditado',after:prior.name+' · qtd. '+(prior.quantity??'1')+' · R$ '+(prior.manualPrice??'0').replace('.',',')}]
       return[]
      })
      if(references.length>3)entry.fields.push({label:'Semelhantes',after:String(references.length)})
     }
     if(target.kind!=='adjustment'&&target.kind!=='quantity'&&target.kind!=='component')entry.label=target.label
     entry.warning=target.kind==='peca'?(options.length?'Escolha a peça para continuar.':'Sem correspondência confiável. Fale o nome exato do cadastro.'):target.kind==='adjustment'?'Para corrigir, escolha a dimensão ou diga serviço e dimensão; para quantidade, diga “quantidade 2”.':target.kind==='quantity'?'Diga “quantidade 2” para informar o total desejado.':target.kind==='component'?'Possível duplicata: manter não altera o existente; adicionar cria um novo lançamento.':target.kind==='line'?'Escolha a linha já cadastrada.':(target.text?target.text+' — conferir.':'Escolha uma dimensão ou mantenha o rascunho incompleto.')
     attached=true
    }
    return true
   })
  }
  if(!attached&&(target.kind==='adjustment'||target.kind==='quantity')){
   const command=stored.source.commands[target.slots[0]!.index]!,piece=command.piece.state==='resolved'?ctx.catalog.find(c=>c.id===(command.piece as {id:string}).id):undefined
   const serviceId=serviceFor(command,ctx,stored.source),service=ctx.catalog.find(c=>c.id===serviceId)
   let group=groups.find(g=>g.id===piece?.id)
   if(!group){group={id:piece?.id??'review',piece:piece?.name??'Conferir',entries:[]};groups.push(group)}
   const rows=ctx.workspace.items.find(p=>p.pieceId===piece?.id)?.services.filter(l=>l.serviceId===serviceId)??[]
   const row=stored.bindings[command.id]?rows.find(l=>l.id===stored.bindings[command.id]):rows.length===1?rows[0]:undefined
   const fields=row?[{label:'Dimensão',after:ctx.catalog.find(c=>c.id===row.dimensionId)?.name??'Não informada'},{label:'Qtd.',after:row.quantity}]:[]
   group.entries.push({commandId:command.id,kind:'noop',scope:'shared',label:service?.name??'Quantidade',fields,warning:'Já está assim. Você pode corrigir a dimensão ou quantidade.',pendingId:target.id,options})
  }
 }
 for(const group of groups)for(const entry of group.entries)if(entry.kind==='pending'&&!entry.pendingId){if(stored.limited)entry.warning='Pedido grande demais para uma revisão segura. Divida em ditados menores.';else if(stored.additionalIds.includes(entry.commandId??''))entry.warning='Linha adicional não confirmada. Use o editor de serviços para adicionar um lançamento repetido; a linha existente foi preservada.';entry.warning=(entry.warning??'Confira o pedido.')+' Use Novo ditado para continuar.'}
 if(plan.changes.length)stageVoiceBatch(db,stored.batch,plan.stateDigest,plan.requestDigest,stored.session,stored.expires)
 for(const result of plan.results)if(result.reason==='COMPONENT_KEPT'){const c=stored.source.commands.find(c=>c.id===result.commandId);if(c?.op==='add_component'&&c.piece.state==='resolved'){const pieceId=c.piece.id;let group=groups.find(g=>g.id===pieceId);if(!group){group={id:pieceId,piece:ctx.catalog.find(p=>p.id===pieceId)?.name??'Peça',entries:[]};groups.push(group)}group.entries.push({kind:'noop',scope:'shared',label:c.name,fields:[],warning:'Componente existente mantido; quantidade e preço não foram alterados.'})}}
 const pending=plan.results.filter(r=>r.status==='pending'||r.status==='conflict').length
 const diagnostic=voiceDiagnostic(stored.interpreted,stored.source.commands,plan,ctx,stored.owners)
 const decisions=[
  ...stored.source.commands.flatMap((c,index)=>stored.batch.commands.some(e=>e.id===c.id&&c.op==='add_service'&&e.op==='set_dimension')?[{code:'EXISTING_LINE_RECONCILED',command:index+1}]:[]),
  ...stored.additionalIds.map(id=>({code:'ADDITIONAL_LINE_REQUIRES_EDITOR',command:stored.source.commands.findIndex(c=>c.id===id)+1})),
  ...(stored.limited?[{code:'NATIVE_OPERATION_LIMIT'}]:[]),
  ...stored.source.commands.flatMap((c,index)=>c.op==='add_component'&&c.duplicateDecision?[{code:c.duplicateDecision.mode==='keep'?'COMPONENT_DUPLICATE_KEPT':'COMPONENT_DUPLICATE_NEW',command:index+1}]:[])
 ]
 diagnostic.decisions=decisions.map(d=>d.code+('command'in d?' · comando #'+d.command:' · dividir o ditado'))
 diagnostic.technical!.decisions=decisions
 return {requestId,transcription:stored.transcription,plan,review:voiceReview(plan,ctx),reviewGroups:groups,applied:false,
  diagnostic:diagnostic,
  outcome:{kind:plan.changes.length?'review':!stored.source.commands.length?'empty':pending?'pending':'unchanged',pending,changes:plan.changes.length,message:plan.changes.length?pending?'Somente as alterações listadas serão aplicadas. Pendências ficam de fora.':'Confira as alterações antes de aplicar.':!stored.source.commands.length?'Nenhum comando reconhecido. Use Novo ditado.':pending?'Nenhuma alteração segura. Resolva as pendências ou use Novo ditado.':plan.results.some(r=>r.reason==='COMPONENT_KEPT')?'Nenhuma inclusão. Componentes existentes foram mantidos.':'Já está assim. Nenhuma alteração para aplicar.'},
  resolution:{id:stored.id,questions:stored.targets.map(t=>({id:t.id,label:t.label,options:stored.choices.filter(c=>c.target===t).map(c=>({id:c.id,label:c.label}))}))}}
}
// Add only the physical prerequisite of a validated, effective service inclusion.
// Existing explicit add/remove intentions and original command order remain authoritative.
function servicePieceDependencies(batch:VoiceCommandBatch,ctx:VoicePlanningContext,previousIds:string[]){
 const previous=new Set(previousIds),commands=batch.commands.filter(c=>!previous.has(c.id))
 const invalid=new Set(validateVoiceCommands({...batch,commands}).invalidIndexes)
 const catalog=new Map(ctx.catalog.map(c=>[c.id,c])),present=new Set(ctx.workspace.items.map(p=>p.pieceId))
 const explicit=new Set(commands.flatMap(c=>(c.op==='add_piece'||c.op==='remove_piece')&&c.piece.state==='resolved'?[c.piece.id]:[]))
 const candidates=new Map<string,{index:number;command:VoiceCommand}>(),servicePieces=new Map<string,string>()
 for(const [index,c]of commands.entries()){
  if(invalid.has(index)||(c.op!=='add_service'&&c.op!=='add_component')||c.piece.state!=='resolved'||present.has(c.piece.id)||explicit.has(c.piece.id))continue
  const piece=catalog.get(c.piece.id)
  if(!piece||piece.kind!=='peca'||!catalogItemUsable(piece))continue
  if(c.op==='add_service'){
  if(c.service.state!=='resolved')continue
  const service=catalog.get(c.service.id)
  if(!piece||piece.kind!=='peca'||!catalogItemUsable(piece)||!service||service.kind!=='servico'||!catalogItemUsable(service)||newServiceSelectionIssue(service.id))continue
  if(c.dimension!==null){
   if(c.dimension?.state!=='resolved')continue
   const dimension=catalog.get(c.dimension.id)
   if(!dimension||dimension.kind!=='dimensao'||!catalogItemUsable(dimension)||dimension.serviceId!==service.id)continue
  }
  }
  servicePieces.set(c.id,piece.id)
  if(candidates.has(piece.id))continue
  let counter=0,id:string
  do{id='service-piece:'+createHash('sha256').update(JSON.stringify([batch.idempotencyKey,piece.id,counter++])).digest('hex')}while(commands.some(c=>c.id===id))
  candidates.set(piece.id,{index,command:{id,op:'add_piece',intent:'instruction',piece:resolved(piece.id)}})
 }
 const base={...batch,commands}
 if(!candidates.size||commands.length+candidates.size>100)return {batch:base,dependencyIds:[]}
 const inject=(allowed:Set<string>)=>commands.flatMap((c,index)=>[...Array.from(candidates).filter(([piece,value])=>allowed.has(piece)&&value.index===index).map(([,value])=>value.command),c])
 const probe=planVoiceCommands({...base,commands:inject(new Set(candidates.keys()))},ctx)
 const valid=new Set(probe.results.filter(r=>r.status==='valid').map(r=>r.commandId)),supported=new Set<string>()
 for(const change of probe.changes){
  const origin=change.origins.presence
  if((change.op==='add_service'||change.op==='add_component')&&origin?.kind==='explicit'&&valid.has(origin.commandId)&&servicePieces.has(origin.commandId))supported.add(servicePieces.get(origin.commandId)!)
 }
 // No empty piece for an invalid, cancelled or conflicting service instruction.
 return {batch:{...base,commands:inject(supported)},dependencyIds:[...candidates].filter(([piece])=>supported.has(piece)).map(([,value])=>value.command.id)}
}
function build(db:DatabaseSync,source:VoiceCommandBatch,transcription:string,ctx:VoicePlanningContext,session:string,requestId:string,expires=Date.now()+15*60_000,bindings:Record<string,string>={},interpreted:VoiceCommand[]=source.commands):VoiceInterpretation{
 const reconciled=reconcileVoiceServices(source,ctx,bindings,transcription)
 const prepared=servicePieceDependencies(reconciled.batch,ctx,[]),batch=prepared.batch
 const map=mapFor(db);if(map.size>=100)map.delete(map.keys().next().value!)
 const plan=planVoiceCommands(batch,ctx),pending=new Set(plan.results.filter(r=>r.status==='pending'||r.status==='conflict').map(r=>reconciled.owners.get(r.commandId)??r.commandId))
 for(const issue of plan.issues)if(issue.code==='DIMENSION_PENDING')pending.add(reconciled.owners.get(issue.commandId??'')??issue.commandId??'')
 const targets=targetsFor(source,ctx,bindings).map(t=>({...t,slots:t.slots.filter(s=>{
  const c=source.commands[s.index]!
  if(reconciled.limited||reconciled.extra.has(c.id))return false
  const results=plan.results.filter(r=>(reconciled.owners.get(r.commandId)??r.commandId)===c.id)
  if(results.some(r=>r.reason==='MULTIPLE_DAMAGE_UNSUPPORTED'||r.reason==='PIECE_NOT_PRESENT'&&c.op!=='add_service'&&t.kind!=='peca'))return false
  if(source.commands.some(other=>other.piece.state==='resolved'&&c.piece.state==='resolved'&&other.piece.id===c.piece.id&&(other.op==='remove_piece'||other.op==='remove_service'))&&c.op!=='remove_piece'&&c.op!=='remove_service')return false
  if(t.kind==='adjustment'||t.kind==='quantity')return !plan.results.some(r=>(reconciled.owners.get(r.commandId)??r.commandId)===c.id&&(r.status==='conflict'||['PIECE_NOT_PRESENT','EXPLICIT_REMOVAL_PRESERVED','RESTORATION_UNRESOLVED','LINE_NOT_FOUND'].includes(r.reason??'')))
  return pending.has(c.id)
 })})).filter(t=>t.slots.length).sort((a,b)=>Number(b.slots.some(s=>pending.has(source.commands[s.index]!.id)))-Number(a.slots.some(s=>pending.has(source.commands[s.index]!.id))))
 for(const issue of plan.issues)if(issue.code==='DUPLICATE_COMPONENT'){
  const index=source.commands.findIndex(c=>c.id===issue.commandId)
  if(index>=0&&(issue.references?.length??0)<=200)targets.push({id:randomUUID(),key:'component:'+issue.commandId,label:'Componente já cadastrado?',text:'',kind:'component',slots:[{index,slot:'componentDuplicate'}]})
 }
 const stored:Stored={id:randomUUID(),batch:structuredClone(batch),source:structuredClone(source),interpreted:structuredClone(interpreted),bindings,owners:reconciled.owners,additionalIds:[...reconciled.extra],limited:reconciled.limited,transcription,digest:voiceContextDigest(ctx),session,expires,dependencyIds:prepared.dependencyIds,targets,choices:[]}
 stored.choices=targets.flatMap(t=>choicesFor(t,stored.source,ctx,t.text,plan))
 // A line with no real options cannot accept speech. Unknown catalog names can
 // still be clarified by an exact active name; dimensions stay service-bound.
 stored.targets=targets.filter(t=>t.kind==='line'?stored.choices.some(c=>c.target===t):t.kind==='dimensao'?choicesFor(t,stored.source,ctx,'').length>0:true)
 stored.choices=stored.choices.filter(c=>stored.targets.includes(c.target));map.set(stored.id,stored)
 return present(db,stored,ctx,requestId)
}
export function stageVoiceResolution(db:DatabaseSync,batch:VoiceCommandBatch,transcription:string,ctx:VoicePlanningContext,session:string,requestId:string){return build(db,batch,transcription,ctx,session,requestId)}
export function readVoiceResolution(db:DatabaseSync,at:string,scene:string,id:string,session:string){
 const stored=mapFor(db).get(id)
 if(!stored||stored.session!==session||stored.batch.atendimentoId!==at||stored.batch.scenarioId!==scene||stored.expires<=Date.now())throw expired()
 const ctx=readVoiceContext(db,at,scene)
 if(voiceContextDigest(ctx)!==stored.digest||db.prepare('SELECT 1 FROM voice_apply_receipts WHERE atendimento_id=? AND idempotency_key=?').get(at,stored.batch.idempotencyKey))throw new ServiceError(409,'VOICE_CONTEXT_STALE','Os dados mudaram. Refaça o ditado; nenhuma resolução foi aplicada.')
 return {stored,ctx}
}
function select(db:DatabaseSync,stored:Stored,ctx:VoicePlanningContext,choice:Choice,requestId:string){
 const commands=structuredClone(stored.source.commands),bindings={...stored.bindings},target=choice.target
 if(choice.values.length===1){
  for(const {index,slot}of target.slots){
   const c=commands[index]!,id=choice.values[0]!
   if(choice.componentDecision&&c.op==='add_component')c.duplicateDecision=choice.componentDecision
   else if(choice.quantity!==undefined){
    if(c.op==='add_service')c.quantity=choice.quantity
    else if(c.op==='set_quantity'){c.value=choice.quantity;c.mode='absolute'}
    else throw invalid()
   }
   else if(slot==='serviceLine'&&c.op==='add_service')bindings[c.id]=id
   else if(slot==='line'&&'line'in c)c.line={kind:'id',id}
   else if(slot==='piece')c.piece=resolved(id)
   else if(slot==='service'&&c.op==='add_service')c.service=resolved(id)
   else if(slot==='lineService'&&'line'in c)c.line={kind:'service',service:resolved(id)}
   else if((slot==='dimension'||slot==='adjustment')&&(c.op==='add_service'||c.op==='set_dimension'))c.dimension=resolved(id)
   else if(slot==='diagnosis'&&c.op==='set_diagnosis')c.diagnosis=resolved(id)
   else throw invalid()
  }
 }else{
  if(target.kind!=='peca'||choice.values.length!==2)throw invalid()
  const indices=new Set(target.slots.map(s=>s.index)),ids=new Map<string,string>()
  for(const index of indices)for(const piece of choice.values)ids.set(commands[index]!.id+':'+piece,randomUUID())
  const expanded=commands.flatMap((c,index)=>!indices.has(index)?[c]:choice.values.map(piece=>{
   const copy=structuredClone(c);copy.id=ids.get(c.id+':'+piece)!;copy.piece=resolved(piece)
   if('line'in copy&&copy.line?.kind==='command')copy.line.commandId=ids.get(copy.line.commandId+':'+piece)!
   return copy
  }));commands.splice(0,commands.length,...expanded)
 }
 const batch={...stored.source,idempotencyKey:randomUUID(),commands}
 // A selection supersedes the old staged plan. Old HTTP requests cannot apply another version.
 const result=build(db,batch,stored.transcription,ctx,stored.session,requestId,stored.expires,bindings,stored.interpreted)
 discardVoiceBatch(db,stored.batch.atendimentoId,stored.batch.idempotencyKey)
 mapFor(db).delete(stored.id)
 return result
}
export function resolveVoiceOption(db:DatabaseSync,at:string,input:unknown,session:string,requestId:string){
 if(!input||typeof input!=='object'||Array.isArray(input))throw invalid()
 const body=input as Record<string,unknown>
 if(Object.keys(body).some(k=>!['resolutionId','scenarioId','optionId'].includes(k))||!['resolutionId','scenarioId','optionId'].every(k=>typeof body[k]==='string'&&(body[k] as string).length<=100))throw invalid()
 const {stored,ctx}=readVoiceResolution(db,at,body.scenarioId as string,body.resolutionId as string,session)
 const choice=stored.choices.find(c=>c.id===body.optionId)
 if(!choice)throw invalid()
 return select(db,stored,ctx,choice,requestId)
}
export function clarifyVoiceResolution(db:DatabaseSync,at:string,scene:string,id:string,questionId:string,speech:string,session:string,requestId:string){
 const {stored,ctx}=readVoiceResolution(db,at,scene,id,session),target=stored.targets.find(t=>t.id===questionId)
 if(!target)throw invalid()
 if(/[-−+]\s*\d/.test(speech))throw new ServiceError(422,'VOICE_CLARIFICATION_PENDING','Informe somente uma dimensão ou quantidade positiva verificada.')
 const text=normalize(speech)
 if(target.kind==='adjustment'||target.kind==='quantity'||target.kind==='dimensao'){
  const commands=target.slots.map(s=>stored.source.commands[s.index]!),service=serviceFor(commands[0]!,ctx,stored.source)
  const name=normalize(ctx.catalog.find(c=>c.id===service)?.name??'')
  const prefixes=['',...(name?[name+' ','corrige '+name+' para ','corrigir '+name+' para ']:[])]
  const numbers:Record<string,string>={um:'1',uma:'1',dois:'2',duas:'2',tres:'3',quatro:'4',cinco:'5',seis:'6',sete:'7',oito:'8',nove:'9',dez:'10'}
  const quantity=prefixes.flatMap(prefix=>text.startsWith(prefix)?[text.slice(prefix.length).match(/^(?:quantidade|qtd)(?: para)? (\d+(?: [0-9]+)?|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)(?: unidades?)?$/)?.[1]]:[]).filter((v):v is string=>Boolean(v)).map(v=>numbers[v]??v.replace(' ','.'))
  if(target.kind!=='dimensao'&&quantity.length===1&&voiceQuantity(quantity[0]))return select(db,stored,ctx,{id:randomUUID(),label:'Quantidade',values:['quantity'],speech:[],target,quantity:normalizedQuantity(quantity[0])},requestId)
  if(target.kind==='adjustment'||target.kind==='dimensao'){
   const choices=choicesFor(target,stored.source,ctx,'').filter(c=>prefixes.some(prefix=>text===prefix+normalize(c.label)))
   if(choices.length===1)return select(db,stored,ctx,choices[0]!,requestId)
  }
 }
 let choices=stored.choices.filter(c=>c.target===target&&[c.label,...c.speech].some(s=>normalize(s)===text))
 if(!choices.length&&target.kind!=='line'&&target.kind!=='quantity'&&target.kind!=='adjustment'&&target.kind!=='component')choices=choicesFor(target,stored.source,ctx,speech).filter(c=>c.values.length===1&&ctx.catalog.some(item=>item.id===c.values[0]&&normalize(item.name)===text))
 if(choices.length!==1)throw new ServiceError(422,'VOICE_CLARIFICATION_PENDING','Não foi possível identificar uma única opção. Diga somente uma opção ou o nome exato do cadastro; o plano anterior foi preservado.')
 return select(db,stored,ctx,choices[0]!,requestId)
}

// Edits affect only a component command in the server-held review, never a row.
export function reviseVoiceComponent(db:DatabaseSync,at:string,input:unknown,session:string,requestId:string){
 if(!input||typeof input!=='object'||Array.isArray(input))throw invalid()
 const body=input as Record<string,unknown>
 if(Object.keys(body).some(k=>!['scenarioId','resolutionId','commandId','quantity','manualPrice'].includes(k))||!['scenarioId','resolutionId','commandId'].every(k=>typeof body[k]==='string'&&(body[k] as string).length>0&&(body[k] as string).length<=100)||!componentDecimal(body.quantity,true)||!componentDecimal(body.manualPrice))throw new ServiceError(400,'VOICE_COMPONENT_VALUES_INVALID','Use quantidade positiva e preço não negativo, com até 12 dígitos e 6 casas decimais.')
 const {stored,ctx}=readVoiceResolution(db,at,body.scenarioId as string,body.resolutionId as string,session)
 const source=structuredClone(stored.source),command=source.commands.find(c=>c.id===body.commandId)
 if(!command||command.op!=='add_component')throw invalid()
 command.quantity=body.quantity;command.manualPrice=body.manualPrice;source.idempotencyKey=randomUUID()
 const result=build(db,source,stored.transcription,ctx,stored.session,requestId,stored.expires,stored.bindings,stored.interpreted)
 discardVoiceBatch(db,at,stored.batch.idempotencyKey);mapFor(db).delete(stored.id)
 return result
}
