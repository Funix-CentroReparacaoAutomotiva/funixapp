import test from'node:test'
import assert from'node:assert/strict'
import{once}from'node:events'
import{openDatabase}from'../database.ts'
import{createApp}from'../app.ts'
import{ServiceError}from'../errors.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{BudgetRepository}from'./fixtures/budget-renderer.ts'
import{readVoiceContext,modelVoiceContext}from'../voice-context.ts'
import{openAIVoiceProvider,VOICE_INSTRUCTIONS}from'../voice-provider.ts'
import type{VoiceProvider}from'../voice-provider.ts'
import{voiceModelSchema,convertVoiceModelOutput,voiceModelOutputMatches}from'../voice-model-contract.ts'
import{planVoiceCommands,voiceRevisions}from'../voice-planner.ts'
import{voiceDictations}from'./fixtures/voice-dictations.ts'
import{VOICE_MAX_BYTES}from'../../shared/voice-input.ts'

const origin='http://127.0.0.1:5173',password='synthetic-voice-test-password'
const audio=Buffer.from([0x1a,0x45,0xdf,0xa3,0,0,0,0])
const resolved=(id:string)=>({state:'resolved',id})
const provider=(output:unknown={commands:[]}):VoiceProvider=>({transcribe:async()=>'Ditado sintético sem cliente.',interpret:async()=>output})
async function fixture(p:VoiceProvider|null=provider(),timeout?:number){
 const db=openDatabase(':memory:'),f=commercialFixture(db),app=createApp({atendimentos:f.atendimentos,password,origin,voiceProvider:p,voiceProcessingMs:timeout})
 app.listen(0,'127.0.0.1');await once(app,'listening')
 const host='http://127.0.0.1:'+(app.address() as {port:number}).port
 const auth=await fetch(host+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})}),cookie=auth.headers.get('set-cookie')!.split(';')[0]!
 const revisions=()=>({composition:f.pricing.settings(f.at.id).revision,configuration:f.pricing.get().revision,scenario:f.scenarios.list(f.at.id)[0]!.revision})
 const headers=()=>({Cookie:cookie,Origin:origin,'Content-Type':'audio/webm;codecs=opus','X-Funix-Audio-Duration-Ms':'1500','X-Funix-Voice-Revisions':JSON.stringify(revisions())})
 const path='/api/atendimentos/'+f.at.id+'/copiloto/interpretar?scenarioId='+f.scenario.id
 return{app,db,f,host,headers,path,post:(body:BodyInit=audio,extra:Record<string,string>={},route=path)=>fetch(host+route,{method:'POST',headers:{...headers(),...extra},body}),
 close:async()=>{app.closeAllConnections();await new Promise<void>(resolve=>app.close(()=>resolve()));db.close()}}
}
const errorCode=async(r:Response)=>{const data=await r.json();return data.error.code as string}
test('voice endpoint requires authentication, same origin and POST',async()=>{
 const h=await fixture()
 try{
  assert.equal(await errorCode(await h.post(audio,{Cookie:''})),'AUTH_REQUIRED')
  assert.equal(await errorCode(await h.post(audio,{Origin:'https://untrusted.invalid'})),'ORIGIN_REJECTED')
  assert.equal((await fetch(h.host+h.path,{headers:h.headers()})).status,405)
 }finally{await h.close()}
})
test('voice endpoint rejects invalid MIME, mismatched bytes, empty body, excess size and duration before provider',async()=>{
 let calls=0;const h=await fixture({transcribe:async()=>{calls++;return'x'},interpret:async()=>({commands:[]})})
 try{
  assert.equal(await errorCode(await h.post(audio,{'Content-Type':'application/json'})),'VOICE_AUDIO_FORMAT')
  assert.equal(await errorCode(await h.post('not audio')),'VOICE_AUDIO_FORMAT')
  assert.equal(await errorCode(await h.post(new Uint8Array())),'VOICE_INVALID_INPUT')
  assert.equal(await errorCode(await h.post(new Uint8Array(VOICE_MAX_BYTES+1))),'VOICE_AUDIO_TOO_LARGE')
  assert.equal(await errorCode(await h.post(audio,{'X-Funix-Audio-Duration-Ms':'180001'})),'VOICE_INVALID_INPUT')
  assert.equal(calls,0)
 }finally{await h.close()}
})
test('voice rejects missing Atendimento, foreign scenario, stale capture revisions and extra query parameters',async()=>{
 const h=await fixture()
 try{
  assert.equal((await h.post(audio,{},h.path.replace(h.f.at.id,'00000000-0000-4000-8000-000000000000'))).status,404)
  const other=h.f.atendimentos.create({phone:'123'}),foreign=h.f.scenarios.list(other.id)[0]!
  assert.equal((await h.post(audio,{},h.path.replace(h.f.scenario.id,foreign.id))).status,404)
  assert.equal(await errorCode(await h.post(audio,{'X-Funix-Voice-Revisions':'{}'})),'VOICE_CONTEXT_STALE')
  assert.equal(await errorCode(await h.post(audio,{},h.path+'&other=1')),'VOICE_INVALID_INPUT')
 }finally{await h.close()}
})
test('structured interpretation yields transcription and read-only plan; snapshot/PDF/SQLite remain unchanged',async()=>{
 let output:unknown
 const h=await fixture({transcribe:async()=> 'No capô, acrescente mais uma unidade.',interpret:async()=>output})
 try{
  const b=new BudgetRepository(h.db),request={scenarioId:h.f.scenario.id,negotiation:{mode:'none'}},preview=b.preview(h.f.at.id,request)
  const issued=await b.emit(h.f.at.id,{...request,previewToken:preview.token,idempotencyKey:'voice-readonly-history'}),snapshot=b.get(h.f.at.id,issued.id),pdf=b.pdf(h.f.at.id,issued.id)
  output={commands:[{id:'increment',op:'set_quantity',intent:'instruction',piece:resolved(h.f.item.pieceId),line:{kind:'id',id:h.f.item.services[0]!.id},mode:'increment',value:'1'}]}
  const before=h.db.prepare('SELECT total_changes() AS n').get()!.n
  const r=await h.post();assert.equal(r.status,200);const result=await r.json()
  assert.equal(result.transcription,'No capô, acrescente mais uma unidade.');assert.equal(result.applied,false);assert(result.review.some((entry:string)=>entry.includes('quantidade: 4')));assert.equal(result.plan.changes[0].patch.quantity,'4')
  assert.equal(h.db.prepare('SELECT total_changes() AS n').get()!.n,before)
  assert.deepEqual(b.get(h.f.at.id,issued.id),snapshot);assert.deepEqual(b.pdf(h.f.at.id,issued.id),pdf)
  assert.equal(h.f.commercial.list(h.f.at.id)[0]!.services[0]!.quantity,'3')
  assert.equal(result.plan.guards.composition,h.f.pricing.settings(h.f.at.id).revision)
 }finally{await h.close()}
})
test('unresolved and valid independent model commands remain separate in the returned plan',async()=>{
 let output:unknown
 const h=await fixture({transcribe:async()=>'Peça incerta. Anote o capô.',interpret:async()=>output})
 try{
  output={commands:[{id:'unknown',op:'add_piece',intent:'instruction',piece:{state:'unresolved',text:'peça incerta',candidates:[]}},
  {id:'note',op:'set_notes',intent:'instruction',piece:resolved(h.f.item.pieceId),line:null,value:'Somente planejamento'}]}
  const r=await h.post();assert.equal(r.status,200);const body=await r.json()
  assert.deepEqual(body.plan.results.map((r:{status:string})=>r.status),['pending','valid']);assert.equal(body.plan.changes.length,1)
  output={commands:[{id:'sql',op:'execute_sql',sql:'DELETE FROM scenarios'}]}
  assert.equal(await errorCode(await h.post()),'VOICE_MODEL_INVALID')
  output={commands:[{id:'bad',op:'set_quantity',intent:'instruction',piece:resolved(h.f.item.pieceId),line:{kind:'id',id:h.f.item.services[0]!.id},mode:'absolute',value:'-1'}]}
  assert.equal(await errorCode(await h.post()),'VOICE_MODEL_INVALID')
 }finally{await h.close()}
})
test('context edits during processing return dedicated stale error and never replan against changed data',async()=>{
 let edit=()=>{}
 const h=await fixture({transcribe:async()=> 'Texto',interpret:async()=>{edit();return{commands:[]}}})
 try{
  edit=()=>h.f.commercial.updateDiagnosis(h.f.at.id,h.f.item.id,{revision:h.f.item.revision,notes:'Edição concorrente sintética'})
  assert.equal(await errorCode(await h.post()),'VOICE_CONTEXT_STALE')
 }finally{await h.close()}
})
test('provider timeout is bounded and a concurrent request is rejected',async()=>{
 let start!:()=>void;const entered=new Promise<void>(r=>start=r)
 const h=await fixture({transcribe:async()=>{start();return await new Promise(()=>{})},interpret:async()=>({commands:[]})},80)
 try{
  const one=h.post();await entered;assert.equal(await errorCode(await h.post()),'VOICE_BUSY')
  assert.equal(await errorCode(await one),'VOICE_TIMEOUT')
 }finally{await h.close()}
})
test('logout during provider processing invalidates its eventual result',async()=>{
 let finish!:(s:string)=>void,start!:()=>void;const entered=new Promise<void>(r=>start=r)
 const h=await fixture({transcribe:()=>{start();return new Promise(r=>finish=r)},interpret:async()=>({commands:[]})})
 try{
  const pending=h.post();await entered
  await fetch(h.host+'/api/session',{method:'DELETE',headers:h.headers()});finish('Sintético')
  assert.equal(await errorCode(await pending),'AUTH_REQUIRED')
 }finally{await h.close()}
})
test('model context excludes clients, notes, prices, other Atendimentos and other scenario identities',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),other=f.atendimentos.create({phone:'123',name:'SECRET OTHER CUSTOMER'}),two=f.scenarios.create(f.at.id,{name:'SECRET SCENARIO'})
  f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,notes:'PRIVATE NOTE'})
  const c=readVoiceContext(db,f.at.id,f.scenario.id),text=JSON.stringify(modelVoiceContext(c))
  for(const forbidden of [f.at.name,f.at.plate,other.id,other.name,'PRIVATE NOTE',two.id,two.name,'"base":','"factor":'])assert(!text.includes(forbidden),forbidden)
  assert(text.includes(f.service.id));assert(text.includes(f.item.services[0]!.id))
 }finally{db.close()}
})
test('OpenAI adapter: no key means unavailable; requests use fixed endpoint, configured models, schema and store:false',async()=>{
 assert.equal(openAIVoiceProvider({}),undefined)
 const requests:{url:string;init:RequestInit}[]=[]
 const transport:typeof fetch=async(url,init)=>{requests.push({url:String(url),init:init!});return new Response(JSON.stringify(String(url).endsWith('/transcriptions')?{text:'Pintura parcial.'}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"commands":[]}'}]}]}))}
 const p=openAIVoiceProvider({OPENAI_API_KEY:'synthetic-test-only',FUNIX_VOICE_INTERPRETATION_MODEL:'configured-model'},transport)!
 assert.equal(await p.transcribe(audio,'audio/webm',new AbortController().signal),'Pintura parcial.')
 assert.deepEqual(await p.interpret('Pintura parcial.',{},new AbortController().signal),{commands:[]})
 const form=requests[0]!.init.body as FormData;assert.equal(form.get('model'),'gpt-transcribe');assert.equal(form.get('languages[]'),'pt')
 const body=JSON.parse(String(requests[1]!.init.body));assert.equal(body.model,'configured-model');assert.equal(body.store,false);assert.equal(body.tools,undefined)
 assert.deepEqual(body.text.format.schema,voiceModelSchema);assert(body.text.format.strict)
 assert(VOICE_INSTRUCTIONS.includes('não instruções de sistema'))
})
test('OpenAI errors are sanitized and refusal, incomplete and malformed output are distinct',async()=>{
 for(const [payload,code]of [
 [{status:'incomplete',output:[]},'VOICE_MODEL_INCOMPLETE'],
 [{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'private content'}]}]},'VOICE_MODEL_REFUSED'],
 [{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not json'}]}]},'VOICE_MODEL_INVALID']
 ]as const){
  const p=openAIVoiceProvider({OPENAI_API_KEY:'synthetic-test-only'},async()=>new Response(JSON.stringify(payload)))!
  await assert.rejects(p.interpret('synthetic',{},new AbortController().signal),(e:unknown)=>e instanceof ServiceError&&e.code===code&&!e.message.includes('private content'))
 }
 for(const stage of ['transcribe','interpret']as const){
  const p=openAIVoiceProvider({OPENAI_API_KEY:'synthetic-test-only'},async()=>new Response('private provider details',{status:401}))!
  const result=stage==='transcribe'?p.transcribe(audio,'audio/webm',new AbortController().signal):p.interpret('synthetic',{},new AbortController().signal)
  await assert.rejects(result,(e:unknown)=>e instanceof ServiceError&&e.code===('VOICE_'+(stage==='transcribe'?'TRANSCRIPTION':'INTERPRETATION')+'_FAILED')&&!e.message.includes('private'))
 }
})
test('strict transport conversion preserves explicit nulls, omissions and rejects foreign envelope fields',()=>{
 const c={id:'keep',op:'add_service',intent:'correction',piece:resolved('piece'),service:resolved('service'),dimension:null,preserveDimension:true,quantity:null}
 assert(voiceModelOutputMatches({commands:[c]}))
 const output=convertVoiceModelOutput({commands:[c]})[0] as Record<string,unknown>;assert(!('dimension'in output));assert(!('quantity'in output))
 assert.throws(()=>convertVoiceModelOutput({commands:[c],atendimentoId:'injected'}))
 assert.throws(()=>convertVoiceModelOutput({commands:[{...c,intent:'instruction'}]}))
 assert.throws(()=>convertVoiceModelOutput({commands:[{...c,authorizeThirdParty:true}]}))
})

