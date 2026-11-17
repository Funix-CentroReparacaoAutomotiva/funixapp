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
const washingM=sourceId(TABLES.dimensions,'i-07mjG2Tryl')

function sourceCatalog(db:ReturnType<typeof openDatabase>,ids:('diagnosis'|'technical'|'washing'|'washingM')[]=['diagnosis','technical','washing','washingM']){
 const all={diagnosis:[diagnosis,'diagnostico','Cuidados operacionais',null],technical:[technical,'servico','Diagnóstico Técnico',null],washing:[washing,'servico','Lavagem',null],washingM:[washingM,'dimensao','M',washing]} as const
 for(const key of ids){
  const [id,kind,name,serviceId]=all[key]
  const now='2026-11-16T12:00:00.000Z'
  db.prepare("INSERT INTO catalog_items(id,kind,name,status,source,service_id,created_at,updated_at) VALUES (?,?,?,'validado','operador',?,?,?)").run(id,kind,name,serviceId,now,now)
 }
}
function newAt(db:ReturnType<typeof openDatabase>){return new AtendimentoRepository(db).create({phone:'123'})}

test('#162: novo Atendimento inclui avaliação desabilitada e Lavagem M habilitada, uma única vez',()=>{
 const db=openDatabase(':memory:')
 try{
  sourceCatalog(db)
  const at=newAt(db),repo=new CommercialRepository(db),items=repo.list(at.id)
  assert.equal(items.length,1)
  assert.equal(repo.item(items[0]!.pieceId).code,'veiculo_completo')
  assert.equal(items[0]!.diagnosisId,diagnosis)
  assert.equal(items[0]!.enabled,true)
  assert.deepEqual(items[0]!.services.map(s=>s.serviceId),[technical,washing])
  assert.equal(items[0]!.services[0]!.enabled,false)
  assert.equal(items[0]!.services[0]!.dimensionId,null)
  assert.equal(items[0]!.services[1]!.enabled,true)
  assert.equal(items[0]!.services[1]!.dimensionId,washingM)
  assert(items[0]!.services.every(s=>s.quantity==='1'))
  const initial=new ScenarioRepository(db).list(at.id)[0]!
  assert.equal(initial.pieceFlags[items[0]!.id],true)
  assert.equal(initial.serviceFlags[items[0]!.services[0]!.id],false)
  assert.equal(initial.serviceFlags[items[0]!.services[1]!.id],true)
  const updated=new AtendimentoRepository(db).update(at.id,{revision:at.revision,notes:'Editado'})
  assert.equal(updated.notes,'Editado')
  assert.deepEqual(repo.list(at.id),items)
  const scenario=new ScenarioRepository(db).create(at.id,{name:'Alternativo',duplicateFrom:initial.id,sourceRevision:initial.revision})
  assert.equal(scenario.serviceFlags[items[0]!.services[0]!.id],false)
  assert.equal(scenario.serviceFlags[items[0]!.services[1]!.id],true)
  assert.deepEqual(repo.list(at.id),items)
  const second=newAt(db)
  const other=repo.list(second.id)
  assert.equal(other.length,1)
  assert.notEqual(other[0]!.id,items[0]!.id)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('#162: operador pode desabilitar Lavagem M ou selecionar outra dimensão sem alterar avaliação',()=>{
 const db=openDatabase(':memory:')
 try{
  sourceCatalog(db)
  const at=newAt(db),repo=new CommercialRepository(db),piece=repo.list(at.id)[0]!
  const d=repo.saveCatalog({kind:'dimensao',name:'P',serviceId:washing})
  const services=piece.services.map(s=>({...s,dimensionId:s.serviceId===washing?d.id:null,enabled:false}))
  const updated=repo.updateDiagnosis(at.id,piece.id,{revision:piece.revision,diagnosisId:diagnosis,enabled:true,services})
  const wash=updated.services.find(s=>s.serviceId===washing)!
  assert.equal(wash.dimensionId,d.id)
  assert.equal(wash.enabled,false)
  assert.equal(updated.services.find(s=>s.serviceId===technical)!.enabled,false)
  assert.equal(repo.list(at.id)[0]!.services.find(s=>s.id===wash.id)!.enabled,false)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('#162: ausência de dimensão M impede criação parcial',()=>{
 const db=openDatabase(':memory:')
 try{
  sourceCatalog(db,['diagnosis','technical','washing'])
  assert.throws(()=>newAt(db),/Lavagem M/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM atendimentos').get()!.n,0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM diagnosis_services').get()!.n,0)
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
