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
 let state:SelectionState={phase:'idle',intents:new Map(),error:null},confirmed=initial,adds=0,removes=0,reads=0,confirmations=0
 const io:PieceSelectionTransport={read:async id=>{reads++;return read(id)},add:async(codes,id,revision)=>{adds++;return f.commercial.add(f.at.id,{pieceCodes:codes,scenarioId:id,scenarioRevision:revision})},remove:async request=>{removes++;return f.commercial.removeMany(f.at.id,request)},confirmRemoval:async()=>{confirmations++;return true},confirmed:w=>{confirmed=w},changed:s=>{state=s}}
 const q=new PieceSelectionQueue(f.at.id,io)
 return{db,f,parts,catalog,pieces,codes,identities,initial,read,saved,io,q,get state(){return state},get confirmed(){return confirmed},get adds(){return adds},get removes(){return removes},get reads(){return reads},get confirmations(){return confirmations}}
}
test('Stage2 global presence is independent of scenario enablement; selecting an existing disabled master never re-enables it',async()=>{
 const t=fixture();try{const p=t.initial.items.find(p=>p.pieceId===t.identities.get(t.codes[0]!))!,s=t.f.scenarios.list(t.f.at.id)[0]!;t.f.scenarios.update(t.f.at.id,s.id,{revision:s.revision,pieceFlags:{[p.id]:false}});await t.q.enqueue([t.codes[0]!],true,t.read(),t.identities);await until(()=>t.q.status==='idle');assert(t.saved(t.codes[0]!));assert.equal(t.f.commercial.list(t.f.at.id).find(i=>i.id===p.id)!.enabled,false);assert.equal(t.adds+t.removes,0)}finally{t.db.close()}
})
test('Stage2 serializes rapid removals, consolidates reversal and preserves unrelated master/children and last intentions',async()=>{
 const t=fixture(),gate=deferred(),original=t.io.remove;let inFlight=0,max=0
 try{t.io.remove=async request=>{inFlight++;max=Math.max(max,inFlight);await gate.promise;try{return await original(request)}finally{inFlight--}};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>inFlight===1);for(const c of t.codes.slice(1,4))await t.q.enqueue([c],false,t.initial,t.identities);await t.q.enqueue([t.codes[0]!,t.codes[1]!],true,t.initial,t.identities);gate.resolve();await until(()=>t.q.status==='idle');assert.equal(max,1);assert(t.saved(t.codes[0]!));assert(t.saved(t.codes[1]!));for(const c of t.codes.slice(2,4))assert(!t.saved(c));assert.deepEqual(t.f.commercial.list(t.f.at.id).find(p=>p.id===t.f.item.id)!.services,t.f.item.services);assert.equal(t.state.intents.size,0)}finally{t.db.close()}
})
test('Stage2 stale React workspace uses actual latest guard after confirmed removal',async()=>{
 const t=fixture();try{await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>t.q.status==='idle');await t.q.enqueue([t.codes[1]!],false,t.initial,t.identities);await until(()=>t.q.status==='idle');assert(!t.saved(t.codes[0]!));assert(!t.saved(t.codes[1]!));assert.equal(t.removes,2)}finally{t.db.close()}
})
for(const kind of ['http','lost-delete','bad-delete','read-after-commit']as const)test(`Stage2 ${kind}: explicit recovery reads first and never repeats a committed removal`,async()=>{
 const t=fixture(),write=t.io.remove,read=t.io.read;let fault=true
 try{if(kind==='read-after-commit')t.io.read=async id=>{if(fault)throw Error('QA GET 503');return read(id)};else t.io.remove=async request=>{if(!fault)return write(request);if(kind==='http')throw Error('QA HTTP before delivery');const ack=await write(request);if(kind==='lost-delete')throw Error('QA lost reply');return{removedIds:[]}as typeof ack};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert.equal(t.state.intents.get(t.codes[0]!),false);assert.equal(await t.q.enqueue([t.codes[1]!],false,t.initial,t.identities),false);assert.equal(t.saved(t.codes[0]!),kind==='http');fault=false;assert(await t.q.recover());assert(!t.saved(t.codes[0]!));assert.equal(t.removes,1)}finally{t.db.close()}
})
test('Stage2 lost creation response recovers the actual stable ID without duplicate POST or clearing existing services',async()=>{
 const t=fixture(),post=t.io.add,extra=t.catalog.find(c=>c.kind==='peca'&&c.code&&!t.initial.items.some(p=>p.pieceId===c.id))!;let fault=true
 try{t.io.add=async(...args)=>{const result=await post(...args);if(fault)throw Error('QA POST committed, body lost');return result};await t.q.enqueue([extra.code!],true,t.initial,t.identities);await until(()=>t.q.status==='blocked');const created=t.f.commercial.list(t.f.at.id).find(p=>p.pieceId===extra.id)!.id;fault=false;assert(await t.q.recover());assert.equal(t.adds,1);assert.equal(t.f.commercial.list(t.f.at.id).filter(p=>p.pieceId===extra.id).length,1);assert.equal(t.f.commercial.list(t.f.at.id).find(p=>p.pieceId===extra.id)!.id,created);assert.deepEqual(t.f.commercial.list(t.f.at.id).find(p=>p.id===t.f.item.id)!.services,t.f.item.services)}finally{t.db.close()}
})
test('Stage2 add then remove during pending creation ends absent globally, without leaving duplicate or disabled orphan master',async()=>{
 const t=fixture(),post=t.io.add,gate=deferred(),extra=t.catalog.find(c=>c.kind==='peca'&&c.code&&!t.initial.items.some(p=>p.pieceId===c.id))!;let started=false
 try{t.io.add=async(...args)=>{started=true;await gate.promise;return post(...args)};await t.q.enqueue([extra.code!],true,t.initial,t.identities);await until(()=>started);await t.q.enqueue([extra.code!],false,t.initial,t.identities);gate.resolve();await until(()=>t.q.status==='idle');assert(!t.saved(extra.code!));assert.equal(t.adds,1);assert.equal(t.removes,1)}finally{t.db.close()}
})
test('Stage2 cancellation of configured or multi-scenario removal changes no state and sends no read/write',async()=>{
 const t=fixture();try{t.io.confirmRemoval=async r=>{assert(r.required);assert(r.hasContent);return false};const before=JSON.stringify(t.read());assert.equal(await t.q.enqueue(['capo'],false,t.initial,t.identities),false);assert.equal(JSON.stringify(t.read()),before);assert.equal(t.reads+t.adds+t.removes,0);assert.equal(t.state.intents.size,0);assert.equal(t.q.status,'idle')}finally{t.db.close()}
})
test('Stage2 confirmation context changes block deletion; recovery reconfirms changed children and Cancel preserves them',async()=>{
 const t=fixture();let confirmations=0
 try{t.io.confirmRemoval=async()=>{confirmations++;if(confirmations===1){t.parts.save(t.f.at.id,{pieceId:t.f.item.id,name:'QA extra',quantity:'0.25',manualPrice:'2',notes:''});return true}return false};await t.q.enqueue(['capo'],false,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert(t.saved('capo'));assert(await t.q.recover());assert.equal(confirmations,2);assert(t.saved('capo'));assert.equal(t.parts.list(t.f.at.id).length,1)}finally{t.db.close()}
})
test('Stage2 externally recreated master never gets removed by recovery of an old pending deletion',async()=>{
 const t=fixture();let replacement=''
 try{t.io.remove=async()=>{const w=t.read();t.f.commercial.removeMany(t.f.at.id,removalRequest(w,[t.codes[0]!],t.identities));t.f.commercial.add(t.f.at.id,{pieceCodes:[t.codes[0]!]});replacement=t.read().items.find(p=>p.pieceId===t.identities.get(t.codes[0]!))!.id;throw Error('QA conflict')};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert.equal(await t.q.recover(),false);assert(t.saved(t.codes[0]!));assert.equal(t.read().items.find(p=>p.id===replacement)!.id,replacement);assert(t.q.discard())}finally{t.db.close()}
})
test('Stage2 same-event off/on of empty existing master avoids writes and preserves its ID',async()=>{
 const t=fixture();try{const before=JSON.stringify(t.initial.items);void t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);void t.q.enqueue([t.codes[0]!],true,t.initial,t.identities);await until(()=>t.q.status==='idle');assert.equal(t.removes+t.adds,0);assert.equal(JSON.stringify(t.read().items),before)}finally{t.db.close()}
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
  t.io.confirmRemoval=async()=>false;const before=JSON.stringify(t.read());assert.equal(await t.q.enqueue(['capo',t.codes[0]!],false,t.initial,t.identities),false);assert.equal(JSON.stringify(t.read()),before);assert.equal(t.adds+t.removes+t.reads,0)
  t.io.confirmRemoval=async()=>{awaiting=true;await gate.promise;return true};const pending=t.q.enqueue(['capo'],false,t.initial,t.identities);await until(()=>awaiting);t.q.suspend();gate.resolve();assert.equal(await pending,false);assert.equal(t.adds+t.removes+t.reads,0);assert.equal(JSON.stringify(t.read()),before)
 }finally{t.db.close()}
})
test('Stage2 malformed workspace after acknowledged delete stays blocked, preserving intent until a valid read',async()=>{
 const t=fixture(),read=t.io.read;let corrupt=true
 try{t.io.read=async id=>{const w=await read(id);if(corrupt)delete(w.scenarios[0]as unknown as Record<string,unknown>).componentFlags;return w};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert.equal(t.state.intents.get(t.codes[0]!),false);corrupt=false;assert(await t.q.recover());assert.equal(t.removes,1);assert(!t.saved(t.codes[0]!))}finally{t.db.close()}
})
test('Stage2 an interleaved single tap never splits a pending Ambos removal into separate transactions',async()=>{
 const t=fixture(),gate=deferred(),remove=t.io.remove,batches:string[][]=[];let started=false
 try{t.io.remove=async r=>{batches.push(r.pieces.map(p=>p.id));if(!started){started=true;await gate.promise}return remove(r)};await t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);await until(()=>started);await t.q.enqueue([t.codes[1]!],false,t.initial,t.identities);await t.q.enqueue([t.codes[2]!,t.codes[3]!],false,t.initial,t.identities);gate.resolve();await until(()=>t.q.status==='idle');const pair=t.initial.items.filter(p=>[t.identities.get(t.codes[2]!),t.identities.get(t.codes[3]!)].includes(p.pieceId)).map(p=>p.id).sort();assert(batches.some(b=>JSON.stringify([...b].sort())===JSON.stringify(pair)));assert(batches.filter(b=>b.some(id=>pair.includes(id))).every(b=>b.length===2&&b.every(id=>pair.includes(id))))}finally{t.db.close()}
})