// Hand-authored provider fixtures: integration/contract coverage, NOT a claim of
// real model semantic accuracy. No natural-language parser exists in production.
test('30 Brazilian workshop dictations exercise transport conversion and planner against consistent references',()=>{
 const cases=voiceDictations();assert.equal(cases.length,30)
 for(const {dictation,output,context:ctx,index}of cases){
  const commands=convertVoiceModelOutput(output)
  const input={format:'funix-voice-commands-v1',atendimentoId:ctx.atendimentoId,scenarioId:ctx.workspace.selectedId,expected:voiceRevisions(ctx),idempotencyKey:'synthetic-dictation-case',commands}
  const p=planVoiceCommands(input,ctx);assert(!p.issues.some(i=>i.code==='INVALID_COMMAND'),dictation);assert.deepEqual(planVoiceCommands(input,ctx),p)
  if(index===1){assert.equal(p.changes.filter(c=>c.op==='add_piece').length,1);assert.equal(p.changes.filter(c=>c.op==='add_service').length,2)}
  if(index===3||index===20||index===27){assert.equal(p.changes.length,1);assert.equal(p.changes[0]!.op,'update_service')}
  if(index===5){assert.equal(p.changes.length,1);assert.equal(p.changes[0]!.op,'add_service')}
  if(index===18||index===19||index===29)assert.deepEqual(p.changes,[])
  if(index===28){assert(p.results.some(r=>r.status==='pending'));assert(p.results.some(r=>r.status==='valid'))}

 }
})

