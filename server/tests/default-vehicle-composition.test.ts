import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CommercialRepository} from '../commercial.ts'
import {ScenarioRepository} from '../scenarios.ts'
import {TABLES,sourceId} from '../coda-import-source.ts'

const diagnosis=sourceId(TABLES.diagnoses,'i-UtUmAlS5ma')
const technical=sourceId(TABLES.services,'i-GsuErCDZgL')
const washing=sourceId(TABLES.services,'i-AlsNigbGqx')

function sourceCatalog(db:ReturnType<typeof openDatabase>,ids:('diagnosis'|'technical'|'washing')[]=['diagnosis','technical','washing']){
 const all={diagnosis:[diagnosis,'diagnostico','Cuidados operacionais'],technical:[technical,'servico','Diagnóstico Técnico'],washing:[washing,'servico','Lavagem']} as const
 for(const key of ids){
  const [id,kind,name]=all[key]
  const now='2026-11-16T12:00:00.000Z'
  db.prepare("INSERT INTO catalog_items(id,kind,name,status,source,created_at,updated_at) VALUES (?,?,?,'validado','operador',?,?)").run(id,kind,name,now,now)
 }
}
function newAt(db:ReturnType<typeof openDatabase>){return new AtendimentoRepository(db).create({phone:'123'})}

test('#162: novo Atendimento inclui Veículo/Cuidados operacionais e dois serviços inativos, sem dimensão, uma única vez',()=>{
 const db=openDatabase(':memory:')
 try{
  sourceCatalog(db)
  const at=newAt(db),repo=new CommercialRepository(db),items=repo.list(at.id)
  assert.equal(items.length,1)
  assert.equal(repo.item(items[0]!.pieceId).code,'veiculo_completo')
  assert.equal(items[0]!.diagnosisId,diagnosis)
  assert.equal(items[0]!.enabled,true)
  assert.deepEqual(items[0]!.services.map(s=>s.serviceId),[technical,washing])
  assert(items[0]!.services.every(s=>s.enabled===false&&s.dimensionId===null&&s.quantity==='1'))
  const initial=new ScenarioRepository(db).list(at.id)[0]!
  assert.equal(initial.pieceFlags[items[0]!.id],true)
  for(const line of items[0]!.services)assert.equal(initial.serviceFlags[line.id],false)
  const updated=new AtendimentoRepository(db).update(at.id,{revision:at.revision,notes:'Editado'})
  assert.equal(updated.notes,'Editado')
  assert.deepEqual(repo.list(at.id),items)
  const scenario=new ScenarioRepository(db).create(at.id,{name:'Alternativo',duplicateFrom:initial.id,sourceRevision:initial.revision})
  for(const line of items[0]!.services)assert.equal(scenario.serviceFlags[line.id],false)
  assert.deepEqual(repo.list(at.id),items)
  const second=newAt(db)
  const other=repo.list(second.id)
  assert.equal(other.length,1)
  assert.notEqual(other[0]!.id,items[0]!.id)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('#162: dimensão e flag de serviço podem ser editadas manualmente, sem atribuição automática',()=>{
 const db=openDatabase(':memory:')
 try{
  sourceCatalog(db)
  const at=newAt(db),repo=new CommercialRepository(db),piece=repo.list(at.id)[0]!
  const dimension=repo.saveCatalog({kind:'dimensao',name:'P',serviceId:washing})
  const services=piece.services.map(s=>({...s,dimensionId:s.serviceId===washing?dimension.id:null,enabled:s.serviceId===washing}))
  const updated=repo.updateDiagnosis(at.id,piece.id,{revision:piece.revision,diagnosisId:diagnosis,enabled:true,services})
  const wash=updated.services.find(s=>s.serviceId===washing)!
  assert.equal(wash.dimensionId,dimension.id)
  assert.equal(wash.enabled,true)
  assert.equal(updated.services.find(s=>s.serviceId===technical)!.enabled,false)
  assert.equal(repo.list(at.id)[0]!.services.find(s=>s.id===wash.id)!.enabled,true)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('#162: origem parcialmente importada bloqueia criação atômica sem Atendimento órfão',()=>{
 const db=openDatabase(':memory:')
 try{
  sourceCatalog(db,['diagnosis','technical'])
  const before=db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n
  assert.throws(()=>newAt(db),(e:unknown)=>e instanceof Error&&e.message.includes('configuração canônica'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n,before)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scenarios').get()!.n,0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM diagnosis_items').get()!.n,0)
 }finally{db.close()}
})

test('#162: sem importação Coda, banco de desenvolvimento conserva criação anterior sem linhas fictícias',()=>{
 const db=openDatabase(':memory:')
 try{
  const at=newAt(db)
  assert.deepEqual(new CommercialRepository(db).list(at.id),[])
 }finally{db.close()}
})
