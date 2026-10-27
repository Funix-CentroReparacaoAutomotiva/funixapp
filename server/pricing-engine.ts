import type { CatalogItem, DiagnosisItem, Scenario } from '../shared/commercial.ts'
import { catalogItemUsable, scenarioLabel } from '../shared/commercial.ts'
import type { Calculation, ComponentItem, Negotiation, PricedLine, PricingConfig, PricingSettings } from '../shared/pricing.ts'
import { Q,ZERO,sum } from './exact.ts'
import { inputObject,invalid } from './scenarios.ts'
import { decimal } from './pricing-config.ts'

export function negotiation(input:unknown):Negotiation {
 const n=inputObject(input,['mode','value','acknowledgeResidual'])
 if(n.mode==='none') {if(n.value!==undefined || n.acknowledgeResidual!==undefined)invalid('Não combine modalidades de negociação.');return {mode:'none'}}
 if(n.mode!=='discount' && n.mode!=='adjust')invalid('Modalidade de negociação inválida.')
 if(n.acknowledgeResidual!==undefined && typeof n.acknowledgeResidual!=='boolean')invalid('Ciência do resíduo inválida.')
 return {mode:n.mode,value:decimal(n.value),acknowledgeResidual:n.acknowledgeResidual===true}
}
function required(value:string|null|undefined,label:string):Q {if(value===null || value===undefined)throw new Error(label+' não configurado.');return Q.from(value)}