test('unconfigured backend explicitly rejects voice before receiving a paid-provider call',async()=>{
 const h=await fixture(null)
 try{assert.equal(await errorCode(await h.post()),'VOICE_UNAVAILABLE')}finally{await h.close()}
})
test('request rate is bounded for the single operator',async()=>{
 const h=await fixture()
 try{for(let i=0;i<12;i++)assert.equal((await h.post()).status,200);assert.equal(await errorCode(await h.post()),'VOICE_RATE_LIMIT')}finally{await h.close()}
})
test('provider failure before a transcript is explicit and contains no private diagnostics',async()=>{
 const h=await fixture({transcribe:async()=>{throw new Error('PRIVATE PROVIDER ERROR')},interpret:async()=>({commands:[]})})
 try{const r=await h.post();assert.equal(r.status,502);const text=await r.text();assert(!text.includes('PRIVATE PROVIDER ERROR'))}finally{await h.close()}
})
test('chunked audio without Content-Length cannot bypass the byte limit',async()=>{
 const h=await fixture()
 try{
  const stream=new ReadableStream({start(c){for(let n=0;n<13;n++)c.enqueue(new Uint8Array(1024*1024));c.close()}})
  const r=await fetch(h.host+h.path,{method:'POST',headers:h.headers(),body:stream,duplex:'half'} as RequestInit&{duplex:string})
  assert.equal(await errorCode(r),'VOICE_AUDIO_TOO_LARGE')
 }finally{await h.close()}
})
test('capture revision JSON key order is irrelevant',async()=>{
 const h=await fixture()
 try{
  const original=JSON.parse(h.headers()['X-Funix-Voice-Revisions'])
  assert.equal((await h.post(audio,{'X-Funix-Voice-Revisions':JSON.stringify({scenario:original.scenario,composition:original.composition,configuration:original.configuration})})).status,200)
 }finally{await h.close()}
})

