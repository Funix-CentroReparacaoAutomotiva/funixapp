import test from 'node:test'
import assert from 'node:assert/strict'
import{setImmediate}from'node:timers/promises'
import{openDatabase}from'../database.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{ComponentRepository}from'../components.ts'
import{calculate}from'../pricing-engine.ts'
import{PieceSelectionQueue}from'../../src/piece-selection-queue.ts'
import type{PieceSelectionTransport,SelectionState}from'../../src/piece-selection-queue.ts'
import type{CommercialWorkspace}from'../../shared/commercial.ts'
import{removalRequest,removalReview}from'../../shared/piece-removal.ts'
import{negotiationIsDirty}from'../../src/negotiation.ts'
import{BudgetRepository}from'./fixtures/budget-renderer.ts'
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return{promise,resolve}}
async function until(check:()=>boolean){for(let n=0;n<200&&!check();n++)await setImmediate();assert(check(),'queue did not reach expected state')}
function fixture(){
 const db=openDatabase(':memory:'),f=commercialFixture(db),parts=new ComponentRepository(db),catalog=f.commercial.catalogs().items,pieces=catalog.filter(p=>p.kind==='peca'&&p.code&&p.active&&p.code!=='capo').slice(0,6)
 for(const p of pieces)f.commercial.add(f.at.id,{pieceCodes:[p.code!]})
 function read(id=f.scenarios.list(f.at.id)[0]!.id):CommercialWorkspace{
  const scenarios=f.scenarios.list(f.at.id),selectedId=scenarios.some(s=>s.id===id)?id:scenarios[0]!.id,items=f.commercial.list(f.at.id,selectedId),components=parts.list(f.at.id),settings=f.pricing.settings(f.at.id),cfg=f.pricing.get()
  return{scenarios,selectedId,items,components,settings:settings.settings,revision:settings.revision,configurationRevision:cfg.revision,calculations:scenarios.map(s=>calculate(items,components,catalog,s,cfg.config,settings.settings))}
 }
 const initial=read(),identities=new Map(catalog.filter(c=>c.kind==='peca'&&c.code).map(p=>[p.code!,p.id])),codes=pieces.map(p=>p.code!),saved=(code:string)=>Boolean(f.commercial.list(f.at.id).find(p=>p.pieceId===identities.get(code)))
 let state:SelectionState={phase:'idle',intents:new Map(),error:null},confirmed=initial,adds=0,removes=0,reads=0,confirmations=0,flags=0
 const io:PieceSelectionTransport={read:async id=>{reads++;return read(id)},add:async(codes,id,revision)=>{adds++;return f.commercial.add(f.at.id,{pieceCodes:codes,scenarioId:id,scenarioRevision:revision})},setEnabled:async(id,revision,pieceFlags)=>{flags++;return f.scenarios.update(f.at.id,id,{revision,pieceFlags})},remove:async request=>{removes++;return f.commercial.removeMany(f.at.id,request)},confirmRemoval:async()=>{confirmations++;return true},confirmed:w=>{confirmed=w},changed:s=>{state=s}}
 const q=new PieceSelectionQueue(f.at.id,io)
 return{db,f,parts,catalog,pieces,codes,identities,initial,read,saved,io,q,get state(){return state},get confirmed(){return confirmed},get adds(){return adds},get removes(){return removes},get reads(){return reads},get confirmations(){return confirmations},get flags(){return flags}}
}
test('Fase1 selecting an existing disabled master re-enables only its active-scenario flag without adding or removing',async()=>{
 const t=fixture();try{const p=t.initial.items.find(p=>p.pieceId===t.identities.get(t.codes[0]!))!,s=t.f.scenarios.list(t.f.at.id)[0]!;t.f.scenarios.update(t.f.at.id,s.id,{revision:s.revision,pieceFlags:{[p.id]:false}});await t.q.enqueue([t.codes[0]!],true,t.read(),t.identities);await until(()=>t.q.status==='idle');assert(t.saved(t.codes[0]!));assert.equal(t.f.commercial.list(t.f.at.id).find(i=>i.id===p.id)!.enabled,true);assert.equal(t.flags,1);assert.equal(t.adds+t.removes,0)}finally{t.db.close()}
})
test('Fase1 serializes rapid flags and last intention wins without any deletion or duplication',async()=>{
 const t=fixture(),gate=deferred(),original=t.io.setEnabled;let inFlight=0,max=0
 try{t.io.setEnabled=async(...args)=>{inFlight++;max=Math.max(max,inFlight);await gate.promise;try{return await original(...args)}finally{inFlight--}};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>inFlight===1);for(const c of t.codes.slice(1,4))await t.q.enqueue([c],false,t.initial,t.identities);await t.q.enqueue([t.codes[0]!,t.codes[1]!],true,t.initial,t.identities);gate.resolve();await until(()=>t.q.status==='idle');assert.equal(max,1);for(const c of t.codes)assert(t.saved(c));const w=t.read();for(const c of t.codes.slice(0,4)){const p=w.items.find(p=>p.pieceId===t.identities.get(c))!;assert.equal(p.enabled,t.codes.indexOf(c)<2)}assert.equal(t.removes+t.adds+t.confirmations,0);assert.deepEqual(w.items.find(p=>p.id===t.f.item.id)!.services,t.f.item.services);assert.equal(t.state.intents.size,0)}finally{t.db.close()}
})
test('Stage2 stale React workspace uses actual latest guard after confirmed removal',async()=>{
 const t=fixture();try{await t.q.enqueueRemoval([t.codes[0]!],t.initial,t.identities);await until(()=>t.q.status==='idle');await t.q.enqueueRemoval([t.codes[1]!],t.initial,t.identities);await until(()=>t.q.status==='idle');assert(!t.saved(t.codes[0]!));assert(!t.saved(t.codes[1]!));assert.equal(t.removes,2)}finally{t.db.close()}
})
for(const kind of ['http','lost-delete','bad-delete','read-after-commit']as const)test(`Stage2 ${kind}: explicit recovery reads first and never repeats a committed removal`,async()=>{
 const t=fixture(),write=t.io.remove,read=t.io.read;let fault=true
 try{if(kind==='read-after-commit')t.io.read=async id=>{if(fault)throw Error('QA GET 503');return read(id)};else t.io.remove=async request=>{if(!fault)return write(request);if(kind==='http')throw Error('QA HTTP before delivery');const ack=await write(request);if(kind==='lost-delete')throw Error('QA lost reply');return{removedIds:[]}as typeof ack};await t.q.enqueueRemoval([t.codes[0]!],t.initial,t.identities);await until(()=>t.q.status==='blocked');assert.equal(t.state.intents.get(t.codes[0]!),false);assert.equal(await t.q.enqueueRemoval([t.codes[1]!],t.initial,t.identities),false);assert.equal(t.saved(t.codes[0]!),kind==='http');fault=false;assert(await t.q.recover());assert(!t.saved(t.codes[0]!));assert.equal(t.removes,1)}finally{t.db.close()}
})
test('Stage2 lost creation response recovers the actual stable ID without duplicate POST or clearing existing services',async()=>{
 const t=fixture(),post=t.io.add,extra=t.catalog.find(c=>c.kind==='peca'&&c.code&&!t.initial.items.some(p=>p.pieceId===c.id))!;let fault=true
 try{t.io.add=async(...args)=>{const result=await post(...args);if(fault)throw Error('QA POST committed, body lost');return result};await t.q.enqueue([extra.code!],true,t.initial,t.identities);await until(()=>t.q.status==='blocked');const created=t.f.commercial.list(t.f.at.id).find(p=>p.pieceId===extra.id)!.id;fault=false;assert(await t.q.recover());assert.equal(t.adds,1);assert.equal(t.f.commercial.list(t.f.at.id).filter(p=>p.pieceId===extra.id).length,1);assert.equal(t.f.commercial.list(t.f.at.id).find(p=>p.pieceId===extra.id)!.id,created);assert.deepEqual(t.f.commercial.list(t.f.at.id).find(p=>p.id===t.f.item.id)!.services,t.f.item.services)}finally{t.db.close()}
})
test('Fase1 add then disable during pending creation retains one disabled master',async()=>{
 const t=fixture(),post=t.io.add,gate=deferred(),extra=t.catalog.find(c=>c.kind==='peca'&&c.code&&!t.initial.items.some(p=>p.pieceId===c.id))!;let started=false
 try{t.io.add=async(...args)=>{started=true;await gate.promise;return post(...args)};await t.q.enqueue([extra.code!],true,t.initial,t.identities);await until(()=>started);await t.q.enqueue([extra.code!],false,t.initial,t.identities);gate.resolve();await until(()=>t.q.status==='idle');assert(t.saved(extra.code!));assert.equal(t.read().items.find(p=>p.pieceId===extra.id)!.enabled,false);assert.equal(t.adds,1);assert.equal(t.removes,0)}finally{t.db.close()}
})
test('Stage2 cancellation of configured or multi-scenario removal changes no state and sends no read/write',async()=>{
 const t=fixture();try{t.io.confirmRemoval=async r=>{assert(r.required);assert(r.hasContent);return false};const before=JSON.stringify(t.read());assert.equal(await t.q.enqueueRemoval(['capo'],t.initial,t.identities),false);assert.equal(JSON.stringify(t.read()),before);assert.equal(t.reads+t.adds+t.removes,0);assert.equal(t.state.intents.size,0);assert.equal(t.q.status,'idle')}finally{t.db.close()}
})
test('Stage2 confirmation context changes block deletion; recovery reconfirms changed children and Cancel preserves them',async()=>{
 const t=fixture();let confirmations=0
 try{t.io.confirmRemoval=async()=>{confirmations++;if(confirmations===1){t.parts.save(t.f.at.id,{pieceId:t.f.item.id,name:'QA extra',quantity:'0.25',manualPrice:'2',notes:''});return true}return false};await t.q.enqueueRemoval(['capo'],t.initial,t.identities);await until(()=>t.q.status==='blocked');assert(t.saved('capo'));assert(await t.q.recover());assert.equal(confirmations,2);assert(t.saved('capo'));assert.equal(t.parts.list(t.f.at.id).length,1)}finally{t.db.close()}
})
test('Stage2 externally recreated master never gets removed by recovery of an old pending deletion',async()=>{
 const t=fixture();let replacement=''
 try{t.io.remove=async()=>{const w=t.read();t.f.commercial.removeMany(t.f.at.id,removalRequest(w,[t.codes[0]!],t.identities));t.f.commercial.add(t.f.at.id,{pieceCodes:[t.codes[0]!]});replacement=t.read().items.find(p=>p.pieceId===t.identities.get(t.codes[0]!))!.id;throw Error('QA conflict')};await t.q.enqueueRemoval([t.codes[0]!],t.initial,t.identities);await until(()=>t.q.status==='blocked');assert.equal(await t.q.recover(),false);assert(t.saved(t.codes[0]!));assert.equal(t.read().items.find(p=>p.id===replacement)!.id,replacement);assert(t.q.discard())}finally{t.db.close()}
})
test('Stage2 same-event off/on of empty existing master avoids writes and preserves its ID',async()=>{
 const t=fixture();try{const before=JSON.stringify(t.initial.items);void t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);void t.q.enqueue([t.codes[0]!],true,t.initial,t.identities);await until(()=>t.q.status==='idle');assert.equal(t.removes+t.adds+t.flags+t.confirmations,0);assert.equal(JSON.stringify(t.read().items),before)}finally{t.db.close()}
})
test('Stage2 removal review uses actual stable positions and configured children even when parent is disabled everywhere',()=>{
 const t=fixture();try{const two=t.f.scenarios.create(t.f.at.id,{name:'second'});t.f.scenarios.remove(t.f.at.id,two.id,{revision:two.revision});const three=t.f.scenarios.create(t.f.at.id,{name:'third'});let w=t.read();const p=w.items.find(p=>p.id===t.f.item.id)!;let s=t.f.scenarios.list(t.f.at.id).find(s=>s.id===three.id)!;t.f.scenarios.update(t.f.at.id,s.id,{revision:s.revision,pieceFlags:{[p.id]:true}});w=t.read();assert.deepEqual(removalReview(w,['capo'],t.identities).positions,[1,3]);for(const s of t.f.scenarios.list(t.f.at.id))t.f.scenarios.update(t.f.at.id,s.id,{revision:s.revision,pieceFlags:{[p.id]:false}});const r=removalReview(t.read(),['capo'],t.identities);assert(r.required);assert(r.hasContent);assert.deepEqual(r.positions,[])}finally{t.db.close()}
})
test('Stage2 effective zero negotiation is clean, real and malformed drafts remain guarded',()=>{
 for(const value of ['0','0,00','00.000'])assert.equal(negotiationIsDirty({mode:'discount',value,acknowledgeResidual:false}),false)
 for(const value of ['10','bad',''])assert.equal(negotiationIsDirty({mode:'adjust',value,acknowledgeResidual:false}),true)
})
test('Stage2 canceled Ambos with one configured member changes neither piece, and suspended confirmation never writes',async()=>{
 const t=fixture(),gate=deferred();let awaiting=false
 try{
  t.io.confirmRemoval=async()=>false;const before=JSON.stringify(t.read());assert.equal(await t.q.enqueueRemoval(['capo',t.codes[0]!],t.initial,t.identities),false);assert.equal(JSON.stringify(t.read()),before);assert.equal(t.adds+t.removes+t.reads,0)
  t.io.confirmRemoval=async()=>{awaiting=true;await gate.promise;return true};const pending=t.q.enqueueRemoval(['capo'],t.initial,t.identities);await until(()=>awaiting);t.q.suspend();gate.resolve();assert.equal(await pending,false);assert.equal(t.adds+t.removes+t.reads,0);assert.equal(JSON.stringify(t.read()),before)
 }finally{t.db.close()}
})
test('Stage2 malformed workspace after acknowledged delete stays blocked, preserving intent until a valid read',async()=>{
 const t=fixture(),read=t.io.read;let corrupt=true
 try{t.io.read=async id=>{const w=await read(id);if(corrupt)delete(w.scenarios[0]as unknown as Record<string,unknown>).componentFlags;return w};await t.q.enqueueRemoval([t.codes[0]!],t.initial,t.identities);await until(()=>t.q.status==='blocked');assert.equal(t.state.intents.get(t.codes[0]!),false);corrupt=false;assert(await t.q.recover());assert.equal(t.removes,1);assert(!t.saved(t.codes[0]!))}finally{t.db.close()}
})
test('Fase1 Ambos flag batch remains atomic when interleaved with independent taps',async()=>{
 const t=fixture(),gate=deferred(),set=t.io.setEnabled,batches:string[][]=[];let started=false
 try{t.io.setEnabled=async(...args)=>{batches.push(Object.keys(args[2]));if(!started){started=true;await gate.promise}return set(...args)};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>started);await t.q.enqueue([t.codes[1]!],false,t.initial,t.identities);await t.q.enqueue([t.codes[2]!,t.codes[3]!],false,t.initial,t.identities);gate.resolve();await until(()=>t.q.status==='idle');const pair=t.initial.items.filter(p=>[t.identities.get(t.codes[2]!),t.identities.get(t.codes[3]!)].includes(p.pieceId)).map(p=>p.id).sort();assert(batches.some(b=>JSON.stringify([...b].sort())===JSON.stringify(pair)));assert(batches.filter(b=>b.some(id=>pair.includes(id))).every(b=>b.length===2&&b.every(id=>pair.includes(id))));assert.equal(t.removes,0)}finally{t.db.close()}
})

