// Only provider transport metadata: never record audio, prompts, transcript, IDs or credentials.
// "response" means a parsed HTTP response, not a semantically valid command.
export interface VoiceUsageMetric {
 stage:'transcription'|'interpretation'
 model:string
 status:'response'|'transport_error'|'aborted'
 elapsedMs:number
 inputTokens:number|null
 outputTokens:number|null
 totalTokens:number|null
 cachedInputTokens:number|null
 reasoningOutputTokens:number|null
 audioInputTokens:number|null
 audioOutputTokens:number|null
 audioSeconds:number|null
}
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1_000_000_000?v:null
const seconds=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=180?v:null
export function summarizeVoiceUsage(stage:VoiceUsageMetric['stage'],model:string,status:VoiceUsageMetric['status'],elapsedMs:number,payload:unknown):VoiceUsageMetric {
 const usage=obj(obj(payload).usage),inputs=obj(usage.input_tokens_details),outputs=obj(usage.output_tokens_details)
 const audioInputDetails=obj(usage.input_token_details)
 return {
  stage,model:/^[a-zA-Z0-9._-]{1,80}$/.test(model)?model:'unrecognized-model',status,
  elapsedMs:count(elapsedMs)??0,
  inputTokens:count(usage.input_tokens),
  outputTokens:count(usage.output_tokens),
  totalTokens:count(usage.total_tokens),
  cachedInputTokens:count(inputs.cached_tokens),
  reasoningOutputTokens:count(outputs.reasoning_tokens),
  audioInputTokens:count(inputs.audio_tokens)??count(audioInputDetails.audio_tokens),
  audioOutputTokens:count(outputs.audio_tokens),
  audioSeconds:seconds(usage.seconds)
 }
}
