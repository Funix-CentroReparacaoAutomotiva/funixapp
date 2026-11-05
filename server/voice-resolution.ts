import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {CatalogItem} from '../shared/commercial.ts'
import {catalogItemUsable} from '../shared/commercial.ts'
import {newServiceSelectionIssue} from '../shared/commercial-curation.ts'
import type {VoiceCommand,VoiceCommandBatch,VoicePlanningContext,VoiceReference} from '../shared/voice-commands.ts'
import type {VoiceInterpretation} from '../shared/voice-input.ts'
import {hierarchyPiecePairs} from './hierarchy.ts'
import {ServiceError} from './errors.ts'
import {readVoiceContext} from './voice-context.ts'
import {planVoiceCommands,voiceContextDigest} from './voice-planner.ts'
import {stageVoiceBatch,discardVoiceBatch} from './voice-apply.ts'
import {compactVoiceReview} from './voice-review-summary.ts'
import {voiceReview} from './voice-review.ts'

type Slot='piece'|'service'|'lineService'|'dimension'|'diagnosis'|'line'
type Target={id:string;key:string;label:string;text:string;kind:CatalogItem['kind']|'line';slots:{index:number;slot:Slot}[]}
type Choice={id:string;label:string;values:string[];speech:string[];target:Target}
type Stored={id:string;batch:VoiceCommandBatch;transcription:string;digest:string;session:string;expires:number;targets:Target[];choices:Choice[]}
const stores=new WeakMap<DatabaseSync,Map<string,Stored>>()
const normalize=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const expired=()=>new ServiceError(409,'VOICE_PLAN_EXPIRED','Revisão expirada ou substituída. Refaça o ditado.')
const invalid=()=>new ServiceError(400,'VOICE_RESOLUTION_INVALID','Selecione uma opção emitida para esta revisão.')
const matches=(text:string,item:CatalogItem)=>{const words=normalize(item.name+' '+(item.code??'')).split(' ');return normalize(text).split(' ').every(w=>words.includes(w))}
const resolved=(id:string)=>({state:'resolved' as const,id})
const pairCodes=hierarchyPiecePairs()
function mapFor(db:DatabaseSync){let map=stores.get(db);if(!map){map=new Map();stores.set(db,map)}for(const [id,s]of map)if(s.expires<=Date.now())map.delete(id);return map}

