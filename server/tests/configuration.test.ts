import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CommercialRepository} from '../commercial.ts'
import {ScenarioRepository} from '../scenarios.ts'
import {ComponentRepository} from '../components.ts'
import {PricingConfigurationRepository} from '../pricing-config.ts'

test('configuration starts empty, validates exact keys/references/decimals, tracks revisions and rejects stale edits',()=>{
 const db=openDatabase(':memory:')
 try {
  const repo=new PricingConfigurationRepository(db),initial=repo.get()
  assert.equal(initial.config.capacity,null);assert.deepEqual(initial.config.tables,[])
  assert.throws(()=>repo.save({revision:1,config:{...initial.config,capacity:'0'}}))
  assert.throws(()=>repo.save({revision:1,config:{...initial.config,capacity:4}}))
  const config={...initial.config,capacity:'4',tables:[{id:'table',name:'Sintética',factor:'1'}]}
  const saved=repo.save({revision:1,config});assert.equal(saved.revision,2)
  assert.throws(()=>repo.save({revision:1,config}))
  const c=new CommercialRepository(db),service=c.saveCatalog({kind:'servico',name:'S',status:'validado'}),dimension=c.saveCatalog({kind:'dimensao',name:'D',serviceId:service.id,status:'validado'})
  const special={tableId:'table',serviceId:service.id,dimensionId:dimension.id,unit:'0'}
  assert.throws(()=>repo.save({revision:2,config:{...config,specialPrices:[special,special]}}))
  assert.equal(repo.get().revision,2)
  assert.equal(repo.save({revision:2,config:{...config,specialPrices:[special]}}).config.specialPrices[0]!.unit,'0')
 }finally{db.close()}
})
test('component monetary identity is independent from physical piece; mask duplication, fractional quantity, explicit zero and delete cascade',()=>{
 const db=openDatabase(':memory:')
 try {
  const at=new AtendimentoRepository(db).create({phone:'123'}),c=new CommercialRepository(db),s=new ScenarioRepository(db),parts=new ComponentRepository(db)
  const piece=c.catalogs().items.find(p=>p.code==='capo')!;c.saveCatalog({revision:1,status:'validado'},piece.id)
  const p=c.add(at.id,{pieceCodes:['capo']})[0]!,a=s.list(at.id)[0]!,b=s.create(at.id,{name:'B',duplicateFrom:a.id,sourceRevision:a.revision})
  const input={pieceId:p.id,name:'Peça monetária',quantity:'0.25',manualPrice:'0',fct:'1.2',notes:'',scenarioId:b.id}
  const part=parts.save(at.id,input)
  assert.notEqual(part.id,p.id);assert.equal(part.manualPrice,'0');assert.equal(part.quantity,'0.25')
  assert.equal(s.list(at.id).find(x=>x.id===a.id)!.componentFlags[part.id],false)
  const bs=s.list(at.id).find(x=>x.id===b.id)!,copy=s.create(at.id,{name:'C',duplicateFrom:b.id,sourceRevision:bs.revision})
  assert.equal(copy.componentFlags[part.id],true)
  const edited=parts.save(at.id,{...input,revision:part.revision,manualPrice:null},part.id)
  assert.equal(edited.id,part.id);assert.equal(edited.manualPrice,null)
  assert.throws(()=>parts.save(at.id,{...input,revision:1},part.id))
  assert.throws(()=>parts.save(at.id,{...input,pieceId:'other'}))
  parts.remove(at.id,part.id,{revision:edited.revision})
  assert.equal(db.prepare('SELECT count(*) AS n FROM scenario_component_flags').get()!.n,0)
  assert.equal(c.list(at.id)[0]!.id,p.id)
 }finally{db.close()}
})
