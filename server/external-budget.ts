import {createHash} from 'node:crypto'
import {Q,sum} from './exact.ts'
import {ServiceError} from './errors.ts'
import type {HistoricalBudgetPackage} from './historical-budget-preflight.ts'
import {preflightHistoricalBudget} from './historical-budget-preflight.ts'

/** Neutral external budget V1. Source evidence is a fingerprint, not
 * authentication or proof of execution authorization. Values are amounts
 * attributed to FUNIX in the external estimate, not insurer payments or costs.
 */
const invalid=(field:string):never=>{throw new ServiceError(422,'EXTERNAL_BUDGET_INVALID','Orçamento externo inválido: '+field)}
function obj(raw:unknown,keys:string[],field:string):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalid(field)
  const x=raw as Record<string,unknown>
  if(Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))return invalid(field)
  return x
}
function str(v:unknown,field:string,max=250):string{
  if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))return invalid(field)
  return v.trim()
}
function nullable(v:unknown,field:string){return v===null?null:str(v,field)}
function id(v:unknown,field:string){
  const s=str(v,field,150)
  if(!/^[A-Za-z0-9_.:-]+$/.test(s))return invalid(field)
  return s
}
function amount(v:unknown,field:string,places=2,positive=false){
  const re=new RegExp('^\\d{1,12}(?:\\.\\d{1,'+places+'})?$')
  if(typeof v!=='string'||!re.test(v))return invalid(field)
  const q=Q.from(v)
  if(positive&&q.n<=0n)return invalid(field)
  return q.toString()
}
function rows<T extends {id:string}>(v:unknown,field:string,parse:(v:unknown)=>T,limit:number):T[]{
  if(!Array.isArray(v)||v.length>limit)return invalid(field)
  const result=v.map(parse)
  if(new Set(result.map(r=>r.id)).size!==result.length)return invalid(field+'.id duplicado')
  return result.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
}
function enumValue<T extends string>(v:unknown,values:readonly T[],field:string):T{
  if(typeof v!=='string'||!values.includes(v as T))return invalid(field)
  return v as T
}
function normalize(raw:unknown){
  const x=obj(raw,['schema','source','metadata','totals','diagnoses','services','components','otherAmounts'],'package')
  if(x.schema!==1)return invalid('schema')
  const s=obj(x.source,['provider','issuerKey','documentNumber','revision','evidenceSha256','evidenceKind'],'source')
  const provider=enumValue(s.provider,['coda','cilia','other'] as const,'source.provider')
  const evidenceKind=enumValue(s.evidenceKind,['verified-coda-normalized','file-bytes','structured-extract'] as const,'source.evidenceKind')
  const evidenceSha256=str(s.evidenceSha256,'source.evidenceSha256',64)
  if(!/^[a-f0-9]{64}$/.test(evidenceSha256)||(provider==='coda')!==(evidenceKind==='verified-coda-normalized'))return invalid('source.evidence')
  const source={provider,issuerKey:id(s.issuerKey,'source.issuerKey'),documentNumber:str(s.documentNumber,'source.documentNumber'),revision:nullable(s.revision,'source.revision'),evidenceSha256,evidenceKind}
  const m=obj(x.metadata,['sourceStatus','sourceAttendance','deadlineDays'],'metadata')
  if(m.deadlineDays!==null&&(typeof m.deadlineDays!=='number'||!Number.isSafeInteger(m.deadlineDays)||m.deadlineDays<1||m.deadlineDays>3650))return invalid('metadata.deadlineDays')
  const metadata={sourceStatus:nullable(m.sourceStatus,'metadata.sourceStatus'),sourceAttendance:nullable(m.sourceAttendance,'metadata.sourceAttendance'),deadlineDays:m.deadlineDays as number|null}
  const t=obj(x.totals,['servicesGross','serviceDiscount','components','total'],'totals')
  const totals={servicesGross:amount(t.servicesGross,'totals.servicesGross'),serviceDiscount:amount(t.serviceDiscount,'totals.serviceDiscount'),components:amount(t.components,'totals.components'),total:amount(t.total,'totals.total')}
  const diagnoses=rows(x.diagnoses,'diagnoses',raw=>{
    const d=obj(raw,['id','piece','position','damage','intensity'],'diagnosis')
    return {id:id(d.id,'diagnosis.id'),piece:str(d.piece,'diagnosis.piece'),position:nullable(d.position,'diagnosis.position'),damage:nullable(d.damage,'diagnosis.damage'),intensity:nullable(d.intensity,'diagnosis.intensity')}
  },250)
  if(!diagnoses.length)return invalid('diagnoses vazio')
  const services=rows(x.services,'services',raw=>{
    const d=obj(raw,['id','diagnosisId','description','dimension','quantity','quantityUnit','unitPrice','total'],'service')
    return {id:id(d.id,'service.id'),diagnosisId:id(d.diagnosisId,'service.diagnosisId'),description:str(d.description,'service.description',500),dimension:nullable(d.dimension,'service.dimension'),quantity:amount(d.quantity,'service.quantity',6,true),quantityUnit:enumValue(d.quantityUnit,['operation','hour','other','unknown'] as const,'service.quantityUnit'),unitPrice:amount(d.unitPrice,'service.unitPrice',6),total:amount(d.total,'service.total')}
  },1000)
  const components=rows(x.components,'components',raw=>{
    const d=obj(raw,['id','diagnosisId','description','quantity','unitSalePrice','total','billing','supply'],'component')
    return {id:id(d.id,'component.id'),diagnosisId:id(d.diagnosisId,'component.diagnosisId'),description:str(d.description,'component.description',500),quantity:amount(d.quantity,'component.quantity',6,true),unitSalePrice:amount(d.unitSalePrice,'component.unitSalePrice',6),total:amount(d.total,'component.total'),billing:enumValue(d.billing,['funix','partner','unknown'] as const,'component.billing'),supply:enumValue(d.supply,['funix','partner','unknown'] as const,'component.supply')}
  },1000)
  const otherAmounts=rows(x.otherAmounts,'otherAmounts',raw=>{
    const d=obj(raw,['id','label','amount','kind'],'otherAmount')
    return {id:id(d.id,'otherAmount.id'),label:str(d.label,'otherAmount.label'),amount:amount(d.amount,'otherAmount.amount'),kind:enumValue(d.kind,['deductible','tax','supplement','other','unknown'] as const,'otherAmount.kind')}
  },100)
  return {schema:1 as const,source,metadata,totals,diagnoses,services,components,otherAmounts}
}
export type ExternalBudget=ReturnType<typeof normalize>
export function preflightExternalBudget(raw:unknown){
  const data=normalize(raw),errors:string[]=[],warnings:string[]=[]
  const q=Q.from,eq=(a:Q,b:Q)=>a.cmp(b)===0
  const diagnoses=new Set(data.diagnoses.map(x=>x.id))
  for(const l of [...data.services,...data.components])if(!diagnoses.has(l.diagnosisId))errors.push('PARENT_MISSING:'+l.id)
  for(const l of data.services)if(!eq(q(l.quantity).mul(q(l.unitPrice)),q(l.total)))errors.push('SERVICE_LINE_MISMATCH:'+l.id)
  for(const l of data.components){
    if(!eq(q(l.quantity).mul(q(l.unitSalePrice)),q(l.total)))errors.push('COMPONENT_LINE_MISMATCH:'+l.id)
    if(l.billing!=='funix')errors.push('COMPONENT_BILLING_REVIEW:'+l.id)
    if(l.supply!=='funix')warnings.push('COMPONENT_SUPPLY_REVIEW:'+l.id)
  }
  if(data.otherAmounts.length)errors.push('OTHER_AMOUNTS_REQUIRE_REVIEW')
  const services=sum(data.services.map(l=>q(l.total))),components=sum(data.components.filter(l=>l.billing==='funix').map(l=>q(l.total))),discount=q(data.totals.serviceDiscount)
  if(!eq(services,q(data.totals.servicesGross)))errors.push('SERVICE_SUBTOTAL_MISMATCH')
  if(!eq(components,q(data.totals.components)))errors.push('COMPONENT_SUBTOTAL_MISMATCH')
  if(discount.cmp(services)>0)errors.push('DISCOUNT_EXCEEDS_SERVICES')
  if(!eq(services.sub(discount).add(components),q(data.totals.total)))errors.push('TOTAL_MISMATCH')
  if(!data.services.length&&!data.components.length)errors.push('EMPTY_SCOPE')
  if(data.metadata.deadlineDays===null)warnings.push('SOURCE_DEADLINE_UNKNOWN')
  const digest=createHash('sha256').update(JSON.stringify(data)).digest('hex')
  return {data,digest,errors,warnings,valid:errors.length===0}
}
/** Coda source-specific checks remain required. Source line evidence is retained
 * in the original preflight package; neutral data does not invent native stages.
 * Components were included in the historical FUNIX sale total, not proof of supplier.
 */