test('Fase1 parent flags preserve IDs, notes, diagnosis and child flags in every scenario, without changing issued snapshot/PDF',async()=>{
 const t=fixture();try{
  const diagnosis=t.f.commercial.saveCatalog({kind:'diagnostico',name:'QA dano preservado'}),component=t.parts.save(t.f.at.id,{pieceId:t.f.item.id,name:'QA componente',quantity:'0.25',manualPrice:'10',notes:'QA nota do componente'})
  const p=t.f.commercial.updateDiagnosis(t.f.at.id,t.f.item.id,{revision:t.f.item.revision,notes:'QA notas',diagnosisId:diagnosis.id,services:t.f.item.services.map(l=>({...l,enabled:false}))})
  let scene=t.f.scenarios.list(t.f.at.id)[0]!;scene=t.f.scenarios.update(t.f.at.id,scene.id,{revision:scene.revision,deadline:{mode:'manual',manualDays:1},pieceFlags:Object.fromEntries(t.read().items.filter(i=>i.id!==p.id).map(i=>[i.id,false]))})
  const other=t.f.scenarios.create(t.f.at.id,{name:'Outro',duplicateFrom:scene.id,sourceRevision:scene.revision}),before=t.read(),b=new BudgetRepository(t.db),request={scenarioId:scene.id,negotiation:{mode:'none'}},preview=b.preview(t.f.at.id,request),budget=(await b.emit(t.f.at.id,{...request,previewToken:preview.token,idempotencyKey:'fase1-frozen-0000000000000000'})),pdf=b.pdf(t.f.at.id,budget.id)
  await t.q.enqueue(['capo'],false,before,t.identities);await until(()=>t.q.status==='idle');let w=t.read();assert.equal(w.items.length,before.items.length);assert.equal(w.items.find(i=>i.id===p.id)!.enabled,false);assert(w.scenarios.find(s=>s.id===other.id)!.pieceFlags[p.id]);assert.equal(w.scenarios[0]!.serviceFlags[p.services[0]!.id],false);assert.equal(w.scenarios[0]!.componentFlags[component.id],true);assert.equal(w.calculations[0]!.pieceTotals!.find(i=>i.pieceId===p.id)!.total,'0')
  await t.q.enqueue(['capo'],true,w,t.identities);await until(()=>t.q.status==='idle');w=t.read();assert.deepEqual(w.items,before.items);assert.deepEqual(w.components,before.components);assert.deepEqual(w.scenarios.find(s=>s.id===other.id),before.scenarios.find(s=>s.id===other.id));assert.deepEqual(b.get(t.f.at.id,budget.id),budget);assert.deepEqual(b.pdf(t.f.at.id,budget.id),pdf);assert.equal(t.removes+t.adds+t.confirmations,0)
 }finally{t.db.close()}
})

