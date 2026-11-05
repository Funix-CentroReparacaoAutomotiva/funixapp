import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {readVoiceContext} from '../voice-context.ts'
import {planVoiceCommands,voiceRevisions} from '../voice-planner.ts'
import {compactVoiceReview} from '../voice-review-summary.ts'
import {stageVoiceBatch,applyVoiceBatch} from '../voice-apply.ts'
import type {VoiceCommand,VoiceCommandBatch} from '../../shared/voice-commands.ts'
const ref=(id:string)=>({state:'resolved' as const,id})
let sequence=0
function setup(){
 const db=openDatabase(':memory:'),f=commercialFixture(db)
 const prepare=(commands:VoiceCommand[])=>{
  const context=readVoiceContext(db,f.at.id,f.scenario.id)
  const batch:VoiceCommandBatch={format:'funix-voice-commands-v1',idempotencyKey:'compact-review-synthetic-'+(++sequence),atendimentoId:f.at.id,scenarioId:f.scenario.id,expected:voiceRevisions(context),commands}
  const plan=planVoiceCommands(batch,context),groups=compactVoiceReview(plan,context,commands)
  return {plan,groups,apply:(confirmGlobalRemoval=false)=>{stageVoiceBatch(db,batch,plan.stateDigest,plan.requestDigest,'compact-session');return applyVoiceBatch(db,f.at.id,{idempotencyKey:batch.idempotencyKey,scenarioId:f.scenario.id,confirmGlobalRemoval},'compact-session')}}
 }
 return{db,f,prepare}
}
test('compact review groups final additions and exposes every material consolidated field persisted by PR45',()=>{
 const {db,f,prepare}=setup()
 try{
  const other=f.scenarios.create(f.at.id,{name:'Outro cenário'})
  const piece=f.commercial.catalogs().items.find(c=>c.kind==='peca'&&c.code&&c.id!==f.item.pieceId)!
  const diagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'Dano sintético'})
  const {plan,groups,apply}=prepare([
   {id:'piece',op:'add_piece',intent:'instruction',piece:ref(piece.id)},
   {id:'damage',op:'set_diagnosis',intent:'instruction',piece:ref(piece.id),diagnosis:ref(diagnosis.id),intensity:'severo'},
   {id:'notes',op:'set_notes',intent:'instruction',piece:ref(piece.id),value:'Observação consolidada'},
   {id:'disabled',op:'set_piece_enabled',intent:'instruction',piece:ref(piece.id),enabled:false},
   {id:'service',op:'add_service',intent:'instruction',piece:ref(piece.id),service:ref(f.service.id),dimension:ref(f.dimension.id),quantity:'2.5'},
   {id:'line-notes',op:'set_notes',intent:'instruction',piece:ref(piece.id),line:{kind:'command',commandId:'service'},value:'Observação da linha'}
  ])
  assert.equal(groups.length,1);assert.equal(groups[0]!.piece,piece.name)
  assert.equal(groups[0]!.entries.filter(e=>e.kind!=='pending'&&e.kind!=='warning').length,plan.changes.length)
  assert(groups[0]!.entries.filter(e=>e.kind!=='pending'&&e.kind!=='warning').every(e=>e.kind==='add'))
  apply()
  const saved=f.commercial.list(f.at.id,f.scenario.id).find(p=>p.pieceId===piece.id)!
  const [parent,line]=groups[0]!.entries
  assert(parent!.fields.some(v=>v.label==='Diagnóstico'&&v.after===diagnosis.name))
  assert(parent!.fields.some(v=>v.label==='Intensidade'&&v.after===saved.intensity))
  assert(parent!.fields.some(v=>v.label==='Observações'&&v.after===saved.notes))
  assert(parent!.fields.some(v=>v.label==='Cenário atual'&&v.after==='Desabilitada'));assert.equal(saved.enabled,false)
  assert(line!.label.includes(f.dimension.name));assert(line!.fields.some(v=>v.after===saved.services[0]!.quantity))
  assert(line!.fields.some(v=>v.after===saved.services[0]!.notes))
  assert.equal(f.commercial.list(f.at.id,other.id).find(p=>p.id===saved.id)!.services[0]!.enabled,false)
 }finally{db.close()}
})
test('compact changes show before/after for diagnosis, intensity, dimension, notes and exact quantity; flags stay scenario-only',()=>{
 const {db,f,prepare}=setup()
 try{
  const diagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'Dano QA'})
  const dimension=f.commercial.saveCatalog({kind:'dimensao',name:'Nova dimensão',serviceId:f.service.id})
  const second=f.scenarios.create(f.at.id,{name:'Outro',duplicateFrom:f.scenario.id,sourceRevision:f.scenarios.list(f.at.id)[0]!.revision})
  const {groups,apply}=prepare([
   {id:'damage',op:'set_diagnosis',intent:'instruction',piece:ref(f.item.pieceId),diagnosis:ref(diagnosis.id),intensity:'leve'},
   {id:'notes',op:'set_notes',intent:'instruction',piece:ref(f.item.pieceId),value:'Nota nova'},
   {id:'dim',op:'set_dimension',intent:'instruction',piece:ref(f.item.pieceId),line:{kind:'id',id:f.item.services[0]!.id},dimension:ref(dimension.id)},
   {id:'qty',op:'set_quantity',intent:'instruction',piece:ref(f.item.pieceId),line:{kind:'id',id:f.item.services[0]!.id},mode:'increment',value:'0.000001'},
   {id:'disable',op:'set_service_enabled',intent:'instruction',piece:ref(f.item.pieceId),line:{kind:'id',id:f.item.services[0]!.id},enabled:false}
  ])
  const fields=groups.flatMap(g=>g.entries.flatMap(e=>e.fields))
  assert(fields.some(v=>v.label==='Dimensão'&&v.before===f.dimension.name&&v.after===dimension.name))
  assert(fields.some(f=>f.label==='Qtd.'&&f.before==='3'&&f.after==='3.000001'))
  assert(fields.some(f=>f.label==='Observações'&&f.before==='Sem observações'&&f.after==='Nota nova'))
  assert(groups[0]!.entries.some(e=>e.kind==='remove'&&e.scope==='scenario'))
  apply()
  const saved=f.commercial.list(f.at.id,f.scenario.id)[0]!
  assert.equal(saved.intensity,'leve');assert.equal(saved.services[0]!.dimensionId,dimension.id);assert.equal(saved.services[0]!.quantity,'3.000001');assert.equal(saved.services[0]!.enabled,false)
  assert.equal(f.commercial.list(f.at.id,second.id)[0]!.services[0]!.enabled,true)
 }finally{db.close()}
})
test('repeated service names remain distinguishable and global removal keeps confirmation',()=>{
 const {db,f,prepare}=setup()
 try{
  const item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'3'},{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'7'}]})
  const removal=prepare([{id:'remove',op:'remove_service',intent:'instruction',piece:ref(item.pieceId),line:{kind:'id',id:item.services[1]!.id}}])
  const entry=removal.groups[0]!.entries[0]!
  assert.equal(entry.scope,'global');assert.equal(entry.kind,'remove');assert.match(entry.label,/linha 2.*7/)
  assert.throws(()=>removal.apply(false));removal.apply(true)
  assert.deepEqual(f.commercial.list(f.at.id)[0]!.services.map(s=>s.id),[item.services[0]!.id])
 }finally{db.close()}
})
test('ambiguous pending commands show entity and reason without appearing as changes, alone or beside valid commands',()=>{
 const {db,f,prepare}=setup()
 try{
  const command:VoiceCommand={id:'unknown',op:'add_service',intent:'instruction',piece:ref(f.item.pieceId),service:{state:'unresolved',text:'Pintura ambígua'},dimension:null}
  const alone=prepare([command])
  assert.equal(alone.plan.changes.length,0);assert.equal(alone.groups[0]!.entries[0]!.kind,'pending');assert.match(alone.groups[0]!.entries[0]!.label,/Pintura ambígua/)
  assert(alone.groups[0]!.entries[0]!.warning)
  const mixed=prepare([command,{id:'notes',op:'set_notes',intent:'instruction',piece:ref(f.item.pieceId),value:'Válida'}])
  assert.deepEqual(mixed.groups[0]!.entries.map(e=>e.kind),['change','pending'])
  mixed.apply();assert.equal(f.commercial.list(f.at.id)[0]!.notes,'Válida');assert.equal(f.commercial.list(f.at.id)[0]!.services.length,1)
 }finally{db.close()}
})
test('service replacement presentation uses authoritative before and after values from the effective patch',()=>{
 const {db,f,prepare}=setup()
 try{
  const alternate=f.commercial.saveCatalog({kind:'servico',name:'Serviço alternativo'})
  const {plan}=prepare([]),context=readVoiceContext(db,f.at.id,f.scenario.id)
  plan.changes=[{op:'update_service',target:{kind:'existing',id:f.item.services[0]!.id},piece:{kind:'existing',id:f.item.id},before:{serviceId:f.service.id},patch:{serviceId:alternate.id},origins:{},impact:{scope:'shared',scenarioIds:[f.scenario.id],invalidatesExecutionConfirmations:true,requiresGlobalRemovalConfirmation:false}}]
  context.workspace.scenarios[0]!.serviceConfirmations={[f.item.services[0]!.id]:'synthetic-scope'}
  const entry=compactVoiceReview(plan,context,[])[0]!.entries[0]!
  assert.equal(entry.kind,'change');assert.deepEqual(entry.fields,[{label:'Serviço',before:f.service.name,after:alternate.name}]);assert(entry.warning)
 }finally{db.close()}
})

test('conflicting instructions are presented as conflicts without inventing a context change',()=>{
 const {db,f,prepare}=setup()
 try{
  const {plan,groups}=prepare([
   {id:'one',op:'set_quantity',intent:'instruction',piece:ref(f.item.pieceId),line:{kind:'id',id:f.item.services[0]!.id},mode:'absolute',value:'4'},
   {id:'two',op:'set_quantity',intent:'instruction',piece:ref(f.item.pieceId),line:{kind:'id',id:f.item.services[0]!.id},mode:'absolute',value:'5'}
  ])
  assert.equal(plan.changes.length,0)
  assert(groups.flatMap(g=>g.entries).every(e=>e.kind==='pending'))
  assert(groups[0]!.entries.some(e=>e.warning?.includes('conflitantes')))
 }finally{db.close()}
})
