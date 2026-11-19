import {Q,ZERO,sum} from './exact.ts'
import {resolveMR} from '../shared/mr.ts'
import type {PricingConfig,PricingSettings,Calculation} from '../shared/pricing.ts'
import type {HistoricalBudgetPackage} from './historical-budget-preflight.ts'

function decimal(s:string):Q{
  if(!/^\d{1,24}(?:\.\d{1,18})?$/.test(s))throw Error('HISTORICAL_RECONCILIATION_INVALID_DECIMAL')
  const [w,f='']=s.split('.')
  return new Q(BigInt(w+f),10n**BigInt(f.length))
}
function eq(a:Q,b:Q){return a.cmp(b)===0}
function cents(q:Q){return q.mul(new Q(100n)).d===1n}
/** Reverse the existing ceiling-to-five-cents rule. Prefer two-decimal
 * manual inputs, then up to six decimals accepted by ComponentRepository.
 * Derived manual price is a reconstruction parameter, never verified cost.
 */
export function deriveHistoricalManualPrice(unitSale:string,factor:string):string|null{
  const target=decimal(unitSale),mr=decimal(factor)
  if(mr.n<=0n||!eq(target.ceilUnit(),target))return null
  for(const precision of [2,6]){
    const scale=10n**BigInt(precision)
    const candidate=new Q(target.div(mr).mul(new Q(scale)).floor(),scale)
    const value=candidate.toString()
    if(!/^\d{1,12}(?:\.\d{1,6})?$/.test(value))continue
    if(eq(candidate.mul(mr).ceilUnit(),target))return value
  }
  return null
}
/** Only evaluated prices of already reviewed equivalent service options may
 * be supplied. Exactly one option per original service row, no extra scope.
 * A bounded search reports when the optimum has not been established.
 */
export type ReviewedServiceOption={
  optionId:string;rowId:string;serviceId:string;dimensionId:string|null;gross:string;discountable:boolean
}
export function chooseReviewedServiceCombination(targetNet:string,groups:ReviewedServiceOption[][],limit=20000){
  const target=decimal(targetNet)
  if(!cents(target)||!Number.isSafeInteger(limit)||limit<1||limit>100000||groups.length>100)throw Error('HISTORICAL_RECONCILIATION_INVALID_INPUT')
  const rowIds=new Set<string>(),optionIds=new Set<string>()
  for(const group of groups){
    if(!group.length||group.length>100||rowIds.has(group[0]!.rowId))throw Error('HISTORICAL_RECONCILIATION_INVALID_GROUP')
    rowIds.add(group[0]!.rowId)
    for(const choice of group){
      if(choice.rowId!==group[0]!.rowId||!choice.optionId||optionIds.has(choice.optionId)||typeof choice.discountable!=='boolean')throw Error('HISTORICAL_RECONCILIATION_INVALID_OPTION')
      optionIds.add(choice.optionId);decimal(choice.gross)
    }
  }
  let evaluated=0,visited=0,bounded=false
  let best:{options:ReviewedServiceOption[];gross:Q;discount:Q;eligible:Q}|null=null
  const selected:ReviewedServiceOption[]=[]
  function visit(i:number,gross:Q,eligible:Q){
    if(++visited>limit){bounded=true;return}
    if(best&&gross.cmp(best.gross)>0)return
    if(i===groups.length){
      evaluated++
      const discount=gross.sub(target)
      if(discount.n<0n||discount.cmp(eligible)>0||!cents(discount))return
      if(!best||gross.cmp(best.gross)<0)best={options:[...selected],gross,discount,eligible}
      return
    }
    for(const option of groups[i]!){
      if(bounded)return
      const amount=decimal(option.gross)
      selected.push(option);visit(i+1,gross.add(amount),eligible.add(option.discountable?amount:ZERO));selected.pop()
    }
  }
  // No candidate explosion: bound visited nodes too, including pruned partial branches.
  // A caller cannot rely on optimality when the search limit is reached.
  visit(0,ZERO,ZERO)
  const result=best as {options:ReviewedServiceOption[];gross:Q;discount:Q;eligible:Q}|null
  return {state:bounded?'search-limit':result?'matched':'no-match',exhaustive:!bounded,evaluated,match:result?{
    options:result.options,gross:result.gross.toString(),discount:result.discount.toString(),eligible:result.eligible.toString(),net:target.toString()
  }:null}
}
/** Read-only suggestion for the presently mapped scope. Alternative dimensions
 * require explicit technical review before the combination helper is used.
 */
export function reconcileMappedHistoricalBudget(data:HistoricalBudgetPackage,current:Calculation,config:PricingConfig,settings:PricingSettings){
  const {factor}=resolveMR(settings,config)
  const components=data.components.map(c=>{
    const manualPrice=factor===null?null:deriveHistoricalManualPrice(c.unitSalePrice,factor)
    const validPair=eq(decimal(c.unitSalePrice).mul(decimal(c.quantity)),decimal(c.total))
    return {rowId:c.rowId,quantity:c.quantity,historicalUnit:c.unitSalePrice,historicalTotal:c.total,manualPrice:validPair?manualPrice:null,origin:'derived-not-verified-cost' as const}
  })
  const componentsMatch=components.every(c=>c.manualPrice!==null)&&eq(sum(data.components.map(c=>decimal(c.total))),decimal(data.totals.components))
  const servicesTarget=decimal(data.totals.services).sub(decimal(data.totals.discount))
  const gross=current.originalServiceSubtotal===null?null:decimal(current.originalServiceSubtotal)
  const eligible=current.discountEligibleSubtotal==null?null:decimal(current.discountEligibleSubtotal)
  const discount=gross===null?null:gross.sub(servicesTarget)
  const matchingServiceRows=data.services.every(s=>current.lines.some(l=>l.id===s.rowId&&l.kind==='service'&&l.included&&(l.total!==null||l.billing==='not_billed')))
  const servicesMatch=matchingServiceRows&&discount!==null&&discount.n>=0n&&cents(discount)&&eligible!==null&&discount.cmp(eligible)<=0
  const reasons:string[]=[]
  if(!componentsMatch)reasons.push('COMPONENT_RECONCILIATION_UNAVAILABLE')
  if(!matchingServiceRows||gross===null||eligible===null)reasons.push('SERVICE_PRICING_INCOMPLETE')
  else if(discount!==null&&discount.n<0n)reasons.push('SERVICE_GROSS_BELOW_TARGET')
  else if(discount!==null&&(!cents(discount)||discount.cmp(eligible)>0))reasons.push('DISCOUNT_NOT_PERMITTED')
  const totalMatches=eq(servicesTarget.add(decimal(data.totals.components)),decimal(data.totals.total))
  if(!totalMatches)reasons.push('HISTORICAL_TOTAL_MISMATCH')
  return {kind:'historical-reconstruction-suggestion' as const,components,factor,componentsMatch,servicesMatch,servicesTarget:servicesTarget.toString(),serviceGross:gross?.toString()??null,
    suggestedDiscount:servicesMatch?discount!.toString():null,eligibleDiscount:eligible?.toString()??null,historicalTotal:data.totals.total,
    mathematicalMatch:componentsMatch&&servicesMatch&&totalMatches,reasons,
    requiresTechnicalAndCommercialReview:true as const,canWrite:false as const}
}
