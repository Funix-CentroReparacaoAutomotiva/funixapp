import {createHash} from 'node:crypto'
import {ServiceError} from './errors.ts'
import {gmailFactFields,gmailFactLabels} from '../shared/gmail-analysis.ts'
import type {GmailAttachment,GmailExtraction,GmailContextRecord,GmailContext,GmailAnalysisResult,GmailFactField,GmailFact} from '../shared/gmail-analysis.ts'
import type {UpdatePackageProposal} from '../shared/update-packages.ts'
export type AnalysisMessage={accountId:string,messageId:string,subject:string,body:string,attachments:GmailAttachment[]}
export type ContextQuery={processId?:string,experienceId?:string,plate?:string,budgetId?:string,selectedRowId?:string}
export interface GmailAnalysisProviders{
 readMessage(messageId:string,signal:AbortSignal):Promise<AnalysisMessage>
 interpret(message:AnalysisMessage,signal:AbortSignal):Promise<unknown>
 lookup(query:ContextQuery,signal:AbortSignal):Promise<GmailContextRecord[]>
}
export const analysisHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const analysisError=(code:string,status=422):never=>{throw new ServiceError(status,code,'Não foi possível concluir a análise. Confira a pendência e tente novamente.')}
const object=(x:unknown):x is Record<string,unknown>=>Boolean(x&&typeof x==='object'&&!Array.isArray(x))
const text=(x:unknown,max:number):x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=max
export function validateAnalysisMessage(message:AnalysisMessage,id:string):AnalysisMessage{
 if(!object(message)||message.messageId!==id||!text(message.accountId,100)||typeof message.subject!=='string'||message.subject.length>500||!text(message.body,50000)||!Array.isArray(message.attachments)||message.attachments.length>40)analysisError('GMAIL_ANALYSIS_SOURCE_INVALID')
 const seen=new Set<string>()
 for(const a of message.attachments){
  if(!object(a)||Object.keys(a).sort().join(',')!=='attachmentId,digest,mime,name,size'||!text(a.attachmentId,200)||!text(a.name,250)||!text(a.mime,100)||!Number.isSafeInteger(a.size)||a.size<0||(a.digest!==null&&(!text(a.digest,64)||!/^[a-f0-9]{64}$/.test(a.digest)))||seen.has(a.attachmentId))analysisError('GMAIL_ANALYSIS_ATTACHMENTS_INVALID')
  seen.add(a.attachmentId)
 }
 return message
}
export function validateExtraction(output:unknown,message:AnalysisMessage):GmailExtraction{
 if(!object(output)||Object.keys(output).join(',')!=='claims'||!Array.isArray(output.claims)||output.claims.length>gmailFactFields.length)analysisError('GMAIL_ANALYSIS_MODEL_INVALID')
 const claims=(output as {claims:unknown[]}).claims,seen=new Set<string>()
 const facts:GmailFact[]=claims.map(raw=>{
  if(!object(raw)||Object.keys(raw).sort().join(',')!=='end,field,part,provenance,start,value'||typeof raw.field!=='string'||!gmailFactFields.includes(raw.field as GmailFactField)||seen.has(raw.field)||!text(raw.value,300)||!['declared','inferred'].includes(String(raw.provenance))||!['subject','body'].includes(String(raw.part))||!Number.isSafeInteger(raw.start)||!Number.isSafeInteger(raw.end))analysisError('GMAIL_ANALYSIS_MODEL_INVALID')
  const c=raw as {field:GmailFactField,value:string,part:'subject'|'body',provenance:'declared'|'inferred',start:number,end:number}
  const original=message[c.part]
  if(c.start<0||c.end<=c.start||c.end>original.length||c.end-c.start>600)analysisError('GMAIL_ANALYSIS_EVIDENCE_INVALID')
  const quote=original.slice(c.start,c.end)
  if(c.provenance==='declared'&&!quote.includes(c.value))analysisError('GMAIL_ANALYSIS_UNGROUNDED_VALUE')
  seen.add(c.field)
  return {field:c.field,value:c.value,provenance:c.provenance,evidence:{part:c.part,start:c.start,end:c.end,quote}}
 })
 for(const field of gmailFactFields)if(!seen.has(field))facts.push({field,value:null,provenance:'unknown',evidence:null})
 return {source:{accountId:message.accountId,messageId:message.messageId,subject:message.subject,digest:analysisHash(message),attachments:structuredClone(message.attachments)},facts}
}
export function declared(extraction:GmailExtraction,field:GmailFactField){return extraction.facts.find(f=>f.field===field&&f.provenance==='declared')?.value??undefined}
export function contextQuery(extraction:GmailExtraction,answers:Record<string,string>):ContextQuery{
 const processId=answers.processId||declared(extraction,'processId'),experienceId=declared(extraction,'experienceId'),plate=declared(extraction,'plate'),budgetId=declared(extraction,'budgetId')
 return {...(processId?{processId}:{}),...(experienceId?{experienceId}:{}),...(plate?{plate}:{}),...(budgetId?{budgetId}:{}),...(answers.contextSelection?{selectedRowId:answers.contextSelection}:{})}
}
export function validateContext(candidates:GmailContextRecord[],extraction:GmailExtraction,answers:Record<string,string>,observedAt:string):GmailContext{
 const keys=['rowId','processId','experienceId','plate','vehicle','partner','budgetId','budgetVersion']
 if(!Array.isArray(candidates)||candidates.length>20||new Set(candidates.map(r=>r?.rowId)).size!==candidates.length)analysisError('GMAIL_ANALYSIS_CONTEXT_INVALID')
 for(const r of candidates){
  if(!object(r)||Object.keys(r).sort().join(',')!==keys.sort().join(',')||!/^i-[A-Za-z0-9_-]{1,100}$/.test(r.rowId)||keys.filter(k=>k!=='rowId').some(k=>r[k as keyof GmailContextRecord]!==null&&!text(r[k as keyof GmailContextRecord],300)))analysisError('GMAIL_ANALYSIS_CONTEXT_INVALID')
 }
 const query=contextQuery(extraction,answers)
 const selected=answers.contextSelection?candidates.find(r=>r.rowId===answers.contextSelection)??null:candidates.length===1?candidates[0]!:null
 const conflicts:string[]=[]
 if(selected){
  for(const field of ['processId','experienceId','plate','budgetId','budgetVersion','vehicle','partner'] as const){
   const value=declared(extraction,field)||(field==='processId'?answers.processId:undefined)
   const actual=selected[field]
   if(value&&actual&&value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,'')!==actual.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,''))conflicts.push(gmailFactLabels[field]+': e-mail e ERP divergem.')
  }
 }
 const strong=Boolean(selected&&((query.processId&&query.processId===selected.processId)||(query.experienceId&&query.experienceId===selected.experienceId)||(query.budgetId&&query.budgetId===selected.budgetId)))
 const status:GmailContext['status']=!candidates.length?'not_found':!selected?'ambiguous':conflicts.length?'conflict':strong||Boolean(answers.contextSelection)?'matched':'needs_identity'
 return {status,candidates:structuredClone(candidates),selected:status==='matched'?structuredClone(selected):null,observedAt,digest:analysisHash(candidates),conflicts,humanSelection:answers.contextSelection??null}
}
export function buildAnalysisProposal(result:GmailAnalysisResult,generation:number):UpdatePackageProposal{
 const {extraction,context,clarifications}=result,missingFields:UpdatePackageProposal['missingFields']=[]
 if(context.status==='ambiguous'||context.status==='needs_identity')missingFields.push({key:'contextSelection',label:'Escolher o registro do ERP após conferência',hint:'A seleção é humana; confira o processo e o veículo.',options:context.candidates.map(r=>({value:r.rowId,label:[r.processId,r.experienceId,r.plate,r.rowId].filter(Boolean).join(' · ').slice(0,180)}))})
 if(context.status==='not_found')missingFields.push({key:'processId',label:'Processo para nova consulta',hint:'Informe a referência correta. Nenhum registro será criado.'})
 if(context.status==='conflict'&&clarifications.conflictReview!=='reviewed')missingFields.push({key:'conflictReview',label:'Conferir as divergências',hint:'A aprovação é apenas das providências de conferência.',options:[{value:'reviewed',label:'Conferido: manter divergências explícitas'}]})
 return {source:'gmail',sourceReference:extraction.source.messageId,experienceId:context.selected?.experienceId&&/^XP[0-9]{3,8}$/.test(context.selected.experienceId)?context.selected.experienceId:null,plate:context.selected?.plate&&/^[A-Z0-9-]{7,9}$/.test(context.selected.plate)?context.selected.plate:null,
  title:('Providências para '+(declared(extraction,'processId')||context.selected?.processId||'e-mail autorizado')+' · revisão '+generation).slice(0,200),
  summary:result.summary.slice(0,1000),missingFields,
  actions:[{id:'review:authorization',type:'other',title:'Conferir autorização e escopo',detail:'Revisar a declaração do e-mail e suas condições. Não altera o orçamento ou o reparo.'},
   {id:'review:planning',type:'other',title:'Validar programação com a operação',detail:'Data de início, capacidade, peças e entrega não estão confirmadas por esta análise.'},
   {id:'review:response',type:'other',title:'Preparar retorno ao parceiro',detail:'Providência para revisão humana. Nenhum e-mail será enviado ou agendado.'}]
 }
}