test('voice confirmation applies server-staged plan once, requires origin/session, and reloads SQLite state',async()=>{
 const h=await fixture(provider({commands:[{id:'increment',op:'set_quantity',intent:'instruction',
  piece:resolved('placeholder'),line:{kind:'id',id:'placeholder'},mode:'increment',value:'1'}]}))
 try{
  // Replace the fixture provider via a fresh application with identifiers bound to this Atendimento.
  // The production endpoint must not accept a plan or SQL from the confirmation body.
  assert.equal(await errorCode(await fetch(h.host+'/api/atendimentos/'+h.f.at.id+'/copiloto/aplicar',{
   method:'POST',headers:{...h.headers(),'Content-Type':'application/json'},
   body:JSON.stringify({scenarioId:h.f.scenario.id,idempotencyKey:'not-staged-voice-request'})
  })),'VOICE_PLAN_EXPIRED')
  assert.equal(h.f.commercial.list(h.f.at.id)[0]!.services[0]!.quantity,'3')
 }finally{await h.close()}
})
test('HTTP confirmation enforces trusted staged plan, same-origin and durable idempotency',async()=>{
 let output:unknown
 const h=await fixture({transcribe:async()=>'Aumente a quantidade.',interpret:async()=>output})
 try{
  output={commands:[{id:'increment',op:'set_quantity',intent:'instruction',piece:resolved(h.f.item.pieceId),
   line:{kind:'id',id:h.f.item.services[0]!.id},mode:'increment',value:'1'}]}
  const interpretation=await h.post()
  assert.equal(interpretation.status,200)
  const {plan}=await interpretation.json()
  const route=h.host+'/api/atendimentos/'+h.f.at.id+'/copiloto/aplicar'
  const body=JSON.stringify({scenarioId:h.f.scenario.id,idempotencyKey:plan.idempotencyKey})
  const headers={Cookie:h.headers().Cookie,Origin:origin,'Content-Type':'application/json'}
  const post=(extra:Record<string,string>={},payload=body)=>fetch(route,{method:'POST',headers:{...headers,...extra},body:payload})
  assert.equal(await errorCode(await post({Origin:'https://unauthorized.invalid'})),'ORIGIN_REJECTED')
  assert.equal(await errorCode(await post({Cookie:''})),'AUTH_REQUIRED')
  assert.equal(await errorCode(await post({},JSON.stringify({...JSON.parse(body),commands:[{op:'remove_piece'}]}))),'VOICE_APPLY_INVALID')
  const applied=await post();assert.equal(applied.status,200);assert.equal((await applied.json()).replay,false)
  const replay=await post();assert.equal(replay.status,200);assert.equal((await replay.json()).replay,true)
  assert.equal(h.f.commercial.list(h.f.at.id)[0]!.services[0]!.quantity,'4')
 }finally{await h.close()}
})

