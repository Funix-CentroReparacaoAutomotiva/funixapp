import type {VoicePlan} from './voice-commands.ts'

// Fixed application limits; no browser/provider credentials in this contract.
export const VOICE_MAX_BYTES=12*1024*1024
export const VOICE_MAX_DURATION_MS=180_000
export const VOICE_PROCESSING_MS=110_000
export const VOICE_UPLOAD_MS=15_000
export const VOICE_MIMES=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4'] as const
export interface VoiceCaptureContext{
 atendimentoId:string;scenarioId:string;compositionRevision:number;scenarioRevision:number;configurationRevision:number
}
export interface VoiceInterpretation{
 requestId:string;transcription:string;plan:VoicePlan;applied:false
}
export const voiceCaptureKey=(c:VoiceCaptureContext|null)=>c?JSON.stringify(c):''
