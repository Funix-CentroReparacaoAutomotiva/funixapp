import {CustomerRepository} from './customers.ts'
import{technicalGroups}from'./stage-allocation.ts'
import{CURATION_STAMP}from'./curation.ts'
import {createHash,randomUUID} from 'node:crypto'
import type {DatabaseSync,SQLOutputValue} from 'node:sqlite'
import type {BudgetPreview,BudgetSnapshot,BudgetVersion,Negotiation,NegotiationInput} from '../shared/pricing.ts'
import {AtendimentoRepository} from './atendimentos.ts'
import {CommercialRepository} from './commercial.ts'
import {ComponentRepository} from './components.ts'
import {PricingConfigurationRepository} from './pricing-config.ts'
import {ScenarioRepository,conflict,inputObject,invalid,selectedScenario,transaction} from './scenarios.ts'
import {calculate,negotiation} from './pricing-engine.ts'
import {ServiceError} from './errors.ts'
import {Q} from './exact.ts'
import{InstallmentRepository,executionDeadline,installmentSnapshot,budgetBlockingErrors}from'./budget-terms.ts'
import{hasIncludedPainting}from'../shared/budget-terms.ts'
import{toJsreportData,frozenTerms}from'./jsreport-adapter.ts'
import{configuredJsreport,renderJsreportPdf,validatePdf}from'./jsreport-client.ts'
import {scenarioLabel} from '../shared/commercial.ts'