function targetsFor(batch:VoiceCommandBatch,ctx:VoicePlanningContext):Target[]{
 const targets=new Map<string,Target>()
 const needsChoice=(ref:VoiceReference,kind:CatalogItem['kind'])=>ref.state==='unresolved'||!ctx.catalog.some(c=>c.id===ref.id&&c.kind===kind&&catalogItemUsable(c))
 const textFor=(ref:VoiceReference)=>ref.state==='unresolved'?ref.text:ctx.catalog.find(c=>c.id===ref.id)?.name??''
 const add=(index:number,slot:Slot,kind:Target['kind'],text:string,scope:string)=>{
  const key=slot+':'+scope+':'+normalize(text),old=targets.get(key)
  if(old){old.slots.push({index,slot});return}
  targets.set(key,{id:randomUUID(),key,label:kind==='peca'?'Peça':kind==='servico'?'Serviço':kind==='dimensao'?'Dimensão':kind==='diagnostico'?'Diagnóstico':'Linha',kind,text,slots:[{index,slot}]})
 }
 batch.commands.forEach((c,index)=>{
  const existingPiece=c.piece.state==='resolved'&&ctx.catalog.some(item=>item.id===(c.piece as {id:string}).id&&item.kind==='peca')&&ctx.workspace.items.some(item=>item.pieceId===(c.piece as {id:string}).id)
  if(needsChoice(c.piece,'peca')&&!existingPiece){add(index,'piece','peca',textFor(c.piece),'');return}
  if(c.piece.state!=='resolved')return
  const piece=c.piece.id
  if(c.op==='add_service'){
   if(needsChoice(c.service,'servico')){add(index,'service','servico',textFor(c.service),piece);return}
   if(c.service.state!=='resolved')return
   if(c.dimension&&needsChoice(c.dimension,'dimensao'))add(index,'dimension','dimensao',textFor(c.dimension),piece+':'+c.service.id)
   // A null dimension is a legal incomplete draft, not an invented reference.
   if(c.dimension===null)add(index,'dimension','dimensao','',piece+':'+c.service.id)
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
   if(c.op==='set_dimension'&&c.dimension&&needsChoice(c.dimension,'dimensao'))add(index,'dimension','dimensao',textFor(c.dimension),piece+':'+JSON.stringify(c.line))
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
function choicesFor(target:Target,batch:VoiceCommandBatch,ctx:VoicePlanningContext,query=target.text):Choice[]{
 const commands=target.slots.map(s=>batch.commands[s.index]!)
 const catalog=new Map(ctx.catalog.map(c=>[c.id,c]))
 const make=(label:string,values:string[],speech:string[]=[label]):Choice=>({id:randomUUID(),label,values,speech,target})
 if(target.kind==='line'){
  const c=commands[0]!,pieceId=c.piece.state==='resolved'?c.piece.id:'',piece=ctx.workspace.items.find(p=>p.pieceId===pieceId)
  return (piece?.services??[]).flatMap((line,index)=>{
   const item=catalog.get(line.serviceId)
   if(!item||!catalogItemUsable(item)||target.text&&line.serviceId!==target.text)return[]
   const label='Linha '+(index+1)+' · '+(catalog.get(line.dimensionId??'')?.name??'sem dimensão')+' · qtd. '+line.quantity
   return [make(label,[line.id],['linha '+(index+1),label])]
  })
 }
 const lookup=target.kind==='peca'?normalize(query).replace(/\b(ambos|os dois)( os)?( lados)?\b/g,'').trim():query
 const candidates=ctx.catalog.filter(item=>item.kind===target.kind&&catalogItemUsable(item)&&(lookup.trim()?matches(lookup,item):target.kind==='dimensao')&&
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
 // Collapse dependent failures for the same ambiguous piece into one actionable row.
 for(const target of stored.targets){
  const ids=new Set(target.slots.map(s=>stored.batch.commands[s.index]!.id)),options=stored.choices.filter(c=>c.target===target).map(c=>({id:c.id,label:c.label}))
  let attached=false
  for(const group of groups){
   group.entries=group.entries.filter(entry=>{
    if(!entry.commandId||!ids.has(entry.commandId)||entry.kind!=='pending'&&entry.kind!=='warning')return true
    if(attached&&target.kind==='peca')return false
    if(!attached){entry.pendingId=target.id;entry.options=options;entry.label=target.label;entry.warning=target.kind==='peca'?(options.length?'Escolha a peça para continuar.':'Sem correspondência confiável. Fale o nome exato do cadastro.'):(target.text?target.text+' — conferir.':'Escolha uma dimensão ou mantenha o rascunho incompleto.');attached=true}
    return true
   })
  }
 }
 if(plan.changes.length)stageVoiceBatch(db,stored.batch,plan.stateDigest,plan.requestDigest,stored.session,stored.expires)
 return {requestId,transcription:stored.transcription,plan,review:voiceReview(plan,ctx),reviewGroups:groups,applied:false,
  resolution:{id:stored.id,questions:stored.targets.map(t=>({id:t.id,label:t.label,options:stored.choices.filter(c=>c.target===t).map(c=>({id:c.id,label:c.label}))}))}}
}
function build(db:DatabaseSync,batch:VoiceCommandBatch,transcription:string,ctx:VoicePlanningContext,session:string,requestId:string,expires=Date.now()+15*60_000):VoiceInterpretation{
 const map=mapFor(db);if(map.size>=100)map.delete(map.keys().next().value!)
 const plan=planVoiceCommands(batch,ctx),pending=new Set(plan.results.filter(r=>r.status==='pending'||r.status==='conflict').map(r=>r.index))
 for(const issue of plan.issues)if(issue.code==='DIMENSION_PENDING')batch.commands.forEach((c,index)=>{if(c.id===issue.commandId)pending.add(index)})
 const targets=targetsFor(batch,ctx).map(t=>({...t,slots:t.slots.filter(s=>pending.has(s.index))})).filter(t=>t.slots.length),stored:Stored={id:randomUUID(),batch:structuredClone(batch),transcription,digest:voiceContextDigest(ctx),session,expires,targets,choices:[]}
 stored.choices=targets.flatMap(t=>choicesFor(t,stored.batch,ctx));map.set(stored.id,stored)
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
 const commands=structuredClone(stored.batch.commands),target=choice.target
 if(choice.values.length===1){
  for(const {index,slot}of target.slots){
   const c=commands[index]!,id=choice.values[0]!
   if(slot==='line'&&'line'in c)c.line={kind:'id',id}
   else if(slot==='piece')c.piece=resolved(id)
   else if(slot==='service'&&c.op==='add_service')c.service=resolved(id)
   else if(slot==='lineService'&&'line'in c)c.line={kind:'service',service:resolved(id)}
   else if(slot==='dimension'&&(c.op==='add_service'||c.op==='set_dimension'))c.dimension=resolved(id)
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
 const batch={...stored.batch,idempotencyKey:randomUUID(),commands}
 // A selection supersedes the old staged plan. Old HTTP requests cannot apply another version.
 const result=build(db,batch,stored.transcription,ctx,stored.session,requestId,stored.expires)
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
 const text=normalize(speech)
 let choices=stored.choices.filter(c=>c.target===target&&[c.label,...c.speech].some(s=>normalize(s)===text))
 if(!choices.length&&target.kind!=='line')choices=choicesFor(target,stored.batch,ctx,speech).filter(c=>c.values.length===1&&ctx.catalog.some(item=>item.id===c.values[0]&&normalize(item.name)===text))
 if(choices.length!==1)throw new ServiceError(422,'VOICE_CLARIFICATION_PENDING','Não foi possível identificar uma única opção. Diga somente uma opção ou o nome exato do cadastro; o plano anterior foi preservado.')
 return select(db,stored,ctx,choices[0]!,requestId)
}
