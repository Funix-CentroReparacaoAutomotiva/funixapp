import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {ComponentRepository} from '../components.ts'
import {readVoiceContext,modelVoiceContext} from '../voice-context.ts'
import {stageVoiceResolution,resolveVoiceOption,clarifyVoiceResolution,reviseVoiceComponent} from '../voice-resolution.ts'
import {applyVoiceBatch} from '../voice-apply.ts'
import {planVoiceCommands,voiceRevisions} from '../voice-planner.ts'
import {validateVoiceCommands} from '../voice-command-validation.ts'
import {convertVoiceModelOutput} from '../voice-model-contract.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {calculate} from '../pricing-engine.ts'
import {diagnosticHistory,copiedVoiceDiagnostic} from '../../shared/voice-diagnostic.ts'
import type {VoiceCommand,VoiceReference} from '../../shared/voice-commands.ts'
import type {VoiceInterpretation} from '../../shared/voice-input.ts'
const ref=(id:string)=>({state:'resolved' as const,id}),unknown=(text:string)=>({state:'unresolved' as const,text,candidates:[]})
const session='synthetic-components-voice';let sequence=0
function fixture(path=':memory:'){
 const db=openDatabase(path),f=commercialFixture(db),components=new ComponentRepository(db)
 const front=f.commercial.catalogs().items.find(p=>p.code==='para_choque_dianteiro')!,pair=f.commercial.catalogs().items.filter(p=>p.code==='caixa_de_ar__motorista'||p.code==='caixa_de_ar__passageiro')
 const context=()=>readVoiceContext(db,f.at.id,f.scenario.id)
 const component=(id='component',piece:VoiceReference=ref(f.item.pieceId),extra:Record<string,unknown>={}):VoiceCommand=>({id,op:'add_component',intent:'instruction',piece,name:'Guia dianteiro esquerdo',...extra}) as VoiceCommand
 const stage=(commands:VoiceCommand[]=[component()])=>{const ctx=context();return stageVoiceResolution(db,{format:'funix-voice-commands-v1',atendimentoId:f.at.id,scenarioId:f.scenario.id,idempotencyKey:'synthetic-component-'+(++sequence),expected:voiceRevisions(ctx),commands},'No para-choque dianteiro adiciona o guia dianteiro esquerdo.',ctx,session,'synthetic-component-request')}
 const choose=(r:VoiceInterpretation,label:string)=>{const o=r.resolution!.questions.flatMap(q=>q.options).find(o=>o.label===label);assert(o,'Missing '+label);return resolveVoiceOption(db,f.at.id,{scenarioId:f.scenario.id,resolutionId:r.resolution!.id,optionId:o.id},session,'component-choice')}
 const edit=(r:VoiceInterpretation,quantity:string,manualPrice:string,commandId='component')=>reviseVoiceComponent(db,f.at.id,{scenarioId:f.scenario.id,resolutionId:r.resolution!.id,commandId,quantity,manualPrice},session,'component-edit')
 const apply=(r:VoiceInterpretation,confirmGlobalRemoval=false)=>applyVoiceBatch(db,f.at.id,{scenarioId:f.scenario.id,idempotencyKey:r.plan.idempotencyKey,confirmGlobalRemoval},session)
 const existing=(name='Guia dianteiro esquerdo',price='99')=>components.save(f.at.id,{pieceId:f.item.id,name,quantity:'4',manualPrice:price,notes:'Nota manual QA',scenarioId:f.scenario.id})
 return {db,f,front,pair,components,context,component,stage,choose,edit,apply,existing}
}
test('Issue64 existing exact diagnosis item: omitted values persist literally 1/0 and flags only in active scenario',()=>{
 const h=fixture()
 try{
  const other=h.f.scenarios.create(h.f.at.id,{name:'Outro QA'}),before=h.db.prepare('SELECT total_changes() n').get()!.n
  const r=h.stage();assert.equal(r.plan.changes.length,1);assert.equal(r.plan.changes[0]!.op,'add_component')
  const c=r.plan.changes[0]!;assert(c.op==='add_component');assert.equal(c.piece.id,h.f.item.id);assert.deepEqual(c.values,{name:'Guia dianteiro esquerdo',quantity:'1',manualPrice:'0',notes:''})
  const entry=r.reviewGroups.flatMap(g=>g.entries).find(e=>e.component)!
  assert.equal(entry.component!.manualPrice,'0');assert.equal(entry.label,c.values.name)
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before)
  h.apply(r);assert.equal(h.apply(r).replay,true)
  const saved=h.components.list(h.f.at.id)[0]!;assert.equal(saved.pieceId,h.f.item.id);assert.equal(saved.manualPrice,'0');assert.equal(saved.quantity,'1')
  const scenes=h.f.scenarios.list(h.f.at.id);assert.equal(scenes.find(s=>s.id===h.f.scenario.id)!.componentFlags[saved.id],true);assert.equal(scenes.find(s=>s.id===other.id)!.componentFlags[saved.id],false)
 }finally{h.db.close()}
})
test('Issue64 absent physical piece is visibly proposed once with multiple distinct components and services',()=>{
 const h=fixture()
 try{
  const piece=ref(h.front.id),r=h.stage([h.component('guide',piece),h.component('fastener',piece,{name:'Parafuso fixador'}),{id:'service',op:'add_service',intent:'instruction',piece,service:ref(h.f.service.id),dimension:ref(h.f.dimension.id)}])
  assert.equal(r.plan.changes.filter(c=>c.op==='add_piece').length,1);assert.equal(r.plan.changes.filter(c=>c.op==='add_service').length,1);assert.equal(r.plan.changes.filter(c=>c.op==='add_component').length,2)
  assert(r.reviewGroups.flatMap(g=>g.entries).some(e=>e.kind==='add'&&e.label==='Peça'))
  assert.equal(h.f.commercial.list(h.f.at.id).length,1);h.apply(r)
  const parent=h.f.commercial.list(h.f.at.id).find(p=>p.pieceId===h.front.id)!
  assert.equal(parent.services.length,1);assert(h.components.list(h.f.at.id).every(c=>c.pieceId===parent.id))
  assert.deepEqual(h.components.list(h.f.at.id).map(c=>c.name),['Guia dianteiro esquerdo','Parafuso fixador'])
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{h.db.close()}
})
for(const label of ['Motorista','Passageiro','Ambos'])for(const voice of [false,true])test('Issue64 '+label+' via '+(voice?'Falar':'option')+' preserves the component and only creates missing physical identities',()=>{
 const h=fixture()
 try{
  const passenger=h.pair.find(p=>p.side==='passageiro')!;h.f.commercial.add(h.f.at.id,{pieceCodes:[passenger.code]})
  const r=h.stage([h.component('component',unknown('Caixa de ar'))]),before=h.db.prepare('SELECT total_changes() n').get()!.n
  assert.equal(r.plan.changes.length,0)
  const chosen=voice?clarifyVoiceResolution(h.db,h.f.at.id,h.f.scenario.id,r.resolution!.id,r.resolution!.questions[0]!.id,label,session,'speech'):h.choose(r,label)
  assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before)
  assert.equal(chosen.plan.changes.filter(c=>c.op==='add_piece').length,label==='Passageiro'?0:1)
  assert.equal(chosen.plan.changes.filter(c=>c.op==='add_component').length,label==='Ambos'?2:1)
  h.apply(chosen);const saved=h.components.list(h.f.at.id)
  assert.equal(saved.length,label==='Ambos'?2:1);assert.equal(new Set(saved.map(c=>c.pieceId)).size,saved.length)
 }finally{h.db.close()}
})
test('Issue64 edits replan read-only with exact decimals and invalidate old review/application keys',()=>{
 const h=fixture()
 try{
  const r=h.stage(),before=h.db.prepare('SELECT total_changes() n').get()!.n
  const edited=h.edit(r,'2','35.90');assert.equal(h.db.prepare('SELECT total_changes() n').get()!.n,before)
  assert.notEqual(edited.plan.idempotencyKey,r.plan.idempotencyKey);assert.throws(()=>h.apply(r));assert.throws(()=>h.edit(r,'4','2'))
  const c=edited.plan.changes[0]!;assert(c.op==='add_component');assert.equal(c.values.quantity,'2');assert.equal(c.values.manualPrice,'35.9')
  h.apply(edited);const saved=h.components.list(h.f.at.id)[0]!;assert.equal(saved.quantity,'2');assert.equal(saved.manualPrice,'35.9')
  const calc=calculate(h.f.commercial.list(h.f.at.id),h.components.list(h.f.at.id),h.f.commercial.catalogs().items,h.f.scenarios.list(h.f.at.id)[0]!,h.f.pricing.get().config,h.f.pricing.settings(h.f.at.id).settings)
  assert.equal(calc.componentSubtotal,'143.6')
 }finally{h.db.close()}
})
test('Issue64 component numeric domain matches repository: fractional and maximum values without floats, invalid drafts cannot write',()=>{
 const h=fixture()
 try{
  const r=h.stage()
  for(const [q,p] of [['0','0'],['-1','0'],['1','-1'],['1e2','1'],['1','1e2'],['1.0000001','1'],['1000000000000','1'],['1','1000000000000'],['1',''],['1','1,2'],['1','null']])assert.throws(()=>h.edit(r,q!,p!))
  const edited=h.edit(r,'0002.125000','999999999999.123456');h.apply(edited)
  assert.equal(h.components.list(h.f.at.id)[0]!.quantity,'2.125');assert.equal(h.components.list(h.f.at.id)[0]!.manualPrice,'999999999999.123456')
  const invalid=h.stage([h.component('invalid',ref(h.front.id),{quantity:'0',manualPrice:'-2'})])
  assert.equal(invalid.plan.changes.length,0);assert.throws(()=>h.apply(invalid))
  const fixed=h.edit(invalid,'1','0','invalid');assert.equal(fixed.plan.changes.filter(c=>c.op==='add_piece').length,1);h.apply(fixed)
 }finally{h.db.close()}
})
for(const similar of ['Guia dianteiro esquerdo','guia dianteiro esquerdo!','Guia dianteiro esqurdo','Esquerdo guia dianteiro'])test('Issue64 possible duplicate '+similar+' requires explicit keep/new and never changes existing price',()=>{
 const h=fixture()
 try{
  const old=h.existing(),root=h.stage([h.component('component',ref(h.f.item.pieceId),{name:similar})])
  assert.equal(root.plan.changes.length,0);assert(root.plan.issues.some(i=>i.code==='DUPLICATE_COMPONENT'))
  const pending=root.reviewGroups.flatMap(g=>g.entries).find(e=>e.kind==='pending')!;assert.equal(pending.label,similar);assert(pending.fields.some(f=>f.label==='Já cadastrado'&&f.after.includes('qtd. 4')&&f.after.includes('R$ 99')))
  const kept=h.choose(root,'Manter existente');assert.equal(kept.plan.changes.length,0);assert(kept.plan.results.some(r=>r.reason==='COMPONENT_KEPT'));assert.throws(()=>h.apply(kept))
  const next=h.choose(h.stage([h.component('component',ref(h.f.item.pieceId),{name:similar})]),'Adicionar outro')
  h.apply(next);assert.equal(h.components.list(h.f.at.id).length,2);assert.deepEqual(h.components.list(h.f.at.id).find(c=>c.id===old.id),old)
 }finally{h.db.close()}
})
test('Issue64 duplicate in the same dictation keeps command identity through edits; independent valid additions remain applicable',()=>{
 const h=fixture()
 try{
  const root=h.stage([h.component('one'),h.component('two'),h.component('three',ref(h.f.item.pieceId),{name:'Parafuso fixador'})])
  assert.equal(root.plan.changes.length,2)
  const chosen=h.choose(root,'Adicionar outro'),edited=h.edit(chosen,'2','3.50','two')
  assert.equal(edited.plan.changes.length,3);h.apply(edited);assert.equal(h.components.list(h.f.at.id).length,3)
  const partial=h.stage([h.component('pending'),h.component('independent',ref(h.f.item.pieceId),{name:'Arruela de apoio'})])
  assert.equal(partial.plan.changes.length,1);h.apply(partial);assert.equal(h.components.list(h.f.at.id).length,4)
 }finally{h.db.close()}
})
test('Issue64 same component name on another piece is not a duplicate; component descriptions are never resolved as physical/catalog IDs',()=>{
 const h=fixture()
 try{
  h.existing();const r=h.stage([h.component('other',ref(h.front.id)),h.component('name-is-piece',ref(h.front.id),{name:'Para-choque traseiro'})]);h.apply(r)
  const parent=h.f.commercial.list(h.f.at.id).find(p=>p.pieceId===h.front.id)!
  assert.equal(h.components.list(h.f.at.id).filter(c=>c.pieceId===parent.id).length,2)
  assert.equal(h.f.commercial.list(h.f.at.id).length,2)
 }finally{h.db.close()}
})
test('Issue64 no orphan or implicit reversal of physical removal, invalid name, wrong reference or extra unsupported component operations',()=>{
 const h=fixture()
 try{
  for(const command of [h.component('blank',ref(h.front.id),{name:'  '}),h.component('long',ref(h.front.id),{name:'a'.repeat(251)}),h.component('control',ref(h.front.id),{name:'guia\u0000'}),h.component('bad',ref(h.f.service.id)),h.component('missing',ref('nonexistent-piece'))]){
   const r=h.stage([command]);assert.equal(r.plan.changes.length,0);assert.throws(()=>h.apply(r))
  }
  const r=h.stage([{id:'remove',op:'remove_piece',intent:'instruction',piece:ref(h.front.id)},h.component('part',ref(h.front.id))]);assert.equal(r.plan.changes.length,0)
  const ctx=h.context(),batch={format:'funix-voice-commands-v1',atendimentoId:h.f.at.id,scenarioId:h.f.scenario.id,idempotencyKey:'synthetic-invalid-components',expected:voiceRevisions(ctx),commands:[{id:'bad',op:'update_component',intent:'instruction',piece:ref(h.f.item.pieceId),manualPrice:'0'}]}
  assert(validateVoiceCommands(batch).invalidIndexes.length);assert.equal(planVoiceCommands(batch,ctx).changes.length,0)
  assert.throws(()=>convertVoiceModelOutput({commands:[{...h.component(),quantity:'1',manualPrice:'0',duplicateDecision:{mode:'new',references:['fake']}}]}))
 }finally{h.db.close()}
})
test('Issue64 bound edit contract rejects fake IDs/session/scenario/extra fields, expired or stale context, including component changes',()=>{
 const h=fixture()
 try{
  const old=h.existing('Parafuso'),r=h.stage(),body={scenarioId:h.f.scenario.id,resolutionId:r.resolution!.id,commandId:'component',quantity:'2',manualPrice:'0'}
  for(const value of [{...body,pieceId:h.front.id},{...body,commandId:old.id},{...body,scenarioId:'foreign'}])assert.throws(()=>reviseVoiceComponent(h.db,h.f.at.id,value,session,'bad'))
  assert.throws(()=>reviseVoiceComponent(h.db,h.f.at.id,body,'foreign','bad'))
  const now=Date.now
  try{Date.now=()=>now()+16*60_000;assert.throws(()=>h.edit(r,'2','0'));assert.throws(()=>h.apply(r))}finally{Date.now=now}
  const fresh=h.stage();h.components.save(h.f.at.id,{revision:old.revision,pieceId:old.pieceId,name:old.name,quantity:old.quantity,manualPrice:'100',scenarioId:h.f.scenario.id,notes:old.notes},old.id)
  assert.throws(()=>h.edit(fresh,'2','0'));assert.throws(()=>h.apply(fresh))
 }finally{h.db.close()}
})
test('Issue64 failure on last component rolls back pieces, services, earlier components, revisions and receipt; prior snapshot/PDF immutable',async()=>{
 const h=fixture()
 try{
  const b=new BudgetRepository(h.db),request={scenarioId:h.f.scenario.id,negotiation:{mode:'none' as const}},preview=b.preview(h.f.at.id,request)
  const issued=await b.emit(h.f.at.id,{...request,previewToken:preview.token,idempotencyKey:'synthetic-components-budget'}),snapshot=b.get(h.f.at.id,issued.id),pdf=b.pdf(h.f.at.id,issued.id)
  const source=ref(h.front.id),r=h.stage([h.component('one',source),{id:'service',op:'add_service',intent:'instruction',piece:source,service:ref(h.f.service.id),dimension:ref(h.f.dimension.id)},h.component('last',source,{name:'Falha final QA'})]),before=h.context()
  h.db.exec("CREATE TRIGGER component_failure BEFORE INSERT ON component_items WHEN NEW.name='Falha final QA' BEGIN SELECT RAISE(ABORT,'synthetic failure');END;")
  assert.throws(()=>h.apply(r));assert.deepEqual(h.context(),before);assert.equal(h.components.list(h.f.at.id).length,0);assert.equal(h.db.prepare('SELECT count(*) n FROM voice_apply_receipts').get()!.n,0)
  h.db.exec('DROP TRIGGER component_failure');h.apply(r);assert.equal(h.apply(r).replay,true)
  assert.deepEqual(b.get(h.f.at.id,issued.id),snapshot);assert.deepEqual(b.pdf(h.f.at.id,issued.id),pdf)
 }finally{h.db.close()}
})
test('Issue64 durable receipt survives response loss/restart without another component',()=>{
 const folder=mkdtempSync(join(tmpdir(),'funix-voice-components-')),path=join(folder,'test.sqlite'),h=fixture(path)
 const result=h.stage(),at=h.f.at.id,scene=h.f.scenario.id,key=result.plan.idempotencyKey!
 try{
  h.apply(result);h.db.close()
  const db=openDatabase(path)
  try{const replay=applyVoiceBatch(db,at,{scenarioId:scene,idempotencyKey:key},session);assert.equal(replay.replay,true);assert.equal(new ComponentRepository(db).list(at).length,1);assert.throws(()=>applyVoiceBatch(db,at,{scenarioId:'foreign',idempotencyKey:key},session))}finally{db.close()}
 }finally{if(h.db.isOpen)h.db.close();rmSync(folder,{recursive:true,force:true})}
})
test('Issue64 copied diagnostic excludes component name, explicit money and private values while keeping type/quantities/status',()=>{
 const h=fixture()
 try{
  const name='Guia <img src=x onerror=alert(1)> ANA_SINTETICA 11988776655 ABC1D23 TOKEN_QA',r=h.stage([h.component('private',ref(h.f.item.pieceId),{name,quantity:'2.125',manualPrice:'9876.54321'})]),history=diagnosticHistory(r.diagnostic!,true),copy=copiedVoiceDiagnostic(history)
  assert(history.some(e=>e.text.includes('ANA_SINTETICA')));for(const value of ['ANA_SINTETICA','11988776655','ABC1D23','TOKEN_QA','9876.54321','manualPrice',name])assert(!copy.includes(value),value)
  assert.match(copy,/add_component/);assert.match(copy,/2.125/)
  assert(!JSON.stringify(modelVoiceContext(h.context())).includes('9876.54321'))
  h.apply(r);assert.equal(h.components.list(h.f.at.id)[0]!.name,name)
 }finally{h.db.close()}
})

