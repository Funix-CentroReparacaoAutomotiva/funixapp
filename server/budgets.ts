import {createHash,randomUUID} from 'node:crypto'
import type {DatabaseSync,SQLOutputValue} from 'node:sqlite'
import type {BudgetPreview,BudgetSnapshot,BudgetVersion,Negotiation} from '../shared/pricing.ts'
import {AtendimentoRepository} from './atendimentos.ts'
import {CommercialRepository} from './commercial.ts'
import {ComponentRepository} from './components.ts'
import {PricingConfigurationRepository} from './pricing-config.ts'
import {ScenarioRepository,conflict,inputObject,invalid,selectedScenario,transaction} from './scenarios.ts'
import {calculate,negotiation} from './pricing-engine.ts'
import {ServiceError} from './errors.ts'
import {budgetPdf} from './pdf.ts'

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function versionLabel(sequence:number){let n=sequence,label='';while(n>0){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26)}return label}
function record(row:Record<string,SQLOutputValue>):BudgetVersion{return {id:String(row.id),atendimentoId:String(row.atendimento_id),sequence:Number(row.sequence),label:String(row.label),createdAt:String(row.created_at),snapshot:JSON.parse(String(row.snapshot))}}
export class BudgetRepository {
 readonly db:DatabaseSync
 constructor(db:DatabaseSync){this.db=db}
 private build(at:string,scenarioId:string,deal:Negotiation):BudgetPreview{
  const atendimento=new AtendimentoRepository(this.db).get(at),commercial=new CommercialRepository(this.db),pricing=new PricingConfigurationRepository(this.db)
  selectedScenario(this.db,at,scenarioId)
  const scenario=new ScenarioRepository(this.db).list(at).find(s=>s.id===scenarioId)!,items=commercial.list(at,scenario.id),components=new ComponentRepository(this.db).list(at),catalog=commercial.catalogs().items
  const state=pricing.settings(at),configuration=pricing.get(),calculation=calculate(items,components,catalog,scenario,configuration.config,state.settings,deal)
  const referenced=new Set(items.flatMap(item=>[item.pieceId,item.diagnosisId,...item.services.flatMap(l=>[l.serviceId,l.dimensionId,l.diagnosisId])]).filter((v):v is string=>typeof v==='string'))
  const snapshot:BudgetSnapshot={schema:1,atendimento,composition:{items,components,catalog:catalog.filter(item=>referenced.has(item.id))},scenarioId:scenario.id,scenarioName:scenario.name,compositionRevision:state.revision,scenarioRevision:scenario.revision,configuration,settings:state.settings,calculation,conditions:configuration.config.conditions}
  return {snapshot,token:hash(snapshot),canEmit:calculation.errors.length===0 && calculation.total!==null && calculation.days!==null}
 }
 preview(at:string,input:unknown):BudgetPreview{
  const data=inputObject(input,['scenarioId','negotiation'])
  if(typeof data.scenarioId!=='string')invalid('Escolha um cenário para a prévia.')
  const id=data.scenarioId,deal=negotiation(data.negotiation)
  return transaction(this.db,()=>this.build(at,id,deal))
 }
 emit(at:string,input:unknown):BudgetVersion{
  const data=inputObject(input,['scenarioId','negotiation','previewToken','idempotencyKey'])
  if(typeof data.scenarioId!=='string' || typeof data.previewToken!=='string' || !/^[a-f0-9]{64}$/.test(data.previewToken) || typeof data.idempotencyKey!=='string' || !/^[A-Za-z0-9_-]{16,100}$/.test(data.idempotencyKey))invalid('Emissão exige cenário, prévia e chave de requisição válidos.')
  const scenarioId=data.scenarioId,deal=negotiation(data.negotiation),token=data.previewToken,key=data.idempotencyKey,requestHash=hash({scenarioId,deal,token})
  return transaction(this.db,()=>{
   new AtendimentoRepository(this.db).get(at)
   const existing=this.db.prepare('SELECT * FROM budget_versions WHERE atendimento_id=? AND idempotency_key=?').get(at,key)
   if(existing){if(existing.request_hash!==requestHash)throw new ServiceError(409,'IDEMPOTENCY_CONFLICT','Esta chave já foi usada para outra emissão.');return record(existing)}
   const preview=this.build(at,scenarioId,deal)
   if(preview.token!==token)conflict()
   if(!preview.canEmit)throw new ServiceError(422,'BUDGET_INCOMPLETE',preview.snapshot.calculation.errors.join(' '))
   const sequence=Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM budget_versions WHERE atendimento_id=?').get(at)!.sequence)
   const createdAt=new Date().toISOString(),version:BudgetVersion={id:randomUUID(),atendimentoId:at,sequence,label:versionLabel(sequence),createdAt,snapshot:{...preview.snapshot,issuedAt:createdAt}}
   const pdf=budgetPdf(version)
   this.db.prepare('INSERT INTO budget_versions(id,atendimento_id,sequence,label,created_at,snapshot,pdf,idempotency_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(version.id,at,sequence,version.label,createdAt,JSON.stringify(version.snapshot),pdf,key,requestHash)
   return version
  })
 }
 list(at:string){new AtendimentoRepository(this.db).get(at);return this.db.prepare("SELECT id,atendimento_id AS atendimentoId,sequence,label,created_at AS createdAt,json_extract(snapshot,'$.calculation.total') AS total FROM budget_versions WHERE atendimento_id=? ORDER BY sequence DESC").all(at)}
 get(at:string,id:string):BudgetVersion{const row=this.db.prepare('SELECT id,atendimento_id,sequence,label,created_at,snapshot FROM budget_versions WHERE atendimento_id=? AND id=?').get(at,id);if(!row)throw new ServiceError(404,'NOT_FOUND','Versão não encontrada neste Atendimento.');return record(row)}
 pdf(at:string,id:string):Buffer{this.get(at,id);const row=this.db.prepare('SELECT pdf FROM budget_versions WHERE atendimento_id=? AND id=?').get(at,id)!;return Buffer.from(row.pdf as Uint8Array)}
}
