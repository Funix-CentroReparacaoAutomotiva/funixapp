import type{DatabaseSync}from'node:sqlite'
import{readVoiceResolution}from'./voice-resolution.ts'
import{AtendimentoRepository}from'./atendimentos.ts'
import{ServiceError}from'./errors.ts'
import{saneQuoteQuery}from'./component-quote-query.ts'
// Request carries server-issued references only; no client-composed search query.
export function readQuoteContext(db:DatabaseSync,at:string,input:unknown,session:string){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ServiceError(400,'QUOTE_INPUT','Consulta inválida.')
 const b=input as Record<string,unknown>,keys=['scenarioId','resolutionId','commandId']
 if(Object.keys(b).length!==3||keys.some(k=>typeof b[k]!=='string'||!(b[k] as string).length||(b[k] as string).length>100))throw new ServiceError(400,'QUOTE_INPUT','Consulta inválida.')
 const {stored,ctx}=readVoiceResolution(db,at,b.scenarioId as string,b.resolutionId as string,session)
 const command=stored.source.commands.find(c=>c.id===b.commandId)
 if(!command||command.op!=='add_component')throw new ServiceError(400,'QUOTE_INPUT','Componente inválido.')
 const parent=command.piece.state==='resolved'?ctx.catalog.find(c=>c.id===(command.piece as {id:string}).id)?.name:null
 const vehicle=new AtendimentoRepository(db).get(at)
 const query=parent?saneQuoteQuery({brand:vehicle.brand,model:vehicle.model,vehicle:vehicle.vehicle,component:command.name,parent}):null
 // Call again after awaiting external work: all guards/session must still match.
 return{query,revalidate:()=>{
  const current=readVoiceResolution(db,at,b.scenarioId as string,b.resolutionId as string,session)
  const fresh=new AtendimentoRepository(db).get(at)
  if(current.stored.id!==stored.id||fresh.revision!==vehicle.revision)throw new ServiceError(409,'QUOTE_CONTEXT_STALE','Dados alterados; consulte novamente.')
 }}
}
