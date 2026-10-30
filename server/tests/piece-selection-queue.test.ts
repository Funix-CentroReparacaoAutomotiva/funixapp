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

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return{promise,resolve}}
async function until(check:()=>boolean){for(let n=0;n<100&&!check();n++)await setImmediate();assert(check(),'queue did not reach expected state')}
function fixture(){
 const db=openDatabase(':memory:'),f=commercialFixture(db),parts=new ComponentRepository(db)
 const catalog=f.commercial.catalogs().items,pieces=catalog.filter(p=>p.kind==='peca'&&p.code&&p.active).slice(0,6)
 for(const p of pieces)f.commercial.add(f.at.id,{pieceCodes:[p.code!]})
 let s=f.scenarios.list(f.at.id)[0]!;f.scenarios.update(f.at.id,s.id,{revision:s.revision,pieceFlags:Object.fromEntries(f.commercial.list(f.at.id).map(p=>[p.id,false]))})
 function read(id=f.scenarios.list(f.at.id)[0]!.id):CommercialWorkspace{
  const scenarios=f.scenarios.list(f.at.id),selectedId=scenarios.some(s=>s.id===id)?id:scenarios[0]!.id,items=f.commercial.list(f.at.id,selectedId),components=parts.list(f.at.id),settings=f.pricing.settings(f.at.id),cfg=f.pricing.get()
  return{scenarios,selectedId,items,components,settings:settings.settings,revision:settings.revision,configurationRevision:cfg.revision,calculations:scenarios.map(s=>calculate(items,components,catalog,s,cfg.config,settings.settings))}
 }
 const initial=read(),identities=new Map(pieces.map(p=>[p.code!,p.id])),codes=pieces.map(p=>p.code!),saved=(code:string,id=initial.selectedId)=>{const item=f.commercial.list(f.at.id,id).find(p=>p.pieceId===identities.get(code));return Boolean(item&&f.scenarios.list(f.at.id).find(s=>s.id===id)?.pieceFlags[item.id])}
 let state:SelectionState={phase:'idle',intents:new Map(),error:null},confirmed=initial,adds=0,patches=0,reads=0
 const io:PieceSelectionTransport={read:async id=>{reads++;return read(id)},add:async(codes,id,revision)=>{adds++;return f.commercial.add(f.at.id,{pieceCodes:codes,scenarioId:id,scenarioRevision:revision})},flags:async(flags,id,revision)=>{patches++;return f.scenarios.update(f.at.id,id,{revision,pieceFlags:flags})},confirmed:w=>{confirmed=w},changed:s=>{state=s}}
 const q=new PieceSelectionQueue(f.at.id,io)
 return{db,f,parts,catalog,pieces,codes,identities,initial,read,saved,io,q,get state(){return state},get confirmed(){return confirmed},get adds(){return adds},get patches(){return patches},get reads(){return reads}}
}

test('Etapa C serializes four rapid intentions, consolidates reversals and keeps last choice while an old confirmation is pending',async()=>{
 const t=fixture(),gate=deferred(),original=t.io.flags;let inFlight=0,max=0
 try{
  t.io.flags=async(...args)=>{inFlight++;max=Math.max(max,inFlight);await gate.promise;try{return await original(...args)}finally{inFlight--}}
  t.q.enqueue([t.codes[0]!],true,t.initial,t.identities);await until(()=>inFlight===1)
  for(const code of t.codes.slice(1,4))assert(t.q.enqueue([code],true,t.initial,t.identities))
  t.q.enqueue([t.codes[0]!],false,t.initial,t.identities);t.q.enqueue([t.codes[1]!],false,t.initial,t.identities);t.q.enqueue([t.codes[1]!],true,t.initial,t.identities)
  assert.equal(t.state.intents.get(t.codes[0]!),false);assert.equal(t.patches,0)
  gate.resolve();await until(()=>t.q.status==='idle')
  assert.equal(max,1);assert.equal(t.saved(t.codes[0]!),false);for(const c of t.codes.slice(1,4))assert(t.saved(c));assert.equal(t.patches,2)
  assert.equal(t.state.intents.size,0);assert.equal(t.adds,0)
 }finally{t.db.close()}
})

test('Etapa C a tap using stale React workspace after confirmation uses the actual latest revision',async()=>{
 const t=fixture()
 try{t.q.enqueue([t.codes[0]!],true,t.initial,t.identities);await until(()=>t.q.status==='idle');t.q.enqueue([t.codes[1]!],true,t.initial,t.identities);await until(()=>t.q.status==='idle');assert(t.saved(t.codes[0]!));assert(t.saved(t.codes[1]!));assert.equal(t.patches,2)}finally{t.db.close()}
})

for(const kind of ['http','lost-patch','bad-patch','read-after-commit']as const)test(`Etapa C ${kind}: explicit recovery reads first, preserves latest intentions and never replays a confirmed flag`,async()=>{
 const t=fixture(),write=t.io.flags,read=t.io.read;let fault=true
 try{
  if(kind==='read-after-commit')t.io.read=async id=>{if(fault)throw Error('QA GET 503');return read(id)}
  else t.io.flags=async(...args)=>{if(!fault)return write(...args);if(kind==='http')throw Error('QA HTTP 500 before delivery');const ack=await write(...args);if(kind==='lost-patch')throw Error('QA lost response');return{...ack,revision:undefined}as unknown as typeof ack}
  t.q.enqueue([t.codes[0]!],true,t.initial,t.identities);await until(()=>t.q.status==='blocked')
  assert.equal(t.state.intents.get(t.codes[0]!),true);assert.equal(t.q.enqueue([t.codes[1]!],true,t.initial,t.identities),false)
  assert.equal(t.saved(t.codes[0]!),kind!=='http');fault=false;assert(await t.q.recover());assert(t.saved(t.codes[0]!));assert.equal(t.patches,1)
 }finally{t.db.close()}
})

