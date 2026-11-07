import test from'node:test'
import assert from'node:assert/strict'
import{once}from'node:events'
import{mkdtempSync,readFileSync,writeFileSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{openDatabase}from'../database.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{createApp}from'../app.ts'
import{readVoiceContext}from'../voice-context.ts'
import{voiceRevisions}from'../voice-planner.ts'
import{stageVoiceResolution}from'../voice-resolution.ts'
import{saneQuoteQuery}from'../component-quote-query.ts'
import{openAIQuoteProvider,validateQuoteResponse,safeQuoteUrl}from'../component-quote-provider.ts'
import{reserveQuoteAttempt}from'../component-quote-budget.ts'
import{createQuoteService}from'../component-quote-service.ts'
import{quoteFixtureQuery as q,quoteFixtureOffer as offer,quoteFixtureResponse as response,quoteFixtureUrl}from'./fixtures/component-quote.ts'
import type{QuoteProvider}from'../component-quote-provider.ts'
import type{VoiceCommandBatch}from'../../shared/voice-commands.ts'
const origin='http://127.0.0.1:5173',password='synthetic-quote-password'
const signal=()=>new AbortController().signal

test('quotation projects a closed technical vocabulary; no customer identifiers, arbitrary vehicle text or year guesses',()=>{
 const base={brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019',component:'farol dianteiro esquerdo',parent:'para-choque dianteiro'}
 assert.deepEqual(saneQuoteQuery(base),q)
 assert.equal(saneQuoteQuery({...base,vehicle:'Gol'} )?.year,null)
 for(const bad of ['farol dianteiro esquerdo Maria','farol <script>alert(1)</script>','farol cliente João','farol ABC1D23','farol 11988776655','farol chassi 9BWZZZ377VT004251'])assert.equal(saneQuoteQuery({...base,component:bad}),null)
 assert.equal(saneQuoteQuery({...base,component:'farol dianteiro'}),null)
 assert.equal(saneQuoteQuery({...base,component:'farol esquerdo direito'}),null)
 assert.equal(saneQuoteQuery({...base,vehicle:'Gol 2018 2019'}),null)
 assert.equal(saneQuoteQuery({...base,model:'Gol Polo'}),null)
})
test('quotation requires an actual completed search, usage, structured output and matching source/citation',()=>{
 assert.equal(validateQuoteResponse(response(),q).offers[0]?.price,'39.90')
 const raw=response();raw.output=raw.output.slice(1);assert.throws(()=>validateQuoteResponse(raw,q),/cotar/)
 const noCitations=response();noCitations.output[1]!.content![0]!.annotations=[];assert.equal(validateQuoteResponse(noCitations,q).offers.length,0)
 const noSources=response();noSources.output[0]!.action!.sources=[];assert.equal(validateQuoteResponse(noSources,q).offers.length,0)
 const invalid=response();invalid.output[1]!.content![0]!.text='not JSON';assert.throws(()=>validateQuoteResponse(invalid,q))
 const refused=response();refused.output[1]!.content=[{type:'refusal'} as never];assert.throws(()=>validateQuoteResponse(refused,q))
 const unfinished=response();unfinished.status='incomplete';assert.throws(()=>validateQuoteResponse(unfinished,q))
 const noUsage={...response(),usage:undefined};assert.throws(()=>validateQuoteResponse(noUsage,q))
})
test('quotation rejects wrong part/side/generation, zero, kit, installment, conditional price and unsupported original claims',()=>{
 for(const patch of [{price:'0'},{priceKind:'installment'},{priceKind:'conditional'},{priceKind:'range'},{unit:'kit'},{side:'direito'},{yearFrom:2021},{yearTo:2018},{title:'Travessa parachoque dianteiro Gol'},{title:'Farol dianteiro esquerdo Gol kit par'},{price:'1.00'},{officialEvidence:'original'},{condition:'used'},{url:'javascript:alert(1)'},{priceText:'12x R$ 3,99'},{sourceQuote:'R$ 39,90'},{model:'Polo'},{condition:'new',sourceQuote:offer.sourceQuote.replace('novo','')}])assert.equal(validateQuoteResponse(response([{...offer,...patch}]),q).offers.length,0,JSON.stringify(patch))
 assert.equal(validateQuoteResponse(response(),{...q,year:null}).offers.length,0)
  assert.equal(validateQuoteResponse(response(),{...q,component:q.component+' led'}).offers.length,0)
  assert.equal(validateQuoteResponse(response([{...offer,title:'Suporte farol dianteiro esquerdo Gol'}]),q).offers.length,0)
  assert.equal(validateQuoteResponse(response([{...offer,sourceQuote:offer.sourceQuote+' <img src=x onerror=alert(1)>'}]),q).offers.length,0)
  assert.equal(validateQuoteResponse(response([{...offer,sourceQuote:offer.sourceQuote.replace('R$ 39,90','12x R$ 39,90')}]),q).offers.length,0)
  assert.equal(validateQuoteResponse(response([{...offer,price:'100',priceText:'R$ 100',sourceQuote:offer.sourceQuote.replace('R$ 39,90','R$ 100')}]),q).offers[0]?.price,'100')
  assert.equal(validateQuoteResponse(response([{...offer,officialEvidence:'Peça original Volkswagen',sourceQuote:offer.sourceQuote.replace('Loja oficial Volkswagen','Peça original Volkswagen')}]),q).offers.length,0)
 const balanced={...offer,category:'equilibrada',condition:'used',qualityEvidence:'procedencia documentada',sourceQuote:offer.sourceQuote.replace('novo','usado')+' procedencia documentada'}
 assert.equal(validateQuoteResponse(response([balanced]),q).offers[0]?.condition,'used')
 assert.equal(validateQuoteResponse(response([{...balanced,qualityEvidence:''}]),q).offers.length,0)
})
test('quotation links cannot contain credentials, tracking, arbitrary origins, listings or script URLs',()=>{
 assert.equal(safeQuoteUrl(quoteFixtureUrl),quoteFixtureUrl)
 for(const url of ['http://produto.mercadolivre.com.br/x','https://user:token@produto.mercadolivre.com.br/x','https://mercadolivre.com.br.evil.test/x','https://127.0.0.1/x','https://mercadolivre.com.br/loja/volkswagen','https://lista.mercadolivre.com.br/x','https://produto.mercadolivre.com.br/x?redirect=https://evil.test','https://produto.mercadolivre.com.br:444/x','javascript:alert(1)'])assert.equal(safeQuoteUrl(url),null)
})
test('quotation transport fixes model/tool ceilings and reserves even failed calls across provider restarts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quote-')),ledger=join(dir,'ledger.json');let calls=0
 const transport:typeof fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(init!.body as string);assert.equal(b.max_tool_calls,1);assert.equal(b.parallel_tool_calls,false);assert.equal(b.max_output_tokens,4096);assert.equal(b.tools.length,1);assert.equal(b.tools[0].type,'web_search');assert.equal(b.tool_choice.type,'web_search');assert.equal(b.store,false);assert.equal(b.model,'gpt-5.4-mini-2026-03-17');assert.deepEqual(JSON.parse(b.input),q);return new Response(JSON.stringify(response()))}
 try{
  for(let i=0;i<10;i++)await openAIQuoteProvider({key:'synthetic',ledger,transport}).search(q,signal())
  await assert.rejects(openAIQuoteProvider({key:'synthetic',ledger,transport}).search(q,signal()))
  assert.equal(calls,10);assert.equal(JSON.parse(readFileSync(ledger,'utf8')).reserved,10)
  const bad=join(dir,'bad');writeFileSync(bad,'broken');assert.throws(()=>reserveQuoteAttempt(bad))
  const failing=join(dir,'failure');await assert.rejects(openAIQuoteProvider({key:'synthetic',ledger:failing,transport:async()=>{throw Error('private-token')}}).search(q,signal()),e=>!String(e).includes('private-token'))
  assert.equal(JSON.parse(readFileSync(failing,'utf8')).reserved,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('quotation transport bounds body, sanitizes rate errors, refusal and multiple tools; never retries',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quote-'));let calls=0
 try{
  for(const result of [new Response('private provider error',{status:429}),new Response('x'.repeat(512*1024+1)),new Response(JSON.stringify({...response(),output:[response().output[0],...response().output]}))]){
   const p=openAIQuoteProvider({key:'synthetic',ledger:join(dir,'ledger'),transport:async()=>{calls++;return result}})
   await assert.rejects(p.search(q,signal()),e=>!String(e).includes('private provider'))
  }
  assert.equal(calls,3)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('quotation coalesces concurrent clicks, caches only within a session and caps global calls',async()=>{
 let calls=0,now=1000;const service=createQuoteService({search:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return validateQuoteResponse(response(),q)}},{now:()=>now,maxAttempts:2})
 await Promise.all([service.run(q,'a',signal()),service.run(q,'a',signal())]);assert.equal(calls,1)
 assert.equal((await service.run(q,'a',signal())).cached,true)
 await service.run(q,'b',signal());assert.equal(calls,2)
 now+=600001;await assert.rejects(service.run(q,'a',signal()));assert.equal(calls,2)
})
test('quotation timeout/cancellation discards providers that ignore AbortSignal, does not refund unknown usage or log query',async()=>{
 const observed:unknown[]=[]
 const service=createQuoteService({search:async()=>{await new Promise(r=>setTimeout(r,25));return validateQuoteResponse(response(),q)}},{timeoutMs:2,maxAttempts:1,observe:m=>observed.push(m)})
 await assert.rejects(service.run(q,'private-session',signal()))
 await assert.rejects(service.run(q,'private-session',signal()))
 await new Promise(r=>setTimeout(r,35))
 assert(!JSON.stringify(observed).includes('volkswagen'));assert(!JSON.stringify(observed).includes('private-session'))
 assert.equal((observed[0] as {inputTokens:null}).inputTokens,null)
})

async function httpFixture(provider?:QuoteProvider){
 const db=openDatabase(':memory:'),f=commercialFixture(db);let now=Date.now()
 f.atendimentos.update(f.at.id,{revision:f.at.revision,brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019'})
 const parent=f.commercial.catalogs().items.find(x=>x.code==='para_choque_dianteiro')!;f.commercial.add(f.at.id,{pieceCodes:[parent.code!]})
 const app=createApp({atendimentos:f.atendimentos,origin,password,now:()=>now,quotePilot:provider?createQuoteService(provider):undefined,voiceProvider:null});app.listen(0,'127.0.0.1');await once(app,'listening')
 const host='http://127.0.0.1:'+(app.address() as {port:number}).port
 const auth=async()=>{const r=await fetch(host+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});return r.headers.get('set-cookie')!.split(';')[0]!}
 const cookie=await auth(),session=cookie.slice(cookie.indexOf('=')+1)
 const ctx=readVoiceContext(db,f.at.id,f.scenario.id),batch:VoiceCommandBatch={format:'funix-voice-commands-v1',idempotencyKey:'quote-test',atendimentoId:f.at.id,scenarioId:f.scenario.id,expected:voiceRevisions(ctx),commands:[{id:'c',op:'add_component',intent:'instruction',piece:{state:'resolved',id:parent.id},name:'farol dianteiro esquerdo',quantity:'1',manualPrice:'0'}]}
 const staged=stageVoiceResolution(db,batch,'DITADO PRIVADO',ctx,session,'test')
 const body={scenarioId:f.scenario.id,resolutionId:staged.resolution!.id,commandId:'c'},headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'},route='/api/atendimentos/'+f.at.id+'/copiloto/'
 return{db,f,body,headers,staged,auth,host,session,expire:()=>{now+=9*3600000},post:(b:unknown=body,extra:Record<string,string>={},path='cotar')=>fetch(host+route+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(b)}),close:async()=>{app.closeAllConnections();await new Promise<void>(resolve=>app.close(()=>resolve()));db.close()}}
}
test('quotation HTTP is default off; authentication, origin, shape and review ownership guard calls',async()=>{
 let calls=0;const off=await httpFixture()
 try{assert.equal((await off.post()).status,503)}finally{await off.close()}
 const h=await httpFixture({search:async(query)=>{calls++;assert.deepEqual(query,q);return validateQuoteResponse(response(),query)}})
 try{
  assert.equal((await h.post(undefined,{Cookie:''})).status,401)
  assert.equal((await h.post(undefined,{Origin:'https://evil.invalid'})).status,403)
  assert.equal((await h.post({...h.body,query:'private query'})).status,400)
  assert.equal((await h.post(undefined,{Cookie:await h.auth()})).status,409)
  const writes=h.db.prepare('SELECT total_changes() n').get()!.n
  const r=await h.post();assert.equal(r.status,200);assert.equal((await r.json()).offers.length,1)
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,writes);assert.equal(calls,1)
 }finally{await h.close()}
})
test('quotation selection uses one existing ephemeral revision; old review invalidated and no Apply or component write',async()=>{
 const h=await httpFixture({search:async()=>validateQuoteResponse(response(),q)})
 try{
  await h.post();const writes=h.db.prepare('SELECT total_changes() n').get()!.n
  const result=await h.post({...h.body,quantity:'1',manualPrice:'39.90'}, {},'revisar');assert.equal(result.status,200)
  const revised=await result.json();assert.equal(revised.plan.changes.find((c:{op:string})=>c.op==='add_component').values.manualPrice,'39.9')
  assert.equal((await h.post()).status,409);assert.equal((await h.post({...h.body,quantity:'1',manualPrice:'40.00'},{},'revisar')).status,409)
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,writes)
  assert.equal(h.db.prepare('SELECT count(*) n FROM component_items').get()!.n,0)
 }finally{await h.close()}
})
test('quotation is blocked in production even with an explicitly injected provider',async()=>{
 let calls=0;const previous=process.env.NODE_ENV,h=await httpFixture({search:async()=>{calls++;return validateQuoteResponse(response(),q)}})
 try{
  process.env.NODE_ENV='production'
  assert.equal((await h.post()).status,503)
  const capability=await fetch(h.host+'/api/cotacoes/capacidade',{headers:h.headers})
  assert.equal((await capability.json()).enabled,false);assert.equal(calls,0)
 }finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;await h.close()}
})
test('quotation HTTP discards a response after logout/expiry or changed vehicle/review',async()=>{
 let release!:()=>void;const wait=new Promise<void>(r=>{release=r})
 const h=await httpFixture({search:async()=>{await wait;return validateQuoteResponse(response(),q)}})
 try{const running=h.post();await new Promise(r=>setTimeout(r,10));h.expire();release();assert.equal((await running).status,401)}finally{release();await h.close()}
 const h2=await httpFixture({search:async()=>{h2.f.atendimentos.update(h2.f.at.id,{revision:h2.f.atendimentos.get(h2.f.at.id).revision,vehicle:'Gol 2020'});return validateQuoteResponse(response(),q)}})
 try{assert.equal((await h2.post()).status,409)}finally{await h2.close()}
})
