import{pdfStage}from'./pdf-text.ts'
// PDF presentation only. Official prices/energy/discounts are never recalculated.
import{Q}from'./exact.ts'
import{exactAmount,centAmount}from'./budget-terms.ts'
import{stagePresentation,clusterName}from'./stage-presentation.ts'
import{STAGE_CLUSTERS,type StageCluster}from'../shared/stage-clusters.ts'
import type{BudgetSnapshot,PricedLine}from'../shared/pricing.ts'
export interface TechnicalGroup{pieceId:string;diagnosisId:string|null;rows:PricedLine[];unallocated:PricedLine[];categories:{name:StageCluster;amount:Q;billable:boolean;descriptions:string[]}[]}
export function technicalGroups(snapshot:BudgetSnapshot):{groups:TechnicalGroup[];errors:string[]}{
 const grouped=new Map<string,TechnicalGroup>(),errors:string[]=[]
 const pending=(line:PricedLine,reason:string)=>errors.push(`PDF: ${line.pieceName} / ${line.name} (${line.id}): ${reason}`)
 for(const line of snapshot.calculation.lines.filter(l=>l.included)){
  const item=snapshot.composition.items.find(i=>i.id===line.pieceId),master=item?.services.find(s=>s.id===line.id)
  const diagnosisId=(line.kind==='service'?master?.diagnosisId:null)??item?.diagnosisId??null,key=JSON.stringify([line.pieceId,diagnosisId])
  let group=grouped.get(key);if(!group){group={pieceId:line.pieceId,diagnosisId,rows:[],unallocated:[],categories:[]};grouped.set(key,group)}group.rows.push(line)
  if(line.kind!=='service')continue
  if(!master||!master.dimensionId){pending(line,'origem serviço/dimensão ausente.');group.unallocated.push(line);continue}
  if(!line.stages.length){pending(line,'etapas técnicas não configuradas para a apresentação.');group.unallocated.push(line);continue}
  const seen=new Set<string>(),stages=[]
  for(const stage of line.stages){
   const p=stagePresentation(stage,master.serviceId,master.dimensionId),category=clusterName(p?.cluster)
   if(!category){pending(line,`categoria ausente/não reconhecida na etapa ${stage.id}.`);continue}
   const identity=p?.stageId?JSON.stringify([p.stageId,p.stageDimensionId]):stage.id
   if(seen.has(identity)){pending(line,`etapa técnica duplicada ${stage.id}; rateio não executado.`);continue}seen.add(identity)
   if(stage.baseEnergy===null||stage.dimensionEnergy===null){pending(line,`energia da etapa ${stage.id} ausente.`);continue}
   try{const energy=Q.from(stage.baseEnergy).add(Q.from(stage.dimensionEnergy));stages.push({stage,category,energy,order:p?.order??Number.MAX_SAFE_INTEGER})}
   catch{pending(line,`energia da etapa ${stage.id} inválida.`)}
  }
  if(stages.length!==line.stages.length){group.unallocated.push(line);continue}
  const totalEnergy=stages.reduce((v,s)=>v.add(s.energy),new Q(0n)),billable=line.billing!=='not_billed'
  if(billable&&totalEnergy.n===0n){pending(line,'energia total das etapas igual a zero; não existe proporção financeira válida.');group.unallocated.push(line);continue}
  if(billable&&line.total===null){pending(line,'valor comercial efetivo indisponível.');group.unallocated.push(line);continue}
  // Quantity is already in line.total. Using per-unit energies keeps it from being applied twice.
  for(const s of stages.sort((a,b)=>a.order-b.order||a.stage.id.localeCompare(b.stage.id))){
   let category=group.categories.find(g=>g.name===s.category)
   if(!category){category={name:s.category,amount:new Q(0n),billable:false,descriptions:[]};group.categories.push(category)}
   if(billable){category.amount=category.amount.add(exactAmount(line.total!).mul(s.energy).div(totalEnergy));category.billable=true}
   const label=pdfStage(s.stage.name)
   if(label&&!category.descriptions.some(existing=>existing.toLocaleLowerCase('pt-BR')===label.toLocaleLowerCase('pt-BR')))category.descriptions.push(label)
  }
 }
 for(const group of grouped.values())group.categories.sort((a,b)=>STAGE_CLUSTERS.indexOf(a.name)-STAGE_CLUSTERS.indexOf(b.name))
 return{groups:[...grouped.values()],errors:[...new Set(errors)]}
}
// Cent presentation by largest remainders, per diagnosis, without a service/discount redistribution.
// All arithmetic stays rational; periodic ratios never pass through Number or Q.toString().
export function categoryCents(categories:TechnicalGroup['categories']):Map<StageCluster,Q>{
 const rows=categories.filter(c=>c.billable).map((c,i)=>{const scaled=c.amount.mul(new Q(100n)),floor=scaled.floor();return{name:c.name,i,cents:floor,remainder:scaled.sub(new Q(floor))}})
 const exact=categories.reduce((s,c)=>s.add(c.amount),new Q(0n)),rounded=BigInt(centAmount(exact).replace('.',''))
 let missing=rounded-rows.reduce((s,r)=>s+r.cents,0n)
 const priority=[...rows].sort((a,b)=>b.remainder.cmp(a.remainder)||a.i-b.i)
 for(const row of priority){if(missing<=0n)break;row.cents++;missing--}
 if(missing!==0n)throw Error('Rateio de apresentação inconsistente.')
 return new Map(rows.map(r=>[r.name,new Q(r.cents,100n)]))
}
