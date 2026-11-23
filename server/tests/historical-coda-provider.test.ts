import test from 'node:test'
import assert from 'node:assert/strict'
import {createHistoricalCodaProvider} from '../historical-coda-provider.ts'
import {historicalCapture} from './fixtures/historical-capture.ts'
import {normalizeHistoricalCodaCapture} from '../historical-coda-capture.ts'

function native(v:unknown):unknown{
  if(Array.isArray(v))return v.map(native)
  if(v===null||typeof v!=='object')return v
  const x=v as Record<string,unknown>
  if(x.type==='ref')return {'@type':'StructuredValue',additionalType:'row',name:x.name,rowId:x.rowId,tableId:x.targetTableId}
  if(x.type==='currency')return {'@type':'MonetaryAmount',currency:x.code,amount:x.scalar}
  if(x.type==='dt')return new Date(Number(x.epoch)*1000).toISOString()
  if(x.type==='slate')return 'Preparação técnica'
  throw Error('Synthetic unsupported value')
}
test('Coda v1 provider reads exact filters twice, only GET fixed host, maps native rich values',async()=>{
  const fixture=historicalCapture(),calls:string[]=[]
  const provider=createHistoricalCodaProvider({token:'synthetic-token-not-real',fetchImpl:async (input,init)=>{
    const url=new URL(String(input));calls.push(url.toString())
    assert.equal(url.origin,'https://coda.io');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error')
    const t=Object.values(fixture.tables).find(x=>url.pathname.includes('/tables/'+x.tableId+'/rows'))!
    assert.ok(t);assert.ok(url.searchParams.get('query'))
    return Response.json({items:t.pages[0]!.rows.map(r=>({id:r.rowId,values:Object.fromEntries(Object.entries(r.values).map(([k,v])=>[k,native(v.value)]))}))})
  }})
  const result=await provider('SYNTHETIC-BUDGET')
  const p=normalizeHistoricalCodaCapture(result.first,result.second)
  assert.equal(p.financialIntegrity,true);assert.equal(p.calculated.total,'220')
  assert.equal(calls.length,12)
  assert.ok(calls.every(x=>!x.includes('synthetic-token-not-real')))
})
test('provider rejects untrusted identifiers, upstream error and unexpected response',async()=>{
  let calls=0
  const p=createHistoricalCodaProvider({token:'synthetic-token-not-real',fetchImpl:async()=>{calls++;return new Response('unauthorized',{status:401})}})
  await assert.rejects(()=>p('invalid?number'),{code:'HISTORICAL_BUDGET_NUMBER_INVALID'})
  assert.equal(calls,0)
  await assert.rejects(()=>p('SYNTHETIC-BUDGET'),{code:'HISTORICAL_CODA_READ_FAILED'})
  const q=createHistoricalCodaProvider({token:'synthetic-token-not-real',fetchImpl:async()=>Response.json({items:[],nextPageToken:'loop'})})
  await assert.rejects(()=>q('SYNTHETIC-BUDGET'),{code:'HISTORICAL_CODA_READ_FAILED'})
})
