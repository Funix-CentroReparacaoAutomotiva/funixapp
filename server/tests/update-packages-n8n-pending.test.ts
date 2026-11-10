import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {createUpdatePackageSchema} from '../update-packages-schema.ts'
import {UpdatePackageRepository} from '../update-packages.ts'
import {preparePendingGmailPackage} from '../update-packages-n8n-pending.ts'
import type {PendingN8nGmailDraft} from '../update-packages-n8n-pending.ts'

const fixture=():PendingN8nGmailDraft=>{
 const id='abcdef0123456789',xp='XP1234',plate='ABC1D23'
 const base={source:'gmail' as const,sourceReference:id,experienceId:xp,plate}
 const identity={part:'identity',proposal:{...base,title:'Identificação',
  summary:'XP e placa para conferência',actions:[{id:'review:identity',type:'other' as const,title:'Conferir vínculo',detail:'Sem escrita'}],missingFields:[]}}
 const documents={part:'documents',proposal:{...base,title:'Documentos',summary:'Um arquivo candidato',
  actions:[{id:'drive:'+'a'.repeat(32),type:'drive_archive' as const,title:'Arquivar foto',detail:'Revalidar MD5 antes de gravar'}],missingFields:[]}}
 const field={key:'commercialReview',label:'Conferir autorização comercial',
  hint:'Verificar documento de origem e valores'}
 const commercial={part:'commercial',proposal:{...base,title:'Comercial',summary:'Leitura ainda não verificada',
  actions:[],missingFields:[field]}}
 return {
  status:'PACOTE_UNICO_RASCUNHO_NAO_PUBLICADO',
  send_enabled:false,upload_permitted:false,
  readiness:'AGUARDANDO_REVALIDACAO_E_APROVACAO_HUMANA',
  eventKey:'gmail:'+id+':v1',
  inventory:{eventKey:'gmail:'+id+':v1',source:'gmail',sourceReference:id,
    bodyReviewed:false,commercialReviewed:false,attachmentIds:['attachment_0'],checkedAttachmentIds:[]},
  eventManifest:{eventKey:'gmail:'+id+':v1',expectedParts:['identity','documents','commercial']},
  fragments:[identity,documents,commercial],
  proposal:{...base,title:xp+' · '+plate,summary:'Um arquivo e conferência comercial',
    actions:[...identity.proposal.actions,...documents.proposal.actions],
    missingFields:[field]}
 }
}
test('rascunho incompleto gera card pendente e impede aprovação',()=>{
 const envelope=preparePendingGmailPackage(fixture())
 assert.equal(envelope.proposal.missingFields[0]?.key,'commercialReview')
 const db=openDatabase(':memory:')
 try{
  createUpdatePackageSchema(db)
  const repo=new UpdatePackageRepository(db)
  const row=repo.ingest(envelope)
  assert.equal(row.status,'awaiting_review')
  assert.equal(repo.list('open','XP1234').total,1)
  assert.throws(()=>repo.decide(row.id,{decision:'approve',revision:row.revision,
   snapshotHash:row.snapshotHash,requestId:'11111111-1111-4111-8111-111111111111'},'synthetic_operator'),
   (error:unknown)=>error instanceof Error && error.message.includes('pendentes'))
  assert.equal(repo.get(row.id).status,'awaiting_review')
 }finally{db.close()}
})
test('bloqueia proposta que esconde campo comercial',()=>{
 const input=fixture()
 input.proposal.missingFields=[]
 assert.throws(()=>preparePendingGmailPackage(input),/N8N_DRAFT_PROPOSAL_MISMATCH/)
 const other=fixture()
 other.fragments[2]!.proposal.missingFields=[]
 other.proposal.missingFields=[]
 assert.throws(()=>preparePendingGmailPackage(other),/N8N_DRAFT_COMMERCIAL_UNVERIFIED/)
})
test('bloqueia execução comercial ou ação distinta do fragmento',()=>{
 const input=fixture()
 input.proposal.actions.push({id:'erp:authorization',type:'erp_update',title:'Gravar valor',detail:'Não comprovado'})
 assert.throws(()=>preparePendingGmailPackage(input),/N8N_DRAFT_PROPOSAL_MISMATCH/)
})
test('bloqueia evento de outra mensagem ou falsa revisão',()=>{
 const input=fixture()
 input.inventory.sourceReference='ffffffffffffffff'
 assert.throws(()=>preparePendingGmailPackage(input),/N8N_DRAFT_INVENTORY_INVALID/)
 const other=fixture()
 other.inventory.bodyReviewed=true
 assert.throws(()=>preparePendingGmailPackage(other),/N8N_DRAFT_INVENTORY_INVALID/)
})
