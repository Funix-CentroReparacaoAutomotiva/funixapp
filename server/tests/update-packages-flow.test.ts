import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../database.ts'
import { createUpdatePackageSchema } from '../update-packages-schema.ts'
import { UpdatePackageRepository } from '../update-packages.ts'
import { prepareGmailPackageForReview } from '../update-packages-orchestrate.ts'
import type { GmailEventBridgeInput } from '../update-packages-orchestrate.ts'

const fixture=():GmailEventBridgeInput=>{
 const msg='abcdef0123456789'
 const proposal=(actions:Array<{id:string,type:'other'|'drive_archive',title:string,detail:string}>)=>({
   source:'gmail' as const,sourceReference:msg,experienceId:'XP1234',plate:'ABC1D23',
   title:'XP1234 - arquivos',summary:'Um arquivo novo',actions,missingFields:[]
 })
 return {
  text:{status:'EVIDENCIA_IDENTIFICACAO_PARCIAL',source:'gmail',
    sourceReference:msg,eventKey:'gmail:'+msg+':v1',bodyReviewed:false,commercialReviewed:false,
    evidence:{textAvailable:true,htmlAvailable:false,textLength:22,textTruncatedInExtraction:false,
      plateHintsCount:1,xpHintsCount:1,identityStatus:'PISTAS_COLETADAS'}},
  attachments:{status:'EVIDENCIAS_GMAIL_PARCIAIS_SEM_ENVIO',
    inventory:{source:'gmail',sourceReference:msg,eventKey:'gmail:'+msg+':v1',
      bodyReviewed:false,commercialReviewed:false,attachmentIds:['attachment_0'],checkedAttachmentIds:[]},
    evidence:{bodyAvailable:true,plainTextAvailable:true,bodyLength:22,htmlAvailable:false,
      attachmentsReported:1,attachmentsMatched:1,attachmentsNeedingReview:0,
      attachmentObservations:[{attachmentKey:'attachment_0',filename:'foto.jpg',
        status:'NOVO_CANDIDATO',needsReview:false}]}},
  message:{id:msg,subject:'XP1234 - foto',body:'Segue arquivo para conferencia.',bodyComplete:true},
  identity:{part:'identity',proposal:proposal([{id:'identity:review',type:'other',title:'Conferir identificacao',detail:'Sem escrita'}])},
  documents:{part:'documents',proposal:proposal([{id:'drive:foto',type:'drive_archive',title:'Arquivar foto',detail:'Depois da aprovacao'}])},
  verification:{bodyReviewed:true,commercialReviewed:true,reviewedAttachmentIds:['attachment_0'],
    verifiedSourceReference:msg,reviewId:'review:synthetic-001'}
 }
}
test('fluxo sintético: preparo -> armazenamento -> card -> aprovação auditada, sem executor',()=>{
 const db=openDatabase(':memory:')
 try{
  createUpdatePackageSchema(db)
  const repo=new UpdatePackageRepository(db)
  const prepared=prepareGmailPackageForReview(fixture())
  assert.equal(prepared.status,'READY_FOR_SIGNED_INGEST')
  if(prepared.status!=='READY_FOR_SIGNED_INGEST')return
  assert.equal(prepared.canPublish,false)
  const row=repo.ingest(prepared.envelope)
  assert.equal(row.status,'awaiting_review')
  assert.equal(repo.list('open','XP1234').total,1)
  assert.equal(repo.list('closed','').total,0)
  const approved=repo.decide(row.id,{revision:row.revision,snapshotHash:row.snapshotHash,
    requestId:randomUUID(),decision:'approve'},'synthetic_operator')
  assert.equal(approved.status,'approved_pending_execution')
  assert.equal(repo.list('open','XP1234').total,1)
  assert.equal(repo.list('closed','XP1234').total,0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM update_package_decisions').get()!.n,1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM update_packages WHERE status=?').get('executed')!.n,0)
 }finally{db.close()}
})
test('indício de autorização não chega ao armazenamento sem nova validação comercial',()=>{
 const input=fixture()
 input.message.body='Autorizado R$ 800,00 conforme documento.'
 const prepared=prepareGmailPackageForReview(input)
 assert.equal(prepared.status,'NEEDS_REVIEW')
 if(prepared.status==='NEEDS_REVIEW')assert.ok(prepared.pending.includes('COMMERCIAL_REPLAN_REQUIRED'))
})
