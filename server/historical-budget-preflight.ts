import {createHash} from 'node:crypto'
import {Q,ZERO,sum} from './exact.ts'
import {ServiceError} from './errors.ts'

/** Internal, read-only normalized contract. It is NOT an emission request or authorization.
 * Row identities are physical source rows, scoped by the source tables.
 * Values are historical sale amounts, never inputs to the current pricing engine.
 */
function invalid(path:string):never {
  throw new ServiceError(422,'HISTORICAL_BUDGET_INVALID','Dados históricos inválidos: '+path)
}
function obj(value:unknown,keys:string[],path:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid(path)
  const o=value as Record<string,unknown>
  if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))return invalid(path)
  return o
}
function str(value:unknown,path:string,max=160):string{
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))return invalid(path)
  return value
}
function id(value:unknown,path:string,pattern=/^[A-Za-z0-9_-]{1,100}$/):string{
  const s=str(value,path,100)
  if(!pattern.test(s))return invalid(path)
  return s
}
const row=(v:unknown,p:string)=>id(v,p,/^i-[A-Za-z0-9_-]{1,98}$/)
const table=(v:unknown,p:string)=>id(v,p,/^grid-[A-Za-z0-9_-]{1,95}$/)
function decimal(value:unknown,path:string,places=2):string{
  const pattern=new RegExp('^\\d{1,12}(?:\\.\\d{1,'+places+'})?$')
  if(typeof value!=='string'||!pattern.test(value))return invalid(path)
  return value
}
function exact(value:string):Q{
  const [w,f='']=value.split('.')
  return new Q(BigInt(w+f),10n**BigInt(f.length))
}
function quantity(value:unknown,path:string):string{
  const s=decimal(value,path,6)
  if(exact(s).cmp(ZERO)<=0)return invalid(path)
  return s
}
function nullableText(value:unknown,p:string):string|null{
  return value===null?null:str(value,p,250)
}
function days(value:unknown):number|null{
  if(value===null)return null
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>3650)return invalid('deadlineDays')
  return value
}
function rows<T extends {rowId:string}>(value:unknown,path:string,parse:(v:unknown)=>T,max:number):T[]{
  if(!Array.isArray(value)||value.length>max)return invalid(path)
  const data=value.map(parse)
  if(new Set(data.map(r=>r.rowId)).size!==data.length)return invalid(path+'.rowId duplicado')
  // Physical row order is not part of import identity.
  return data.sort((a,b)=>a.rowId<b.rowId?-1:a.rowId>b.rowId?1:0)
}
function normalized(raw:unknown){
  const input=obj(raw,['schema','source','metadata','totals','diagnoses','services','components','stages','installments'],'package')
  if(input.schema!==1)return invalid('schema')
  const s=obj(input.source,['docId','budgetTableId','budgetRowId','budgetNumber','atendimentoTableId','atendimentoRowId','diagnosisTableId','serviceTableId','componentTableId','stageTableId'],'source')
  const source={docId:id(s.docId,'source.docId'),budgetTableId:table(s.budgetTableId,'source.budgetTableId'),budgetRowId:row(s.budgetRowId,'source.budgetRowId'),budgetNumber:str(s.budgetNumber,'source.budgetNumber'),atendimentoTableId:table(s.atendimentoTableId,'source.atendimentoTableId'),atendimentoRowId:row(s.atendimentoRowId,'source.atendimentoRowId'),diagnosisTableId:table(s.diagnosisTableId,'source.diagnosisTableId'),serviceTableId:table(s.serviceTableId,'source.serviceTableId'),componentTableId:table(s.componentTableId,'source.componentTableId'),stageTableId:table(s.stageTableId,'source.stageTableId')}
  const tables=[source.budgetTableId,source.atendimentoTableId,source.diagnosisTableId,source.serviceTableId,source.componentTableId,source.stageTableId]
  if(new Set(tables).size!==tables.length)return invalid('source.tableId duplicado')
  const m=obj(input.metadata,['createdAt','status','deadlineDays','colorFactor','riskFactor','pricingSource'],'metadata')
  const createdAt=str(m.createdAt,'metadata.createdAt',40)
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(createdAt)||!Number.isFinite(Date.parse(createdAt))||new Date(createdAt).toISOString()!==createdAt.replace(/(\d{2})Z$/, '$1.000Z').replace(/(\.\d{3})\.000Z$/,'$1Z'))return invalid('metadata.createdAt')
  const metadata={createdAt,status:str(m.status,'metadata.status'),deadlineDays:days(m.deadlineDays),colorFactor:nullableText(m.colorFactor,'metadata.colorFactor'),riskFactor:nullableText(m.riskFactor,'metadata.riskFactor'),pricingSource:nullableText(m.pricingSource,'metadata.pricingSource')}
  const t=obj(input.totals,['services','components','discount','total'],'totals')
  const totals={services:decimal(t.services,'totals.services'),components:decimal(t.components,'totals.components'),discount:decimal(t.discount,'totals.discount'),total:decimal(t.total,'totals.total')}
  const diagnoses=rows(input.diagnoses,'diagnoses',v=>{
    const x=obj(v,['rowId','code','piece','position','damage','intensity','services','components'],'diagnosis')
    return {rowId:row(x.rowId,'diagnosis.rowId'),code:str(x.code,'diagnosis.code'),piece:str(x.piece,'diagnosis.piece'),position:nullableText(x.position,'diagnosis.position'),damage:nullableText(x.damage,'diagnosis.damage'),intensity:nullableText(x.intensity,'diagnosis.intensity'),services:decimal(x.services,'diagnosis.services'),components:decimal(x.components,'diagnosis.components')}
  },250)
  if(!diagnoses.length)return invalid('diagnoses vazio')
  const services=rows(input.services,'services',v=>{
    const x=obj(v,['rowId','diagnosisRowId','code','service','dimension','quantity','unitPrice','total','energy'],'service')
    return {rowId:row(x.rowId,'service.rowId'),diagnosisRowId:row(x.diagnosisRowId,'service.diagnosisRowId'),code:str(x.code,'service.code'),service:str(x.service,'service.service'),dimension:nullableText(x.dimension,'service.dimension'),quantity:quantity(x.quantity,'service.quantity'),unitPrice:decimal(x.unitPrice,'service.unitPrice'),total:decimal(x.total,'service.total'),energy:decimal(x.energy,'service.energy',6)}
  },1000)
  const components=rows(input.components,'components',v=>{
    const x=obj(v,['rowId','diagnosisRowId','code','description','quantity','unitSalePrice','total'],'component')
    return {rowId:row(x.rowId,'component.rowId'),diagnosisRowId:row(x.diagnosisRowId,'component.diagnosisRowId'),code:str(x.code,'component.code'),description:str(x.description,'component.description',500),quantity:quantity(x.quantity,'component.quantity'),unitSalePrice:decimal(x.unitSalePrice,'component.unitSalePrice'),total:decimal(x.total,'component.total')}
  },1000)
  const stages=rows(input.stages,'stages',v=>{
    const x=obj(v,['rowId','serviceRowId','code','stage','energy','allocatedAmount','category'],'stage')
    return {rowId:row(x.rowId,'stage.rowId'),serviceRowId:row(x.serviceRowId,'stage.serviceRowId'),code:str(x.code,'stage.code'),stage:str(x.stage,'stage.stage'),energy:decimal(x.energy,'stage.energy',6),allocatedAmount:decimal(x.allocatedAmount,'stage.allocatedAmount',18),category:nullableText(x.category,'stage.category')}
  },4000)
  if(!Array.isArray(input.installments)||input.installments.length>24)return invalid('installments')
  const installments=input.installments.map(v=>{
    const x=obj(v,['count','amount','total'],'installment')
    if(typeof x.count!=='number'||!Number.isSafeInteger(x.count)||x.count<1||x.count>120)return invalid('installment.count')
    return {count:x.count,amount:decimal(x.amount,'installment.amount'),total:decimal(x.total,'installment.total')}
  }).sort((a,b)=>a.count-b.count)
  if(new Set(installments.map(x=>x.count)).size!==installments.length)return invalid('installments.count duplicado')
  return {schema:1 as const,source,metadata,totals,diagnoses,services,components,stages,installments}
}
export type HistoricalBudgetPackage=ReturnType<typeof normalized>
export type HistoricalBudgetFinding={code:string;rowId?:string}
/** No database, catalog, network or side effects. A valid financial package is not import authorization. */
export function preflightHistoricalBudget(raw:unknown){
  const data=normalized(raw),errors:HistoricalBudgetFinding[]=[],warnings:HistoricalBudgetFinding[]=[]
  const issue=(code:string,rowId?:string)=>errors.push({code,...(rowId===undefined?{}:{rowId})})
  const warn=(code:string,rowId?:string)=>warnings.push({code,...(rowId===undefined?{}:{rowId})})
  const eq=(a:Q,b:Q)=>a.cmp(b)===0
  const diagnoses=new Set(data.diagnoses.map(v=>v.rowId)),services=new Set(data.services.map(v=>v.rowId))
  for(const line of data.services){
    if(!diagnoses.has(line.diagnosisRowId))issue('SERVICE_PARENT_MISSING',line.rowId)
    if(!eq(exact(line.quantity).mul(exact(line.unitPrice)),exact(line.total)))issue('SERVICE_TOTAL_MISMATCH',line.rowId)
  }
  for(const line of data.components){
    if(!diagnoses.has(line.diagnosisRowId))issue('COMPONENT_PARENT_MISSING',line.rowId)
    if(!eq(exact(line.quantity).mul(exact(line.unitSalePrice)),exact(line.total)))issue('COMPONENT_TOTAL_MISMATCH',line.rowId)
  }
  for(const stage of data.stages)if(!services.has(stage.serviceRowId))issue('STAGE_PARENT_MISSING',stage.rowId)
  for(const diagnosis of data.diagnoses){
    if(!eq(sum(data.services.filter(x=>x.diagnosisRowId===diagnosis.rowId).map(x=>exact(x.total))),exact(diagnosis.services)))issue('DIAGNOSIS_SERVICES_MISMATCH',diagnosis.rowId)
    if(!eq(sum(data.components.filter(x=>x.diagnosisRowId===diagnosis.rowId).map(x=>exact(x.total))),exact(diagnosis.components)))issue('DIAGNOSIS_COMPONENTS_MISMATCH',diagnosis.rowId)
  }
  const servicesTotal=sum(data.services.map(x=>exact(x.total))),componentsTotal=sum(data.components.map(x=>exact(x.total))),discount=exact(data.totals.discount)
  const calculatedTotal=servicesTotal.add(componentsTotal).sub(discount)
  if(!eq(servicesTotal,exact(data.totals.services)))issue('SERVICES_TOTAL_MISMATCH')
  if(!eq(componentsTotal,exact(data.totals.components)))issue('COMPONENTS_TOTAL_MISMATCH')
  if(discount.cmp(servicesTotal)>0)issue('DISCOUNT_EXCEEDS_SERVICES')
  if(!eq(calculatedTotal,exact(data.totals.total)))issue('BUDGET_TOTAL_MISMATCH')
  for(const service of data.services){
    const stages=data.stages.filter(x=>x.serviceRowId===service.rowId)
    if(!stages.length){issue('STAGES_MISSING',service.rowId);continue}
    const codes=new Set<string>()
    for(const stage of stages){
      if(codes.has(stage.code))warn('DUPLICATE_STAGE_CODE',stage.rowId)
      codes.add(stage.code)
      if(stage.category===null)warn('STAGE_CATEGORY_UNKNOWN',stage.rowId)
    }
    if(!eq(sum(stages.map(x=>exact(x.energy))),exact(service.energy)))issue('STAGE_ENERGY_MISMATCH',service.rowId)
    // Source allocation can contain repeating decimal approximations or rounded cents.
    // Compare the exact sum with a half-cent per recorded stage; never rewrite the source.
    const delta=sum(stages.map(x=>exact(x.allocatedAmount))).sub(exact(service.total)).abs()
    if(delta.cmp(new Q(BigInt(stages.length),200n))>0)issue('STAGE_ALLOCATION_MISMATCH',service.rowId)
    else if(delta.cmp(ZERO)>0)warn('STAGE_ALLOCATION_ROUNDING',service.rowId)
  }
  if(data.metadata.colorFactor===null||data.metadata.riskFactor===null)warn('HISTORICAL_FACTORS_UNKNOWN')
  if(data.metadata.deadlineDays===null)warn('HISTORICAL_DEADLINE_UNKNOWN')
  for(const installment of data.installments){
    const delta=exact(installment.amount).mul(new Q(BigInt(installment.count))).sub(exact(installment.total)).abs()
    if(delta.cmp(new Q(BigInt(installment.count),200n).add(new Q(1n,200n)))>0)issue('INSTALLMENT_TOTAL_MISMATCH')
    else if(delta.cmp(ZERO)>0)warn('INSTALLMENT_ROUNDING')
  }
  const digest=createHash('sha256').update(JSON.stringify(data)).digest('hex')
  return {data,digest,errors,warnings,financialIntegrity:errors.length===0,calculated:{services:servicesTotal.toString(),components:componentsTotal.toString(),total:calculatedTotal.toString()}}
}
