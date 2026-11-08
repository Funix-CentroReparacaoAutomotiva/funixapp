import test from'node:test'
import assert from'node:assert/strict'
import{once}from'node:events'
import{mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{openDatabase}from'../database.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{createApp}from'../app.ts'
import{readVoiceContext}from'../voice-context.ts'
import{voiceRevisions}from'../voice-planner.ts'
import{stageVoiceResolution}from'../voice-resolution.ts'
import{saneQuoteQuery}from'../component-quote-query.ts'
import{openAIQuoteProvider,validateQuoteResponse,safeQuoteUrl,QUOTE_DISCOVERY_INSTRUCTIONS,QUOTE_INSTRUCTIONS}from'../component-quote-provider.ts'
import{reserveQuoteAttempt}from'../component-quote-budget.ts'
import{ComponentRepository}from'../components.ts'
import{createQuoteService}from'../component-quote-service.ts'
import{loadQuotePilot}from'../component-quote-bootstrap.ts'
import{createQuoteMetricsObserver}from'../component-quote-observability.ts'
import type{ServiceError}from'../errors.ts'
import{quoteFixtureQuery as q,quoteFixtureOffer as offer,quoteFixtureResponse as response,quoteFixtureUrl}from'./fixtures/component-quote.ts'
import type{QuoteProvider}from'../component-quote-provider.ts'
import type{VoiceCommandBatch}from'../../shared/voice-commands.ts'
const origin='http://127.0.0.1:5173',password='synthetic-quote-password'
const signal=()=>new AbortController().signal

test('quotation projects a closed technical vocabulary; no customer identifiers, arbitrary vehicle text or year guesses',()=>{
 const base={brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019',component:'farol dianteiro esquerdo',parent:'para-choque dianteiro'}
 assert.deepEqual(saneQuoteQuery(base),q)
 assert.deepEqual(saneQuoteQuery({...base,parent:'Farol Motorista'}),{...q,parent:'farol esquerdo'})
 assert.deepEqual(saneQuoteQuery({...base,parent:'Farol · motorista'}),{...q,parent:'farol esquerdo'})
 assert.deepEqual(saneQuoteQuery({...base,parent:'Farol Passageiro',component:'farol dianteiro direito'}),{...q,parent:'farol direito',component:'farol dianteiro direito',side:'direito'})
 assert.equal(saneQuoteQuery({...base,parent:'Farol Passageiro'}),null,'catalog passenger side must reject a left component')
 assert.equal(saneQuoteQuery({...base,parent:'Farol Motorista',component:'farol dianteiro direito'}),null,'catalog driver side must reject a right component')
 assert.equal(saneQuoteQuery({...base,parent:'Farol Motorista Passageiro'}),null,'conflicting catalog sides must be rejected')
 assert.equal(saneQuoteQuery({...base,parent:'Farol Motorista desconhecido'}),null,'no arbitrary catalog words')
 assert.equal(saneQuoteQuery({...base,component:'farol motorista'}),null,'component still needs an explicit technical side')
 assert.equal(saneQuoteQuery({...base,vehicle:'Gol',parent:'Farol Motorista'})?.year,null,'catalog alias must not infer vehicle year')
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
test('quotation counts first rejection reasons without changing offer selection',()=>{
 const zero=validateQuoteResponse(response([]),q).metrics
 assert.equal(zero.proposedOffers,0);assert.equal(zero.acceptedOffers,0);assert.equal(zero.rejected,0)
 assert.deepEqual(zero.rejectionReasons,{})
 const noCitations=response();noCitations.output[1]!.content![0]!.annotations=[]
 const missing=validateQuoteResponse(noCitations,q).metrics
 assert.equal(missing.proposedOffers,1);assert.equal(missing.acceptedOffers,0);assert.equal(missing.rejected,1)
 assert.deepEqual(missing.rejectionReasons,{source:1})
 const price=validateQuoteResponse(response([{...offer,price:'0'}]),q).metrics
 assert.deepEqual(price.rejectionReasons,{price:1})
 const side=validateQuoteResponse(response([{...offer,side:'direito'}]),q).metrics
 assert.deepEqual(side.rejectionReasons,{side:1})
 const accepted=validateQuoteResponse(response(),q).metrics
 assert.equal(accepted.proposedOffers,1);assert.equal(accepted.acceptedOffers,1);assert.equal(accepted.rejected,0)
 assert.deepEqual(accepted.rejectionReasons,{})
 assert.equal(accepted.usableSources,1);assert.equal(accepted.usableCitations,1)
})
test('quote metrics are opt-in, sanitized and logging exceptions cannot break calls',async()=>{
 const lines:string[]=[]
 assert.equal(createQuoteMetricsObserver(false,line=>lines.push(line)),undefined)
 const m=validateQuoteResponse(response([{...offer,price:'0'}]),q).metrics
 createQuoteMetricsObserver(true,line=>lines.push(line))!({...m,status:'PRIVATE_SESSION',rejectionReasons:{price:1,PRIVATE_ID:3} as never,secret:'PRIVATE_SECRET',query:'PRIVATE_QUERY'} as never)
 assert.equal(lines.length,1);assert(lines[0]!.startsWith('funix_quote_metrics '))
 const data=JSON.parse(lines[0]!.slice('funix_quote_metrics '.length))
 assert.equal(data.status,'QUOTE_FAILED');assert.equal(data.proposedOffers,1)
 assert.deepEqual(data.rejectionReasons,{price:1})
 assert(!JSON.stringify(data).includes('PRIVATE'));assert(!JSON.stringify(data).includes('volkswagen'))
 assert.doesNotThrow(()=>createQuoteMetricsObserver(true,()=>{throw Error('PRIVATE_SECRET')})!(m))
 const events:unknown[]=[]
 const broken=createQuoteService({search:async()=>{throw Error('PRIVATE_TRANSPORT')}},{observe:metric=>events.push(metric)})
 await assert.rejects(broken.run(q,'PRIVATE_SESSION',signal()))
 const failed=events[0] as {proposedOffers:null;acceptedOffers:null;rejected:null;rejectionReasons:null;estimatedUsd:null}
 assert.equal(failed.proposedOffers,null);assert.equal(failed.acceptedOffers,null)
 assert.equal(failed.rejected,null);assert.equal(failed.rejectionReasons,null);assert.equal(failed.estimatedUsd,null)
 const healthy=createQuoteService({search:async()=>validateQuoteResponse(response(),q)},{observe:()=>{throw Error('PRIVATE_LOGGER')}})
 assert.equal((await healthy.run(q,'safe-session',signal())).status,'found')
})
test('quotation links cannot contain credentials, tracking, arbitrary origins, listings or script URLs',()=>{
 assert.equal(safeQuoteUrl(quoteFixtureUrl),quoteFixtureUrl)
 for(const url of ['http://produto.mercadolivre.com.br/x','https://user:token@produto.mercadolivre.com.br/x','https://mercadolivre.com.br.evil.test/x','https://127.0.0.1/x','https://mercadolivre.com.br/loja/volkswagen','https://lista.mercadolivre.com.br/x','https://produto.mercadolivre.com.br/x?redirect=https://evil.test','https://produto.mercadolivre.com.br:444/x','javascript:alert(1)'])assert.equal(safeQuoteUrl(url),null)
})
test('focused discovery stays opt-in, uses one medium-context search and preserves limits and validator',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quote-discovery-'))
 const variants:{context:string;instructions:string;tools:number;output:number}[]=[]
 try{
  for(const [enabled,expected] of [[false,'low'],[true,'medium']] as const){
   const ledger=join(dir,enabled?'v2.json':'baseline.json')
   let calls=0
   const provider=openAIQuoteProvider({key:'synthetic',ledger,discoveryV2:enabled,transport:async(url,init)=>{
    calls++
    assert.equal(url,'https://api.openai.com/v1/responses')
    const body=JSON.parse(init!.body as string)
    assert.equal(body.tools.length,1)
    assert.equal(body.tools[0].type,'web_search')
    assert.equal(body.tools[0].search_context_size,expected)
    assert.equal(body.max_tool_calls,1)
    assert.equal(body.parallel_tool_calls,false)
    assert.equal(body.max_output_tokens,4096)
    assert.equal(body.store,false)
    assert.equal(body.background,false)
    assert.equal(body.text.format.name,'component_quote')
    assert.deepEqual(JSON.parse(body.input),q)
    assert.equal(body.instructions,enabled?QUOTE_DISCOVERY_INSTRUCTIONS:QUOTE_INSTRUCTIONS)
    variants.push({context:expected,instructions:body.instructions,tools:body.max_tool_calls,output:body.max_output_tokens})
    return new Response(JSON.stringify(response()))
   }})
   assert.equal((await provider.search(q,signal())).offers[0]?.price,'39.90')
   assert.equal(calls,1)
   assert.equal(JSON.parse(readFileSync(ledger,'utf8')).reserved,1)
  }
  assert.equal(variants.length,2)
  assert.notEqual(variants[0]!.instructions,variants[1]!.instructions)
  assert.match(QUOTE_DISCOVERY_INSTRUCTIONS,/UM anúncio/)
  assert.match(QUOTE_DISCOVERY_INSTRUCTIONS,/offers vazio/)
  assert.match(QUOTE_DISCOVERY_INSTRUCTIONS,/annotations/)
  assert.match(QUOTE_DISCOVERY_INSTRUCTIONS,/sem segunda busca/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('focused discovery does not accept evidence-free synthetic offers or modify safety checks',()=>{
 for(const patch of [{price:'0'},{side:'direito'},{yearFrom:2022},{url:'https://evil.test/item'},{condition:'used'},{sourceQuote:'R$ 39,90'}]){
  assert.equal(validateQuoteResponse(response([{...offer,...patch}]),q).offers.length,0)
 }
 const none=response([])
 assert.equal(validateQuoteResponse(none,q).offers.length,0)
 assert.equal(validateQuoteResponse(none,q).metrics.proposedOffers,0)
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
test('yearless quotations need details without transport, ledger or attempt consumption',async()=>{
 let calls=0
 const service=createQuoteService({search:async()=>{calls++;return validateQuoteResponse(response(),q)}},{maxAttempts:1})
 assert.equal((await service.run({...q,year:null},'s',signal())).status,'needs_details')
 assert.equal((await service.run({...q,year:null},'s',signal())).status,'needs_details')
 assert.equal(calls,0)
 assert.equal((await service.run(q,'s',signal())).status,'found');assert.equal(calls,1)
 const dir=mkdtempSync(join(tmpdir(),'quote-year-')),ledger=join(dir,'ledger')
 try{
  const provider=openAIQuoteProvider({key:'synthetic',ledger,transport:async()=>{calls++;throw Error('unexpected')}})
  await assert.rejects(provider.search({...q,year:null},signal()),e=>(e as ServiceError).code==='QUOTE_NEEDS_DETAILS')
  assert.equal(calls,1);assert.equal(existsSync(ledger),false);assert.equal(existsSync(ledger+'.lock'),false)
 }finally{rmSync(dir,{recursive:true,force:true})}
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

test('normal FUNIX startup quote provider is opt-in, reuses existing data volume, and refuses missing secrets',()=>{
 const dir=mkdtempSync(join(tmpdir(),'quote-app-')),dbPath=join(dir,'funix.sqlite')
 try{
  assert.equal(loadQuotePilot({OPENAI_API_KEY:'synthetic'},dbPath),undefined)
  assert.equal(loadQuotePilot({FUNIX_QUOTE_ENABLED:'false',OPENAI_API_KEY:'synthetic'},dbPath),undefined)
  assert.throws(()=>loadQuotePilot({FUNIX_QUOTE_ENABLED:'true'},dbPath),/OPENAI_API_KEY/)
  assert.throws(()=>loadQuotePilot({FUNIX_QUOTE_ENABLED:'true',OPENAI_API_KEY:'synthetic'},':memory:'),/armazenamento persistente/)
  assert.throws(()=>loadQuotePilot({FUNIX_QUOTE_ENABLED:'true',OPENAI_API_KEY:'synthetic',FUNIX_QUOTE_LEDGER:'relative-ledger'},dbPath),/Caminho persistente/)
  assert(loadQuotePilot({FUNIX_QUOTE_ENABLED:'true',OPENAI_API_KEY:'synthetic'},dbPath))
  assert.equal(existsSync(join(dir,'funix-quote-pilot-ledger.json')),false,'bootstrap must not spend or initialize a new round')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('production-like test app permits quotation only behind the explicit feature flag',async()=>{
 let calls=0
 const previousNode=process.env.NODE_ENV,previousFlag=process.env.FUNIX_QUOTE_ENABLED
 const h=await httpFixture({search:async()=>{calls++;return validateQuoteResponse(response(),q)}})
 try{
  process.env.NODE_ENV='production'
  delete process.env.FUNIX_QUOTE_ENABLED
  assert.equal((await h.post()).status,503)
  process.env.FUNIX_QUOTE_ENABLED='true'
  const capability=await fetch(h.host+'/api/cotacoes/capacidade',{headers:h.headers})
  assert.equal((await capability.json()).enabled,true)
  const quoted=await h.post()
  assert.equal(quoted.status,200)
  assert.equal((await quoted.json()).offers[0]?.price,'39.90')
  assert.equal(calls,1)
  process.env.FUNIX_QUOTE_ENABLED='false'
  assert.equal((await h.post()).status,503)
  assert.equal(calls,1)
 }finally{
  if(previousNode===undefined)delete process.env.NODE_ENV
  else process.env.NODE_ENV=previousNode
  if(previousFlag===undefined)delete process.env.FUNIX_QUOTE_ENABLED
  else process.env.FUNIX_QUOTE_ENABLED=previousFlag
  await h.close()
 }
})


test('saved diagnosis component quotation is independent of voice and requires explicit opt-in, authentication and revision',async()=>{
 const prev=process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED
 delete process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED
 let calls=0
 const h=await httpFixture({search:async(query)=>{calls++;assert.deepEqual(query,q);return validateQuoteResponse(response(),query)}})
 try{
  const parent=h.f.commercial.list(h.f.at.id,h.f.scenario.id).find(x=>h.f.commercial.item(x.pieceId).code==='para_choque_dianteiro')!
  const components=new ComponentRepository(h.db)
  const created=components.save(h.f.at.id,{pieceId:parent.id,name:'farol dianteiro esquerdo',quantity:'1',manualPrice:null,notes:'',scenarioId:h.f.scenario.id,scenarioRevision:h.f.scenarios.list(h.f.at.id)[0]!.revision})
  const route=h.host+'/api/atendimentos/'+h.f.at.id+'/componentes/'+created.id+'/cotar'
  const post=(body:unknown,headers=h.headers)=>fetch(route,{method:'POST',headers,body:JSON.stringify(body)})
  const body={scenarioId:h.f.scenario.id,componentRevision:created.revision}
  assert.equal((await post(body)).status,503)
  process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED='true'
  assert.equal((await post(body,{...h.headers,Cookie:''})).status,401)
  assert.equal((await post(body,{...h.headers,Origin:'https://evil.invalid'})).status,403)
  assert.equal((await post({...body,name:'other'})).status,400)
  assert.equal((await post({...body,componentRevision:created.revision+1})).status,409)
  assert.equal((await post({...body,scenarioId:'wrong'})).status,404)
  assert.equal((await fetch(h.host+'/api/atendimentos/'+h.f.at.id+'/componentes/missing/cotar',{method:'POST',headers:h.headers,body:JSON.stringify(body)})).status,404)
  const before=h.db.prepare('SELECT total_changes() n').get()!.n
  const reply=await post(body);assert.equal(reply.status,200)
  assert.equal((await reply.json()).offers[0]?.price,'39.90')
  assert.equal(calls,1)
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before,'search must be read-only')
  const again=await post(body);assert.equal(again.status,200);assert.equal((await again.json()).cached,true);assert.equal(calls,1)
  const cap=await fetch(h.host+'/api/cotacoes/capacidade',{headers:h.headers});assert.equal((await cap.json()).diagnosisEnabled,true)
 }finally{
  if(prev===undefined)delete process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED;else process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED=prev
  await h.close()
 }
})

test('saved component quote refuses incomplete details without calling provider and invalidates stale records',async()=>{
 const prev=process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED;process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED='true'
 let calls=0
 const h=await httpFixture({search:async()=>{calls++;return validateQuoteResponse(response(),q)}})
 try{
  const parent=h.f.commercial.list(h.f.at.id,h.f.scenario.id).find(x=>h.f.commercial.item(x.pieceId).code==='para_choque_dianteiro')!
  const components=new ComponentRepository(h.db)
  const create=(name:string)=>components.save(h.f.at.id,{pieceId:parent.id,name,quantity:'1',manualPrice:null,notes:'',scenarioId:h.f.scenario.id,scenarioRevision:h.f.scenarios.list(h.f.at.id)[0]!.revision})
  const unsupported=create('farol com dados privados não previstos')
  const post=(id:string,revision:number)=>fetch(h.host+'/api/atendimentos/'+h.f.at.id+'/componentes/'+id+'/cotar',{method:'POST',headers:h.headers,body:JSON.stringify({scenarioId:h.f.scenario.id,componentRevision:revision})})
  const r=await post(unsupported.id,unsupported.revision);assert.equal(r.status,200);assert.equal((await r.json()).status,'needs_details');assert.equal(calls,0)
  const valid=create('farol dianteiro esquerdo')
  components.save(h.f.at.id,{pieceId:parent.id,name:'farol dianteiro esquerdo led',quantity:'1',manualPrice:null,notes:'',revision:valid.revision,scenarioId:h.f.scenario.id,scenarioRevision:h.f.scenarios.list(h.f.at.id)[0]!.revision},valid.id)
  assert.equal((await post(valid.id,valid.revision)).status,409);assert.equal(calls,0)
 }finally{
  if(prev===undefined)delete process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED;else process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED=prev
  await h.close()
 }
})

test('saved component quote revalidates vehicle and component after delayed provider work',async()=>{
 const prev=process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED;process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED='true'
 let run!:()=>void
 const wait=new Promise<void>(resolve=>{run=resolve})
 const h=await httpFixture({search:async()=>{await wait;return validateQuoteResponse(response(),q)}})
 try{
  const parent=h.f.commercial.list(h.f.at.id,h.f.scenario.id).find(x=>h.f.commercial.item(x.pieceId).code==='para_choque_dianteiro')!
  const components=new ComponentRepository(h.db)
  const saved=components.save(h.f.at.id,{pieceId:parent.id,name:'farol dianteiro esquerdo',quantity:'1',manualPrice:null,notes:'',scenarioId:h.f.scenario.id,scenarioRevision:h.f.scenarios.list(h.f.at.id)[0]!.revision})
  const quote=fetch(h.host+'/api/atendimentos/'+h.f.at.id+'/componentes/'+saved.id+'/cotar',{method:'POST',headers:h.headers,body:JSON.stringify({scenarioId:h.f.scenario.id,componentRevision:saved.revision})})
  await new Promise(resolve=>setTimeout(resolve,15))
  const vehicle=h.f.atendimentos.get(h.f.at.id)
  h.f.atendimentos.update(vehicle.id,{revision:vehicle.revision,vehicle:'Gol 2020'})
  run()
  assert.equal((await quote).status,409)
 }finally{
  run()
  if(prev===undefined)delete process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED;else process.env.FUNIX_DIAGNOSIS_QUOTE_ENABLED=prev
  await h.close()
 }
})
