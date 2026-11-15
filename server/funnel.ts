import type {DatabaseSync} from 'node:sqlite'
import type {Atendimento} from '../shared/contracts.ts'
import {ScenarioRepository} from './scenarios.ts'
import {CommercialRepository} from './commercial.ts'
import {ComponentRepository} from './components.ts'
import {PricingConfigurationRepository} from './pricing-config.ts'
import {BudgetRepository} from './budgets.ts'
import {ServiceError} from './errors.ts'
import {calculate} from './pricing-engine.ts'
import {Q} from './exact.ts'

/** Existing official rational engine; scenarios are alternatives, never added together. */
export function funnelProjection(db:DatabaseSync,items:Atendimento[]):Atendimento[] {
  const commercial=new CommercialRepository(db),pricing=new PricingConfigurationRepository(db),components=new ComponentRepository(db)
  const config=pricing.get().config,catalog=commercial.catalogs().items
  return items.map(item=>{
    const last=db.prepare('SELECT MAX(occurred_at) AS at FROM atendimento_contact_events WHERE atendimento_id=?').get(item.id)?.at
    const scenarios=new ScenarioRepository(db).list(item.id),values:string[]=[]
    let incomplete=false
    for(const scenario of scenarios){
      const diagnoses=commercial.list(item.id,scenario.id),draft=scenario.negotiationDraft
      try{
        const value=draft&&draft.mode!=='none'&&draft.value
          ? new BudgetRepository(db).preview(item.id,{scenarioId:scenario.id,negotiation:{mode:draft.mode,value:draft.value.replace(',','.'),acknowledgeResidual:true,...(draft.mode==='adjust'?{valueIncludesComponents:true}:{})}}).snapshot.calculation
          : calculate(diagnoses,components.list(item.id),catalog,scenario,config,pricing.settings(item.id).settings)
        if(value.lines.some(l=>l.included)){
          if(value.total===null||value.errors.length)incomplete=true
          else values.push(value.total)
        }
      }catch(error){
        // Invalid/incomplete saved negotiations have no authoritative value.
        if(error instanceof ServiceError&&[400,422].includes(error.status))incomplete=true
        else throw error
      }
    }
    // History is immutable. Without a current basis, use only the latest version
    // per scenario. An incomplete current scenario never falls back to a stale price.
    if(!values.length&&!incomplete){
      for(const row of db.prepare(`WITH ranked AS (
        SELECT json_extract(snapshot,'$.calculation.total') AS total,
        ROW_NUMBER() OVER(PARTITION BY json_extract(snapshot,'$.scenarioId') ORDER BY sequence DESC) AS rank
        FROM budget_versions WHERE atendimento_id=?) SELECT total FROM ranked WHERE rank=1 AND total IS NOT NULL`).all(item.id))values.push(String(row.total))
    }
    values.sort((a,b)=>Q.from(a).cmp(Q.from(b)))
    return {...item,lastContactAt:last?String(last):null,commercialValue:values.length&&!incomplete?{min:values[0]!,max:values.at(-1)!}:null}
  })
}
