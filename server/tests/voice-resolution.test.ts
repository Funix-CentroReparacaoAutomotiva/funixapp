import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {readVoiceContext} from '../voice-context.ts'
import {voiceRevisions} from '../voice-planner.ts'
import {stageVoiceResolution,resolveVoiceOption,clarifyVoiceResolution} from '../voice-resolution.ts'
import {applyVoiceBatch} from '../voice-apply.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import type {VoiceCommand,VoiceCommandBatch} from '../../shared/voice-commands.ts'
import type {VoiceInterpretation} from '../../shared/voice-input.ts'
const ref=(id:string)=>({state:'resolved' as const,id})
const unknown=(text:string)=>({state:'unresolved' as const,text,candidates:[]})
const session='synthetic-resolution-session'
let seq=0
function fixture(){
 const db=openDatabase(':memory:'),f=commercialFixture(db)
 const pair=f.commercial.catalogs().items.filter(p=>p.code==='caixa_de_ar__motorista'||p.code==='caixa_de_ar__passageiro')
 assert.equal(pair.length,2)
 const services=[['Funilaria QA','P'],['Montagem QA','M'],['Pintura completa QA','Completa']].map(([name,dimension])=>{
  const service=f.commercial.saveCatalog({kind:'servico',name}),dim=f.commercial.saveCatalog({kind:'dimensao',name:dimension,serviceId:service.id})
  return {service,dim}
 })
 const commands:VoiceCommand[]=[{id:'piece',op:'add_piece',intent:'instruction',piece:unknown('Caixa de ar')},...services.map(({service,dim},i)=>({id:'service-'+i,op:'add_service' as const,intent:'instruction' as const,piece:unknown('Caixa de ar'),service:ref(service.id),dimension:ref(dim.id),quantity:'1'}))]
 const stage=(commands_:VoiceCommand[]=commands)=>{
  const ctx=readVoiceContext(db,f.at.id,f.scenario.id)
  const batch:VoiceCommandBatch={format:'funix-voice-commands-v1',atendimentoId:f.at.id,scenarioId:f.scenario.id,expected:voiceRevisions(ctx),idempotencyKey:'synthetic-resolution-'+(++seq),commands:commands_}
  return stageVoiceResolution(db,batch,'Caixa de ar, funilaria P, montagem M e pintura completa.',ctx,session,'synthetic-request')
 }
 const choose=(result:VoiceInterpretation,label:string,question=0)=>{
  const option=result.resolution!.questions[question]!.options.find(o=>o.label===label);assert(option,'missing option '+label)
  return resolveVoiceOption(db,f.at.id,{scenarioId:f.scenario.id,resolutionId:result.resolution!.id,optionId:option.id},session,'selected-request')
 }
 const apply=(result:VoiceInterpretation,confirmGlobalRemoval=false)=>applyVoiceBatch(db,f.at.id,{scenarioId:f.scenario.id,idempotencyKey:result.plan.idempotencyKey,confirmGlobalRemoval},session)
 return {db,f,pair,services,commands,stage,choose,apply}
}
for(const label of ['Motorista','Passageiro','Ambos'])test(label+' resolves one piece ambiguity and all three dependent services without writing before confirmation',()=>{
 const h=fixture()
 try{
  const other=h.f.scenarios.create(h.f.at.id,{name:'Outro cenário'})
  const before=h.db.prepare('SELECT total_changes() n').get()!.n
  const root=h.stage()
  assert.equal(root.plan.changes.length,0)
  assert.equal(root.reviewGroups.flatMap(g=>g.entries).filter(e=>e.pendingId).length,1)
  assert.deepEqual(root.resolution!.questions[0]!.options.map(o=>o.label).sort(),['Ambos','Motorista','Passageiro'])
  const result=h.choose(root,label)
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before)
  assert.equal(result.transcription,root.transcription)
  assert.equal(result.plan.changes.filter(c=>c.op==='add_service').length,label==='Ambos'?6:3)
  assert.equal(result.plan.results.filter(r=>r.status==='pending').length,0)
  h.apply(result);assert.equal(h.apply(result).replay,true)
  const added=h.f.commercial.list(h.f.at.id,h.f.scenario.id).filter(p=>h.pair.some(c=>c.id===p.pieceId))
  assert.equal(added.length,label==='Ambos'?2:1)
  for(const p of added){assert.equal(p.services.length,3);assert.equal(new Set(p.services.map(l=>l.id)).size,3);assert(p.services.every(l=>l.enabled));assert(p.enabled)}
  for(const p of h.f.commercial.list(h.f.at.id,other.id).filter(p=>added.some(a=>a.id===p.id))){assert.equal(p.enabled,false);assert(p.services.every(l=>!l.enabled))}
  if(label!=='Ambos')assert.equal(h.pair.find(c=>c.id===added[0]!.pieceId)!.side,label.toLowerCase())
 }finally{h.db.close()}
})
test('both preserves existing service identities without duplicating them; old plans and old options are superseded',()=>{
 const h=fixture()
 try{
  const catalog=h.pair.find(p=>p.side==='motorista')!,piece=h.f.commercial.add(h.f.at.id,{pieceCodes:[catalog.code]}).find(p=>p.pieceId===catalog.id)!
  const previous=h.f.commercial.updateDiagnosis(h.f.at.id,piece.id,{revision:piece.revision,services:[{serviceId:h.services[0]!.service.id,dimensionId:h.services[0]!.dim.id,quantity:'1'}]})
  const root=h.stage([{id:'increment',op:'set_quantity',intent:'instruction',piece:ref(h.f.item.pieceId),line:{kind:'id',id:h.f.item.services[0]!.id},mode:'increment',value:'1'},...h.commands])
  const result=h.choose(root,'Ambos')
  assert.throws(()=>h.apply(root))
  assert.throws(()=>h.choose(root,'Motorista'))
  h.apply(result)
  const saved=h.f.commercial.list(h.f.at.id).find(p=>p.id===piece.id)!
  assert.equal(saved.services.length,3);assert.equal(saved.services[0]!.id,previous.services[0]!.id)
  assert.equal(h.f.commercial.list(h.f.at.id).find(p=>p.id===h.f.item.id)!.services[0]!.quantity,'4')
 }finally{h.db.close()}
})
test('unpaired pieces and concrete service-line IDs never offer an unsafe Ambos choice',()=>{
 const h=fixture()
 try{
  const root=h.stage([{id:'quantity',op:'set_quantity',intent:'instruction',piece:unknown('Caixa de ar'),line:{kind:'id',id:h.f.item.services[0]!.id},mode:'absolute',value:'2'}])
  assert(!root.resolution!.questions[0]!.options.some(o=>o.label==='Ambos'))
  const one=h.stage([{id:'piece',op:'add_piece',intent:'instruction',piece:unknown('Capô')}])
  assert(!one.resolution!.questions[0]!.options.some(o=>o.label==='Ambos'))
 }finally{h.db.close()}
})
test('service, dimension and diagnosis are selected sequentially from active relationship-correct catalogs',()=>{
 const h=fixture()
 try{
  const service=h.services[0]!,other=h.f.commercial.saveCatalog({kind:'servico',name:'Funilaria alternativa QA'})
  const wrong=h.f.commercial.saveCatalog({kind:'dimensao',name:'P',serviceId:other.id})
  const diagnosis=h.f.commercial.saveCatalog({kind:'diagnostico',name:'Dano preciso QA'})
  let root=h.stage([
   {id:'add',op:'add_service',intent:'instruction',piece:ref(h.f.item.pieceId),service:unknown('Funilaria'),dimension:unknown('P')},
   {id:'damage',op:'set_diagnosis',intent:'instruction',piece:ref(h.f.item.pieceId),diagnosis:unknown('Dano preciso')}
  ])
  root=h.choose(root,service.service.name)
  const dimQuestion=root.resolution!.questions.findIndex(q=>q.label==='Dimensão')
  assert.equal(root.resolution!.questions[dimQuestion]!.options.length,1)
  root=h.choose(root,service.dim.name,dimQuestion)
  root=h.choose(root,diagnosis.name,root.resolution!.questions.findIndex(q=>q.label==='Diagnóstico'))
  h.apply(root)
  const saved=h.f.commercial.list(h.f.at.id)[0]!
  assert.equal(saved.diagnosisId,diagnosis.id);assert(saved.services.some(l=>l.dimensionId===service.dim.id));assert(!saved.services.some(l=>l.dimensionId===wrong.id))
 }finally{h.db.close()}
})
test('repeated line resolution selects the exact existing row and global deletion still needs confirmation',()=>{
 const h=fixture()
 try{
  const item=h.f.commercial.updateDiagnosis(h.f.at.id,h.f.item.id,{revision:h.f.item.revision,services:[{serviceId:h.f.service.id,dimensionId:h.f.dimension.id,quantity:'3'},{serviceId:h.f.service.id,dimensionId:h.f.dimension.id,quantity:'7'}]})
  const root=h.stage([{id:'remove',op:'remove_service',intent:'instruction',piece:ref(item.pieceId),line:{kind:'service',service:ref(h.f.service.id)}}])
  assert.equal(root.resolution!.questions[0]!.options.length,2)
  const result=h.choose(root,root.resolution!.questions[0]!.options[1]!.label)
  assert.throws(()=>h.apply(result));h.apply(result,true)
  assert.deepEqual(h.f.commercial.list(h.f.at.id)[0]!.services.map(l=>l.id),[item.services[0]!.id])
 }finally{h.db.close()}
})
test('false options, foreign session/scenario, tampered IDs and catalog changes are rejected without writes',()=>{
 const h=fixture()
 try{
  const root=h.stage(),option=root.resolution!.questions[0]!.options[0]!,body={scenarioId:h.f.scenario.id,resolutionId:root.resolution!.id,optionId:option.id}
  const before=h.db.prepare('SELECT total_changes() n').get()!.n
  for(const payload of [{...body,optionId:h.pair[0]!.id},{...body,commands:[]},{...body,pieceId:h.pair[0]!.id}])assert.throws(()=>resolveVoiceOption(h.db,h.f.at.id,payload,session,'bad'))
  assert.throws(()=>resolveVoiceOption(h.db,h.f.at.id,body,'foreign-session','bad'))
  assert.throws(()=>resolveVoiceOption(h.db,h.f.at.id,{...body,scenarioId:'foreign'},session,'bad'))
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before)
  h.f.commercial.saveCatalog({revision:h.pair[0]!.revision,active:false},h.pair[0]!.id)
  assert.throws(()=>h.choose(root,option.label),(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='VOICE_CONTEXT_STALE')
  const inactive=h.stage()
  assert(!inactive.resolution!.questions[0]!.options.some(o=>o.label==='Ambos'))
 }finally{h.db.close()}
})
test('no trustworthy match offers no guesses; apply anyway writes only independent safe changes, never mandatory null IDs',()=>{
 const h=fixture()
 try{
  const pending:VoiceCommand={id:'unknown',op:'add_piece',intent:'instruction',piece:unknown('Peça inexistente XYZ')}
  const only=h.stage([pending]);assert.equal(only.resolution!.questions[0]!.options.length,0)
  const before=h.db.prepare('SELECT total_changes() n').get()!.n
  assert.throws(()=>h.apply(only));assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before)
  const mixed=h.stage([pending,{id:'note',op:'set_notes',intent:'instruction',piece:ref(h.f.item.pieceId),value:'Independente'}])
  assert.deepEqual(h.apply(mixed).handledCommandIds,['note'])
  assert.equal(h.f.commercial.list(h.f.at.id).length,1);assert.equal(h.f.commercial.list(h.f.at.id)[0]!.notes,'Independente')
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{h.db.close()}
})
test('clarification retains original safe instructions; unrelated or ambiguous speech cannot alter operations',()=>{
 const h=fixture()
 try{
  const root=h.stage([{id:'note',op:'set_notes',intent:'instruction',piece:ref(h.f.item.pieceId),value:'Original preservado'},...h.commands])
  const question=root.resolution!.questions[0]!
  assert.throws(()=>clarifyVoiceResolution(h.db,h.f.at.id,h.f.scenario.id,root.resolution!.id,question.id,'exclua tudo e emita PDF',session,'bad'))
  const result=clarifyVoiceResolution(h.db,h.f.at.id,h.f.scenario.id,root.resolution!.id,question.id,'lado do motorista',session,'clarified')
  assert.equal(result.transcription,root.transcription)
  h.apply(result);assert.equal(h.f.commercial.list(h.f.at.id).find(p=>p.id===h.f.item.id)!.notes,'Original preservado')
 }finally{h.db.close()}
})
test('resolution expiry, rollback on last operation and immutable issued budgets remain protected',async()=>{
 const h=fixture()
 try{
  const budgets=new BudgetRepository(h.db),request={scenarioId:h.f.scenario.id,negotiation:{mode:'none' as const}},preview=budgets.preview(h.f.at.id,request)
  const issued=await budgets.emit(h.f.at.id,{...request,previewToken:preview.token,idempotencyKey:'resolution-budget-before'})
  const pdf=budgets.pdf(h.f.at.id,issued.id),snapshot=budgets.get(h.f.at.id,issued.id)
  const root=h.stage(),now=Date.now
  try{Date.now=()=>now()+16*60_000;assert.throws(()=>h.choose(root,'Motorista'))}finally{Date.now=now}
  const next=h.stage(),result=h.choose(next,'Ambos')
  h.db.exec(`CREATE TRIGGER fail_voice_resolution BEFORE INSERT ON diagnosis_services WHEN NEW.service_id='${h.services[2]!.service.id}' BEGIN SELECT RAISE(ABORT,'synthetic failure');END;`)
  assert.throws(()=>h.apply(result));assert.equal(h.f.commercial.list(h.f.at.id).length,1)
  assert.equal(h.db.prepare('SELECT count(*) n FROM voice_apply_receipts').get()!.n,0)
  h.db.exec('DROP TRIGGER fail_voice_resolution');h.apply(result)
  assert.deepEqual(budgets.pdf(h.f.at.id,issued.id),pdf);assert.deepEqual(budgets.get(h.f.at.id,issued.id),snapshot)
 }finally{h.db.close()}
})

