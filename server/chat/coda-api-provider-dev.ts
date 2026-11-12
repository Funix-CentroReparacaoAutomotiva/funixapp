import { createHash } from 'node:crypto'
import type { ConfirmedCodaPage, ConfirmedCodaPageProvider } from './coda-reconciliation-runner-dev.ts'
import type { RecoverableCodaRow } from './coda-recovery-dev.ts'

/**
 * Read-only Coda v1 adapter for the existing FUNIX DEV. Uses immutable column
 * IDs and rich lookups, not names/telephone matching. It NEVER writes to Coda.
 *
 * This module has no startup side effects; credentials are injected by the
 * caller and never logged. A scan is still not an atomic database snapshot.
 */
const columns = {
  event: 'c-lsQIF3vIWr',     // fx_UUID
  jid: 'c-rAEurF2Nmz',       // api_ID Omnichanel
  channel: 'c-PHvyLm0gyd',  // funil_Canal
  phone: 'c-5poWJk5IsH',    // funil_contatoE164
} as const
export const funixCodaAtendimentos = {
  docId: '2zsjI-nqWr',
  tableId: 'grid-eGvJhrlDTH',
} as const

export type CodaReadConfig = {
  token: string
  docId?: string
  tableId?: string
  fetchImpl?: typeof fetch
  pageSize?: number
}
const rowIdPattern = /^i-[A-Za-z0-9_-]{1,100}$/
const refPattern = /^i-[A-Za-z0-9_-]{1,100}$/
const isObject = (x:unknown):x is Record<string,unknown> =>
  x!==null && typeof x==='object' && !Array.isArray(x)
function stringOrEmpty(x:unknown):string {
  return typeof x==='string' ? x : ''
}
function lookupId(x:unknown):unknown {
  // Rich Coda lookup value: {@type:"StructuredValue",additionalType:"row",rowId:"i-..."}
  if (isObject(x) && x.additionalType==='row' &&
      typeof x.rowId==='string' && refPattern.test(x.rowId)) return x.rowId
  // Coda may deliver a plain reference ID for an ordinary value.
  if (typeof x==='string' && refPattern.test(x)) return x
  // All other formats, including display names, fail closed downstream.
  return null
}
function projectRow(raw:unknown):RecoverableCodaRow {
  if(!isObject(raw) || typeof raw.id!=='string' ||
     !rowIdPattern.test(raw.id) || !isObject(raw.values))
    throw Error('CODA_INVALID_ROW')
  const values=raw.values
  // Fail if the connector accidentally changes to column names or a view
  // excluding the required columns. Empty values themselves are permitted.
  if(!Object.hasOwn(values,columns.event) && !Object.hasOwn(values,columns.jid) &&
     !Object.hasOwn(values,columns.channel))
    throw Error('CODA_MISSING_REQUIRED_COLUMNS')
  return {
    id:raw.id,
    fx_UUID:stringOrEmpty(values[columns.event]),
    'api_ID Omnichanel':stringOrEmpty(values[columns.jid]),
    funil_Canal:lookupId(values[columns.channel]),
    funil_contatoE164:stringOrEmpty(values[columns.phone]),
  }
}
/** Single Coda API page, no retries inside the adapter (retry upstream). */
export function createCodaApiPageProvider(config:CodaReadConfig):ConfirmedCodaPageProvider {
  const docId=config.docId??funixCodaAtendimentos.docId
  const tableId=config.tableId??funixCodaAtendimentos.tableId
  const pageSize=config.pageSize??100
  const token=config.token
  if(typeof token!=='string'||token.length<16||token.length>2048||
     /[\u0000-\u001f\u007f]/.test(token) ||
     !/^[A-Za-z0-9_-]{3,100}$/.test(docId) ||
     !/^grid-[A-Za-z0-9_-]{1,100}$/.test(tableId) ||
     !Number.isInteger(pageSize)||pageSize<1||pageSize>100)
    throw Error('CODA_INVALID_CONFIG')
  const fetchImpl=config.fetchImpl??fetch
  return async (cursor:string|null):Promise<ConfirmedCodaPage> => {
    if(cursor!==null && (typeof cursor!=='string'||cursor.length===0||cursor.length>512))
      throw Error('CODA_INVALID_CURSOR')
    const url=new URL('https://coda.io/apis/v1/docs/'+encodeURIComponent(docId)+
      '/tables/'+encodeURIComponent(tableId)+'/rows')
    if(cursor===null){
      url.searchParams.set('limit',String(pageSize))
      url.searchParams.set('valueFormat','rich')
      url.searchParams.set('visibleOnly','false')
      url.searchParams.set('useColumnNames','false')
      url.searchParams.set('sortBy','createdAt')
    }else{
      // Per Coda API: pageToken is opaque; all other query settings are
      // inherited from that token and are ignored if explicitly repeated.
      url.searchParams.set('pageToken',cursor)
    }
    let raw:unknown
    try {
      const response=await fetchImpl(url.toString(),{
        method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
        cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),
      })
      if(response.status!==200)throw Error('CODA_HTTP_'+response.status)
      const body=await response.text()
      if(body.length>8_000_000)throw Error('CODA_BODY_TOO_LARGE')
      raw=JSON.parse(body) as unknown
    }catch(err){
      // Never include URLs, bearer token or potentially identifying payloads.
      if(err instanceof Error && /^CODA_(HTTP_|BODY_TOO_LARGE)/.test(err.message))
        throw err
      throw Error('CODA_REQUEST_FAILED')
    }
    if(!isObject(raw)||!Array.isArray(raw.items)||
       raw.items.length>pageSize ||
       (raw.nextPageToken!==undefined &&
        (typeof raw.nextPageToken!=='string'||raw.nextPageToken.length===0||
         raw.nextPageToken.length>512)))
      throw Error('CODA_INVALID_PAGE')
    const rows=raw.items.map(projectRow)
    const nextCursor=typeof raw.nextPageToken==='string' ? raw.nextPageToken : null
    return {rows,nextCursor,complete:nextCursor===null}
  }
}