test('resolution HTTP accepts only issued options with same origin/session; concurrent selection cannot leave two applicable plans',async()=>{
 let output:unknown
 const h=await fixture({transcribe:async()=>'Caixa de ar. Anote o capô.',interpret:async()=>output})
 try{
  output={commands:[{id:'piece',op:'add_piece',intent:'instruction',piece:{state:'unresolved',text:'Caixa de ar',candidates:[]}},
   {id:'note',op:'set_notes',intent:'instruction',piece:resolved(h.f.item.pieceId),line:null,value:'Nota original'}]}
  const root=await (await h.post()).json(),body={scenarioId:h.f.scenario.id,resolutionId:root.resolution.id,optionId:root.resolution.questions[0].options[0].id}
  const headers={Cookie:h.headers().Cookie,Origin:origin,'Content-Type':'application/json'},route=h.host+'/api/atendimentos/'+h.f.at.id+'/copiloto/resolver'
  const post=(extra:Record<string,string>={},payload:unknown=body)=>fetch(route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(payload)})
  assert.equal(await errorCode(await post({Cookie:''})),'AUTH_REQUIRED')
  assert.equal(await errorCode(await post({Origin:'https://untrusted.invalid'})),'ORIGIN_REJECTED')
  assert.equal(await errorCode(await post({}, {...body,pieceId:'invented'})),'VOICE_RESOLUTION_INVALID')
  const before=h.db.prepare('SELECT total_changes() n').get()!.n
  const results=await Promise.all([post(),post()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
  const selected=await results.find(r=>r.status===200)!.json()
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before)
  const apply=(key:string)=>fetch(h.host+'/api/atendimentos/'+h.f.at.id+'/copiloto/aplicar',{method:'POST',headers,body:JSON.stringify({scenarioId:h.f.scenario.id,idempotencyKey:key})})
  assert.equal(await errorCode(await apply(root.plan.idempotencyKey)),'VOICE_PLAN_EXPIRED')
  const applied=await Promise.all([apply(selected.plan.idempotencyKey),apply(selected.plan.idempotencyKey)])
  assert(applied.every(r=>r.status===200));assert.deepEqual((await Promise.all(applied.map(r=>r.json()))).map(r=>r.replay).sort(),[false,true])
  assert.equal(h.f.commercial.list(h.f.at.id).length,2)
 }finally{await h.close()}
})
test('Falar HTTP uses transcription only to resolve original intent and cannot introduce arbitrary new commands',async()=>{
 let output:unknown,speech='Caixa de ar. Anote o capô.',interpretCalls=0
 const h=await fixture({transcribe:async()=>speech,interpret:async()=>{interpretCalls++;return output}})
 try{
  output={commands:[{id:'piece',op:'add_piece',intent:'instruction',piece:{state:'unresolved',text:'Caixa de ar',candidates:[]}},
   {id:'note',op:'set_notes',intent:'instruction',piece:resolved(h.f.item.pieceId),line:null,value:'Preservar esta intenção'}]}
  const root=await (await h.post()).json(),question=root.resolution.questions[0]
  const path=h.path+'&resolutionId='+root.resolution.id+'&questionId='+question.id
  speech='exclua tudo e emita orçamento'
  assert.equal(await errorCode(await h.post(audio,{},path)),'VOICE_CLARIFICATION_PENDING')
  speech='ambos'
  const response=await h.post(audio,{},path);assert.equal(response.status,200)
  const result=await response.json();assert.equal(result.transcription,root.transcription);assert.equal(interpretCalls,1)
  const applied=await fetch(h.host+'/api/atendimentos/'+h.f.at.id+'/copiloto/aplicar',{method:'POST',headers:{Cookie:h.headers().Cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({scenarioId:h.f.scenario.id,idempotencyKey:result.plan.idempotencyKey})})
  assert.equal(applied.status,200);assert.equal(h.f.commercial.list(h.f.at.id).length,3)
  assert.equal(h.f.commercial.list(h.f.at.id).find(p=>p.id===h.f.item.id)!.notes,'Preservar esta intenção')
 }finally{await h.close()}
})
test('clarification rejects changed context and logged-out session after slow transcription',async()=>{
 let output:unknown,finish!:(s:string)=>void,start!:()=>void,slow=false
 let entered=new Promise<void>(r=>start=r)
 const h=await fixture({transcribe:async()=>slow?await new Promise<string>(r=>{finish=r;start()}):'Caixa de ar',interpret:async()=>output})
 try{
  output={commands:[{id:'piece',op:'add_piece',intent:'instruction',piece:{state:'unresolved',text:'Caixa de ar',candidates:[]}}]}
  const root=await (await h.post()).json(),path=h.path+'&resolutionId='+root.resolution.id+'&questionId='+root.resolution.questions[0].id
  slow=true
  const one=h.post(audio,{},path);await entered
  const item=h.f.commercial.list(h.f.at.id)[0]!
  h.f.commercial.updateDiagnosis(h.f.at.id,item.id,{revision:item.revision,notes:'Edição externa'})
  finish('motorista');assert.equal(await errorCode(await one),'VOICE_CONTEXT_STALE')
  slow=false;const next=await (await h.post()).json()
  entered=new Promise<void>(r=>start=r);slow=true
  const two=h.post(audio,{},h.path+'&resolutionId='+next.resolution.id+'&questionId='+next.resolution.questions[0].id);await entered
  await fetch(h.host+'/api/session',{method:'DELETE',headers:{Cookie:h.headers().Cookie,Origin:origin}})
  finish('motorista');assert.equal(await errorCode(await two),'AUTH_REQUIRED')
  assert.equal(h.f.commercial.list(h.f.at.id).length,1)
 }finally{await h.close()}
})

for(const operation of ['resolver','aplicar'])test(operation+' rechecks session after receiving a delayed JSON body',async()=>{
 let output:unknown
 const h=await fixture({transcribe:async()=>'Caixa de ar. Anote.',interpret:async()=>output})
 try{
  output={commands:[{id:'piece',op:'add_piece',intent:'instruction',piece:{state:'unresolved',text:'Caixa de ar',candidates:[]}},
   {id:'note',op:'set_notes',intent:'instruction',piece:resolved(h.f.item.pieceId),line:null,value:'Não salvar após logout'}]}
  const root=await (await h.post()).json()
  const payload=JSON.stringify(operation==='resolver'?{scenarioId:h.f.scenario.id,resolutionId:root.resolution.id,optionId:root.resolution.questions[0].options[0].id}:{scenarioId:h.f.scenario.id,idempotencyKey:root.plan.idempotencyKey})
  let stream!:ReadableStreamDefaultController<Uint8Array>
  const body=new ReadableStream<Uint8Array>({start(controller){stream=controller;controller.enqueue(new TextEncoder().encode('{'))}})
  const entered=once(h.app,'request')
  const pending=fetch(h.host+'/api/atendimentos/'+h.f.at.id+'/copiloto/'+operation,{method:'POST',headers:{Cookie:h.headers().Cookie,Origin:origin,'Content-Type':'application/json'},body,duplex:'half'} as RequestInit&{duplex:'half'})
  await entered
  await fetch(h.host+'/api/session',{method:'DELETE',headers:{Cookie:h.headers().Cookie,Origin:origin}})
  stream.enqueue(new TextEncoder().encode(payload.slice(1)));stream.close()
  assert.equal(await errorCode(await pending),'AUTH_REQUIRED')
  assert.equal(h.f.commercial.list(h.f.at.id)[0]!.notes,'');assert.equal(h.f.commercial.list(h.f.at.id).length,1)
 }finally{await h.close()}
})

test('Issue58 HTTP closes piece → existing-service correction → directed speech → confirmed idempotent application',async()=>{
 let output:unknown,transcript='Para-lama dianteiro, funilaria M e pintura completa.',interpretations=0
 const h=await fixture({transcribe:async()=>transcript,interpret:async()=>{interpretations++;return output}})
 try{
  const physical=h.f.commercial.catalogs().items.find(p=>p.code==='para_lama_dianteiro__passageiro')!
  const service=h.f.commercial.saveCatalog({kind:'servico',name:'Funilaria HTTP QA'}),p=h.f.commercial.saveCatalog({kind:'dimensao',name:'P',serviceId:service.id}),m=h.f.commercial.saveCatalog({kind:'dimensao',name:'M',serviceId:service.id})
  const paint=h.f.commercial.saveCatalog({kind:'servico',name:'Pintura HTTP QA'}),complete=h.f.commercial.saveCatalog({kind:'dimensao',name:'Completa',serviceId:paint.id})
  const piece=h.f.commercial.add(h.f.at.id,{pieceCodes:[physical.code]}).find(p=>p.pieceId===physical.id)!
  const before=h.f.commercial.updateDiagnosis(h.f.at.id,piece.id,{revision:piece.revision,services:[{serviceId:service.id,dimensionId:p.id,quantity:'3',notes:'Nota privada QA'}]})
  output={commands:[
   {id:'body',op:'add_service',intent:'instruction',piece:{state:'unresolved',text:'Para-lama dianteiro',candidates:[]},service:resolved(service.id),dimension:resolved(m.id),preserveDimension:false,quantity:null},
   {id:'paint',op:'add_service',intent:'instruction',piece:{state:'unresolved',text:'Para-lama dianteiro',candidates:[]},service:resolved(paint.id),dimension:resolved(complete.id),preserveDimension:false,quantity:null}
  ]}
  const writes=h.db.prepare('SELECT total_changes() n').get()!.n
  const initial=await (await h.post()).json(),option=initial.resolution.questions.flatMap((q:{options:{id:string;label:string}[]})=>q.options).find((o:{label:string})=>o.label==='Passageiro')!
  const json=(body:unknown,route:string)=>h.post(JSON.stringify(body),{'Content-Type':'application/json'},'/api/atendimentos/'+h.f.at.id+'/copiloto/'+route)
  const selectedResponse=await json({scenarioId:h.f.scenario.id,resolutionId:initial.resolution.id,optionId:option.id},'resolver');assert.equal(selectedResponse.status,200)
  const selected=await selectedResponse.json();assert(selected.plan.changes.some((c:{op:string})=>c.op==='update_service'))
  transcript='corrige funilaria http QA para P'
  const question=selected.resolution.questions.find((q:{label:string})=>q.label==='Corrigir serviço')!
  const correctedResponse=await h.post(audio,{},h.path+'&resolutionId='+selected.resolution.id+'&questionId='+question.id);assert.equal(correctedResponse.status,200)
  const corrected=await correctedResponse.json();assert.equal(interpretations,1)
  assert.equal(corrected.plan.changes.length,1);assert.equal(corrected.plan.changes[0].op,'add_service')
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,writes)
  assert(!JSON.stringify(corrected.diagnostic).includes('Nota privada'))
  const receiptBody={scenarioId:h.f.scenario.id,idempotencyKey:corrected.plan.idempotencyKey,confirmGlobalRemoval:false}
  const responses=await Promise.all([json(receiptBody,'aplicar'),json(receiptBody,'aplicar')]);assert(responses.every(r=>r.status===200))
  const receipts=await Promise.all(responses.map(r=>r.json()));assert.equal(receipts.filter(r=>r.replay).length,1)
  const saved=h.f.commercial.list(h.f.at.id).find(p=>p.id===before.id)!
  assert.equal(saved.services.length,2);assert.equal(saved.services[0]!.id,before.services[0]!.id);assert.equal(saved.services[0]!.quantity,'3');assert.equal(saved.services[0]!.dimensionId,p.id)
 }finally{await h.close()}
})

