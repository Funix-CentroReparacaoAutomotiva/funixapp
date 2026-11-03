// Convert the immutable commercial snapshot to the existing FUNIX jsreport template contract.
// This module never calculates prices, installments or delivery promises.
import {Q} from './exact.ts'
import type {BudgetVersion,PricedLine} from '../shared/pricing.ts'

type Installment={valorParcela:string;total:string}
export type JsreportTerms={
 prazoDiasUteis:string
 parcelamento:{tres:Installment;seis:Installment;nove:Installment;doze:Installment}
}
export interface JsreportDocument{
 meta:{id:string;dataCriacao:string}
 cliente:{nome:string;contato:string}
 veiculo:{modelo:string;placa:string}
 diagnosticos:{nome:string;resumo:string;totalServicos:string;totalComponentes:string;clusters:({tipo:'servico';nome:string;valor:string;descricaoTexto:string[]}|{tipo:'itens';nome:'Itens';valor:string;itensDetalhados:{nome:string;valorUnitario:string;quantidade:string;valorTotal:string}[]})[]}[]
 condicoes:{prazo:string}
 parcelamento:JsreportTerms['parcelamento']
 financeiro:{servicos:string;pecas:string;desconto:string;totalVista:string}
}
function money(value:string|null|undefined):string{
 if(value==null||!/^[-+]?\d+(?:\.\d+)?$/.test(value))throw Error('Valor monetário do orçamento inválido.')
 const n=Q.from(value),negative=n.n<0n
 const positive=negative?n.mul(new Q(-1n)).toString():n.toString()
 const [w,part='']=positive.split('.')
 const grouped=w.replace(/\B(?=(\d{3})+(?!\d))/g,'.')
 // Preserve sub-cent fractions exactly; never silently round the pricing engine.
 return (negative?'-':'')+'R$'+grouped+','+part.padEnd(2,'0')
}
function sumLines(lines:PricedLine[],kind:'service'|'component'):string{
 return lines.filter(l=>l.kind===kind&&l.billing!=='not_billed').reduce((total,l)=>total.add(Q.from(l.total!)),Q.from('0')).toString()
}
export function toJsreportData(version:BudgetVersion,terms:JsreportTerms):JsreportDocument{
 const s=version.snapshot,c=s.calculation
 if(!version.documentNumber||c.errors.length||c.total==null||c.serviceSubtotal==null||c.componentSubtotal==null)throw Error('Emissão sem identificação ou cálculo completo.')
 if(!/^\d+$/.test(terms.prazoDiasUteis)||Number(terms.prazoDiasUteis)<1)throw Error('Prazo comercial em dias úteis não informado.')
 for(const plan of Object.values(terms.parcelamento)){
  if(!plan||typeof plan.valorParcela!=='string'||typeof plan.total!=='string'||!/^R\$ ?[\d.,]+$/.test(plan.valorParcela)||!/^R\$ ?[\d.,]+$/.test(plan.total))throw Error('Condições de parcelamento incompletas.')
 }
 const included=c.lines.filter(l=>l.included&&l.billing!=='not_billed')
 if(included.some(l=>l.total==null||l.finalUnit==null))throw Error('Linha de orçamento incompleta.')
 const byPiece=new Map<string,PricedLine[]>()
 for(const line of included){const rows=byPiece.get(line.pieceId)??[];rows.push(line);byPiece.set(line.pieceId,rows)}
 const diagnostics=[...byPiece].map(([pieceId,rows])=>{
  const item=s.composition.items.find(i=>i.id===pieceId)
  const rawDiagnosis=s.composition.catalog.find(x=>x.id===item?.diagnosisId)?.name??rows.find(x=>x.diagnosis)?.diagnosis??''
  const intensity=item?.intensity
  const resumo=[rawDiagnosis,intensity?({leve:'Leve',moderado:'Moderada',severo:'Severa'} as const)[intensity]:null].filter(Boolean).join(' · ')
  const services=rows.filter(l=>l.kind==='service')
  const components=rows.filter(l=>l.kind==='component')
  const clusters:JsreportDocument['diagnosticos'][number]['clusters']=services.map(line=>({
   tipo:'servico',nome:line.name,valor:money(line.total),
   // No fabricated category or technical activities: use the explicit service wording only.
   descricaoTexto:[line.name,...(line.notes?[line.notes]:[])]
  }))
  if(components.length)clusters.push({tipo:'itens',nome:'Itens',valor:money(sumLines(components,'component')),itensDetalhados:components.map(line=>({
   nome:line.name,valorUnitario:money(line.finalUnit),quantidade:line.quantity,valorTotal:money(line.total)
  }))})
  return {nome:rows[0]!.pieceName,resumo,totalServicos:money(sumLines(services,'service')),totalComponentes:components.length?money(sumLines(components,'component')):'',clusters}
 })
 return {
  meta:{id:version.documentNumber,dataCriacao:new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(version.createdAt))},
  cliente:{nome:s.atendimento.name,contato:s.atendimento.phone},
  veiculo:{modelo:s.atendimento.vehicle||[s.atendimento.brand,s.atendimento.model].filter(Boolean).join(' '),placa:s.atendimento.plate},
  diagnosticos:diagnostics,
  condicoes:{prazo:terms.prazoDiasUteis},
  parcelamento:structuredClone(terms.parcelamento),
  financeiro:{servicos:money(c.serviceSubtotal),pecas:money(c.componentSubtotal),desconto:c.discount==='0'?'':money(c.discount),totalVista:money(c.total)}
 }
}
