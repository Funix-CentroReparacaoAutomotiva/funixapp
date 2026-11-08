import type{DatabaseSync}from'node:sqlite'
import{AtendimentoRepository}from'./atendimentos.ts'
import{ComponentRepository}from'./components.ts'
import{selectedScenario}from'./scenarios.ts'
import{ServiceError}from'./errors.ts'
import{saneQuoteQuery}from'./component-quote-query.ts'

// No free-form query, client vehicle data, or notes are accepted. Quote only a
// committed component owned by the requested Atendimento and a real scenario.
export function readSavedComponentQuoteContext(db:DatabaseSync,at:string,id:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ServiceError(400,'QUOTE_INPUT','Consulta inválida.')
 const b=input as Record<string,unknown>
 if(Object.keys(b).length!==2||typeof b.scenarioId!=='string'||!b.scenarioId||b.scenarioId.length>100||!Number.isSafeInteger(b.componentRevision)||(b.componentRevision as number)<1)throw new ServiceError(400,'QUOTE_INPUT','Consulta inválida.')
 const scenario=b.scenarioId as string
 const vehicle=new AtendimentoRepository(db).get(at)
 selectedScenario(db,at,scenario)
 const component=new ComponentRepository(db).list(at).find(c=>c.id===id)
 if(!component)throw new ServiceError(404,'QUOTE_CONTEXT_MISSING','Componente não encontrado neste Atendimento.')
 if(component.revision!==b.componentRevision)throw new ServiceError(409,'QUOTE_CONTEXT_STALE','Componente alterado. Confira a versão salva.')
 const row=db.prepare("SELECT p.id AS diagnosis_id,c.name AS parent FROM diagnosis_items p JOIN catalog_items c ON c.id=p.piece_id AND c.kind='peca' WHERE p.id=? AND p.atendimento_id=?").get(component.pieceId,at)
 if(!row||typeof row.parent!=='string')throw new ServiceError(409,'QUOTE_CONTEXT_STALE','Peça vinculada indisponível.')
 const parent=String(row.parent)
 const query=saneQuoteQuery({brand:vehicle.brand,model:vehicle.model,vehicle:vehicle.vehicle,component:component.name,parent})
 return{query,revalidate:()=>{
  const fresh=new AtendimentoRepository(db).get(at)
  selectedScenario(db,at,scenario)
  const current=new ComponentRepository(db).list(at).find(c=>c.id===id)
  const piece=db.prepare("SELECT p.id AS diagnosis_id,c.name AS parent FROM diagnosis_items p JOIN catalog_items c ON c.id=p.piece_id AND c.kind='peca' WHERE p.id=? AND p.atendimento_id=?").get(component.pieceId,at)
  if(fresh.revision!==vehicle.revision||!current||current.revision!==component.revision||current.name!==component.name||current.pieceId!==component.pieceId||!piece||piece.parent!==parent)throw new ServiceError(409,'QUOTE_CONTEXT_STALE','Dados alterados durante a pesquisa; consulte novamente.')
 }}
}
