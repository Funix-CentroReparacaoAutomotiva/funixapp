import{financialDefaults}from'../shared/financial-defaults.ts'
import{canonicalPercent}from'../shared/mr.ts'
import{initializeFinancialSettings}from'./financial-initialization.ts'
import{CURATION_STAMP}from'./curation.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { PricingConfig, PricingConfiguration, PricingSettings, ServicePricing } from '../shared/pricing.ts'
import { CommercialRepository } from './commercial.ts'
import { Q } from './exact.ts'
import { conflict, inputObject, invalid, touchComposition, transaction } from './scenarios.ts'

export function decimal(value: unknown, positive=false): string {
  if(typeof value!=='string')invalid('Use texto decimal com ponto, sem expoente.')
  let q: Q
  try {q=Q.from(value)}catch{invalid('Decimal inválido: até 12 dígitos inteiros e 6 casas decimais.')}
  if(positive && q.n===0n)invalid('O valor deve ser estritamente positivo.')
  return q.toString()
}
export function optionalDecimal(value: unknown,positive=false){return value===null?null:decimal(value,positive)}
function string(value: unknown,max=250){if(typeof value!=='string' || !value.trim() || value.length>max)invalid('Identificação/nome obrigatório ou inválido.');return value.trim()}
function array(value: unknown): unknown[]{if(!Array.isArray(value))invalid('Lista inválida.');return value}
function unique(ids: string[]){if(new Set(ids).size!==ids.length)invalid('Identificadores ou combinações duplicados na configuração.')}

