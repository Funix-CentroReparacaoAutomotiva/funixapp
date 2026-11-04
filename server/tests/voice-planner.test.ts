import test from'node:test'
import{createHash}from'node:crypto'
import assert from'node:assert/strict'
import{readFileSync}from'node:fs'
import{planVoiceCommands,voiceRevisions,voiceContextDigest}from'../voice-planner.ts'
import{validateVoiceCommands}from'../voice-command-validation.ts'
import type{VoicePlanningContext,VoiceChange}from'../../shared/voice-commands.ts'
import{codaServiceId,executionScope}from'../../shared/commercial-curation.ts'
import{voiceFixture,voiceCatalog,V}from'./fixtures/voice-planner.ts'
import{openDatabase}from'../database.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{BudgetRepository}from'./fixtures/budget-renderer.ts'

const ref=(id:string)=>({state:'resolved',id})
const line=(id:string)=>({kind:'id',id})
const cmd=(id:string,op:string,fields:Record<string,unknown>={},intent='instruction')=>({id,op,intent,piece:ref(V.rear),...fields})
const batch=(ctx:VoicePlanningContext,commands:unknown[])=>({format:'funix-voice-commands-v1',idempotencyKey:'synthetic-voice-request',atendimentoId:ctx.atendimentoId,scenarioId:ctx.workspace.selectedId,expected:voiceRevisions(ctx),commands})
const plan=(commands:unknown[],ctx=voiceFixture())=>planVoiceCommands(batch(ctx,commands),ctx)
const updates=(changes:VoiceChange[])=>changes.filter(c=>c.op==='update_service')
function freeze(value:unknown){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}}
function empty(){const ctx=voiceFixture();ctx.workspace.items=[];for(const s of ctx.workspace.scenarios){s.pieceFlags={};s.serviceFlags={}}return ctx}

test('adds missing piece once; existing master/disabled scenario never implicitly re-enabled',()=>{
 const ctx=empty(),p=plan([cmd('add','add_piece'),cmd('again','add_piece')],ctx)
 assert.equal(p.changes.length,1);assert.equal(p.changes[0]!.op,'add_piece')
 const change=p.changes[0]!;if(change.op==='add_piece'){assert.equal(change.target.kind,'planned');assert.deepEqual(change.flags,{[V.one]:true,[V.two]:false})}
 assert.deepEqual(p.results.map(r=>r.status),['valid','noop'])
 const existing=voiceFixture();existing.workspace.scenarios[0]!.pieceFlags[V.piece]=false
 assert.equal(plan([cmd('add','add_piece')],existing).changes.length,0)
})

test('diagnosis and intensity are shared patches, preserving notes/manual services and reporting unavailable rules',()=>{
 const p=plan([cmd('damage','set_diagnosis',{diagnosis:ref(V.scratch),intensity:'leve'})])
 assert.equal(p.changes.length,1);const change=p.changes[0]!
 assert.equal(change.op,'update_piece');if(change.op==='update_piece')assert.deepEqual(change.patch,{diagnosisId:V.scratch,intensity:'leve'})
 assert.deepEqual(change.impact.scenarioIds,[V.one,V.two]);assert(p.issues.some(i=>i.code==='RECOMMENDATIONS_UNAVAILABLE'))
 assert.equal(p.results[0]!.status,'valid');assert.equal(updates(p.changes).length,0)
})

test('adds a service without duplicating an existing service or overwriting manual dimension/quantity/flags',()=>{
 const p=plan([cmd('keep','add_service',{service:ref(V.paintService),dimension:ref(V.partial)}),cmd('new','add_service',{service:ref(V.montage),dimension:ref(V.montageM)}),cmd('again','add_service',{service:ref(V.montage),dimension:ref(V.montageM)})])
 assert.deepEqual(p.results.map(r=>r.status),['noop','valid','noop']);assert.equal(p.changes.length,1)
 const added=p.changes[0]!;assert.equal(added.op,'add_service');if(added.op==='add_service'){assert.equal(added.values.quantity,'1');assert.deepEqual(added.flags,{[V.one]:true,[V.two]:false});assert.equal(added.origins.quantity?.kind,'existing-default')}
 const mismatch=plan([cmd('bad','add_service',{service:ref(V.paintService),dimension:ref(V.complete)})]);assert.equal(mismatch.changes.length,0);assert.equal(mismatch.results[0]!.status,'pending')
})

test('explicit painting correction changes only its dimension and preserves IDs, body service and scenario masks',()=>{
 const ctx=voiceFixture(),before=structuredClone(ctx),p=plan([cmd('paint','set_dimension',{line:line(V.paint),dimension:ref(V.complete)},'correction')],ctx)
 assert.equal(p.changes.length,1);const change=p.changes[0]!
 assert.equal(change.op,'update_service');if(change.op==='update_service'){assert.equal(change.target.id,V.paint);assert.deepEqual(change.patch,{dimensionId:V.complete});assert.deepEqual(change.before,{dimensionId:V.partial})}
 assert.equal(change.impact.scope,'shared');assert.deepEqual(change.impact.scenarioIds,[V.one,V.two]);assert(change.impact.invalidatesExecutionConfirmations)
 assert.deepEqual(ctx,before)
})

test('positive fractional quantities increment exactly and absolute correction replaces instead of adding',()=>{
 const p=plan([cmd('more','set_quantity',{line:line(V.body),mode:'increment',value:'0.000001'}),cmd('absolute','set_quantity',{line:line(V.body),mode:'absolute',value:'3'},'correction')])
 const change=updates(p.changes)[0]!;assert.deepEqual(change.patch,{quantity:'3'});assert.equal(change.origins.quantity?.commandId,'absolute')
 const frac=plan([cmd('more','set_quantity',{line:line(V.body),mode:'increment',value:'0.000001'})]);assert.deepEqual(updates(frac.changes)[0]!.patch,{quantity:'1.250001'})
})