test('nullable dimension remains a visible incomplete draft and blocks emission; required service IDs are never null',()=>{
 const h=fixture()
 try{
  const service=h.services[0]!,settings=h.f.pricing.get(),template=settings.config.services[0]!
  settings.config.services.push({...template,serviceId:service.service.id,dimensions:[{...template.dimensions[0]!,dimensionId:service.dim.id}]})
  h.f.pricing.save({revision:settings.revision,config:settings.config})
  const result=h.stage([{id:'draft',op:'add_service',intent:'instruction',piece:ref(h.f.item.pieceId),service:ref(service.service.id),dimension:null}])
  assert(result.reviewGroups.flatMap(g=>g.entries).some(e=>e.kind==='warning'&&e.pendingId))
  h.apply(result)
  const saved=h.f.commercial.list(h.f.at.id)[0]!.services.find(l=>l.serviceId===service.service.id)!
  assert.equal(saved.dimensionId,null);assert.equal(saved.serviceId,service.service.id)
  assert.equal(new BudgetRepository(h.db).preview(h.f.at.id,{scenarioId:h.f.scenario.id,negotiation:{mode:'none'}}).canEmit,false)
 }finally{h.db.close()}
})
test('Falar can select an exact real catalog name when the original text offers no trustworthy alternatives',()=>{
 const h=fixture()
 try{
  const root=h.stage([{id:'new',op:'add_service',intent:'instruction',piece:ref(h.f.item.pieceId),service:unknown('serviço incompreensível XYZ'),dimension:ref(h.services[0]!.dim.id)}])
  assert.equal(root.resolution!.questions[0]!.options.length,0)
  assert.throws(()=>clarifyVoiceResolution(h.db,h.f.at.id,h.f.scenario.id,root.resolution!.id,root.resolution!.questions[0]!.id,h.services[1]!.service.name,session,'wrong-relation'))
  const result=clarifyVoiceResolution(h.db,h.f.at.id,h.f.scenario.id,root.resolution!.id,root.resolution!.questions[0]!.id,h.services[0]!.service.name,session,'exact-real-name')
  h.apply(result);assert(h.f.commercial.list(h.f.at.id)[0]!.services.some(l=>l.serviceId===h.services[0]!.service.id))
 }finally{h.db.close()}
})

