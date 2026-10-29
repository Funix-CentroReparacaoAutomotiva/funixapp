// Source identifiers and formula fingerprints verified read-only against the ERP.
// No commercial rows or prices are distributed with the application.
export const DOCUMENT = '2zsjI-nqWr'
export const TABLES = {
 services:'grid-lhdFxol6x-', dimensions:'grid-7521QzZOVd', dimensionNames:'grid-QPCC_JhRKv',
 diagnoses:'grid-2ANpptuaKz', tables:'grid-dhmr5kCC1Y', rules:'grid-jbcn6tXMjk',
 colors:'grid-ksc0WkVv-w', risks:'grid-lvdM6zQqUO', capacity:'grid-g-gfi7A7oZ',
 relations:'grid-p-wZJbfjUD', stageDimensions:'grid-toMTm0uCpd', stages:'grid-T_l0vKA1mg',
 app:'grid-tAiT_ivHai', energy:'grid-M08uQO9NFg', diagnosisServices:'grid-bfhEBGqPTC',
} as const
export const FORMULAS = {
 'c-CTMaCn6A8p':'18ea5bfd57ea7e587b3c4bb6fd0f3483646308c9e038ac46bc6f24cb700ee210',
 'c-hxarcKkPOG':'b6bdcc400ac432752a76b657905a85dcadacbae894ff507c3c3bb4e760b26792',
 'c-JfloaDYRDT':'63e795fe29b59f19aeba7abc2de9bc336fafa73ec4dca695531f0119dc9943dc',
 'c-p7zvvJmXk5':'b78439305b7d564376cd9d8208231ed56488a9de7a2a329d99a5362356806c87',
 'c-wZoGYfi40i':'bbce2ed045b5654e3437c8adcc02139c9533b5feacbeff4618b344b1b4f366f0',
 'c-Ii7Vzlr1ni':'ab48bfbddfbf6a2b2cdc0309d7b7eb71ce6127c20e79297c0e2d35f6729fb364',
} as const
export interface SourceColumn {columnId:string; name:string; formula?:string|null}
export interface SourceRow {rowId:string; values:Record<string,unknown>}
export interface SourceTable {id:string; schema:{columns:SourceColumn[]; rowCount:number}; rows:SourceRow[]; totalRows:number; hasMore?:boolean}
export interface CodaExport {
 format:'funix-coda-commercial-v1'; documentId:string; exportedAt:string
 tables:SourceTable[]; pricingFormulaSchema:{columns:SourceColumn[]}
}
export function cell(row:SourceRow,column:string):unknown {
 const v=row.values[column]
 return v && typeof v==='object' && 'value' in v ? v.value : v
}
export function scalar(v:unknown):unknown {
 return v && typeof v==='object' && 'scalar' in v ? v.scalar : v
}
export function label(v:unknown):string {
 if(typeof v==='string')return v.trim()
 if(v && typeof v==='object' && 'name' in v && typeof v.name==='string')return v.name.trim()
 return ''
}
export function sourceId(table:string,row:string){return `coda:${DOCUMENT}:${table}:${row}`}

// Keep numeric source cells lexically exact before JSON's Number can round them.
// Node 24 provides reviver context.source. Structural counts remain integers.
export function parseCodaJson(text:string):unknown {
 const parse=JSON.parse as (text:string,reviver:(key:string,value:unknown,context:{source?:string})=>unknown)=>unknown
 return parse(text,(key,value,context)=>typeof value==='number' && (key.startsWith('c-') || key==='scalar' || key==='value') ? context.source??failPrecision() : value)
}
function failPrecision():never {throw new Error('Node 24 com JSON reviver context.source é necessário para preservar decimais da origem.')}
