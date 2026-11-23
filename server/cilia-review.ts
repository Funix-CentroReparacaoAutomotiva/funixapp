import {readCiliaBudgetXml} from './cilia-xml.ts'
import {suggestCiliaServices} from './cilia-service-rules.ts'
import {listCiliaDimensionCandidates} from './cilia-reconciliation.ts'
import {Q,sum} from './exact.ts'
import {ServiceError} from './errors.ts'

type CatalogEntry=Parameters<typeof suggestCiliaServices>[1][number]&Parameters<typeof listCiliaDimensionCandidates>[1][number]
type Steering=Parameters<typeof suggestCiliaServices>[2]
const invalid=():never=>{throw new ServiceError(422,'CILIA_SCOPE_INVALID','Composição Cilia incompleta ou incompatível com a origem.')}
const eq=(a:string,b:string)=>Q.from(a).cmp(Q.from(b))===0

/** Read-only review. Suggestions are not approved native composition. */
export function previewCiliaXml(bytes:Uint8Array,catalog:readonly CatalogEntry[],steering:Steering='unknown'){
 const source=readCiliaBudgetXml(bytes)
 const rows=source.items.map(item=>{
  const suggestion=suggestCiliaServices(item,catalog,steering)
  const operations=suggestion.operations.map(op=>({...op,candidates:op.candidates.map(c=>({...c,dimensions:listCiliaDimensionCandidates(c.serviceId,catalog)}))}))
  return {sourceId:item.id,piece:suggestion.piece,operations}
 })
 // Candidate clusters only; ambiguous rows are never automatically assigned.
 const byPiece=new Map<string,{pieceId:string;sourceRowIds:string[];operationIds:string[]}>()
 for(const row of rows){
  if(row.piece.candidates.length!==1||row.piece.classification==='R')continue
  const pieceId=row.piece.candidates[0]!.pieceId
  let g=byPiece.get(pieceId)
  if(!g){g={pieceId,sourceRowIds:[],operationIds:[]};byPiece.set(pieceId,g)}
  g.sourceRowIds.push(row.sourceId);g.operationIds.push(...row.operations.map(o=>o.sourceId))
 }
 const groupingCandidates=[...byPiece.values()].filter(g=>g.sourceRowIds.length>1)
  .map(g=>({...g,requiresScopeReview:true as const}))
 const components=source.items.filter(i=>i.typeKind==='part'&&i.rawFlags.troca).map(i=>({sourceId:i.id,description:i.name,code:i.code,quantity:i.quantity,scope:i.scope,supply:i.supplyKind,sourceUnitNet:i.netPrice}))
 return {kind:'cilia-review-v1' as const,source,rows,groupingCandidates,components,requiresOperatorReview:true as const,canWrite:false as const}
}

export type CiliaScopeReview={
 evidenceSha256:string;scopeReviewed:boolean;
 pieces:{pieceId:string;sourceRowIds:string[];diagnosisId:string|null;intensity:'leve'|'moderado'|'severo'|null;reason:string}[];
 groups:{operationIds:string[];options:{serviceId:string;dimensionId:string;quantity:string}[];reason:string}[]
}
/** Assemble a comparison-only neutral payload after explicit human scope
 * review. Every source row and operation is accounted for once; partner
 * components remain individual evidence, NEVER native billable components.
 * This payload is not an application command or an authorization receipt. */
