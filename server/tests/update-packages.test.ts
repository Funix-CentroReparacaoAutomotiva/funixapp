import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../database.ts'
import { UpdatePackageRepository } from '../update-packages.ts'
import { createUpdatePackageSchema } from '../update-packages-schema.ts'

const proposal = () => ({
  source:'gmail' as const,sourceReference:'message:synth-001',
  experienceId:'XP1234',plate:'ABC1D23',
  title:'XP1234 — Veículo ABC1D23',summary:'Arquivar duas imagens e conferir uma alteração',
  actions:[{id:'drive:1',type:'drive_archive' as const,title:'Arquivar 2 imagens',detail:'Originais preservados'}],
  missingFields:[]
})
function setup() {
  const db=openDatabase(':memory:')
  createUpdatePackageSchema(db)
  const repo=new UpdatePackageRepository(db,()=> '2026-11-08T20:00:00.000Z')
  return {db,repo}
}
test('Armazenamento opt-in: pacote nasce aberto, não cria dados de demonstração e fecha somente rejeitado ou executado',()=>{
  const {db,repo}=setup()
  try{
    assert.equal(repo.list('open','').total,0)
    assert.equal(repo.list('closed','').total,0)
    const x=repo.createProposal(proposal())
    assert.equal(x.status,'awaiting_review')
    assert.equal(x.revision,1)
    assert.equal(x.actions.length,1)
    assert.equal(x.snapshotHash.length,64)
    assert.equal(repo.list('open','ABC1D23').total,1)
    assert.equal(repo.list('closed','ABC1D23').total,0)
    assert.equal(repo.list('open','não encontrado').total,0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM update_package_decisions').get()!.n,0)
  }finally{db.close()}
})
test('aprovação registra intenção, não executa; revisão protege contra decisão antiga e replay',()=>{
  const {db,repo}=setup()
  try{
    const x=repo.createProposal(proposal())
    const key=randomUUID()
    const approved=repo.decide(x.id,{revision:x.revision,snapshotHash:x.snapshotHash,decision:'approve',requestId:key},'funix_operator')
    assert.equal(approved.status,'approved_pending_execution')
    assert.equal(approved.revision,2)
    assert.equal(repo.list('open','XP1234').total,1)
    assert.equal(repo.list('closed','XP1234').total,0)
    assert.equal(repo.decide(x.id,{revision:1,snapshotHash:x.snapshotHash,decision:'approve',requestId:key},'funix_operator').revision,2)
    assert.throws(()=>repo.decide(x.id,{revision:1,snapshotHash:x.snapshotHash,decision:'reject',requestId:randomUUID()},'funix_operator'),{code:'PACKAGE_STALE'})
    assert.throws(()=>repo.decide(x.id,{revision:1,snapshotHash:x.snapshotHash,decision:'reject',requestId:key},'funix_operator'),{code:'PACKAGE_REQUEST_CONFLICT'})
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM update_package_decisions').get()!.n,1)
    assert.throws(()=>db.prepare('UPDATE update_packages SET title=? WHERE id=?').run('alterado',x.id),/imutável/)
  }finally{db.close()}
})
test('rejeição fecha, pendências impedem aprovação, dados inválidos são recusados',()=>{
  const {db,repo}=setup()
  try{
    const q=proposal()
    const x=repo.createProposal({...q,missingFields:[{key:'identidade',label:'Confirmar XP',hint:'Dados conflitantes'}]})
    assert.throws(()=>repo.decide(x.id,{revision:1,snapshotHash:x.snapshotHash,decision:'approve',requestId:randomUUID()},'funix_operator'),{code:'PACKAGE_INCOMPLETE'})
    const rejected=repo.decide(x.id,{revision:1,snapshotHash:x.snapshotHash,decision:'reject',requestId:randomUUID()},'funix_operator')
    assert.equal(rejected.status,'rejected')
    assert.equal(repo.list('open','').total,0)
    assert.equal(repo.list('closed','').total,1)
    assert.throws(()=>repo.createProposal({...q,actions:[]}),{code:'PACKAGE_INVALID'})
    assert.throws(()=>repo.createProposal({...q,actions:[q.actions[0]!,q.actions[0]!]}),{code:'PACKAGE_INVALID'})
  }finally{db.close()}
})
