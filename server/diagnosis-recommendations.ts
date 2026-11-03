// Offline rules only: no writes to composition, prices, Coda or issued budgets.
import{createHash}from'node:crypto'
import type{DatabaseSync}from'node:sqlite'
import{DIAGNOSIS_INTENSITIES}from'../shared/commercial.ts'
import type{DiagnosisRecommendation,DiagnosisIntensity}from'../shared/commercial.ts'
import{DOCUMENT,TABLES,sourceId}from'./coda-import-source.ts'
import{invalid}from'./scenarios.ts'
export const RECOMMENDATIONS_FORMAT='funix-diagnosis-recommendations-v1'
type Rule={id:string;source_table:string;source_row_id:string;diagnosis_id:string;intensity:DiagnosisIntensity;service_id:string;dimension_id:string;selected_by_default:0|1;status:'valid'|'pending';reason:string|null}
type Finding={sourceRowId:string;reason:string}
const hash=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex')
function object(value:unknown,keys:string[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('Contrato de regras inválido: confira o formato documentado.')
 return value as Record<string,unknown>
}
function database(db:DatabaseSync){
 const versions=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>Number(r.version))
 if(![9,10,11,12].includes(versions.length)||versions.some((v,i)=>v!==i+1))throw Error('Regras exigem schema exatamente V9, V10, V11 ou V12; este comando não executa migrações.')
 if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Integridade do banco inválida; carga recusada.')
}
function originId(value:unknown){return typeof value==='string'&&/^i-[A-Za-z0-9_-]{1,60}$/.test(value)}
function reference(value:unknown,table:string){return typeof value==='string'&&value.length<=100&&value.startsWith(sourceId(table,''))&&originId(value.slice(sourceId(table,'').length))}
export function planRecommendations(db:DatabaseSync,input:unknown){
 database(db)
 const data=object(input,['format','documentId','tableId','rows'])
 if(data.format!==RECOMMENDATIONS_FORMAT||data.documentId!==DOCUMENT||data.tableId!==TABLES.diagnosisServices||!Array.isArray(data.rows)||data.rows.length>10000)throw Error('Fonte ou formato de regras incompatível; nenhuma relação presumida.')
 const catalog=db.prepare('SELECT id,kind,service_id,active,name FROM catalog_items ORDER BY id').all(),items=new Map(catalog.map(c=>[String(c.id),c]))
 const existing=db.prepare('SELECT * FROM diagnosis_recommendations ORDER BY id').all()
 const rules:Rule[]=[],conflicts:Finding[]=[],seen=new Set<string>(),keys=new Map<string,string>()
 let unchanged=0,inserts=0
 for(const raw of data.rows){
  const row=object(raw,['id','diagnosisId','intensity','serviceId','dimensionId','selectedByDefault']),id=String(row.id??'')
  const problem=(reason:string)=>conflicts.push({sourceRowId:id,reason})
  if(!originId(row.id)||!reference(row.diagnosisId,TABLES.diagnoses)||!reference(row.serviceId,TABLES.services)||!reference(row.dimensionId,TABLES.dimensions)){problem('Identidade/referência de origem inválida.');continue}
  if(seen.has(id)){problem('ID de relação repetido na fonte.');continue}seen.add(id)
  const intensity=typeof row.intensity==='string'?row.intensity.toLowerCase():''
  if(!DIAGNOSIS_INTENSITIES.includes(intensity as DiagnosisIntensity)||typeof row.selectedByDefault!=='boolean'){problem('Intensidade ou selectedByDefault inválido.');continue}
  const diagnosis=items.get(row.diagnosisId as string),service=items.get(row.serviceId as string),dimension=items.get(row.dimensionId as string)
  if(diagnosis?.kind!=='diagnostico'||service?.kind!=='servico'||dimension?.kind!=='dimensao'){problem('Diagnóstico, serviço ou dimensão ausente/tipo incompatível no catálogo.');continue}
  const mismatch=dimension.service_id!==service.id
  const rule:Rule={id:sourceId(TABLES.diagnosisServices,id),source_table:TABLES.diagnosisServices,source_row_id:id,diagnosis_id:String(diagnosis.id),intensity:intensity as DiagnosisIntensity,service_id:String(service.id),dimension_id:String(dimension.id),selected_by_default:row.selectedByDefault?1:0,status:mismatch?'pending':'valid',reason:mismatch?'DIMENSION_SERVICE_MISMATCH':null}
  const key=JSON.stringify([rule.diagnosis_id,rule.intensity,rule.service_id,rule.dimension_id]),duplicate=keys.get(key)
  if(duplicate){problem('Relação semântica repetida com outro ID: '+duplicate);continue}keys.set(key,id)
  const old=existing.find(r=>r.id===rule.id),collision=existing.find(r=>r.id!==rule.id&&JSON.stringify([r.diagnosis_id,r.intensity,r.service_id,r.dimension_id])===key)
  if(collision)problem('Relação já existente com outra identidade; preservada.')
  else if(old){if(Object.entries(rule).some(([k,v])=>old[k]!==v))problem('Relação existente diverge da fonte; preservada.');else unchanged++}else inserts++
  rules.push(rule)
 }
 rules.sort((a,b)=>a.id.localeCompare(b.id))
 const sourceDigest=hash(input),targetDigest=hash({catalog,existing}),planHash=hash({sourceDigest,targetDigest,rules})
 return{sourceDigest,targetDigest,planHash,rules,report:{total:data.rows.length,valid:rules.filter(r=>r.status==='valid').length,notSelectedByDefault:rules.filter(r=>!r.selected_by_default).length,validNotSelectedByDefault:rules.filter(r=>r.status==='valid'&&!r.selected_by_default).length,pending:rules.filter(r=>r.status==='pending').map(r=>({sourceRowId:r.source_row_id,diagnosisId:r.diagnosis_id,intensity:r.intensity,serviceId:r.service_id,dimensionId:r.dimension_id,reason:r.reason})),conflicts,inserts,unchanged}}
}
export function applyRecommendations(db:DatabaseSync,input:unknown,confirmation:string){
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; BEGIN IMMEDIATE')
 try{
  const plan=planRecommendations(db,input)
  if(plan.planHash!==confirmation)throw Error('Plano mudou: repita o dry-run antes de aplicar.')
  if(plan.report.conflicts.length)throw Error('Conflitos pendentes: nenhuma regra foi gravada.')
  const insert=db.prepare('INSERT INTO diagnosis_recommendations(id,source_table,source_row_id,diagnosis_id,intensity,service_id,dimension_id,selected_by_default,status,reason) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
  for(const r of plan.rules)insert.run(r.id,r.source_table,r.source_row_id,r.diagnosis_id,r.intensity,r.service_id,r.dimension_id,r.selected_by_default,r.status,r.reason)
  database(db);db.exec('COMMIT');return plan
 }catch(error){db.exec('ROLLBACK');throw error}
}
export function recommendations(db:DatabaseSync,diagnosisId:unknown,intensity:unknown):DiagnosisRecommendation[]{
 if(typeof diagnosisId!=='string'||!diagnosisId||diagnosisId.length>100||!DIAGNOSIS_INTENSITIES.includes(intensity as DiagnosisIntensity))invalid('Informe diagnosisId e intensidade válidos.')
 return db.prepare(`SELECT r.id,r.source_row_id AS sourceRowId,r.source_table AS sourceTable,r.service_id AS serviceId,r.dimension_id AS dimensionId,r.selected_by_default AS selectedByDefault
  FROM diagnosis_recommendations r JOIN catalog_items d ON d.id=r.diagnosis_id JOIN catalog_items s ON s.id=r.service_id JOIN catalog_items dim ON dim.id=r.dimension_id
  WHERE r.diagnosis_id=? AND r.intensity=? AND r.status='valid'
   AND d.kind='diagnostico' AND s.kind='servico' AND dim.kind='dimensao' AND dim.service_id=s.id
   AND d.active=1 AND s.active=1 AND dim.active=1 AND length(trim(d.name))>0 AND length(trim(s.name))>0 AND length(trim(dim.name))>0 ORDER BY r.id`).all(diagnosisId,intensity as string).map(r=>({id:String(r.id),sourceRowId:String(r.sourceRowId),sourceTable:String(r.sourceTable),serviceId:String(r.serviceId),dimensionId:String(r.dimensionId),selectedByDefault:r.selectedByDefault===1}))
}
