import {catalogItemUsable} from '../shared/commercial.ts'
import type {CatalogItem} from '../shared/commercial.ts'
import type {PricingConfiguration,PricingSettings} from '../shared/pricing.ts'
import type {CiliaScopeReview} from './cilia-review.ts'
import {compareCiliaReviewedBudget} from './cilia-comparison.ts'
import {previewCiliaXml} from './cilia-review.ts'
import {ServiceError} from './errors.ts'
const invalid=():never=>{throw new ServiceError(422,'CILIA_UPLOAD_INVALID','Envie um XML Cilia válido de até 512 KiB.')}
export function readCiliaUpload(raw:unknown):{bytes:Buffer;steering:'left'|'right'|'unknown'}{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalid()
 const r=raw as Record<string,unknown>
 if(Object.keys(r).length!==2||!Object.hasOwn(r,'xmlBase64')||!Object.hasOwn(r,'steering')||typeof r.xmlBase64!=='string'||r.xmlBase64.length>699052||!r.xmlBase64.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.xmlBase64))return invalid()
 const bytes=Buffer.from(r.xmlBase64,'base64')
 if(bytes.length>512*1024||bytes.toString('base64')!==r.xmlBase64)return invalid()
 const steering=r.steering
 if(steering!=='left'&&steering!=='right'&&steering!=='unknown')return invalid()
 return {bytes,steering}
}
const plate=(v:string|null)=>v?.toUpperCase().replace(/[\s-]/g,'')??''
export function consultCiliaUpload(raw:unknown,catalog:CatalogItem[],attendance:{id:string;plate:string;revision:number}){
 const {bytes,steering}=readCiliaUpload(raw),preview=previewCiliaXml(bytes,catalog,steering)
 const expected=plate(attendance.plate),actual=plate(preview.source.identity.plate)
 const valid=(v:string)=>/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v)
 const plateComparison=valid(expected)&&valid(actual)?expected===actual?'match':'mismatch':'unknown'
 return {preview,attendance:{id:attendance.id,plate:attendance.plate,revision:attendance.revision},plateComparison,catalog:catalog.filter(catalogItemUsable).map(({id,kind,name,code,serviceId})=>({id,kind,name,code,serviceId})),canWrite:false as const}
}

const reviewInvalid=():never=>{throw new ServiceError(422,'CILIA_SCOPE_INVALID','Confira as peças, operações e alternativas técnicas da revisão.')}
function object(raw:unknown,keys:string[]){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k)))return reviewInvalid()
 return raw as Record<string,unknown>
}
function id(raw:unknown):string{if(typeof raw!=='string'||!/^[A-Za-z0-9_.:-]{1,150}$/.test(raw))return reviewInvalid();return raw}
function reason(raw:unknown):string{if(typeof raw!=='string'||raw.length>500||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(raw))return reviewInvalid();return raw}
function ids(raw:unknown):string[]{if(!Array.isArray(raw)||!raw.length||raw.length>1000)return reviewInvalid();return raw.map(id)}
export function readCiliaScopeReview(raw:unknown):CiliaScopeReview{
 const r=object(raw,['evidenceSha256','scopeReviewed','pieces','groups'])
 if(typeof r.evidenceSha256!=='string'||!/^[a-f0-9]{64}$/.test(r.evidenceSha256)||r.scopeReviewed!==true||!Array.isArray(r.pieces)||!r.pieces.length||r.pieces.length>250||!Array.isArray(r.groups)||r.groups.length>100)return reviewInvalid()
 return {evidenceSha256:r.evidenceSha256,scopeReviewed:true,pieces:r.pieces.map(value=>{
  const p=object(value,['pieceId','sourceRowIds','diagnosisId','intensity','reason']),intensity=p.intensity
  if(intensity!==null&&intensity!=='leve'&&intensity!=='moderado'&&intensity!=='severo')return reviewInvalid()
  return {pieceId:id(p.pieceId),sourceRowIds:ids(p.sourceRowIds),diagnosisId:p.diagnosisId===null?null:id(p.diagnosisId),intensity,reason:reason(p.reason)}
 }),groups:r.groups.map(value=>{
  const g=object(value,['operationIds','options','reason'])
  if(!Array.isArray(g.options)||!g.options.length||g.options.length>20)return reviewInvalid()
  return {operationIds:ids(g.operationIds),reason:reason(g.reason),options:g.options.map(value=>{
   const o=object(value,['serviceId','dimensionId','quantity'])
   if(typeof o.quantity!=='string'||!/^\d{1,9}(?:\.\d{1,6})?$/.test(o.quantity))return reviewInvalid()
   return {serviceId:id(o.serviceId),dimensionId:id(o.dimensionId),quantity:o.quantity}
  })}
 })}
}
export function compareCiliaUpload(raw:unknown,catalog:CatalogItem[],attendance:{id:string;plate:string;revision:number},configuration:PricingConfiguration,state:{revision:number;settings:PricingSettings}){
 const r=object(raw,['xmlBase64','steering','review','attendanceRevision'])
 if(r.attendanceRevision!==attendance.revision)throw new ServiceError(409,'CILIA_ATTENDANCE_CHANGED','Atendimento alterado. Consulte novamente o XML.')
 const upload={xmlBase64:r.xmlBase64,steering:r.steering}
 const consultation=consultCiliaUpload(upload,catalog,attendance)
 if(consultation.plateComparison!=='match')throw new ServiceError(422,'CILIA_PLATE_REVIEW','A placa do XML deve coincidir com a placa cadastrada no Atendimento.')
 const review=readCiliaScopeReview(r.review),{bytes,steering}=readCiliaUpload(upload)
 const result=compareCiliaReviewedBudget(bytes,catalog,steering,review,configuration,state)
 return {state:result.state,financialMatch:result.financialMatch,calculation:result.calculation,selected:result.selected,blockers:result.blockers,externalServices:result.externalServices,groups:result.scope.sourceLinks.groups,configurationRevision:result.configurationRevision,settingsRevision:result.settingsRevision,canWrite:false as const}
}
