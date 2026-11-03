// Presentation only, from frozen values. Never reprice or infer technical activities.
import{exactAmount,centAmount,budgetBlockingErrors}from'./budget-terms.ts'
import{Q}from'./exact.ts'
import type{BudgetSnapshot,BudgetVersion,PricedLine}from'../shared/pricing.ts'
import type{JsreportDocument,JsreportTerms}from'../shared/budget-terms.ts'
import{INSTALLMENT_PLANS}from'../shared/budget-terms.ts'
export type{JsreportDocument,JsreportTerms}from'../shared/budget-terms.ts'

function money(value:string|null|undefined):string{
 if(value==null)throw Error('Valor monetário do orçamento inválido.')
 const formatted=centAmount(exactAmount(value)),negative=formatted.startsWith('-'),[whole,fraction]=(negative?formatted.slice(1):formatted).split('.')
 return(negative?'-':'')+'R$ '+whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+fraction
}
function sumLines(lines:PricedLine[]):string{return lines.filter(l=>l.billing!=='not_billed').reduce((sum,l)=>sum.add(exactAmount(l.total!)),new Q(0n)).toString()}
export function frozenTerms(snapshot:BudgetSnapshot):JsreportTerms{
 if(!snapshot.installments||!snapshot.executionDeadline?.effectiveDays)throw Error('Condições de emissão incompletas.')
 const parcelamento={}as JsreportTerms['parcelamento']
 for(const[key]of INSTALLMENT_PLANS){const plan=snapshot.installments.plans[key];parcelamento[key]={valorParcela:money(plan.unit),total:money(plan.total)}}
 return{prazoDiasUteis:String(snapshot.executionDeadline.effectiveDays),parcelamento}
}
export function toJsreportData(version:BudgetVersion,terms:JsreportTerms=frozenTerms(version.snapshot)):JsreportDocument{
 const s=version.snapshot,c=s.calculation
 if(!version.documentNumber||budgetBlockingErrors(s).length||c.total==null||c.serviceSubtotal==null||c.componentSubtotal==null)throw Error('Emissão sem identificação ou cálculo completo.')
 if(!/^\d+$/.test(terms.prazoDiasUteis)||!Number.isSafeInteger(Number(terms.prazoDiasUteis))||Number(terms.prazoDiasUteis)<1)throw Error('Prazo comercial em dias úteis não informado.')
 for(const[key]of INSTALLMENT_PLANS){const plan=terms.parcelamento[key];if(!plan||!/^R\$ ?[\d.,]+$/.test(plan.valorParcela)||!/^R\$ ?[\d.,]+$/.test(plan.total))throw Error('Condições de parcelamento incompletas.')}
 const included=c.lines.filter(l=>l.included)
 if(included.some(l=>l.billing!=='not_billed'&&(l.total==null||l.finalUnit==null)))throw Error('Linha de orçamento incompleta.')
 const byPiece=new Map<string,PricedLine[]>()
 for(const line of included){const rows=byPiece.get(line.pieceId)??[];rows.push(line);byPiece.set(line.pieceId,rows)}
 const diagnostics=[...byPiece].map(([pieceId,rows])=>{
  const item=s.composition.items.find(i=>i.id===pieceId)
  const rawDiagnosis=s.composition.catalog.find(x=>x.id===item?.diagnosisId)?.name??rows.find(x=>x.diagnosis)?.diagnosis??''
  const resumo=[rawDiagnosis,item?.intensity?({leve:'Leve',moderado:'Moderada',severo:'Severa'}as const)[item.intensity]:null].filter(Boolean).join(' · ')
  const services=rows.filter(l=>l.kind==='service'),components=rows.filter(l=>l.kind==='component'),groups=new Map<string,PricedLine[]>()
  for(const line of services){const master=item?.services.find(l=>l.id===line.id);if(!master)throw Error('Serviço sem origem no snapshot.');const group=groups.get(master.serviceId)??[];group.push(line);groups.set(master.serviceId,group)}
  const clusters:JsreportDocument['diagnosticos'][number]['clusters']=[...groups.values()].map(lines=>({
   tipo:'servico',nome:lines[0]!.name,valor:lines.every(l=>l.billing==='not_billed')?'Sem cobrança':money(sumLines(lines)),
   descricaoTexto:lines.flatMap(line=>[...line.stages.map(stage=>stage.name),[line.name,line.dimension?`Dimensão: ${line.dimension}`:'',`Qtd.: ${line.quantity}`].filter(Boolean).join(' · '),...(line.notes?[line.notes]:[])])
  }))
  if(components.length)clusters.push({tipo:'itens',nome:'Itens',valor:money(sumLines(components)),itensDetalhados:components.map(line=>({nome:line.name,valorUnitario:money(line.finalUnit),quantidade:line.quantity,valorTotal:money(line.total)}))})
  return{nome:rows[0]!.pieceName,resumo,totalServicos:services.some(l=>l.billing!=='not_billed')?money(sumLines(services)):'',totalComponentes:components.length?money(sumLines(components)):'',clusters}
 })
 return{
  meta:{id:version.documentNumber,dataCriacao:new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(version.createdAt))},
  cliente:{nome:s.atendimento.name,contato:s.atendimento.phone},
  veiculo:{modelo:s.atendimento.vehicle||[s.atendimento.brand,s.atendimento.model].filter(Boolean).join(' '),placa:s.atendimento.plate},
  diagnosticos:diagnostics,condicoes:{prazo:terms.prazoDiasUteis},parcelamento:structuredClone(terms.parcelamento),
  financeiro:{servicos:money(c.serviceSubtotal),pecas:money(c.componentSubtotal),desconto:exactAmount(c.discount).n===0n?'':money(c.discount),totalVista:money(c.total)}
 }
}