test('repeated same command identity never increments twice; distinct increment identities remain intentional',()=>{
 const op=cmd('more','set_quantity',{line:line(V.body),mode:'increment',value:'1'})
 const p=plan([op,op]);assert.equal(p.results[1]!.reason,'REPEATED_COMMAND');assert.deepEqual(updates(p.changes)[0]!.patch,{quantity:'2.25'})
 assert.deepEqual(updates(plan([op,{...op,id:'more-again'}]).changes)[0]!.patch,{quantity:'3.25'})
})

test('trusted receipt makes replay a no-op despite newer revisions; different payload with same key conflicts',()=>{
 const ctx=voiceFixture(),input=batch(ctx,[cmd('more','set_quantity',{line:line(V.body),mode:'increment',value:'1'})]),p=planVoiceCommands(input,ctx)
 ctx.workspace.revision++;ctx.workspace.items[0]!.services[0]!.quantity='2.25'
 ctx.receipts=[{atendimentoId:V.at,scenarioId:V.one,idempotencyKey:input.idempotencyKey,requestDigest:p.requestDigest,handledCommandIds:['more']}]
 const replay=planVoiceCommands(input,ctx);assert(replay.replay);assert.equal(replay.changes.length,0);assert.equal(replay.results[0]!.status,'noop')
 input.commands=[cmd('more','set_quantity',{line:line(V.body),mode:'increment',value:'2'})]
 assert(planVoiceCommands(input,ctx).issues.some(i=>i.code==='IDEMPOTENCY_CONFLICT'))
})

test('latest valid correction wins, invalid later correction never erases the earlier valid operation',()=>{
 const p=plan([cmd('one','set_notes',{value:'Primeira'}),cmd('two','set_notes',{value:'Final'},'correction'),cmd('bad','set_notes',{value:42},'correction')])
 assert.equal(p.changes.length,1);const c=p.changes[0]!;if(c.op==='update_piece')assert.deepEqual(c.patch,{notes:'Final'});else assert.fail('piece patch')
 assert.deepEqual(p.results.map(r=>r.status),['noop','valid','pending'])
})

test('incompatible intentions block both rather than silently choosing one; independent notes still planned',()=>{
 const p=plan([cmd('a','set_dimension',{line:line(V.paint),dimension:ref(V.complete)}),cmd('b','set_dimension',{line:line(V.paint),dimension:ref(V.partial)}),cmd('notes','set_notes',{value:'Independente'})])
 assert.deepEqual(p.results.map(r=>r.status),['conflict','conflict','valid']);assert.equal(updates(p.changes).length,0);assert.equal(p.changes.length,1)
})

test('conflicting reused command ID blocks both, while identical repeated command is a no-op',()=>{
 const p=plan([cmd('same','set_notes',{value:'A'}),cmd('same','set_notes',{value:'B'}),cmd('ok','set_piece_enabled',{enabled:false})])
 assert.deepEqual(p.results.map(r=>r.status),['conflict','conflict','valid']);assert.equal(p.changes.length,1)
})

test('explicit service removal cannot be undone by subsequent recommendations and requires existing global consent',()=>{
 const p=plan([cmd('remove','remove_service',{line:line(V.paint)}),cmd('suggest','recommend_services',{mode:'assisted',ruleIds:['qa-rule-paint','qa-rule-montage']})])
 assert(p.changes.some(c=>c.op==='remove_service'&&c.target.id===V.paint));assert(!p.changes.some(c=>c.op==='add_service'&&c.values.serviceId===V.paintService))
 assert(p.changes.some(c=>c.op==='add_service'&&c.values.serviceId===V.montage));assert(p.issues.some(i=>i.code==='EXPLICIT_REMOVAL_PRESERVED'));assert(p.issues.some(i=>i.code==='GLOBAL_REMOVAL_CONFIRMATION_REQUIRED'))
})

test('piece removal is shared, never recreated by recommendation, with all scenario impacts',()=>{
 const p=plan([cmd('remove','remove_piece'),cmd('rec','recommend_services',{mode:'automatic'})]);assert.equal(p.changes.length,1);assert.equal(p.changes[0]!.op,'remove_piece');assert.deepEqual(p.changes[0]!.impact.scenarioIds,[V.one,V.two]);assert(p.changes[0]!.impact.requiresGlobalRemovalConfirmation)
})

test('unresolved front/rear, diagnosis, dimension and duplicate service lines never choose candidates',()=>{
 const ctx=voiceFixture();ctx.workspace.items[0]!.services.push({...ctx.workspace.items[0]!.services[1]!,id:'77777777-7777-4777-8777-777777777777'})
 const p=plan([cmd('piece','add_piece',{piece:{state:'unresolved',text:'para-choque',candidates:[V.front,V.rear]}}),cmd('damage','set_diagnosis',{diagnosis:{state:'unresolved',text:'dano'}}),cmd('size','set_dimension',{line:line(V.paint),dimension:{state:'unresolved',text:'tamanho'}}),cmd('line','set_quantity',{line:{kind:'service',service:ref(V.paintService)},mode:'absolute',value:'2'})],ctx)
 assert.equal(p.changes.length,0);assert(p.results.every(r=>r.status==='pending'));assert(p.issues.some(i=>i.code==='AMBIGUOUS_SERVICE_LINE'))
})

test('explicit line ID resolves repeated services without merging or editing its sibling',()=>{
 const ctx=voiceFixture();ctx.workspace.items[0]!.services.push({...ctx.workspace.items[0]!.services[1]!,id:'77777777-7777-4777-8777-777777777777'})
 const p=plan([cmd('quantity','set_quantity',{line:line(V.paint),mode:'absolute',value:'2'})],ctx)
 assert.equal(p.changes.length,1);assert.equal(p.changes[0]!.target.id,V.paint)
})