for(const kind of ['http','lost-flag','bad-flag','read-after-commit']as const)test(`Fase1 ${kind} flag failure requires read-first recovery, never DELETE or duplicate POST`,async()=>{
 const t=fixture(),write=t.io.setEnabled,read=t.io.read;let fault=true
 try{if(kind==='read-after-commit')t.io.read=async id=>{if(fault)throw Error('QA GET 503');return read(id)};else t.io.setEnabled=async(...args)=>{if(!fault)return write(...args);if(kind==='http')throw Error('QA HTTP');const ack=await write(...args);if(kind==='lost-flag')throw Error('QA response lost');return{...ack,revision:0}};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert(t.saved(t.codes[0]!));assert.equal(t.state.intents.get(t.codes[0]!),false);fault=false;assert(await t.q.recover());assert.equal(t.read().items.find(p=>p.pieceId===t.identities.get(t.codes[0]!))!.enabled,false);assert.equal(t.removes+t.adds+t.confirmations,0);assert.equal(t.flags,1)}finally{t.db.close()}
})

test('Fase1 concurrent scenario edit blocks flag write; explicit recovery preserves other flags and last intention',async()=>{
 const t=fixture();try{const original=t.io.setEnabled;let conflict=true;t.io.setEnabled=async(...args)=>{if(conflict){conflict=false;const scene=t.read().scenarios[0]!,other=t.initial.items.find(p=>p.pieceId===t.identities.get(t.codes[1]!))!;t.f.scenarios.update(t.f.at.id,scene.id,{revision:scene.revision,pieceFlags:{[other.id]:false}})}return original(...args)};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert.equal(t.read().items.find(p=>p.pieceId===t.identities.get(t.codes[0]!))!.enabled,true);assert(await t.q.recover());for(const code of t.codes.slice(0,2))assert.equal(t.read().items.find(p=>p.pieceId===t.identities.get(code))!.enabled,false);assert.equal(t.removes,0)}finally{t.db.close()}
})

