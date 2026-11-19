import {createHash,randomUUID} from 'node:crypto'
import type {DatabaseSync,SQLOutputValue} from 'node:sqlite'
import {normalizeHistoricalCodaCapture,historicalCodaTables} from './historical-coda-capture.ts'
import type {HistoricalBudgetPackage} from './historical-budget-preflight.ts'
import {CommercialRepository} from './commercial.ts'
import type {CatalogItem,CatalogKind} from '../shared/commercial.ts'
import {ServiceError} from './errors.ts'
import {transaction} from './scenarios.ts'
import {PricingConfigurationRepository} from './pricing-config.ts'
import {compareHistoricalPricing} from './historical-budget-comparison.ts'

/** Development-only foundation. Explicit installation; not wired to startup or HTTP.
 * No changes to the local emission sequence, composition, catalog, or OS.
 */
export function createHistoricalBudgetSchema(db:DatabaseSync){
  transaction(db,()=>db.exec(
    'CREATE TABLE IF NOT EXISTS historical_budget_imports ('+
    'id TEXT PRIMARY KEY,atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,'+
    'doc_id TEXT NOT NULL,table_id TEXT NOT NULL,row_id TEXT NOT NULL,source_number TEXT NOT NULL,'+
    'source_digest TEXT NOT NULL,review_digest TEXT NOT NULL,preview_token TEXT NOT NULL,'+
    'snapshot_json TEXT NOT NULL,review_json TEXT NOT NULL,imported_at TEXT NOT NULL,operator_id TEXT NOT NULL,'+
    'UNIQUE(doc_id,table_id,row_id),UNIQUE(doc_id,table_id,source_number));'+
    'CREATE INDEX IF NOT EXISTS historical_budget_imports_at ON historical_budget_imports(atendimento_id,imported_at);'+
    "CREATE TRIGGER IF NOT EXISTS immutable_historical_budget_update BEFORE UPDATE ON historical_budget_imports BEGIN SELECT RAISE(ABORT,'Historical budget imports are immutable');END;"+
    "CREATE TRIGGER IF NOT EXISTS immutable_historical_budget_delete BEFORE DELETE ON historical_budget_imports BEGIN SELECT RAISE(ABORT,'Historical budget imports are immutable');END;"
  ))
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fail(status:number,code:string,message:string):never{throw new ServiceError(status,code,message)}
const conflict=()=>fail(409,'HISTORICAL_IMPORT_CONFLICT','O orçamento ou vínculo histórico mudou. Confira o registro antes de prosseguir.')
const invalidReview=()=>fail(422,'HISTORICAL_CATALOG_REVIEW_INVALID','Mapeamento explícito do catálogo incompleto ou inválido.')
const invalidConfirmation=()=>fail(422,'HISTORICAL_CONFIRMATION_REQUIRED','Confirmação explícita e prévia válida são obrigatórias.')
const hasTable=(db:DatabaseSync,name:string)=>Boolean(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(name))

type ReviewEntry={rowId:string;role:'piece'|'diagnosis'|'service'|'dimension';catalogId:string}
type FrozenEntry=ReviewEntry&{catalog:CatalogItem}
function parseReview(value:unknown):ReviewEntry[]{
  if(!Array.isArray(value)||value.length>2500)return invalidReview()
  const result=value.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalidReview()
    const x=raw as Record<string,unknown>
    if(Object.keys(x).length!==3||typeof x.rowId!=='string'||!/^i-[A-Za-z0-9_-]{1,98}$/.test(x.rowId)||
       typeof x.catalogId!=='string'||!x.catalogId.trim()||x.catalogId.length>250||
       (x.role!=='piece'&&x.role!=='diagnosis'&&x.role!=='service'&&x.role!=='dimension'))return invalidReview()
    return {rowId:x.rowId,role:x.role,catalogId:x.catalogId} as ReviewEntry
  }).sort((a,b)=>a.role<b.role?-1:a.role>b.role?1:a.rowId<b.rowId?-1:a.rowId>b.rowId?1:0)
  if(new Set(result.map(x=>x.role+':'+x.rowId)).size!==result.length)return invalidReview()
  return result
}
const kinds:Record<ReviewEntry['role'],CatalogKind>={piece:'peca',diagnosis:'diagnostico',service:'servico',dimension:'dimensao'}

