import type {CommercialWorkspace,DiagnosisItem} from '../shared/commercial.ts'
import type {ComponentItem,PricingConfiguration} from '../shared/pricing.ts'
import type {CalculationState} from './calculation-state.ts'
import {partSignature} from './calculation-state.ts'

// Presentation of a configured factor only. No component price/rounding is computed here.
export function resalePercent(factor:string|null|undefined):string|null{
 if(typeof factor!=='string'||!/^\d{1,12}(?:\.\d{1,6})?$/.test(factor))return null
 const [whole,fraction='']=factor.split('.'),scale=10n**BigInt(fraction.length)
 const change=(BigInt(whole!)*scale+BigInt(fraction||'0')-scale)*100n,absolute=change<0n?-change:change
 const decimals=(absolute%scale).toString().padStart(fraction.length,'0').replace(/0+$/,'')
 return `${change<0n?'−':change>0n?'+':''}${absolute/scale}${decimals?','+decimals:''}%`
}
export function componentMR(workspace:CommercialWorkspace,configuration:PricingConfiguration|null){
 if(!workspace.settings.mrId)return{factor:null,label:'Não configurado'}
 const current=configuration?.revision===workspace.configurationRevision
 // Official calculation is also a source of the already applied global factor.
 const factor=current?configuration.config.resaleMultipliers?.find(m=>m.id===workspace.settings.mrId)?.factor:
  workspace.calculations.find(c=>c.scenarioId===workspace.selectedId)?.lines.find(l=>l.kind==='component'&&l.included&&l.factors.MR!==undefined)?.factors.MR
 const label=resalePercent(factor)
 return{factor:label===null?null:factor!,label:label??(current?'Não configurado':'Pendente')}
}
export function componentResult(part:ComponentItem&{enabled:boolean},piece:DiagnosisItem,workspace:CommercialWorkspace,parameterState:CalculationState,error:boolean,configuration:PricingConfiguration|null=null){
 const savedPiece=workspace.items.find(p=>p.id===piece.id),scene=workspace.scenarios.find(s=>s.id===workspace.selectedId),saved=workspace.components.find(p=>p.id===part.id)
 if(error||parameterState==='error')return{state:'error',text:'Valor não atualizado',value:null}as const
 const pending=!saved||!savedPiece||piece.enabled!==savedPiece.enabled||partSignature(part)!==partSignature({...saved,enabled:Boolean(scene?.componentFlags[part.id])})
 if(pending||parameterState==='pending')return{state:'pending',text:'Calculando…',value:null}as const
 if(!part.enabled||!piece.enabled)return{state:'excluded',text:'Fora do orçamento',value:null}as const
 const line=workspace.calculations.find(c=>c.scenarioId===workspace.selectedId)?.lines.find(l=>l.kind==='component'&&l.id===part.id&&l.pieceId===piece.id)
 if(line?.included&&line.total!==null)return{state:'current',text:null,value:line.total}as const
 if(part.manualPrice===null)return{state:'missing',text:'Preço não informado',value:null}as const
 if(!workspace.settings.mrId||configuration?.revision===workspace.configurationRevision&&componentMR(workspace,configuration).factor===null)return{state:'missing',text:'MR não configurado',value:null}as const
 return{state:'error',text:'Valor não atualizado',value:null}as const
}