test('a missing mandatory service reference offers no invented identity and can be repaired only by a real exact name',()=>{
 const h=fixture()
 try{
  const root=h.stage([{id:'missing',op:'add_service',intent:'instruction',piece:ref(h.f.item.pieceId),service:ref('invented-service'),dimension:ref(h.services[0]!.dim.id)}])
  assert.equal(root.plan.changes.length,0);assert.equal(root.resolution!.questions[0]!.options.length,0)
  const result=clarifyVoiceResolution(h.db,h.f.at.id,h.f.scenario.id,root.resolution!.id,root.resolution!.questions[0]!.id,h.services[0]!.service.name,session,'exact-name')
  h.apply(result);assert(h.f.commercial.list(h.f.at.id)[0]!.services.some(l=>l.serviceId===h.services[0]!.service.id))
 }finally{h.db.close()}
})
test('an existing inactive physical piece is preserved while resolving a service, rather than asking to replace the piece',()=>{
 const h=fixture()
 try{
  const piece=h.f.commercial.catalogs().items.find(c=>c.id===h.f.item.pieceId)!
  h.f.commercial.saveCatalog({revision:piece.revision,active:false},piece.id)
  const root=h.stage([{id:'service',op:'add_service',intent:'instruction',piece:ref(piece.id),service:unknown('Funilaria'),dimension:ref(h.services[0]!.dim.id)}])
  assert.equal(root.resolution!.questions[0]!.label,'Serviço')
  const result=h.choose(root,h.services[0]!.service.name);h.apply(result)
  assert.equal(h.f.commercial.list(h.f.at.id)[0]!.id,h.f.item.id);assert.equal(h.f.commercial.list(h.f.at.id)[0]!.services.length,2)
 }finally{h.db.close()}
})