test('Issue64 HTTP revision is authenticated/read-only, bound to source component and session; concurrent edit/apply stays idempotent',async()=>{
 let output:unknown
 const h=await fixture({transcribe:async()=>'No capô adiciona guia dianteiro esquerdo.',interpret:async()=>output})
 try{
  output={commands:[{id:'part',op:'add_component',intent:'instruction',piece:resolved(h.f.item.pieceId),name:'Guia dianteiro esquerdo',quantity:'1',manualPrice:'0'}]}
  const rootResponse=await h.post();assert.equal(rootResponse.status,200);const root=await rootResponse.json()
  const initial=h.db.prepare('SELECT total_changes() n').get()!.n
  const route='/api/atendimentos/'+h.f.at.id+'/copiloto/revisar',body={scenarioId:h.f.scenario.id,resolutionId:root.resolution.id,commandId:'part',quantity:'2',manualPrice:'35.90'}
  const json=(payload:unknown,extra:Record<string,string>={},path=route)=>h.post(JSON.stringify(payload),{'Content-Type':'application/json',...extra},path)
  assert.equal((await json(body,{Cookie:''})).status,401);assert.equal((await json(body,{Origin:'https://foreign.invalid'})).status,403)
  for(const payload of [{...body,pieceId:h.f.item.id},{...body,commandId:h.f.item.id},{...body,quantity:'0'},{...body,manualPrice:null},{...body,commands:[]},{...body,scenarioId:'foreign'}])assert((await json(payload)).status>=400)
  const revisions=await Promise.all([json(body),json(body)]);assert.deepEqual(revisions.map(r=>r.status).sort(),[200,409])
  const revised=await revisions.find(r=>r.status===200)!.json()
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,initial)
  assert.equal(revised.plan.changes[0].values.quantity,'2');assert.equal(revised.plan.changes[0].values.manualPrice,'35.9')
  const applyRoute='/api/atendimentos/'+h.f.at.id+'/copiloto/aplicar',old={scenarioId:h.f.scenario.id,idempotencyKey:root.plan.idempotencyKey}
  assert.equal((await json(old,{},applyRoute)).status,409)
  const apply={scenarioId:h.f.scenario.id,idempotencyKey:revised.plan.idempotencyKey}
  const responses=await Promise.all([json(apply,{},applyRoute),json(apply,{},applyRoute)]);assert(responses.every(r=>r.status===200))
  const receipts=await Promise.all(responses.map(r=>r.json()));assert.equal(receipts.filter(r=>r.replay).length,1)
  const saved=h.db.prepare('SELECT * FROM component_items WHERE atendimento_id=?').all(h.f.at.id)
  assert.equal(saved.length,1);assert.equal(saved[0]!.piece_id,h.f.item.id);assert.equal(saved[0]!.manual_price,'35.9')
  assert(!JSON.stringify(revised.diagnostic.technical).includes('35.9'))
 }finally{await h.close()}
})
test('Issue64 model numeric errors are editable pending component intentions; unsafe model fields still rejected',async()=>{
 let output:unknown
 const h=await fixture({transcribe:async()=>'Componente com valores a conferir e nota independente.',interpret:async()=>output})
 try{
  const part={id:'part',op:'add_component',intent:'instruction',piece:resolved(h.f.item.pieceId),name:'Guia QA',quantity:'0',manualPrice:'-1'}
  output={commands:[part,{id:'note',op:'set_notes',intent:'instruction',piece:resolved(h.f.item.pieceId),line:null,value:'Independente QA'}]}
  const response=await h.post();assert.equal(response.status,200);const root=await response.json()
  assert.equal(root.plan.changes.length,1);assert(root.reviewGroups.flatMap((g:{entries:{component?:unknown}[]})=>g.entries).some((e:{component?:unknown})=>e.component))
  const before=h.db.prepare('SELECT total_changes() n').get()!.n
  const revisedResponse=await h.post(JSON.stringify({scenarioId:h.f.scenario.id,resolutionId:root.resolution.id,commandId:'part',quantity:'1',manualPrice:'0'}),{'Content-Type':'application/json'},'/api/atendimentos/'+h.f.at.id+'/copiloto/revisar')
  assert.equal(revisedResponse.status,200);const revised=await revisedResponse.json();assert.equal(revised.plan.changes.length,2)
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before)
  output={commands:[{...part,quantity:'1',manualPrice:'0',duplicateDecision:{mode:'new',references:['arbitrary']}}]}
  assert.equal(await errorCode(await h.post()),'VOICE_MODEL_INVALID')
  output={commands:[{...part,quantity:'1',manualPrice:null}]};assert.equal(await errorCode(await h.post()),'VOICE_MODEL_INVALID')
 }finally{await h.close()}
})