export function calculate(items:DiagnosisItem[],components:ComponentItem[],catalog:CatalogItem[],scenario:Scenario,config:PricingConfig,settings:PricingSettings,deal:Negotiation={mode:'none'}):Calculation {
 const lines:PricedLine[]=[],errors:string[]=[],byId=(id:string|null|undefined)=>catalog.find(c=>c.id===id)
 const table=config.tables.find(t=>t.id===settings.tableId),color=config.colors.find(t=>t.id===settings.colorId),risk=config.risks.find(t=>t.id===settings.riskId)
 const eligible=(id:string|null|undefined,kind:string)=>{const c=byId(id);if(!c || c.kind!==kind || !catalogItemUsable(c))throw new Error(`${kind} inativo ou sem identificação no catálogo.`);return c}
 for(const item of items){
  const piece=byId(item.pieceId),parent=Boolean(scenario.pieceFlags[item.id])
  for(const service of item.services){
   const enabled=parent && Boolean(scenario.serviceFlags[service.id])
   const line:PricedLine={id:service.id,pieceId:item.id,kind:'service',name:byId(service.serviceId)?.name ?? 'Serviço ausente',pieceName:piece?.name ?? 'Peça ausente',dimension:byId(service.dimensionId)?.name ?? 'Pendente',diagnosis:byId(service.diagnosisId ?? item.diagnosisId)?.name ?? '',notes:service.notes ?? '',quantity:service.quantity,included:enabled,unit:null,finalUnit:null,total:null,path:null,factors:{},stages:[],energy:null}
   lines.push(line)
   if(!enabled)continue
   try {
    eligible(item.pieceId,'peca');eligible(service.serviceId,'servico')
    const dimension=eligible(service.dimensionId,'dimensao')
    if(dimension.serviceId!==service.serviceId)throw new Error('Dimensão não pertence ao serviço.')
    if(service.diagnosisId || item.diagnosisId)eligible(service.diagnosisId ?? item.diagnosisId,'diagnostico')
    if(!table)throw new Error('Tabela comercial não selecionada/configurada.')
    const special=config.specialPrices.filter(p=>p.tableId===table.id && p.serviceId===service.serviceId && p.dimensionId===service.dimensionId)
    if(special.length>1)throw new Error('Preço especial duplicado para a chave exata.')
    let unit:Q
    const pricing=config.services.find(p=>p.serviceId===service.serviceId),dim=pricing?.dimensions.find(d=>d.dimensionId===service.dimensionId)
    if(special.length){unit=Q.from(special[0]!.unit).ceilUnit();line.path='special';line.factors={specialUnit:special[0]!.unit}}
    else {
     const base=required(pricing?.base,'Preço base'),fd=required(dim?.fd,'FD'),fv=required(table.factor,'FV'),fc=required(color?.factor,'FC'),fr=required(risk?.factor,'FR')
     unit=base.mul(fd).mul(fv).mul(fc).mul(fr).ceilUnit();line.path='normal';line.factors={base:base.toString(),FD:fd.toString(),FV:fv.toString(),FC:fc.toString(),FR:fr.toString()}
    }
    line.unit=unit.toString();line.finalUnit=line.unit;line.total=unit.mul(Q.from(service.quantity)).toString()
    // Energy is independent of commercial multipliers and special prices.
    if(!dim?.stages.length)throw new Error('Etapas técnicas de serviço/dimensão não configuradas.')
    line.stages=structuredClone(dim.stages)
    const energy=sum(dim.stages.map(stage=>required(stage.baseEnergy,`Energia base ${stage.name}`).add(required(stage.dimensionEnergy,`Energia dimensional ${stage.name}`)))).mul(Q.from(service.quantity))
    line.energy=energy.toString()
   }catch(cause){errors.push(`${line.pieceName} / ${line.name} (${line.id}): ${(cause as Error).message}`)}
  }
  for(const component of components.filter(c=>c.pieceId===item.id)){
   const enabled=parent && Boolean(scenario.componentFlags[component.id])
   const line:PricedLine={id:component.id,pieceId:item.id,kind:'component',name:component.name,pieceName:piece?.name ?? 'Peça ausente',dimension:'',diagnosis:'',notes:component.notes,quantity:component.quantity,included:enabled,unit:null,finalUnit:null,total:null,path:'manual',factors:{},stages:[],energy:'0'}
   lines.push(line)
   if(!enabled)continue
   try {
    eligible(item.pieceId,'peca')
    const price=required(component.manualPrice,'Preço manual do componente'),fct=required(component.fct,'FCT individual')
    line.factors={manualPrice:price.toString(),FCT:fct.toString()}
    const unit=price.mul(fct).ceilUnit();line.unit=unit.toString();line.finalUnit=line.unit;line.total=unit.mul(Q.from(component.quantity)).toString()
   }catch(cause){errors.push(`${line.name}: ${(cause as Error).message}`)}
  }
  if(parent && !lines.some(l=>l.pieceId===item.id && l.included))errors.push(`${piece?.name ?? 'Peça'}: nenhum serviço ou componente incluído.`)
 }
 const included=lines.filter(l=>l.included),services=included.filter(l=>l.kind==='service'),parts=included.filter(l=>l.kind==='component')
 if(!included.length)errors.push('Cenário sem linhas efetivas para emissão.')
 // Exact calculated outputs may have >6 decimal places; parse them without narrowing precision.
 const exact=(value:string)=>{const [w,f='']=value.split('.');return new Q(BigInt(w+f),10n**BigInt(f.length))}
 const totalRows=(rows:PricedLine[])=>rows.some(l=>l.total===null)?null:sum(rows.map(l=>exact(l.total!)))
 // The input parser is intentionally bounded; generated exact values use `exact` above.
 const serviceGross=totalRows(services),componentSubtotal=totalRows(parts)
 let discount=ZERO,residual=ZERO,target:Q|null=null
 if(deal.mode!=='none' && serviceGross){
  const value=exact(deal.value)
  if(deal.mode==='discount'){
   if(value.cmp(serviceGross)>0)errors.push('Desconto supera o subtotal de serviços.');else discount=value
  }else {
   target=value
   if(value.cmp(serviceGross)<=0)discount=serviceGross.sub(value)
   else if(serviceGross.n===0n || !services.length)errors.push('Ajuste positivo sem referência positiva de serviços exige revisão manual.')
   else {
    for(const line of services){const unit=exact(line.unit!).mul(value).div(serviceGross).ceilUnit();line.finalUnit=unit.toString();line.total=unit.mul(Q.from(line.quantity)).toString()}
    const last=services.at(-1)!,others=sum(services.slice(0,-1).map(l=>exact(l.total!))),desired=value.sub(others)
    // A positive adjustment must never reduce any original service unit.
    // If earlier unit ceilings overshoot the target, keep the last line at
    // its original unit and report the real residual for explicit acceptance.
    const minimum=exact(last.unit!),quantity=Q.from(last.quantity)
    if(desired.n>=0n){
     const grid=desired.div(quantity).mul(new Q(20n)),low=grid.floor(),high=grid.ceil()
     const choices=[minimum,...[low,high].filter(n=>n>=0n).map(n=>new Q(n,20n)).filter(n=>n.cmp(minimum)>=0)]
     choices.sort((a,b)=>a.mul(quantity).sub(desired).abs().cmp(b.mul(quantity).sub(desired).abs()))
     last.finalUnit=choices[0]!.toString();last.total=choices[0]!.mul(quantity).toString()
    } else {last.finalUnit=minimum.toString();last.total=minimum.mul(quantity).toString()}
    residual=value.sub(totalRows(services)!)
    if(residual.abs().cmp(Q.from('0.50'))>0)errors.push('Resíduo superior a R$ 0,50. Revise o valor ou os lançamentos manualmente.')
    else if(residual.n!==0n && !deal.acknowledgeResidual)errors.push('Confirme ciência explícita do resíduo e do total efetivo antes de emitir.')
   }
  }
 }
 const serviceSubtotal=totalRows(services),total=serviceSubtotal && componentSubtotal?serviceSubtotal.sub(discount).add(componentSubtotal):null
 const energy=included.some(l=>l.energy===null)?null:sum(included.map(l=>exact(l.energy!)))
 let days:string|null=null
 if(energy){if(config.capacity===null || Q.from(config.capacity).n===0n)errors.push('Capacidade diária global positiva não configurada.');else days=energy.div(Q.from(config.capacity)).ceil().toString()}
 const pieceTotals=items.map(item=>{const rows=included.filter(l=>l.pieceId===item.id);return {pieceId:item.id,total:!scenario.pieceFlags[item.id]?'0':!rows.length?null:totalRows(rows)?.toString()??null}})
 return {scenarioId:scenario.id,scenarioName:scenarioLabel(scenario),lines,pieceTotals,errors:[...new Set(errors)],originalServiceSubtotal:serviceGross?.toString()??null,serviceSubtotal:serviceSubtotal?.toString()??null,componentSubtotal:componentSubtotal?.toString()??null,discount:discount.toString(),total:total?.toString()??null,energy:energy?.toString()??null,days,negotiation:deal,residual:residual.toString(),target:target?.toString()??null}
}
