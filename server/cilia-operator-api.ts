import type {CatalogItem} from '../shared/commercial.ts'
import {previewCiliaXml} from './cilia-review.ts'
import {ServiceError} from './errors.ts'
const invalid=():never=>{throw new ServiceError(422,'CILIA_UPLOAD_INVALID','Envie um XML Cilia válido de até 512 KiB.')}
export function readCiliaUpload(raw:unknown){
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
 return {preview,attendance:{id:attendance.id,plate:attendance.plate,revision:attendance.revision},plateComparison,canWrite:false as const}
}
