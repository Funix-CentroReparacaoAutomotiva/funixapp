// Direction 2026-11-17: operational optical restoration sequence only.
import {codaServiceId} from './commercial-curation.ts'
import type {BudgetSnapshot} from './pricing.ts'
import type {WorkOrderLine,WorkOrderScope} from './work-order.ts'

export const OPTICAL_SERVICE_ID=codaServiceId('i-MMsEFTPdow')
export const OPTICAL_DIMENSION_ID='coda:2zsjI-nqWr:grid-7521QzZOVd:i-psjAH4rJ5N'
const LEGACY_RELATION='coda:2zsjI-nqWr:grid-p-wZJbfjUD:i-7W5F-LUwBk'

const approvedStages=():WorkOrderLine['stages']=>[
 {name:'Lixamento',dimension:'Peça',cluster:'Preparação técnica'},
 {name:'Envernização',dimension:'Peça',cluster:'Pintura e acabamento'},
 {name:'Polimento',dimension:'Peça',cluster:'Estética e revitalização'}
]

/** Exact frozen service/dimension identity, not a display-name match.
 * Only missing or the single verified legacy relation can be corrected.
 * No live catalog, financial energy, price, or excluded lines are changed.
 */
export function correctOpticalWorkOrderScope(scope:WorkOrderScope,snapshot:BudgetSnapshot):WorkOrderScope|null{
 let changed=false
 const lines=scope.lines.map(line=>{
  if(line.kind!=='service')return line
  const frozen=snapshot.calculation.lines.find(l=>l.id===line.id&&l.pieceId===line.pieceId&&l.included&&l.kind==='service')
  const source=snapshot.composition.items.find(i=>i.id===line.pieceId)?.services.find(s=>s.id===line.id)
  if(!frozen||source?.serviceId!==OPTICAL_SERVICE_ID||source.dimensionId!==OPTICAL_DIMENSION_ID)return line
  const legacy=frozen.stages.length===1&&frozen.stages[0]!.id===LEGACY_RELATION&&line.stages.length===1&&line.stages[0]!.name===frozen.stages[0]!.name
  if(line.stages.length&&!legacy)return line
  changed=true
  return {...line,stages:approvedStages()}
 })
 return changed?{...scope,lines}:null
}
