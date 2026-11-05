import type{DatabaseSync}from'node:sqlite'
import type{IncomingMessage}from'node:http'
import{randomUUID}from'node:crypto'
import{ServiceError}from'./errors.ts'
import{VOICE_MAX_BYTES,VOICE_MAX_DURATION_MS,VOICE_MIMES,VOICE_PROCESSING_MS,VOICE_UPLOAD_MS}from'../shared/voice-input.ts'
import{stageVoiceBatch}from'./voice-apply.ts'
import{readVoiceContext,modelVoiceContext}from'./voice-context.ts'
import{planVoiceCommands,voiceContextDigest,voiceRevisions}from'./voice-planner.ts'
import{validateVoiceCommands}from'./voice-command-validation.ts'
import{convertVoiceModelOutput}from'./voice-model-contract.ts'
import type{VoiceProvider}from'./voice-provider.ts'
const invalid=(message:string):never=>{throw new ServiceError(400,'VOICE_INVALID_INPUT',message)}
const stale=()=>new ServiceError(409,'VOICE_CONTEXT_STALE','O Atendimento ou cenário mudou. Grave novamente no contexto atual.')
export function createVoiceEndpoint(db:DatabaseSync,provider:VoiceProvider|undefined,processingMs=VOICE_PROCESSING_MS){
 let busy=false,windowStart=0,attempts=0
 return async(req:IncomingMessage,at:string,url:URL,requestId:string,sessionValid:()=>boolean,sessionId:string)=>{
  if(!provider)throw new ServiceError(503,'VOICE_UNAVAILABLE','Copiloto de voz não configurado no backend.')
  if(busy)throw new ServiceError(429,'VOICE_BUSY','Já existe um áudio em processamento. Aguarde sua conclusão.')
  if(Date.now()-windowStart>=60000){windowStart=Date.now();attempts=0}
  if(attempts>=12)throw new ServiceError(429,'VOICE_RATE_LIMIT','Limite de processamento atingido. Aguarde um minuto.')
  const mime=req.headers['content-type']?.toLowerCase().replaceAll(' ','')??''
  if(!VOICE_MIMES.includes(mime as typeof VOICE_MIMES[number]))throw new ServiceError(415,'VOICE_AUDIO_FORMAT','Formato de áudio não suportado.')
  const length=req.headers['content-length']
  if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>VOICE_MAX_BYTES))throw new ServiceError(413,'VOICE_AUDIO_TOO_LARGE','Áudio excede 12 MiB.')
  const duration=Number(req.headers['x-funix-audio-duration-ms'])
  if(!Number.isFinite(duration)||duration<=0||duration>VOICE_MAX_DURATION_MS)invalid('Duração declarada deve ser maior que zero e até três minutos.')
  if([...url.searchParams.keys()].some(k=>k!=='scenarioId')||url.searchParams.getAll('scenarioId').length!==1)invalid('Informe somente o cenário aberto.')
  const scene=url.searchParams.get('scenarioId')!
  if(!scene||scene.length>100)invalid('Cenário inválido.')
  const context=readVoiceContext(db,at,scene),scenario=context.workspace.scenarios.find(s=>s.id===scene)!
  let expected:unknown
  try{expected=JSON.parse(String(req.headers['x-funix-voice-revisions']??''))}catch{invalid('Revisões de captura ausentes.')}
  const revisions={composition:context.workspace.revision,configuration:context.workspace.configurationRevision,scenario:scenario.revision}
  if(!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).length!==3||Object.entries(revisions).some(([key,value])=>(expected as Record<string,unknown>)[key]!==value))throw stale()
  const digest=voiceContextDigest(context),controller=new AbortController()
  const cancelled=()=>controller.abort(new ServiceError(499,'VOICE_CANCELLED','Processamento cancelado.'))
  const disconnected=()=>{if(!req.complete)cancelled()}
  req.on('aborted',cancelled);req.on('close',disconnected)
  busy=true;attempts++
  let timer:ReturnType<typeof setTimeout>|undefined
  const abort=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}))
  async function body(){
   let bytes=0;const parts:Buffer[]=[]
   for await(const chunk of req.iterator({destroyOnReturn:false})){
    const part=Buffer.from(chunk);bytes+=part.length
    if(bytes>VOICE_MAX_BYTES)throw new ServiceError(413,'VOICE_AUDIO_TOO_LARGE','Áudio excede 12 MiB.')
    parts.push(part)
   }
   if(!bytes)invalid('Áudio vazio.')
   const data=Buffer.concat(parts)
   // Reject mislabeled text/JSON before contacting a paid provider.
   const valid=mime.includes('webm')?data.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])):mime.includes('ogg')?data.subarray(0,4).toString()==='OggS':data.subarray(4,8).toString()==='ftyp'
   if(!valid)throw new ServiceError(415,'VOICE_AUDIO_FORMAT','Conteúdo não corresponde ao formato de áudio informado.')
   return data
  }
  try{
   timer=setTimeout(()=>controller.abort(new ServiceError(408,'VOICE_UPLOAD_TIMEOUT','Tempo de envio do áudio excedido.')),VOICE_UPLOAD_MS)
   const audio=await Promise.race([body(),abort]);clearTimeout(timer)
   timer=setTimeout(()=>controller.abort(new ServiceError(504,'VOICE_TIMEOUT','Tempo de processamento excedido. Nenhuma alteração foi aplicada.')),processingMs)
   const work=async()=>{
    const transcription=await provider.transcribe(audio,mime,controller.signal)
    if(typeof transcription!=='string'||!transcription.trim()||transcription.length>20000)throw new ServiceError(502,'VOICE_TRANSCRIPTION_FAILED','Transcrição vazia ou inválida.')
    controller.signal.throwIfAborted()
    const output=await provider.interpret(transcription,modelVoiceContext(context),controller.signal)
    controller.signal.throwIfAborted()
    if(!sessionValid())throw new ServiceError(401,'AUTH_REQUIRED','Sessão encerrada durante o processamento.')
    let fresh
    try{fresh=readVoiceContext(db,at,scene)}catch{throw stale()}
    if(voiceContextDigest(fresh)!==digest)throw stale()
    const batch={format:'funix-voice-commands-v1',atendimentoId:at,scenarioId:scene,expected:voiceRevisions(context),
     idempotencyKey:randomUUID(),commands:convertVoiceModelOutput(output)}
    const validated=validateVoiceCommands(batch)
    if(!validated.batch||validated.invalidIndexes.length||validated.issues.length)throw new ServiceError(502,'VOICE_MODEL_INVALID','A IA retornou comandos inválidos; nenhuma alteração foi aplicada.')
    const plan=planVoiceCommands(batch,context)
    if(plan.changes.length)stageVoiceBatch(db,batch,plan.stateDigest,plan.requestDigest,sessionId)
    return{requestId,transcription,plan,applied:false as const}
   }
   return await Promise.race([work(),abort])
  }catch(error){
   if(error instanceof ServiceError)throw error
   throw new ServiceError(502,'VOICE_PROVIDER_UNAVAILABLE','Não foi possível concluir o processamento de voz.')
  }finally{clearTimeout(timer);controller.abort();busy=false;req.off('aborted',cancelled);req.off('close',disconnected);if(!req.complete)req.resume()}
 }
}