test('multiple damages/intensities are a pending model limitation, never a principal overwrite',()=>{
 const p=plan([cmd('extra','set_diagnosis',{diagnosis:ref(V.scratch),intensity:'severo',additionalDamage:true})]);assert.equal(p.changes.length,0);assert(p.issues.some(i=>i.code==='MULTIPLE_DAMAGE_UNSUPPORTED'))
})

test('empty piece gets only available authorized rules, preserving optional flags and traceability',()=>{
 const ctx=empty(),p=plan([cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'})],ctx)
 const lines=p.changes.filter(c=>c.op==='add_service');assert.equal(lines.length,4);assert.equal(p.usedRules.length,4)
 const optional=lines.find(c=>c.values.serviceId===V.optional)!;assert.deepEqual(optional.flags,{[V.one]:false,[V.two]:false});assert.equal(optional.values.quantity,'1');assert.equal(optional.origins.presence?.kind,'rule')
 assert(lines.every(c=>c.flags[V.two]===false));assert(!p.changes.some(c=>c.op==='update_service'))
})

test('manual content or components prevent automatic reconstruction; assisted selection never changes existing manual services',()=>{
 const ctx=voiceFixture(),p=plan([cmd('damage','set_diagnosis',{intensity:'severo'})],ctx)
 assert.equal(p.changes.length,1);assert(p.issues.some(i=>i.code==='RECOMMENDATIONS_UNAVAILABLE'))
 const assisted=plan([cmd('rec','recommend_services',{mode:'assisted',ruleIds:['qa-rule-body','qa-rule-paint','qa-rule-montage']})]);assert.equal(assisted.changes.length,1);assert.equal(assisted.changes[0]!.op,'add_service')
 const withParts=voiceFixture();withParts.workspace.items[0]!.services=[];withParts.workspace.components=[{id:'qa-part',pieceId:V.piece}]
 const protectedPlan=plan([cmd('rec','recommend_services',{mode:'automatic'})],withParts);assert.equal(protectedPlan.changes.length,0);assert(protectedPlan.issues.some(i=>i.code==='ASSISTED_RECOMMENDATIONS_REQUIRED'))
})

test('absent/unavailable rules and null intensity never invent plausible services',()=>{
 const ctx=empty();ctx.recommendations=[]
 let p=plan([cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'})],ctx)
 assert(!p.changes.some(c=>c.op==='add_service'));assert(p.issues.some(i=>i.code==='RECOMMENDATIONS_UNAVAILABLE'))
 ctx.recommendations=[{diagnosisId:V.dent,intensity:'moderado',availability:'available',rules:[]}]
 p=plan([cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'})],ctx);assert(p.issues.some(i=>i.code==='RECOMMENDATION_GAP'))
 ctx.recommendations[0]!.intensity=null
 p=plan([cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:null})],ctx);assert(!p.changes.some(c=>c.op==='add_service'));assert(p.issues.some(i=>i.code==='RECOMMENDATION_CONTEXT_MISSING'))
})

test('mismatched dimensions, pending rules and ambiguous recommendations are never applied',()=>{
 const ctx=empty(),rules=ctx.recommendations[0]!.rules
 rules[0]!.dimensionId=V.partial
 ctx.recommendations[0]!.pending=[{ruleId:'qa-rule-paint',reason:'DIMENSION_SERVICE_MISMATCH'}]
 rules.push({...rules[2]!,id:'qa-rule-montage-alt',dimensionId:V.montageM})
 const p=plan([cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'})],ctx)
 const lines=p.changes.filter(c=>c.op==='add_service');assert.deepEqual(lines.map(l=>l.values.serviceId),[V.optional]);assert(p.issues.some(i=>i.code==='RULE_REFERENCE_INVALID'));assert(p.issues.some(i=>i.code==='PENDING_RULE'));assert(p.issues.some(i=>i.code==='AMBIGUOUS_RECOMMENDATION'))
})

test('hidden/technical/uncurated Coda services are blocked; third-party inclusion never grants confirmation',()=>{
 for(const row of['i-qCp1gLfJn4','i-GsuErCDZgL','i-unapproved']){
  const ctx=voiceFixture(),id=codaServiceId(row);ctx.catalog.push(voiceCatalog(id,'servico','Curadoria QA'))
  const p=plan([cmd('blocked','add_service',{service:ref(id),dimension:null})],ctx);assert.equal(p.changes.length,0);assert(p.issues.some(i=>i.code==='CURATION_BLOCKED'))
 }
 const ctx=voiceFixture(),id=codaServiceId('i-6FW6UIOr8H');ctx.catalog.push(voiceCatalog(id,'servico','Terceiro QA'))
 const p=plan([cmd('external','add_service',{service:ref(id),dimension:null})],ctx);assert.equal(p.changes.length,1);assert(p.issues.some(i=>i.code==='THIRD_PARTY_CONFIRMATION_REQUIRED'));assert(!JSON.stringify(p.changes).includes('executionConfirmed'))
})

test('active-scenario service flags preserve all other masks and do not activate the parent implicitly',()=>{
 const ctx=voiceFixture(),copy=structuredClone(ctx),p=plan([cmd('enable','set_service_enabled',{line:line(V.paint),enabled:true})],ctx)
 assert.equal(p.changes.length,1);assert.equal(p.changes[0]!.op,'set_service_enabled');assert.equal(p.changes[0]!.impact.scope,'active-scenario');assert.deepEqual(p.changes[0]!.impact.scenarioIds,[V.one]);assert.deepEqual(ctx,copy)
})

for(const field of['composition','configuration','scenario','piece']as const)test('stale '+field+' revision blocks planning before any change',()=>{
 const ctx=voiceFixture(),input=batch(ctx,[cmd('n','set_notes',{value:'Novo'})]);if(field==='composition'||field==='configuration')input.expected[field]++;else if(field==='scenario')input.expected.scenarios[1]!.revision++;else input.expected.pieces[0]!.revision++
 const p=planVoiceCommands(input,ctx);assert.equal(p.changes.length,0);assert(p.issues.some(i=>i.code==='REVISION_CONFLICT'))
})

test('contract rejects executable/unknown fields and financial operations; independent valid commands survive invalid siblings',()=>{
 const p=plan([cmd('unknown','exec',{sql:'DELETE FROM diagnosis_items'}),cmd('notes','set_notes',{value:'Preservado'}),cmd('bad','add_service',{service:ref(V.montage),dimension:ref(V.montageM),price:'100'})])
 assert.deepEqual(p.results.map(r=>r.status),['pending','valid','pending']);assert.equal(p.changes.length,1)
 assert.equal(validateVoiceCommands({format:'funix-voice-commands-v1',commands:[]}).batch,null)
 assert.equal(validateVoiceCommands({...batch(voiceFixture(),[]),sql:'SELECT 1'}).batch,null)
})

test('invalid/overflow quantity does not erase valid independent operations',()=>{
 for(const value of['0','-1','1e2','0.0000001',1,'1000000000']){const p=plan([cmd('qty','set_quantity',{line:line(V.body),mode:'increment',value}),cmd('notes','set_notes',{value:'Bom'})]);assert.equal(updates(p.changes).length,0);assert.equal(p.results[0]!.status,'pending')}
 const ctx=voiceFixture();ctx.workspace.items[0]!.services[0]!.quantity='999999999.999999'
 const p=plan([cmd('qty','set_quantity',{line:line(V.body),mode:'increment',value:'0.000001'})],ctx);assert.equal(p.changes.length,0);assert(p.issues.some(i=>i.code==='QUANTITY_LIMIT'))
})

test('same state is no-op; deterministic plan does not mutate frozen inputs or manufacture catalog identities',()=>{
 const ctx=voiceFixture(),input=batch(ctx,[cmd('same','set_notes',{value:ctx.workspace.items[0]!.notes}),cmd('same-dim','set_dimension',{line:line(V.paint),dimension:ref(V.partial)})]);freeze(ctx);freeze(input)
 const p=planVoiceCommands(input,ctx);assert.equal(p.changes.length,0);assert(p.results.every(r=>r.status==='noop'));assert.deepEqual(planVoiceCommands(input,ctx),p)
 assert.equal(voiceContextDigest(ctx),p.stateDigest)
})

test('no SQLite import/write and no mutation of an emitted snapshot/PDF during planning against actual repository DTOs',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),budgets=new BudgetRepository(db),request={scenarioId:f.scenario.id,negotiation:{mode:'none'}},preview=budgets.preview(f.at.id,request),issued=await budgets.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:'synthetic-voice-history'}),pdf=budgets.pdf(f.at.id,issued.id),snapshot=budgets.get(f.at.id,issued.id)
  const ctx:VoicePlanningContext={atendimentoId:f.at.id,catalog:f.commercial.catalogs().items,workspace:{selectedId:f.scenario.id,revision:f.pricing.settings(f.at.id).revision,configurationRevision:f.pricing.get().revision,scenarios:f.scenarios.list(f.at.id),items:f.commercial.list(f.at.id,f.scenario.id),components:[]},recommendations:[]}
  const command={...cmd('notes','set_notes',{value:'Planejado, não salvo'}),piece:ref(f.item.pieceId)},input=batch(ctx,[command]),before=db.prepare('SELECT total_changes() AS n').get()!.n
  assert(planVoiceCommands(input,ctx).changes.length);assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,before)
  const original=ctx.workspace.items[0]!,service=original.services[0]!
  const restoration=batch(ctx,[
   {...cmd('remove-service','remove_service',{line:line(service.id)}),piece:ref(original.pieceId)},
   {...cmd('restore-service','add_service',{service:ref(service.serviceId)},'correction'),piece:ref(original.pieceId)},
   {...cmd('remove-piece','remove_piece'),piece:ref(original.pieceId)},
   {...cmd('restore-piece','add_piece',{},'correction'),piece:ref(original.pieceId)},
   {...cmd('unknown-service','add_service',{service:{state:'unresolved',text:'serviço não identificado'},dimension:null}),piece:ref(original.pieceId)}
  ])
  const restored=planVoiceCommands(restoration,ctx)
  assert.deepEqual(restored.changes,[]);assert.equal(restored.results[4]!.status,'pending')
  assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,before)
  assert.deepEqual(budgets.get(f.at.id,issued.id),snapshot);assert.deepEqual(budgets.pdf(f.at.id,issued.id),pdf);assert.notEqual(f.commercial.list(f.at.id)[0]!.notes,'Planejado, não salvo')
  assert(!/from\s*['"](?:node:sqlite|\.\/(?:commercial|scenarios|budgets|database)\.ts)['"]/.test(readFileSync(new URL('../voice-planner.ts',import.meta.url),'utf8').replace(/import type[^\n]+/g,'')))
 }finally{db.close()}
})

test('planned line references support successive corrections before UUIDs exist, preserving unrelated notes',()=>{
 const p=plan([cmd('new','add_service',{service:ref(V.montage),dimension:ref(V.montageM)}),cmd('qty','set_quantity',{line:{kind:'command',commandId:'new'},mode:'increment',value:'1'}),cmd('note','set_notes',{line:{kind:'command',commandId:'new'},value:'Só nesta linha'})])
 const added=p.changes[0]!;assert.equal(p.changes.length,1);if(added.op==='add_service'){assert.equal(added.target.kind,'planned');assert.equal(added.values.quantity,'2');assert.equal(added.values.notes,'Só nesta linha')}else assert.fail('added service')
})

test('correction back to the original value produces no effective patch; unchanged absolute quantity is a no-op',()=>{
 const p=plan([cmd('change','set_dimension',{line:line(V.paint),dimension:ref(V.complete)}),cmd('back','set_dimension',{line:line(V.paint),dimension:ref(V.partial)},'correction'),cmd('same','set_quantity',{line:line(V.body),mode:'absolute',value:'1.250000'})])
 assert.equal(p.changes.length,0);assert(p.results.every(r=>r.status==='noop'))
})

test('pending alternative does not make its single valid recommendation ambiguous',()=>{
 const ctx=empty(),set=ctx.recommendations[0]!
 set.rules=[set.rules[2]!,{...set.rules[2]!,id:'qa-pending-alternative',dimensionId:V.partial}];set.pending=[{ruleId:'qa-pending-alternative',reason:'DIMENSION_SERVICE_MISMATCH'}]
 const p=plan([cmd('piece','add_piece'),cmd('diag','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'})],ctx)
 assert.equal(p.changes.filter(c=>c.op==='add_service').length,1);assert.deepEqual(p.usedRules.map(r=>r.id),['qa-rule-montage'])
})

