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
 const grouped=new Map<string,{services:PricedLine[];components:PricedLine[];notBilled:number}>()
 for(const line of calculation.lines){
  let piece=grouped.get(line.pieceId)
  if(!piece){piece={services:[],components:[],notBilled:0};grouped.set(line.pieceId,piece)}
  if(!line.included)continue
  if(line.kind==='component')piece.components.push(line)
  else if(line.billing==='not_billed')piece.notBilled++
  else piece.services.push(line)
 }
 return Object.fromEntries([...grouped].map(([pieceId,piece])=>[pieceId,{
  serviceTotal:exactTotal(piece.services),
  componentTotal:exactTotal(piece.components),
  servicesNonBillableOnly:piece.notBilled>0&&piece.services.length===0,
 }])) as Record<string,PieceCategoryTotals>
}
