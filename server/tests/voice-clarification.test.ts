import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {readVoiceContext} from '../voice-context.ts'
import {voiceRevisions} from '../voice-planner.ts'
import {stageVoiceResolution,resolveVoiceOption,clarifyVoiceResolution} from '../voice-resolution.ts'
import {applyVoiceBatch} from '../voice-apply.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {copiedVoiceDiagnostic,diagnosticHistory,diagnosticQuestions,diagnosticError} from '../../shared/voice-diagnostic.ts'
import type {VoiceInterpretation} from '../../shared/voice-input.ts'
import type {VoiceCommand} from '../../shared/voice-commands.ts'
const ref=(id:string)=>({state:'resolved' as const,id}),unknown=(text:string)=>({state:'unresolved' as const,text,candidates:[]})
let sequence=0
const session='synthetic-issue58'
function fixture(family='para_lama_dianteiro'){
 const db=openDatabase(':memory:'),f=commercialFixture(db)
 const pair=f.commercial.catalogs().items.filter(p=>p.code===family+'__motorista'||p.code===family+'__passageiro')
 assert.equal(pair.length,2)
 const service=f.commercial.saveCatalog({kind:'servico',name:'Funilaria'}),p=f.commercial.saveCatalog({kind:'dimensao',name:'P',serviceId:service.id}),m=f.commercial.saveCatalog({kind:'dimensao',name:'M',serviceId:service.id})
 const paint=f.commercial.saveCatalog({kind:'servico',name:'Pintura'}),complete=f.commercial.saveCatalog({kind:'dimensao',name:'Completa',serviceId:paint.id})
 const add=(side='passageiro',dimension=p.id,repeated=false)=>{
  const physical=pair.find(p=>p.side===side)!,piece=f.commercial.add(f.at.id,{pieceCodes:[physical.code]}).find(p=>p.pieceId===physical.id)!
  return f.commercial.updateDiagnosis(f.at.id,piece.id,{revision:piece.revision,services:[{serviceId:service.id,dimensionId:dimension,quantity:'3',notes:'PII nota privada QA'},...(repeated?[{serviceId:service.id,dimensionId:m.id,quantity:'7'}]:[])]})
 }
 const commands=(dimension=m.id):VoiceCommand[]=>[
  {id:'funilaria',op:'add_service',intent:'instruction',piece:unknown(family==='caixa_de_ar'?'Caixa de ar':'Para-lama dianteiro'),service:ref(service.id),dimension:ref(dimension)},
  {id:'pintura',op:'add_service',intent:'instruction',piece:unknown(family==='caixa_de_ar'?'Caixa de ar':'Para-lama dianteiro'),service:ref(paint.id),dimension:ref(complete.id)}
 ]
 const stage=(commands_:VoiceCommand[]=commands(),transcription='Para-lama, pode colocar funilaria M e pintura completa.')=>{
  const ctx=readVoiceContext(db,f.at.id,f.scenario.id)
  return stageVoiceResolution(db,{format:'funix-voice-commands-v1',idempotencyKey:'synthetic-issue58-'+(++sequence),atendimentoId:f.at.id,scenarioId:f.scenario.id,expected:voiceRevisions(ctx),commands:commands_},transcription,ctx,session,'synthetic-issue58-request')
 }
 const choose=(r:VoiceInterpretation,label:string)=>{
  const option=r.resolution!.questions.flatMap(q=>q.options).find(o=>o.label===label);assert(option,'Missing '+label)
  return resolveVoiceOption(db,f.at.id,{scenarioId:f.scenario.id,resolutionId:r.resolution!.id,optionId:option.id},session,'issue58-choice')
 }
 const speak=(r:VoiceInterpretation,text:string)=>{
  const question=r.resolution!.questions.find(q=>q.label==='Corrigir serviço'||q.label==='Quantidade')??r.resolution!.questions[0]!
  assert(question)
  return clarifyVoiceResolution(db,f.at.id,f.scenario.id,r.resolution!.id,question.id,text,session,'issue58-speech')
 }
 const apply=(r:VoiceInterpretation,confirmGlobalRemoval=false)=>applyVoiceBatch(db,f.at.id,{scenarioId:f.scenario.id,idempotencyKey:r.plan.idempotencyKey,confirmGlobalRemoval},session)
 return {db,f,pair,service,p,m,paint,complete,add,commands,stage,choose,speak,apply}
}
for(const family of ['para_lama_dianteiro','caixa_de_ar'])test('Issue58 '+family+' resolves physical reference then reviews the existing line dimension without duplication',()=>{
 const h=fixture(family)
 try{
  const before=h.add('passageiro',family==='caixa_de_ar'?h.m.id:h.p.id),target=family==='caixa_de_ar'?h.p.id:h.m.id
  const other=h.f.scenarios.create(h.f.at.id,{name:'Outro QA',duplicateFrom:h.f.scenario.id,sourceRevision:h.f.scenarios.list(h.f.at.id)[0]!.revision})
  const writes=h.db.prepare('SELECT total_changes() n').get()!.n
  const root=h.stage(h.commands(target)),result=h.choose(root,'Passageiro')
  assert(!result.plan.results.some(r=>r.status==='pending'||r.status==='conflict'))
  assert(!result.plan.issues.some(i=>i.code==='EXISTING_SERVICE_DIFFERENT'))
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,writes)
  const change=result.plan.changes.find(c=>c.op==='update_service')!
  assert.equal(change.target.id,before.services[0]!.id)
  assert(change.op==='update_service');assert.deepEqual(change.patch,{dimensionId:target})
  assert(result.reviewGroups.flatMap(g=>g.entries).some(e=>e.fields.some(f=>f.before===(family==='caixa_de_ar'?'M':'P')&&f.after===(family==='caixa_de_ar'?'P':'M'))))
  assert.equal(result.plan.changes.filter(c=>c.op==='add_service').length,1)
  h.apply(result);assert.equal(h.apply(result).replay,true)
  const saved=h.f.commercial.list(h.f.at.id).find(p=>p.id===before.id)!
  assert.equal(saved.services.length,2);assert.equal(saved.services[0]!.id,before.services[0]!.id);assert.equal(saved.services[0]!.quantity,'3');assert.equal(saved.services[0]!.notes,'PII nota privada QA')
  const otherPiece=h.f.commercial.list(h.f.at.id,other.id).find(p=>p.id===before.id)!
  assert.equal(otherPiece.services[0]!.enabled,true);assert.equal(otherPiece.services[1]!.enabled,false)
 }finally{h.db.close()}
})
for(const speech of ['Funilaria P','corrige funilaria para P'])test('Issue58 directed '+speech+' distinguishes transcribed/AI/existing and preserves other intentions',()=>{
 const h=fixture()
 try{
  const piece=h.add(),root=h.stage(h.commands(),'PII Nome QA telefone 11999999999 placa ABC1D23; para-lama Funilaria P e pintura completa.')
  const selected=h.choose(root,'Passageiro')
  assert.equal(selected.diagnostic!.interpreted[0]!.dimension,'M');assert.equal(selected.diagnostic!.existing[0]!.dimension,'P')
  const corrected=h.speak(selected,speech)
  assert.equal(corrected.transcription,root.transcription)
  assert.equal(corrected.diagnostic!.interpreted[0]!.dimension,'M');assert.equal(corrected.diagnostic!.current[0]!.dimension,'P')
  assert.equal(corrected.plan.changes.filter(c=>c.op==='update_service').length,0)
  assert.equal(corrected.plan.changes.filter(c=>c.op==='add_service').length,1)
  assert(corrected.reviewGroups.flatMap(g=>g.entries).some(e=>e.kind==='noop'&&e.fields.some(f=>f.label==='Dimensão'&&f.after==='P')&&e.fields.some(f=>f.label==='Qtd.'&&f.after==='3')))
  assert.throws(()=>h.apply(selected));h.apply(corrected)
  assert.equal(h.f.commercial.list(h.f.at.id).find(p=>p.id===piece.id)!.services[0]!.dimensionId,h.p.id)
 }finally{h.db.close()}
})
test('Issue58 Ambos creates only the missing driver and reconciles the existing passenger',()=>{
 const h=fixture('caixa_de_ar')
 try{
  const before=h.add('passageiro',h.m.id),result=h.choose(h.stage(h.commands(h.p.id)),'Ambos')
  assert.equal(result.plan.changes.filter(c=>c.op==='add_piece').length,1)
  assert.equal(result.plan.changes.filter(c=>c.op==='add_service').length,3)
  assert.equal(result.plan.changes.filter(c=>c.op==='update_service').length,1)
  h.apply(result);const saved=h.f.commercial.list(h.f.at.id)
  assert.equal(saved.find(p=>p.id===before.id)!.services[0]!.id,before.services[0]!.id)
  assert.equal(saved.filter(p=>h.pair.some(c=>c.id===p.pieceId)).flatMap(p=>p.services).length,4)
 }finally{h.db.close()}
})
test('Issue58 identical and omitted dimensions are noop with an explanation; independent changes remain applicable',()=>{
 const h=fixture()
 try{
  const before=h.add(),physical=before.pieceId
  for(const dimension of [ref(h.p.id),null]){
   const only=h.stage([{id:'same',op:'add_service',intent:'instruction',piece:ref(physical),service:ref(h.service.id),dimension}])
   assert.equal(only.plan.changes.length,0);assert.equal(only.outcome!.pending,0);assert.match(only.outcome!.message,/Já está assim/);assert.throws(()=>h.apply(only))
  }
  const result=h.stage([{id:'same',op:'add_service',intent:'instruction',piece:ref(physical),service:ref(h.service.id),dimension:ref(h.p.id)},{id:'note',op:'set_notes',intent:'instruction',piece:ref(h.f.item.pieceId),value:'Independente'}])
  assert.equal(result.plan.changes.length,1);h.apply(result)
 }finally{h.db.close()}
})
test('Issue58 repeated service requires a real line choice before dimension/quantity changes; extra-line intentions stay conservative',()=>{
 const h=fixture()
 try{
  const before=h.add('passageiro',h.p.id,true),physical=ref(before.pieceId)
  const command:VoiceCommand={id:'repeat',op:'add_service',intent:'instruction',piece:physical,service:ref(h.service.id),dimension:ref(h.m.id)}
  const root=h.stage([command]);assert.equal(root.plan.changes.length,0)
  assert(root.resolution!.questions[0]!.options.every(o=>o.label.startsWith('Linha ')))
  const chosen=h.choose(root,root.resolution!.questions[0]!.options[0]!.label)
  h.apply(chosen)
  assert.equal(h.f.commercial.list(h.f.at.id).find(p=>p.id===before.id)!.services.length,2)
  for(const text of ['Outra linha de Funilaria M','Mais uma funilaria M']){
   const extra=h.stage([command],text)
   assert.equal(extra.plan.changes.length,0);assert.equal(extra.resolution!.questions.length,0);assert(extra.outcome!.pending>0)
   assert(extra.reviewGroups.flatMap(g=>g.entries).every(e=>!e.pendingId))
   assert.throws(()=>h.apply(extra))
  }
 }finally{h.db.close()}
})
test('Issue58 directed quantity is absolute and exact, never increments twice; unknown/unsafe speech leaves the staged plan intact',()=>{
 const h=fixture()
 try{
  const before=h.add(),root=h.stage([{id:'service',op:'add_service',intent:'instruction',piece:ref(before.pieceId),service:ref(h.service.id),dimension:ref(h.m.id)}])
  for(const text of ['Funilaria P exclua a peça','corrige funilaria para inexistente','quantidade -2','quantidade 0','quantidade 1000000000','emita orçamento'])assert.throws(()=>h.speak(root,text))
  const result=h.speak(root,'quantidade 2,5'),change=result.plan.changes.find(c=>c.op==='update_service')!
  assert(change.op==='update_service');assert.deepEqual(change.patch,{dimensionId:h.m.id,quantity:'2.5'})
  assert(result.reviewGroups.flatMap(g=>g.entries).some(e=>e.fields.some(f=>f.label==='Qtd.'&&f.before==='3'&&f.after==='2.5')))
  h.apply(result);assert.equal(h.apply(result).replay,true)
  assert.equal(h.f.commercial.list(h.f.at.id).find(p=>p.id===before.id)!.services[0]!.quantity,'2.5')
 }finally{h.db.close()}
})
test('Issue58 invalid dimension/quantity, false choices, conflicts, stale and expiration never become hidden corrections',()=>{
 const h=fixture()
 try{
  const before=h.add(),physical=ref(before.pieceId)
  const base:VoiceCommand={id:'service',op:'add_service',intent:'instruction',piece:physical,service:ref(h.service.id),dimension:ref(h.m.id)}
  const invalid=h.stage([{...base,quantity:'-2'}]);assert.equal(invalid.plan.changes.length,0)
  const wrong=h.stage([{...base,dimension:ref(h.complete.id)}]);assert.equal(wrong.plan.changes.length,0)
  const fixed=h.choose(wrong,'M');assert.equal(fixed.plan.changes.length,1)
  const conflict=h.stage([base,{id:'different',op:'set_dimension',intent:'instruction',piece:physical,line:{kind:'id',id:before.services[0]!.id},dimension:ref(h.p.id)}])
  assert.equal(conflict.plan.changes.length,0);assert(conflict.plan.results.some(r=>r.status==='conflict'))
  assert.throws(()=>resolveVoiceOption(h.db,h.f.at.id,{scenarioId:h.f.scenario.id,resolutionId:fixed.resolution!.id,optionId:h.p.id},session,'false'))
  assert.throws(()=>clarifyVoiceResolution(h.db,h.f.at.id,h.f.scenario.id,fixed.resolution!.id,fixed.resolution!.questions[0]!.id,'P','foreign','foreign'))
  const now=Date.now
  try{Date.now=()=>now()+16*60_000;assert.throws(()=>h.speak(fixed,'P'))}finally{Date.now=now}
  const fresh=h.stage([base]);h.f.commercial.updateDiagnosis(h.f.at.id,before.id,{revision:before.revision,notes:'Concorrente'})
  assert.throws(()=>h.speak(fresh,'P'));assert.throws(()=>h.apply(fresh))
 }finally{h.db.close()}
})
test('Issue58 corrected batch rolls back on its last write and preserves emitted PDF/snapshot; global removal still requires consent',async()=>{
 const h=fixture()
 try{
  const budgets=new BudgetRepository(h.db),request={scenarioId:h.f.scenario.id,negotiation:{mode:'none' as const}},preview=budgets.preview(h.f.at.id,request)
  const issued=await budgets.emit(h.f.at.id,{...request,previewToken:preview.token,idempotencyKey:'synthetic-issue58-budget'})
  const pdf=budgets.pdf(h.f.at.id,issued.id),snapshot=budgets.get(h.f.at.id,issued.id),before=h.add()
  const result=h.choose(h.stage(),'Passageiro')
  h.db.exec("CREATE TRIGGER fail_issue58 BEFORE INSERT ON diagnosis_services BEGIN SELECT RAISE(ABORT,'synthetic');END;")
  assert.throws(()=>h.apply(result));assert.equal(h.f.commercial.list(h.f.at.id).find(p=>p.id===before.id)!.services[0]!.dimensionId,h.p.id)
  h.db.exec('DROP TRIGGER fail_issue58');h.apply(result)
  assert.deepEqual(budgets.pdf(h.f.at.id,issued.id),pdf);assert.deepEqual(budgets.get(h.f.at.id,issued.id),snapshot)
  const removal=h.stage([{id:'remove',op:'remove_piece',intent:'instruction',piece:ref(before.pieceId)}])
  assert.throws(()=>h.apply(removal));h.apply(removal,true)
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{h.db.close()}
})
test('Issue58 diagnostic copy uses a safe projection, not raw transcript, notes, IDs, credentials or payloads',()=>{
 const h=fixture()
 try{
  h.add()
  const result=h.choose(h.stage(h.commands(),'PII Nome QA 11999999999 ABC1D23 token=secret'),'Passageiro')
  const history=diagnosticHistory(result.diagnostic!,true),text=copiedVoiceDiagnostic(history)
  assert.match(history.map(e=>e.text).join('\n'),/IA interpretou.*M/)
  assert.match(text,/add_service/);assert.match(text,/EXISTING_LINE_RECONCILED/);assert.match(text,/update_service/)
  for(const privateValue of ['PII','11999999999','ABC1D23','secret',h.f.at.id,'nota privada',h.f.at.phone])assert(!text.includes(privateValue),privateValue)
  assert.equal(diagnosticError({code:'VOICE_CLARIFICATION_PENDING',status:422,message:'secret'}),'VOICE_CLARIFICATION_PENDING · HTTP 422')
  assert.equal(diagnosticError({code:'token=secret',status:401}),'VOICE_REQUEST_FAILED · HTTP 401')
 }finally{h.db.close()}
})

test('Issue58 unknown dimension cannot partially apply the quantity from the same service intention',()=>{
 const h=fixture()
 try{
  const before=h.add(),root=h.stage([{id:'incomplete',op:'add_service',intent:'instruction',piece:ref(before.pieceId),service:ref(h.service.id),dimension:unknown('Dimensão ainda incerta'),quantity:'2'}])
  assert.equal(root.plan.changes.length,0);assert.throws(()=>h.apply(root))
  const fixed=h.speak(root,'Funilaria M')
  const change=fixed.plan.changes.find(c=>c.op==='update_service')!
  assert(change.op==='update_service');assert.deepEqual(change.patch,{dimensionId:h.m.id,quantity:'2'})
  h.apply(fixed)
 }finally{h.db.close()}
})
test('Issue58 a directed quantity can use an exact spoken positive integer',()=>{
 const h=fixture()
 try{
  const before=h.add(),root=h.stage([{id:'quantity',op:'set_quantity',intent:'instruction',piece:ref(before.pieceId),line:{kind:'id',id:before.services[0]!.id},mode:'absolute',value:'3'}])
  const fixed=h.speak(root,'quantidade duas unidades');h.apply(fixed)
  assert.equal(h.f.commercial.list(h.f.at.id).find(p=>p.id===before.id)!.services[0]!.quantity,'2')
 }finally{h.db.close()}
})

test('Issue58 a missing line without verified alternatives never advertises an unsupported speech target',()=>{
 const h=fixture()
 try{
  const physical=h.pair.find(p=>p.side==='passageiro')!,piece=h.f.commercial.add(h.f.at.id,{pieceCodes:[physical.code]}).find(p=>p.pieceId===physical.id)!
  const result=h.stage([{id:'missing',op:'set_quantity',intent:'instruction',piece:ref(piece.pieceId),line:{kind:'id',id:h.f.item.services[0]!.id},mode:'absolute',value:'2'}])
  assert.equal(result.plan.changes.length,0);assert.equal(result.resolution!.questions.length,0)
  assert(result.reviewGroups.flatMap(g=>g.entries).every(e=>!e.pendingId&&e.warning?.includes('Novo ditado')))
  assert.throws(()=>h.apply(result))
 }finally{h.db.close()}
})
test('Issue58 expanded native-operation limit gives an explicit new-dictation path and preserves independent changes',()=>{
 const h=fixture()
 try{
  const before=h.add()
  const commands:VoiceCommand[]=Array.from({length:80},(_,i)=>({id:'large-'+i,op:'add_service',intent:'instruction',piece:ref(before.pieceId),service:ref(h.service.id),dimension:ref(h.m.id),quantity:'2'}))
  commands.push({id:'safe',op:'set_notes',intent:'instruction',piece:ref(h.f.item.pieceId),value:'Independente'})
  const result=h.stage(commands)
  assert.equal(result.resolution!.questions.length,0);assert.equal(result.plan.changes.length,1)
  assert(result.reviewGroups.flatMap(g=>g.entries).some(e=>e.warning?.includes('ditados menores')))
  h.apply(result);assert.equal(h.f.commercial.list(h.f.at.id).find(p=>p.id===before.id)!.services[0]!.dimensionId,h.p.id)
 }finally{h.db.close()}
})

test('Issue58 commands dependent on a reconciled service keep the same existing line and replay does not increment again',()=>{
 const h=fixture()
 try{
  const before=h.add(),result=h.stage([
   {id:'base',op:'add_service',intent:'instruction',piece:ref(before.pieceId),service:ref(h.service.id),dimension:ref(h.m.id)},
   {id:'increment',op:'set_quantity',intent:'instruction',piece:ref(before.pieceId),line:{kind:'command',commandId:'base'},mode:'increment',value:'1'}
  ])
  assert.equal(result.outcome!.pending,0);h.apply(result);assert.equal(h.apply(result).replay,true)
  const saved=h.f.commercial.list(h.f.at.id).find(p=>p.id===before.id)!.services[0]!
  assert.equal(saved.id,before.services[0]!.id);assert.equal(saved.quantity,'4');assert.equal(saved.dimensionId,h.m.id)
 }finally{h.db.close()}
})

test('Issue58 a catalog answer must not be offered for a blocking operation it cannot repair',()=>{
 const h=fixture()
 try{
  const missing=h.pair.find(p=>p.side==='motorista')!,diagnosis=h.f.commercial.saveCatalog({kind:'diagnostico',name:'Amassado QA'})
  for(const command of [
   {id:'unsupported',op:'set_diagnosis',intent:'instruction',piece:ref(h.f.item.pieceId),diagnosis:unknown(diagnosis.name),additionalDamage:true},
   {id:'missing-parent',op:'set_diagnosis',intent:'instruction',piece:ref(missing.id),diagnosis:unknown(diagnosis.name)}
  ] as VoiceCommand[]){
   const result=h.stage([command])
   assert.equal(result.plan.changes.length,0);assert.equal(result.resolution!.questions.length,0)
   assert(result.reviewGroups.flatMap(g=>g.entries).every(e=>!e.pendingId&&e.warning?.includes('Novo ditado')))
   assert.throws(()=>h.apply(result))
  }
 }finally{h.db.close()}
})


test('PR59 privacy: catalog and option labels containing synthetic PII remain local and never enter the exported diagnostic',()=>{
 const h=fixture()
 try{
  const piece=h.add(),catalog=h.f.commercial.catalogs().items
  const privateValues=['ANA_SINTETICA_PECA 11988776655 ABC1D23 TOKEN_PECA_QA','BRUNO_SINTETICO_SERVICO 21977665544 DEF4G56 TOKEN_SERVICO_QA','CARLA_SINTETICA_DIMENSAO 31966554433 GHI7J89 TOKEN_DIMENSAO_QA']
  for(const [id,privateValue] of [[piece.pieceId,privateValues[0]],[h.service.id,privateValues[1]],[h.m.id,privateValues[2]]] as [string,string][]){
   const item=catalog.find(c=>c.id===id)!;h.f.commercial.saveCatalog({revision:item.revision,name:item.name+' '+privateValue},id)
  }
  const result=h.choose(h.stage(),'Passageiro'),question=result.resolution!.questions.find(q=>q.label==='Corrigir serviço')!
  assert(question.options.some(o=>o.label.includes('CARLA_SINTETICA_DIMENSAO')))
  const history=[...diagnosticHistory(result.diagnostic!,true),...diagnosticQuestions(result.resolution),{text:'Opção escolhida: '+question.options[0]!.label,technical:{type:'option_selected' as const,question:1,option:1}}]
  const visible=history.map(e=>e.text).join('\n'),copied=copiedVoiceDiagnostic(history)
  for(const value of privateValues){assert(visible.includes(value));for(const fragment of value.split(' '))assert(!copied.includes(fragment),fragment)}
  for(const value of [h.f.at.id,piece.id,h.service.id,h.m.id])assert(!copied.includes(value))
  assert(!copied.includes('Funilaria'));assert(!copied.includes('Para-lama'));assert(!copied.includes(question.options[0]!.label))
  assert.match(copied,/option_selected/);assert.match(copied,/EXISTING_LINE_RECONCILED/)
  assert.match(copied,/"dimension":\{"before":\d+,"after":\d+\}/);assert.match(copied,/"quantity":"3"/)
 }finally{h.db.close()}
})