test('trusted receipt records only handled operations; unresolved sibling is not falsely reported as applied',()=>{
 const ctx=voiceFixture(),input=batch(ctx,[cmd('notes','set_notes',{value:'Confirmado'}),cmd('unknown','add_piece',{piece:{state:'unresolved',text:'lado'}})]),p=planVoiceCommands(input,ctx)
 ctx.receipts=[{atendimentoId:V.at,scenarioId:V.one,idempotencyKey:input.idempotencyKey,requestDigest:p.requestDigest,handledCommandIds:['notes']}]
 const replay=planVoiceCommands(input,ctx);assert.equal(replay.changes.length,0);assert.deepEqual(replay.results.map(r=>r.status),['noop','pending'])
})

test('inactive legacy references can be edited without reselecting them, while new inactive choices are rejected',()=>{
 const ctx=voiceFixture();ctx.catalog.find(c=>c.id===V.paintService)!.active=false;ctx.catalog.find(c=>c.id===V.partial)!.active=false
 assert.equal(plan([cmd('notes','set_notes',{line:line(V.paint),value:'Legado preservado'})],ctx).changes.length,1)
 ctx.catalog.find(c=>c.id===V.montage)!.active=false
 assert.equal(plan([cmd('new','add_service',{service:ref(V.montage),dimension:ref(V.montageM)})],ctx).changes.length,0)
})