export function assembleCiliaReviewedScope(bytes:Uint8Array,catalog:readonly CatalogEntry[],steering:Steering,review:CiliaScopeReview){
 const preview=previewCiliaXml(bytes,catalog,steering),source=preview.source
 if(!source.financialIntegrity||!source.calculated||review?.scopeReviewed!==true||review.evidenceSha256!==source.evidenceSha256)return invalid()
 if(!Array.isArray(review.pieces)||!review.pieces.length||review.pieces.length>250||!Array.isArray(review.groups)||review.groups.length>100)return invalid()
 const unique=(id:string,kind:string)=>{
  if(typeof id!=='string'||!id.trim())return invalid()
  const matches=catalog.filter(c=>c.id===id)
  if(matches.length!==1||matches[0]!.kind!==kind||!matches[0]!.active||!matches[0]!.name.trim()||(kind==='peca'&&!matches[0]!.code?.trim()))return invalid()
  return matches[0]!
 }
 const validReason=(v:unknown):v is string=>typeof v==='string'&&v.length<=500
 const rowMap=new Map(preview.rows.map(r=>[r.sourceId,r])),assigned=new Map<string,string>(),pieceIds=new Set<string>()
 const pieces=review.pieces.map((p,index)=>{
  if(!p||typeof p!=='object'||!validReason(p.reason))return invalid()
  unique(p.pieceId,'peca')
  if(pieceIds.has(p.pieceId)||!Array.isArray(p.sourceRowIds)||!p.sourceRowIds.length||![null,'leve','moderado','severo'].includes(p.intensity))return invalid()
  pieceIds.add(p.pieceId)
  if(p.diagnosisId!==null)unique(p.diagnosisId,'diagnostico')
  const id='piece-'+(index+1)
  for(const r of p.sourceRowIds){
   const row=rowMap.get(r)
   if(!row||assigned.has(r))return invalid()
   if((p.sourceRowIds.length>1||row.piece.state!=='candidate'||!row.piece.candidates.some(c=>c.pieceId===p.pieceId))&&!p.reason.trim())return invalid()
   assigned.set(r,id)
  }
  return {id,pieceId:p.pieceId,diagnosisId:p.diagnosisId,intensity:p.intensity,sourceRowIds:[...p.sourceRowIds],reason:p.reason.trim()}
 })
 if(assigned.size!==rowMap.size)return invalid()
 const opMap=new Map(preview.rows.flatMap(r=>r.operations.map(o=>[o.sourceId,{...o,sourceRowId:r.sourceId}] as const)))
 const used=new Set<string>()
 const operationClass=(k:string)=>k==='T'||k==='RI'?'assembly':k
 const groups=review.groups.map((g,index)=>{
  if(!g||typeof g!=='object'||!Array.isArray(g.operationIds)||!g.operationIds.length||!Array.isArray(g.options)||!g.options.length||g.options.length>20||typeof g.reason!=='string'||g.reason.length>500)return invalid()
  const ops=g.operationIds.map(id=>{const op=opMap.get(id);if(!op||used.has(id)||op.amount===null)return invalid();used.add(id);return op})
  const parents=new Set(ops.map(o=>assigned.get(o.sourceRowId))),classes=new Set(ops.map(o=>operationClass(o.kind)))
  if(parents.size!==1||classes.size!==1||(ops.length>1&&(ops.some(o=>o.kind==='manual')||!g.reason.trim())))return invalid()
  if(ops.some(o=>o.state!=='candidate')&&!g.reason.trim())return invalid()
  const options=g.options.map(o=>{
   if(!o||typeof o!=='object')return invalid()
   unique(o.serviceId,'servico')
   const dimension=unique(o.dimensionId,'dimensao')
   if(dimension.serviceId!==o.serviceId||typeof o.quantity!=='string'||!/^\d{1,9}(?:\.\d{1,6})?$/.test(o.quantity)||!Q.from(o.quantity).n)return invalid()
   // Explicit manual substitution needs a reason even for a single operation.
   if(ops.some(op=>!op.candidates.some(c=>c.serviceId===o.serviceId))&&!g.reason.trim())return invalid()
   return {serviceId:o.serviceId,dimensionId:o.dimensionId,quantity:Q.from(o.quantity).toString()}
  })
  if(new Set(options.map(o=>JSON.stringify(o))).size!==options.length)return invalid()
  return {id:'group-'+(index+1),diagnosisId:[...parents][0]!,operationIds:[...g.operationIds],sourceTotal:sum(ops.map(o=>Q.from(o.amount!))).toString(),options,reason:g.reason.trim()}
 })
 if(used.size!==opMap.size||!eq(sum(groups.map(g=>Q.from(g.sourceTotal))).toString(),source.calculated.labor))return invalid()
 const components=preview.components.map(c=>({...c,diagnosisId:assigned.get(c.sourceId)!,total:Q.from(c.quantity).mul(Q.from(c.sourceUnitNet)).toString()}))
 const partnerComponents=components.filter(c=>c.supply==='partner'),workshopComponents=components.filter(c=>c.supply==='workshop')
 if(components.length!==partnerComponents.length+workshopComponents.length||!eq(sum(partnerComponents.map(c=>Q.from(c.total))).toString(),source.calculated.partnerParts)||!eq(sum(workshopComponents.map(c=>Q.from(c.total))).toString(),source.calculated.workshopParts))return invalid()
 const issuer=source.identity.issuerTaxId.replace(/[.\/-]/g,'')
 if(!/^\d{14}$/.test(issuer))return invalid()
 // A grouped neutral service quantity of 1 represents one reviewed group
 // of source operations, NOT the quantity of native work (in mapping).
 const comparisonOnly={schema:1 as const,source:{provider:'cilia' as const,issuerKey:'cnpj:'+issuer,documentNumber:source.identity.number,revision:source.identity.revision,evidenceSha256:source.evidenceSha256,evidenceKind:'file-bytes' as const},metadata:{sourceStatus:source.identity.status,sourceAttendance:null,deadlineDays:null},totals:{servicesGross:source.calculated.labor,serviceDiscount:'0',components:source.calculated.workshopParts,total:source.calculated.workshopTotal},diagnoses:pieces.map(p=>({id:p.id,piece:unique(p.pieceId,'peca').name,position:null,damage:null,intensity:p.intensity})),services:groups.map(g=>({id:g.id,diagnosisId:g.diagnosisId,description:'Grupo de operações Cilia '+g.id,dimension:null,quantity:'1',quantityUnit:'operation' as const,unitPrice:g.sourceTotal,total:g.sourceTotal})),components:workshopComponents.map(c=>({id:c.sourceId,diagnosisId:c.diagnosisId,description:c.description,quantity:c.quantity,unitSalePrice:c.sourceUnitNet,total:c.total,billing:'funix' as const,supply:'funix' as const})),otherAmounts:[]}
 const mapping={diagnoses:pieces.map(p=>({sourceId:p.id,pieceId:p.pieceId,diagnosisId:p.diagnosisId,intensity:p.intensity})),services:groups.map(g=>({sourceId:g.id,options:g.options}))}
 return {kind:'cilia-scope-comparison-v1' as const,preview,comparisonOnly,mapping,sourceLinks:{pieces,groups,components},partnerComponents,blockers:['PREVIEW_ONLY',...(partnerComponents.length?['PARTNER_COMPONENT_PERSISTENCE_PENDING']:[])],requiresOperatorReview:true as const,canWrite:false as const}
}
