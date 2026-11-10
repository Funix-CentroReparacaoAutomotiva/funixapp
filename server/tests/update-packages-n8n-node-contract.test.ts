import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {runInNewContext} from 'node:vm'
import {preparePendingGmailPackage} from '../update-packages-n8n-pending.ts'

const source=readFileSync(fileURLToPath(new URL('./fixtures/n8n-gmail-package-node.cjs',import.meta.url)),'utf8')
const id='abcdef0123456789'
function fixture(){
 const attachmentId='attachment_0'
 const md5='a'.repeat(32)
 return {
  u:{
   status:'EVIDENCIAS_UNIFICADAS_GMAIL_SEM_ENVIO',
   send_enabled:false,upload_permitted:false,
   inventory:{eventKey:'gmail:'+id+':v1',source:'gmail',sourceReference:id,
     bodyReviewed:false,commercialReviewed:false,attachmentIds:[attachmentId],checkedAttachmentIds:[]},
   identity:{experienceFromCoda:'XP1234',plateFromCoda:'ABC1D23',conflict:false},
   pending:['REVISAR_CORPO_INTEGRAL','REVISAR_INFORMACOES_COMERCIAIS'],
   readiness:'NAO_CONSOLIDAR_NEM_PUBLICAR'
  },
  report:{
   status:'CONFERENCIA_DOCUMENTAL_CONCLUIDA',upload_permitted:false,
   message_id:id,experience:'XP1234',plate:'ABC1D23',entry_folder_id:'folder-synthetic',
   decisions:[{filename:'foto.jpg',md5,mime_type:'image/jpeg',status:'NOVO_CANDIDATO'}]
  }
 }
}
function run(u:unknown,report:unknown){
 const input={first:()=>({json:u})}
 const named=(name:string)=>{
  if(name==='Concluir triagem do lote dinamico')return {first:()=>({json:report})}
  throw new Error('UNEXPECTED_N8N_NODE')
 }
 // A pure JS node runs in the n8n sandbox. No network, filesystem,
 // workflow activation or external credentials are exposed in this vm.
 const fn=runInNewContext('(function(){'+source+'\n})',{
  $input:input,$:named,Error,Set,String,Array,Object,RegExp
 },{timeout:1500}) as ()=>Array<{json:unknown}>
 return fn()[0]?.json as Record<string,any>
}
test('o código real do nó prepara três fragmentos e permite somente card bloqueado',()=>{
 const {u,report}=fixture()
 const result=run(u,report)
 assert.equal(result.status,'PACOTE_UNICO_RASCUNHO_NAO_PUBLICADO')
 assert.equal(result.send_enabled,false)
 assert.equal(result.upload_permitted,false)
 assert.deepEqual(Array.from(result.eventManifest.expectedParts),['identity','documents','commercial'])
 const envelope=preparePendingGmailPackage(JSON.parse(JSON.stringify(result)))
 assert.equal(envelope.proposal.actions.length,2)
 assert.ok(envelope.proposal.missingFields.some(x=>x.key==='commercialReview'))
 assert.ok(envelope.proposal.actions.some(x=>x.type==='drive_archive'))
 assert.equal(envelope.proposal.actions.some(x=>x.type==='erp_update'),false)
})
test('mensagem, XP e placa diferentes do relatório bloqueiam o pacote',()=>{
 for(const [field,value] of [['message_id','ffffffffffffffff'],['experience','XP9999'],['plate','ZZZ9Z99']] as const){
  const {u,report}=fixture()
  report[field]=value
  assert.throws(()=>run(u,report),/RELATORIO_EVENTO_DIVERGENTE/)
 }
})
test('informação conflituosa ou inventário incompleto não libera proposta',()=>{
 const {u,report}=fixture()
 u.identity.conflict=true
 assert.equal(run(u,report).status,'PACOTE_BLOQUEADO')
 u.identity.conflict=false
 u.inventory.attachmentIds=[]
 assert.equal(run(u,report).status,'PACOTE_BLOQUEADO')
})
test('originais repetidos pelo MD5 produzem somente uma ação',()=>{
 const {u,report}=fixture()
 u.inventory.attachmentIds=['attachment_0','attachment_1']
 report.decisions=[
  {...report.decisions[0]},
  {...report.decisions[0],filename:'foto-copia.jpg'}
 ]
 const result=run(u,report)
 assert.equal(result.proposal.actions.filter((x:any)=>x.type==='drive_archive').length,1)
})
test('arquivos em revisão mantêm pendência documental, sem gerar upload',()=>{
 const {u,report}=fixture()
 report.decisions[0]!.status='REVISAO'
 const result=run(u,report)
 assert.equal(result.proposal.actions.filter((x:any)=>x.type==='drive_archive').length,0)
 assert.ok(result.proposal.missingFields.some((x:any)=>x.key==='archiveReview'))
 assert.equal(result.send_enabled,false)
})
