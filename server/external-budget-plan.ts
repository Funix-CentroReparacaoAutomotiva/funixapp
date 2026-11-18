import {createHash} from 'node:crypto'
import {Q} from './exact.ts'
import {preflightExternalBudget} from './external-budget.ts'
import {deriveHistoricalManualPrice,chooseReviewedServiceCombination} from './historical-budget-reconciliation.ts'
import type {ReviewedServiceOption} from './historical-budget-reconciliation.ts'
import {calculate} from './pricing-engine.ts'
import {chooseCiliaReviewedCombination} from './cilia-reconciliation.ts'
import {resolveMR} from '../shared/mr.ts'
import {catalogItemUsable} from '../shared/commercial.ts'
import {newServiceSelectionIssue,servicePolicy} from '../shared/commercial-curation.ts'
import type {CatalogItem,DiagnosisItem,Scenario,DiagnosisIntensity} from '../shared/commercial.ts'
import type {ComponentItem,PricingConfiguration,PricingSettings,Negotiation} from '../shared/pricing.ts'
import {ServiceError} from './errors.ts'

export type ExternalMapping={
  diagnoses:{sourceId:string;pieceId:string;diagnosisId:string|null;intensity:DiagnosisIntensity|null}[]
  services:{sourceId:string;options:{serviceId:string;dimensionId:string;quantity:string}[]}[]
}
const invalid=():never=>{throw new ServiceError(422,'EXTERNAL_MAPPING_INVALID','Mapeamento externo inválido ou incompleto.')}
export function parseExternalMapping(raw: unknown): ExternalMapping {
  function fields(value: unknown, keys: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) return invalid()
    return value as Record<string, unknown>
  }
  function id(value: unknown) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,150}$/.test(value)) return invalid()
    return value
  }
  const { diagnoses, services } = fields(raw, ['diagnoses', 'services'])
  if (!Array.isArray(diagnoses) || diagnoses.length > 250 ||
      !Array.isArray(services) || services.length > 100) return invalid()
  return {
    diagnoses: diagnoses.map(value => {
      const { sourceId, pieceId, diagnosisId, intensity } = fields(value, ['sourceId', 'pieceId', 'diagnosisId', 'intensity'])
      if (intensity !== null && intensity !== 'leve' && intensity !== 'moderado' && intensity !== 'severo') return invalid()
      return { sourceId: id(sourceId), pieceId: id(pieceId), diagnosisId: diagnosisId === null ? null : id(diagnosisId), intensity }
    }),
    services: services.map(value => {
      const { sourceId, options } = fields(value, ['sourceId', 'options'])
      if (!Array.isArray(options) || options.length < 1 || options.length > 20) return invalid()
      return {
        sourceId: id(sourceId),
        options: options.map(value => {
          const { serviceId, dimensionId, quantity } = fields(value, ['serviceId', 'dimensionId', 'quantity'])
          if (typeof quantity !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(quantity) || Q.from(quantity).n <= 0n) return invalid()
          return { serviceId: id(serviceId), dimensionId: id(dimensionId), quantity }
        }),
      }
    }),
  }
}
function exact(v:string){const [w,f='']=v.split('.');return new Q(BigInt(w+f),10n**BigInt(f.length))}
const eq=(a:string|null|undefined,b:string)=>a!==null&&a!==undefined&&exact(a).cmp(exact(b))===0
/** Pure planner. Input mappings are proposed/technically reviewed options,
 * not authority to edit records. Never uses source hours as a native quantity
 * automatically. No I/O, DB mutation, global factor changes or issuance.
 */
