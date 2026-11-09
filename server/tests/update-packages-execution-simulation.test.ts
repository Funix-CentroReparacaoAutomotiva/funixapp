import test from 'node:test'
import assert from 'node:assert/strict'
import { simulateUpdatePackageExecution as simulate, actionSnapshotHash } from '../update-packages-execution-simulation.ts'
const actions=[
 {id:'drive:1',type:'drive_archive' as const,title:'Arquivar foto',detail:'Teste'},
 {id:'erp:1',type:'erp_update' as const,title:'Atualizar registro',detail:'Teste'}
]
const pkg={status:'approved_pending_execution' as const,actions}
const receipt=(i:number,attempt:number,outcome:'succeeded'|'failed')=>({
 actionId:actions[i]!.id,actionHash:actionSnapshotHash(actions[i]!),attempt,outcome
})
test('simulação sem recibos mantém ações aguardando execução',()=>{
 const result=simulate(pkg,[])
 assert.equal(result.nextStatus,'approved_pending_execution')
 assert.deepEqual(result.pending,['drive:1','erp:1'])
})
test('falha parcial mantém item concluído e retoma apenas o pendente',()=>{
 const first=simulate(pkg,[receipt(0,1,'succeeded'),receipt(1,1,'failed')])
 assert.equal(first.nextStatus,'execution_failed')
 assert.deepEqual(first.retryable,['erp:1'])
 const resumed=simulate({...pkg,status:'execution_failed'},[
  receipt(0,1,'succeeded'),receipt(1,1,'failed'),receipt(1,2,'succeeded')
 ])
 assert.equal(resumed.nextStatus,'executed')
 assert.deepEqual(resumed.retryable,[])
})
test('reentrega idêntica de recibo não muda o resultado',()=>{
 const same=receipt(0,1,'succeeded')
 const result=simulate(pkg,[same,same])
 assert.deepEqual(result.succeeded,['drive:1'])
})
test('recibo alterado, reexecução de concluído e salto de tentativas são recusados',()=>{
 assert.throws(()=>simulate(pkg,[receipt(0,1,'succeeded'),receipt(0,1,'failed')]),/EXECUTION_RECEIPT_CONFLICT/)
 assert.throws(()=>simulate(pkg,[receipt(0,1,'succeeded'),receipt(0,2,'succeeded')]),/EXECUTION_RETRY_AFTER_SUCCESS/)
 assert.throws(()=>simulate(pkg,[receipt(1,2,'failed')]),/EXECUTION_ATTEMPT_GAP/)
 assert.throws(()=>simulate(pkg,[{...receipt(0,1,'succeeded'),actionHash:'0'.repeat(64)}]),/EXECUTION_RECEIPT_INVALID/)
})
test('sem aprovação ou com ação inventada não inicia simulação',()=>{
 assert.throws(()=>simulate({...pkg,status:'awaiting_review'},[]),/EXECUTION_NOT_APPROVED/)
 assert.throws(()=>simulate(pkg,[{...receipt(0,1,'succeeded'),actionId:'drive:other'}]),/EXECUTION_RECEIPT_INVALID/)
})
