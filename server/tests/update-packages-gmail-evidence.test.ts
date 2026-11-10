import test from 'node:test'
import assert from 'node:assert/strict'
import { correlateGmailEvidence as correlate, GmailEvidenceConflict } from '../update-packages-gmail-evidence.ts'
import type { GmailTextEvidence, GmailAttachmentEvidence } from '../update-packages-gmail-evidence.ts'

const textEvidence=():GmailTextEvidence=>({
  status:'EVIDENCIA_IDENTIFICACAO_PARCIAL',
  source:'gmail',sourceReference:'abcdef0123456789',eventKey:'gmail:abcdef0123456789:v1',
  bodyReviewed:false,commercialReviewed:false,
  evidence:{textAvailable:true,htmlAvailable:false,textLength:127,textTruncatedInExtraction:false,
    plateHintsCount:1,xpHintsCount:1,identityStatus:'PISTAS_COLETADAS'}
})
const documentEvidence=():GmailAttachmentEvidence=>({
  status:'EVIDENCIAS_GMAIL_PARCIAIS_SEM_ENVIO',
  inventory:{eventKey:'gmail:abcdef0123456789:v1',source:'gmail',sourceReference:'abcdef0123456789',
    bodyReviewed:false,commercialReviewed:false,attachmentIds:['attachment_0','attachment_1'],
    checkedAttachmentIds:['attachment_0','attachment_1']},
  evidence:{bodyAvailable:true,plainTextAvailable:true,bodyLength:127,htmlAvailable:false,
    attachmentsReported:2,attachmentsMatched:2,attachmentsNeedingReview:0,
    attachmentObservations:[
      {attachmentKey:'attachment_0',filename:'foto.jpg',status:'NOVO_CANDIDATO',needsReview:false},
      {attachmentKey:'attachment_1',filename:'doc.pdf',status:'DUPLICADO_BINARIO',needsReview:false}
    ]}
})
const errorCode=(fn:()=>unknown,code:string)=>assert.throws(fn,
  (error:unknown)=>error instanceof GmailEvidenceConflict&&error.code===code)

test('correla mensagem e mantém todas as aprovações bloqueadas, ainda que hashes coincidam',()=>{
  const result=correlate(textEvidence(),documentEvidence())
  assert.equal(result.status,'AGUARDANDO_REVISAO')
  assert.equal(result.send_enabled,false)
  assert.equal(result.upload_permitted,false)
  assert.equal(result.inventory.bodyReviewed,false)
  assert.equal(result.inventory.commercialReviewed,false)
  assert.deepEqual(result.inventory.checkedAttachmentIds,[])
  assert.ok(result.pending.includes('VALIDAR_CONTEUDO_DOS_ANEXOS'))
  assert.ok(result.pending.includes('REVISAR_INFORMACOES_COMERCIAIS'))
})
test('rejeita fragmentos de mensagens distintas',()=>{
  const attachment=documentEvidence()
  attachment.inventory.sourceReference='abcdef0123456788'
  errorCode(()=>correlate(textEvidence(),attachment),'MESSAGE_CONFLICT')
})
test('rejeita anexo faltante e contagem inconsistente',()=>{
  const attachment=documentEvidence()
  attachment.evidence.attachmentObservations.pop()
  errorCode(()=>correlate(textEvidence(),attachment),'ATTACHMENT_CONFLICT')
})
test('não permite promoção de revisão sem evidência',()=>{
  const text=textEvidence()
  const attachment=documentEvidence()
  attachment.inventory.bodyReviewed=true
  errorCode(()=>correlate(text,attachment),'EVIDENCE_INVALID')
})
test('sinaliza truncamento, ausência de corpo e anexo controverso',()=>{
  const text=textEvidence(),attachment=documentEvidence()
  text.evidence.textTruncatedInExtraction=true
  text.evidence.textAvailable=false
  attachment.evidence.attachmentObservations[1]!.needsReview=true
  attachment.evidence.attachmentsNeedingReview=1
  const result=correlate(text,attachment)
  assert.ok(result.pending.includes('TEXTO_TRUNCADO'))
  assert.ok(result.pending.includes('CORPO_NAO_DISPONIVEL'))
  assert.ok(result.pending.includes('REVISAR_ANEXOS_DIVERGENTES'))
})
