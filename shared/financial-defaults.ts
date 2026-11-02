import type{FinancialDefaults,PricingConfig}from'./pricing.ts'
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()
export function financialDefaults(config:PricingConfig,previous?:PricingConfig):FinancialDefaults{
 if(config.defaults)return config.defaults
 if(previous?.defaults)return previous.defaults
 const id=(key:'tables'|'colors'|'risks',name:string)=>{
  for(const c of [previous,config]){const matches=c?.[key].filter(o=>normalized(o.name)===normalized(name))??[];if(matches.length===1)return matches[0]!.id;if(matches.length>1)return null}
  return null
 }
 return{tableId:id('tables','Padrão'),colorId:id('colors','C1'),riskId:id('risks','R1'),mrPercent:'20'}
}
