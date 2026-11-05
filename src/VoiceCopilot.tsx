import{useEffect,useLayoutEffect,useRef,useState}from'react'
import{VoiceCapture}from'./voice-capture'
import type{CaptureState}from'./voice-capture'
import{VOICE_PROCESSING_MS,VOICE_UPLOAD_MS,voiceCaptureKey}from'../shared/voice-input'
import type{VoiceCaptureContext,VoiceInterpretation}from'../shared/voice-input'
import{api}from'./api'
import{Icon}from'./ui'
import'./voice-copilot.css'

export function VoiceCopilot({context,open,onToggle,onOpen,visible,disabled,navigationKey,onApplied}:{navigationKey:string;context:VoiceCaptureContext|null;open:boolean;onToggle:()=>void;onOpen:()=>void;visible:boolean;disabled:boolean;onApplied:()=>void}){
 const[state,setState]=useState<CaptureState>({phase:'idle',message:'Segure o Copiloto para ditar. Nenhuma alteração será salva nesta etapa.'})
 const[applying,setApplying]=useState(false)
 const[applyError,setApplyError]=useState('')
 const[appliedKey,setAppliedKey]=useState<string|null>(null)
 const[capture]=useState(()=>new VoiceCapture({
  getMedia:()=>navigator.mediaDevices.getUserMedia({audio:true}),
  supported:()=>typeof navigator.mediaDevices?.getUserMedia==='function'&&typeof window.MediaRecorder==='function',
  supportsMime:m=>typeof MediaRecorder.isTypeSupported==='function'&&MediaRecorder.isTypeSupported(m),
  recorder:(stream,mime)=>new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000}),
  now:()=>performance.now(),
  process:async(audio,context,duration,signal)=>api<VoiceInterpretation>(`/api/atendimentos/${context.atendimentoId}/copiloto/interpretar?scenarioId=${encodeURIComponent(context.scenarioId)}`,{
   method:'POST',headers:{'Content-Type':audio.type,'X-Funix-Audio-Duration-Ms':String(Math.ceil(duration)),
    'X-Funix-Voice-Revisions':JSON.stringify({composition:context.compositionRevision,configuration:context.configurationRevision,scenario:context.scenarioRevision})},
   body:audio,signal:AbortSignal.any([signal,AbortSignal.timeout(VOICE_PROCESSING_MS+VOICE_UPLOAD_MS+5000)])})
 },setState))
 const gesture=useRef<{timer:ReturnType<typeof setTimeout>;long:boolean;pointer?:number;key?:string}|null>(null)
 const clearGesture=()=>{if(gesture.current)clearTimeout(gesture.current.timer);gesture.current=null}
 const key=voiceCaptureKey(context),available=visible&&!disabled
 useLayoutEffect(()=>{clearGesture();capture.cancel();setApplyError('');setAppliedKey(null)},[navigationKey,capture])
 useLayoutEffect(()=>{clearGesture();capture.setContext(available?context:null);setApplyError('')},[key,available,capture,context])
 useEffect(()=>{
  const cancel=()=>{clearGesture();capture.cancel()}
  const hidden=()=>{if(document.visibilityState==='hidden')cancel()}
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',cancel);window.addEventListener('blur',cancel)
  return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',cancel);window.removeEventListener('blur',cancel);cancel()}
 },[capture])
 async function apply(){
  const result=state.result,active=context
  if(applying||!result||!active||!result.plan.idempotencyKey||result.plan.changes.length===0||appliedKey===result.plan.idempotencyKey)return
  if(result.plan.guards.composition!==active.compositionRevision||result.plan.guards.configuration!==active.configurationRevision||
   result.plan.guards.scenarios.find(s=>s.id===active.scenarioId)?.revision!==active.scenarioRevision){
   setApplyError('O contexto foi atualizado. Dite novamente antes de confirmar.');return
  }
  const removes=result.plan.changes.some(c=>c.impact.requiresGlobalRemovalConfirmation)
  if(removes&&!window.confirm('Esta exclusão altera todos os cenários do Atendimento. Deseja realmente excluir os itens indicados?'))return
  setApplying(true);setApplyError('')
  try{
   const applied=await api<{applied:true;changed:number;replay:boolean}>(`/api/atendimentos/${active.atendimentoId}/copiloto/aplicar`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({scenarioId:active.scenarioId,idempotencyKey:result.plan.idempotencyKey,confirmGlobalRemoval:removes})
   })
   if(applied.applied){setAppliedKey(result.plan.idempotencyKey);onApplied()}
  }catch(error){setApplyError((error as Error).message||'A confirmação não foi concluída; confira o Atendimento antes de tentar novamente.')}
  finally{setApplying(false)}
 }
 function start(pointer?:number,key?:string){
  if(gesture.current)return
  const current={timer:setTimeout(()=>{current.long=true;onOpen();void capture.hold()},350),long:false,pointer,key}
  gesture.current=current
 }
 function end(cancel=false){
  const current=gesture.current;if(!current)return
  clearGesture();if(cancel){capture.cancel();return}
  if(current.long)capture.release();else onToggle()
 }
 return <>
 {open&&visible&&!disabled&&<section className="copilot-panel voice-panel" aria-label="Copiloto FUNIX">
  <header><div><strong>Copiloto FUNIX</strong><small>Voz · revisão e confirmação manual</small></div><button aria-label="Recolher Copiloto" onClick={onToggle}>⌄</button></header>
  <div className="copilot-feed">
   {!context&&<p>Abra um Atendimento e aguarde o cenário carregar para usar a voz.</p>}
   {state.result&&<><details><summary>Transcrição desta tentativa</summary><p className="voice-transcript">{state.result.transcription}</p></details>
    <details><summary>Plano: {state.result.plan.changes.length} alterações propostas · {state.result.plan.results.filter(r=>r.status==='pending'||r.status==='conflict').length} pendências</summary><pre>{JSON.stringify(state.result.plan,null,2)}</pre></details>
    {state.result.plan.changes.length>0&&<p>Confira o plano antes de confirmar. Comandos pendentes ou conflitantes não serão gravados. Alterações compartilhadas atingem todos os cenários.</p>}
    {state.result.plan.changes.length>0&&<button className="voice-apply" disabled={applying||!context||appliedKey===state.result.plan.idempotencyKey} onClick={()=>void apply()}>{appliedKey===state.result.plan.idempotencyKey?'Alterações aplicadas':applying?'Aplicando…':'Confirmar e aplicar alterações'}</button>}
    {state.result.plan.changes.length===0&&<p>Não há alterações válidas a aplicar.</p>}
   </>}
   {applyError&&<p role="alert" className="voice-apply-error">{applyError}</p>}
   {appliedKey&&<p role="status">Aplicação confirmada. O Atendimento será atualizado.</p>}
   {state.recoveryAudio&&<RecoveryAudio blob={state.recoveryAudio}/>}
   {['preparing','recording','processing'].includes(state.phase)&&<button className="voice-cancel" onClick={()=>{clearGesture();capture.cancel()}}>Cancelar</button>}
  </div>
  <div className={'copilot-status voice-status '+state.phase} role={state.phase==='error'?'alert':'status'}>{state.message}</div>
 </section>}
 {visible&&<button className={'copilot-fixed voice-launcher '+state.phase} aria-label="Abrir Copiloto FUNIX" aria-description="Toque para abrir. Segure, ou mantenha Espaço ou Enter pressionado, para ditar no Atendimento atual." title="Copiloto" aria-expanded={open} disabled={disabled}
  onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);start(e.pointerId)}}
  onPointerUp={e=>{if(gesture.current?.pointer===e.pointerId)end()}}
  onPointerCancel={()=>end(true)} onLostPointerCapture={()=>{if(gesture.current?.pointer!==undefined)end(true)}}
  onContextMenu={e=>e.preventDefault()} onDragStart={e=>e.preventDefault()}
  onKeyDown={e=>{if(e.key==='Escape'){clearGesture();capture.cancel();return}if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat)start(undefined,e.key)}}}
  onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(gesture.current?.key===e.key)end()}}}
  onClick={e=>{if(e.detail===0&&!gesture.current)onToggle()}}
 ><Icon name={state.phase==='recording'?'mic':'bot'}/></button>}
 </>
}

function RecoveryAudio({blob}:{blob:Blob}){
 const[url]=useState(()=>URL.createObjectURL(blob))
 useEffect(()=>()=>URL.revokeObjectURL(url),[url])
 return <a href={url} download={'funix-ditado-tentativa.'+(blob.type.includes('mp4')?'mp4':blob.type.includes('ogg')?'ogg':'webm')}>Baixar áudio desta tentativa</a>
}
