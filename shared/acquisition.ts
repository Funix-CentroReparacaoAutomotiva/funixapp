import type {WorkOrderScope} from './work-order.ts'

export const acquisitionStatuses = ['identified','requested','approved','received'] as const
export type AcquisitionStatus = typeof acquisitionStatuses[number]
export type ComponentCustody = 'stored'|'out'
export const acquisitionLabels: Record<AcquisitionStatus,string> = {
  identified:'Identificado',requested:'Solicitado',approved:'Aprovado',received:'Recebido',
}
export const custodyLabels: Record<ComponentCustody,string> = {stored:'Armazenado',out:'Saiu'}
export const acquisitionOrigins = ['FUNIX','Cliente','Seguradora','Associação','Estoque próprio','Outro'] as const
export type AcquisitionComponent = {
  experienceId:string; atendimentoId:string; budgetVersionId:string; budgetNumber:string
  orderId:string|null; orderNumber:string|null; lineId:string; code:string; name:string; pieceName:string
  quantity:string; vehicle:string; plate:string; status:AcquisitionStatus; origin:string
  statusUpdatedAt:string; custody:ComponentCustody|null; custodyUpdatedAt:string|null
  revision:number; cancelled:boolean
}

export function orderPieceLetter(index:number):string {
  let text=''
  for(let n=index+1;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text
  return text
}

/** Canonical first-seen grouping: the OS PDF and the component view use exactly this order. */
export function orderPieces(scope:WorkOrderScope) {
  const pieces=new Map<string,{diag?:WorkOrderScope['diagnostics'][number];items:WorkOrderScope['lines']}>()
  for(const diag of scope.diagnostics) if(!pieces.has(diag.pieceId))pieces.set(diag.pieceId,{diag,items:[]})
  for(const line of scope.lines) {
    let piece=pieces.get(line.pieceId)
    if(!piece){piece={items:[]};pieces.set(line.pieceId,piece)}
    piece.items.push(line)
  }
  return [...pieces.values()].map((piece,index)=>({...piece,symbol:orderPieceLetter(index)}))
}

export function orderComponents(scope:WorkOrderScope) {
  return orderPieces(scope).flatMap(({items,symbol})=>items.filter(item=>item.kind==='component')
    .map((item,index)=>({...item,code:symbol+(index+1)})))
}
