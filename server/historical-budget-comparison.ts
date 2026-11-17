import type {CatalogItem,DiagnosisItem,Scenario} from '../shared/commercial.ts'
import type {PricingConfiguration,PricingSettings,ComponentItem} from '../shared/pricing.ts'
import type {HistoricalBudgetPackage} from './historical-budget-preflight.ts'
import {calculate} from './pricing-engine.ts'
import {Q,ZERO} from './exact.ts'
import {reconcileMappedHistoricalBudget} from './historical-budget-reconciliation.ts'

type Mapping={rowId:string;role:'piece'|'diagnosis'|'service'|'dimension';catalog:CatalogItem}
function exact(value:string):Q{
  const [w,f='']=value.split('.')
  return new Q(BigInt(w+f),10n**BigInt(f.length))
}
/** Pure comparison of exactly the captured scope against current parameters.
 * No cost basis for components is inferred from historical sale prices.
 * No current negotiated discount is assumed. This never prepares an emission.
 */
export function compareHistoricalPricing(data:HistoricalBudgetPackage,mapping:Mapping[],configuration:PricingConfiguration,state:{revision:number;settings:PricingSettings}){
  const map=new Map(mapping.map(x=>[x.role+':'+x.rowId,x.catalog.id]))
  const catalog=[...new Map(mapping.map(x=>[x.catalog.id,x.catalog])).values()]
  const id=(role:Mapping['role'],rowId:string)=>map.get(role+':'+rowId)??null
  const items:DiagnosisItem[]=data.diagnoses.map(d=>({
    id:d.rowId,atendimentoId:'historical-comparison',pieceId:id('piece',d.rowId)??'',diagnosisId:id('diagnosis',d.rowId),
    notes:'',enabled:true,revision:1,createdAt:data.metadata.createdAt,updatedAt:data.metadata.createdAt,
    services:data.services.filter(s=>s.diagnosisRowId===d.rowId).map(s=>({id:s.rowId,serviceId:id('service',s.rowId)??'',dimensionId:id('dimension',s.rowId),quantity:s.quantity,enabled:true})),
  }))
  const components:ComponentItem[]=data.components.map(c=>({id:c.rowId,atendimentoId:'historical-comparison',pieceId:c.diagnosisRowId,name:c.description,quantity:c.quantity,manualPrice:null,notes:'',revision:1}))
  const scenario:Scenario={id:'historical-comparison',atendimentoId:'historical-comparison',name:'Comparação histórica',position:1,revision:1,pieceFlags:Object.fromEntries(items.map(i=>[i.id,true])),serviceFlags:Object.fromEntries(data.services.map(s=>[s.rowId,true])),componentFlags:Object.fromEntries(components.map(c=>[c.id,true]))}
  const current=calculate(items,components,catalog,scenario,configuration.config,state.settings)
  const lines=data.services.map(s=>{
    const line=current.lines.find(l=>l.kind==='service'&&l.id===s.rowId)
    const value=line?.billing==='not_billed'?'0':line?.total??null
    return {rowId:s.rowId,historical:s.total,current:value,delta:value===null?null:exact(value).sub(exact(s.total)).toString(),nonBillable:line?.billing==='not_billed'}
  })
  const currentServices=current.originalServiceSubtotal
  const currentComponents=data.components.length?null:'0'
  const historicGross=exact(data.totals.services).add(exact(data.totals.components))
  const currentGross=currentServices===null||currentComponents===null?null:exact(currentServices).add(ZERO).toString()
  return {mode:'current-gross-no-negotiation' as const,configurationRevision:configuration.revision,settingsRevision:state.revision,settings:state.settings,
    services:{historical:data.totals.services,current:currentServices,delta:currentServices===null?null:exact(currentServices).sub(exact(data.totals.services)).toString()},
    components:{historical:data.totals.components,current:currentComponents,reason:data.components.length?'HISTORICAL_COMPONENT_COST_UNKNOWN':null},
    gross:{historical:historicGross.toString(),current:currentGross,delta:currentGross===null?null:exact(currentGross).sub(historicGross).toString()},
    historicNet:data.totals.total,historicDiscount:data.totals.discount,lines,errors:current.errors,
    reconciliation:reconcileMappedHistoricalBudget(data,current,configuration.config,state.settings),
    complete:currentServices!==null&&currentComponents!==null&&current.errors.length===0,
  }
}