import{versionLabel}from'../shared/budget-history.ts'
export{versionLabel}from'../shared/budget-history.ts'
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function commercialNumber(serial:number){return 'OR-'+String(serial).padStart(6,'0')}
export function budgetFilename(plate:string,serial:number){
 const normalized=plate.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'')
 return (normalized?normalized+' - ':'')+'Orçamento FUNIX - '+serial+'.pdf'
}
function record(row:Record<string,SQLOutputValue>):BudgetVersion{return {id:String(row.id),atendimentoId:String(row.atendimento_id),sequence:Number(row.sequence),label:String(row.label),createdAt:String(row.created_at),...(row.serial!=null?{documentNumber:commercialNumber(Number(row.serial)),filename:String(row.filename)}:{}),snapshot:JSON.parse(String(row.snapshot))}}
export interface BudgetOptions{render?:(version:BudgetVersion)=>Promise<Buffer>;now?:()=>number;leaseMs?:number}
export class BudgetRepository {
 readonly db:DatabaseSync
 readonly options:BudgetOptions
 constructor(db:DatabaseSync,options:BudgetOptions={}){this.db=db;this.options=options}
 private requestDeal(input: unknown): NegotiationInput {
  if (input && typeof input === 'object' && !Array.isArray(input) && 'valueIncludesComponents' in input) {
   const {valueIncludesComponents,...rest}=input as Record<string,unknown>
   const deal=negotiation(rest)
   if(valueIncludesComponents!==true || deal.mode!=='adjust')invalid('O total final negociado exige modo adjust.')
   return {...deal,valueIncludesComponents:true}
  }
  return negotiation(input)
 }
 private build(at:string,scenarioId:string,input:NegotiationInput):BudgetPreview{
  const atendimento=new CustomerRepository(this.db).present([new AtendimentoRepository(this.db).get(at)])[0]!,commercial=new CommercialRepository(this.db),pricing=new PricingConfigurationRepository(this.db)
  selectedScenario(this.db,at,scenarioId)
  const scenario=new ScenarioRepository(this.db).list(at).find(s=>s.id===scenarioId)!,items=commercial.list(at,scenario.id),components=new ComponentRepository(this.db).list(at),catalog=commercial.catalogs().items
  const state=pricing.settings(at),configuration=pricing.get()
  let deal:Negotiation=input,requestedTotal:string|undefined
  if('valueIncludesComponents' in input){
   requestedTotal=input.value
   const base=calculate(items,components,catalog,scenario,configuration.config,state.settings)
   if(base.componentSubtotal===null)invalid('Preço dos componentes pendente; não é possível negociar o total final.')
   const [w,f='']=base.componentSubtotal.split('.'),parts=new Q(BigInt(w+f),10n**BigInt(f.length))
   const target=Q.from(input.value).sub(parts)
   if(target.n<0n)invalid('Total negociado inferior ao subtotal dos componentes, que não pode ser ajustado.')
   deal={mode:'adjust',value:target.toString(),acknowledgeResidual:input.acknowledgeResidual}
  }
  const calculation=calculate(items,components,catalog,scenario,configuration.config,state.settings,deal)
  const referenced=new Set(items.flatMap(item=>[item.pieceId,item.diagnosisId,...item.services.flatMap(l=>[l.serviceId,l.dimensionId,l.diagnosisId])]).filter((v):v is string=>typeof v==='string'))
  const snapshot:BudgetSnapshot={schema:1,...(scenario.serviceConfirmations?{serviceConfirmations:structuredClone(scenario.serviceConfirmations)}:{}),commercialCuration:{...CURATION_STAMP},...(requestedTotal!==undefined?{requestedTotal}:{}),atendimento,composition:{items,components,catalog:catalog.filter(item=>referenced.has(item.id))},scenarioId:scenario.id,scenarioName:scenarioLabel(scenario),compositionRevision:state.revision,scenarioRevision:scenario.revision,configuration,settings:state.settings,calculation,conditions:configuration.config.conditions}
  snapshot.pdfPresentation={version:"technical-stage-v1",errors:technicalGroups(snapshot).errors}
  snapshot.executionDeadline=executionDeadline(scenario.deadline,calculation.days,hasIncludedPainting(items,scenario,calculation))
  if(calculation.total!==null)snapshot.installments=installmentSnapshot(calculation.total,new InstallmentRepository(this.db).get())
  return {snapshot,token:hash(snapshot),canEmit:budgetBlockingErrors(snapshot).length===0 && calculation.total!==null && snapshot.executionDeadline.effectiveDays!==null}
 }
 preview(at:string,input:unknown):BudgetPreview{
  const data=inputObject(input,['scenarioId','negotiation'])
  if(typeof data.scenarioId!=='string')invalid('Escolha um cenário para a prévia.')
  const id=data.scenarioId,deal=this.requestDeal(data.negotiation)
  return transaction(this.db,()=>this.build(at,id,deal))
 }
 // Transient renderer call: no reservation, INSERT, UPDATE or stored document.
 async previewPdf(at:string,input:unknown):Promise<Buffer>{
  const data=inputObject(input,['scenarioId','negotiation','previewToken'])
  const preview=this.preview(at,{scenarioId:data.scenarioId,negotiation:data.negotiation})
  if(preview.token!==data.previewToken)conflict()
  if(!preview.canEmit)throw new ServiceError(422,'BUDGET_INCOMPLETE',[...budgetBlockingErrors(preview.snapshot),...(preview.snapshot.executionDeadline?.effectiveDays===null?['Prazo de execução pendente.']:[])].join(' '))
  const version:BudgetVersion={id:randomUUID(),atendimentoId:at,sequence:0,label:'PRÉVIA',documentNumber:'PRÉVIA',createdAt:new Date((this.options.now??Date.now)()).toISOString(),snapshot:structuredClone(preview.snapshot)}
  version.snapshot.document={template:'FUNIX - Orcamento',data:toJsreportData(version)}
  const pdf=await(this.options.render?this.options.render(version):renderJsreportPdf(version,frozenTerms(version.snapshot),configuredJsreport()))
  validatePdf(pdf)
  if(pdf.length>15*1024*1024)throw new ServiceError(502,'PDF_TOO_LARGE','O gerador retornou um PDF maior que o permitido.')
  // Rendering must not hide changes made by another operator during HTTP.
  if(this.preview(at,{scenarioId:data.scenarioId,negotiation:data.negotiation}).token!==preview.token)conflict()
  return pdf
 }
 async emit(at:string,input:unknown):Promise<BudgetVersion>{
  const data=inputObject(input,['scenarioId','negotiation','previewToken','idempotencyKey'])
  if(typeof data.scenarioId!=='string'||typeof data.previewToken!=='string'||!/^[a-f0-9]{64}$/.test(data.previewToken)||typeof data.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(data.idempotencyKey))invalid('Emissão exige cenário, prévia e chave de requisição válidos.')
  const scenarioId=data.scenarioId,deal=this.requestDeal(data.negotiation),token=data.previewToken,key=data.idempotencyKey,requestHash=hash({scenarioId,deal,token}),now=this.options.now??Date.now,lease=randomUUID()
  const existing=()=>this.db.prepare('SELECT b.*,i.serial,i.filename FROM budget_versions b LEFT JOIN budget_document_identity i ON i.budget_version_id=b.id WHERE b.atendimento_id=? AND b.idempotency_key=?').get(at,key)
  const checkedPreview=()=>{
   const preview=this.build(at,scenarioId,deal)
   if(preview.token!==token)conflict()
   if(!preview.canEmit)throw new ServiceError(422,'BUDGET_INCOMPLETE',[...budgetBlockingErrors(preview.snapshot),...(preview.snapshot.executionDeadline?.effectiveDays===null?['Prazo de execução pendente: configure a estimativa técnica ou informe prazo manual válido.']:[])].join(' '))
   return preview
  }
  // Reserve under a short transaction. Failed attempts retain their serial permanently.
  const reserved=transaction(this.db,()=>{
   new AtendimentoRepository(this.db).get(at)
   const old=existing()
   if(old){if(old.request_hash!==requestHash)throw new ServiceError(409,'IDEMPOTENCY_CONFLICT','Esta chave já foi usada para outra emissão.');return{complete:record(old)}}
   let attempt=this.db.prepare('SELECT * FROM budget_emission_attempts WHERE atendimento_id=? AND idempotency_key=?').get(at,key)
   if(attempt&&attempt.request_hash!==requestHash)throw new ServiceError(409,'IDEMPOTENCY_CONFLICT','Esta chave já foi usada para outra emissão.')
   if(attempt&&attempt.state==='rendering'&&Number(attempt.lease_expires)>now())throw new ServiceError(409,'PDF_RENDER_IN_PROGRESS','Esta emissão está sendo processada. Aguarde e tente novamente com a mesma solicitação.')
   const preview=checkedPreview()
   if(!attempt){
    const createdAt=new Date(now()).toISOString(),id=randomUUID()
    const result=this.db.prepare("INSERT INTO budget_emission_attempts(atendimento_id,idempotency_key,request_hash,version_id,created_at,snapshot,state,lease_token,lease_expires)VALUES(?,?,?,?,?,?,'rendering',?,?)").run(at,key,requestHash,id,createdAt,JSON.stringify({...preview.snapshot,issuedAt:createdAt}),lease,now()+(this.options.leaseMs??30000))
    attempt=this.db.prepare('SELECT * FROM budget_emission_attempts WHERE serial=?').get(result.lastInsertRowid)!
   }else this.db.prepare("UPDATE budget_emission_attempts SET state='rendering',lease_token=?,lease_expires=? WHERE serial=?").run(lease,now()+(this.options.leaseMs??30000),attempt.serial!)
   const serial=Number(attempt.serial)
   if(!Number.isSafeInteger(serial)||serial<1)throw new ServiceError(503,'DOCUMENT_NUMBER_LIMIT','Não foi possível reservar um número comercial válido.')
   const snapshot=JSON.parse(String(attempt.snapshot))as BudgetSnapshot
   const version:BudgetVersion={id:String(attempt.version_id),atendimentoId:at,sequence:0,label:'',createdAt:String(attempt.created_at),documentNumber:commercialNumber(serial),filename:budgetFilename(snapshot.atendimento.plate,serial),snapshot}
   if(!snapshot.document){snapshot.document={template:'FUNIX - Orcamento',data:toJsreportData(version)};this.db.prepare('UPDATE budget_emission_attempts SET snapshot=? WHERE serial=?').run(JSON.stringify(snapshot),serial)}
   return{version,serial}
  })
  if(reserved.complete)return reserved.complete
  const {version,serial}=reserved
  try{
   // No SQLite transaction is held over HTTP. Only frozen data reaches the renderer.
   const pdf=await(this.options.render?this.options.render(structuredClone(version)):renderJsreportPdf(version,frozenTerms(version.snapshot),configuredJsreport()))
   validatePdf(pdf)
   if(pdf.length>15*1024*1024)throw new ServiceError(502,'PDF_TOO_LARGE','O gerador retornou um PDF maior que o permitido.')
   return transaction(this.db,()=>{
    const attempt=this.db.prepare('SELECT state,lease_token,lease_expires FROM budget_emission_attempts WHERE serial=?').get(serial)!
    if(attempt.state!=='rendering'||attempt.lease_token!==lease||Number(attempt.lease_expires)<=now())throw new ServiceError(409,'PDF_LEASE_EXPIRED','A tentativa de emissão expirou. Confira e repita a mesma solicitação.')
    checkedPreview()
    const sequence=Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM budget_versions WHERE atendimento_id=?').get(at)!.sequence)
    const issued={...version,sequence,label:versionLabel(sequence)}
    this.db.prepare('INSERT INTO budget_versions(id,atendimento_id,sequence,label,created_at,snapshot,pdf,idempotency_key,request_hash)VALUES(?,?,?,?,?,?,?,?,?)').run(issued.id,at,sequence,issued.label,issued.createdAt,JSON.stringify(issued.snapshot),pdf,key,requestHash)
    this.db.prepare('INSERT INTO budget_document_identity(serial,budget_version_id,filename)VALUES(?,?,?)').run(serial,issued.id,issued.filename!)
    this.db.prepare("UPDATE budget_emission_attempts SET state='issued',lease_expires=0 WHERE serial=? AND lease_token=?").run(serial,lease)
    return issued
   })
  }catch(error){
   transaction(this.db,()=>{this.db.prepare("UPDATE budget_emission_attempts SET state='failed',lease_expires=0 WHERE serial=? AND lease_token=? AND state='rendering'").run(serial,lease)})
   throw error
  }
 }