test('Etapa C lost creation response recovers the actual stable ID without a duplicate POST or clearing services/components',async()=>{
 const t=fixture(),post=t.io.add,known=t.f.commercial.list(t.f.at.id),extra=t.catalog.find(c=>c.kind==='peca'&&c.code&&!known.some(p=>p.pieceId===c.id))!,ids=new Map([...t.identities,[extra.code!,extra.id]]);let fault=true
 try{
  const oldServices=JSON.stringify(known.flatMap(p=>p.services));t.io.add=async(...args)=>{const result=await post(...args);if(fault)throw Error('QA POST committed, body lost');return result}
  t.q.enqueue([extra.code!],true,t.initial,ids);await until(()=>t.q.status==='blocked');const created=t.f.commercial.list(t.f.at.id).find(p=>p.pieceId===extra.id)!.id
  fault=false;assert(await t.q.recover());assert.equal(t.adds,1);assert.equal(t.f.commercial.list(t.f.at.id).filter(p=>p.pieceId===extra.id).length,1);assert.equal(t.f.commercial.list(t.f.at.id).find(p=>p.pieceId===extra.id)!.id,created)
  assert.equal(JSON.stringify(t.f.commercial.list(t.f.at.id).filter(p=>p.id!==created).flatMap(p=>p.services)),oldServices)
 }finally{t.db.close()}
})

test('Etapa C add/on/off across pending creation leaves one stable master row excluded, without touching other scenarios',async()=>{
 const t=fixture(),post=t.io.add,gate=deferred(),other=t.f.scenarios.create(t.f.at.id,{name:'Outro'}),extra=t.catalog.find(c=>c.kind==='peca'&&c.code&&!t.initial.items.some(p=>p.pieceId===c.id))!,ids=new Map([...t.identities,[extra.code!,extra.id]]);let started=false
 try{
  t.io.add=async(...args)=>{started=true;await gate.promise;return post(...args)}
  t.q.enqueue([extra.code!],true,t.initial,ids);await until(()=>started);t.q.enqueue([extra.code!],false,t.initial,ids);gate.resolve();await until(()=>t.q.status==='idle')
  const rows=t.f.commercial.list(t.f.at.id),p=rows.find(p=>p.pieceId===extra.id)!;assert.equal(rows.filter(p=>p.pieceId===extra.id).length,1);assert.equal(p.enabled,false);assert.equal(t.f.scenarios.list(t.f.at.id).find(s=>s.id===other.id)!.pieceFlags[p.id],false)
 }finally{t.db.close()}
})

test('Etapa C real revision conflict stops; deliberate rebase preserves unrelated external flags and row attributes',async()=>{
 const t=fixture(),s=t.f.scenarios.list(t.f.at.id)[0]!,other=t.initial.items.find(p=>p.pieceId===t.identities.get(t.codes[1]!))!
 try{t.f.scenarios.update(t.f.at.id,s.id,{revision:s.revision,pieceFlags:{[other.id]:true}});t.q.enqueue([t.codes[0]!],true,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert(!t.saved(t.codes[0]!));assert(t.saved(t.codes[1]!));assert(await t.q.recover());assert(t.saved(t.codes[0]!));assert(t.saved(t.codes[1]!));assert.deepEqual(t.f.commercial.list(t.f.at.id).map(p=>p.services),t.initial.items.map(p=>p.services))}finally{t.db.close()}
})

test('Etapa C deleted pending piece or scenario never becomes a new master row or a write into the fallback scenario',async()=>{
 const t=fixture()
 try{
  const p=t.initial.items.find(p=>p.pieceId===t.identities.get(t.codes[0]!))!;t.f.commercial.remove(t.f.at.id,p.id,{revision:p.revision});t.q.enqueue([t.codes[0]!],true,t.initial,t.identities);await until(()=>t.q.status==='blocked');assert.equal(await t.q.recover(),false);assert.equal(t.adds,0);assert(t.q.discard())
  const second=t.f.scenarios.create(t.f.at.id,{name:'Excluir'}),w=t.read(second.id);t.f.scenarios.remove(t.f.at.id,second.id,{revision:second.revision});t.q.enqueue([t.codes[1]!],true,w,t.identities);await until(()=>t.q.status==='blocked');assert.equal(await t.q.recover(),false);assert.equal(t.patches,2);assert.equal(t.saved(t.codes[1]!),false);assert.equal(t.f.scenarios.list(t.f.at.id).length,1)
 }finally{t.db.close()}
})

test('Etapa C same-event reversal resolves pending intention before React renders and avoids unnecessary creation',async()=>{
 const t=fixture(),code=t.codes[0]!
 try{for(let i=0;i<2;i++)t.q.enqueue([code],!t.q.desired(code,false),t.initial,t.identities);await until(()=>t.q.status==='idle');assert.equal(t.saved(code),false);assert.equal(t.patches,0);assert.equal(t.adds,0)}finally{t.db.close()}
})
