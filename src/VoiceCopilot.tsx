import{useEffect,useLayoutEffect,useRef,useState}from'react'
import{VoiceCapture}from'./voice-capture'
import type{CaptureState}from'./voice-capture'
import{VOICE_PROCESSING_MS,VOICE_UPLOAD_MS,voiceCaptureKey}from'../shared/voice-input'
import type{VoiceCaptureContext,VoiceInterpretation}from'../shared/voice-input'
import{api}from'./api'
import{diagnosticLines,diagnosticError,copiedVoiceDiagnostic}from'../shared/voice-diagnostic'
import{Icon}from'./ui'
import{VoiceReview}from'./VoiceReview'
import'./voice-copilot.css'

export function VoiceCopilot({context,open,onToggle,onOpen,visible,disabled,navigationKey,onApplied,onClose}:{navigationKey:string;context:VoiceCaptureContext|null;open:boolean;onToggle:()=>void;onOpen:()=>void;visible:boolean;disabled:boolean;onApplied:()=>void;onClose:()=>void}){
 const[state,setState]=useState<CaptureState>({phase:'idle',message:'Segure o Copiloto para ditar.'})
 const[applying,setApplying]=useState(false)
 const[applyError,setApplyError]=useState('')
 const[transcriptionOpen,setTranscriptionOpen]=useState(false)
 const[appliedKey,setAppliedKey]=useState<string|null>(null)
 const[events,setEvents]=useState<{text:string}[]>([])
 const[lastTranscription,setLastTranscription]=useState('')
 const[copyStatus,setCopyStatus]=useState('')
 const capturePhase=useRef('idle')
 const addEvents=(texts:string[])=>setEvents(old=>[...old,...texts.map(text=>({text}))].slice(-180))
 const clarification=useRef<{resolutionId:string;questionId:string}|null>(null)
 const reviewEpoch=useRef(0)
 const[resolving,setResolving]=useState(false)
 const[capture]=useState(()=>new VoiceCapture({
  getMedia:()=>navigator.mediaDevices.getUserMedia({audio:true}),
  supported:()=>typeof navigator.mediaDevices?.getUserMedia==='function'&&typeof window.MediaRecorder==='function',
  supportsMime:m=>typeof MediaRecorder.isTypeSupported==='function'&&MediaRecorder.isTypeSupported(m),
  recorder:(stream,mime)=>new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000}),
  now:()=>performance.now(),
  process:async(audio,context,duration,signal)=>{
   const clarifying=Boolean(clarification.current),epoch=reviewEpoch.current
   addEvents(['Captura concluída; áudio enviado para '+(clarifying?'esclarecimento dirigido.':'transcrição e interpretação.')])
   try{
    const result=await api<VoiceInterpretation>(`/api/atendimentos/${context.atendimentoId}/copiloto/interpretar?scenarioId=${encodeURIComponent(context.scenarioId)}${clarification.current?'&resolutionId='+encodeURIComponent(clarification.current.resolutionId)+'&questionId='+encodeURIComponent(clarification.current.questionId):''}`,{
     method:'POST',headers:{'Content-Type':audio.type,'X-Funix-Audio-Duration-Ms':String(Math.ceil(duration)),
      'X-Funix-Voice-Revisions':JSON.stringify({composition:context.compositionRevision,configuration:context.configurationRevision,scenario:context.scenarioRevision})},
     body:audio,signal:AbortSignal.any([signal,AbortSignal.timeout(VOICE_PROCESSING_MS+VOICE_UPLOAD_MS+5000)])})
    if(epoch===reviewEpoch.current){setLastTranscription(result.transcription);addEvents([...(clarifying?['Esclarecimento transcrito e validado pelo servidor; pedido original preservado.']:[]),...(result.diagnostic?diagnosticLines(result.diagnostic,!clarifying):[]),...(result.resolution?.questions.map(q=>'Pergunta: '+q.label+' · '+q.options.length+' opção(ões) verificada(s)'+(q.options.length?' · '+q.options.map(o=>o.label).join(', '):'.'))??[])])}
    return result
   }catch(error){if(epoch===reviewEpoch.current)addEvents(['Falha no processamento · '+diagnosticError(error)]);throw error}
  }
 },next=>{
  if(next.phase==='preparing'&&capturePhase.current!=='preparing'){
   if(!clarification.current){setEvents([{text:'Captura iniciada.'}]);setLastTranscription('');setCopyStatus('')}
   else addEvents(['Captura de esclarecimento iniciada.'])
  }
  if(next.phase==='error'&&['preparing','recording'].includes(capturePhase.current))addEvents(['Captura não concluída · VOICE_CAPTURE_FAILED'])
  capturePhase.current=next.phase
  const keep=Boolean(clarification.current&&!next.result);if(next.result)clarification.current=null
  setState(previous=>keep?{...next,result:previous.result}:next)
 }))
 const gesture=useRef<{timer:ReturnType<typeof setTimeout>;long:boolean;pointer?:number;key?:string}|null>(null)
 const clearGesture=()=>{if(gesture.current)clearTimeout(gesture.current.timer);gesture.current=null}
 const key=voiceCaptureKey(context),available=visible&&!disabled
 useLayoutEffect(()=>{reviewEpoch.current++;clarification.current=null;clearGesture();capture.cancel();setApplyError('');setAppliedKey(null);setTranscriptionOpen(false);setEvents([]);setLastTranscription('');setCopyStatus('')},[navigationKey,capture])
 useLayoutEffect(()=>{reviewEpoch.current++;clarification.current=null;clearGesture();capture.setContext(available?context:null);setApplyError('')},[key,available,capture,context])
 useEffect(()=>{
  const cancel=()=>{clearGesture();capture.cancel()}
  const hidden=()=>{if(document.visibilityState==='hidden'&&['preparing','recording','processing'].includes(capture.snapshot.phase))cancel()}
  const blur=()=>{if(['preparing','recording','processing'].includes(capture.snapshot.phase))cancel()}
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',cancel);window.addEventListener('blur',blur)
  return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',cancel);window.removeEventListener('blur',blur);cancel()}
 },[capture])
 const capturing=['preparing','recording','processing'].includes(state.phase)
 const busy=applying||resolving||capturing
 async function resolve(optionId:string){
  const resolution=state.result?.resolution,active=context,epoch=reviewEpoch.current
  if(!resolution||!active||busy)return
  setResolving(true);setApplyError('');clarification.current=null
  const option=resolution.questions.flatMap(q=>q.options).find(o=>o.id===optionId)
  if(option)addEvents(['Opção escolhida: '+option.label])
  try{
   const result=await api<VoiceInterpretation>(`/api/atendimentos/${active.atendimentoId}/copiloto/resolver`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:active.scenarioId,resolutionId:resolution.id,optionId})})
   if(epoch===reviewEpoch.current){setState({phase:'done',message:'',result});if(result.diagnostic)addEvents([...diagnosticLines(result.diagnostic),...(result.resolution?.questions.map(q=>'Pergunta: '+q.label+' · '+q.options.length+' opção(ões) verificada(s)'+(q.options.length?' · '+q.options.map(o=>o.label).join(', '):'.'))??[])])}
  }catch(error){if(epoch===reviewEpoch.current){setApplyError((error as Error).message);addEvents(['Falha ao resolver · '+diagnosticError(error)])}}finally{setResolving(false)}
 }
 function talk(questionId=clarification.current?.questionId??state.result?.resolution?.questions[0]?.id){
  if(state.phase==='recording'){capture.release();return}
  const resolution=state.result?.resolution
  if(!resolution||busy||!context)return
  if(!questionId||!resolution.questions.some(q=>q.id===questionId))return
  addEvents(['Esclarecimento solicitado: '+resolution.questions.find(q=>q.id===questionId)!.label]);clarification.current={resolutionId:resolution.id,questionId};setApplyError('');setTranscriptionOpen(false);onOpen();void capture.hold()
 }
 async function apply(){
  const result=state.result,active=context
  if(busy||!result||!active||!result.plan.idempotencyKey||result.plan.changes.length===0||appliedKey===result.plan.idempotencyKey)return
  if(result.plan.guards.composition!==active.compositionRevision||result.plan.guards.configuration!==active.configurationRevision||
   result.plan.guards.scenarios.find(s=>s.id===active.scenarioId)?.revision!==active.scenarioRevision){
   setApplyError('O contexto foi atualizado. Dite novamente antes de confirmar.');return
  }
  const removes=result.plan.changes.some(c=>c.impact.requiresGlobalRemovalConfirmation)
  if(removes&&!window.confirm('ATENÇÃO: a exclusão remove as peças/serviços indicados de TODOS os cenários e pode apagar componentes vinculados. Essa ação não pode ser desfeita. Confirma a exclusão?'))return
  setApplying(true);setApplyError('');addEvents(['Confirmação humana: aplicação solicitada.'])
  try{
   const applied=await api<{applied:true;changed:number;replay:boolean}>(`/api/atendimentos/${active.atendimentoId}/copiloto/aplicar`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({scenarioId:active.scenarioId,idempotencyKey:result.plan.idempotencyKey,confirmGlobalRemoval:removes})
   })
   if(applied.applied){addEvents(['Apply confirmado pelo servidor · '+applied.changed+' alteração(ões)'+(applied.replay?' · recibo reutilizado.':'.')]);setAppliedKey(result.plan.idempotencyKey);clarification.current=null;capture.cancel();setTranscriptionOpen(false);onApplied();onClose()}
  }catch(error){addEvents(['Falha ao aplicar · '+diagnosticError(error)]);setApplyError((error as Error).message||'A confirmação não foi concluída; confira o Atendimento antes de tentar novamente.')}
  finally{setApplying(false)}
 }
 async function copyDiagnostic(){
  try{await navigator.clipboard.writeText(copiedVoiceDiagnostic(events));setCopyStatus('Diagnóstico copiado sem transcrição ou dados pessoais.')}
  catch{setCopyStatus('Não foi possível copiar. Selecione o texto do diagnóstico abaixo.')}
 }
 function newDictation(){
  if(busy)return
  clarification.current=null;reviewEpoch.current++;capture.cancel();setApplyError('');setTranscriptionOpen(false);onOpen();void capture.hold()
 }
 function start(pointer?:number,key?:string){
  if(gesture.current||busy)return
  clarification.current=null;reviewEpoch.current++
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
  <header><strong>Copiloto</strong><div className="voice-header-actions">
   {(state.result||events.length>0)&&<button aria-label="Mostrar transcrição" aria-expanded={transcriptionOpen} aria-controls="voice-transcript" onClick={()=>setTranscriptionOpen(value=>!value)}><Icon name="text"/></button>}
   <button aria-label="Fechar Copiloto" onClick={onClose}>×</button>
  </div></header>
  <div className="copilot-feed">
   {!context&&<p>Abra um Atendimento e aguarde o cenário carregar para usar a voz.</p>}
   {transcriptionOpen&&<section id="voice-transcript" className="voice-diagnostic" aria-label="Diagnóstico desta tentativa">
    <h3>O que foi dito</h3><p className="voice-transcript">{lastTranscription||'Transcrição ainda não disponível.'}</p>
    <h3>O que aconteceu</h3><ol>{events.map((event,index)=><li key={index}>{event.text}</li>)}</ol>
    <p className="voice-diagnostic-privacy">Somente esta tentativa. A cópia exclui transcrição, observações e dados pessoais.</p>
    <button onClick={()=>void copyDiagnostic()}>Copiar diagnóstico</button><p role="status">{copyStatus}</p>
   </section>}
   {state.result&&<>
    <VoiceReview groups={state.result.reviewGroups} onResolve={id=>void resolve(id)} onClarify={talk} busy={busy}/>
    {state.result.outcome&&<p className="voice-outcome" role="status">{state.result.outcome.message}</p>}
    {state.result.plan.changes.some(c=>c.impact.requiresGlobalRemovalConfirmation)&&<p className="voice-removal" role="alert">Exclusão definitiva em todos os cenários. Serviços e componentes vinculados também podem ser removidos.</p>}
   </>}
   {applyError&&<p role="alert" className="voice-apply-error">{applyError}</p>}
   {state.recoveryAudio&&<RecoveryAudio blob={state.recoveryAudio}/>}
   {['preparing','recording','processing'].includes(state.phase)&&<button className="voice-cancel" onClick={()=>{clearGesture();addEvents(['Captura cancelada.']);capture.cancel()}}>Cancelar</button>}
  </div>
  {state.result&&<div className="voice-action-bar">
   {state.result.resolution&&state.result.resolution.questions.length>0&&<button className="voice-talk" disabled={applying||resolving||state.phase==='preparing'||state.phase==='processing'||!context} onClick={()=>talk()}>{state.phase==='recording'?'Enviar esclarecimento':'Falar'}</button>}
   <button className="voice-new" disabled={busy||!context} onClick={newDictation}>Novo ditado</button>
   <button className="voice-apply" disabled={busy||!context||state.result.plan.changes.length===0||appliedKey===state.result.plan.idempotencyKey} onClick={()=>void apply()}>{appliedKey===state.result.plan.idempotencyKey?'Alterações aplicadas':applying?'Aplicando…':state.result.plan.changes.length===0?(state.result.outcome?.kind==='unchanged'?'Já está assim':state.result.outcome?.pending?'Resolver pendências':'Nenhuma alteração'):state.result.reviewGroups.some(g=>g.entries.some(e=>e.kind==='pending'||e.kind==='warning'))?'Aplicar assim mesmo':'Aplicar alterações'}</button>
  </div>}
  {!state.result&&state.phase==='error'&&context&&<button className="voice-new" onClick={newDictation}>Novo ditado</button>}
  {!state.result&&state.phase==='recording'&&<button className="voice-send" onClick={()=>capture.release()}>Enviar ditado</button>}
  {state.result?.resolution&&state.phase==='recording'&&<p className="voice-clarification-hint">Diga apenas a opção ou o nome exato do cadastro. O ditado original será preservado.</p>}
  {state.phase!=='done'&&<div className={'copilot-status voice-status '+state.phase} role={state.phase==='error'?'alert':'status'}>{state.message}</div>}
 </section>}
 {visible&&<button data-voice-ready={Boolean(context)} className={'copilot-fixed voice-launcher '+state.phase} aria-label="Abrir Copiloto FUNIX" aria-description="Toque para abrir. Segure, ou mantenha Espaço ou Enter pressionado, para ditar no Atendimento atual." title="Copiloto" aria-expanded={open} disabled={disabled||applying||resolving}
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
