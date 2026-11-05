import test from'node:test'
import assert from'node:assert/strict'
import{VoiceCapture}from'../../src/voice-capture.ts'
import type{CaptureDependencies,CaptureState}from'../../src/voice-capture.ts'
import type{VoiceCaptureContext,VoiceInterpretation}from'../../shared/voice-input.ts'
import{planVoiceCommands}from'../voice-planner.ts'
import{voiceFixture}from'./fixtures/voice-planner.ts'
const context:VoiceCaptureContext={atendimentoId:'synthetic-at',scenarioId:'synthetic-scenario',compositionRevision:1,configurationRevision:1,scenarioRevision:1}
const result:VoiceInterpretation={requestId:'synthetic-request',transcription:'Texto sintético',review:[],applied:false,plan:planVoiceCommands({},voiceFixture())}
const tick=()=>new Promise(r=>setTimeout(r,0))
function setup(overrides:Partial<CaptureDependencies>={}){
 let stopped=0,calls=0,created=0,recorder:FakeRecorder,submitted:Blob|null=null,signal:AbortSignal|undefined
 const states:CaptureState[]=[]
 const stream={getTracks:()=>[{stop:()=>stopped++}]} as unknown as MediaStream
 class FakeRecorder{
  state='inactive';mimeType='audio/webm;codecs=opus'
  onstart:(()=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;ondataavailable:((e:{data:Blob})=>void)|null=null
  start(){this.state='recording';this.onstart?.()}
  stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.())}
  data(size=8){this.ondataavailable?.({data:new Blob([new Uint8Array(size)])})}
 }
 const capture=new VoiceCapture({getMedia:async()=>stream,supported:()=>true,supportsMime:()=>true,
  recorder:()=>{created++;recorder=new FakeRecorder();return recorder as unknown as MediaRecorder},now:()=>1000,
  process:async(audio,_ctx,_duration,s)=>{calls++;submitted=audio;signal=s;return result},...overrides},s=>states.push(s))
 capture.setContext(context)
 return{capture,states,stream,get recorder(){return recorder},get stopped(){return stopped},get created(){return created},get calls(){return calls},get submitted(){return submitted},get signal(){return signal}}
}
test('capture starts only after microphone acquisition; release processes complete audio and frees tracks',async()=>{
 const h=setup();await h.capture.hold();assert.equal(h.capture.snapshot.phase,'recording')
 h.recorder.data();h.capture.release();await tick()
 assert.equal(h.stopped,1);assert.equal(h.calls,1);assert.equal(h.submitted!.size,8);assert.equal(h.capture.snapshot.phase,'done')
 h.capture.cancel()
})
test('release before delayed microphone permission never starts hidden recording',async()=>{
 let grant!:(s:MediaStream)=>void
 const h=setup({getMedia:()=>new Promise(r=>grant=r)}),pending=h.capture.hold()
 assert.equal(h.capture.snapshot.phase,'preparing');h.capture.release();grant(h.stream);await pending
 assert.equal(h.created,0);assert.equal(h.calls,0);assert.equal(h.stopped,1);assert.match(h.capture.snapshot.message,/novamente/)
})
test('microphone denial, missing device, unsupported APIs and unsupported MIME are distinct and free resources',async()=>{
 for(const name of ['NotAllowedError','NotFoundError']){
  const h=setup({getMedia:async()=>{throw Object.assign(new Error('synthetic'),{name})}})
  await h.capture.hold();assert.equal(h.capture.snapshot.phase,'error');assert.equal(h.created,0)
 }
 const unsupported=setup({supported:()=>false});await unsupported.capture.hold();assert.equal(unsupported.capture.snapshot.phase,'error')
 const mime=setup({supportsMime:()=>false});await mime.capture.hold();assert.equal(mime.stopped,1);assert.equal(mime.created,0)
})
for(const reason of ['pointercancel','visibility','navigation','scenario','logout','unmount']){
 test('capture cancellation '+reason+' stops tracks and never submits',async()=>{
  const h=setup();await h.capture.hold();h.recorder.data()
  if(reason==='scenario')h.capture.setContext({...context,scenarioId:'other'})
  else if(reason==='navigation'||reason==='logout')h.capture.setContext(null)
  else h.capture.cancel()
  await tick();assert.equal(h.stopped,1);assert.equal(h.calls,0);assert.equal(h.capture.snapshot.phase,'idle')
 })
}
test('empty recording and recorder errors never call the provider',async()=>{
 const empty=setup();await empty.capture.hold();empty.capture.release();await tick();assert.equal(empty.calls,0);assert.equal(empty.capture.snapshot.phase,'error')
 const fail=setup();await fail.capture.hold();fail.recorder.data();fail.recorder.onerror?.();await tick();assert.equal(fail.calls,0);assert.equal(fail.capture.snapshot.phase,'error');assert.equal(fail.stopped,1)
})
test('duration limit stops and processes already captured audio',async()=>{
 const h=setup({maxDuration:15});await h.capture.hold();h.recorder.data();await new Promise(r=>setTimeout(r,25))
 assert.equal(h.calls,1);assert.equal(h.stopped,1);assert(h.states.some(s=>/Limite atingido/.test(s.message)))
})
test('size threshold stops predictably; oversize audio is retained only in memory for optional recovery',async()=>{
 const h=setup({maxBytes:100});await h.capture.hold();h.recorder.data(90);await tick();assert.equal(h.calls,1)
 const big=setup({maxBytes:100});await big.capture.hold();big.recorder.data(101);await tick()
 assert.equal(big.calls,0);assert.equal(big.capture.snapshot.phase,'error');assert.equal(big.capture.snapshot.recoveryAudio?.size,101);big.capture.cancel();assert.equal(big.capture.snapshot.recoveryAudio,undefined)
})
test('context change aborts processing and stale response never reaches current panel',async()=>{
 let finish!:(r:VoiceInterpretation)=>void;let signal:AbortSignal|undefined
 const h=setup({process:(_a,_c,_d,s)=>{signal=s;return new Promise(r=>finish=r)}})
 await h.capture.hold();h.recorder.data();h.capture.release();await tick();assert.equal(h.capture.snapshot.phase,'processing')
 h.capture.setContext({...context,scenarioRevision:2});assert(signal!.aborted);finish(result);await tick()
 assert.equal(h.capture.snapshot.result,undefined);assert.equal(h.capture.snapshot.phase,'idle')
})
test('a late stop event from a canceled recording cannot stop a new microphone stream',async()=>{
 const h=setup();await h.capture.hold();const first=h.recorder
 h.capture.cancel();await h.capture.hold();assert.equal(h.stopped,1)
 first.onstop?.();assert.equal(h.stopped,1);assert.equal(h.capture.snapshot.phase,'recording');h.capture.cancel()
})
test('outside an Atendimento capture is unavailable and repeat hold does not allocate a second recorder',async()=>{
 const h=setup();h.capture.setContext(null);await h.capture.hold();assert.equal(h.created,0)
 h.capture.setContext(context);await h.capture.hold();await h.capture.hold();assert.equal(h.created,1);h.capture.cancel()
})
test('format negotiation falls back to the actually supported MP4 or Ogg MIME',async()=>{
 for(const expected of ['audio/mp4','audio/ogg;codecs=opus']){
  const h=setup({supportsMime:m=>m===expected});let chosen=''
  const recording=new VoiceCapture({
   supported:()=>true,getMedia:async()=>h.stream,supportsMime:m=>m===expected,
   recorder:(_s,m)=>{chosen=m;throw Error('synthetic constructor stop')},process:async()=>result,now:()=>100
  },()=>{})
  recording.setContext(context);await recording.hold();assert.equal(chosen,expected);assert.equal(h.stopped,1)
 }
})