test('third-party confirmation is never invented; shared quantity correction invalidates existing exact scopes',()=>{
 const ctx=voiceFixture(),serviceId=codaServiceId('i-6FW6UIOr8H'),dimensionId='qa:dim:external'
 ctx.catalog.push(voiceCatalog(serviceId,'servico','Terceiro QA'),voiceCatalog(dimensionId,'dimensao','M',serviceId))
 const existing=ctx.workspace.items[0]!.services[0]!;existing.serviceId=serviceId;existing.dimensionId=dimensionId
 for(const s of ctx.workspace.scenarios)s.serviceConfirmations={[existing.id]:executionScope(existing)}
 const p=plan([cmd('qty','set_quantity',{line:line(existing.id),mode:'absolute',value:'2'})],ctx)
 assert.equal(p.changes.length,1);assert(p.changes[0]!.impact.invalidatesExecutionConfirmations);assert.deepEqual(p.changes[0]!.impact.scenarioIds,[V.one,V.two]);assert(p.issues.some(i=>i.code==='THIRD_PARTY_CONFIRMATION_REQUIRED'))
})

test('invalid IDs stay sanitized and a reused invalid identity cannot steal a valid command target',()=>{
 const p=plan([cmd('duplicate','set_notes',{value:'A',sql:'not allowed'}),cmd('duplicate','set_notes',{value:'B'}),{id:{untrusted:true},op:'set_notes'}])
 assert.equal(p.changes.length,0);assert(p.results.every(r=>typeof r.commandId==='string'));assert(p.issues.some(i=>i.code==='COMMAND_ID_CONFLICT'))
})

test('absolute quantity can repair an invalid old value; increment cannot guess its numeric meaning',()=>{
 const ctx=voiceFixture();ctx.workspace.items[0]!.services[0]!.quantity='invalid'
 assert.equal(plan([cmd('more','set_quantity',{line:line(V.body),mode:'increment',value:'1'})],ctx).changes.length,0)
 assert.deepEqual(updates(plan([cmd('now','set_quantity',{line:line(V.body),mode:'absolute',value:'3'})],ctx).changes)[0]!.patch,{quantity:'3'})
})