test('Fase1 explicit delete of a blank piece always asks consent, while disabling never asks or removes',async()=>{
 const t=fixture();try{t.io.confirmRemoval=async r=>{assert(r.required);assert(!r.hasContent);return false};const code=t.codes[0]!;assert.equal(await t.q.enqueueRemoval([code],t.initial,t.identities),false);assert.equal(t.removes+t.reads+t.flags,0);await t.q.enqueue([code],false,t.initial,t.identities);await until(()=>t.q.status==='idle');assert(t.saved(code));assert.equal(t.removes,0)}finally{t.db.close()}
})

test('Fase1 another writer changing the same flag between acknowledged PATCH and GET cannot be silently overwritten',async()=>{
 const t=fixture(),read=t.io.read;let competing=true
 try{const target=t.initial.items.find(p=>p.pieceId===t.identities.get(t.codes[0]!))!;t.io.read=async id=>{if(competing){competing=false;const s=t.f.scenarios.list(t.f.at.id)[0]!;t.f.scenarios.update(t.f.at.id,s.id,{revision:s.revision,pieceFlags:{[target.id]:true}})}return read(id)};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert.equal(t.flags,1);assert.equal(t.read().scenarios[0]!.pieceFlags[target.id],true);assert.equal(t.state.intents.get(t.codes[0]!),false);assert(await t.q.recover());assert.equal(t.flags,2);assert.equal(t.read().scenarios[0]!.pieceFlags[target.id],false);assert.equal(t.removes+t.adds,0)}finally{t.db.close()}
})

test('Fase1 newly added master concurrently disabled after POST ACK stays intact and blocked until explicit recovery',async()=>{
 const t=fixture(),read=t.io.read,extra=t.catalog.find(c=>c.kind==='peca'&&c.code&&!t.initial.items.some(p=>p.pieceId===c.id))!;let competing=true
 try{t.io.read=async id=>{if(competing){competing=false;const w=t.read(),p=w.items.find(p=>p.pieceId===extra.id)!;t.f.scenarios.update(t.f.at.id,id,{revision:w.scenarios[0]!.revision,pieceFlags:{[p.id]:false}})}return read(id)};await t.q.enqueue([extra.code!],true,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert(t.saved(extra.code!));assert.equal(t.flags,0);assert.equal(t.read().items.find(p=>p.pieceId===extra.id)!.enabled,false);assert(await t.q.recover());assert.equal(t.adds,1);assert.equal(t.flags,1);assert.equal(t.removes,0)}finally{t.db.close()}
})
