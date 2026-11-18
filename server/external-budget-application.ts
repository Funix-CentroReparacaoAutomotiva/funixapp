import {createHash,randomUUID} from 'node:crypto'
import type {DatabaseSync,SQLOutputValue} from 'node:sqlite'
import {CommercialRepository} from './commercial.ts'
import {ComponentRepository} from './components.ts'
import {ScenarioRepository,transaction} from './scenarios.ts'
import {AtendimentoRepository} from './atendimentos.ts'
import {PricingConfigurationRepository} from './pricing-config.ts'
import {planExternalBudget} from './external-budget-plan.ts'
import type {ExternalMapping} from './external-budget-plan.ts'
import {preflightExternalBudget} from './external-budget.ts'
import type {ExternalBudget} from './external-budget.ts'
import type {HistoricalBudgetPackage} from './historical-budget-preflight.ts'
import {calculate} from './pricing-engine.ts'
import {Q} from './exact.ts'
import {ServiceError} from './errors.ts'

/** Install the receipt schema only when native imports are explicitly enabled. */
export function createExternalBudgetApplicationSchema(db:DatabaseSync){
  transaction(db,()=>db.exec(
    'CREATE TABLE IF NOT EXISTS external_budget_receipts ('+
    'id TEXT PRIMARY KEY,provider TEXT NOT NULL,issuer_key TEXT NOT NULL,document_number TEXT NOT NULL,'+
    'atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,scenario_id TEXT NOT NULL,'+
    'request_digest TEXT NOT NULL,preview_token TEXT NOT NULL,source_json TEXT NOT NULL,plan_json TEXT NOT NULL,'+
    'result_json TEXT NOT NULL,operator_id TEXT NOT NULL,created_at TEXT NOT NULL,'+
    'UNIQUE(provider,issuer_key,document_number));'+
    "CREATE TRIGGER IF NOT EXISTS immutable_external_budget_update BEFORE UPDATE ON external_budget_receipts BEGIN SELECT RAISE(ABORT,'External budget receipt is immutable');END;"+
    "CREATE TRIGGER IF NOT EXISTS immutable_external_budget_delete BEFORE DELETE ON external_budget_receipts BEGIN SELECT RAISE(ABORT,'External budget receipt is immutable');END;"
  ))
}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
function canonical(v:unknown):unknown{
  if(Array.isArray(v))return v.map(canonical)
  if(v!==null&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,value])=>[k,canonical(value)]))
  return v
}
const fail=(status:number,code:string,message:string):never=>{throw new ServiceError(status,code,message)}
const conflict=()=>fail(409,'EXTERNAL_IMPORT_CONFLICT','Origem, catálogo, parâmetros ou composição mudaram. Confira novamente.')
const hasTable=(db:DatabaseSync,name:string)=>Boolean(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(name))
function exact(v:string){const [w,f='']=v.split('.');return new Q(BigInt(w+f),10n**BigInt(f.length))}
const eq=(a:string|null|undefined,b:string)=>a!=null&&exact(a).cmp(exact(b))===0

type Request={atendimentoId:string;source:unknown;mapping:ExternalMapping}
type Confirmation=Request&{previewToken:string;confirmed:boolean;identityReviewed:boolean;scopeReviewed:boolean;financialReviewed:boolean}
export function checkCodaLink(db:DatabaseSync,source:ExternalBudget,at:string){
  if(source.source.provider!=='coda')return
  if(source.source.issuerKey!=='2zsjI-nqWr:grid-LgsVNgYj3J'||!source.metadata.sourceAttendance||!hasTable(db,'coda_sync_atendimentos'))
    return fail(409,'EXTERNAL_ATTENDANCE_UNLINKED','Atendimento sem vínculo Coda confirmado.')
  const row=db.prepare('SELECT atendimento_id FROM coda_sync_atendimentos WHERE coda_row_id=?').get(source.metadata.sourceAttendance)
  if(!row||row.atendimento_id!==at)return fail(409,'EXTERNAL_ATTENDANCE_UNLINKED','Atendimento sem vínculo Coda confirmado.')
}
function receipt(db:DatabaseSync,row:Record<string,SQLOutputValue>){
  return {id:String(row.id),atendimentoId:String(row.atendimento_id),scenarioId:String(row.scenario_id),
    scenarioExists:Boolean(db.prepare('SELECT id FROM scenarios WHERE id=? AND atendimento_id=?').get(row.scenario_id!,row.atendimento_id!)),
    source:JSON.parse(String(row.source_json)) as ExternalBudget,result:JSON.parse(String(row.result_json)) as {total:string;servicesNet:string;components:string;discount:string;pieceIds:string[];componentIds:string[];serviceIds:string[]},createdAt:String(row.created_at)}
}
/** Only for a trusted, authenticated server caller. Source evidence and target
 * identity must be checked by that layer; a client-provided hash is not proof.
 * This repository does not expose an HTTP endpoint or execute any external I/O.
 */
