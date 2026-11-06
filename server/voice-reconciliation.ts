import {createHash} from 'node:crypto'
import type {VoiceCommand,VoiceCommandBatch,VoicePlanningContext} from '../shared/voice-commands.ts'
import {catalogItemUsable} from '../shared/commercial.ts'
import {validateVoiceCommands,normalizedQuantity} from './voice-command-validation.ts'

// This projection is rebuilt from trusted source intentions after every decision.
// It emits only existing native operations; the planner remains the authority.
export function reconcileVoiceServices(source:VoiceCommandBatch,ctx:VoicePlanningContext,bindings:Record<string,string>,transcription:string){
 const invalid=new Set(validateVoiceCommands(source).invalidIndexes),owners=new Map(source.commands.map(c=>[c.id,c.id]))
 const rows=new Map<string,string>(),extra=new Set<string>(),commands:VoiceCommand[]=[]
 const additional=/\b(outr[ao]|mais um(?:a)?|linha adicional|outro lancamento|duplique|duplicar|repita|repetir)\b/.test(transcription.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase())
 for(const [index,c]of source.commands.entries()){
  const pieceId=c.piece.state==='resolved'?c.piece.id:undefined
  const piece=ctx.workspace.items.find(p=>p.pieceId===pieceId)
  const matches=c.op==='add_service'&&c.service.state==='resolved'?piece?.services.filter(l=>l.serviceId===(c.service as {id:string}).id)??[]:[]
  const removed=source.commands.some(other=>other.piece.state==='resolved'&&other.piece.id===pieceId&&(other.op==='remove_piece'||other.op==='remove_service'))
  if(c.op!=='add_service'||!piece||!matches.length||removed||invalid.has(index)) {commands.push(structuredClone(c));continue}
  if(additional){
   extra.add(c.id)
   commands.push({...c,service:{state:'unresolved',text:'Linha adicional: refaça o ditado para identificar a intenção.',candidates:[]}})
   continue
  }
  const previous=bindings[c.id]?matches.find(l=>l.id===bindings[c.id]):matches.length===1?matches[0]:undefined
  if(!previous){commands.push(structuredClone(c));continue}
  if(c.dimension){
   const dimension=c.dimension.state==='resolved'?ctx.catalog.find(d=>d.id===(c.dimension as {id:string}).id):undefined
   if(!dimension||dimension.kind!=='dimensao'||dimension.serviceId!==previous.serviceId||dimension.id!==previous.dimensionId&&!catalogItemUsable(dimension)){commands.push(structuredClone(c));continue}
  }
  rows.set(c.id,previous.id)
  // Null/omitted dimension from an inclusion preserves the existing dimension.
  // A directed set_dimension null continues to mean explicit clearing.
  commands.push({id:c.id,op:'set_dimension',intent:c.intent,piece:c.piece,line:{kind:'id',id:previous.id},dimension:c.dimension??(previous.dimensionId?{state:'resolved',id:previous.dimensionId}:null)})
  if(c.quantity!==undefined&&normalizedQuantity(c.quantity)!==previous.quantity){
   let counter=0,id:string
   do{id='quantity:'+createHash('sha256').update(JSON.stringify([c.id,counter++])).digest('hex')}while(source.commands.some(other=>other.id===id))
   owners.set(id,c.id)
   commands.push({id,op:'set_quantity',intent:c.intent,piece:c.piece,line:{kind:'id',id:previous.id},mode:'absolute',value:c.quantity})
  }
 }
 // References to an earlier service command must retain its real existing line.
 for(const c of commands)if('line'in c&&c.line?.kind==='command'&&rows.has(c.line.commandId)){
  const commandId=c.line.commandId
  const original=source.commands.findIndex(previous=>previous.id===commandId)
  const current=source.commands.findIndex(current=>current.id===c.id)
  const previous=source.commands[original]
  if(original<current&&previous?.piece.state==='resolved'&&c.piece.state==='resolved'&&previous.piece.id===c.piece.id)c.line={kind:'id',id:rows.get(c.line.commandId)!}
 }
 // Splitting never expands an accepted batch past the application contract.
 if(commands.length>100)return {limited:true,batch:source,owners:new Map(source.commands.map(c=>[c.id,c.id])),rows:new Map<string,string>(),extra:new Set<string>()}
 return {limited:false,batch:{...source,commands},owners,rows,extra}
}
