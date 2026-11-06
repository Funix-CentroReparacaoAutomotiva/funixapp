import test from 'node:test'
import assert from 'node:assert/strict'
import {copiedVoiceDiagnostic} from '../../shared/voice-diagnostic-export.ts'
import {diagnosticFailure,diagnosticHistory} from '../../shared/voice-diagnostic.ts'
const pii='DANIEL_SINTETICO 41955443322 JKL1M23 TOKEN_QA'
const parse=(text:string)=>text.split('\n').slice(1).filter(Boolean).map(line=>JSON.parse(line.slice(line.indexOf('. ')+2)))

test('clipboard never reads display text, including structured history without technical metadata',()=>{
 const event={technical:{type:'capture_started'},get text():string{throw Error('Display text must never be read')}}
 assert.deepEqual(parse(copiedVoiceDiagnostic([event,{text:pii}])),[{type:'capture_started'}])
 const history=diagnosticHistory({interpreted:[{command:1,operation:'add_service',piece:pii,service:pii,dimension:pii}],current:[],existing:[],results:[],changes:0},true)
 assert(history.some(e=>e.text.includes(pii)));assert(!copiedVoiceDiagnostic(history).includes(pii))
})
test('clipboard reconstructs a closed projection: nested free values, unknown codes/enums and malformed numeric fields cannot escape',()=>{
 const text=copiedVoiceDiagnostic([{text:pii,technical:{type:'replanned',diagnostic:{
  name:pii,labels:[pii],transcription:pii,token:pii,
  interpreted:[{command:pii,operation:pii,piece:pii,service:pii,dimension:pii,quantity:pii,label:pii}],
  current:[{command:1,operation:'set_quantity',piece:1,quantity:'-2'}],
  existing:[{piece:pii,service:pii,dimension:pii,line:pii,quantity:pii,name:pii}],
  results:[{command:pii,status:pii,code:'TOKEN_QA'}],decisions:[{code:pii,command:pii}],changes:pii,
  alterations:[{operation:pii,fields:['notes',pii],dimension:{before:pii,after:pii},quantity:{before:pii,after:pii},enabled:{before:pii,after:pii}}]
 }}},{technical:{type:'option_selected',question:pii,option:pii,label:pii}},{technical:{type:'request_failed',stage:pii,code:'TOKEN_QA',status:pii,message:pii}},{technical:{type:pii}}])
 for(const value of [...pii.split(' '),'-2'])assert(!text.includes(value),value)
 const parsed=parse(text)
 assert.equal(parsed[0].diagnostic.interpreted[0].operation,'UNKNOWN_OPERATION')
 assert.equal(parsed[0].diagnostic.results[0].code,'UNKNOWN_CODE')
 assert.equal(parsed[0].diagnostic.decisions[0].code,'UNKNOWN_DECISION')
 assert.deepEqual(parsed[0].diagnostic.alterations[0].fields,['notes'])
 assert.equal(parsed[2].code,'UNKNOWN_CODE');assert.equal(parsed.length,3)
})
test('clipboard preserves technical operations, aliases, state/error codes, decisions, exact quantities and changes in event order',()=>{
 const events=[{technical:{type:'capture_started'}},{technical:{type:'replanned',diagnostic:{
  interpreted:[{command:1,operation:'add_service',piece:'unresolved',service:2,dimension:3}],
  current:[{command:1,operation:'add_service',piece:1,service:2,dimension:4,quantity:'2.5'}],
  existing:[{piece:1,service:2,dimension:3,line:1,quantity:'3'}],results:[{command:1,status:'valid'},{command:2,status:'pending',code:'UNRESOLVED_REFERENCE'}],
  decisions:[{code:'EXISTING_LINE_RECONCILED',command:1}],changes:1,
  alterations:[{operation:'update_service',fields:['dimensionId','quantity'],dimension:{before:3,after:4},quantity:{before:'3',after:'2.5'}},{operation:'set_service_enabled',fields:['enabled'],enabled:{before:true,after:false}}]
 }}},{technical:{type:'question_offered',question:1,options:2}},{technical:{type:'option_selected',question:1,option:2}},
 {technical:diagnosticFailure('processing',{code:'VOICE_CLARIFICATION_PENDING',status:422,message:pii})},
 {technical:{type:'apply_requested'}},{technical:{type:'apply_confirmed',changes:1,replay:true}}]
 assert.deepEqual(parse(copiedVoiceDiagnostic(events)),events.map(e=>e.technical))
 assert(!copiedVoiceDiagnostic(events).includes(pii))
})