export class ExternalBudgetApplication{
  readonly db:DatabaseSync
  constructor(db:DatabaseSync){this.db=db}
  private ready(){if(!hasTable(this.db,'external_budget_receipts'))fail(503,'EXTERNAL_IMPORT_DISABLED','Importação externa ainda não habilitada.')}
  private inspect(input:Request){
    const at=new AtendimentoRepository(this.db).get(input.atendimentoId)
    const source=preflightExternalBudget(input.source)
    if(!source.valid)return {state:'blocked' as const,issues:source.errors}
    checkCodaLink(this.db,source.data,at.id)
    const s=source.data.source
    // One native import per source document, including revisions. Supplements
    // or changed versions must not create extra scopes until designed explicitly.
    const requestDigest=hash({at:at.id,source:source.digest,mapping:canonical(input.mapping)})
    const prior=this.db.prepare('SELECT * FROM external_budget_receipts WHERE provider=? AND issuer_key=? AND document_number=?').get(s.provider,s.issuerKey,s.documentNumber)
    if(prior){
      if(prior.atendimento_id!==at.id||prior.request_digest!==requestDigest)return conflict()
      return {state:'existing' as const,record:receipt(this.db,prior),previewToken:String(prior.preview_token)}
    }
    const commercial=new CommercialRepository(this.db),scenarios=new ScenarioRepository(this.db),pricing=new PricingConfigurationRepository(this.db)
    const catalog=commercial.catalogs().items
    const settings=pricing.settings(at.id),configuration=pricing.get(),scenarioRevisions=scenarios.revisions(at.id)
    const calculation=planExternalBudget(source.data,input.mapping,catalog,configuration,settings)
    if(calculation.state!=='matched'||!('plan' in calculation)||!calculation.plan||!calculation.digest)return {state:'blocked' as const,issues:calculation.issues}
    const plan=calculation.plan
    if(plan.items.some(p=>p.services.length>50)||plan.components.some(c=>c.name.length>250))return {state:'blocked' as const,issues:['NATIVE_INPUT_LIMIT']}
    const master=commercial.list(at.id),existingPieces=new Set(master.map(p=>p.pieceId))
    if(plan.items.some(i=>existingPieces.has(i.pieceId)))return {state:'blocked' as const,issues:['EXISTING_NATIVE_PIECE_CONFLICT']}
    const versions=catalog.map(c=>[c.id,c.revision]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
    const previewToken=hash({requestDigest,planDigest:calculation.digest,atRevision:at.revision,compositionRevision:settings.revision,scenarios:scenarioRevisions,catalogVersions:versions})
    return {state:'preview' as const,previewToken,requestDigest,plan,source:source.data,warnings:source.warnings,
      identityRequiresReview:true as const,scopeRequiresReview:true as const,financialRequiresReview:true as const}
  }
  preview(input:Request){
    this.ready()
    return transaction(this.db,()=>this.inspect(input),'read')
  }
  confirm(input:Confirmation,operatorId:string,codaEvidence?:HistoricalBudgetPackage){
    this.ready()
    if(input.confirmed!==true||input.identityReviewed!==true||input.scopeReviewed!==true||input.financialReviewed!==true||
      typeof input.previewToken!=='string'||!/^[a-f0-9]{64}$/.test(input.previewToken)||typeof operatorId!=='string'||!operatorId.trim()||operatorId.length>150)
      return fail(422,'EXTERNAL_CONFIRMATION_REQUIRED','Confirmação de identidade, escopo e valores é obrigatória.')
    return transaction(this.db,()=>{
      const p=this.inspect(input)
      if(p.state==='blocked')return fail(422,'EXTERNAL_PLAN_BLOCKED','A composição externa possui pendências.')
      if(p.previewToken!==input.previewToken)return conflict()
      if(p.state==='existing')return {state:'existing' as const,record:p.record}
      const at=input.atendimentoId
      // Reuse native validations and write methods inside one outer transaction.
      // Their default transaction behavior is unchanged for all other callers.
      const joinOuter=<T>(fn:()=>T):T=>fn()
      const scenarios=new ScenarioRepository(this.db,joinOuter),commercial=new CommercialRepository(this.db,joinOuter),components=new ComponentRepository(this.db,joinOuter)
      let scenario=scenarios.create(at,{name:'Importação externa'})
      const pieceIds=new Map<string,string>(), serviceIds=new Map<string,string>(), componentIds=new Map<string,string>()
      const activeRevision=()=>scenarios.revisions(at).find(([id])=>id===scenario.id)![1]
      for(const item of p.plan.items){
        const catalog=commercial.usable(item.pieceId,'peca')
        const added=commercial.add(at,{pieceCodes:[catalog.code!],scenarioId:scenario.id,scenarioRevision:activeRevision()}).find(i=>i.pieceId===item.pieceId)!
        const saved=commercial.updateDiagnosis(at,added.id,{revision:added.revision,scenarioId:scenario.id,scenarioRevision:activeRevision(),
          diagnosisId:item.diagnosisId,intensity:item.intensity??null,enabled:true,notes:item.notes,
          services:item.services.map(s=>({serviceId:s.serviceId,dimensionId:s.dimensionId,quantity:s.quantity,enabled:true,notes:s.notes??'',diagnosisId:s.diagnosisId??null}))})
        pieceIds.set(item.id,saved.id)
        for(const service of item.services){
          const native=saved.services.find(s=>s.serviceId===service.serviceId&&s.dimensionId===service.dimensionId)
          if(!native)return conflict()
          serviceIds.set(service.id,native.id)
        }
      }
      for(const c of p.plan.components){
        const saved=components.save(at,{pieceId:pieceIds.get(c.pieceId)!,name:c.name,quantity:c.quantity,manualPrice:c.manualPrice,notes:c.notes,scenarioId:scenario.id,scenarioRevision:activeRevision()})
        componentIds.set(c.id,saved.id)
      }
      const negotiation=p.plan.negotiation
      // External duration semantics may differ (calendar/working days).
      // Keep automatic native deadline; source deadline is preserved in receipt.
      scenario=scenarios.update(at,scenario.id,{revision:activeRevision(),negotiationDraft:negotiation.mode==='none'?{mode:'none',value:''}:{mode:negotiation.mode,value:negotiation.value}})
      const pricing=new PricingConfigurationRepository(this.db)
      const result=calculate(commercial.list(at,scenario.id),components.list(at),commercial.catalogs().items,scenario,pricing.get().config,pricing.settings(at).settings,negotiation)
      const target=Q.from(p.source.totals.servicesGross).sub(Q.from(p.source.totals.serviceDiscount)).toString()
      if(result.errors.length||!eq(result.serviceNet,target)||!eq(result.componentSubtotal,p.source.totals.components)||!eq(result.total,p.source.totals.total)||!eq(result.discount,p.plan.calculation.discount))return conflict()
      if(result.lines.filter(l=>l.included&&l.kind==='service').length!==serviceIds.size||result.lines.filter(l=>l.included&&l.kind==='component').length!==componentIds.size)return conflict()
      for(const c of p.source.components){
        const line=result.lines.find(l=>l.id===componentIds.get(c.id)&&l.kind==='component'&&l.included)
        if(!line||!eq(line.finalUnit,c.unitSalePrice)||!eq(line.total,c.total))return conflict()
      }
      const summary={total:result.total!,servicesNet:result.serviceNet!,components:result.componentSubtotal!,discount:result.discount,pieceIds:[...pieceIds.values()],serviceIds:[...serviceIds.values()],componentIds:[...componentIds.values()]}
      const sourceLinks={
        diagnoses:Object.fromEntries(pieceIds), services:Object.fromEntries(serviceIds), components:Object.fromEntries(componentIds),
      }
      const id=randomUUID(),s=p.source.source
      this.db.prepare('INSERT INTO external_budget_receipts(id,provider,issuer_key,document_number,atendimento_id,scenario_id,request_digest,preview_token,source_json,plan_json,result_json,operator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,s.provider,s.issuerKey,s.documentNumber,at,scenario.id,p.requestDigest,p.previewToken,JSON.stringify(p.source),JSON.stringify({...p.plan,sourceLinks,...(codaEvidence?{codaEvidence}:{})}),JSON.stringify(summary),operatorId,new Date().toISOString())
      return {state:'created' as const,record:receipt(this.db,this.db.prepare('SELECT * FROM external_budget_receipts WHERE id=?').get(id)!)}
    })
  }
}