/** The source stores display strings, not stable catalog IDs. The caller must
 * supply an explicitly reviewed mapping; there is no fuzzy name matching.
 * This freezes identities/revisions only; it does not authorize new services.
 */
function freezeReview(db:DatabaseSync,data:HistoricalBudgetPackage,review:ReviewEntry[]):FrozenEntry[]{
  const expected=new Set<string>()
  for(const d of data.diagnoses){expected.add('piece:'+d.rowId);if(d.damage!==null)expected.add('diagnosis:'+d.rowId)}
  for(const s of data.services){expected.add('service:'+s.rowId);if(s.dimension!==null)expected.add('dimension:'+s.rowId)}
  if(review.length!==expected.size||review.some(x=>!expected.has(x.role+':'+x.rowId)))return invalidReview()
  const repo=new CommercialRepository(db)
  const frozen=review.map(x=>{
    try{return {...x,catalog:repo.usable(x.catalogId,kinds[x.role])}}
    catch(error){if(error instanceof ServiceError)return invalidReview();throw error}
  })
  for(const x of frozen)if(x.role==='dimension'&&frozen.find(s=>s.role==='service'&&s.rowId===x.rowId)?.catalogId!==x.catalog.serviceId)return invalidReview()
  return frozen
}
function exactAttendance(db:DatabaseSync,data:HistoricalBudgetPackage,at:string){
  if(data.source.docId!=='2zsjI-nqWr'||data.source.atendimentoTableId!==historicalCodaTables.attendance||data.source.budgetTableId!==historicalCodaTables.budget)return conflict()
  if(!hasTable(db,'coda_sync_atendimentos'))return fail(409,'HISTORICAL_ATTENDANCE_UNLINKED','Atendimento sem vínculo Coda confirmado.')
  const link=db.prepare('SELECT a.id,a.revision FROM coda_sync_atendimentos c JOIN atendimentos a ON a.id=c.atendimento_id WHERE c.coda_row_id=?').get(data.source.atendimentoRowId)
  if(!link)return fail(409,'HISTORICAL_ATTENDANCE_UNLINKED','Atendimento sem vínculo Coda confirmado.')
  if(link.id!==at)return conflict()
  return {id:String(link.id),revision:Number(link.revision)}
}
function record(row:Record<string,SQLOutputValue>){
  return {id:String(row.id),atendimentoId:String(row.atendimento_id),sourceNumber:String(row.source_number),sourceDigest:String(row.source_digest),importedAt:String(row.imported_at),operatorId:String(row.operator_id),snapshot:JSON.parse(String(row.snapshot_json)) as HistoricalBudgetPackage,catalogReview:JSON.parse(String(row.review_json)) as FrozenEntry[],origin:'coda-historical' as const,pdfAvailable:false as const,workOrderAvailable:false as const}
}
type Captures={first:unknown;second:unknown}
type Confirmation={atendimentoId:string;captures:Captures;review:unknown;previewToken:string;confirmed:boolean}
/** Only a future trusted server adapter may call this repository. Captures,
 * mappings and operator identity are not proof of authentication themselves.
 * Preview does not write. Confirmation accepts freshly acquired captures,
 * not a client supplied copy; that acquisition is the caller's responsibility.
 */