test('a recommendation never replaces an unresolved explicit dimension or correction with its own default',()=>{
 const ctx=empty(),p=plan([cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'}),cmd('paint','add_service',{service:ref(V.paintService),dimension:{state:'unresolved',text:'parcial ou completa'}})],ctx)
 assert(!p.changes.some(c=>c.op==='add_service'&&c.values.serviceId===V.paintService));assert(p.changes.some(c=>c.op==='add_service'&&c.values.serviceId===V.montage));assert(p.issues.some(i=>i.code==='EXPLICIT_SERVICE_INTENT_PENDING'))
 const correction=plan([cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'}),cmd('paint','set_dimension',{line:{kind:'service',service:ref(V.paintService)},dimension:ref(V.partial)},'correction')],ctx)
 assert(!correction.changes.some(c=>c.op==='add_service'&&c.values.serviceId===V.paintService));assert(correction.issues.some(i=>i.code==='LINE_NOT_FOUND'))
})

test('explicit absence of a service suppresses its later recommendation even when no line existed yet',()=>{
 const ctx=empty(),p=plan([cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'}),cmd('remove','remove_service',{line:{kind:'service',service:ref(V.paintService)}})],ctx)
 assert(!p.changes.some(c=>c.op==='add_service'&&c.values.serviceId===V.paintService));assert.equal(p.results.find(r=>r.commandId==='remove')!.status,'noop');assert(p.issues.some(i=>i.code==='EXPLICIT_REMOVAL_PRESERVED'))
})

test('line notes and repeated explicit deletion do not erase unrelated piece/service data',()=>{
 const p=plan([cmd('note','set_notes',{line:line(V.body),value:'Nova observação'}),cmd('remove','remove_service',{line:line(V.paint)}),cmd('repeat','remove_service',{line:line(V.paint)})])
 const change=updates(p.changes)[0]!;assert.deepEqual(change.patch,{notes:'Nova observação'});assert.equal(p.changes.filter(c=>c.op==='remove_service').length,1);assert.equal(p.results[2]!.status,'noop');assert(!p.issues.some(i=>i.code==='LINE_NOT_FOUND'))
})

test('schema and ownership boundaries reject foreign context, unknown identities, duplicate context IDs and overlong batches',()=>{
 const ctx=voiceFixture(),input=batch(ctx,[cmd('n','set_notes',{value:'A'})]);input.scenarioId=V.two
 assert(planVoiceCommands(input,ctx).issues.some(i=>i.code==='CONTEXT_CONFLICT'))
 const missing=plan([cmd('unknown','add_piece',{piece:ref('no-such-piece')})]);assert.equal(missing.changes.length,0);assert(missing.issues.some(i=>i.code==='MISSING_REFERENCE'))
 ctx.catalog.push({...ctx.catalog[0]!});assert(plan([cmd('n','set_notes',{value:'B'})],ctx).issues.some(i=>i.code==='INVALID_CONTEXT'))
 const valid=voiceFixture();assert.equal(validateVoiceCommands(batch(valid,Array.from({length:101},(_,i)=>cmd(String(i),'add_piece')))).batch,null)
})

test('known calculation pendencies are reported separately; references remain operational without fabricated price/energy',()=>{
 const ctx=voiceFixture();ctx.workspace.calculations=[{scenarioId:V.one,errors:['Configuração técnica incompleta — QA']},{scenarioId:V.two,errors:['Outro cenário — QA']}]
 const p=plan([cmd('new','add_service',{service:ref(V.montage),dimension:ref(V.montageM)})],ctx)
 assert.equal(p.changes.length,1);assert.equal(p.results[0]!.status,'valid');assert(p.requiresCalculation)
 assert.equal(p.issues.filter(i=>i.code==='CURRENT_CALCULATION_PENDING').length,1)
 assert(!JSON.stringify(p.changes).includes('finalUnit'));assert(!JSON.stringify(p.changes).includes('baseEnergy'))
})

test('a later valid explicit correction reconciles earlier incompatible field instructions',()=>{
 const p=plan([cmd('a','set_notes',{value:'A'}),cmd('b','set_notes',{value:'B'}),cmd('final','set_notes',{value:'C'},'correction')])
 assert.equal(p.changes.length,1);const change=p.changes[0]!;if(change.op==='update_piece')assert.deepEqual(change.patch,{notes:'C'});else assert.fail('piece patch')
 assert.deepEqual(p.results.map(r=>r.status),['noop','noop','valid']);assert(!p.issues.some(i=>i.code==='INCOMPATIBLE_INTENTS'))
})

test('unreconciled later contradiction never revives an earlier superseded field value',()=>{
 const p=plan([cmd('a','set_notes',{value:'A'}),cmd('b','set_notes',{value:'B'},'correction'),cmd('c','set_notes',{value:'C'})])
 assert.equal(p.changes.length,0);assert(p.results.every(r=>r.status==='conflict'))
})

test('published structured examples and resulting plans reproduce the typed synthetic fixtures exactly',async()=>{
 const{voiceExampleCases}=await import('./fixtures/voice-planner.ts')
 for(const{name,context,input}of voiceExampleCases()){
  const example=JSON.parse(readFileSync(new URL('../../docs/exemplos/voice-planner/'+name+'.json',import.meta.url),'utf8'))
  assert(example.synthetic);assert.deepEqual(example.input,input);assert.deepEqual(example.plan,planVoiceCommands(input,context))
 }
})

test('recommendation plans match the existing Phase 4 application on consistent synthetic repository data',async()=>{
 const{recommendations}=await import('../diagnosis-recommendations.ts'),{applySuggestedServices}=await import('../apply-recommendations.ts')
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),diagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'Diagnóstico QA'}),optional=f.commercial.saveCatalog({kind:'servico',name:'Opcional QA'}),dimension=f.commercial.saveCatalog({kind:'dimensao',name:'M QA',serviceId:optional.id})
  f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId:diagnosis.id,intensity:'moderado',services:[]})
  const scene=f.scenarios.list(f.at.id)[0]!,other=f.scenarios.create(f.at.id,{name:'Outro QA',duplicateFrom:scene.id,sourceRevision:scene.revision})
  for(const[id,service,dim,selected]of[['qa-repository-rule-1',f.service.id,f.dimension.id,1],['qa-repository-rule-2',optional.id,dimension.id,0]]as const)db.prepare("INSERT INTO diagnosis_recommendations(id,source_table,source_row_id,diagnosis_id,intensity,service_id,dimension_id,selected_by_default,status,reason)VALUES(?,'qa-table',?,?,'moderado',?,?,?,'valid',NULL)").run(id,id,diagnosis.id,service,dim,selected)
  const ctx:VoicePlanningContext={atendimentoId:f.at.id,catalog:f.commercial.catalogs().items,workspace:{selectedId:scene.id,revision:f.pricing.settings(f.at.id).revision,configurationRevision:f.pricing.get().revision,scenarios:f.scenarios.list(f.at.id),items:f.commercial.list(f.at.id,scene.id),components:[]},recommendations:[{diagnosisId:diagnosis.id,intensity:'moderado',availability:'available',rules:recommendations(db,diagnosis.id,'moderado')}]}
  const input=batch(ctx,[{...cmd('suggest','recommend_services',{mode:'automatic'}),piece:ref(f.item.pieceId)}]),before=db.prepare('SELECT total_changes() AS n').get()!.n,p=planVoiceCommands(input,ctx)
  assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,before)
  // Only the existing, authorized test applier writes AFTER the pure planner returned.
  const ack=applySuggestedServices(db,f.at.id,f.item.id,{revision:ctx.workspace.items[0]!.revision,scenarioId:scene.id,scenarioRevision:ctx.workspace.scenarios[0]!.revision,diagnosisId:diagnosis.id,intensity:'moderado',mode:'automatic',idempotencyKey:'synthetic-voice-parity'})
  const planned=p.changes.filter(c=>c.op==='add_service').map(c=>({serviceId:c.values.serviceId,dimensionId:c.values.dimensionId,quantity:c.values.quantity,enabled:c.flags[scene.id],ruleId:c.values.recommendationRuleId})).sort((a,b)=>a.serviceId.localeCompare(b.serviceId))
  const actual=ack.item.services.map(l=>({serviceId:l.serviceId,dimensionId:l.dimensionId,quantity:l.quantity,enabled:l.enabled,ruleId:l.recommendationRuleId})).sort((a,b)=>a.serviceId.localeCompare(b.serviceId))
  assert.deepEqual(planned,actual);assert.equal(ack.created.length,2);assert(f.commercial.list(f.at.id,other.id)[0]!.services.every(l=>!l.enabled))
 }finally{db.close()}
})

