import type { EventInventory } from './update-packages-event.ts'

/** Evidence collected by independent, read-only Gmail branches. */
export type GmailTextEvidence = {
  status: 'EVIDENCIA_IDENTIFICACAO_PARCIAL'
  source: 'gmail'
  sourceReference: string
  eventKey: string
  bodyReviewed: false
  commercialReviewed: false
  evidence: {
    textAvailable: boolean
    htmlAvailable: boolean
    textLength: number | null
    textTruncatedInExtraction: boolean
    plateHintsCount: number
    xpHintsCount: number
    identityStatus: string
  }
}

export type GmailAttachmentEvidence = {
  status: 'EVIDENCIAS_GMAIL_PARCIAIS_SEM_ENVIO'
  inventory: EventInventory
  evidence: {
    bodyAvailable: boolean
    plainTextAvailable: boolean
    bodyLength: number | null
    htmlAvailable: boolean
    attachmentsReported: number
    attachmentsMatched: number
    attachmentsNeedingReview: number
    attachmentObservations: Array<{
      attachmentKey: string
      filename: string
      status: string
      needsReview: boolean
    }>
  }
}

export type PendingGmailEvent = {
  status: 'AGUARDANDO_REVISAO'
  send_enabled: false
  upload_permitted: false
  inventory: EventInventory
  evidence: {
    textAvailable: boolean
    htmlAvailable: boolean
    textTruncated: boolean
    attachments: number
    attachmentsNeedingReview: number
    identityStatus: string
  }
  pending: string[]
}

export class GmailEvidenceConflict extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'GmailEvidenceConflict'
  }
}
const reject = (code: string, detail: string): never => { throw new GmailEvidenceConflict(code, detail) }
const gmailId = /^[0-9a-f]{15,25}$/i

/**
 * Join independent read-only branch results without converting collection into
 * review or validation. It deliberately never produces EventPreparation: an
 * authoritative extraction/review stage is still required to clear the gates.
 */
export function correlateGmailEvidence(
  text: GmailTextEvidence,
  attachments: GmailAttachmentEvidence
): PendingGmailEvent {
  const v = attachments?.inventory
  if (!text || text.status !== 'EVIDENCIA_IDENTIFICACAO_PARCIAL' ||
      !v || attachments.status !== 'EVIDENCIAS_GMAIL_PARCIAIS_SEM_ENVIO' ||
      !gmailId.test(text.sourceReference) || text.source !== 'gmail' ||
      text.eventKey !== `gmail:${text.sourceReference}:v1` ||
      v.source !== 'gmail' || v.sourceReference !== text.sourceReference ||
      v.eventKey !== text.eventKey) {
    reject('MESSAGE_CONFLICT', 'Evidências pertencem a mensagens diferentes ou inválidas.')
  }
  if (text.bodyReviewed !== false || text.commercialReviewed !== false ||
      v.bodyReviewed !== false || v.commercialReviewed !== false ||
      !Array.isArray(v.attachmentIds) || !Array.isArray(v.checkedAttachmentIds) ||
      !Array.isArray(attachments.evidence?.attachmentObservations)) {
    reject('EVIDENCE_INVALID', 'Estado de revisão inválido.')
  }
  const e = attachments.evidence
  const observations = e.attachmentObservations
  const keys = observations.map(item=>item?.attachmentKey)
  if (new Set(keys).size !== keys.length ||
      new Set(v.attachmentIds).size !== v.attachmentIds.length ||
      keys.length !== v.attachmentIds.length ||
      keys.some(key => typeof key !== 'string' || !v.attachmentIds.includes(key)) ||
      v.checkedAttachmentIds.some(key => !v.attachmentIds.includes(key)) ||
      !Number.isSafeInteger(e.attachmentsReported) || !Number.isSafeInteger(e.attachmentsMatched) ||
      !Number.isSafeInteger(e.attachmentsNeedingReview) ||
      e.attachmentsReported !== observations.length ||
      e.attachmentsMatched !== observations.length ||
      e.attachmentsNeedingReview !== observations.filter(item=>item?.needsReview===true).length) {
    reject('ATTACHMENT_CONFLICT', 'Inventário e observações dos anexos não coincidem.')
  }
  if (!text.evidence || typeof text.evidence.textTruncatedInExtraction !== 'boolean' ||
      typeof text.evidence.identityStatus !== 'string' ||
      typeof text.evidence.textAvailable !== 'boolean' ||
      typeof text.evidence.htmlAvailable !== 'boolean') {
    reject('TEXT_EVIDENCE_INVALID', 'Evidência textual inválida.')
  }
  const pending = ['REVISAR_CORPO_INTEGRAL', 'REVISAR_INFORMACOES_COMERCIAIS', 'VALIDAR_XP_E_PLACA']
  if (text.evidence.textTruncatedInExtraction) pending.push('TEXTO_TRUNCADO')
  if (!text.evidence.textAvailable && !text.evidence.htmlAvailable) pending.push('CORPO_NAO_DISPONIVEL')
  if (e.attachmentsNeedingReview) pending.push('REVISAR_ANEXOS_DIVERGENTES')
  // Even the non-conflicting hash/metadata matches still need content review.
  if (observations.length) pending.push('VALIDAR_CONTEUDO_DOS_ANEXOS')
  return {
    status:'AGUARDANDO_REVISAO',
    send_enabled:false,
    upload_permitted:false,
    inventory:{...v,bodyReviewed:false,commercialReviewed:false,checkedAttachmentIds:[]},
    evidence:{
      textAvailable:text.evidence.textAvailable,
      htmlAvailable:text.evidence.htmlAvailable,
      textTruncated:text.evidence.textTruncatedInExtraction,
      attachments:observations.length,
      attachmentsNeedingReview:e.attachmentsNeedingReview,
      identityStatus:text.evidence.identityStatus
    },
    pending
  }
}
