import type {DiagnosisItem,DiagnosisService} from '../shared/commercial.ts'
import type {ComponentItem} from '../shared/pricing.ts'
export type CalculationState='current'|'pending'|'error'
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
export function pieceDataSignature(p:DiagnosisItem,ids=true){return JSON.stringify([p.diagnosisId,p.notes.trim(),persistedServices(p,ids,false)])}
export function pieceSignature(p:DiagnosisItem,ids=true){return JSON.stringify([p.diagnosisId,p.notes.trim(),p.enabled,persistedServices(p,ids,true)])}
export function partDataSignature(p:ComponentItem){return JSON.stringify([p.pieceId,p.name.trim(),normalized(p.quantity),p.manualPrice===null?null:normalized(p.manualPrice),p.notes.trim()])}
export function partSignature(p:ComponentItem&{enabled:boolean}){return JSON.stringify([partDataSignature(p),p.enabled])}
