import {historicalCodaColumns as c,historicalCodaTables as t,normalizeHistoricalCodaCapture} from './historical-coda-capture.ts'
import {ServiceError} from './errors.ts'

const doc='2zsjI-nqWr'
type Kind=keyof typeof t
type CaptureRow={rowId:string;values:Record<string,{value:unknown}>}
type CapturedTable={tableId:string;pages:{offset:number;rows:CaptureRow[];totalRows:number;hasMore:boolean}[]}
export type HistoricalCaptureProvider=(number:string)=>Promise<{first:unknown;second:unknown}>
function fail():never{throw new ServiceError(502,'HISTORICAL_CODA_READ_FAILED','Não foi possível verificar a leitura histórica do ERP.')}
function object(v:unknown):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v))return fail()
  return v as Record<string,unknown>
}
function rowId(v:unknown):string{
  if(typeof v!=='string'||!/^i-[A-Za-z0-9_-]{1,98}$/.test(v))return fail()
  return v
}
export function historicalBudgetNumber(v:unknown):string{
  if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))throw new ServiceError(400,'HISTORICAL_BUDGET_NUMBER_INVALID','Informe o identificador exato do orçamento.')
  return v
}
// Public Coda v1 rich values differ from the connector's wrapped values.
// Only explicitly supported shapes are translated; no lookup by display name.
function project(v:unknown,column:string):unknown{
  if(v===null||typeof v==='number'||typeof v==='boolean')return v
  if(typeof v==='string'){
    if(column===c.budget.date){
      // Preserve the source timestamp, never guess a timezone for date-only values.
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v))||Date.parse(v)%1000!==0)return fail()
      return {type:'dt',epoch:Date.parse(v)/1000}
    }
    return v
  }
  if(Array.isArray(v))return v.map(x=>project(x,column))
  const x=object(v)
  if(x['@type']==='MonetaryAmount'&&x.currency==='BRL'&&typeof x.amount==='number')return {type:'currency',code:'BRL',scalar:x.amount}
  if(x['@type']==='StructuredValue'&&x.additionalType==='row'&&typeof x.name==='string'&&typeof x.tableId==='string')return {type:'ref',rowId:rowId(x.rowId),name:x.name,targetTableId:x.tableId}
  return fail()
}
function projectedRow(raw:unknown,kind:Kind):CaptureRow{
  const x=object(raw),values=object(x.values),out:CaptureRow['values']={}
  for(const col of new Set(Object.values(c[kind]))){
    if(!Object.hasOwn(values,col))return fail()
    out[col]={value:project(values[col],col)}
  }
  return {rowId:rowId(x.id),values:out}
}
export function createHistoricalCodaProvider(config:{token:string;fetchImpl?:typeof fetch}):HistoricalCaptureProvider{
  const {token}=config,fetchImpl=config.fetchImpl??fetch
  if(typeof token!=='string'||token.length<16||token.length>2048||/[\u0000-\u001f\u007f]/.test(token))throw Error('HISTORICAL_CODA_TOKEN_INVALID')
  async function read(kind:Kind,query:string,signal:AbortSignal):Promise<CapturedTable>{
    const rows:CaptureRow[]=[],seen=new Set<string>(),tokens=new Set<string>()
    let cursor:string|undefined
    for(let page=0;page<40;page++){
      const url=new URL('https://coda.io/apis/v1/docs/'+doc+'/tables/'+t[kind]+'/rows')
      if(cursor)url.searchParams.set('pageToken',cursor)
      else{
        url.searchParams.set('query',query)
        url.searchParams.set('limit','100')
        url.searchParams.set('valueFormat','rich')
        url.searchParams.set('useColumnNames','false')
        url.searchParams.set('visibleOnly','false')
      }
      let body:unknown
      try{
        const response=await fetchImpl(url.toString(),{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])})
        if(response.status!==200)return fail()
        const reader=response.body?.getReader()
        if(!reader)return fail()
        const chunks:Uint8Array[]=[];let length=0
        try{
          for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>4_000_000){await reader.cancel();return fail()}chunks.push(chunk.value)}
        }finally{reader.releaseLock()}
        body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      }catch{return fail()}
      const result=object(body)
      if(!Array.isArray(result.items)||result.items.length>100)return fail()
      for(const raw of result.items){
        const row=projectedRow(raw,kind)
        if(seen.has(row.rowId)||rows.length>=4000)return fail()
        seen.add(row.rowId);rows.push(row)
      }
      if(result.nextPageToken===undefined||result.nextPageToken===null){
        const pages:CapturedTable['pages']=[]
        for(let offset=0;offset<rows.length||offset===0;offset+=100)pages.push({offset,rows:rows.slice(offset,offset+100),totalRows:rows.length,hasMore:offset+100<rows.length})
        return {tableId:t[kind],pages}
      }
      if(typeof result.nextPageToken!=='string'||!result.nextPageToken.length||result.nextPageToken.length>1024||tokens.has(result.nextPageToken)||!result.items.length)return fail()
      tokens.add(result.nextPageToken);cursor=result.nextPageToken
    }
    return fail()
  }
  const query=(col:string,value:string)=>col+':'+JSON.stringify(value)
  async function capture(number:string,signal:AbortSignal){
    const budget=await read('budget',query(c.budget.number,number),signal)
    if(budget.pages[0]!.totalRows===0)throw new ServiceError(404,'HISTORICAL_BUDGET_NOT_FOUND','Orçamento não encontrado no ERP.')
    if(budget.pages[0]!.totalRows!==1)return fail()
    const row=budget.pages[0]!.rows[0]!
    if(row.values[c.budget.number]?.value!==number)return fail()
    const link=object(row.values[c.budget.attendance]?.value)
    if(link.type!=='ref'||link.targetTableId!==t.attendance||typeof link.name!=='string')return fail()
    const attendance=await read('attendance',query(c.attendance.number,link.name),signal)
    if(attendance.pages[0]!.totalRows!==1||attendance.pages[0]!.rows[0]!.rowId!==rowId(link.rowId))return fail()
    const diagnoses=await read('diagnoses',query(c.diagnoses.budget,number),signal)
    const services=await read('services',query(c.services.budget,number),signal)
    const components=await read('components',query(c.components.budget,number),signal)
    const stages=await read('stages',query(c.stages.budget,number),signal)
    return {format:'funix-historical-coda-capture-v1',documentId:doc,tables:{budget,attendance,diagnoses,services,components,stages}}
  }
  return async raw=>{
    const number=historicalBudgetNumber(raw),signal=AbortSignal.timeout(90000)
    const first=await capture(number,signal),second=await capture(number,signal)
    normalizeHistoricalCodaCapture(first,second)
    return {first,second}
  }
}
