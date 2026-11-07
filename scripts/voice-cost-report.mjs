// Offline-only aggregate cost estimator for the metadata emitted by PR #78.
// No provider calls, DB access, env-file access, or per-Atendimento reporting.
import {readFileSync,statSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'

const PREFIX='funix_voice_usage '
const MAX_BYTES=10*1024*1024
const MAX_LINES=100000
const FIELDS=new Set(['stage','model','status','elapsedMs','inputTokens','outputTokens','totalTokens','cachedInputTokens','reasoningOutputTokens','audioInputTokens','audioOutputTokens','audioSeconds'])
const COUNTS=['inputTokens','outputTokens','totalTokens','cachedInputTokens','reasoningOutputTokens','audioInputTokens','audioOutputTokens']
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const quantity=v=>v===null||(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1e9)
const money=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e6
const round=v=>Math.round((v+Number.EPSILON)*1e8)/1e8

export function validateTariffs(raw){
 if(!isObj(raw)||!isObj(raw.models)||!Object.keys(raw.models).length)throw Error('TARIFFS_INVALID')
 const result=Object.create(null)
 for(const [model,p] of Object.entries(raw.models)){
  if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model)||!isObj(p))throw Error('TARIFFS_INVALID')
  if(p.billing==='tokens'){
   if(!money(p.inputUsdPerMillion)||!money(p.outputUsdPerMillion)||p.cachedInputUsdPerMillion!==undefined&&!money(p.cachedInputUsdPerMillion))throw Error('TARIFFS_INVALID')
   result[model]={billing:'tokens',inputUsdPerMillion:p.inputUsdPerMillion,outputUsdPerMillion:p.outputUsdPerMillion,...(p.cachedInputUsdPerMillion===undefined?{}:{cachedInputUsdPerMillion:p.cachedInputUsdPerMillion})}
  }else if(p.billing==='audio_minutes'){
   if(!money(p.usdPerMinute))throw Error('TARIFFS_INVALID')
   result[model]={billing:'audio_minutes',usdPerMinute:p.usdPerMinute}
  }else throw Error('TARIFFS_INVALID')
 }
 return result
}

function validMetric(o){
 return isObj(o)&&Object.keys(o).every(k=>FIELDS.has(k))&&
 (o.stage==='transcription'||o.stage==='interpretation')&&
 typeof o.model==='string'&&/^[a-zA-Z0-9._-]{1,80}$/.test(o.model)&&
 (o.status==='response'||o.status==='transport_error'||o.status==='aborted')&&
 quantity(o.elapsedMs)&&o.elapsedMs!==null&&
 COUNTS.every(k=>quantity(o[k])&&Object.hasOwn(o,k))&&
 (o.audioSeconds===null||typeof o.audioSeconds==='number'&&Number.isFinite(o.audioSeconds)&&o.audioSeconds>=0&&o.audioSeconds<=180)&&
 Object.hasOwn(o,'audioSeconds')
}

function estimate(o,tariff){
 if(o.status!=='response'||!tariff)return null
 if(o.stage==='transcription'){
  if(tariff.billing!=='audio_minutes'||o.audioSeconds===null)return null
  return o.audioSeconds/60*tariff.usdPerMinute
 }
 if(tariff.billing!=='tokens'||o.inputTokens===null||o.outputTokens===null)return null
 // Missing cache accounting is not equivalent to zero cached tokens.
 if(o.cachedInputTokens===null||o.cachedInputTokens>o.inputTokens)return null
 // If the response reports cached tokens, the corresponding rate is mandatory.
 if(o.cachedInputTokens>0&&tariff.cachedInputUsdPerMillion===undefined)return null
 const cached=o.cachedInputTokens
 return (o.inputTokens-cached)*tariff.inputUsdPerMillion/1e6+
  cached*(tariff.cachedInputUsdPerMillion??tariff.inputUsdPerMillion)/1e6+
  o.outputTokens*tariff.outputUsdPerMillion/1e6
}