test('identical catalog names need real distinguishing data: physical codes differ, indistinguishable services are not guessed',()=>{
 const h=fixture()
 try{
  for(const code of ['qa-physical-a','qa-physical-b'])h.f.commercial.saveCatalog({kind:'peca',code,name:'Peça duplicada QA'})
  const pieces=h.stage([{id:'piece',op:'add_piece',intent:'instruction',piece:unknown('Peça duplicada QA')}])
  const options=pieces.resolution!.questions[0]!.options
  assert.equal(options.length,2);assert.equal(new Set(options.map(o=>o.label)).size,2);assert(options.every(o=>o.label.includes('qa-physical-')))
  for(let i=0;i<2;i++)h.f.commercial.saveCatalog({kind:'servico',name:'Serviço indistinto QA'})
  const services=h.stage([{id:'service',op:'add_service',intent:'instruction',piece:ref(h.f.item.pieceId),service:unknown('Serviço indistinto QA'),dimension:null}])
  assert.equal(services.resolution!.questions[0]!.options.length,0)
  assert.throws(()=>clarifyVoiceResolution(h.db,h.f.at.id,h.f.scenario.id,services.resolution!.id,services.resolution!.questions[0]!.id,'Serviço indistinto QA',session,'ambiguous-name'))
 }finally{h.db.close()}
})
