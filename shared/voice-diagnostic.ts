// Ephemeral support projection. Never accepts raw audio, payloads, notes or contacts.
export interface VoiceDiagnosticCommand {
 command:number;operation:string;piece?:string;service?:string;dimension?:string;quantity?:string
}
export interface VoiceDiagnostic {
 decisions?:string[];interpreted:VoiceDiagnosticCommand[];current:VoiceDiagnosticCommand[]
 existing:{piece:string;service:string;dimension:string;quantity:string}[]
 results:{command:number;status:string;code?:string}[];changes:number
}
const clean=(s:string)=>Array.from(s).map(c=>c.charCodeAt(0)<32?' ':c).join('').slice(0,160)
export function diagnosticLines(d:VoiceDiagnostic,initial=false):string[]{
 const describe=(c:VoiceDiagnosticCommand)=>'#'+c.command+' '+clean(c.operation)+[c.piece,c.service,c.dimension,c.quantity?'quantidade '+c.quantity:undefined].filter(Boolean).map(s=>' · '+clean(s!)).join('')
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
export function copiedVoiceDiagnostic(events:{text:string}[]):string{
 return 'FUNIX — diagnóstico efêmero do Copiloto\n'+events.map((e,i)=>(i+1)+'. '+e.text).join('\n')
}
