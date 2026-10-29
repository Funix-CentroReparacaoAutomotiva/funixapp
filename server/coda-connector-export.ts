import {DOCUMENT,TABLES,parseCodaJson} from './coda-import-source.ts'
import type {CodaExport,SourceColumn,SourceRow} from './coda-import-source.ts'

function object(value:unknown):Record<string,unknown>{
 if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Resposta do conector inválida.')
 return value as Record<string,unknown>
}
// Preserve the actual connector response, including JSON-in-text envelopes.
// Never evaluate formulas or replace their source representation.
function result(raw:unknown):Record<string,unknown>{
 let value=raw
 for(let depth=0;depth<10;depth++){
  if(typeof value==='string'){value=parseCodaJson(value);continue}
  const data=object(value)
  if(data.isError || data.error || data.error_code)throw new Error('Captura contém erro do conector; repita a leitura.')
  if(data.result!==undefined)return object(data.result)
  if(Array.isArray(data.content)){
   const content=data.content.find(c=>c && typeof c==='object' && 'type' in c && c.type==='text')
   if(content && typeof content.text==='string'){value=content.text;continue}
  }
  if(data.structuredContent){value=data.structuredContent;continue}
  throw new Error('Envelope do conector desconhecido; não foi convertido por suposição.')
 }
 throw new Error('Envelope do conector excessivamente aninhado.')
}
function schema(raw:unknown,id:string){
 const data=result(raw)
 if(typeof data.tableUri!=='string' || !data.tableUri.endsWith('/tables/'+id) || !Number.isSafeInteger(data.rowCount) || Number(data.rowCount)<0 || !Array.isArray(data.columns))throw new Error('Esquema de origem/contagem inválido: '+id)
 const columns:SourceColumn[]=data.columns.map(raw=>{
  const c=object(raw)
  if(typeof c.columnId!=='string' || typeof c.name!=='string' || (c.formula!=null && typeof c.formula!=='string'))throw new Error('Coluna de origem inválida.')
  return {columnId:c.columnId,name:c.name,formula:c.formula as string|null|undefined}
 })
 if(new Set(columns.map(c=>c.columnId)).size!==columns.length)throw new Error('Colunas duplicadas.')
 return {columns,rowCount:Number(data.rowCount)}
}
export function normalizeConnectorCapture(input:unknown):CodaExport {
 const capture=object(input)
 if(capture.format!=='funix-coda-connector-capture-v1' || capture.documentId!==DOCUMENT || typeof capture.exportedAt!=='string' || !Number.isFinite(Date.parse(capture.exportedAt)) || !Array.isArray(capture.tables))throw new Error('Captura comercial inválida.')
 const entries=capture.tables.map(object),ids=Object.values(TABLES)
 if(entries.length!==ids.length || new Set(entries.map(t=>t.id)).size!==ids.length || entries.some(t=>!ids.includes(t.id as typeof ids[number])))throw new Error('Captura deve conter exatamente as tabelas comerciais permitidas.')
 const tables=ids.map(id=>{
  const entry=entries.find(t=>t.id===id)!,before=schema(entry.before,id),after=schema(entry.after,id)
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Esquema/contagem mudou durante coleta: '+id)
  if(!Array.isArray(entry.pages))throw new Error('Páginas ausentes: '+id)
  const rows:SourceRow[]=[]
  for(let n=0;n<entry.pages.length;n++){
   const page=object(entry.pages[n]),data=result(page.response)
   if(page.offset!==rows.length || data.totalRows!==before.rowCount || !Array.isArray(data.rows) || typeof data.hasMore!=='boolean' || data.hasMore!==(n<entry.pages.length-1) || data.rows.length<1 || data.rows.length>100)throw new Error('Paginação incompleta/divergente: '+id)
   for(const raw of data.rows){const r=object(raw);if(typeof r.rowId!=='string')throw new Error('Linha sem ID de origem.');rows.push({rowId:r.rowId,values:object(r.values)})}
  }
  if(rows.length!==before.rowCount || new Set(rows.map(r=>r.rowId)).size!==rows.length)throw new Error('Linhas ausentes/duplicadas: '+id)
  return {id,schema:before,rows,totalRows:rows.length,hasMore:false}
 })
 const pricing=object(capture.pricingFormulaSchema),before=schema(pricing.before,'grid-aHz1ZDVlfK'),after=schema(pricing.after,'grid-aHz1ZDVlfK')
 // The operational table's row count may change; only its schema is collected/compared.
 if(JSON.stringify(before.columns)!==JSON.stringify(after.columns))throw new Error('Fórmulas comerciais mudaram durante coleta.')
 return {format:'funix-coda-commercial-v1',documentId:DOCUMENT,exportedAt:capture.exportedAt,tables,pricingFormulaSchema:{columns:before.columns}}
}
