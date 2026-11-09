import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareGmailPackageForReview as prepare } from '../update-packages-orchestrate.ts'
import type { GmailEventBridgeInput } from '../update-packages-orchestrate.ts'

const make=():GmailEventBridgeInput=>{
 const messageId='abcdef0123456789'
 const proposal=(actions: {id:string,type:'other'|'drive_archive',title:string,detail:string}[])=>({
   source:'gmail' as const,sourceReference:messageId,experienceId:'XP1234',plate:'ABC1D23',
   title:'Evento',summary:'Arquivo sintético',actions,missingFields:[]
 })
 return {
   text:{
     status:'EVIDENCIA_IDENTIFICACAO_PARCIAL',source:'gmail',sourceReference:messageId,
     eventKey:'gmail:'+messageId+':v1',bodyReviewed:false,commercialReviewed:false,
     evidence:{textAvailable:true,htmlAvailable:false,textLength:40,textTruncatedInExtraction:false,
       plateHintsCount:1,xpHintsCount:1,identityStatus:'PISTAS_COLETADAS'}
   },
   attachments:{
     status:'EVIDENCIAS_GMAIL_PARCIAIS_SEM_ENVIO',
     inventory:{eventKey:'gmail:'+messageId+':v1',source:'gmail',sourceReference:messageId,
       bodyReviewed:false,commercialReviewed:false,attachmentIds:['attachment_0'],checkedAttachmentIds:[]},
     evidence:{bodyAvailable:true,plainTextAvailable:true,bodyLength:40,htmlAvailable:false,
       attachmentsReported:1,attachmentsMatched:1,attachmentsNeedingReview:0,
       attachmentObservations:[{attachmentKey:'attachment_0',filename:'foto.jpg',
         status:'NOVO_CANDIDATO',needsReview:false}]}
   },
   message:{id:messageId,subject:'Veículo XP1234',body:'Segue fotografia do veículo para conferência.',bodyComplete:true},
   identity:{part:'identity',proposal:proposal([{id:'review:identity',type:'other',title:'Verificar vínculo',detail:'Revisão'}])},
   documents:{part:'documents',proposal:proposal([{id:'drive:1',type:'drive_archive',title:'Arquivar foto',detail:'Depois de aprovação'}])}
 }
}
test('sem atestado produz pendências, não publica nem grava',()=>{
 const result=prepare(make())
 assert.equal(result.status,'NEEDS_REVIEW')
 assert.equal(result.canPublish,false)
 if(result.status==='NEEDS_REVIEW') assert.ok(result.pending.includes('REVISAR_INFORMACOES_COMERCIAIS'))
})
test('atestado com conferências explícitas permite apenas preparar envelope',()=>{
 const input=make()
 input.verification={bodyReviewed:true,commercialReviewed:true,reviewedAttachmentIds:['attachment_0'],
   verifiedSourceReference:'abcdef0123456789',reviewId:'review:synthetic-001'}
 const result=prepare(input)
 assert.equal(result.status,'READY_FOR_SIGNED_INGEST')
 assert.equal(result.canPublish,false)
 if(result.status==='READY_FOR_SIGNED_INGEST'){
   assert.equal(result.envelope.proposal.actions.length,2)
   assert.equal(result.envelope.eventKey,'gmail:abcdef0123456789:v1')
 }
})
test('atestado de outra mensagem, anexo ausente ou revisão inválida é bloqueado',()=>{
 const input=make()
 input.verification={bodyReviewed:true,commercialReviewed:true,reviewedAttachmentIds:[],
   verifiedSourceReference:'abcdef0123456789',reviewId:'review:synthetic-001'}
 assert.throws(()=>prepare(input),/REVIEW_ATTESTATION_INVALID/)
 input.verification.reviewedAttachmentIds=['attachment_0']
 input.verification.verifiedSourceReference='ffffffffffffffff'
 assert.throws(()=>prepare(input),/REVIEW_ATTESTATION_INVALID/)
})
test('indício comercial não é convertido em autorização pelo atestado',()=>{
 const input=make()
 input.message.body='APROVADO complemento R$ 500,00.'
 input.verification={bodyReviewed:true,commercialReviewed:true,reviewedAttachmentIds:['attachment_0'],
   verifiedSourceReference:'abcdef0123456789',reviewId:'review:synthetic-001'}
 const result=prepare(input)
 assert.equal(result.status,'NEEDS_REVIEW')
 if(result.status==='NEEDS_REVIEW') assert.ok(result.pending.includes('COMMERCIAL_REPLAN_REQUIRED'))
})
test('não aceita corpo parcial ou fragmentos pertencentes a outra mensagem',()=>{
 const input=make()
 input.message.bodyComplete=false
 assert.throws(()=>prepare(input),/MESSAGE_BODY_INCOMPLETE/)
 input.message.bodyComplete=true
 input.documents.proposal.sourceReference='ffffffffffffffff'
 assert.throws(()=>prepare(input),/FRAGMENT_MESSAGE_CONFLICT/)
})