test('Issue64 disabled parent preserves its mask and warns the operator instead of silently enabling it',()=>{
 const h=fixture()
 try{
  const scene=h.f.scenarios.list(h.f.at.id)[0]!
  h.f.scenarios.update(h.f.at.id,scene.id,{revision:scene.revision,pieceFlags:{...scene.pieceFlags,[h.f.item.id]:false}})
  const r=h.stage();assert(r.plan.issues.some(i=>i.code==='COMPONENT_PARENT_DISABLED'));h.apply(r)
  const saved=h.components.list(h.f.at.id)[0]!,after=h.f.scenarios.list(h.f.at.id)[0]!
  assert.equal(after.pieceFlags[h.f.item.id],false);assert.equal(after.componentFlags[saved.id],true)
 }finally{h.db.close()}
})
test('Issue64 a newly dictated component counts as content for the existing automatic-recommendation gate',async()=>{
 const {voiceFixture,V}=await import('./fixtures/voice-planner.ts'),ctx=voiceFixture();ctx.workspace.items[0]!.services=[];ctx.workspace.items[0]!.intensity=null
 const batch={format:'funix-voice-commands-v1',atendimentoId:ctx.atendimentoId,scenarioId:ctx.workspace.selectedId,idempotencyKey:'synthetic-component-recommendations',expected:voiceRevisions(ctx),commands:[
  {id:'part',op:'add_component',intent:'instruction',piece:ref(V.rear),name:'Guia QA'},
  {id:'damage',op:'set_diagnosis',intent:'instruction',piece:ref(V.rear),diagnosis:ref(V.dent),intensity:'moderado'}
 ]}
 const plan=planVoiceCommands(batch,ctx)
 assert.equal(plan.changes.filter(c=>c.op==='add_component').length,1);assert.equal(plan.changes.filter(c=>c.op==='add_service').length,0)
 assert(plan.issues.some(i=>i.code==='ASSISTED_RECOMMENDATIONS_REQUIRED'))
})
