import {createHash} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {AtendimentoRepository} from './atendimentos.ts'
import {CommercialRepository} from './commercial.ts'
import {ScenarioRepository,transaction} from './scenarios.ts'
import {PricingConfigurationRepository} from './pricing-config.ts'
import {assembleCiliaReviewedScope} from './cilia-review.ts'
import {consultCiliaUpload,readCiliaScopeReview,readCiliaUpload} from './cilia-operator-api.ts'
import {planExternalBudget} from './external-budget-plan.ts'
import {servicePolicy} from '../shared/commercial-curation.ts'
import {applyReviewedExternalPlan,createExternalBudgetApplicationSchema} from './external-budget-application.ts'
import {ServiceError} from './errors.ts'
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const fail=(status:number,code:string,message:string):never=>{throw new ServiceError(status,code,message)}
const conflict=()=>fail(409,'CILIA_IMPORT_CONFLICT','Origem, revisão ou composição mudou. Consulte novamente; complementos exigem revisão separada.')
const invalid=()=>fail(422,'CILIA_CONFIRMATION_REQUIRED','Confirme identidade, autorização documental, escopo e valores.')
const has=(db:DatabaseSync)=>!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cilia_import_events'").get()

/** Opt-in additive audit schema; no startup migration unless explicitly enabled.
 * Unique issuer/event blocks a second budget for the same sinistro until
 * complement/replacement semantics are implemented. */