export class PricingConfigurationRepository {
 readonly db: DatabaseSync
 constructor(db:DatabaseSync){this.db=db}
 get():PricingConfiguration {
  const row=this.db.prepare('SELECT * FROM pricing_configuration WHERE id=1').get()!
  return {revision:Number(row.revision),updatedAt:String(row.updated_at),config:JSON.parse(String(row.data))}
 }
 save(input:unknown):PricingConfiguration {
  const data=inputObject(input,['revision','config'])
  if(!Number.isSafeInteger(data.revision))invalid('Informe a revisão da configuração.')
  return transaction(this.db,()=>{
   const c=inputObject(data.config,['tables','colors','risks','capacity','services','specialPrices','conditions','resaleMultipliers','commercialCuration','defaults'])
   const options=(field:string)=>{
    const result=array(c[field]).map(raw=>{const o=inputObject(raw,['id','name','factor']);return {id:string(o.id,100),name:string(o.name),factor:optionalDecimal(o.factor)}})
    unique(result.map(o=>o.id));return result
   }
   const tables=options('tables'),colors=options('colors'),risks=options('risks'), repo=new CommercialRepository(this.db)
   const previousServices=this.get().config.services
   const services=array(c.services).map(raw=>{
    const s=inputObject(raw,['serviceId','base','dimensions','colorFactorEnabled','discountable','billable']),serviceId=string(s.serviceId,100)
    const previous=previousServices.find(v=>v.serviceId===serviceId)
    const flags:Pick<ServicePricing,'colorFactorEnabled'|'discountable'|'billable'>={}
    for(const key of ['colorFactorEnabled','discountable','billable'] as const){
     const value=s[key]===undefined?previous?.[key]:s[key]
     if(value===undefined)continue
     if(typeof value!=='boolean' && !(key!=='discountable' && value===null))invalid('Flag comercial deve ser booleana; apenas FC/faturável podem ficar pendentes.')
     if(key==='discountable')flags.discountable=value as boolean
     else flags[key]=value as boolean|null
    }
    if(repo.item(serviceId).kind!=='servico')invalid('Referência não é serviço.')
    const dimensions=array(s.dimensions).map(raw=>{
     const d=inputObject(raw,['dimensionId','fd','stages']),dimensionId=string(d.dimensionId,100),item=repo.item(dimensionId)
     if(item.kind!=='dimensao' || item.serviceId!==serviceId)invalid('Dimensão não pertence ao serviço.')
     const stages=array(d.stages).map(raw=>{
      const stage=inputObject(raw,['id','name','dimension','baseEnergy','dimensionEnergy'])
      return {id:string(stage.id,100),name:string(stage.name),dimension:string(stage.dimension),baseEnergy:optionalDecimal(stage.baseEnergy),dimensionEnergy:optionalDecimal(stage.dimensionEnergy)}
     });unique(stages.map(t=>t.id))
     return {dimensionId,fd:optionalDecimal(d.fd),stages}
    });unique(dimensions.map(d=>d.dimensionId))
    return {serviceId,...flags,base:optionalDecimal(s.base),dimensions}
   });unique(services.map(s=>s.serviceId))
   const specialPrices=array(c.specialPrices).map(raw=>{
    const p=inputObject(raw,['tableId','serviceId','dimensionId','unit'])
    const tableId=string(p.tableId,100),serviceId=string(p.serviceId,100),dimensionId=string(p.dimensionId,100)
    if(!tables.some(t=>t.id===tableId))invalid('Tabela de preço especial inexistente.')
    const d=repo.item(dimensionId)
    if(repo.item(serviceId).kind!=='servico' || d.kind!=='dimensao' || d.serviceId!==serviceId)invalid('Chave de preço especial inválida.')
    return {tableId,serviceId,dimensionId,unit:decimal(p.unit)}
   });unique(specialPrices.map(p=>JSON.stringify([p.tableId,p.serviceId,p.dimensionId])))
   if(typeof c.conditions!=='string' || c.conditions.length>8000)invalid('Condições comerciais inválidas.')
   const resaleMultipliers=c.resaleMultipliers===undefined ? this.get().config.resaleMultipliers : options('resaleMultipliers')
   const currentCuration=this.get().config.commercialCuration
   const requestedCuration=c.commercialCuration??currentCuration
   if(requestedCuration!==undefined && (!requestedCuration||typeof requestedCuration!=='object'||Array.isArray(requestedCuration)||Object.keys(requestedCuration).length!==2||!('version'in requestedCuration)||requestedCuration.version!==CURATION_STAMP.version||!('digest'in requestedCuration)||requestedCuration.digest!==CURATION_STAMP.digest))invalid('Política de curadoria incompatível; configuração preservada.')
   const defaults=financialDefaults({...c,tables,colors,risks}as unknown as PricingConfig,this.get().config)
   const defaultData=inputObject(defaults,['tableId','colorId','riskId','mrPercent'])
   for(const key of ['tableId','colorId','riskId']as const)if(defaultData[key]!==null&&(typeof defaultData[key]!=='string'||!defaultData[key]||defaultData[key].length>100))invalid('Identidade de padrão financeiro inválida.')
   if(defaultData.mrPercent!==null&&canonicalPercent(defaultData.mrPercent)===null)invalid('MR padrão deve ser percentual não negativo, com até seis casas decimais.')
   const validatedDefaults={tableId:defaultData.tableId as string|null,colorId:defaultData.colorId as string|null,riskId:defaultData.riskId as string|null,mrPercent:defaultData.mrPercent===null?null:canonicalPercent(defaultData.mrPercent)!}
   const config:PricingConfig={defaults:validatedDefaults,...(requestedCuration?{commercialCuration:{...CURATION_STAMP}}:{}),tables,colors,risks,...(resaleMultipliers===undefined?{}:{resaleMultipliers}),services,specialPrices,capacity:optionalDecimal(c.capacity,true),conditions:c.conditions.trim()}
   const result=this.db.prepare('UPDATE pricing_configuration SET data=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?').run(JSON.stringify(config),new Date().toISOString(),Number(data.revision))
   if(!result.changes)conflict()
   return this.get()
  })
 }
 settings(at:string):{revision:number;settings:PricingSettings} {
  const row=this.db.prepare('SELECT revision,settings_json FROM commercial_state WHERE atendimento_id=?').get(at)
  if(!row)invalid('Atendimento inexistente.')
  return {revision:Number(row.revision),settings:{tableId:null,colorId:null,riskId:null,...JSON.parse(String(row.settings_json))}}
 }
 initializeSettings(at:string,input:unknown){
  inputObject(input,[])
  return transaction(this.db,()=>{initializeFinancialSettings(this.db,at);return this.settings(at)})
 }
 saveSettings(at:string,input:unknown){
  const data=inputObject(input,['revision','tableId','colorId','riskId','mrId','mrPercent'])
  if(!Number.isSafeInteger(data.revision))invalid('Informe a revisão da composição.')
  return transaction(this.db,()=>{
   if(this.settings(at).revision!==data.revision)conflict()
   const config=this.get().config,settings:PricingSettings={...this.settings(at).settings}
   if(data.mrId!==undefined&&data.mrPercent!==undefined)invalid('Informe apenas MR percentual ou identidade legada, nunca ambos.')
   if(data.mrPercent!==undefined){
    const percent=data.mrPercent===null?null:canonicalPercent(data.mrPercent)
    if(data.mrPercent!==null&&percent===null)invalid('MR deve ser percentual não negativo, com até seis casas decimais.')
    settings.mrPercent=percent;settings.mrId=null
   }else if(data.mrId!==undefined)delete settings.mrPercent
   for(const [key,list] of [['tableId',config.tables],['colorId',config.colors],['riskId',config.risks],['mrId',config.resaleMultipliers??[]]] as const){
    if(data[key]===undefined)continue
    const value=data[key]
    if(value!==null && (typeof value!=='string' || !list.some(o=>o.id===value)))invalid('Parâmetro comercial inexistente.')
    settings[key]=value as string|null
   }
   this.db.prepare('UPDATE commercial_state SET settings_json=? WHERE atendimento_id=?').run(JSON.stringify(settings),at)
   touchComposition(this.db,at)
   return this.settings(at)
  })
 }
}