export function externalBudgetFromCoda(raw:HistoricalBudgetPackage){
  const p=preflightHistoricalBudget(raw)
  if(!p.financialIntegrity)throw new ServiceError(422,'EXTERNAL_CODA_INTEGRITY','Orçamento Coda com divergências na origem.')
  const d=p.data,s=d.source
  return preflightExternalBudget({
    schema:1,source:{provider:'coda',issuerKey:s.docId+':'+s.budgetTableId,documentNumber:s.budgetNumber,revision:s.budgetRowId,evidenceSha256:p.digest,evidenceKind:'verified-coda-normalized'},
    metadata:{sourceStatus:d.metadata.status,sourceAttendance:s.atendimentoRowId,deadlineDays:d.metadata.deadlineDays},
    totals:{servicesGross:d.totals.services,serviceDiscount:d.totals.discount,components:d.totals.components,total:d.totals.total},
    diagnoses:d.diagnoses.map(r=>({id:r.rowId,piece:r.piece,position:r.position,damage:r.damage,intensity:r.intensity})),
    services:d.services.map(r=>({id:r.rowId,diagnosisId:r.diagnosisRowId,description:r.service,dimension:r.dimension,quantity:r.quantity,quantityUnit:'operation',unitPrice:r.unitPrice,total:r.total})),
    components:d.components.map(r=>({id:r.rowId,diagnosisId:r.diagnosisRowId,description:r.description,quantity:r.quantity,unitSalePrice:r.unitSalePrice,total:r.total,billing:'funix',supply:'unknown'})),otherAmounts:[],
  })
}