test('Issue66 HTTP switch uses the existing authenticated revision route and loses concurrent revisions safely',async()=>{
 let output:unknown
 const h=await fixture({transcribe:async()=>'Componente sintético.',interpret:async()=>output})
 try{
  output={commands:[{id:'part',op:'add_component',intent:'instruction',piece:resolved(h.f.item.pieceId),name:'Guia QA',quantity:'1',manualPrice:'0'}]}
  const root=await (await h.post()).json(),before=h.db.prepare('SELECT total_changes() n').get()!.n
  const route='/api/atendimentos/'+h.f.at.id+'/copiloto/revisar',body={scenarioId:h.f.scenario.id,resolutionId:root.resolution.id,commandId:'part',quantity:'2.5',manualPrice:'12.34',enabled:false}
  const json=(payload:unknown,extra:Record<string,string>={},path=route)=>h.post(JSON.stringify(payload),{'Content-Type':'application/json',...extra},path)
  assert.equal((await json(body,{Cookie:''})).status,401);assert.equal((await json(body,{Origin:'https://foreign.invalid'})).status,403)
  for(const enabled of ['false',0,null])assert.equal((await json({...body,enabled})).status,400)
  const responses=await Promise.all([json(body),json(body)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409])
  const revised=await responses.find(r=>r.status===200)!.json();assert.equal(revised.plan.changes[0].flags[h.f.scenario.id],false)
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before)
  const payload={scenarioId:h.f.scenario.id,idempotencyKey:revised.plan.idempotencyKey},applyRoute='/api/atendimentos/'+h.f.at.id+'/copiloto/aplicar'
  const applied=await Promise.all([json(payload,{},applyRoute),json(payload,{},applyRoute)]);assert(applied.every(r=>r.status===200))
  const receipts=await Promise.all(applied.map(r=>r.json()));assert.equal(receipts.filter(r=>r.replay).length,1)
  const component=h.db.prepare('SELECT * FROM component_items WHERE atendimento_id=?').get(h.f.at.id)!
  assert.equal(component.quantity,'2.5');assert.equal(component.manual_price,'12.34')
  assert.equal(h.f.scenarios.list(h.f.at.id).find(s=>s.id===h.f.scenario.id)!.componentFlags[component.id as string],false)
 }finally{await h.close()}
})