/**
 * Two-pass stable scan, useful when Coda is changing during pagination.
 * Both complete passes must match by row ID and all source identity fields.
 * NOT a transaction/snapshot guarantee: a row can still change afterwards.
 */
export function createDoubleCheckedCodaPageProvider(
  page: ConfirmedCodaPageProvider,
  limit=10000,
):ConfirmedCodaPageProvider {
  if(!Number.isInteger(limit)||limit<1||limit>10000)throw Error('CODA_INVALID_LIMIT')
  async function fullScan():Promise<RecoverableCodaRow[]>{
    const rows:RecoverableCodaRow[]=[]
    const cursors=new Set<string>()
    let cursor:string|null=null
    for(let n=0;n<200;n++){
      const data=await page(cursor)
      if(!data || !Array.isArray(data.rows) ||
         typeof data.complete!=='boolean' ||
         data.rows.some(r=>!r||typeof r.id!=='string') ||
         rows.length+data.rows.length>limit)
        throw Error('CODA_UNVERIFIED_SCAN')
      rows.push(...data.rows)
      if(data.nextCursor===null){
        if(!data.complete)throw Error('CODA_UNVERIFIED_SCAN')
        const ids=new Set(rows.map(r=>r.id))
        if(ids.size!==rows.length)throw Error('CODA_DUPLICATE_ROW')
        return rows
      }
      if(data.complete||!data.nextCursor||data.nextCursor===cursor||
         cursors.has(data.nextCursor)||data.rows.length===0)
        throw Error('CODA_UNVERIFIED_SCAN')
      cursors.add(data.nextCursor)
      cursor=data.nextCursor
    }
    throw Error('CODA_PAGE_LIMIT')
  }
  function fingerprint(rows:RecoverableCodaRow[]):string{
    const sorted=[...rows].sort((a,b)=>a.id.localeCompare(b.id))
    return createHash('sha256').update(JSON.stringify(sorted.map(r=>[
      r.id,r.fx_UUID,r['api_ID Omnichanel'],r.funil_Canal,r.funil_contatoE164,
    ]))).digest('hex')
  }
  return async (cursor:string|null):Promise<ConfirmedCodaPage>=>{
    if(cursor!==null)throw Error('CODA_DOUBLE_SCAN_UNSUPPORTED_CURSOR')
    const first=await fullScan()
    const second=await fullScan()
    if(fingerprint(first)!==fingerprint(second))throw Error('CODA_SCAN_CHANGED')
    return {rows:second,nextCursor:null,complete:true}
  }
}
