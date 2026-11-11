import type {DiagnosisItem} from '../shared/commercial.ts'
import type {ComponentItem} from '../shared/pricing.ts'
import {validQuantity,validManualPrice} from './calculation-state.ts'

export interface PendingField {key:string;label:string;inputId:string}
export function piecePendingFields(piece:DiagnosisItem,components:(ComponentItem&{enabled?:boolean})[]):PendingField[]{
 const pending:PendingField[]=[]
 const add=(key:string,label:string,inputId:string)=>pending.push({key,label,inputId})
 piece.services.forEach((line,index)=>{
  const i=index+1
  if(!line.serviceId)add('service:'+i,'Serviço '+i+': selecionar serviço','issue-service-'+index+'-service')
  if(line.serviceId&&piece.enabled&&line.enabled&&!line.dimensionId)add('dimension:'+i,'Serviço '+i+': selecionar dimensão','issue-service-'+index+'-dimension')
  if(!validQuantity(line.quantity))add('quantity:'+i,'Serviço '+i+': corrigir quantidade','issue-service-'+index+'-quantity')
 })
 components.forEach((part,index)=>{
  const i=index+1
  if(!part.name.trim())add('component-name:'+i,'Componente '+i+': informar descrição','issue-component-'+index+'-name')
  if(!validQuantity(part.quantity))add('component-qty:'+i,'Componente '+i+': corrigir quantidade','issue-component-'+index+'-quantity')
  if(piece.enabled&&part.enabled!==false&&(part.manualPrice===null||!validManualPrice(part.manualPrice)))add('component-price:'+i,'Componente '+i+': informar preço válido','issue-component-'+index+'-price')
 })
 return pending
}
