import{VOICE_MAX_BYTES,VOICE_MAX_DURATION_MS,VOICE_MIMES,voiceCaptureKey}from'../shared/voice-input.ts'
import type{VoiceCaptureContext,VoiceInterpretation}from'../shared/voice-input.ts'
export type CaptureState={phase:'idle'|'preparing'|'recording'|'processing'|'done'|'error';message:string;result?:VoiceInterpretation;recoveryAudio?:Blob}
export interface CaptureDependencies{
 getMedia:()=>Promise<MediaStream>;supported:()=>boolean;supportsMime:(mime:string)=>boolean
 recorder:(stream:MediaStream,mime:string)=>MediaRecorder
 process:(audio:Blob,context:VoiceCaptureContext,duration:number,signal:AbortSignal)=>Promise<VoiceInterpretation>
 now:()=>number;maxDuration?:number;maxBytes?:number
}
export class VoiceCapture{
 private generation=0
 private held=false
 private pendingPermission=false
 private stream:MediaStream|null=null
 private recorder:MediaRecorder|null=null
 private timer:ReturnType<typeof setTimeout>|undefined
 private request:AbortController|null=null
 private context:VoiceCaptureContext|null=null
 private state:CaptureState={phase:'idle',message:'Segure o Copiloto para ditar. Revise o plano antes de salvar.'}
 private dependencies:CaptureDependencies
 private changed:(state:CaptureState)=>void
 constructor(dependencies:CaptureDependencies,changed:(state:CaptureState)=>void){this.dependencies=dependencies;this.changed=changed}
 private publish(state:CaptureState){this.state=state;this.changed(state)}
 get snapshot(){return this.state}
 private releaseTracks(){this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;clearTimeout(this.timer)}
 setContext(context:VoiceCaptureContext|null){
  if(voiceCaptureKey(context)!==voiceCaptureKey(this.context)){this.cancel();this.context=context}
 }
 async hold(){
  if(!this.context){this.publish({phase:'error',message:'Abra um Atendimento e aguarde o cenário carregar para gravar.'});return}
  if(this.pendingPermission||this.recorder||this.request)return
  if(!this.dependencies.supported()){this.publish({phase:'error',message:'Este navegador não oferece captura de áudio. Use um navegador atualizado em HTTPS.'});return}
  const context={...this.context},generation=++this.generation
  this.held=true;this.pendingPermission=true;this.publish({phase:'preparing',message:'Preparando microfone…'})
  try{
   const stream=await this.dependencies.getMedia()
   this.pendingPermission=false
   if(generation!==this.generation||!this.held){stream.getTracks().forEach(t=>t.stop());if(generation===this.generation)this.publish({phase:'idle',message:'Permissão recebida. Pressione e segure novamente para gravar.'});return}
   this.stream=stream
   const mime=VOICE_MIMES.find(m=>this.dependencies.supportsMime(m))
   if(!mime){this.releaseTracks();this.held=false;this.publish({phase:'error',message:'Nenhum formato de áudio compatível está disponível neste navegador.'});return}
   const recorder=this.dependencies.recorder(stream,mime);this.recorder=recorder
   const parts:Blob[]=[],started=this.dependencies.now(),maximum=this.dependencies.maxBytes??VOICE_MAX_BYTES
   let bytes=0,limited=false,failed=false
   const stop=()=>{if(recorder.state!=='inactive')recorder.stop()}
   recorder.onstart=()=>{if(generation===this.generation)this.publish({phase:'recording',message:'Gravando. Solte para processar.'})}
   recorder.ondataavailable=event=>{
    if(generation!==this.generation||!event.data.size)return
    parts.push(event.data);bytes+=event.data.size
    if(bytes>=maximum*.9){limited=true;stop()}
   }
   recorder.onerror=()=>{if(generation!==this.generation)return;failed=true;stop();this.releaseTracks();if(generation===this.generation)this.publish({phase:'error',message:'O microfone foi interrompido. Grave novamente.'})}
   recorder.onstop=()=>{
    if(generation!==this.generation)return
    if(this.recorder===recorder)this.recorder=null
    this.releaseTracks();this.held=false
    if(generation!==this.generation||failed)return
    const blob=new Blob(parts,{type:recorder.mimeType||mime}),duration=Math.min(this.dependencies.maxDuration??VOICE_MAX_DURATION_MS,Math.max(1,this.dependencies.now()-started))
    if(!blob.size){this.publish({phase:'error',message:'A gravação ficou vazia. Pressione e segure novamente.'});return}
    if(blob.size>maximum){this.publish({phase:'error',message:'O áudio excedeu o limite e não foi enviado. Você pode baixar esta tentativa ou gravar novamente.',recoveryAudio:blob});return}
    this.request=new AbortController()
    this.publish({phase:'processing',message:limited?'Limite atingido. Processando o áudio capturado e interpretando…':'Processando áudio e interpretando…'})
    void this.dependencies.process(blob,context,duration,this.request.signal).then(result=>{
     if(generation===this.generation&&voiceCaptureKey(context)===voiceCaptureKey(this.context))this.publish({phase:'done',message:'Plano pronto para revisão. Nenhuma alteração foi salva.',result})
    }).catch(error=>{if(generation===this.generation&&(error as Error).name!=='AbortError')this.publish({phase:'error',message:(error as Error).message||'Não foi possível concluir. Grave novamente.'})}).finally(()=>{if(generation===this.generation)this.request=null})
   }
   recorder.start(1000)
   this.timer=setTimeout(()=>{limited=true;this.held=false;stop()},this.dependencies.maxDuration??VOICE_MAX_DURATION_MS)
  }catch(error){
   this.pendingPermission=false;this.releaseTracks();this.recorder=null
   if(generation!==this.generation)return
   const name=(error as Error).name
   this.held=false;this.publish({phase:'error',message:name==='NotAllowedError'?'Microfone não autorizado. Permita o acesso no navegador e tente novamente.':name==='NotFoundError'?'Nenhum microfone disponível.':'Não foi possível iniciar o microfone. Tente novamente.'})
  }
 }
 release(){
  this.held=false
  if(this.recorder&&this.recorder.state!=='inactive')this.recorder.stop()
  else if(this.pendingPermission)this.publish({phase:'preparing',message:'Conclua a permissão do navegador e pressione novamente. A gravação não começará sozinha.'})
 }
 cancel(){
  ++this.generation;this.held=false;this.request?.abort();this.request=null
  const recorder=this.recorder;this.recorder=null
  if(recorder&&recorder.state!=='inactive')recorder.stop()
  this.releaseTracks();this.publish({phase:'idle',message:'Segure o Copiloto para ditar. Revise o plano antes de salvar.'})
 }
}
