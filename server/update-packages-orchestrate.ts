import type { GmailTextEvidence, GmailAttachmentEvidence } from './update-packages-gmail-evidence.ts'
import { correlateGmailEvidence } from './update-packages-gmail-evidence.ts'
import { triageCommercialEmail } from './update-packages-commercial.ts'
import type { CommercialTriage } from './update-packages-commercial.ts'
import type { UpdatePackageFragment } from './update-packages-consolidate.ts'
import { prepareCompleteUpdateEvent } from './update-packages-event.ts'
import type { EventPreparation, EventInventory } from './update-packages-event.ts'

/**
 * Pure bridge from n8n extraction to FUNIX package proposal.
 * The caller is responsible for independently validating Coda/Drive evidence;
 * this function never sends HTTP or writes to any service.
 */
export type GmailEventBridgeInput = {
  text: GmailTextEvidence
  attachments: GmailAttachmentEvidence
  message: {
    id: string
    subject: string
    body: string | null
    bodyComplete: boolean
  }
  identity: UpdatePackageFragment
  documents: UpdatePackageFragment
  /** Evidence issued by a trusted verifier, not by message text or an LLM. */
  verification?: {
    bodyReviewed: true
    commercialReviewed: true
    reviewedAttachmentIds: string[]
    verifiedSourceReference: string
    reviewId: string
  }
}
export type GmailBridgeResult =
  | { status:'NEEDS_REVIEW'; pending:string[]; commercial:CommercialTriage; canPublish:false }
  | { status:'READY_FOR_SIGNED_INGEST'; envelope:ReturnType<typeof prepareCompleteUpdateEvent>; canPublish:false }

const unique=(values:string[]):boolean=>new Set(values).size===values.length
const reviewKey=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,119}$/

export function prepareGmailPackageForReview(input:GmailEventBridgeInput):GmailBridgeResult {
  const correlated=correlateGmailEvidence(input.text,input.attachments)
  if (input.message.id!==correlated.inventory.sourceReference ||
    !input.message.bodyComplete || input.message.body===null) {
    throw new Error('MESSAGE_BODY_INCOMPLETE')
  }
  const commercial=triageCommercialEmail({
    messageId:input.message.id,subject:input.message.subject,
    body:input.message.body,bodyComplete:input.message.bodyComplete,
    experienceId:input.identity.proposal.experienceId,
    plate:input.identity.proposal.plate
  })
  const parts=[input.identity,input.documents,commercial.fragment]
  if (parts[0]?.part!=='identity' || parts[1]?.part!=='documents') {
    throw new Error('INVALID_FRAGMENT_KIND')
  }
  for (const f of parts) {
    if (f.proposal.source!=='gmail' ||
      f.proposal.sourceReference!==input.message.id) throw new Error('FRAGMENT_MESSAGE_CONFLICT')
  }
  const verification=input.verification
  const pending=[...correlated.pending]
  if (commercial.status==='requires_review') pending.push('COMMERCIAL_EVIDENCE_UNVERIFIED')
  if (!verification) {
    return {status:'NEEDS_REVIEW',pending:[...new Set(pending)],commercial,canPublish:false}
  }
  if (verification.verifiedSourceReference!==input.message.id ||
      !reviewKey.test(verification.reviewId) ||
      verification.bodyReviewed!==true || verification.commercialReviewed!==true ||
      !Array.isArray(verification.reviewedAttachmentIds) ||
      !unique(verification.reviewedAttachmentIds) ||
      verification.reviewedAttachmentIds.length!==correlated.inventory.attachmentIds.length ||
      !verification.reviewedAttachmentIds.every(id=>correlated.inventory.attachmentIds.includes(id))) {
    throw new Error('REVIEW_ATTESTATION_INVALID')
  }
  // A commercial ambiguity cannot be resolved merely by declaring an attest;
  // verified commercial outcomes must be separately replanned into the final
  // proposal. The conservative triage remains an explicit blocking field.
  if (commercial.fragment.proposal.missingFields.length) {
    return {status:'NEEDS_REVIEW',pending:['COMMERCIAL_REPLAN_REQUIRED'],commercial,canPublish:false}
  }
  const inventory:EventInventory={
    ...correlated.inventory,bodyReviewed:true,commercialReviewed:true,
    checkedAttachmentIds:[...verification.reviewedAttachmentIds]
  }
  const preparation:EventPreparation={inventory,fragments:parts}
  const envelope=prepareCompleteUpdateEvent(preparation)
  // Always false: signing and publication require a separate authenticated
  // sender and policy check, never automatic publication from this pure bridge.
  return {status:'READY_FOR_SIGNED_INGEST',envelope,canPublish:false}
}