test('planned identities have disjoint namespaces and cannot collide through command delimiter text',()=>{
 const ctx=empty(),suffix=createHash('sha256').update(JSON.stringify('qa-rule-body')).digest('hex').slice(0,12)
 const p=plan([cmd('rear','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'}),cmd('damage:'+suffix,'add_piece',{piece:ref(V.front)})],ctx)
 const targets=p.changes.filter(c=>c.op==='add_piece'||c.op==='add_service').map(c=>c.target.id)
 assert.equal(targets.length,6);assert.equal(new Set(targets).size,targets.length);assert(p.changes.every(c=>c.target.kind==='planned'))
})

test('correction restores an existing service with identity, manual attributes and scenario flags intact',()=>{
 const ctx=voiceFixture(),before=structuredClone(ctx)
 const commands=[cmd('remove','remove_service',{line:line(V.body)}),cmd('keep','add_service',{service:ref(V.bodyService)},'correction')]
 const p=plan(commands,ctx)
 assert.deepEqual(p.changes,[]);assert.deepEqual(p.results.map(r=>r.status),['noop','noop'])
 assert(!p.issues.some(i=>i.blocking));assert.deepEqual(ctx,before)
 assert.deepEqual(plan(commands,ctx),p)
 const changed=plan([...commands,cmd('qty','set_quantity',{line:line(V.body),mode:'increment',value:'0.25'},'correction')],ctx)
 assert.equal(changed.changes.length,1);const change=changed.changes[0]!
 assert.equal(change.op,'update_service')
 if(change.op==='update_service'){assert.equal(change.target.id,V.body);assert.deepEqual(change.patch,{quantity:'1.5'})}
})

test('service restoration preserves changes made before removal and only applies explicitly supplied attributes',()=>{
 const commands=[cmd('note','set_notes',{line:line(V.paint),value:'Ajuste manual preservado'}),
 cmd('remove','remove_service',{line:line(V.paint)}),
 cmd('keep','add_service',{service:ref(V.paintService),dimension:ref(V.complete)},'correction')]
 const p=plan(commands)
 assert.equal(p.changes.length,1);const change=p.changes[0]!
 assert.equal(change.op,'update_service')
 if(change.op==='update_service'){assert.equal(change.target.id,V.paint);assert.deepEqual(change.patch,{dimensionId:V.complete,notes:'Ajuste manual preservado'})}
 assert(!p.changes.some(c=>c.op==='set_service_enabled'))
})

test('piece correction restores original identity, diagnosis, services, quantities, notes and all flags',()=>{
 const commands=[cmd('remove','remove_piece'),cmd('keep','add_piece',{},'correction')]
 const ctx=voiceFixture(),before=structuredClone(ctx),p=plan(commands,ctx)
 assert.deepEqual(p.changes,[]);assert(!p.issues.some(i=>i.blocking));assert.deepEqual(ctx,before)
 const edited=plan([...commands,cmd('note','set_notes',{value:'Nova nota'},'correction')],ctx)
 assert.equal(edited.changes.length,1);const change=edited.changes[0]!
 assert.equal(change.op,'update_piece');assert.equal(change.target.id,V.piece)
 if(change.op==='update_piece')assert.deepEqual(change.patch,{notes:'Nova nota'})
 assert.deepEqual(plan(commands,ctx),p)
})

test('independent instructions never restore deleted services or pieces; recommendations cannot restore services',()=>{
 for(const commands of [
 [cmd('remove','remove_piece'),cmd('again','add_piece')],
 [cmd('remove','remove_service',{line:line(V.paint)}),cmd('again','add_service',{service:ref(V.paintService),dimension:ref(V.partial)})],
 [cmd('remove','remove_service',{line:line(V.paint)}),cmd('auto','recommend_services',{mode:'automatic'}),cmd('assist','recommend_services',{mode:'assisted',ruleIds:['qa-rule-paint']})]
 ]){
  const p=plan(commands)
  assert(p.changes.some(c=>c.op==='remove_service'||c.op==='remove_piece'))
  assert(!p.changes.some(c=>c.op==='add_service'||c.op==='add_piece'))
 }
})

