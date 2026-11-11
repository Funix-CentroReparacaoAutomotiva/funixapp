import type {Calculation,PricedLine} from '../shared/pricing.ts'
import type {PieceCategoryTotals} from '../shared/commercial.ts'
import {Q,sum} from './exact.ts'

// Only aggregate already priced lines; never reprice or distribute a negotiation discount.
// Calculation.lines includes disabled rows with total=null, so scope must be filtered first.
function exactTotal(rows:PricedLine[]):string|null{
 if(rows.some(line=>line.total===null))return null
 const decimals=rows.map(line=>{
  const value=line.total!
  if(!/^-?\d+(?:\.\d+)?$/.test(value))throw new Error('Subtotal do diagnóstico inválido.')
  const [whole,fraction='']=value.split('.')
  return new Q(BigInt(whole+fraction),10n**BigInt(fraction.length))
 })
 return sum(decimals).toString()
}
export function pieceFinancialSummary(calculation:Calculation):Record<string,PieceCategoryTotals>{
 const grouped:Record<string,PieceCategoryTotals>={}
 for(const line of calculation.lines){
  const current=grouped[line.pieceId]??{serviceTotal:'0',componentTotal:'0',servicesNonBillableOnly:false}
  grouped[line.pieceId]=current
  if(!line.included)continue
  const rows=calculation.lines.filter(row=>row.pieceId===line.pieceId&&row.included)
  const services=rows.filter(row=>row.kind==='service')
  const billed=services.filter(row=>row.billing!=='not_billed')
  const components=rows.filter(row=>row.kind==='component')
  current.serviceTotal=exactTotal(billed)
  current.componentTotal=exactTotal(components)
  current.servicesNonBillableOnly=services.length>0&&billed.length===0
 }
 return grouped
}
