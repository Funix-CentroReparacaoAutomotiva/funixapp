import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCodaApiPageProvider,createDoubleCheckedCodaPageProvider } from '../chat/coda-api-provider-dev.ts'

const token='synthetic_dev_token_not_a_real_credential'
const row=(id='i-SYNTH_1',event='evo:funix_comercial:SYNTH_1')=>({
  id,values:{
    'c-lsQIF3vIWr':event,
    'c-rAEurF2Nmz':'5531999990001@s.whatsapp.net',
    'c-PHvyLm0gyd':{additionalType:'row',rowId:'i-O01Tgl0bN2'},
    'c-5poWJk5IsH':'+5531999990001',
  },
})
test('Coda DEV provider: projects stable column IDs and rich row reference, obeys opaque page token',async()=>{
  const requests:string[]=[]
  const fetchImpl=(async(input:string|URL,opts:RequestInit)=>{
    const url=new URL(String(input));requests.push(url.toString())
    assert.equal(opts.method,'GET')
    assert.equal((opts.headers as Record<string,string>).Authorization,'Bearer '+token)
    const body=url.searchParams.has('pageToken')
      ? {items:[row('i-SYNTH_2','evo:funix_comercial:SYNTH_2')]}
      : {items:[row()],nextPageToken:'opaque.token-2'}
    return new Response(JSON.stringify(body),{status:200})
  }) as typeof fetch
  const next=createCodaApiPageProvider({token,fetchImpl})
  const a=await next(null)
  assert.equal(a.complete,false)
  assert.equal(a.nextCursor,'opaque.token-2')
  assert.equal(a.rows[0]?.funil_Canal,'i-O01Tgl0bN2')
  const actualConnectorRef={...row(),values:{...row().values,
    'c-PHvyLm0gyd':{type:'ref',rowId:'i-O01Tgl0bN2',targetTableId:'grid-SYNTHETIC'},
  }}
  const refPage=createCodaApiPageProvider({
    token,fetchImpl:(async()=>new Response(JSON.stringify({items:[actualConnectorRef]}),{status:200})) as typeof fetch,
  })
  assert.equal((await refPage(null)).rows[0]?.funil_Canal,'i-O01Tgl0bN2')
  assert.equal(a.rows[0]?.fx_UUID,'evo:funix_comercial:SYNTH_1')
  const b=await next(a.nextCursor)
  assert.equal(b.complete,true)
  assert.equal(b.rows[0]?.id,'i-SYNTH_2')
  assert.equal(new URL(requests[0]!).searchParams.get('valueFormat'),'rich')
  assert.equal(new URL(requests[0]!).searchParams.get('useColumnNames'),'false')
  assert.equal(new URL(requests[1]!).searchParams.get('pageToken'),'opaque.token-2')
})
test('Coda DEV provider: invalid payload and wrong column projection are rejected',async()=>{
  const run=async(body:unknown,status=200)=>{
    const api=createCodaApiPageProvider({
      token,fetchImpl:(async()=>new Response(JSON.stringify(body),{status})) as typeof fetch,
    })
    return api(null)
  }
  await assert.rejects(run({items:[{id:'i-BAD',values:{name:'display name'}}]}),/CODA_MISSING_REQUIRED_COLUMNS/)
  await assert.rejects(run({items:[{id:'malformed id',values:{}}]}),/CODA_INVALID_ROW/)
  await assert.rejects(run({items:[],nextPageToken:123}),/CODA_INVALID_PAGE/)
  await assert.rejects(run({items:[]},403),/CODA_HTTP_403/)
})
test('Coda DEV provider: unrecognized display labels are not treated as verified channel IDs',async()=>{
  const item=row()
  item.values['c-PHvyLm0gyd']='WhatsApp' as never
  const api=createCodaApiPageProvider({
    token,fetchImpl:(async()=>new Response(JSON.stringify({items:[item]}),{status:200})) as typeof fetch,
  })
  const page=await api(null)
  assert.equal(page.rows[0]?.funil_Canal,null)
})
test('Coda DEV double scan: stable two-pass comparison, rejects changing identities',async()=>{
  let calls=0
  const stable=createDoubleCheckedCodaPageProvider(async()=>{
    calls++;return {rows:[{
      id:'i-SYNTH_1',fx_UUID:'evo:funix_comercial:SYNTH',
      'api_ID Omnichanel':'5531999990001@s.whatsapp.net',
      funil_Canal:'i-O01Tgl0bN2',funil_contatoE164:'+5531999990001',
    }],nextCursor:null,complete:true}
  })
  assert.equal((await stable(null)).complete,true)
  assert.equal(calls,2)
  let tick=0
  const changing=createDoubleCheckedCodaPageProvider(async()=>{
    tick++
    return {rows:[{
      id:'i-SYNTH_1',fx_UUID:'evo:funix_comercial:SYNTH',
      'api_ID Omnichanel':tick===1?'5531999990001@s.whatsapp.net':'5531888880000@s.whatsapp.net',
      funil_Canal:'i-O01Tgl0bN2',
    }],nextCursor:null,complete:true}
  })
  await assert.rejects(changing(null),/CODA_SCAN_CHANGED/)
})
test('Coda DEV double scan: duplicate row and incomplete page are never accepted',async()=>{
  const dup=createDoubleCheckedCodaPageProvider(async()=>({
    rows:[{id:'i-SYNTH_1',fx_UUID:'', 'api_ID Omnichanel':'',funil_Canal:null},
      {id:'i-SYNTH_1',fx_UUID:'','api_ID Omnichanel':'',funil_Canal:null}],
    nextCursor:null,complete:true,
  }))
  await assert.rejects(dup(null),/CODA_DUPLICATE_ROW/)
  const incomplete=createDoubleCheckedCodaPageProvider(async()=>({
    rows:[],nextCursor:null,complete:false,
  }))
  await assert.rejects(incomplete(null),/CODA_UNVERIFIED_SCAN/)
})