test('ambiguous service restoration and absent previous identities stay pending without recreation',()=>{
 const ctx=voiceFixture();ctx.workspace.items[0]!.services.push({...ctx.workspace.items[0]!.services[0]!,id:'qa:second-body'})
 const p=plan([cmd('one','remove_service',{line:line(V.body)}),cmd('two','remove_service',{line:line('qa:second-body')}),cmd('keep','add_service',{service:ref(V.bodyService)},'correction')],ctx)
 assert.equal(p.results[2]!.reason,'RESTORATION_UNRESOLVED');assert.equal(p.changes.filter(c=>c.op==='remove_service').length,2)
 assert(!p.changes.some(c=>c.op==='add_service'))
 for(const commands of [
 [cmd('remove','remove_piece'),cmd('keep','add_piece',{},'correction')],
 [cmd('add','add_piece'),cmd('remove','remove_service',{line:{kind:'service',service:ref(V.bodyService)}}),cmd('keep','add_service',{service:ref(V.bodyService)},'correction')]
 ]){
  const result=plan(commands,empty());assert(result.issues.some(i=>i.code==='RESTORATION_UNRESOLVED'))
  assert(!result.changes.some(c=>c.op==='add_service'))
 }
})

test('separate service exclusions survive piece restoration; canceled removals require no confirmation',()=>{
 const p=plan([cmd('service','remove_service',{line:line(V.body)}),cmd('piece','remove_piece'),cmd('keep','add_piece',{},'correction')])
 assert.equal(p.changes.length,1);assert.equal(p.changes[0]!.op,'remove_service')
 const restored=plan([cmd('service','remove_service',{line:line(V.body)}),cmd('piece','remove_piece'),cmd('keep','add_piece',{},'correction'),cmd('service-back','add_service',{service:ref(V.bodyService)},'correction')])
 assert.deepEqual(restored.changes,[]);assert(!restored.issues.some(i=>i.code==='GLOBAL_REMOVAL_CONFIRMATION_REQUIRED'))
})

test('an unresolved explicit service suspends automatic derivation per piece even with a single candidate',()=>{
 for(const service of [{state:'unresolved',text:'pintura',candidates:[V.paintService]},ref('qa:missing-service')]){
 const commands=[cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'}),
 cmd('unknown','add_service',{service,dimension:null}),cmd('auto','recommend_services',{mode:'automatic'})]
 const p=plan(commands,empty())
 assert.equal(p.changes.filter(c=>c.op==='add_service').length,0)
 assert.equal(p.results[2]!.status,'pending');assert(p.issues.some(i=>i.code==='AUTOMATIC_RECOMMENDATIONS_SUSPENDED'))
 assert.equal(p.changes.filter(c=>c.op==='add_piece').length,1)
 assert.deepEqual(plan(commands,empty()),p)
 }
})

test('unresolved service-line references also suspend automatic derivation without choosing candidates',()=>{
 const p=plan([cmd('piece','add_piece'),cmd('damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'}),
 cmd('quantity','set_quantity',{line:{kind:'service',service:{state:'unresolved',text:'pintura',candidates:[V.paintService]}},mode:'absolute',value:'3'})],empty())
 assert.equal(p.results[2]!.status,'pending');assert(!p.changes.some(c=>c.op==='add_service'))
 assert(p.issues.some(i=>i.code==='AUTOMATIC_RECOMMENDATIONS_SUSPENDED'))
})

test('unresolved service preserves independent explicit services and automatic recommendations on other pieces',()=>{
 const commands=[cmd('rear','add_piece'),cmd('rear-damage','set_diagnosis',{diagnosis:ref(V.dent),intensity:'moderado'}),
 cmd('unknown','add_service',{service:{state:'unresolved',text:'pintura'},dimension:null}),
 cmd('body','add_service',{service:ref(V.bodyService),dimension:ref(V.bodyM),quantity:'1.25'}),
 cmd('front','add_piece',{piece:ref(V.front)}),
 cmd('front-damage','set_diagnosis',{piece:ref(V.front),diagnosis:ref(V.dent),intensity:'moderado'})]
 const p=plan(commands,empty()),rear=p.changes.find(c=>c.op==='add_piece'&&c.pieceId===V.rear)!,front=p.changes.find(c=>c.op==='add_piece'&&c.pieceId===V.front)!
 const services=p.changes.filter(c=>c.op==='add_service')
 assert.equal(services.filter(c=>c.op==='add_service'&&c.piece.id===rear.target.id).length,1)
 assert.equal(services.filter(c=>c.op==='add_service'&&c.piece.id===front.target.id).length,4)
 assert.equal(p.results[2]!.status,'pending');assert.equal(p.results[3]!.status,'valid')
})

test('repeated removal/correction commands are deterministic and do not duplicate restored identities',()=>{
 const remove=cmd('remove','remove_service',{line:line(V.paint)}),keep=cmd('keep','add_service',{service:ref(V.paintService)},'correction')
 const commands=[remove,remove,keep,keep,cmd('remove-again','remove_service',{line:line(V.paint)}),cmd('keep-again','add_service',{service:ref(V.paintService)},'correction')]
 const p=plan(commands);assert.deepEqual(p.changes,[]);assert.deepEqual(plan(commands),p)
})

test('dimension omission is correction-only and never fabricates a new service dimension',()=>{
 assert(validateVoiceCommands(batch(voiceFixture(),[cmd('bad','add_service',{service:ref(V.bodyService)})])).invalidIndexes.includes(0))
 const p=plan([cmd('keep','add_service',{service:ref(V.montage)},'correction')])
 assert.equal(p.results[0]!.reason,'RESTORATION_UNRESOLVED');assert.deepEqual(p.changes,[])
})