export function analyzeVoiceUsage(logText,tariffDocument){
 if(typeof logText!=='string'||Buffer.byteLength(logText)>MAX_BYTES)throw Error('LOG_TOO_LARGE')
 const prices=validateTariffs(tariffDocument)
 const lines=logText.split(/\r?\n/)
 if(lines.length>MAX_LINES)throw Error('LOG_TOO_MANY_LINES')
 const entries=new Map()
 let telemetryLines=0,invalidRecords=0
 for(const line of lines){
  const pos=line.indexOf(PREFIX)
  if(pos===-1)continue
  telemetryLines++
  let o
  try{o=JSON.parse(line.slice(pos+PREFIX.length))}catch{invalidRecords++;continue}
  if(!validMetric(o)){invalidRecords++;continue}
  const key=o.stage+'\0'+o.model
  if(!entries.has(key))entries.set(key,{stage:o.stage,model:o.model,calls:0,received:0,transportErrors:0,aborted:0,estimatedCalls:0,unestimatedCalls:0,estimatedUsdRaw:0,elapsedMsTotal:0})
  const a=entries.get(key)
  a.calls++;a.elapsedMsTotal+=o.elapsedMs
  if(o.status==='response')a.received++
  else if(o.status==='aborted')a.aborted++
  else a.transportErrors++
  const cost=estimate(o,prices[o.model])
  if(cost===null)a.unestimatedCalls++
  else{a.estimatedCalls++;a.estimatedUsdRaw+=cost}
 }
 const groups=[...entries.values()].sort((a,b)=>a.stage.localeCompare(b.stage)||a.model.localeCompare(b.model)).map(a=>({
  stage:a.stage,model:a.model,calls:a.calls,responses:a.received,transportErrors:a.transportErrors,aborted:a.aborted,
  estimatedCalls:a.estimatedCalls,unestimatedCalls:a.unestimatedCalls,
  estimatedUsd:a.estimatedCalls===0?null:round(a.estimatedUsdRaw),meanTransportMs:Math.round(a.elapsedMsTotal/a.calls)
 }))
 const pricedCalls=groups.reduce((n,x)=>n+x.estimatedCalls,0)
 const unestimatedCalls=groups.reduce((n,x)=>n+x.unestimatedCalls,0)
 return{
  reportType:'funix_voice_provider_cost_estimate_v1',
  scope:'backend_provider_calls_not_confirmed_commands',
  currency:'USD',
  telemetryLines,validRecords:groups.reduce((n,x)=>n+x.calls,0),invalidRecords,
  pricedCalls,
  unestimatedCalls,
  estimateCoverage:pricedCalls===0?'unavailable':unestimatedCalls>0||invalidRecords>0?'partial':'complete',
  estimatedUsd:pricedCalls===0?null:round([...entries.values()].reduce((n,x)=>n+x.estimatedUsdRaw,0)),
  groups,
  caveats:[
   'Estimated USD covers priced calls only; incomplete/failed calls may still be billable.',
   'Provider response does not prove accepted commands, human confirmation or economic benefit.',
   'Not an invoice: reconcile actual API billing, exchange rate, taxes and applicable tariffs.',
   'Do not interpret this report as cost per completed dictation without request-level correlation.'
  ]
 }
}

function main(argv){
 if(argv.length!==4||argv[0]!=='--input'||argv[2]!=='--tariffs')throw Error('USAGE')
 const input=resolve(argv[1]),tariffs=resolve(argv[3])
 if(statSync(input).size>MAX_BYTES||statSync(tariffs).size>1024*1024)throw Error('FILE_TOO_LARGE')
 const result=analyzeVoiceUsage(readFileSync(input,'utf8'),JSON.parse(readFileSync(tariffs,'utf8')))
 process.stdout.write(JSON.stringify(result,null,2)+'\n')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main(process.argv.slice(2))}catch{
  process.stderr.write('Uso: node scripts/voice-cost-report.mjs --input LOG_SANITIZADO --tariffs PRECOS_JSON (erro de entrada/configuracao)\n')
  process.exitCode=1
 }
}