export function planExternalBudget(raw:unknown,mapping:ExternalMapping,catalog:CatalogItem[],configuration:PricingConfiguration,state:{revision:number;settings:PricingSettings}){
  const p=preflightExternalBudget(raw),d=p.data
  if(!p.valid)return {state:'blocked' as const,source:p,issues:p.errors}
  if(d.source.provider==='cilia'&&Q.from(d.totals.serviceDiscount).n!==0n)return {state:'blocked' as const,source:p,issues:['CILIA_SOURCE_DISCOUNT_REVIEW']}
  const byId=(id:string,kind:CatalogItem['kind'])=>{
    const c=catalog.find(x=>x.id===id)
    if(!c||c.kind!==kind||!catalogItemUsable(c))return invalid()
    return c
  }
  if(!mapping||!Array.isArray(mapping.diagnoses)||!Array.isArray(mapping.services)||mapping.diagnoses.length!==d.diagnoses.length||mapping.services.length!==d.services.length)return invalid()
  const diagnoses=new Map(mapping.diagnoses.map(m=>[m.sourceId,m])),services=new Map(mapping.services.map(m=>[m.sourceId,m]))
  if(diagnoses.size!==d.diagnoses.length||services.size!==d.services.length)return invalid()
  const items:DiagnosisItem[]=d.diagnoses.map(r=>{
    const m=diagnoses.get(r.id)
    if(!m||!m.pieceId||!([null,'leve','moderado','severo'] as const).includes(m.intensity))return invalid()
    byId(m.pieceId,'peca')
    if(m.diagnosisId!==null)byId(m.diagnosisId,'diagnostico')
    if(r.damage!==null&&m.diagnosisId===null)return invalid()
    return {id:r.id,atendimentoId:'external-preview',pieceId:m.pieceId,diagnosisId:m.diagnosisId,intensity:m.intensity,notes:'',enabled:true,revision:1,createdAt:'',updatedAt:'',services:[]}
  })
  // Native composition has a unique physical piece. Do not combine diagnoses silently.
  if(new Set(items.map(i=>i.pieceId)).size!==items.length)return {state:'blocked' as const,source:p,issues:['NATIVE_PIECE_COLLISION']}
  const scenario=(items:DiagnosisItem[],components:ComponentItem[]):Scenario=>({id:'external-preview',atendimentoId:'external-preview',name:'Importação externa',position:1,revision:1,pieceFlags:Object.fromEntries(items.map(i=>[i.id,true])),serviceFlags:Object.fromEntries(items.flatMap(i=>i.services.map(l=>[l.id,true]))),componentFlags:Object.fromEntries(components.map(c=>[c.id,true]))})
  if(d.services.length>100)return {state:'blocked' as const,source:p,issues:['SERVICE_SCOPE_OVER_SEARCH_LIMIT']}
  const optionGroups:ReviewedServiceOption[][]=[]
  const selectedOptions=new Map<string,{sourceId:string;serviceId:string;dimensionId:string;quantity:string}>()
  for(const r of d.services){
    const m=services.get(r.id)
    if(!m||!Array.isArray(m.options)||!m.options.length||m.options.length>20)return invalid()
    const options:ReviewedServiceOption[]=[]
    const item=items.find(i=>i.id===r.diagnosisId)!
    for(const [index,o] of m.options.entries()){
      byId(o.serviceId,'servico')
      if(byId(o.dimensionId,'dimensao').serviceId!==o.serviceId||typeof o.quantity!=='string')return invalid()
      if(newServiceSelectionIssue(o.serviceId)||servicePolicy(o.serviceId)?.execution==='external_confirmation')continue
      if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(o.quantity))return invalid()
      let quantity:string
      try{const q=Q.from(o.quantity);if(q.n<=0n)return invalid();quantity=q.toString()}catch{return invalid()}
      const line={id:r.id,serviceId:o.serviceId,dimensionId:o.dimensionId,quantity,enabled:true}
      const one={...item,services:[line]}
      const c=calculate([one],[],catalog,scenario([one],[]),configuration.config,state.settings)
      const priced=c.lines[0]
      if(!priced||c.errors.length||priced.total===null||priced.billing==='not_billed')continue
      const optionId=r.id+':'+index
      options.push({optionId,rowId:r.id,serviceId:line.serviceId,dimensionId:line.dimensionId,gross:priced.total,discountable:priced.discountable===true})
      selectedOptions.set(optionId,{sourceId:r.id,serviceId:line.serviceId,dimensionId:o.dimensionId,quantity})
    }
    if(!options.length)return {state:'blocked' as const,source:p,issues:['SERVICE_OPTIONS_UNPRICED:'+r.id]}
    optionGroups.push(options)
  }
  const target=Q.from(d.totals.servicesGross).sub(Q.from(d.totals.serviceDiscount)).toString()
  const choice=d.source.provider==='cilia'&&optionGroups.length
    ?chooseCiliaReviewedCombination(target,optionGroups.map((options,index)=>({rowId:d.services[index]!.id,sourceTotal:d.services[index]!.total,options})))
    :chooseReviewedServiceCombination(target,optionGroups)
  if(choice.state!=='matched'||!choice.match)return {state:'blocked' as const,source:p,issues:[choice.state==='search-limit'?'SERVICE_SEARCH_LIMIT':'SERVICE_DISCOUNT_NO_MATCH']}
  const selected=choice.match.options.map(o=>selectedOptions.get(o.optionId)!)
  for(const r of d.services){
    const o=selected.find(x=>x.sourceId===r.id)!
    items.find(i=>i.id===r.diagnosisId)!.services.push({id:r.id,serviceId:o.serviceId,dimensionId:o.dimensionId,quantity:o.quantity,enabled:true})
  }
  // No duplicate native service+dimension within a piece (would require explicit aggregation).
  if(items.some(i=>new Set(i.services.map(s=>s.serviceId+':'+s.dimensionId)).size!==i.services.length))return {state:'blocked' as const,source:p,issues:['NATIVE_SERVICE_COLLISION']}
  const mr=resolveMR(state.settings,configuration.config).factor
  const components:ComponentItem[]=[],issues:string[]=[]
  for(const r of d.components){
    const manualPrice=mr===null?null:deriveHistoricalManualPrice(r.unitSalePrice,mr)
    if(manualPrice===null){issues.push('COMPONENT_PRICE_NOT_REPRODUCIBLE:'+r.id);continue}
    components.push({id:r.id,atendimentoId:'external-preview',pieceId:r.diagnosisId,name:r.description,quantity:r.quantity,manualPrice,notes:'Preço manual derivado do valor de venda externo; custo de aquisição não verificado.',revision:1})
  }
  if(issues.length)return {state:'blocked' as const,source:p,issues}
  const negotiation:Negotiation=Q.from(choice.match.discount).n===0n?{mode:'none'}:{mode:'discount',value:choice.match.discount,acknowledgeResidual:false}
  const calculation=calculate(items,components,catalog,scenario(items,components),configuration.config,state.settings,negotiation)
  // Reconcile actual full engine result, including cross-line policy and energy errors.
  for(const r of d.components){
    const l=calculation.lines.find(l=>l.id===r.id&&l.kind==='component')
    if(!l||!eq(l.finalUnit,r.unitSalePrice)||!eq(l.total,r.total))issues.push('COMPONENT_ENGINE_MISMATCH:'+r.id)
  }
  if(!eq(calculation.serviceNet,target)||!eq(calculation.componentSubtotal,d.totals.components)||!eq(calculation.total,d.totals.total))issues.push('NATIVE_TOTAL_MISMATCH')
  if(calculation.errors.length)issues.push('NATIVE_ENGINE_PENDING')
  const plan={items,components,selected,negotiation,calculation,sourceDigest:p.digest,configurationRevision:configuration.revision,settingsRevision:state.revision,settings:state.settings,componentPriceOrigin:'derived-not-verified-cost' as const}
  const digest=createHash('sha256').update(JSON.stringify(plan)).digest('hex')
  return {state:issues.length?'blocked' as const:'matched' as const,source:p,issues,plan,digest,
    requiresOperatorReview:true as const,canWrite:false as const}
}
