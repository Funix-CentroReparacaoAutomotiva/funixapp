import type {DiagnosisItem,DiagnosisService} from '../shared/commercial.ts'
import type {ComponentItem} from '../shared/pricing.ts'
export type CalculationState='current'|'pending'|'incomplete'|'missing'|'error'
// Compare input identities/attributes only. All monetary calculation stays in the API.
const normalized=(v:string)=>v.trim().replace(',','.').replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'')
export function serviceInputs(piece:DiagnosisItem|undefined,line:DiagnosisService|undefined){
 if(!piece||!line)return null
 return JSON.stringify([piece.enabled,piece.diagnosisId,line.serviceId,line.dimensionId,normalized(line.quantity),line.enabled,line.diagnosisId??null])
}
export function servicePending(piece:DiagnosisItem,line:DiagnosisService,saved:DiagnosisItem|undefined){return serviceInputs(piece,line)!==serviceInputs(saved,saved?.services.find(l=>l.id===line.id))}
export function diagnosisPending(piece:DiagnosisItem,parts:(ComponentItem&{enabled:boolean})[],saved:DiagnosisItem|undefined,savedParts:(ComponentItem&{enabled:boolean})[]){
 const components=(list:(ComponentItem&{enabled:boolean})[])=>JSON.stringify(list.map(p=>[p.id,p.name,normalized(p.quantity),p.manualPrice===null?null:normalized(p.manualPrice),p.enabled]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))
 return !saved||piece.services.length!==saved.services.length||piece.enabled!==saved.enabled||piece.services.some(l=>servicePending(piece,l,saved))||components(parts)!==components(savedParts)
}

// Stable persisted inputs: revisions/timestamps and object property order are not edits.
function persistedServices(p:DiagnosisItem,ids:boolean,flags:boolean){
 return p.services.map(l=>JSON.stringify([...(ids?[l.id]:[]),l.serviceId,l.dimensionId,normalized(l.quantity),(l.notes??'').trim(),l.diagnosisId??null,...(flags?[l.enabled]:[])])).sort()
}
export function pieceDataSignature(p:DiagnosisItem,ids=true){return JSON.stringify([p.diagnosisId,p.intensity??null,p.notes.trim(),persistedServices(p,ids,false)])}
export function pieceSignature(p:DiagnosisItem,ids=true){return JSON.stringify([p.diagnosisId,p.intensity??null,p.notes.trim(),p.enabled,persistedServices(p,ids,true)])}
export function partDataSignature(p:ComponentItem){return JSON.stringify([p.pieceId,p.name.trim(),normalized(p.quantity),p.manualPrice===null?null:normalized(p.manualPrice),p.notes.trim()])}
export function partSignature(p:ComponentItem&{enabled:boolean}){return JSON.stringify([partDataSignature(p),p.enabled])}

// Form completeness only: no pricing formulas or default commercial values.
export const validQuantity=(v:string)=>/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(v.trim().replace(',','.'))&&/[1-9]/.test(v)
export const validManualPrice=(v:string|null)=>v===null||/^\d{1,12}(?:\.\d{1,6})?$/.test(v.trim().replace(',','.'))
export function serviceIncomplete(line:DiagnosisService){return !line.serviceId||!line.dimensionId||!validQuantity(line.quantity)}
export function componentIncomplete(part:ComponentItem){return !part.name.trim()||!validQuantity(part.quantity)||!validManualPrice(part.manualPrice)}
export function draftIncomplete(piece:DiagnosisItem,parts:(ComponentItem&{enabled?:boolean})[]){
 const unsavedInput=piece.services.some(l=>!l.serviceId||!validQuantity(l.quantity))||parts.some(componentIncomplete)
 return unsavedInput||piece.enabled&&piece.services.some(l=>l.enabled&&!l.dimensionId)
}
export function calculationLabel(state:CalculationState){return state==='pending'?'Calculando…':state==='incomplete'?'Rascunho incompleto':state==='missing'?'Configuração pendente':state==='error'?'Valor não atualizado':''}