export function createCiliaApplicationSchema(db:DatabaseSync){
 createExternalBudgetApplicationSchema(db)
 transaction(db,()=>db.exec(
  'CREATE TABLE IF NOT EXISTS cilia_import_events (issuer_key TEXT NOT NULL,event_key TEXT NOT NULL,receipt_id TEXT NOT NULL UNIQUE REFERENCES external_budget_receipts(id) ON DELETE RESTRICT,PRIMARY KEY(issuer_key,event_key));'+
  "CREATE TRIGGER IF NOT EXISTS immutable_cilia_event_update BEFORE UPDATE ON cilia_import_events BEGIN SELECT RAISE(ABORT,'Cilia receipt is immutable');END;"+
  "CREATE TRIGGER IF NOT EXISTS immutable_cilia_event_delete BEFORE DELETE ON cilia_import_events BEGIN SELECT RAISE(ABORT,'Cilia receipt is immutable');END;"
 ))
}
function fields(raw:unknown,keys:string[]){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k)))return invalid()
 return raw as Record<string,unknown>
}
const baseKeys=['xmlBase64','steering','review','attendanceRevision']
export class CiliaApplication {
 readonly db:DatabaseSync
 constructor(db:DatabaseSync){this.db=db}
 private ready(){if(!has(this.db))fail(503,'CILIA_WRITE_DISABLED','Gravação Cilia ainda não habilitada.')}
 private inspect(atId:string,r:Record<string,unknown>){
  const at=new AtendimentoRepository(this.db).get(atId),commercial=new CommercialRepository(this.db),pricing=new PricingConfigurationRepository(this.db),scenarios=new ScenarioRepository(this.db)
  if(at.revision!==r.attendanceRevision) return conflict()
  const upload={xmlBase64:r.xmlBase64,steering:r.steering},catalog=commercial.catalogs().items,consultation=consultCiliaUpload(upload,catalog,at)
  if(consultation.plateComparison!=='match')return fail(422,'CILIA_PLATE_REVIEW','A placa do XML deve coincidir com a do Atendimento.')
  const review=readCiliaScopeReview(r.review),{bytes,steering}=readCiliaUpload(upload)
  const scope=assembleCiliaReviewedScope(bytes,catalog,steering,review),source=scope.comparisonOnly
  const event=scope.preview.source.identity.event?.normalize('NFKC').trim().replace(/[\s.\-\/]/g,'').toUpperCase()??''
  if(!event||event.length>150||! /^[A-Z0-9]+$/.test(event))return fail(422,'CILIA_EVENT_REVIEW','Identificador do sinistro exige conferência.')
  const s=source.source,requestDigest=hash({atId,hash:s.evidenceSha256,steering,review})
  const prior=this.db.prepare('SELECT r.* FROM cilia_import_events e JOIN external_budget_receipts r ON r.id=e.receipt_id WHERE e.issuer_key=? AND e.event_key=?').get(s.issuerKey,event)
  const byDocument=this.db.prepare("SELECT id FROM external_budget_receipts WHERE provider='cilia' AND issuer_key=? AND document_number=?").get(s.issuerKey,s.documentNumber)
  if(prior||byDocument){
   if(!prior||!byDocument||prior.id!==byDocument.id||prior.atendimento_id!==atId||prior.request_digest!==requestDigest)return conflict()
   if(!this.db.prepare('SELECT 1 FROM scenarios WHERE id=? AND atendimento_id=?').get(prior.scenario_id!,atId))return conflict()
   return {state:'existing' as const,previewToken:String(prior.preview_token),record:{id:String(prior.id),scenarioId:String(prior.scenario_id),result:JSON.parse(String(prior.result_json)) as unknown}}
  }
  const config=pricing.get(),settings=pricing.settings(atId),result=planExternalBudget(source,scope.mapping,catalog,config,settings,{ciliaComparisonOnly:true})
  if(result.state!=='matched'||!('plan' in result))return {state:'blocked' as const,issues:result.issues}
  const plan=result.plan,master=new Set(commercial.list(atId).map(i=>i.pieceId))
  if(plan.items.some(i=>master.has(i.pieceId)))return {state:'blocked' as const,issues:['EXISTING_NATIVE_PIECE_CONFLICT']}
  if(plan.items.some(i=>i.services.length>50)||plan.components.some(c=>c.name.length>250))return {state:'blocked' as const,issues:['NATIVE_INPUT_LIMIT']}
  const external=plan.selected.filter(s=>servicePolicy(s.serviceId)?.execution==='external_confirmation').map(s=>s.sourceId)
  const previewToken=hash({requestDigest,planDigest:result.digest,atRevision:at.revision,compositionRevision:settings.revision,scenarios:scenarios.revisions(atId),catalog:catalog.map(c=>[c.id,c.revision]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))})
  const evidence={ciliaEvidence:{kind:'cilia-normalized-original-v1',identity:scope.preview.source.identity,rates:scope.preview.source.rates,items:scope.preview.source.items,summary:scope.preview.source.summary,totals:scope.preview.source.totals,sourceLinks:scope.sourceLinks,partnerComponents:scope.partnerComponents,review,steering,eventKey:event,sha256:s.evidenceSha256}}
  return {state:'preview' as const,previewToken,requestDigest,plan,source:result.source.data,evidence,event,external}
 }
 preview(atId:string,raw:unknown){
  this.ready()
  const r=fields(raw,baseKeys)
  return transaction(this.db,()=>{
   const p=this.inspect(atId,r)
   if(p.state!=='preview')return p
   return {state:p.state,previewToken:p.previewToken,calculation:p.plan.calculation,externalGroupIds:p.external,partnerComponents:p.evidence.ciliaEvidence.partnerComponents,requiresConfirmation:true as const}
  },'read')
 }
 confirm(atId:string,raw:unknown,actor:string){
  this.ready()
  const r=fields(raw,[...baseKeys,'previewToken','identityReviewed','scopeReviewed','financialReviewed','sourceAuthorized','externalReviewed','confirmed'])
  if(typeof actor!=='string'||!actor.trim()||actor.length>150||typeof r.previewToken!=='string'||! /^[a-f0-9]{64}$/.test(r.previewToken)||r.identityReviewed!==true||r.scopeReviewed!==true||r.financialReviewed!==true||r.sourceAuthorized!==true||r.confirmed!==true||typeof r.externalReviewed!=='boolean')return invalid()
  return transaction(this.db,()=>{
   const p=this.inspect(atId,r)
   if(p.state==='blocked')return fail(422,'CILIA_PLAN_BLOCKED','A composição possui pendências. Confira a prévia.')
   if(p.previewToken!==r.previewToken)return conflict()
   if(p.state==='existing')return {state:'existing' as const,record:p.record}
   if(p.external.length&&r.externalReviewed!==true)return invalid()
   const result=applyReviewedExternalPlan(this.db,atId,p,actor,{...p.evidence,ciliaConfirmation:{identityReviewed:true,scopeReviewed:true,financialReviewed:true,sourceAuthorizedByOperator:true,externalReviewed:r.externalReviewed}})
   this.db.prepare('INSERT INTO cilia_import_events(issuer_key,event_key,receipt_id) VALUES(?,?,?)').run(p.source.source.issuerKey,p.event,result.record.id)
   return {state:'created' as const,record:{id:result.record.id,scenarioId:result.record.scenarioId,result:result.record.result}}
  })
 }
 list(atId:string){
  this.ready()
  new AtendimentoRepository(this.db).get(atId)
  return this.db.prepare("SELECT id,scenario_id,source_json,plan_json,result_json,created_at FROM external_budget_receipts WHERE atendimento_id=? AND provider='cilia' ORDER BY created_at,id").all(atId).map(r=>{
   const plan=JSON.parse(String(r.plan_json))
   const source=JSON.parse(String(r.source_json))
   // Evidence only. No inference of stock arrival, purchase, or inclusion in an edited scenario.
   const partnerComponents=(plan.ciliaEvidence?.partnerComponents??[]).map((c:{sourceId:string;description:string;quantity:string;total:string;diagnosisId:string})=>({...c,nativePieceId:plan.sourceLinks?.diagnoses?.[c.diagnosisId]??null}))
   return {id:String(r.id),scenarioId:String(r.scenario_id),scenarioExists:!!this.db.prepare('SELECT 1 FROM scenarios WHERE id=? AND atendimento_id=?').get(r.scenario_id!,atId),documentNumber:source.source.documentNumber,revision:source.source.revision,createdAt:String(r.created_at),partnerComponents,result:JSON.parse(String(r.result_json)) as unknown}
  })
 }
}
