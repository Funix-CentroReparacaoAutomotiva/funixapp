import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {CommercialRepository} from '../commercial.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {approvedPieces,planApprovedPieces,applyApprovedPieces} from '../approved-pieces-165.ts'
import {requiredVehicleCatalog} from '../default-vehicle-composition.ts'
import {classifyPiece,selectablePieces} from '../../src/piece-navigation.ts'

function seedVehicleCatalog(db:ReturnType<typeof openDatabase>){
 for(const r of requiredVehicleCatalog)db.prepare("INSERT INTO catalog_items(id,kind,name,status,source,service_id,created_at,updated_at) VALUES (?,?,?,'validado','operador',?,'QA','QA')").run(r.id,r.kind,r.name,r.serviceId)
}
test('#165: atualização explícita inclui todas as molduras e peças sem lado, sem duplicação ou alteração de schema',()=>{
 const db=openDatabase(':memory:')
 try{
  seedVehicleCatalog(db)
  const repo=new CommercialRepository(db),before=repo.catalogs().items
  const plan=planApprovedPieces(db)
  assert.equal(plan.conflicts.length,0)
  assert.equal(plan.decisions.filter(d=>d.action==='insert').length,13)
  assert.equal(plan.decisions.filter(d=>d.action==='reuse').length,2)
  assert.deepEqual(repo.catalogs().items,before)
  applyApprovedPieces(db,plan.planHash)
  const items=repo.catalogs().items
  assert.equal(items.length,before.length+13)
  for(const definition of approvedPieces){
   const item=items.find(p=>p.code===definition.code)!
   assert(item);assert.equal(item.name,definition.name);assert.equal(item.side,'')
   assert.equal(items.filter(p=>p.code===definition.code).length,1)
   assert.equal(selectablePieces(items).get(definition.code)?.id,item.id)
   assert.equal(classifyPiece(item),definition.code==='veiculo_completo'?'Outros':definition.code.startsWith('moldura')?'Acessórios':'Lataria')
  }
  assert.equal(items.find(p=>p.code==='moldura')!.name,'Moldura')
  for(const prior of before)assert.deepEqual(items.find(p=>p.id===prior.id),prior)
  const again=planApprovedPieces(db);assert.equal(again.conflicts.length,0);assert(again.decisions.every(d=>d.action==='reuse'))
  applyApprovedPieces(db,again.planHash);assert.deepEqual(repo.catalogs().items,items)
  const at=new AtendimentoRepository(db).create({phone:'123'})
  const selected=repo.add(at.id,{pieceCodes:['moldura_porta_dianteira']})
  assert.equal(selected.length,2)
  assert.equal(selected.find(p=>p.pieceId===items.find(x=>x.code==='moldura_porta_dianteira')!.id)!.pieceId,items.find(p=>p.code==='moldura_porta_dianteira')!.id)
  assert.deepEqual(selected.find(p=>p.pieceId===items.find(x=>x.code==='moldura_porta_dianteira')!.id)!.services,[])
  assert.deepEqual(repo.add(at.id,{pieceCodes:['moldura_porta_dianteira']}),selected)
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,28)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('#165: conflito de identidade ou mudança após dry-run bloqueia todo o lote',()=>{
 const db=openDatabase(':memory:')
 try{
  seedVehicleCatalog(db)
  const repo=new CommercialRepository(db),plan=planApprovedPieces(db)
  repo.saveCatalog({kind:'peca',name:'Moldura da porta dianteira',code:'moldura_local'})
  const before=repo.catalogs().items
  assert.throws(()=>applyApprovedPieces(db,plan.planHash),/mudou/)
  const changed=planApprovedPieces(db)
  assert(changed.conflicts.some(c=>c.code==='moldura_porta_dianteira'))
  assert.throws(()=>applyApprovedPieces(db,changed.planHash),/Conflito/)
  assert.deepEqual(repo.catalogs().items,before)
 }finally{db.close()}
})

test('#162: instalação sem pré-requisitos não ativa o catálogo',()=>{const db=openDatabase(':memory:');try{const p=planApprovedPieces(db);assert.equal(p.prerequisites.length,4);assert.throws(()=>applyApprovedPieces(db,p.planHash),/Pré-requisitos/);assert.equal(new CommercialRepository(db).catalogs().items.length,163)}finally{db.close()}})
