import {DOCUMENT,TABLES} from '../../coda-import-source.ts'
import type {CodaExport,SourceRow} from '../../coda-import-source.ts'
import {codaFormulas} from './coda-formulas.ts'

// All values and other rows below are synthetic. The service ID is an approved policy key; no real commercial values. Never used by app startup.
export const ref=(tableId:string,rowId:string)=>({type:'ref',rowId,targetTableId:tableId})
export const row=(rowId:string,values:Record<string,unknown>):SourceRow=>({rowId,values:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{value:v}]))})
export function codaFixture():CodaExport {
 const data:Record<string,SourceRow[]>={
  [TABLES.services]:[row('i-XDTMBmueos',{'c-TvFH_jzZ3k':'Serviço sintético de QA','c-mJimiTomMd':true,'c-r5HLQrISpN':true})],
  [TABLES.diagnoses]:[row('i-synthetic-diagnosis',{'c-QduKALgMf1':'Dano sintético QA'})],
  [TABLES.dimensionNames]:[row('i-synthetic-name',{'c-FJw9NIz2cO':'Dimensão sintética QA'}),row('i-synthetic-all-name',{'c-FJw9NIz2cO':'__ALL_dim__'})],
  [TABLES.dimensions]:[
   row('i-synthetic-dimension',{'c-TvFH_jzZ3k':ref(TABLES.services,'i-XDTMBmueos'),'c-DGi7Us0d5f':ref(TABLES.dimensionNames,'i-synthetic-name'),'c-YB4iqbCDp_':{scalar:1},'c-wZoGYfi40i':5}),
   row('i-synthetic-all',{'c-DGi7Us0d5f':ref(TABLES.dimensionNames,'i-synthetic-all-name'),'c-YB4iqbCDp_':1})],
  [TABLES.tables]:[row('i-synthetic-table',{'c-CeD0PIBx4t':'Tabela QA sintética','c-tZ94U6MuW-':{name:'Padrao'},'c-o2aKUZyPE7':true,'c-QMXNRk1uDX':1,'c-DMeUkMin9e':''})],
  [TABLES.rules]:[row('i-synthetic-rule',{'c-VdW_35TQkv':ref(TABLES.tables,'i-synthetic-table'),'c-8CxdK7Oln0':ref(TABLES.services,'i-XDTMBmueos'),'c-trJtxn7Rnm':ref(TABLES.dimensions,'i-synthetic-all'),'c-4i-UJzr0Ry':{name:'calculado'},'c-sGROPfan5w':100.01,'c-jIfhQ2URf5':true,'c--xF4R7C4Rv':true})],
  [TABLES.colors]:[row('i-synthetic-color',{'c-I7ZHbkxSjh':'Cor sintética QA','c-fbLxVOP4TA':1})],
  [TABLES.risks]:[row('i-synthetic-risk',{'c-cxXfUPrtG8':'Risco sintético QA','c-OIxnmBPdct':1})],
  [TABLES.capacity]:[row('i-synthetic-capacity',{'c-hnqUeXrBqw':4})],
  [TABLES.stages]:[row('i-synthetic-stage',{'c-TvFH_jzZ3k':'Etapa sintética QA','c-K6LT-CKgWA':ref(TABLES.energy,'i-synthetic-base-energy')})],
  [TABLES.stageDimensions]:[row('i-synthetic-stage-dimension',{'c-tb4TOqyqh7':'Dimensão técnica sintética QA','c-ufXqc_8vWI':ref(TABLES.energy,'i-synthetic-dimension-energy')})],
  [TABLES.energy]:[row('i-synthetic-base-energy',{'c-3-8rupyDNx':2}),row('i-synthetic-dimension-energy',{'c-3-8rupyDNx':3})],
  [TABLES.relations]:[row('i-synthetic-relation',{'c-7sr002IvYn':ref(TABLES.services,'i-XDTMBmueos'),'c-EBO2IBlQEH':ref(TABLES.dimensions,'i-synthetic-dimension'),'c-AWrfBjSHDl':ref(TABLES.stages,'i-synthetic-stage'),'c-B9QLxROotP':ref(TABLES.stageDimensions,'i-synthetic-stage-dimension'),'c-Ii7Vzlr1ni':5,'c-rTdEY2ynPh':1})],
 }
 return {format:'funix-coda-commercial-v1',documentId:DOCUMENT,exportedAt:'2026-10-29T00:00:00Z',pricingFormulaSchema:{columns:structuredClone(codaFormulas)},tables:Object.values(TABLES).map(id=>({id,schema:{columns:[],rowCount:data[id]?.length??0},rows:data[id]??[],totalRows:data[id]?.length??0,hasMore:false}))}
}
export function table(source:CodaExport,id:string){return source.tables.find(t=>t.id===id)!}
export function pushRow(source:CodaExport,id:string,r:SourceRow){const t=table(source,id);t.rows.push(r);t.schema.rowCount++;t.totalRows++}
export function set(source:CodaExport,id:string,column:string,value:unknown,index=0){table(source,id).rows[index]!.values[column]={value}}