export class HistoricalBudgetRepository{
  readonly db:DatabaseSync
  readonly now:()=>string
  constructor(db:DatabaseSync,now:()=>string=()=>new Date().toISOString()){this.db=db;this.now=now}
  private ready(){
    if(!hasTable(this.db,'historical_budget_imports'))return fail(503,'HISTORICAL_IMPORT_DISABLED','Importação histórica ainda não habilitada.')
  }
  private existing(data:HistoricalBudgetPackage){
    const s=data.source
    const rows=this.db.prepare('SELECT * FROM historical_budget_imports WHERE doc_id=? AND table_id=? AND (row_id=? OR source_number=?)').all(s.docId,s.budgetTableId,s.budgetRowId,s.budgetNumber)
    if(rows.length>1)return conflict()
    const found=rows[0]
    if(found&&(found.row_id!==s.budgetRowId||found.source_number!==s.budgetNumber))return conflict()
    return found
  }
  private inspect(at:string,captures:Captures,review:unknown){
    const p=normalizeHistoricalCodaCapture(captures.first,captures.second)
    const link=exactAttendance(this.db,p.data,at)
    const mapping=parseReview(review)
    const reviewDigest=hash(mapping)
    const old=this.existing(p.data)
    if(old){
      if(old.atendimento_id!==at||old.source_digest!==p.digest||old.review_digest!==reviewDigest)return conflict()
      return {state:'existing' as const,record:record(old),previewToken:String(old.preview_token)}
    }
    const frozen=freezeReview(this.db,p.data,mapping)
    const pricing=new PricingConfigurationRepository(this.db)
    const comparison=compareHistoricalPricing(p.data,frozen,pricing.get(),pricing.settings(at))
    const previewToken=hash({source:p.digest,at:link,review:frozen,comparison})
    return {state:'preview' as const,package:p,atendimento:link,catalogReview:frozen,reviewDigest,previewToken,financialIntegrity:p.financialIntegrity,comparison}
  }
  consult(at:string,captures:Captures){
    this.ready()
    return transaction(this.db,()=>{
      const p=normalizeHistoricalCodaCapture(captures.first,captures.second)
      const atendimento=exactAttendance(this.db,p.data,at)
      return {package:p,atendimento}
    })
  }
  preview(at:string,captures:Captures,review:unknown){
    this.ready()
    return transaction(this.db,()=>this.inspect(at,captures,review))
  }
  confirm(input:Confirmation,operatorId:string){
    this.ready()
    if(input.confirmed!==true||typeof input.previewToken!=='string'||!/^[a-f0-9]{64}$/.test(input.previewToken)||typeof operatorId!=='string'||!operatorId.trim()||operatorId.length>150)return invalidConfirmation()
    return transaction(this.db,()=>{
      const p=this.inspect(input.atendimentoId,input.captures,input.review)
      if(p.previewToken!==input.previewToken)return conflict()
      if(p.state==='existing')return {state:'existing' as const,record:p.record}
      if(!p.financialIntegrity)return fail(422,'HISTORICAL_FINANCIAL_INTEGRITY','Há divergências financeiras no orçamento histórico.')
      const {data,digest}=p.package,s=data.source,id=randomUUID(),at=this.now()
      this.db.prepare('INSERT INTO historical_budget_imports(id,atendimento_id,doc_id,table_id,row_id,source_number,source_digest,review_digest,preview_token,snapshot_json,review_json,imported_at,operator_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,input.atendimentoId,s.docId,s.budgetTableId,s.budgetRowId,s.budgetNumber,digest,p.reviewDigest,p.previewToken,JSON.stringify(data),JSON.stringify(p.catalogReview),at,operatorId)
      return {state:'created' as const,record:record(this.db.prepare('SELECT * FROM historical_budget_imports WHERE id=?').get(id)!)}
    })
  }
  list(at:string){
    this.ready()
    if(!this.db.prepare('SELECT id FROM atendimentos WHERE id=?').get(at))return fail(404,'NOT_FOUND','Atendimento não encontrado.')
    return this.db.prepare('SELECT * FROM historical_budget_imports WHERE atendimento_id=? ORDER BY imported_at DESC,id').all(at).map(record)
  }
  get(at:string,id:string){
    this.ready()
    const row=this.db.prepare('SELECT * FROM historical_budget_imports WHERE atendimento_id=? AND id=?').get(at,id)
    if(!row)return fail(404,'NOT_FOUND','Orçamento histórico não encontrado.')
    return record(row)
  }
}