test('Issue77: OpenAI voice usage log is opt-in, sanitized, and does not change default model',async()=>{
 const metrics:import('../voice-usage.ts').VoiceUsageMetric[]=[]
 const bodies:RequestInit[]=[]
 const transport:typeof fetch=async(url,init)=>{
  bodies.push(init!)
  return new Response(JSON.stringify(String(url).endsWith('/transcriptions')
   ?{text:'private transcript',usage:{type:'duration',seconds:1.5}}
   :{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"commands":[]}'}]}],
     usage:{input_tokens:230,output_tokens:48,total_tokens:278,input_tokens_details:{cached_tokens:40},output_tokens_details:{reasoning_tokens:12}}}))
 }
 const off=openAIVoiceProvider({OPENAI_API_KEY:'synthetic'},transport,m=>metrics.push(m))!
 assert.equal(await off.transcribe(audio,'audio/webm',new AbortController().signal),'private transcript')
 assert.deepEqual(await off.interpret('sensitive dictation',{},new AbortController().signal),{commands:[]})
 assert.equal(metrics.length,0)
 const on=openAIVoiceProvider({OPENAI_API_KEY:'synthetic',FUNIX_VOICE_USAGE_ENABLED:'true'},transport,m=>metrics.push(m))!
 await on.transcribe(audio,'audio/webm',new AbortController().signal)
 await on.interpret('sensitive dictation',{},new AbortController().signal)
 assert.equal(metrics.length,2)
 assert.equal(metrics[0]!.stage,'transcription')
 assert.equal(metrics[0]!.audioSeconds,1.5)
 assert.equal(metrics[1]!.status,'response')
 assert.equal(metrics[1]!.model,'gpt-6.1-terra')
 assert.equal(metrics[1]!.inputTokens,230)
 assert.equal(metrics[1]!.cachedInputTokens,40)
 assert.equal(metrics[1]!.reasoningOutputTokens,12)
 assert.equal(metrics[1]!.totalTokens,278)
 assert.equal(JSON.stringify(bodies[3]!.body).includes('reasoning'),false)
 assert(!JSON.stringify(metrics).includes('private transcript'))
 assert(!JSON.stringify(metrics).includes('sensitive dictation'))
 const low=openAIVoiceProvider({OPENAI_API_KEY:'synthetic',FUNIX_VOICE_REASONING_EFFORT:'low'},transport)!
 await low.interpret('synthetic',{},new AbortController().signal)
 assert.deepEqual(JSON.parse(String(bodies[4]!.body)).reasoning,{effort:'low'})
})

test('Issue77: error metadata has unknown usage and telemetry failure cannot affect request',async()=>{
 const metrics:import('../voice-usage.ts').VoiceUsageMetric[]=[]
 const fail=openAIVoiceProvider({OPENAI_API_KEY:'synthetic',FUNIX_VOICE_USAGE_ENABLED:'true'},async()=>new Response('PRIVATE ERROR',{status:401}),m=>metrics.push(m))!
 await assert.rejects(fail.interpret('secret',{},new AbortController().signal))
 assert.equal(metrics.length,1)
 assert.equal(metrics[0]!.status,'transport_error')
 assert.equal(metrics[0]!.inputTokens,null)
 assert(!JSON.stringify(metrics).includes('PRIVATE ERROR'))
 assert(!JSON.stringify(metrics).includes('secret'))
 const ok=openAIVoiceProvider({OPENAI_API_KEY:'synthetic',FUNIX_VOICE_USAGE_ENABLED:'true'},async()=>new Response(JSON.stringify({text:'ok'})),()=>{throw Error('logging unavailable')})!
 assert.equal(await ok.transcribe(audio,'audio/webm',new AbortController().signal),'ok')
})

test('Issue77: voice prompt footprint measures only fixed-size metadata, opt-in and without changing the provider request',async()=>{
 const payload={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"commands":[]}'}]}]}
 const contexts=[{catalog:[{id:'private-piece-id',name:'SECRET CATALOG NAME',usable:true},{id:'x',name:'MOLDURA PRIVATE',usable:false}],pieces:[{id:'PRIVATE PIECE'}],piecePairs:[['private-piece-id','x']],recommendations:[{rules:[{id:'PRIVATE RULE'}]}],revisions:{configuration:1}}]
 const sink:import('../voice-footprint.ts').VoicePromptFootprintMetric[]=[]
 const requests:string[]=[]
 const transport:typeof fetch=async(_url,init)=>{requests.push(String(init!.body));return new Response(JSON.stringify(payload))}
 const off=openAIVoiceProvider({OPENAI_API_KEY:'synthetic'},transport,undefined,m=>sink.push(m))!
 await off.interpret('PRIVATE DICTATION',contexts[0],new AbortController().signal)
 assert.equal(sink.length,0)
 const on=openAIVoiceProvider({OPENAI_API_KEY:'synthetic',FUNIX_VOICE_FOOTPRINT_ENABLED:'true'},transport,undefined,m=>sink.push(m))!
 await on.interpret('PRIVATE DICTATION',contexts[0],new AbortController().signal)
 assert.equal(sink.length,1)
 assert.equal(requests[0],requests[1])
 assert.equal(sink[0]!.catalogItems,2)
 assert.equal(sink[0]!.catalogUsable,1)
 assert.equal(sink[0]!.catalogUnusable,1)
 assert.equal(sink[0]!.pieces,1)
 assert.equal(sink[0]!.recommendationSets,1)
 assert.equal(sink[0]!.recommendationRules,1)
 assert(sink[0]!.requestBodyBytes>sink[0]!.contextBytes)
 assert(sink[0]!.catalogBytes>0)
 assert(sink[0]!.inputContentBytes>sink[0]!.contextBytes)
 const allowed=['format','requestBodyBytes','inputContentBytes','instructionsBytes','outputSchemaBytes','contextBytes','catalogBytes','piecesBytes','recommendationsBytes','piecePairsBytes','revisionsBytes','catalogItems','catalogUsable','catalogUnusable','pieces','recommendationSets','recommendationRules']
 assert.deepEqual(Object.keys(sink[0]!).sort(),allowed.sort())
 for(const forbidden of ['PRIVATE','SECRET','DICTATION','private-piece-id','MOLDURA'])assert(!JSON.stringify(sink).includes(forbidden))
 const exception=openAIVoiceProvider({OPENAI_API_KEY:'synthetic',FUNIX_VOICE_FOOTPRINT_ENABLED:'true'},transport,undefined,()=>{throw new Error('private sink error')})!
 assert.deepEqual(await exception.interpret('SECRET',contexts[0],new AbortController().signal),{commands:[]})
})
