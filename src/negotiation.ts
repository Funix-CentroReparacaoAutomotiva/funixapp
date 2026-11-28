import type {BudgetPreview,NegotiationInput} from '../shared/pricing.ts'
import type {CommercialWorkspace} from '../shared/commercial.ts'
export interface NegotiationDraft {mode:'none'|'discount'|'discount_percent'|'adjust';value:string;acknowledgeResidual:boolean}
export const emptyNegotiation=():NegotiationDraft=>({mode:'none',value:'',acknowledgeResidual:false})
export function negotiationInput(draft:NegotiationDraft):NegotiationInput{
 if(draft.mode==='none')return {mode:'none'}
 const value=draft.value.trim().replace(',','.')
 if(/^0+(?:\.0+)?$/.test(value))return {mode:'none'}
 if(!/^\d{1,12}(?:\.\d{1,6})?$/.test(value))throw new Error(draft.mode==='discount_percent'?'Informe um percentual válido, com até seis casas.':'Informe um valor em reais, com vírgula ou ponto decimal e até seis casas.')
 if(draft.mode==='discount_percent'&&Number(value)>100)throw new Error('Informe um desconto entre 0% e 100%.')
 return {mode:draft.mode,value,acknowledgeResidual:draft.acknowledgeResidual,...(draft.mode==='adjust'?{valueIncludesComponents:true as const}:{})}
}
export interface NegotiationState {draft:NegotiationDraft;preview:BudgetPreview|null;signature:string;requestKey:string}
export const emptyNegotiationState=():NegotiationState=>({draft:emptyNegotiation(),preview:null,signature:'',requestKey:''})
export function negotiationSignature(workspace:CommercialWorkspace,draft:NegotiationDraft){
 return JSON.stringify({scenario:workspace.selectedId,composition:workspace.revision,configuration:workspace.configurationRevision,revision:workspace.scenarios.find(s=>s.id===workspace.selectedId)?.revision,draft})
}

// A neutral deal has no unsaved commercial effect; real/invalid drafts stay guarded.
export function negotiationIsDirty(draft:NegotiationDraft){
 try{return negotiationInput(draft).mode!=='none'}catch{return true}
}
