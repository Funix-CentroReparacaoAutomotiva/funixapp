import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {createUpdatePackageSchema} from '../update-packages-schema.ts'
import {UpdatePackageRepository} from '../update-packages.ts'
import {
 createUpdatePackageSimulationSchema,UpdatePackageSimulationRepository
} from '../update-packages-simulation-store.ts'
import {actionSnapshotHash} from '../update-packages-execution-simulation.ts'

function harness(){
 const db=openDatabase(':memory:')
 createUpdatePackageSchema(db)
 createUpdatePackageSimulationSchema(db)
 const repository=new UpdatePackageRepository(db)
 const item=repository.createProposal({
  source:'gmail',sourceReference:'abcdef0123456789',experienceId:'XP1234',
  plate:'ABC1D23',title:'Teste de execução',summary:'Dados estritamente sintéticos',
  actions:[
   {id:'drive:photo',type:'drive_archive',title:'Arquivar foto sintética',detail:'Sem gravação'},
   {id:'erp:authorization',type:'erp_update',title:'Simular registro',detail:'Sem gravação'}
  ],
  missingFields:[]
 })
 const approved=repository.decide(item.id,{
  revision:item.revision,snapshotHash:item.snapshotHash,
  requestId:'11111111-1111-4111-8111-111111111111',decision:'approve'
 },'test_operator')
 const store=new UpdatePackageSimulationRepository(db,repository)
 return {db,repository,approved,store}
}
test('persistência simulada conserva sucesso após falha parcial, inclusive ao reinstanciar',()=>{
 const {db,repository,approved,store}=harness()
 try{
  const [photo,erp]=approved.actions
  const snapshot={revision:approved.revision,snapshotHash:approved.snapshotHash}
  const photoReceipt={actionId:photo!.id,actionHash:actionSnapshotHash(photo!),attempt:1,outcome:'succeeded' as const}
  const erpFailure={actionId:erp!.id,actionHash:actionSnapshotHash(erp!),attempt:1,outcome:'failed' as const}
  const first=store.record(approved.id,snapshot,photoReceipt)
  assert.deepEqual(first.succeeded,['drive:photo'])
  const partial=store.record(approved.id,snapshot,erpFailure)
  assert.equal(partial.nextStatus,'execution_failed')
  assert.deepEqual(partial.retryable,['erp:authorization'])
  const recovered=new UpdatePackageSimulationRepository(db,repository)
  assert.deepEqual(recovered.inspect(approved.id).succeeded,['drive:photo'])
  const completed=recovered.record(approved.id,snapshot,{...erpFailure,attempt:2,outcome:'succeeded'})
  assert.equal(completed.nextStatus,'executed')
  assert.deepEqual(completed.retryable,[])
  // The real package is NEVER marked executed by dry-run records.
  assert.equal(repository.get(approved.id).status,'approved_pending_execution')
  const rows=db.prepare('SELECT COUNT(*) AS n FROM update_package_simulated_receipts').get() as {n:number}
  assert.equal(rows.n,3)
 }finally{db.close()}
})
test('idempotent receipt replays do not insert duplicate rows',()=>{
 const {db,approved,store}=harness()
 try{
  const photo=approved.actions[0]!
  const receipt={actionId:photo.id,actionHash:actionSnapshotHash(photo),attempt:1,outcome:'succeeded' as const}
  const snapshot={revision:approved.revision,snapshotHash:approved.snapshotHash}
  store.record(approved.id,snapshot,receipt)
  store.record(approved.id,snapshot,receipt)
  const rows=db.prepare('SELECT COUNT(*) AS n FROM update_package_simulated_receipts').get() as {n:number}
  assert.equal(rows.n,1)
 }finally{db.close()}
})
test('rejeita recibos conflitantes, tentativas fora de sequência e retentativa de sucesso',()=>{
 const {db,approved,store}=harness()
 try{
  const photo=approved.actions[0]!
  const receipt={actionId:photo.id,actionHash:actionSnapshotHash(photo),attempt:1,outcome:'succeeded' as const}
  const snapshot={revision:approved.revision,snapshotHash:approved.snapshotHash}
  assert.throws(()=>store.record(approved.id,snapshot,{...receipt,attempt:2}),/EXECUTION_ATTEMPT_GAP/)
  store.record(approved.id,snapshot,receipt)
  assert.throws(()=>store.record(approved.id,snapshot,{...receipt,outcome:'failed'}),/SIMULATION_RECEIPT_CONFLICT/)
  assert.throws(()=>store.record(approved.id,snapshot,{...receipt,attempt:2}),/EXECUTION_RETRY_AFTER_SUCCESS/)
  assert.throws(()=>store.record(approved.id,snapshot,{...receipt,actionHash:'b'.repeat(64)}),/SIMULATION_ACTION_CHANGED/)
  const rows=db.prepare('SELECT COUNT(*) AS n FROM update_package_simulated_receipts').get() as {n:number}
  assert.equal(rows.n,1)
 }finally{db.close()}
})
test('não aceita snapshot desatualizado nem ação inventada',()=>{
 const {db,approved,store}=harness()
 try{
  const p=approved.actions[0]!
  const receipt={actionId:p.id,actionHash:actionSnapshotHash(p),attempt:1,outcome:'succeeded' as const}
  assert.throws(()=>store.record(approved.id,{
   revision:approved.revision+1,snapshotHash:approved.snapshotHash
  },receipt),/SIMULATION_SNAPSHOT_STALE/)
  assert.throws(()=>store.record(approved.id,{
   revision:approved.revision,snapshotHash:approved.snapshotHash
  },{...receipt,actionId:'unknown'}),/SIMULATION_ACTION_CHANGED/)
  assert.equal(store.inspect(approved.id).pending.length,2)
 }finally{db.close()}
})
test('pacote não aprovado não produz resultados simulados',()=>{
 const db=openDatabase(':memory:')
 try{
  createUpdatePackageSchema(db)
  createUpdatePackageSimulationSchema(db)
  const repo=new UpdatePackageRepository(db)
  const pending=repo.createProposal({source:'gmail',sourceReference:'abcdef0123456789',
   experienceId:'XP1234',plate:'ABC1D23',title:'Pendente',summary:'Sem autorização',
   actions:[{id:'review:identity',type:'other',title:'Conferir',detail:'Sem escrita'}],
   missingFields:[]})
  const store=new UpdatePackageSimulationRepository(db,repo)
  assert.throws(()=>store.inspect(pending.id),/SIMULATION_NOT_APPROVED/)
  const action=pending.actions[0]!
  assert.throws(()=>store.record(pending.id,{
   revision:pending.revision,snapshotHash:pending.snapshotHash
  },{actionId:action.id,actionHash:actionSnapshotHash(action),
   attempt:1,outcome:'succeeded'}),/SIMULATION_NOT_APPROVED/)
 }finally{db.close()}
})
