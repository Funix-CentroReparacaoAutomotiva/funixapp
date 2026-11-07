import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {analyzeVoiceUsage,validateTariffs} from '../voice-cost-report.mjs'

const tariffs={models:{
 'gpt-transcribe':{billing:'audio_minutes',usdPerMinute:0.006},
 'gpt-6.1-terra':{billing:'tokens',inputUsdPerMillion:1,outputUsdPerMillion:5,cachedInputUsdPerMillion:0.1}
}}
const metric=(overrides={})=>({
 stage:'interpretation',model:'gpt-6.1-terra',status:'response',elapsedMs:120,
 inputTokens:500,outputTokens:100,totalTokens:600,cachedInputTokens:20,
 reasoningOutputTokens:12,audioInputTokens:null,audioOutputTokens:null,audioSeconds:null,
 ...overrides
})
const line=o=>'2026-11-07T12:00:00Z funix_voice_usage '+JSON.stringify(o)

test('computes opt-in provider charges by stage without combining them into a dictation',()=>{
 const input=[
 line(metric({stage:'transcription',model:'gpt-transcribe',inputTokens:null,outputTokens:null,totalTokens:null,cachedInputTokens:null,reasoningOutputTokens:null,audioSeconds:12})),
 line(metric()),
 line(metric({status:'transport_error',inputTokens:null,outputTokens:null,totalTokens:null,cachedInputTokens:null})),
 'unrelated log'
 ].join('\n')
 const r=analyzeVoiceUsage(input,tariffs)
 assert.equal(r.telemetryLines,3);assert.equal(r.validRecords,3);assert.equal(r.pricedCalls,2)
 assert.equal(r.unestimatedCalls,1)
 assert.equal(r.estimateCoverage,'partial')
 assert.equal(r.estimatedUsd,0.002182)
 assert.equal(r.scope,'backend_provider_calls_not_confirmed_commands')
 assert.equal(r.groups.find(x=>x.stage==='interpretation').estimatedUsd,0.000982)
 assert.equal(r.groups.find(x=>x.stage==='transcription').estimatedUsd,0.0012)
})

test('does not substitute zero for missing provider usage, missing tariffs or unknown cache',()=>{
 const missing=analyzeVoiceUsage([
  line(metric({inputTokens:null,outputTokens:null})),
  line(metric({model:'new-unpriced-model'})),
  line(metric({cachedInputTokens:null})),
  line(metric({status:'aborted',inputTokens:100,outputTokens:100})),
  line(metric({cachedInputTokens:550}))
 ].join('\n'),tariffs)
 assert.equal(missing.estimatedUsd,null)
 assert.equal(missing.estimateCoverage,'unavailable')
 assert.equal(missing.pricedCalls,0)
 assert.equal(missing.unestimatedCalls,5)
})

test('rejects malformed and unexpected fields rather than emitting user data',()=>{
 const secret='CUSTOMER_NAME_PRIVATE'
 const text=[
  'unrelated '+secret,
  'funix_voice_usage {"stage":',
  line({...metric(),transcription:secret}),
  line(metric()),
 ].join('\n')
 const r=analyzeVoiceUsage(text,tariffs)
 assert.equal(r.invalidRecords,2)
 assert.equal(r.validRecords,1)
 assert.equal(r.estimateCoverage,'partial')
 assert(!JSON.stringify(r).includes(secret))
})

test('rejects implausible quantities, unsafe prices and unsupported tariff formats',()=>{
 assert.throws(()=>validateTariffs({models:{bad:{billing:'tokens',inputUsdPerMillion:-1,outputUsdPerMillion:2}}}))
 assert.throws(()=>validateTariffs({models:{bad:{billing:'audio_minutes',usdPerMinute:'0.1'}}}))
 assert.throws(()=>validateTariffs({models:{bad:{billing:'unknown',usdPerMinute:1}}}))
 const r=analyzeVoiceUsage(line(metric({elapsedMs:-1}))+'\n'+line(metric({outputTokens:1000000001})),tariffs)
 assert.equal(r.invalidRecords,2)
 assert.equal(r.validRecords,0)
})

test('CLI emits only aggregate JSON and never the original log or data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funix-voice-cost-'))
 try{
  const input=join(dir,'sample.log'),prices=join(dir,'tariffs.json')
  writeFileSync(input,'hello PRIVATE CUSTOMER\n'+line(metric()))
  writeFileSync(prices,JSON.stringify(tariffs))
  const p=spawnSync(process.execPath,['scripts/voice-cost-report.mjs','--input',input,'--tariffs',prices],{encoding:'utf8'})
  assert.equal(p.status,0,p.stderr)
  assert.equal(JSON.parse(p.stdout).validRecords,1)
  assert.equal(JSON.parse(p.stdout).estimateCoverage,'complete')
  assert(!p.stdout.includes('PRIVATE CUSTOMER'))
  const bad=spawnSync(process.execPath,['scripts/voice-cost-report.mjs','--input',input,'--tariffs',join(dir,'missing')],{encoding:'utf8'})
  assert.equal(bad.status,1)
  assert(!bad.stderr.includes(join(dir,'missing')))
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test('empty or wholly unpriced log produces unknown total, never a fictitious zero',()=>{
 const empty=analyzeVoiceUsage('no usage metadata available',tariffs)
 assert.equal(empty.estimatedUsd,null)
 assert.equal(empty.estimateCoverage,'unavailable')
 const unpriced=analyzeVoiceUsage(line(metric({status:'transport_error',inputTokens:null,outputTokens:null,totalTokens:null})),tariffs)
 assert.equal(unpriced.estimatedUsd,null)
 assert.equal(unpriced.groups[0].estimatedUsd,null)
})

test('missing cache tariff or usage cannot silently overprice token requests',()=>{
 const noCachePrice={models:{'gpt-6.1-terra':{billing:'tokens',inputUsdPerMillion:1,outputUsdPerMillion:5}}}
 const log=[line(metric({cachedInputTokens:20})),line(metric({cachedInputTokens:null})),line(metric({cachedInputTokens:0}))].join('\n')
 const r=analyzeVoiceUsage(log,noCachePrice)
 assert.equal(r.pricedCalls,1)
 assert.equal(r.unestimatedCalls,2)
 assert.equal(r.estimateCoverage,'partial')
 assert.equal(r.groups[0].estimatedUsd,0.001)
})
test('model-name edge cases never inherit properties from plain objects',()=>{
 const r=analyzeVoiceUsage(line(metric({model:'constructor'})),{models:{constructor:{billing:'tokens',inputUsdPerMillion:1,outputUsdPerMillion:2,cachedInputUsdPerMillion:0.1}}})
 assert.equal(r.validRecords,1)
 assert.equal(r.pricedCalls,1)
})
