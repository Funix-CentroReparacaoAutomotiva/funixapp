// Ephemeral support projection. Never accepts raw audio, payloads, notes or contacts.
export interface VoiceDiagnosticCommand {
 command:number;operation:string;piece?:string;service?:string;component?:string;dimension?:string;quantity?:string
}
export interface VoiceDiagnostic {
 technical?:import('./voice-diagnostic-export.ts').VoiceTechnicalDiagnostic;
 decisions?:string[];interpreted:VoiceDiagnosticCommand[];current:VoiceDiagnosticCommand[]
 existing:{piece:string;service:string;dimension:string;quantity:string}[]
 results:{command:number;status:string;code?:string}[];changes:number
}
const clean=(s:string)=>Array.from(s).map(c=>c.charCodeAt(0)<32?' ':c).join('').slice(0,160)
export function diagnosticLines(d:VoiceDiagnostic,initial=false):string[]{
 const describe=(c:VoiceDiagnosticCommand)=>'#'+c.command+' '+clean(c.operation)+[c.piece,c.service,c.component,c.dimension,c.quantity?'quantidade '+c.quantity:undefined].filter(Boolean).map(s=>' · '+clean(s!)).join('')
 return [
  ...(initial?['Transcrição concluída (texto separado do diagnóstico).',...d.interpreted.map(c=>'IA interpretou '+describe(c))]:[]),
  ...(d.decisions??[]).map(clean),
  ...d.current.map(c=>'Pedido em revisão '+describe(c)),
  ...d.existing.map(c=>'Já cadastrado · '+[c.piece,c.service,c.dimension,'quantidade '+c.quantity].map(clean).join(' · ')),
  ...d.results.map(r=>(r.command?'Comando #'+r.command:'Dependência validada')+' · '+clean(r.status)+(r.code?' · '+clean(r.code):'')),
  'Replanejamento: '+d.changes+' alteração(ões) segura(s).'
 ]
}
export function diagnosticError(error:unknown):string{
 const e=error as {code?:unknown;status?:unknown}
 const code=typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{0,64}$/.test(e.code)?e.code:'VOICE_REQUEST_FAILED'
 return code+(typeof e?.status==='number'&&e.status>=400&&e.status<600?' · HTTP '+e.status:'')
}
export {copiedVoiceDiagnostic} from './voice-diagnostic-export.ts'

export function diagnosticHistory(d:VoiceDiagnostic,initial=false):import('./voice-diagnostic-export.ts').VoiceHistoryEvent[]{
 const lines=diagnosticLines(d,initial)
 return lines.map((text,index)=>({text,...(index===lines.length-1&&d.technical?{technical:{type:'replanned' as const,diagnostic:d.technical}}:{})}))
}

export function diagnosticQuestions(resolution:import('./voice-resolution.ts').VoiceResolution|undefined):import('./voice-diagnostic-export.ts').VoiceHistoryEvent[]{
 return resolution?.questions.map((q,index)=>({text:'Pergunta: '+q.label+' · '+q.options.length+' opção(ões) verificada(s)'+(q.options.length?' · '+q.options.map(o=>o.label).join(', '):'.'),technical:{type:'question_offered',question:index+1,options:q.options.length}}))??[]
}
export function diagnosticFailure(stage:'processing'|'resolution'|'apply',error:unknown):import('./voice-diagnostic-export.ts').VoiceTechnicalEvent{
 const e=error as {code?:unknown;status?:unknown}
 return {type:'request_failed',stage,code:e?.code,status:e?.status}
}