 list(at:string){new AtendimentoRepository(this.db).get(at);return this.db.prepare("SELECT b.id,b.atendimento_id AS atendimentoId,b.sequence,b.label,b.created_at AS createdAt,json_extract(b.snapshot,'$.calculation.total') AS total,i.serial,i.filename,json_extract(b.snapshot,'$.scenarioName') AS scenarioName,json_extract(b.snapshot,'$.scenarioId') AS scenarioId FROM budget_versions b LEFT JOIN budget_document_identity i ON i.budget_version_id=b.id WHERE b.atendimento_id=? ORDER BY b.sequence DESC").all(at).map(row=>({...row,...(row.serial==null?{}:{documentNumber:commercialNumber(Number(row.serial))})}))}
 get(at:string,id:string):BudgetVersion{const row=this.db.prepare('SELECT b.id,b.atendimento_id,b.sequence,b.label,b.created_at,b.snapshot,i.serial,i.filename FROM budget_versions b LEFT JOIN budget_document_identity i ON i.budget_version_id=b.id WHERE b.atendimento_id=? AND b.id=?').get(at,id);if(!row)throw new ServiceError(404,'NOT_FOUND','Versão não encontrada neste Atendimento.');return record(row)}
 pdf(at:string,id:string):Buffer{this.get(at,id);const row=this.db.prepare('SELECT pdf FROM budget_versions WHERE atendimento_id=? AND id=?').get(at,id)!;return Buffer.from(row.pdf as Uint8Array)}
}
