import {Q,ZERO,sum} from './exact.ts'

// Inputs are already technically reviewed alternatives priced by the native
// engine, not source hours, inferred intensity or a new pricing table.
export type CiliaReviewedOption={optionId:string;rowId:string;serviceId:string;dimensionId:string|null;gross:string;discountable:boolean}
export type CiliaReviewedGroup={rowId:string;sourceTotal:string;options:readonly CiliaReviewedOption[]}
const bad=():never=>{throw new Error('CILIA_RECONCILIATION_INVALID_INPUT')}
function decimal(v:string){
 if(typeof v!=='string'||!/^\d{1,24}(?:\.\d{1,18})?$/.test(v))return bad()
 const [w,f='']=v.split('.')
 return new Q(BigInt(w+f),10n**BigInt(f.length))
}
const cents=(q:Q)=>q.mul(new Q(100n)).d===1n
const compareId=(a:string,b:string)=>a<b?-1:a>b?1:0
const min=(xs:Q[])=>xs.reduce((a,b)=>a.cmp(b)<=0?a:b)
const max=(xs:Q[])=>xs.reduce((a,b)=>a.cmp(b)>=0?a:b)

/** Finds the closest *reviewed* combination by sum of absolute deviations
 * from external group values, then by smallest eligible global discount.
 * No result is offered as optimal or ready when the search is incomplete.
 * The first supported Cilia profile has no source labor discount/adjustment.
 */
export function chooseCiliaReviewedCombination(targetNet:string,groups:readonly CiliaReviewedGroup[],limit=20000){
 const target=decimal(targetNet)
 if(!cents(target)||!Number.isSafeInteger(limit)||limit<1||limit>100000||groups.length<1||groups.length>100)return bad()
 const rowIds=new Set<string>(),optionIds=new Set<string>()
 const reviewed=groups.map(g=>{
  if(!g.rowId||rowIds.has(g.rowId)||g.options.length<1||g.options.length>20)return bad()
  rowIds.add(g.rowId)
  const amount=decimal(g.sourceTotal)
  if(!cents(amount))return bad()
  const options=g.options.map(o=>{
   if(o.rowId!==g.rowId||!o.optionId||optionIds.has(o.optionId)||!o.serviceId||!o.dimensionId||typeof o.discountable!=='boolean')return bad()
   optionIds.add(o.optionId)
   const gross=decimal(o.gross)
   return {option:o,gross,deviation:gross.sub(amount).abs(),protected:o.discountable?ZERO:gross}
  }).sort((a,b)=>a.deviation.cmp(b.deviation)||a.gross.cmp(b.gross)||compareId(a.option.optionId,b.option.optionId))
  return {rowId:g.rowId,amount,options}
 }).sort((a,b)=>compareId(a.rowId,b.rowId))
 if(sum(reviewed.map(g=>g.amount)).cmp(target)!==0)return bad()
 // Safe optimistic bounds; pruning cannot remove an improved feasible plan.
 const bounds=[{deviation:ZERO,grossMin:ZERO,grossMax:ZERO,protectedMin:ZERO}]
 for(let i=reviewed.length-1;i>=0;i--){
  const o=reviewed[i]!.options,b=bounds[0]!
  bounds.unshift({deviation:b.deviation.add(min(o.map(x=>x.deviation))),grossMin:b.grossMin.add(min(o.map(x=>x.gross))),grossMax:b.grossMax.add(max(o.map(x=>x.gross))),protectedMin:b.protectedMin.add(min(o.map(x=>x.protected)))})
 }
 type Match={options:CiliaReviewedOption[];gross:Q;discount:Q;eligible:Q;deviation:Q}
 let best:Match|null=null,visited=0,bounded=false
 const selected:CiliaReviewedOption[]=[]
 function visit(i:number,gross:Q,protectedGross:Q,deviation:Q){
  if(bounded)return
  if(++visited>limit){bounded=true;return}
  const b=bounds[i]!,lower=deviation.add(b.deviation)
  if(gross.add(b.grossMax).cmp(target)<0||protectedGross.add(b.protectedMin).cmp(target)>0)return
  if(best&&(lower.cmp(best.deviation)>0||(lower.cmp(best.deviation)===0&&gross.add(b.grossMin).cmp(best.gross)>=0)))return
  if(i===reviewed.length){
   const discount=gross.sub(target),eligible=gross.sub(protectedGross)
   if(discount.n<0n||discount.cmp(eligible)>0||!cents(discount))return
   if(!best||deviation.cmp(best.deviation)<0||(deviation.cmp(best.deviation)===0&&gross.cmp(best.gross)<0))best={options:[...selected],gross,discount,eligible,deviation}
   return
  }
  for(const o of reviewed[i]!.options){
   selected.push(o.option);visit(i+1,gross.add(o.gross),protectedGross.add(o.protected),deviation.add(o.deviation));selected.pop()
   if(bounded)return
  }
 }
 visit(0,ZERO,ZERO,ZERO)
 const result=best as Match|null
 return {state:bounded?'search-limit' as const:result?'matched' as const:'no-match' as const,exhaustive:!bounded,visited:Math.min(visited,limit),match:!bounded&&result?{options:result.options,gross:result.gross.toString(),discount:result.discount.toString(),eligible:result.eligible.toString(),net:target.toString(),deviation:result.deviation.toString()}:null}
}

type DimensionCatalogEntry={id:string;kind:string;name:string;active:boolean;serviceId:string|null}
/** Lists possible active catalog dimensions. They are NOT equivalent or
 * reviewed options yet. No automatic selection, quantity, pricing or write. */
export function listCiliaDimensionCandidates(serviceId:string,catalog:readonly DimensionCatalogEntry[]){
 const matches=catalog.filter(x=>x.id===serviceId)
 if(matches.length!==1||matches[0]!.kind!=='servico'||!matches[0]!.active||!matches[0]!.name.trim())return []
 const counts=new Map<string,number>()
 for(const c of catalog)counts.set(c.id,(counts.get(c.id)??0)+1)
 return catalog.filter(x=>x.kind==='dimensao'&&x.active&&x.serviceId===serviceId&&!!x.id.trim()&&!!x.name.trim()&&counts.get(x.id)===1)
  .map(x=>({dimensionId:x.id,name:x.name,requiresTechnicalReview:true as const})).sort((a,b)=>compareId(a.dimensionId,b.dimensionId))
}
