import type {CommercialWorkspace,PieceRemoval} from './commercial.ts'

export function removalRequest(w:CommercialWorkspace,codes:string[],identities:ReadonlyMap<string,string>):PieceRemoval{
 return{pieces:w.items.filter(p=>codes.some(code=>identities.get(code)===p.pieceId)).map(p=>({id:p.id,revision:p.revision})),compositionRevision:w.revision,scenarios:w.scenarios.map(s=>({id:s.id,revision:s.revision}))}
}
export function removalReview(w:CommercialWorkspace,codes:string[],identities:ReadonlyMap<string,string>){
 const pieces=w.items.filter(p=>codes.some(code=>identities.get(code)===p.pieceId)),ids=new Set(pieces.map(p=>p.id))
 const components=w.components.filter(c=>ids.has(c.pieceId)),affected=w.scenarios.filter(s=>pieces.some(p=>s.pieceFlags[p.id]))
 const others=affected.filter(s=>s.id!==w.selectedId),hasContent=pieces.some(p=>p.diagnosisId||p.notes.trim()||p.services.length)||components.length>0
 // Consent describes the target's content/participation, not unrelated edits.
 const signature=JSON.stringify({pieces,components,scenarios:w.scenarios.map(s=>({id:s.id,position:s.position,pieces:pieces.map(p=>[p.id,Boolean(s.pieceFlags[p.id]),p.services.map(l=>[l.id,Boolean(s.serviceFlags[l.id])])]),components:components.map(c=>[c.id,Boolean(s.componentFlags[c.id])])}))})
 return{codes:[...codes],positions:affected.map(s=>s.position),hasContent,required:others.length>0||hasContent,signature}
}
export type RemovalReview=ReturnType<typeof removalReview>
