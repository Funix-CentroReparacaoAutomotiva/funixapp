/** Presentation only. Never changes persisted sequence, labels, numbers or snapshots. */
export function versionLabel(sequence:number){let n=sequence,label='';while(n>0){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26)}return label}
export interface HistoricalDocument {id:string;sequence:number;createdAt:string;scenarioId?:string|null;scenarioName?:string|null}
export function budgetHistory<T extends HistoricalDocument>(versions:T[]){
 const groups=new Map<string,{id:string;name:string;order:number;versions:(T&{scenarioVersion:string})[]}>()
 // Global emission sequence is stable even for identical timestamps.
 for(const v of [...versions].sort((a,b)=>a.sequence-b.sequence)){
  const id=v.scenarioId??'legacy:'+v.id
  let group=groups.get(id)
  if(!group){const number=/^Cenário (\d+)$/.exec(v.scenarioName??'');group={id,name:v.scenarioName??'Cenário histórico não identificado',order:number?Number(number[1]):Infinity,versions:[]};groups.set(id,group)}
  group.versions.push({...v,scenarioVersion:versionLabel(group.versions.length+1)})
 }
 return [...groups.values()].sort((a,b)=>a.order-b.order||a.versions[0]!.sequence-b.versions[0]!.sequence)
}
